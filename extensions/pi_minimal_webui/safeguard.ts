/**
 * Safeguard Extension
 *
 * Config-driven allow / ask / deny gate for EVERY tool call (bash, read, write,
 * edit, custom tools, …). Asks before running, with an "allow for this session"
 * and "allow always (saved to config)" choice so you don't get re-prompted.
 *
 * Config: ~/.pi/agent/safeguard.json  (auto-created on first run, re-read every
 * call so manual edits and "allow always" apply live).
 *
 * Format — per-tool rules, "*" = wildcard:
 *
 *   // The solid default (shipped in DEFAULT_CONFIG, written on first run):
 *   {
 *     "*": "ask",                 // fallback: fail-safe
 *     "nonInteractive": "allow",  // headless (print/json): "allow" | "block"
 *     "ask_user_question": "allow",  // coordination tools — no side effects
 *     "todo": "allow",
 *     "grep": "allow", "find": "allow", "ls": "allow", "glob": "allow",  // recon
 *     "read": {                   // per-target rules; first non-* match wins, then "*"
 *       "*": "allow",
 *       ".env*": "ask",  "*.pem": "ask",  "*.key": "ask",  // secrets
 *       "*credentials*": "ask",  ".npmrc": "ask",
 *       "id_rsa": "deny",  "id_ed25519": "deny"          // private keys
 *     },
 *     "edit": "ask",  "write": "ask",                          // mutation
 *     "bash": {
 *       "*": "ask",
 *       "re:^git (status|log|diff|show|blame)(\\s|$)": "allow",  // recon
 *       "re:^pwd(\\s|$)": "allow",  "re:^ls(\\s|$)": "allow",
 *       "re:\\brm\\s+-[rRfF]*[rR][rRfF]*\\s+(/|~|/usr)(\\s|/|$)": "deny"  // catastrophic
 *     },
 *     "subagent": { "*": "allow", "implementer": "ask", "debugger": "ask" }
 *   }
 *
 * Pattern matching (what the selector is + how a pattern matches it):
 *   - bash   → selector = command string.
 *              plain pattern → case-insensitive substring; "re:<regex>" → regex.
 *   - path tools (read/write/edit) → selector = path.
 *              glob ("*","?", anchored) tested against full path AND basename;
 *              "re:<regex>" → regex; plain → exact full path or basename.
 *   - other  → selector = JSON.stringify(input).
 *              glob anchored; plain → substring.
 *
 * Resolution order: tool object (first non-"*" match → "*") → tool-level action
 * (string) → top-level "*" → "allow". deny always wins over a session allow.
 *
 * Commands: /safeguard (status) · /safeguard reset (clear session allows)
 */
// ponytail: this extension ships minimal-dep (no @types/node, no node_modules
// resolution). Sibling files (subagent.ts, todo.ts, discipline.ts) use the
// same pattern — @ts-expect-error on node: imports + local minimal types for
// the pi surface. jiti strips types at load; runtime resolves the real modules.
// @ts-expect-error no @types/node in this minimal-dep extension; built-ins at runtime.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error no @types/node in this minimal-dep extension; built-ins at runtime.
import { join } from "node:path";
// @ts-expect-error no @types/node in this minimal-dep extension; built-ins at runtime.
import { homedir } from "node:os";

// Local minimal types for the pi extension surface (jiti strips these; the real
// ExtensionAPI is provided by the host at load). Mirrors the sibling convention.
// ponytail: agent dir is ~/.pi/agent on all platforms (matches subagent.ts).
function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}
interface ToolCallEvent {
	toolName: string;
	input?: Record<string, unknown>;
}
interface CommandContext {
	hasUI: boolean;
	ui: {
		notify(msg: string, level: "info" | "warning"): void;
		select(
			msg: string,
			options: string[],
		): Promise<
			string | { label?: string; oldFull?: string; newFull?: string } | null
		>;
	};
}
interface SessionContext extends CommandContext {}
interface ToolCallContext extends CommandContext {}
interface ExtensionAPI {
	on(
		event: "session_start",
		fn: (event: unknown, ctx: SessionContext) => void,
	): void;
	on(
		event: "tool_call",
		fn: (event: ToolCallEvent, ctx: ToolCallContext) => unknown,
	): void;
	on(event: "session_shutdown", fn: () => void): void;
	registerCommand(
		name: string,
		def: {
			description: string;
			handler: (args: string, ctx: CommandContext) => void;
		},
	): void;
}

