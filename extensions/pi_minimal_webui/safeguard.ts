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
 *   {
 *     "*": "ask",                 // fallback for any tool not listed below
 *     "nonInteractive": "allow",  // headless (print/json, no human): "allow" | "block"
 *     "read": {                   // per-target rules; first match wins, then "*"
 *       "*": "allow",
 *       ".env": "deny",
 *       ".env.example": "ask"
 *     },
 *     "edit": "ask",              // tool-level rule: one action for all targets
 *     "bash": {
 *       "*": "ask",
 *       "re:^git (status|log)": "allow"
 *     }
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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	getAgentDir,
	type ExtensionAPI,
	type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";

type Action = "allow" | "ask" | "deny";
type Rule = Action | { [pattern: string]: Action };
type Config = {
	"*"?: Action;
	nonInteractive?: "allow" | "block";
	[tool: string]: Rule | "allow" | "block" | undefined;
};

const CONFIG_PATH = join(getAgentDir(), "safeguard.json");
const PATH_TOOLS = new Set(["read", "write", "edit"]);

const DEFAULT_CONFIG: Config = {
	"*": "ask",
	nonInteractive: "allow",
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

		const preview =
			selector.length > 400 ? `${selector.slice(0, 400)} …` : selector;
		const choice = await ctx.ui.select(
			`🔐 Allow ${event.toolName}?\n\n  ${preview}`,
			[ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY],
		);

		if (choice === ALLOW_ONCE) return;
		if (choice === ALLOW_SESSION) {
			sessionAllow.add(key);
			return;
		}
		if (choice === ALLOW_ALWAYS) {
			saveAllowAlways(event.toolName, selector, loadConfig());
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
