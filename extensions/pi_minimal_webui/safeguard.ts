/**
 * Safeguard Extension
 *
 * Config-driven allow / ask / deny gate for EVERY tool call (bash, read, write,
 * edit, custom tools, …), now backed by the shared policy engine
 * (policy-engine.js — the SAME module server.js uses for the Permissions page
 * and Explain, so the UI can never show a verdict the gate wouldn't produce).
 *
 * Modes (FR-12..FR-16): the config carries `mode` = default | auto-approve |
 * read-only, re-read every call. `yolo` is SESSION-ONLY state (never persisted
 * — a config containing it is rejected with a diagnostic); engage it via
 * `/safeguard mode yolo` (human-confirmed). read-only mode denies every
 * non-read-class action silently; coordination tools are exempt.
 *
 * Layers (FR-4): default (shipped floor) → user (~/.pi/agent/safeguard.json) →
 * workspace (<cwd>/.pi/safeguard.json, tighten-only — may only add ask/deny
 * and force read-only). User config is v2: `version`, `revision`, `mode`,
 * `sensitivePaths`, per-tool rules (shape unchanged from v1).
 *
 * Bash (FR-8..11): compound commands are classified conservatively — a command
 * is auto-allowable only when every subcommand is read-only AND every
 * subcommand matches an allow rule and no part matches a deny rule.
 *
 * Wire contract (tool name = `safeguard` gate on `tool_call`, unchanged):
 * the select options below must match the JetBrains DiffReviewEditor EXACTLY.
 *
 * Commands: /safeguard (status) · /safeguard reset (clear session allows) ·
 * /safeguard mode yolo (session-scoped, confirm-gated) · /safeguard revoke <n>
 */
// ponytail: this extension ships minimal-dep (no @types/node, no node_modules
// resolution). Sibling files use the same pattern — jiti strips types at load
// and resolves the real node builtins at runtime.
import {
	existsSync,
	readFileSync,
	statSync,
	writeFileSync,
	realpathSync,
} from "node:fs";
import { join, isAbsolute } from "node:path";
import { homedir } from "node:os";
// Shared policy engine + classifier (CommonJS; jiti default-imports the
// exports object). THE single resolution implementation.
import engine from "./policy-engine.js";
import bashCls from "./bash-classifier.js";

function getAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}
// minimal node process surface (no @types/node in this minimal-dep extension;
// jiti strips types at load)
declare const process: { cwd(): string };
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
		setStatus?(key: string, text: string | undefined): void;
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
	version?: number;
	revision?: number;
	mode?: string;
	nonInteractive?: "allow" | "block";
	sensitivePaths?: Array<{ pattern: string; action: Action }>;
	"*"?: Action;
	[tool: string]: Rule | "allow" | "block" | unknown;
};

const CONFIG_PATH = join(getAgentDir(), "safeguard.json");
const WORKSPACE_CONFIG_PATH = () =>
	join(process.cwd(), ".pi", "safeguard.json");

// The shipped default layer lives in the ENGINE (single copy shared with
// server.js's Permissions page + Explain — one floor, no drift).
const DEFAULT_CONFIG: Config = engine.DEFAULT_CONFIG as unknown as Config;

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow for this session";
const ALLOW_ALWAYS = "Allow always (save to config)";
const DENY = "Deny";

// ponytail: mtime-cache the parsed layers. loadLayers runs in the tool_call
// hot path (~2×/call); statSync is ~10× cheaper than read+parse and its mtime
// invalidates the instant a manual edit or a "save always" lands — preserving
// the re-read-each-call live behavior without the per-call cost. saveConfig()
// drops the cache so a write can never leave callers reading a pre-write
// snapshot. A missing/corrupt file throws → empty layer, cache cleared
// (re-probe next call once the file is fixed and its mtime advances).
let layersCache: {
	userMtime: number;
	wsMtime: number;
	layers: Array<{ name: string; cfg: unknown }>;
	effective: Record<string, unknown>;
	diagnostics: Array<{ layer: string; path: string; message: string }>;
} | null = null;

function readCfgOrEmpty(p: string): {
	cfg: Record<string, unknown>;
	mtime: number;
} {
	try {
		const mtime = statSync(p).mtimeMs;
		const parsed = JSON.parse(readFileSync(p, "utf-8")) as Record<
			string,
			unknown
		>;
		return { cfg: parsed && typeof parsed === "object" ? parsed : {}, mtime };
	} catch {
		return { cfg: {}, mtime: -1 };
	}
}