type Action = "allow" | "ask" | "deny";
type Rule = Action | { [pattern: string]: Action };
type Config = {
	"*"?: Action;
	nonInteractive?: "allow" | "block";
	[tool: string]: Rule | "allow" | "block" | undefined;
};

const CONFIG_PATH = join(getAgentDir(), "safeguard.json");
const PATH_TOOLS = new Set(["read", "write", "edit"]);

// The solid default. Written to ~/.pi/agent/safeguard.json on first run and
// used as the FLOOR by loadConfig (a user's config overlays tool-by-tool, so
// any tool they didn't list keeps these rules). Trust ladder: allow read-only
// inspection + agent coordination; ask on mutation / arbitrary exec / secrets;
// hard-deny private keys and catastrophic rm. Every bash ALLOW is an anchored
// regex (^...(\s|$)) — never a bare substring, which would let "ls" match
// "false" / "curls". ponytail: deny patterns are best-effort (a determined
// agent can obfuscate); the prompt is the real gate, deny just fails closed
// on the obvious catastrophes so a reflexive "allow" click can't reach them.
const DEFAULT_CONFIG: Config = {
	"*": "ask",
	nonInteractive: "allow",

	// --- agent coordination: no side effects ---
	ask_user_question: "allow",
	todo: "allow",

	// --- read-only recon: inspection only, no mutation ---
	grep: "allow",
	find: "allow",
	ls: "allow",
	glob: "allow",

	// read: allow, but gate secrets (ask) and private keys (deny). glob/regex
	// tested against full path AND basename; plain against basename.
	read: {
		"*": "allow",
		".env*": "ask", // .env, .env.local, .env.production, .envrc (direnv)
		"*.pem": "ask",
		"*.key": "ask",
		"*.pfx": "ask",
		".npmrc": "ask", // may contain auth tokens
		".pypirc": "ask",
		"*credentials*": "ask", // credentials.json, .aws/credentials, etc.
		id_rsa: "deny", // SSH private keys — almost never wanted in-context
		id_ed25519: "deny",
		id_ecdsa: "deny",
	},

	// --- mutation: always ask ---
	edit: "ask",
	write: "ask",

	// bash: allow common read-only recon (anchored regex only!), deny
	// catastrophic rm, ask on everything else (executes arbitrary code).
	bash: {
		"*": "ask",
		// git recon — the highest-frequency safe-repetition case
		"re:^git (status|log|diff|show|blame|branch|remote|ls-files)(\\s|$)":
			"allow",
		"re:^pwd(\\s|$)": "allow",
		"re:^ls(\\s|$)": "allow",
		"re:^echo ": "allow",
		// version / help probes
		"re:^(node|npm|pnpm|yarn|python|python3|pip|go|rustc|cargo|git) (--version|-v|--help)(\\s|$)":
			"allow",
		// catastrophic irreversible deletes — fail closed
		"re:\\brm\\s+-[rRfF]*[rR][rRfF]*\\s+(/|~|/home|/usr|/etc|/var|/boot)(\\s|/|$)":
			"deny",
	},

	// subagent delegation: allow read-only tiers, ask the bash-capable ones.
	// Selector = agent name (single) or parallel/chain(...) — see selectorFor.
	// Two-layer model: this gates the delegation; the delegate's --tools
	// allowlist gates what it can do.
	subagent: {
		"*": "allow", // scout, summarizer, planner, reviewer (read-only)
		implementer: "ask", // bash-capable
		debugger: "ask", // bash-capable
	},
};

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow for this session";
const ALLOW_ALWAYS = "Allow always (save to config)";
const DENY = "Deny";

