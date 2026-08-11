/**
 * policy-engine.js — zero-dep permission policy engine.
 *
 * SDD run `permission-policy` (U6 + modes), chunks C1–C3. The single source of
 * truth for ALL policy resolution: `server.js` (Permissions page, Explain,
 * config writes) and the safeguard extension (live tool_call gate) both load
 * this exact file, so the UI can never show a verdict the gate wouldn't
 * produce. CommonJS only (module.exports) — loads under Node for tests AND
 * under pi's jiti loader inside the extension. No fs access: callers inject
 * readers/realpath (keeps it pure + unit-testable).
 *
 * Resolution model (FR-3 precedence, high → low):
 *   hard-deny → mandatory-ask → remembered-grant → ordinary-ask → allow
 * Rule lookup per layer (highest-priority first: workspace, user, default):
 *   tool-object first non-"*" match wins, then "*", then tool-level string
 *   action, then top-level "*", then the implicit allow fallback.
 * Every verdict carries provenance (FR-2): the matched rule key, the layer it
 * came from, and a human reason.
 */

/** Tools whose selector is ALWAYS a path (FR-7 extends path capability to the
 *  MAYBE_PATH set when the selector looks like a path). */
const ALWAYS_PATH = new Set(["read", "write", "edit"]);
/** Recon tools whose selector may be a path (grep/find/ls/glob). */
const MAYBE_PATH = new Set(["grep", "find", "ls", "glob"]);
/** @deprecated kept for compat — use isPathSelector(). */
const PATH_TOOLS = ALWAYS_PATH;

/**
 * Is this selector path-capable? (C3/FR-7) read/write/edit always; the recon
 * tools only when the selector actually looks like a path (leading ./~/\ or a
 * separator / drive letter) — a bare pattern arg (e.g. grep "src") is not.
 */
function isPathSelector(toolName, selector) {
	if (ALWAYS_PATH.has(toolName)) return true;
	if (!MAYBE_PATH.has(toolName)) return false;
	const s = String(selector ?? "");
	if (!s.trim()) return false;
	return (
		/^[./~\\]/.test(s) ||
		s.includes("/") ||
		s.includes("\\") ||
		/^[a-z]:/i.test(s)
	);
}

/** `toolName\0selector` — the key session-grant registries use. */
function makeKey(toolName, selector) {
	return toolName + "\u0000" + selector;
}