function loadLayers() {
	const user = readCfgOrEmpty(CONFIG_PATH);
	const ws = readCfgOrEmpty(WORKSPACE_CONFIG_PATH());
	if (
		layersCache &&
		layersCache.userMtime === user.mtime &&
		layersCache.wsMtime === ws.mtime
	)
		return layersCache;
	const merged = engine.mergeLayers(DEFAULT_CONFIG, user.cfg, ws.cfg);
	layersCache = {
		userMtime: user.mtime,
		wsMtime: ws.mtime,
		layers: merged.layers,
		effective: merged.effective,
		diagnostics: merged.diagnostics,
	};
	return layersCache;
}

/** The raw user config for ALLOW_ALWAYS writes (v2-normalized + revision). */
function loadUserConfigForWrite(): Record<string, unknown> {
	const { cfg } = readCfgOrEmpty(CONFIG_PATH);
	return engine.normalizeForWrite(cfg);
}

function saveConfig(cfg: Record<string, unknown>): void {
	layersCache = null; // invalidate before the write — a thrown write must not leave a stale cache
	try {
		writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
	} catch {
		/* best-effort */
	}
}

function selectorFor(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "bash") return String(input.command ?? "");
	if (toolName === "read" || toolName === "write" || toolName === "edit")
		return String(input.path ?? input.filePath ?? "");
	// subagent: selector = the agent name (single mode) so per-target rules like
	// `"subagent": { "implementer": "ask", "*": "allow" }` work. parallel/chain
	// span multiple agents — key those by the mode label. This gates the
	// *delegation* itself; the spawned subprocess's internal tool calls are gated
	// by its own --tools allowlist — that allowlist is the capability wall, since
	// the subprocess runs headless (hasUI=false) and thus auto-allows under
	// nonInteractive. Two layers: parent decides IF, allowlist decides WHAT.
	if (toolName === "subagent") {
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
	// recon tools (grep/find/ls/glob): keep the JSON selector — the engine's
	// isPathSelector heuristic sees any path inside it, so the sensitivePaths
	// table (FR-7) matches against every path the call mentions.
	try {
		return JSON.stringify(input);
	} catch {
		return "";
	}
}

function saveAllowAlways(
	toolName: string,
	selector: string,
	cfg: Record<string, unknown>,
): void {
	// v2: "Allow always" writes an EXACT-selector grant (config `grants`),
	// not a pattern rule. Rule-based allows are subject to the FR-9 compound
	// gate (a stale/loose pattern can never auto-allow a mutating command),
	// while an always-grant is an explicit approval of THIS exact selector and
	// bypasses the gate — so "Allow always" keeps working for repetitive
	// mutating commands (npm test, …).
	const key = `${toolName}\u0000${selector}`;
	const grants = Array.isArray(cfg.grants) ? (cfg.grants as string[]) : [];
	if (!grants.includes(key)) grants.push(key);
	cfg.grants = grants;
	cfg.revision = ((cfg.revision as number) || 0) + 1;
	saveConfig(cfg);
}

/**
 * FR-6 containment for bash: does a subcommand touch a path OUTSIDE the
 * workspace root? Path-like args (partPathTokens) expand ~/$HOME/$PWD, resolve
 * relative ones against the child cwd (= workspace), and realpath existing
 * targets (symlink escape). Any outside token → the whole command is outside
 * → it asks in every non-yolo mode (see the tool_call gate).
 */
function isOutsidePart(part: string): boolean {
	for (const t of bashCls.partPathTokens(part)) {
		let p = t;
		if (p === "~" || p.startsWith("~/")) p = homedir() + p.slice(1);
		else if (p.startsWith("$HOME")) p = homedir() + p.slice("$HOME".length);
		else if (p.startsWith("$PWD")) p = process.cwd() + p.slice("$PWD".length);
		const abs = isAbsolute(p) ? p : join(process.cwd(), p);
		let canon = abs;
		try {
			const r = realpathSync(abs);
			if (r) canon = r;
		} catch {
			/* target may not exist yet — literal join stays */
		}
		if (!engine.isUnderRoot(canon, process.cwd())) return true;
	}
	return false;
}