function loadConfig(): Config {
	try {
		if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Config;
		const cfg: Config = { ...DEFAULT_CONFIG };
		if (
			parsed["*"] === "allow" ||
			parsed["*"] === "deny" ||
			parsed["*"] === "ask"
		)
			cfg["*"] = parsed["*"];
		cfg.nonInteractive = parsed.nonInteractive === "block" ? "block" : "allow";
		for (const k of Object.keys(parsed)) {
			if (k === "*" || k === "nonInteractive") continue;
			const v = parsed[k];
			if (typeof v === "string" || (v && typeof v === "object"))
				cfg[k] = v as Rule;
		}
		return cfg;
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function saveConfig(cfg: Config): void {
	try {
		writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
	} catch {
		/* best-effort */
	}
}

function basename(p: string): string {
	const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? p;
}

function globToRe(g: string): RegExp {
	const esc = g
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*")
		.replace(/\?/g, ".");
	return new RegExp(`^${esc}$`, "i");
}

function matchValue(
	pattern: string,
	selector: string,
	isPath: boolean,
): boolean {
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
	// ponytail: plain pattern — path tools match exact/basename (so "src" won't
	// hit "src-todo"); everything else is a case-insensitive substring (ergonomic
	// for bash commands and harmless against JSON selectors).
	if (isPath) return selector === pattern || basename(selector) === pattern;
	return selector.toLowerCase().includes(pattern.toLowerCase());
}

function resolve(toolName: string, selector: string, cfg: Config): Action {
	const rule = cfg[toolName];
	const isPath = PATH_TOOLS.has(toolName);
	if (rule && typeof rule === "object") {
		for (const key of Object.keys(rule)) {
			if (key === "*") continue;
			if (matchValue(key, selector, isPath))
				return (rule as Record<string, Action>)[key];
		}
		if ("*" in rule) return (rule as Record<string, Action>)["*"];
	} else if (typeof rule === "string") {
		// ponytail: index sig admits "block" (for nonInteractive); tools never use
		// it, but narrow so resolve always returns a real Action.
		return rule === "block" ? "ask" : rule;
	}
	return cfg["*"] ?? "allow";
}

function selectorFor(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash") return String(input.command ?? "");
	if (PATH_TOOLS.has(toolName))
		return String(input.path ?? input.filePath ?? "");
	// subagent: selector = the agent name (single mode) so per-target rules like
	// `"subagent": { "implementer": "ask", "*": "allow" }` work. parallel/chain
	// span multiple agents — key those by the mode label. This gates the
	// *delegation* itself; the spawned subprocess's internal tool calls are gated
	// by its own --tools allowlist (see subagent.ts TIERS) — that allowlist is the
	// capability wall, since the subprocess runs headless (hasUI=false) and thus
	// auto-allows under nonInteractive. Two layers: parent decides IF, allowlist
	// decides WHAT.
	if (toolName === "subagent") {
		// single → agent name; parallel/chain → "<mode>(agent1,agent2,...)" so
		// allow-always and per-agent policy key meaningfully (e.g. a rule keyed
		// "parallel(implementer,scout)" matches that exact combo). Distinct agents
		// only — order-independent. This is Option B (per-delegation coarse gate):
		// the parent asks before spawning a bash-capable delegate; per-command IPC
		// gating inside the subprocess is the Option A open work (see plans.md).
		const a = input.agent;
		if (typeof a === "string" && a) return a;
		const list = (input.tasks ?? input.chain) as
			| { agent?: unknown }[]
			| undefined;
		if (Array.isArray(list)) {
			const mode = Array.isArray(input.tasks) ? "parallel" : "chain";
			const agents = [
				...new Set(
					list
						.map((t) => (typeof t?.agent === "string" ? t.agent : ""))
						.filter(Boolean),
				),
			];
			return agents.length ? `${mode}(${agents.join(",")})` : mode;
		}
		return "";
	}
	try {
		return JSON.stringify(input);
	} catch {
		return "";
	}
}

function saveAllowAlways(
	toolName: string,
	selector: string,
	cfg: Config,
): void {
	const current = cfg[toolName];
	let rule: { [pattern: string]: Action };
	if (current && typeof current === "object") {
		rule = { ...(current as Record<string, Action>) };
	} else {
		const fallback: Action =
			typeof current === "string"
				? current === "block"
					? "ask"
					: current
				: (cfg["*"] ?? "ask");
		rule = { "*": fallback };
	}
	rule[selector] = "allow";
	cfg[toolName] = rule;
	saveConfig(cfg);
}

export default function (pi: ExtensionAPI) {
	// ponytail: module-level map dies with the extension instance; pi reloads the
	// instance on /new, /resume, /fork, so this naturally scopes to one session.
	const sessionAllow = new Set<string>();

	pi.on("session_start", async (_event, ctx) => {
		if (!existsSync(CONFIG_PATH)) {
			saveConfig({ ...DEFAULT_CONFIG });
			if (ctx.hasUI) {
				ctx.ui.notify(`Safeguard active. Edit rules: ${CONFIG_PATH}`, "info");
			}
		}
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx) => {
		const input = (event.input ?? {}) as Record<string, unknown>;
		const selector = selectorFor(event.toolName, input);
		// ponytail: empty selector (e.g. empty bash command) → nothing to gate
		if (!selector.trim()) return;

		const cfg = loadConfig(); // re-read so manual edits + "allow always" apply live
		const key = `${event.toolName}\u0000${selector}`;
		const action = resolve(event.toolName, selector, cfg);

		// 1. deny always wins (even over a session allow)
		if (action === "deny") {
			if (ctx.hasUI)
				ctx.ui.notify(
					`🚫 Blocked (deny): ${event.toolName} ${selector.slice(0, 120)}`,
					"warning",
				);
			return {
				block: true,
				reason: `Safeguard: deny policy for ${event.toolName}`,
			};
		}

		// 2. explicit allow, or approved this session
		if (action === "allow" || sessionAllow.has(key)) return;

		// 3. action === "ask" — need a human. Prompt in every UI-backed mode
		// (TUI + RPC/webui). Only print/json (ctx.hasUI === false) fall back to
		// the nonInteractive policy.
		if (!ctx.hasUI) {
			if (cfg.nonInteractive === "block") {
				return {
					block: true,
					reason: "Safeguard: no UI to confirm (nonInteractive=block)",
				};
			}
			return;
		}

		// subagent: show the agent + a slice of the task so the approval is
		// meaningful (selector alone is just the agent name). Read-only vs
		// bash-capable isn't surfaced here — safeguard is decoupled from the tier
		// table; the user encodes trust via per-agent rules in safeguard.json.
		let preview = selector;
		if (event.toolName === "subagent") {
			const t = input.task;
			if (typeof t === "string" && t) preview = `${selector} — ${t}`;
		}
		preview = preview.length > 400 ? `${preview.slice(0, 400)} …` : preview;
		const raw = await ctx.ui.select(
			`🔐 Allow ${event.toolName}?\n\n  ${preview}`,
			[ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY],
		);

		// The IDE diff / editable webui modal may resolve with {label, oldFull,
		// newFull} when the user EDITED pi's proposal (vs. a bare label string).
		// Feed the edited text back by mutating event.input in place — pi then
		// applies the user's version, so its context stays consistent (no stale
		// file, no clobber). No edit → plain label string. (docs: event.input is
		// mutable; mutations affect execution, no re-validation.)
		const edited =
			raw && typeof raw === "object"
				? {
						label: typeof raw.label === "string" ? raw.label : DENY,
						oldFull: typeof raw.oldFull === "string" ? raw.oldFull : "",
						newFull: typeof raw.newFull === "string" ? raw.newFull : "",
					}
				: null;
		const choice = edited ? edited.label : typeof raw === "string" ? raw : null;

		// Apply the user's edits (one-shot) on any ALLOW. edit/write carry edits;
		// harmless no-op for everything else.
		const applyEdits = () => {
			if (!edited || !event.input) return;
			if (event.toolName === "write") {
				event.input.content = edited.newFull;
			} else if (event.toolName === "edit") {
				// Whole-file replace → result is exactly the user's version.
				event.input.edits = [
					{ oldText: edited.oldFull, newText: edited.newFull },
				];
			}
		};

		if (choice === ALLOW_ONCE) {
			applyEdits();
			return;
		}
		if (choice === ALLOW_SESSION) {
			sessionAllow.add(key);
			applyEdits();
			return;
		}
		if (choice === ALLOW_ALWAYS) {
			saveAllowAlways(event.toolName, selector, loadConfig());
			applyEdits();
			return;
		}

		// Deny, or Esc/cancel (null) → fail closed
		return { block: true, reason: "Safeguard: denied by user" };
	});

	pi.registerCommand("safeguard", {
		description: "Safeguard status / manage session allows",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			if (args.trim() === "reset") {
				const n = sessionAllow.size;
				sessionAllow.clear();
				ctx.ui.notify(`Cleared ${n} session-allowed action(s)`, "info");
				return;
			}
			const cfg = loadConfig();
			const tools = Object.keys(cfg).filter(
				(k) => k !== "*" && k !== "nonInteractive",
			);
			ctx.ui.notify(
				`Config: ${CONFIG_PATH}\n` +
					`*=${cfg["*"] ?? "allow"} · nonInteractive=${cfg.nonInteractive}\n` +
					`tools=${tools.length} (${tools.join(", ") || "none"}) · session=${sessionAllow.size}`,
				"info",
			);
		},
	});

	pi.on("session_shutdown", () => sessionAllow.clear());
}