function globToRe(g) {
	const esc = g
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${esc}$`, "i");
}

/**
 * Pattern → selector matching, byte-compatible with the v1 safeguard
 * semantics: "re:" → case-insensitive regex; glob ("*"/"?") → anchored
 * against full path AND basename for path tools (full string otherwise);
 * plain → exact full path or basename for path tools, case-insensitive
 * substring for everything else.
 */
function matchValue(pattern, selector, isPath) {
	if (pattern.startsWith("re:")) {
		try {
			return new RegExp(pattern.slice(3), "i").test(selector);
		} catch {
			return false;
		}
	}
	if (pattern.includes("*") || pattern.includes("?")) {
		const re = globToRe(pattern);
		return isPath
			? re.test(selector) || re.test(basename(selector))
			: re.test(selector);
	}
	if (isPath) return selector === pattern || basename(selector) === pattern;
	return selector.toLowerCase().includes(pattern.toLowerCase());
}

function basename(p) {
	const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? p;
}

/**
 * Build the verdict for a resolved action (FR-2/FR-3 tier assignment, FR-7
 * sensitive override). `opts`:
 *   - sensitive(key, ctx): "ask" | "deny" | null — sensitive-path override
 *     (C3). Deny beats everything; ask forces mandatory-ask (never grantable).
 *   - mandatoryAsk(key): legacy generic hook (C1) — same tier effect.
 *   - hasGrant(key): session/always grant registry (remembered-grant tier).
 */
function buildVerdict(action, matchedRule, layer, toolName, selector, opts) {
	const key = makeKey(toolName, selector);
	const sens = opts.sensitive
		? opts.sensitive(key, { toolName, selector })
		: null;
	let finalAction = action;
	let tier;
	if (action === "deny" || sens === "deny") {
		if (action !== "deny") {
			finalAction = "deny";
			matchedRule = "sensitivePaths";
			layer = "user";
		}
		tier = "hard-deny";
	} else if (action === "ask" || sens === "ask") {
		if (action !== "ask") {
			finalAction = "ask";
			matchedRule = "sensitivePaths";
			layer = "user";
		}
		if (sens === "ask" || (opts.mandatoryAsk && opts.mandatoryAsk(key))) {
			tier = "mandatory-ask";
		} else if (opts.hasGrant && opts.hasGrant(key)) {
			finalAction = "allow";
			tier = "grant";
		} else {
			// FR-6 containment cap: outside-root access may never be an
			// ordinary ask — auto-approve can't silently re-allow it
			tier = opts.outsideRoot ? "outside-workspace" : "ordinary-ask";
		}
	} else {
		// FR-6: a rule-allow for read-class access OUTSIDE the workspace root
		// caps at ask — a broad `read: {"*": "allow"}` can't silently grant
		// outside reads. (write/edit outside root hard-deny earlier.)
		if (opts.outsideRoot) {
			finalAction = "ask";
			tier = "outside-workspace";
		} else {
			tier = "allow";
		}
	}
	const out = {
		action: finalAction,
		tier,
		matchedRule,
		layer,
		reason: `${toolName} → ${matchedRule} (${layer === null ? "implicit" : layer} layer)`,
	};
	if (opts.outsideRoot) {
		out.outsideRoot = true;
		out.reason += " — outside workspace root";
	}
	return out;
}

/**
 * Resolve a tool call to a verdict.
 *
 * @param {string} toolName
 * @param {string} selector — the value rules match against (command string /
 *   path / JSON of args); see safeguard.ts selectorFor.
 * @param {Array<{name: string, cfg: object}>|object} layers — highest priority
 *   first. A bare config object is treated as a single "user" layer (v1 compat
 *   for the current safeguard call site).
 * @param {object} opts
 *   - hasGrant(key), mandatoryAsk(key): grant/tier hooks (see buildVerdict).
 *   - sensitivePaths: array of {pattern, action} — sensitive override (FR-7).
 *   - realpath(path): injected fs.realpathSync — canonicalization (FR-6).
 *   - workspaceRoot: canonical project root — containment (FR-6): write/edit
 *     escaping it hard-deny; read-class tools escaping it lose the workspace
 *     layer (it may not grant outside its root).
 */
function resolve(toolName, selector, layers, opts = {}) {
	const ls = Array.isArray(layers) ? layers : [{ name: "user", cfg: layers }];
	const isPath = isPathSelector(toolName, selector);
	let canon = selector;
	let effLayers = ls;
	let outsideRoot = false;
	if (isPath) {
		canon = canonicalize(selector, opts);
		if (opts.workspaceRoot && !isUnderRoot(canon, opts.workspaceRoot)) {
			if (toolName === "write" || toolName === "edit") {
				return {
					action: "deny",
					tier: "hard-deny",
					matchedRule: "workspace-root",
					layer: "default",
					outsideRoot: true,
					reason: `${toolName} target '${selector}' escapes the workspace root`,
				};
			}
			// read-class outside the root: the workspace layer may not grant,
			// and the verdict caps at ask (buildVerdict outsideRoot)
			outsideRoot = true;
			effLayers = ls.filter((L) => L.name !== "workspace");
		}
	}
	// FR-7: sensitive override computed once per resolution (path tools only)
	const sens = isPath
		? sensitiveFor(selector, canon, opts.sensitivePaths)
		: null;
	const o2 = sens
		? { ...opts, sensitive: () => sens, outsideRoot }
		: { ...opts, outsideRoot };
	for (const L of effLayers) {
		const rule = L.cfg && L.cfg[toolName];
		if (rule && typeof rule === "object") {
			for (const key of Object.keys(rule)) {
				if (key === "*") continue;
				if (matchValue(key, canon, isPath))
					return buildVerdict(
						rule[key],
						`${toolName}.${key}`,
						L.name,
						toolName,
						selector,
						o2,
					);
			}
			if ("*" in rule)
				return buildVerdict(
					rule["*"],
					`${toolName}.*`,
					L.name,
					toolName,
					selector,
					o2,
				);
		} else if (typeof rule === "string") {
			// "block" is only valid for nonInteractive; tools never use it —
			// narrow to a real Action like v1 did.
			return buildVerdict(
				rule === "block" ? "ask" : rule,
				toolName,
				L.name,
				toolName,
				selector,
				o2,
			);
		}
	}
	// top-level "*": the highest-priority layer that sets it shadows the rest
	for (const L of effLayers) {
		if (L.cfg && L.cfg["*"]) {
			return buildVerdict(L.cfg["*"], "*", L.name, toolName, selector, o2);
		}
	}
	// implicit fail-open floor (v1: `cfg["*"] ?? "allow"`) — routed through
	// buildVerdict so the FR-7 sensitive override still applies to it
	return buildVerdict("allow", "default:*", "default", toolName, selector, o2);
}

/** Canonicalize a path selector through the injected realpath (FR-6). When
 *  realpath fails (missing target, no realpath injected), non-escaping
 *  relative selectors are joined to the caller's cwd (opts.cwd) so a missing
 *  file INSIDE the root isn't misjudged as outside. `..`, `~`, absolute,
 *  drive-letter and $-prefixed selectors stay raw — the safe direction is
 *  ask, never a false allow. */
function canonicalize(selector, opts) {
	if (!opts) return selector;
	const s = String(selector);
	try {
		const r = opts.realpath ? opts.realpath(s) : s;
		if (r) return r;
	} catch {
		/* target may not exist yet (e.g. a write to a new file) */
	}
	if (
		opts.cwd &&
		!s.startsWith("..") &&
		!/^[a-z]:/i.test(s) &&
		!/^[\\/~]/.test(s) &&
		!s.startsWith("$")
	)
		return opts.cwd.replace(/[\\/]+$/, "") + "/" + s;
	return s;
}

/** Case-tolerant (Windows) containment check. No root configured → no claim. */
function isUnderRoot(canon, root) {
	if (!root) return true;
	const a = String(canon);
	const b = String(root);
	const cmp = (s) =>
		/^[a-z]:/i.test(s) || s.includes("\\") ? s.toLowerCase() : s;
	const c = cmp(a);
	const d = cmp(b).replace(/[\\/]+$/, "");
	if (c === d) return true;
	return c.startsWith(d + "/") || c.startsWith(d + "\\");
}

/**
 * FR-7 sensitive-path override: "ask" | "deny" | null. Deny wins over ask.
 * Matched against the canonical path AND the original selector (glob + basename
 * semantics via matchValue).
 */
function sensitiveFor(selector, canon, sensitivePaths) {
	if (!Array.isArray(sensitivePaths) || !sensitivePaths.length) return null;
	let hit = null;
	for (const e of sensitivePaths) {
		if (!e || typeof e.pattern !== "string") continue;
		if (e.action !== "ask" && e.action !== "deny") continue;
		if (
			matchValue(e.pattern, canon, true) ||
			matchValue(e.pattern, selector, true)
		) {
			if (e.action === "deny") return "deny";
			hit = "ask";
		}
	}
	return hit;
}

module.exports = { PATH_TOOLS, makeKey, globToRe, matchValue, resolve };

// ---------------------------------------------------------------------------
// C2 — layered config: merge / tighten-only / migration / validation (FR-4,
// FR-5, FR-37). Yolo is deliberately NOT a valid persisted mode (FR-12); it
// is a session-only state held by the extension.
// ---------------------------------------------------------------------------

const MODES = ["default", "auto-approve", "read-only"];
const ACTIONS = ["allow", "ask", "deny"];
const META_KEYS = new Set([
	"version",
	"revision",
	"mode",
	"nonInteractive",
	"sensitivePaths",
	"grants", // exact-selector always-grants (tool\0selector), v2 C7 refinement
]);

/**
 * The shipped default layer (v2). THE single copy — the safeguard extension
 * AND the server (Permissions page / Explain) both load it from here, so the
 * displayed floor always matches the gate's floor. Trust ladder: allow
 * read-only inspection + agent coordination; sensitive paths are
 * mandatory-ask (never grantable); hard-deny private keys and catastrophic
 * rm. Every bash ALLOW is an anchored regex. FR-10: `echo` and mutating git
 * verbs are NOT auto-allowed; the git recon allowlist is exactly
 * status|log|diff|show|blame|ls-files|branch --show-current|remote -v.
 */
const DEFAULT_CONFIG = {
	version: 2,
	mode: "default",
	nonInteractive: "allow",
	grants: [], // exact-selector always-grants ("tool\u0000selector") — v2 C7

	// --- sensitive paths (FR-7): mandatory-ask or deny on EVERY path tool ---
	sensitivePaths: [
		{ pattern: "**/.env*", action: "ask" },
		{ pattern: "**/*.pem", action: "ask" },
		{ pattern: "**/*.key", action: "ask" },
		{ pattern: "**/*.pfx", action: "ask" },
		{ pattern: "**/.npmrc", action: "ask" },
		{ pattern: "**/.pypirc", action: "ask" },
		{ pattern: "**/*credentials*", action: "ask" },
		{ pattern: "**/id_rsa", action: "deny" },
		{ pattern: "**/id_ed25519", action: "deny" },
		{ pattern: "**/id_ecdsa", action: "deny" },
	],

	"*": "ask", // fallback: fail-safe

	// --- agent coordination: no side effects ---
	ask_user_question: "allow",
	todo: "allow",

	// --- read-only recon: inspection only, no mutation ---
	grep: "allow",
	find: "allow",
	ls: "allow",
	glob: "allow",

	// read: allow; sensitivePaths gates secrets above.
	read: { "*": "allow" },

	// --- mutation: always ask ---
	edit: "ask",
	write: "ask",

	// bash: allow only anchored read-only recon (the classifier additionally
	// requires every compound subcommand read-only + allow-ruled, FR-9).
	bash: {
		"*": "ask",
		"re:^git (status|log|diff|show|blame|ls-files)(\\s|$)": "allow",
		"re:^git branch --show-current(\\s|$)": "allow",
		"re:^git remote -v(\\s|$)": "allow",
		"re:^pwd(\\s|$)": "allow",
		"re:^ls(\\s|$)": "allow",
		"re:^(node|npm|pnpm|yarn|python|python3|pip|go|rustc|cargo|git) (--version|-v|--help)(\\s|$)":
			"allow",
		"re:\\brm\\s+-[rRfF]*[rR][rRfF]*\\s+(/|~|/home|/usr|/etc|/var|/boot)(\\s|/|$)":
			"deny",
	},

	// subagent delegation: allow read-only tiers, ask the bash-capable ones.
	subagent: {
		"*": "allow",
		implementer: "ask",
		debugger: "ask",
	},
};

module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;

/**
 * Schema validation shared by the extension loader, the PUT endpoint, and the
 * rule editor (FR-5/FR-37). Pure — no fs. Returns {ok, errors:[{path,message}]}.
 * Unknown top-level keys can't be distinguished from custom tool rules, so the
 * check is per-value: every non-meta key must be a valid action string or a
 * pattern object whose values are actions and whose "re:" patterns compile.
 */
function validateConfig(cfg) {
	const errors = [];
	if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
		return {
			ok: false,
			errors: [{ path: "", message: "config must be an object" }],
		};
	}
	if (cfg.version != null && cfg.version !== 1 && cfg.version !== 2) {
		errors.push({ path: "version", message: "version must be 1 or 2" });
	}
	if (cfg.mode != null && !MODES.includes(cfg.mode)) {
		errors.push({
			path: "mode",
			message:
				cfg.mode === "yolo"
					? "yolo cannot be persisted — engage it per session"
					: `invalid mode '${cfg.mode}'`,
		});
	}
	if (
		cfg.nonInteractive != null &&
		!["allow", "block"].includes(cfg.nonInteractive)
	) {
		errors.push({
			path: "nonInteractive",
			message: "must be 'allow' or 'block'",
		});
	}
	for (const k of Object.keys(cfg)) {
		if (META_KEYS.has(k) || k === "*") continue;
		const v = cfg[k];
		if (typeof v === "string") {
			if (!ACTIONS.includes(v))
				errors.push({ path: k, message: `invalid action '${v}'` });
		} else if (v && typeof v === "object" && !Array.isArray(v)) {
			for (const p of Object.keys(v)) {
				const a = v[p];
				if (!ACTIONS.includes(a)) {
					errors.push({ path: `${k}.${p}`, message: `invalid action '${a}'` });
				}
				if (p.startsWith("re:")) {
					try {
						new RegExp(p.slice(3));
					} catch {
						errors.push({ path: `${k}.${p}`, message: "invalid regex" });
					}
				}
			}
		} else {
			errors.push({
				path: k,
				message: "tool rule must be an action string or pattern object",
			});
		}
	}
	if (cfg.sensitivePaths != null) {
		if (!Array.isArray(cfg.sensitivePaths)) {
			errors.push({ path: "sensitivePaths", message: "must be an array" });
		} else {
			cfg.sensitivePaths.forEach((e, i) => {
				if (
					!e ||
					typeof e !== "object" ||
					typeof e.pattern !== "string" ||
					!ACTIONS.includes(e.action)
				) {
					errors.push({
						path: `sensitivePaths[${i}]`,
						message:
							"entry must be {pattern, action} with action allow|ask|deny",
					});
				}
			});
		}
	}
	if (cfg.grants != null) {
		if (
			!Array.isArray(cfg.grants) ||
			cfg.grants.some((g) => typeof g !== "string" || !g.includes("\u0000"))
		) {
			errors.push({
				path: "grants",
				message: "must be an array of 'tool\u0000selector' strings",
			});
		}
	}
	return { ok: errors.length === 0, errors };
}

/**
 * v1 → v2 migration for WRITE paths (FR-5): a file without `version` is a v1
 * config; normalize it to v2 with mode "default" and revision 0. Read paths
 * don't need this — resolve() treats a missing mode as default anyway.
 */
function normalizeForWrite(cfg) {
	if (!cfg || typeof cfg !== "object")
		return { version: 2, revision: 0, mode: "default" };
	if (cfg.version === 2) return cfg;
	return { version: 2, revision: 0, mode: "default", ...cfg };
}

/**
 * Plain two-layer merge with v1 loadConfig parity: the high layer's key
 * REPLACES the low layer's wholesale (no pattern-table merging) — including
 * "*" and "nonInteractive". Returns the merged config.
 */
function mergeTwo(high, low) {
	const out = { ...(low && typeof low === "object" ? low : {}) };
	if (high && typeof high === "object") {
		for (const k of Object.keys(high)) out[k] = high[k];
	}
	return out;
}

/** true when a workspace action loosens the effective action (FR-4). */
function isLoosening(wsAction, effAction) {
	if (wsAction === "allow" && effAction !== "allow") return true;
	if (wsAction === "ask" && effAction === "deny") return true;
	return false;
}

/** Effective action for a tool+pattern-key position (workspace tighten check). */
function effActionFor(effCfg, toolName, key) {
	const rule = effCfg[toolName];
	if (rule && typeof rule === "object") {
		if (key in rule) return rule[key];
		if ("*" in rule) return rule["*"];
	}
	if (typeof rule === "string") return rule;
	return effCfg["*"] ?? "allow";
}

/**
 * Merge the three layers into C1's layers array + diagnostics (FR-4).
 *   - workspace rules may only tighten (never allow where eff is ask/deny,
 *     never ask where eff is deny); loosening rules are dropped with a
 *     diagnostic, the rest of the layer still applies.
 *   - workspace mode may only force "read-only"; anything else is rejected.
 *   - mode:"yolo" in ANY layer is rejected (FR-12).
 * Returns { layers, diagnostics, effective } — effective = merged config
 * (workspace over user over default) for display.
 */
function mergeLayers(defaultCfg, userCfg, workspaceCfg) {
	const diagnostics = [];
	// clone the workspace layer — tighten-only drops rules, and mutating the
	// caller's parsed object would be a side effect (FR-1: pure functions).
	const ws =
		workspaceCfg && typeof workspaceCfg === "object"
			? { ...workspaceCfg }
			: null;
	for (const k of Object.keys(ws ?? {}))
		if (ws[k] && typeof ws[k] === "object" && !Array.isArray(ws[k]))
			ws[k] = { ...ws[k] };
	const effUser = mergeTwo(userCfg, defaultCfg);
	const eff = ws ? mergeTwo(ws, effUser) : effUser;

	// mode resolution
	let mode = effUser.mode ?? "default";
	for (const [layer, cfg] of [
		["workspace", workspaceCfg],
		["user", userCfg],
		["default", defaultCfg],
	]) {
		if (cfg && cfg.mode === "yolo") {
			diagnostics.push({
				layer,
				path: "mode",
				message: "yolo cannot be persisted — engage it per session",
			});
		}
	}
	if (workspaceCfg && workspaceCfg.mode && workspaceCfg.mode !== "read-only") {
		diagnostics.push({
			layer: "workspace",
			path: "mode",
			message: `workspace mode '${workspaceCfg.mode}' may only force read-only`,
		});
	}
	if (workspaceCfg && workspaceCfg.mode === "read-only") mode = "read-only";

	// workspace tighten-only sweep
	if (ws) {
		for (const tool of Object.keys(ws)) {
			if (tool === "*" || META_KEYS.has(tool)) continue;
			const wsRule = ws[tool];
			const check = (key, wsAction) => {
				const effAction = effActionFor(effUser, tool, key);
				if (isLoosening(wsAction, effAction)) {
					diagnostics.push({
						layer: "workspace",
						path: `${tool}.${key}`,
						message: `'${wsAction}' loosens effective '${effAction}' — workspace may only tighten`,
					});
					return false;
				}
				return true;
			};
			if (typeof wsRule === "string") {
				if (!check(tool, wsRule)) delete ws[tool];
			} else if (wsRule && typeof wsRule === "object") {
				for (const p of Object.keys(wsRule)) {
					if (!check(p, wsRule[p])) delete wsRule[p];
				}
			}
		}
		if (ws["*"] != null && isLoosening(ws["*"], effUser["*"] ?? "allow")) {
			diagnostics.push({
				layer: "workspace",
				path: "*",
				message: `workspace '*' '${ws["*"]}' loosens effective '${effUser["*"] ?? "allow"}'`,
			});
			delete ws["*"];
		}
	}

	const layers = [{ name: "default", cfg: defaultCfg }];
	if (userCfg && typeof userCfg === "object")
		layers.unshift({ name: "user", cfg: userCfg });
	if (ws) layers.unshift({ name: "workspace", cfg: ws });
	return { layers, diagnostics, effective: { ...eff, mode } };
}

// C2 additions attached after their declarations (the C1 exports above are
// separate and stay TDZ-free).
module.exports.MODES = MODES;
module.exports.validateConfig = validateConfig;
module.exports.mergeTwo = mergeTwo;
module.exports.mergeLayers = mergeLayers;
module.exports.normalizeForWrite = normalizeForWrite;
// C3 additions
module.exports.isPathSelector = isPathSelector;
module.exports.canonicalize = canonicalize;
module.exports.isUnderRoot = isUnderRoot;
module.exports.sensitiveFor = sensitiveFor;

// ---------------------------------------------------------------------------
// C5 — permission modes (FR-12..FR-16). The mode transforms the RESOLVED
// verdict; it is applied by the gate after resolve() and before the prompt.
// "yolo" is never a config value — callers pass it for session-scoped state.
// ---------------------------------------------------------------------------

/** Recon/read-only tools — allowed by read-only mode (FR-13). */
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "glob"]);
/**
 * Coordination tools — exempt from read-only mode (FR-16): they have no side
 * effects, and blocking them would break agent↔user coordination. Yolo never
 * suppresses ask_user_question either (its rule is allow; the ask bridge's
 * human-in-the-loop is not a permission grant).
 */
const COORD_TOOLS = new Set(["ask_user_question", "todo"]);

/**
 * FR-13 mode transform:
 *   default       → identity
 *   auto-approve  → ordinary-ask → allow; mandatory-ask and hard-deny stay
 *   read-only     → read-class actions allow (hard-deny rules survive); every
 *                   other action (incl. mandatory-ask) → deny, no prompt;
 *                   coordination tools exempt
 *   yolo          → every action allow (session-scoped, never persisted)
 *
 * ctx: { toolName, bashClassify } — bashClassify is the classifier result for
 * bash selectors (a readonly verdict makes bash read-class).
 */
function applyMode(verdict, mode, ctx = {}) {
	if (!mode || mode === "default") return verdict;
	if (mode === "yolo") return { ...verdict, action: "allow", tier: "yolo" };
	if (mode === "auto-approve") {
		if (verdict.action === "ask" && verdict.tier === "ordinary-ask") {
			return { ...verdict, action: "allow", tier: "auto-approve" };
		}
		return verdict;
	}
	if (mode === "read-only") {
		if (COORD_TOOLS.has(ctx.toolName)) return verdict;
		const readClass =
			READ_TOOLS.has(ctx.toolName) ||
			(ctx.bashClassify && ctx.bashClassify.verdict === "readonly");
		if (readClass) {
			// FR-6: outside-workspace stays ask even in read-only mode — the
			// containment cap beats the mode's read-class auto-allow
			return verdict.action === "deny" || verdict.tier === "outside-workspace"
				? verdict
				: { ...verdict, action: "allow", tier: "read-only" };
		}
		return {
			...verdict,
			action: "deny",
			tier: "read-only-deny",
			reason: `read-only mode: ${ctx.toolName} is not read-class`,
		};
	}
	return verdict;
}

// C5 additions attached after their declarations (same pattern as C2).
module.exports.applyMode = applyMode;
module.exports.READ_TOOLS = READ_TOOLS;
module.exports.COORD_TOOLS = COORD_TOOLS;
