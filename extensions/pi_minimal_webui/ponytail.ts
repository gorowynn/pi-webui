/**
 * pi_minimal_webui — Ponytail (lazy senior dev mode).
 *
 * A lightweight, self-contained port of DietrichGebert/ponytail folded into the
 * webui extension. Two pieces only — the two that make ponytail work:
 *
 *   1. `/ponytail [lite|full|ultra|off|status]` — set or report the intensity.
 *   2. `before_agent_start` — injects the ruleset into the system prompt every
 *      turn while active, so the agent climbs the lazy ladder before writing.
 *
 * What was dropped on purpose (kept it light): config-file/env persistence
 * (mode is session-scoped, defaults to `full` like upstream), the `stop
 * ponytail`/`normal mode` input listener (use `/ponytail off`), and the five
 * review/audit/debt/gain/help skills. The value is the always-on ruleset; the
 * skills are one-shot reports you can still get by asking in chat.
 *
 * The ruleset below is the canonical ponytail body. Mode-specific lines (the
 * intensity table rows and the worked examples) are tagged by a mode name and
 * filtered to the active level at inject time — same scheme as upstream's
 * filterSkillBodyForMode, just inlined with no SKILL.md file read.
 *
 * ponytail: prompt injection appends to event.systemPrompt (never replaces), so
 * it chains safely with other before_agent_start handlers (e.g. the permission
 * system) regardless of ordering.
 */

// Local minimal types for the pi extension surface we touch. pi provides the
// real ExtensionAPI at load time; jiti strips these so they never ship.
// Declared locally (like index.ts / todo.ts) to avoid a node_modules resolution
// dependency from this dir.
type PonytailMode = "off" | "lite" | "full" | "ultra";
interface CommandContext {
	ui: {
		notify(message: string, level?: "info" | "warning" | "error"): void;
	};
}
interface BeforeAgentStartEvent {
	systemPrompt: string;
}
interface ExtensionAPI {
	registerCommand(
		name: string,
		def: {
			description: string;
			handler: (
				args: string | undefined,
				ctx: CommandContext,
			) => void | Promise<void>;
		},
	): void;
	on(
		event: "before_agent_start",
		handler: (
			event: BeforeAgentStartEvent,
			ctx: unknown,
		) =>
			| Promise<{ systemPrompt?: string } | void>
			| { systemPrompt?: string }
			| void,
	): void;
}

const RUNTIME_MODES: PonytailMode[] = ["off", "lite", "full", "ultra"];
const DEFAULT_MODE: PonytailMode = "full";

function normalizeMode(mode: unknown): PonytailMode | null {
	if (typeof mode !== "string") return null;
	const m = mode.trim().toLowerCase();
	return (RUNTIME_MODES as string[]).includes(m) ? (m as PonytailMode) : null;
}

