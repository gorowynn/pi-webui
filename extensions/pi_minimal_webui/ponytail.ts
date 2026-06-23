/**
 * Ponytail — pi extension
 *
 * Makes your AI agent think like the laziest senior dev in the room.
 * The best code is the code you never wrote.
 *
 * A faithful, self-contained port of DietrichGebert/ponytail for pi:
 *   - Always-on lazy-senior-dev ruleset injected into the system prompt.
 *   - Intensity levels: lite / full (default) / ultra / off.
 *   - Commands: /ponytail, /ponytail-review, /ponytail-audit, /ponytail-debt, /ponytail-help
 *   - Config: PONYTAIL_DEFAULT_MODE env var > config file > "full".
 *
 * No external files required — the full skill bodies are embedded, so the
 * review/audit/debt/help commands work without the ponytail repo checked out.
 *
 * Source of truth for the rule text: https://github.com/DietrichGebert/ponytail
 *
 * Drop in ~/.pi/agent/extensions/ponytail.ts (global) and /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const DEFAULT_MODE = "full";
const VALID_MODES = ["off", "lite", "full", "ultra"];

/** off | lite | full | ultra, case-insensitive. Returns null for anything else. */
function normalizeMode(mode: unknown): string | null {
	if (typeof mode !== "string") return null;
	const n = mode.trim().toLowerCase();
	return VALID_MODES.includes(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Config (default-mode resolver): env var > config file > "full"
// ---------------------------------------------------------------------------

function getConfigDir(): string {
	if (process.env.XDG_CONFIG_HOME) {
		return path.join(process.env.XDG_CONFIG_HOME, "ponytail");
	}
	if (process.platform === "win32") {
		return path.join(
			process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
			"ponytail",
		);
	}
	return path.join(os.homedir(), ".config", "ponytail");
}

function getConfigPath(): string {
	return path.join(getConfigDir(), "config.json");
}

function getDefaultMode(): string {
	// 1. Environment variable (highest priority)
	const envMode = process.env.PONYTAIL_DEFAULT_MODE;
	if (envMode && VALID_MODES.includes(envMode.toLowerCase())) {
		return envMode.toLowerCase();
	}

	// 2. Config file defaultMode
	try {
		const config = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
		if (
			config?.defaultMode &&
			VALID_MODES.includes(String(config.defaultMode).toLowerCase())
		) {
			return String(config.defaultMode).toLowerCase();
		}
	} catch {
		// No config or invalid — fall through.
	}

	// 3. Default
	return DEFAULT_MODE;
}

function writeDefaultMode(mode: unknown): string | null {
	const normalized = normalizeMode(mode);
	if (!normalized) return null;

	const configPath = getConfigPath();
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	fs.writeFileSync(
		configPath,
		JSON.stringify({ defaultMode: normalized }, null, 2),
		"utf8",
	);
	return normalized;
}

// ---------------------------------------------------------------------------
// Skill bodies (verbatim from ponytail, sans frontmatter)
//
// Stored as template literals with backticks escaped. These are the canonical
// instructions that ship in skills/{name}/SKILL.md in the ponytail repo.
// ---------------------------------------------------------------------------

const PONYTAIL_SKILL_BODY = `# Ponytail

You are a lazy senior developer. Lazy means efficient, not careless. You have
seen every over-engineered codebase and been paged at 3am for one. The best
code is the code never written.

## Persistence

ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if
unsure. Off only: "stop ponytail" / "normal mode". Default: **full**.
Switch: \`/ponytail lite|full|ultra\`.

## The ladder

Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need = skip it, say so in one line. (YAGNI)
2. **Stdlib does it?** Use it.
3. **Native platform feature covers it?** \`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code.
4. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do.
5. **Can it be one line?** One line.
6. **Only then:** the minimum code that works.

The ladder is a reflex, not a research project. Two rungs work -> take the
higher one and move on. The first lazy solution that works is the right one.

## Rules

- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later", later can scaffold for itself.
- Deletion over addition. Boring over clever, clever is what someone decodes at 3am.
- Fewest files possible. Shortest working diff wins.
- Complex request? Ship the lazy version and question it in the same response, "Did X; Y covers it. Need full X? Say so." Never stall on an answer you can default.
- Two stdlib options, same size? Take the one that's correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.
- Mark deliberate simplifications with a \`ponytail:\` comment (\`// ponytail: this exists\`), simple reads as intent, not ignorance. Shortcut with a known ceiling (global lock, O(n^2) scan, naive heuristic)? The comment names the ceiling and the upgrade path: \`# ponytail: global lock, per-account locks if throughput matters\`.

## Output

Code first. Then at most three short lines: what was skipped, when to add it.
No essays, no feature tours, no design notes. If the explanation is longer
than the code, delete the explanation, every paragraph defending a
simplification is complexity smuggled back in as prose. Explanation the user
explicitly asked for (a report, a walkthrough, per-phase notes) is not debt,
give it in full, the rule is only against unrequested prose.

Pattern: \`[code] -> skipped: [X], add when [Y].\`

## Intensity

| Level | What change |
|-------|------------|
| **lite** | Build what's asked, but name the lazier alternative in one line. User picks. |
| **full** | The ladder enforced. Stdlib and native first. Shortest diff, shortest explanation. Default. |
| **ultra** | YAGNI extremist. Deletion before addition. Ship the one-liner and challenge the rest of the requirement in the same breath. |

Example: "Add a cache for these API responses."
- lite: "Done, cache added. FYI: \`functools.lru_cache\` covers this in one line if you'd rather not own a cache class."
- full: "\`@lru_cache(maxsize=1000)\` on the fetch function. Skipped custom cache class, add when lru_cache measurably falls short."
- ultra: "No cache until a profiler says so. When it does: \`@lru_cache\`. A hand-rolled TTL cache class is a bug farm with a hit rate."

## When NOT to be lazy

Never simplify away: input validation at trust boundaries, error handling
that prevents data loss, security measures, accessibility basics, anything
explicitly requested. User insists on the full version -> build it, no
re-arguing.

Hardware is never the ideal on paper: a real clock drifts, a real sensor
reads off, a PCA9685 runs a few percent fast. Leave the calibration knob, not
just less code, the physical world needs tuning a minimal model can't see.

Lazy code without its check is unfinished. Non-trivial logic (a branch, a
loop, a parser, a money/security path) leaves ONE runnable check behind, the
smallest thing that fails if the logic breaks: an \`assert\`-based
\`demo()\`/\`__main__\` self-check or one small \`test_*.py\`. No frameworks, no
fixtures, no per-function suites unless asked. Trivial one-liners need no
test, YAGNI applies to tests too.

## Boundaries

Ponytail governs what you build, not how you talk. "stop ponytail" /
"normal mode": revert. Level persists until changed or session end.

The shortest path to done is the right path.`;

const REVIEW_SKILL_BODY = `Review diffs for unnecessary complexity. One line per finding: location, what
to cut, what replaces it. The diff's best outcome is getting shorter.

## Format

\`L<line>: <tag> <what>. <replacement>.\`, or \`<file>:L<line>: ...\` for
multi-file diffs.

Tags:

- \`delete:\` dead code, unused flexibility, speculative feature. Replacement: nothing.
- \`stdlib:\` hand-rolled thing the standard library ships. Name the function.
- \`native:\` dependency or code doing what the platform already does. Name the feature.
- \`yagni:\` abstraction with one implementation, config nobody sets, layer with one caller.
- \`shrink:\` same logic, fewer lines. Show the shorter form.

## Examples

X "This EmailValidator class might be more complex than necessary, have you
considered whether all these validation rules are needed at this stage?"

- \`L12-38: stdlib: 27-line validator class. "@" in email, 1 line, real validation is the confirmation mail.\`
- \`L4: native: moment.js imported for one format call. Intl.DateTimeFormat, 0 deps.\`
- \`repo.py:L88: yagni: AbstractRepository with one implementation. Inline it until a second one exists.\`
- \`L52-71: delete: retry wrapper around an idempotent local call. Nothing replaces it.\`
- \`L30-44: shrink: manual loop builds dict. dict(zip(keys, values)), 1 line.\`

## Scoring

End with the only metric that matters: \`net: -<N> lines possible.\`

If there is nothing to cut, say \`Lean already. Ship.\` and stop.

## Boundaries

Complexity only, correctness bugs, security holes, and performance go to a
normal review pass, not this one. A single smoke test or \`assert\`-based
self-check is the ponytail minimum, not bloat, never flag it for deletion.
Does not apply the fixes, only lists them.
"stop ponytail-review" or "normal mode": revert to verbose review style.`;

const AUDIT_SKILL_BODY = `ponytail-review, repo-wide. Scan the whole tree instead of a diff. Rank
findings biggest cut first.

## Tags

Same as ponytail-review:

- \`delete:\` dead code, unused flexibility, speculative feature. Replacement: nothing.
- \`stdlib:\` hand-rolled thing the standard library ships. Name the function.
- \`native:\` dependency or code doing what the platform already does. Name the feature.
- \`yagni:\` abstraction with one implementation, config nobody sets, layer with one caller.
- \`shrink:\` same logic, fewer lines. Show the shorter form.

## Hunt

Deps the stdlib or platform already ships, single-implementation interfaces,
factories with one product, wrappers that only delegate, files exporting one
thing, dead flags and config, hand-rolled stdlib.

## Output

One line per finding, ranked: \`<tag> <what to cut>. <replacement>. [path]\`.
End with \`net: -<N> lines, -<M> deps possible.\` Nothing to cut: \`Lean already. Ship.\`

## Boundaries

Complexity only, correctness bugs, security holes, and performance go to a
normal review pass. Lists findings, applies nothing. One-shot.
"stop ponytail-audit" or "normal mode" to revert.`;

const DEBT_SKILL_BODY = `Every deliberate ponytail shortcut is marked with a \`ponytail:\` comment naming
its ceiling and upgrade path. This collects them into one ledger so a deferral
can't quietly become permanent.

## Scan

Grep the repo for comment markers, skipping \`node_modules\`, \`.git\`, and build
output:

\`grep -rnE '(#|//) ?ponytail:' .\`  (add other comment prefixes if your stack uses them)

Each hit is one ledger row. The comment prefix keeps prose that merely mentions
the convention out of the ledger.

## Output

One row per marker, grouped by file:

\`<file>:<line> - <what was simplified>. ceiling: <the limit named>. upgrade: <the trigger to revisit>.\`

The convention is \`ponytail: <ceiling>, <upgrade path>\`, so pull the ceiling
and the trigger straight from the comment. Want an owner per row too? add
\`git blame -L<line>,<line>\`.

Flag the rot risk: any \`ponytail:\` comment that names no upgrade path or
trigger gets a \`no-trigger\` tag, those are the ones that silently rot.

End with \`<N> markers, <M> with no trigger.\` Nothing found: \`No ponytail: debt. Clean ledger.\`

## Boundaries

Reads and reports only, changes nothing. To persist it, ask and it writes the
ledger to a file (e.g. \`PONYTAIL-DEBT.md\`). One-shot. "stop ponytail-debt" or
"normal mode" to revert.`;

const HELP_SKILL_BODY = `# Ponytail Help

Quick-reference card for all ponytail modes, skills, and commands.
One-shot display, not a persistent mode.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | \`/ponytail lite\` | Build what's asked, name the lazier alternative in one line. |
| **Full** | \`/ponytail\` | The ladder enforced: YAGNI -> stdlib -> native -> one line -> minimum. Default. |
| **Ultra** | \`/ponytail ultra\` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | \`/ponytail\` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | \`/ponytail-review\` | Over-engineering review: \`L42: yagni: factory, one product. Inline.\` |
| **ponytail-audit** | \`/ponytail-audit\` | Whole-repo audit for over-engineering. |
| **ponytail-debt** | \`/ponytail-debt\` | Harvest \`ponytail:\` comments into a debt ledger. |
| **ponytail-help** | \`/ponytail-help\` | This card. |

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with \`/ponytail\`.
\`/ponytail off\` also works.

## Configure Default Mode

Default mode = \`full\`, auto-active every session. Change it:

**Environment variable** (highest priority):
\`\`\`bash
export PONYTAIL_DEFAULT_MODE=ultra
\`\`\`

**Config file** (\`~/.config/ponytail/config.json\`, Windows: \`%APPDATA%\\ponytail\\config.json\`):
\`\`\`json
{ "defaultMode": "lite" }
\`\`\`

Set \`"off"\` to disable auto-activation on session start, activate manually
with \`/ponytail\` when wanted.

Resolution: env var > config file > \`full\`.

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail`;

// ---------------------------------------------------------------------------
// Instruction builder
//
// Mirrors ponytail-instructions.js: the only mode-specific lines are the
// intensity table rows and the worked-example bullets. Everything else is
// kept verbatim. For the active mode, keep only that mode's row/example.
// ---------------------------------------------------------------------------

function filterSkillBodyForMode(body: string, mode: string): string {
	const effectiveMode = normalizeMode(mode) || DEFAULT_MODE;
	const lines = body.split(/\r?\n/);

	return lines
		.filter((line) => {
			// Intensity table row: | **lite** | ... |
			const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
			if (tableLabel) {
				const labelMode = normalizeMode(tableLabel[1].trim());
				if (labelMode) return labelMode === effectiveMode;
				return true; // header / separator / non-mode row
			}

			// Worked-example bullet: "- lite: ..." / "- full: ..." / "- ultra: ..."
			const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
			if (exampleLabel) {
				const labelMode = normalizeMode(exampleLabel[1].trim());
				if (labelMode) return labelMode === effectiveMode;
			}

			return true;
		})
		.join("\n");
}

function getPonytailInstructions(mode: string): string {
	const effective = normalizeMode(mode) || DEFAULT_MODE;
	return (
		`PONYTAIL MODE ACTIVE — level: ${effective}\n\n` +
		filterSkillBodyForMode(PONYTAIL_SKILL_BODY, effective)
	);
}

// ---------------------------------------------------------------------------
// Session-mode resolution
// ---------------------------------------------------------------------------

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: { mode?: string };
}

function resolveSessionMode(
	entries: SessionEntry[] | null | undefined,
	fallbackMode: string,
): string {
	const fallback = normalizeMode(fallbackMode) || DEFAULT_MODE;
	if (!Array.isArray(entries)) return fallback;

	// Most recent ponytail-mode entry wins (walk newest-first).
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (
			!entry ||
			entry.type !== "custom" ||
			entry.customType !== "ponytail-mode"
		)
			continue;
		const mode = normalizeMode(entry?.data?.mode);
		if (mode) return mode;
	}

	return fallback;
}