export default function (pi: ExtensionAPI) {
	// ponytail: module-level map dies with the extension instance; pi reloads the
	// instance on /new, /resume, /fork, so this naturally scopes to one session.
	const sessionAllow = new Set<string>();
	let sessionYolo = false;

	pi.on("session_start", async (_event, ctx) => {
		sessionYolo = false; // never survives a new session (FR-14)
		// broadcast the persisted mode so the webui's composer chip stays true
		if (ctx.hasUI) {
			try {
				const { effective } = loadLayers();
				ctx.ui.setStatus?.(
					"safeguard",
					JSON.stringify({ mode: (effective.mode as string) ?? "default" }),
				);
			} catch {
				/* best-effort */
			}
		}
		if (!existsSync(CONFIG_PATH)) {
			saveConfig({ ...DEFAULT_CONFIG } as Record<string, unknown>);
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

		const { layers, effective } = loadLayers(); // re-read live (manual edits apply)
		const mode = sessionYolo
			? "yolo"
			: ((effective.mode as string) ?? "default");
		const key = engine.makeKey(event.toolName, selector);
		const engineOpts = {
			hasGrant: (k: string) =>
				sessionAllow.has(k) ||
				(Array.isArray(effective.grants) &&
					(effective.grants as string[]).includes(k)),
			sensitivePaths: effective.sensitivePaths as Array<{
				pattern: string;
				action: Action;
			}>,
			realpath: realpathSync,
			cwd: process.cwd(),
			workspaceRoot: process.cwd(),
		};
		const verdict = engine.resolve(
			event.toolName,
			selector,
			layers,
			engineOpts,
		);
		// bash compound classification (FR-8/9)
		let bash: {
			parts: Array<{ cmd: string; readonly: boolean }>;
			gate: {
				allow: boolean;
				denied: boolean;
				outside: boolean;
				classify: { verdict: string };
				reason: string;
			};
		} | null = null;
		if (event.toolName === "bash") {
			const cls = bashCls.classify(selector);
			const gate = bashCls.gateBash(
				selector,
				(part: string) => engine.resolve("bash", part, layers, engineOpts),
				isOutsidePart,
			);
			bash = { parts: cls.parts, gate };
		}
		// FR-13: mode transform (yolo is session state, never a config value)
		let eff = engine.applyMode(verdict, mode, {
			toolName: event.toolName,
			bashClassify: bash ? bash.gate.classify : null,
		});

		// 1. deny always wins (rules, sensitive deny, read-only blocks) — even
		// over a session allow. (yolo is the only override; it returns allow.)
		if (eff.action === "deny") {
			if (ctx.hasUI)
				ctx.ui.notify(
					`🚫 Blocked (${eff.tier}): ${event.toolName} ${selector.slice(0, 120)}`,
					"warning",
				);
			return {
				block: true,
				reason: `Safeguard: ${eff.tier} policy for ${event.toolName}`,
			};
		}

		// 2. FR-9c: a deny rule on ANY compound part blocks the whole command,
		// even if a whole-command rule would allow it.
		if (bash && bash.parts.length) {
			for (const p of bash.parts) {
				const pv = engine.resolve("bash", p.cmd, layers, engineOpts);
				if (pv.action === "deny") {
					if (ctx.hasUI)
						ctx.ui.notify(
							`🚫 Blocked (compound part): bash ${p.cmd.slice(0, 120)}`,
							"warning",
						);
					return {
						block: true,
						reason: `Safeguard: deny rule on compound part '${p.cmd}'`,
					};
				}
			}
		}

		// 3. session grant (or persisted always-grant): the user explicitly
		// approved THIS exact selector — bypasses the compound gate (FR-9 gates
		// RULE-based allows, not explicit approvals).
		if (sessionAllow.has(key) || (effective.grants as string[])?.includes(key))
			return;

		// 4. allow, with the FR-9 compound gate: for bash, a rule-based allow
		// only passes when the command is read-only AND every subcommand is
		// allow-ruled. This is what closes the verified bypasses even against
		// stale configs whose allowlists still contain mutating git verbs
		// (e.g. a copied v1 default with `branch|remote`): the classifier
		// verdict is binding, so `git remote remove origin` asks regardless.
		if (eff.action === "allow") {
			if (!bash || bash.gate.allow) return;
			// mode-induced allows (read-only / auto-approve / yolo) are explicit
			// posture choices — they bypass the compound gate (no prompts).
			if (
				eff.tier === "read-only" ||
				eff.tier === "auto-approve" ||
				eff.tier === "yolo"
			) {
				// FR-6 containment cap: a command touching paths OUTSIDE the
				// workspace root asks even under these modes — only yolo (the
				// explicit session override) stays exempt.
				if (eff.tier !== "yolo" && bash.gate.outside) {
					eff = { ...eff, action: "ask", tier: "outside-workspace" };
				} else {
					return;
				}
			}
			// bash + rule allow but compound not fully allowed → fall through to
			// ask (never auto-allow a mutating/ambiguous compound, FR-9).
		}

		// 5. FR-9 shortcut: readonly compound + every subcommand allow-ruled →
		// allow without prompting (works even when the whole-command rule is ask).
		if (bash && bash.gate.allow) return;

		// 6. ask-class. Headless (print/json) falls back to the nonInteractive
		// policy — modes already transformed allow/deny above (FR-15).
		if (!ctx.hasUI) {
			if (effective.nonInteractive === "block") {
				return {
					block: true,
					reason: "Safeguard: no UI to confirm (nonInteractive=block)",
				};
			}
			return;
		}

		// 6. prompt. First broadcast the provenance context (FR-2 → browser):
		// the webui renders it in the pending tool card; other UIs ignore it.
		try {
			ctx.ui.setStatus?.(
				"safeguard",
				JSON.stringify({
					tier: eff.tier,
					action: eff.action,
					matchedRule: eff.matchedRule,
					layer: eff.layer,
					reason: eff.reason,
					mode,
				}),
			);
		} catch {
			/* best-effort */
		}

		// subagent: show the agent + a slice of the task so the approval is
		// meaningful (selector alone is just the agent name).
		let preview = selector;
		if (event.toolName === "subagent") {
			const t = input.task;
			if (typeof t === "string" && t) preview = `${selector} — ${t}`;
		}
		preview = preview.length > 400 ? `${preview.slice(0, 400)} …` : preview;
		// FR-13: mandatory-ask is NOT grantable — offer only Allow once / Deny
		const options =
			eff.tier === "mandatory-ask"
				? [ALLOW_ONCE, DENY]
				: [ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY];
		const raw = await ctx.ui.select(
			`🔐 Allow ${event.toolName}?\n\n  ${preview}`,
			options,
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
			saveAllowAlways(event.toolName, selector, loadUserConfigForWrite());
			applyEdits();
			return;
		}

		// Deny, or Esc/cancel (null) → fail closed
		return { block: true, reason: "Safeguard: denied by user" };
	});

	pi.registerCommand("safeguard", {
		description: "Safeguard status / session allows / mode",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;
			const a = args.trim();

			if (a === "reset") {
				const n = sessionAllow.size;
				sessionAllow.clear();
				ctx.ui.notify(`Cleared ${n} session-allowed action(s)`, "info");
				return;
			}

			// /safeguard mode yolo — session-scoped, human-confirmed (FR-14).
			// Confirms even when invoked by the model, so a silent agent cannot
			// disarm the gate; the browser's mode selector pre-confirms too.
			if (a === "mode yolo") {
				if (sessionYolo) {
					ctx.ui.notify("YOLO mode already active", "info");
					return;
				}
				const go = await ctx.ui.select(
					"⚠ YOLO mode: EVERY action auto-allowed, no prompts, until this session ends. Engage?",
					["Engage YOLO", "Cancel"],
				);
				const engaged = typeof go === "string" && go.startsWith("Engage");
				if (!engaged) {
					ctx.ui.notify("YOLO mode not engaged", "info");
					return;
				}
				sessionYolo = true;
				// broadcast so the webui's composer chip shows yolo (it can't be
				// read from config — yolo is session-only state, FR-12)
				try {
					ctx.ui.setStatus?.("safeguard", JSON.stringify({ mode: "yolo" }));
				} catch {
					/* best-effort */
				}
				ctx.ui.notify(
					"⚠ YOLO mode ACTIVE — all actions auto-allowed until the session ends",
					"warning",
				);
				return;
			}

			// /safeguard revoke <n> — remove the n-th session grant (1-based,
			// insertion order) so per-grant revoke actually reaches the gate.
			const revoke = a.match(/^revoke\s+(\d+)$/);
			if (revoke) {
				const idx = parseInt(revoke[1], 10) - 1;
				const keys = [...sessionAllow];
				if (idx < 0 || idx >= keys.length) {
					ctx.ui.notify(
						`No session grant #${revoke[1]} (have ${keys.length})`,
						"info",
					);
					return;
				}
				const removed = keys[idx];
				sessionAllow.delete(removed);
				ctx.ui.notify(
					`Revoked session grant: ${removed.split("\u0000")[0]} ${(removed.split("\u0000")[1] || "").slice(0, 80)}`,
					"info",
				);
				return;
			}

			// status
			const { effective, diagnostics } = loadLayers();
			const grants = [...sessionAllow];
			const lines = grants
				.map((g, i) => {
					const [tool, sel] = g.split("\u0000");
					return `${i + 1}. ${tool}: ${(sel || "").slice(0, 60)}`;
				})
				.join("\n");
			ctx.ui.notify(
				`Safeguard: mode=${sessionYolo ? "YOLO" : (effective.mode ?? "default")}` +
					` · grants=${grants.length}${grants.length ? "\n" + lines : ""}` +
					(diagnostics.length ? `\ndiagnostics=${diagnostics.length}` : ""),
				"info",
			);
		},
	});

	pi.on("session_shutdown", () => {
		sessionAllow.clear();
		sessionYolo = false;
	});
}