// The canonical ponytail ruleset (SKILL.md body, frontmatter stripped). Lines
// tagged with a mode name — `| **lite** | …` table rows and `- lite: …`
// example bullets — are kept only for the active level; everything else is
// always shown. Faithful to upstream; trimmed only where prose repeated itself.
const RULESET = `ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure. Default: **full**. Switch: \`/ponytail lite|full|ultra\`.

## The ladder

Stop at the first rung that holds:

1. **Does this need to exist at all?** Speculative need = skip it, say so in one line. (YAGNI)
2. **Already in this codebase?** A helper, util, type, or pattern that already lives here → reuse it. Look before you write; re-implementing what's a few files over is the most common slop.
3. **Stdlib does it?** Use it.
4. **Native platform feature covers it?** \`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code.
5. **Already-installed dependency solves it?** Use it. Never add a new one for what a few lines can do.
6. **Can it be one line?** One line.
7. **Only then:** the minimum code that works.

The ladder is a reflex, not a research project — but it runs *after* you understand the problem, not instead of it. Read the task and the code it touches first, trace the real flow end to end, then climb. Two rungs work → take the higher one and move on. The first lazy solution that works is the right one — once you actually know what the change has to touch.

**Bug fix = root cause, not symptom.** A report names a symptom. Before you edit, grep every caller of the function you're about to touch. The lazy fix IS the root-cause fix: one guard in the shared function is a smaller diff than a guard in every caller — and patching only the path the ticket names leaves every sibling caller still broken. Fix it once, where all callers route through.

## Rules

- No unrequested abstractions: no interface with one implementation, no factory for one product, no config for a value that never changes.
- No boilerplate, no scaffolding "for later", later can scaffold for itself.
- Deletion over addition. Boring over clever, clever is what someone decodes at 3am.
- Fewest files possible. Shortest working diff wins — but only once you understand the problem. The smallest change in the wrong place isn't lazy, it's a second bug.
- Complex request? Ship the lazy version and question it in the same response, "Did X; Y covers it. Need full X? Say so." Never stall on an answer you can default.
- Two stdlib options, same size? Take the one that's correct on edge cases. Lazy means writing less code, not picking the flimsier algorithm.
- Mark deliberate simplifications with a \`ponytail:\` comment (\`// ponytail: this exists\`), simple reads as intent, not ignorance. Shortcut with a known ceiling (global lock, O(n²) scan, naive heuristic)? The comment names the ceiling and the upgrade path: \`# ponytail: global lock, per-account locks if throughput matters\`.

## Output

Code first. Then at most three short lines: what was skipped, when to add it.
No essays, no feature tours, no design notes. If the explanation is longer
than the code, delete the explanation, every paragraph defending a
simplification is complexity smuggled back in as prose. Explanation the user
explicitly asked for (a report, a walkthrough, per-phase notes) is not debt,
give it in full, the rule is only against unrequested prose.

Pattern: \`[code] → skipped: [X], add when [Y].\`

## Intensity

| Level | What change |
|-------|-------------|
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
explicitly requested. User insists on the full version → build it, no
re-arguing.

Never lazy about understanding the problem. The ladder shortens the
solution, never the reading. Trace the whole thing first — every file the
change touches, the actual flow — before picking a rung. Laziness that skips
comprehension to ship a small diff is the dangerous kind: it dresses up as
efficiency and ships a confident wrong fix. Read fully, then be lazy.

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

Ponytail governs what you build, not how you talk. \`/ponytail off\` reverts.
Level persists until changed or session end. The shortest path to done is the
right path.`;

// Keep only the active mode's tagged lines; everything else verbatim. Mirrors
// upstream's filterSkillBodyForMode: a table row `| **<mode>** |` or an example
// bullet `- <mode>:` whose label IS a mode is mode-specific; a label that isn't
// a mode (e.g. "No unrequested abstractions: ...") is a normal rule, kept.
function filterForMode(body: string, mode: PonytailMode): string {
	return body
		.split(/\r?\n/)
		.filter((line) => {
			const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
			if (tableLabel) {
				const m = normalizeMode(tableLabel[1].trim());
				if (m) return m === mode;
			}
			const exampleLabel = line.match(/^-\s*([^:]+):\s*/);
			if (exampleLabel) {
				const m = normalizeMode(exampleLabel[1].trim());
				if (m) return m === mode;
			}
			return true;
		})
		.join("\n");
}

function instructions(mode: PonytailMode): string {
	return `PONYTAIL MODE ACTIVE — level: ${mode}\n\n${filterForMode(RULESET, mode)}`;
}

export default function ponytail(pi: ExtensionAPI) {
	let currentMode: PonytailMode = DEFAULT_MODE;

	pi.registerCommand("ponytail", {
		description:
			"Ponytail lazy-dev mode: /ponytail [lite|full|ultra|off|status]",
		handler: async (args, ctx) => {
			const normalized = String(args || "")
				.trim()
				.toLowerCase();

			// No arg (or "status") reports; a mode sets it.
			if (!normalized || normalized === "status") {
				ctx.ui.notify(`Ponytail: ${currentMode}`, "info");
				return;
			}

			const mode = normalizeMode(normalized);
			if (!mode) {
				ctx.ui.notify(
					`Unknown ponytail mode: ${normalized}. Use lite, full, ultra, or off.`,
					"warning",
				);
				return;
			}
			currentMode = mode;
			ctx.ui.notify(
				mode === "off" ? "Ponytail off." : `Ponytail mode set to ${mode}.`,
				"info",
			);
		},
	});

	pi.on("before_agent_start", async (event) => {
		if (currentMode === "off") return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${instructions(currentMode)}`,
		};
	});
}