// ---------------------------------------------------------------------------
// /ponytail command parsing
// ---------------------------------------------------------------------------

type ParsedCommand =
	| { type: "status" }
	| { type: "set-mode"; mode: string }
	| { type: "set-default"; mode: string }
	| { type: "invalid"; reason: string; mode?: string };

function parsePonytailCommand(
	text: string,
	defaultMode: string,
): ParsedCommand {
	const fallback = normalizeMode(defaultMode) || DEFAULT_MODE;
	const normalizedText = String(text || "")
		.trim()
		.toLowerCase();

	if (!normalizedText) {
		return { type: "set-mode", mode: fallback === "off" ? "full" : fallback };
	}

	const [primary, secondary] = normalizedText.split(/\s+/);

	if (primary === "status") return { type: "status" };

	if (primary === "default") {
		const mode = normalizeMode(secondary);
		return mode
			? { type: "set-default", mode }
			: { type: "invalid", reason: "invalid-default-mode" };
	}

	const mode = normalizeMode(primary);
	return mode
		? { type: "set-mode", mode }
		: { type: "invalid", reason: "invalid-mode", mode: primary };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function ponytailExtension(pi: ExtensionAPI): void {
	let currentMode = DEFAULT_MODE;
	let configuredDefaultMode = getDefaultMode();

	const setMode = (
		mode: string,
		ctx?: { ui?: { notify?: (m: string, k: string) => void } },
	) => {
		const normalized = normalizeMode(mode);
		if (!normalized) return;

		currentMode = normalized;
		pi.appendEntry("ponytail-mode", { mode: normalized });
		ctx?.ui?.notify?.(`Ponytail mode set to ${normalized}.`, "info");
	};

	/**
	 * Send a one-shot instruction payload to the agent, mirroring ponytail's
	 * skill aliases. If the agent is busy, queue as a follow-up.
	 */
	const sendInstructions = (
		payload: string,
		label: string,
		ctx: {
			isIdle?: () => boolean;
			ui?: { notify?: (m: string, k: string) => void };
		},
	) => {
		if (ctx?.isIdle?.() === false) {
			pi.sendUserMessage(payload, { deliverAs: "followUp" });
			ctx?.ui?.notify?.(`${label} queued as follow-up.`, "info");
			return;
		}
		pi.sendUserMessage(payload);
	};

	// --- /ponytail [lite|full|ultra|off|status|default <mode>] -------------
	pi.registerCommand("ponytail", {
		description:
			"Ponytail: set or report lazy-dev intensity (lite/full/ultra/off)",
		getArgumentCompletions: (prefix: string) => {
			const all = ["lite", "full", "ultra", "off", "status", "default"];
			const hits = all.filter((s) => s.startsWith(prefix.toLowerCase()));
			return hits.length > 0 ? hits.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => {
			const parsed = parsePonytailCommand(args, configuredDefaultMode);

			if (parsed.type === "status") {
				ctx.ui.notify(
					`Ponytail: current ${currentMode} • default ${configuredDefaultMode}`,
					"info",
				);
				return;
			}

			if (parsed.type === "set-default") {
				const written = writeDefaultMode(parsed.mode);
				if (written) {
					configuredDefaultMode = written;
					const message =
						written === "off"
							? `Ponytail default set to off. Auto-activation disabled; current session is ${currentMode}.`
							: `Ponytail default set to ${written} • current ${currentMode}.`;
					ctx.ui.notify(message, "info");
				}
				return;
			}

			if (parsed.type === "set-mode") {
				setMode(parsed.mode, ctx);
				return;
			}

			ctx.ui.notify(
				"Unknown or unsupported /ponytail mode. Use lite | full | ultra | off | status | default.",
				"warning",
			);
		},
	});

	// --- /ponytail-review --------------------------------------------------
	pi.registerCommand("ponytail-review", {
		description: "Ponytail: review the current diff for over-engineering",
		handler: (_args, ctx) => {
			const payload =
				`${REVIEW_SKILL_BODY}\n\n` +
				`---\n\n` +
				`Run a ponytail-review now: inspect the current diff (run \`git diff\` to see staged + unstaged changes). ` +
				`Use the tags, format, and scoring above. One line per finding: location, what to cut, what replaces it. ` +
				`Apply nothing — only list findings, then end with the net line count.`;
			sendInstructions(payload, "/ponytail-review", ctx);
		},
	});

	// --- /ponytail-audit ---------------------------------------------------
	pi.registerCommand("ponytail-audit", {
		description: "Ponytail: audit the whole repo for over-engineering",
		handler: (_args, ctx) => {
			const payload =
				`${AUDIT_SKILL_BODY}\n\n` +
				`---\n\n` +
				`Run a ponytail-audit now: scan the whole codebase (not just the diff) for over-engineering. ` +
				`Use the tags and output format above, ranked biggest cut first, then end with the net summary. ` +
				`Apply nothing — one-shot report.`;
			sendInstructions(payload, "/ponytail-audit", ctx);
		},
	});

	// --- /ponytail-debt ----------------------------------------------------
	pi.registerCommand("ponytail-debt", {
		description: "Ponytail: harvest ponytail: comments into a debt ledger",
		handler: (_args, ctx) => {
			const payload =
				`${DEBT_SKILL_BODY}\n\n` +
				`---\n\n` +
				`Run a ponytail-debt scan now: grep the repo for \`ponytail:\` comment markers ` +
				`(skip node_modules, .git, build output) and report the ledger using the output format above. ` +
				`Reads and reports only — change nothing.`;
			sendInstructions(payload, "/ponytail-debt", ctx);
		},
	});

	// --- /ponytail-help ----------------------------------------------------
	pi.registerCommand("ponytail-help", {
		description: "Ponytail: quick-reference card",
		handler: async (_args, ctx) => {
			// One-shot display — no LLM round-trip, no mode change, nothing persisted.
			const card = `${HELP_SKILL_BODY}\n\nCurrent mode: ${currentMode} • default ${configuredDefaultMode}`;
			if (ctx.hasUI) {
				await ctx.ui.select(
					"Ponytail Help",
					card.split(/\r?\n/).filter((l) => l.trim().length > 0),
				);
			} else {
				ctx.ui.notify(card, "info");
			}
		},
	});

	// --- "stop ponytail" / "normal mode" deactivates -----------------------
	pi.on("input", async (event) => {
		if (event?.source === "extension") return;

		const text = String(event?.text || "");
		if (
			currentMode !== "off" &&
			/\b(stop ponytail|normal mode)\b/i.test(text)
		) {
			setMode("off");
		}

		return { action: "continue" };
	});

	// --- Resolve mode at session start -------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		const entries =
			// @ts-expect-error - getBranch may be absent on some session shapes
			ctx?.sessionManager?.getBranch?.() ||
			ctx?.sessionManager?.getEntries?.() ||
			[];
		configuredDefaultMode = getDefaultMode();
		currentMode = resolveSessionMode(entries, configuredDefaultMode);
	});

	// --- Inject the active mode's ruleset into the system prompt -----------
	pi.on("before_agent_start", async (event) => {
		if (!currentMode || currentMode === "off") return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${getPonytailInstructions(currentMode)}`,
		};
	});
}
