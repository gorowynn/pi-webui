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

/** SEC-06: forward-slash-normalized form for pattern matching (Windows
 *  backslash paths must match `/`-separated globs like the shipped .env
 *  sensitive-path patterns). */
function slashNorm(p) {
	return String(p).replace(/\\/g, "/");
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
		const s = isPath ? slashNorm(selector) : selector;
		return isPath ? re.test(s) || re.test(basename(s)) : re.test(selector);
	}
	if (isPath) {
		const s = slashNorm(selector);
		return s === pattern || basename(s) === pattern;
	}
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
	// SEC-04a: a recon tool may receive its args as JSON (grep/find/ls/glob
	// via selectorFor). The JSON blob is NOT one path — extract each real
	// path field and canonicalize/containment-check them independently, so
	// `ls {"path":"/etc/passwd"}` can't be joined to cwd and allowed.
	let jsonPaths = null;
	if (MAYBE_PATH.has(toolName)) {
		jsonPaths = jsonPathFields(selector);
	}
	let canon = selector;
	let effLayers = ls;
	let outsideRoot = false;
	if (isPath) {
		if (jsonPaths && jsonPaths.length) {
			// containment is per FIELD: any field outside the root marks the
			// call outside (read-class caps at ask; write/edit are not recon
			// tools, so the hard-deny branch below is unreachable here)
			for (const f of jsonPaths) {
				const c = canonicalize(f, opts);
				if (opts.workspaceRoot && !isUnderRoot(c, opts.workspaceRoot)) {
					outsideRoot = true;
					effLayers = ls.filter((L) => L.name !== "workspace");
					break;
				}
			}
			// rule matching still sees the raw selector (unchanged contract)
		} else {
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
	}
	// FR-7: sensitive override computed once per resolution (path tools only).
	// SEC-04a: for JSON recon selectors, sensitive matching runs per field.
	const sens = isPath
		? jsonPaths && jsonPaths.length
			? jsonSensitiveFor(jsonPaths, opts)
			: sensitiveFor(selector, canon, opts.sensitivePaths)
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

/** SEC-04a: path-like string fields of a JSON recon selector (grep/find/
 *  ls/glob). Returns an array of field values (path/filePath/dir keys, or
 *  any value that looks like a path) or null when the selector isn't JSON
 *  or carries no path fields. */
function jsonPathFields(selector) {
	const s = String(selector ?? "").trim();
	if (!s.startsWith("{")) return null;
	let obj;
	try {
		obj = JSON.parse(s);
	} catch {
		return null;
	}
	const out = [];
	const isPathish = (v) =>
		/^[./~\\]/.test(v) ||
		v.includes("/") ||
		v.includes("\\") ||
		/^[a-z]:/i.test(v);
	const walk = (v, key) => {
		if (typeof v === "string" && v.trim()) {
			if (key === "path" || key === "filePath" || key === "dir" || isPathish(v))
				out.push(v);
		} else if (Array.isArray(v)) {
			for (const x of v) walk(x, key);
		} else if (v && typeof v === "object") {
			for (const k of Object.keys(v)) walk(v[k], k);
		}
	};
	walk(obj, "");
	return out.length ? out : null;
}

/** SEC-04a: sensitive override for JSON recon selectors — match against
 *  EVERY extracted path field (canon + raw), deny wins over ask. */
function jsonSensitiveFor(jsonPaths, opts) {
	let hit = null;
	for (const f of jsonPaths) {
		const canon = canonicalize(f, opts);
		const r = sensitiveFor(f, canon, opts.sensitivePaths);
		if (r === "deny") return "deny";
		if (r === "ask") hit = "ask";
	}
	return hit;
}

/** Collapse `.` and `..` segments lexically (pure string math, no fs).
 *  SEC-04b: `sub/../../outside/new.txt` joined to cwd must normalize to
 *  `<cwd-parent>/outside/new.txt` BEFORE any containment check — the old
 *  raw join let `..` traversal slip past the string-prefix check. Handles
 *  both `/` and Windows `\` separators; drive letters are preserved. */
function collapseDotSegments(p) {
	const sep = p.includes("\\") ? "\\" : "/";
	const isAbs = p.startsWith("/") || p.startsWith("\\") || /^[a-z]:/i.test(p);
	const parts = p.split(sep);
	const out = [];
	for (const part of parts) {
		if (part === "." || part === "") continue;
		if (part === "..") {
			if (out.length && out[out.length - 1] !== "..") out.pop();
			else if (!isAbs) out.push(part);
			continue;
		}
		out.push(part);
	}
	const prefix = isAbs && p.startsWith(sep) ? sep : "";
	const drive = isAbs && /^[a-z]:/i.test(p) ? out[0] : null;
	const body = (drive ? out.slice(1) : out).join(sep);
	return (drive ? drive + sep : prefix) + body;
}

/** Ancestor prefixes of a path, DEEPEST first (nearest to the full path).
 *  SEC-04c walk order: try the closest existing ancestor first. Keeps the
 *  leading separator so absolute paths stay absolute (realpath needs it). */
function ancestorPrefixes(p) {
	const str = String(p);
	const parts = str.split(/[/\\]+/);
	const out = [];
	let cur = str.startsWith("/") || str.startsWith("\\") ? "/" : "";
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!part) continue;
		cur = cur === "/" ? cur + part : cur ? cur + "/" + part : part;
		out.push(cur);
	}
	return out.reverse();
}

