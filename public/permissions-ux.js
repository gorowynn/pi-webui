/**
 * permissions-ux.js — pure helpers for the #permissions page (SDD
 * permission-policy C10: FR-29..36). Dual-mode (module.exports + window.*) so
 * the browser renders with them AND Node tests them. No DOM access — every
 * function maps data → data; app.js owns the rendering.
 */
(() => {
	/** FR-30: merge per-tool rules into a display tree with layer provenance.
	 *  Input: {default, user, workspace} config objects + the engine's merged
	 *  diagnostics. Output: [{tool, rules: [{pattern, action, layers: []}]}]
	 *  — each rule lists the layers it appears in (highest priority first) and
	 *  the action of the HIGHEST-priority layer defining it (the effective
	 *  one — later layers may only tighten, never override upward). */
	function buildLayerTree(def, user, ws, diagnostics) {
		const tools = new Set([
			...Object.keys(def || {}),
			...Object.keys(user || {}),
			...Object.keys(ws || {}),
		]);
		const META = new Set([
			"version",
			"revision",
			"mode",
			"nonInteractive",
			"sensitivePaths",
			"grants",
			"*",
		]);
		const out = [];
		for (const tool of tools) {
			if (META.has(tool)) continue;
			const rule = { tool, rules: [] };
			const seen = new Map(); // patternKey → {action, layers}
			for (const layer of ["workspace", "user", "default"]) {
				const cfg = layer === "workspace" ? ws : layer === "user" ? user : def;
				const r = cfg && cfg[tool];
				if (typeof r === "string") {
					if (!seen.has("__tool__"))
						seen.set("__tool__", { action: r, layers: [] });
					seen.get("__tool__").layers.push(layer);
				} else if (r && typeof r === "object") {
					for (const p of Object.keys(r)) {
						if (!seen.has(p)) seen.set(p, { action: r[p], layers: [] });
						seen.get(p).layers.push(layer);
					}
				}
			}
			for (const [pattern, v] of seen) {
				rule.rules.push({
					pattern: pattern === "__tool__" ? "(tool default)" : pattern,
					action: v.action,
					layers: v.layers,
				});
			}
			// effective action for the tool's fallback (top-level *)
			const effStar =
				(ws && ws["*"]) || (user && user["*"]) || (def && def["*"]) || "allow";
			rule.fallback = effStar;
			out.push(rule);
		}
		out.sort((a, b) => a.tool.localeCompare(b.tool));
		return { tools: out, diagnostics: diagnostics || [] };
	}

	/** Quick rule editor (user layer only — the floor is locked, the workspace
	 *  layer is tighten-only and edited via its own file). Mutates a CLONE and
	 *  returns it; the caller PUTs it through the revision-checked endpoint.
	 *  empty pattern → the tool's `*` fallback; a bare string tool rule is
	 *  converted to {…} so both forms edit uniformly. */
	function applyRule(cfg, tool, pattern, effect) {
		const t = String(tool || "").trim();
		if (!t) return { ok: false, error: "tool required" };
		const META = new Set([
			"version",
			"revision",
			"mode",
			"nonInteractive",
			"sensitivePaths",
			"grants",
		]);
		if (META.has(t))
			return { ok: false, error: `'${t}' is a config key, not a tool` };
		const eff = String(effect || "").trim();
		if (!["allow", "ask", "deny"].includes(eff))
			return { ok: false, error: "effect must be allow|ask|deny" };
		const out = structuredClone(cfg || {});
		const p = String(pattern || "").trim() || "*";
		const cur = out[t];
		// a string tool rule IS a whole-tool default — preserve it as "*" when
		// converting to object form (engine treats both as the tool fallback)
		if (typeof cur === "string") out[t] = { "*": cur, [p]: eff };
		else if (cur && typeof cur === "object") out[t] = { ...cur, [p]: eff };
		else out[t] = { [p]: eff };
		return { ok: true, config: out };
	}

	/** Remove a rule from the user layer. pattern is the tree's display form:
	 *  "(tool default)" → the whole tool key; "*" / "re:…" / glob → that key
	 *  inside the tool object (dropping the tool key when it empties). */
	function removeRule(cfg, tool, pattern) {
		const t = String(tool || "").trim();
		const out = structuredClone(cfg || {});
		const cur = out[t];
		if (cur === undefined) return { ok: false, error: "no such tool rule" };
		if (pattern === "(tool default)") {
			delete out[t];
		} else {
			if (!cur || typeof cur !== "object")
				return { ok: false, error: "rule is not per-pattern" };
			delete cur[pattern];
			if (!Object.keys(cur).length) delete out[t];
		}
		return { ok: true, config: out };
	}

	/** FR-31/33: editor-friendly validation — wraps the engine's validateConfig
	 *  output into {field, message} rows the rule editor can inline. */
	function ruleEditorMessages(validateResult) {
		const out = [];
		for (const e of validateResult.errors || []) {
			const field = e.path.split(".")[0];
			out.push({ field, message: e.message, path: e.path });
		}
		return out;
	}

	/** FR-34: redact a selector for the audit/grants view — sensitive-class paths
	 *  show basename only; everything else truncates at 400 chars. */
	function redactSelector(selector, sensitivePaths) {
		const s = String(selector || "");
		if (!s) return "";
		const isPath =
			/^[./~\\]/.test(s) ||
			s.includes("/") ||
			s.includes("\\") ||
			/^[a-z]:/i.test(s);
		if (isPath && Array.isArray(sensitivePaths) && sensitivePaths.length) {
			const base = s.replace(/\\/g, "/").split("/").filter(Boolean).pop() || s;
			for (const e of sensitivePaths) {
				if (!e || typeof e.pattern !== "string") continue;
				// glob match against the full path (cheap glob compile)
				const esc = e.pattern
					.replace(/[.+^${}()|[\]\\]/g, "\\$&")
					.replace(/\*/g, ".*")
					.replace(/\?/g, ".");
				if (
					new RegExp(`^${esc}$`, "i").test(s) ||
					new RegExp(`^${esc}$`, "i").test(base)
				) {
					return `…/${base} (sensitive)`;
				}
			}
		}
		return s.length > 400 ? s.slice(0, 400) + " …" : s;
	}

	/** FR-35: Explain view model — same fields the live gate produces + a bash
	 *  per-part breakdown when the classifier ran. */
	function explainView(verdict, bash, gateVerdict) {
		const v = {
			action: verdict.action,
			tier: verdict.tier,
			matchedRule: verdict.matchedRule,
			layer: verdict.layer,
			reason: verdict.reason,
			autoAllowable: false,
		};
		if (gateVerdict && gateVerdict.allow) v.autoAllowable = true;
		if (bash && bash.parts && bash.parts.length) {
			v.parts = bash.parts.map((p) => ({
				command: p.cmd,
				readonly: p.readonly,
			}));
			v.verdict = bash.verdict;
		}
		return v;
	}

	/** FR-32b: mode-select state machine. yolo requires a confirm step and can
	 *  never be the persisted value. Returns {confirm, value} — confirm=true asks
	 *  the UI to show the confirm step; the next call with the confirmed flag
	 *  returns {confirm: false, value: "yolo"}. */
	function modeState(current, next, confirmed) {
		if (next === "yolo") {
			if (!confirmed) return { confirm: true, value: current };
			return { confirm: false, value: "yolo" };
		}
		return { confirm: false, value: next };
	}

	/** ui-density-navigation FR-33..37: prioritized view projection over the
	 *  layer tree — editable user-layer rules first, inherited (floor/workspace)
	 *  rules grouped by tool behind a collapsed disclosure; the filter matches
	 *  tool / action / layer / selector case-insensitively and never mutates
	 *  anything (FR-59). Pending/security counts ride along independent of the
	 *  inherited disclosure (FR-40). */
	function permView(tree, opts) {
		const o = opts || {};
		const filter = String(o.filter || "")
			.trim()
			.toLowerCase();
		const matches = (r, tool) =>
			!filter ||
			tool.toLowerCase().includes(filter) ||
			String(r.action).includes(filter) ||
			r.layers.join(" ").includes(filter) ||
			String(r.pattern).toLowerCase().includes(filter);
		const userRules = [];
		const inheritedByTool = new Map();
		for (const t of (tree && tree.tools) || []) {
			for (const r of t.rules) {
				if (!matches(r, t.tool)) continue;
				const editable = r.layers[0] === "user";
				const row = {
					tool: t.tool,
					pattern: r.pattern,
					action: r.action,
					layers: r.layers,
					editable,
				};
				if (editable) userRules.push(row);
				else {
					if (!inheritedByTool.has(t.tool))
						inheritedByTool.set(t.tool, { tool: t.tool, rules: [] });
					inheritedByTool.get(t.tool).rules.push(row);
				}
			}
		}
		return {
			userRules,
			inheritedGroups: [...inheritedByTool.values()],
			inheritedExpanded: Boolean(o.inheritedExpanded),
			pendingCount: o.pendingCount || 0,
			counts: {
				user: userRules.length,
				inherited: [...inheritedByTool.values()].reduce(
					(n, g) => n + g.rules.length,
					0,
				),
			},
			filter,
		};
	}

	/** FR-37: bounded human explanation for known common selector shapes; the
	 *  raw selector always stays authoritative next to it. */
	function selectorExplain(pattern) {
		const p = String(pattern || "");
		if (p === "(tool default)") return "every call of this tool";
		if (p === "*") return "any selector";
		if (p.startsWith("re:")) return "regex selector";
		if (p.includes("**")) return "path glob selector";
		if (/^[./~\\]/.test(p) || /^[a-z]:/i.test(p)) return "path selector";
		return "";
	}

	const api = {
		buildLayerTree,
		applyRule,
		removeRule,
		ruleEditorMessages,
		redactSelector,
		explainView,
		modeState,
		permView,
		selectorExplain,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.permissionsUx = api;
})();