/** Canonicalize a path selector through the injected realpath (FR-6). When
 *  realpath fails (missing target, no realpath injected), non-escaping
 *  relative selectors are joined to the caller's cwd (opts.cwd) so a missing
 *  file INSIDE the root isn't misjudged as outside. SEC-04b: the joined
 *  result collapses `.`/`..` segments. SEC-04c: for a missing target below a
 *  symlink/junction, realpath the NEAREST EXISTING ANCESTOR and append the
 *  missing suffix — the raw join alone let in-workspace links escape the
 *  containment check. `~`, absolute, drive-letter and $-prefixed selectors
 *  stay raw — the safe direction is ask, never a false allow. */
function canonicalize(selector, opts) {
	if (!opts) return selector;
	const s = String(selector);
	try {
		const r = opts.realpath ? opts.realpath(s) : s;
		if (r) return r;
	} catch {
		/* target may not exist yet (e.g. a write to a new file) */
	}
	const joined =
		opts.cwd &&
		!s.startsWith("..") &&
		!/^[a-z]:/i.test(s) &&
		!/^[\\/~]/.test(s) &&
		!s.startsWith("$")
			? opts.cwd.replace(/[\\/]+$/, "") + "/" + s
			: null;
	const target = joined ?? s;
	// SEC-04c: walk up from the target; the deepest existing ancestor's real
	// path + the missing suffix is the canonical form (a symlink's real
	// parent then containment-checks correctly).
	if (opts.realpath) {
		for (const anc of ancestorPrefixes(target)) {
			try {
				const r = opts.realpath(anc);
				if (r) {
					const suffix = target.slice(anc.length).replace(/^[/\\]+/, "");
					return suffix ? collapseDotSegments(r + "/" + suffix) : r;
				}
			} catch {
				/* keep walking up — no existing ancestor here */
			}
		}
	}
	if (joined) return collapseDotSegments(joined);
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
	// SEC-02a refinement: the read-only recon toolkit is allow-ruled by VERB -
	// safe because the compound gate still requires argument-aware READ-ONLY
	// classification, so `sed -i` / `find -delete` / `awk 'system()'` / `env rm`
	// never ride these rules (gate.allow=false - ask in every mode).
	bash: {
		"*": "ask",
		"re:^(cat|head|tail|less|more|grep|egrep|fgrep|wc|uniq|cut|tr|diff|cmp|file|stat|du|df|which|whereis|type|printenv|date|whoami|id|hostname|uname|uptime|sed|awk|find|sort|env|cd)(\\s|$)":
			"allow",
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
		for (const k of Object.keys(high)) {
			const h = high[k];
			const l = out[k];
			// SEC-02a refinement: object tool tables union per key (high key
			// wins) — a user's existing table must not WHOLESALE-shadow the
			// floor's allows/denies (that made every floor improvement invisible
			// to existing users). Scalars and arrays (grants, sensitivePaths)
			// still replace wholesale.
			out[k] =
				h &&
				l &&
				typeof h === "object" &&
				typeof l === "object" &&
				!Array.isArray(h) &&
				!Array.isArray(l)
					? { ...l, ...h }
					: h;
		}
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

/** SEC-01a: strictest action among ALL inherited subrules of a tool
 *  (deny > ask > allow). A workspace scalar may not loosen ANY of them —
 *  comparing it to the wildcard alone let `bash:"ask"` shadow built-in
 *  deny tables. */
function strictestActionFor(effCfg, toolName) {
	const rank = { deny: 3, ask: 2, allow: 1 };
	let best = effCfg["*"] ?? "allow";
	const consider = (a) => {
		if (typeof a === "string" && rank[a] > rank[best]) best = a;
	};
	const rule = effCfg[toolName];
	if (rule && typeof rule === "object") {
		for (const k of Object.keys(rule)) consider(rule[k]);
	} else {
		consider(rule);
	}
	return best;
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

	// SEC-01b: workspace metadata cannot bypass the tightening sweep. grants
	// and nonInteractive are user/floor-only authority — a committed repo
	// file must not inject always-grants or change the headless posture.
	// sensitivePaths merge additively + tighten-only (append ask/deny, drop
	// allow). mode is handled in the mode-resolution block below.
	let wsSensitive = null;
	if (ws) {
		if (ws.grants != null) {
			diagnostics.push({
				layer: "workspace",
				path: "grants",
				message: "workspace may not inject grants — user layer only",
			});
			delete ws.grants;
		}
		if (ws.nonInteractive != null) {
			diagnostics.push({
				layer: "workspace",
				path: "nonInteractive",
				message: "workspace may not set nonInteractive — user layer only",
			});
			delete ws.nonInteractive;
		}
		if (ws.sensitivePaths != null) {
			if (!Array.isArray(ws.sensitivePaths)) {
				diagnostics.push({
					layer: "workspace",
					path: "sensitivePaths",
					message: "workspace sensitivePaths must be an array",
				});
			} else {
				const kept = ws.sensitivePaths.filter((e) => {
					const tighten =
						e &&
						typeof e === "object" &&
						(e.action === "ask" || e.action === "deny");
					if (!tighten)
						diagnostics.push({
							layer: "workspace",
							path: "sensitivePaths",
							message: `workspace sensitivePaths entry ${JSON.stringify(e)} is not a tightening ask/deny — dropped`,
						});
					return tighten;
				});
				if (kept.length) wsSensitive = kept;
			}
			delete ws.sensitivePaths;
		}
	}

	// mode resolution — SEC-14: yolo is session-only state and must NEVER
	// propagate from a persisted layer. A `mode:"yolo"` in any layer only
	// produces the diagnostic above; the effective mode falls back to the
	// inherited non-yolo mode (or default).
	let mode = effUser.mode && effUser.mode !== "yolo" ? effUser.mode : "default";
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
				// SEC-01a: a scalar must not loosen ANY inherited subrule —
				// compare against the strictest inherited action, not just the
				// wildcard (the old check let bash:"ask" shadow built-in denies).
				const strictest = strictestActionFor(effUser, tool);
				if (isLoosening(wsRule, strictest)) {
					diagnostics.push({
						layer: "workspace",
						path: tool,
						message: `'${wsRule}' loosens effective '${strictest}' — workspace may only tighten`,
					});
					delete ws[tool];
				}
			} else if (wsRule && typeof wsRule === "object") {
				for (const p of Object.keys(wsRule)) {
					if (!check(p, wsRule[p])) {
						delete wsRule[p];
						continue;
					}
					// SEC-01a: a per-key allow on a tool with an inherited deny is
					// only safe when the exact key is an inherited allow — a
					// workspace pattern more specific than the deny could shadow
					// it (resolve checks the workspace layer first).
					if (wsRule[p] === "allow") {
						const inherited = effUser[tool];
						const exactAllow =
							inherited &&
							typeof inherited === "object" &&
							inherited[p] === "allow";
						if (strictestActionFor(effUser, tool) === "deny" && !exactAllow) {
							diagnostics.push({
								layer: "workspace",
								path: `${tool}.${p}`,
								message: `'allow' on '${tool}.${p}' could shadow an inherited deny — exact key must match an inherited allow`,
							});
							delete wsRule[p];
						}
					}
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
	// SEC-01c: effective derives from the FILTERED workspace layer (sweep +
	// metadata above), so the display view can never disagree with layers.
	const eff = ws ? mergeTwo(ws, effUser) : effUser;
	const effective = { ...eff, mode };
	// SEC-01b: workspace sensitivePaths merged additively — inherited
	// entries survive, workspace ask/deny entries append (allow already
	// dropped in the filter).
	if (wsSensitive && wsSensitive.length) {
		const inherited = Array.isArray(effective.sensitivePaths)
			? effective.sensitivePaths
			: [];
		effective.sensitivePaths = [...inherited, ...wsSensitive];
	}
	return { layers, diagnostics, effective };
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
		// SEC-02b: a bash command is only auto-approvable when the compound
		// gate allows it — mode-induced allows must not bypass FR-9. (The
		// gate's deny/outside flags also block: gate.allow false means ask.)
		if (ctx.toolName === "bash" && ctx.bashGate && !ctx.bashGate.allow)
			return verdict;
		if (verdict.action === "ask" && verdict.tier === "ordinary-ask") {
			return { ...verdict, action: "allow", tier: "auto-approve" };
		}
		return verdict;
	}
	if (mode === "read-only") {
		if (COORD_TOOLS.has(ctx.toolName)) return verdict;
		// SEC-02b: bash is read-class ONLY when the classifier says readonly
		// AND the per-part gate allows — `find . -delete` or `env rm -rf .`
		// can't ride the name-only classification into an auto-allow.
		const readClass =
			READ_TOOLS.has(ctx.toolName) ||
			(ctx.toolName === "bash" &&
				ctx.bashClassify &&
				ctx.bashClassify.verdict === "readonly" &&
				ctx.bashGate &&
				ctx.bashGate.allow);
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
