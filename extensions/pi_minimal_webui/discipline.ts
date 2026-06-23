/**
 * pi_minimal_webui — Process-discipline nudges.
 *
 * One reminder injected at `before_agent_start` (per turn), driven by the todo
 * mirror that todo.ts now owns (applied in the todo tool's execute()):
 *  - todos active (and not all finished) → "keep the list current with
 *    action:update" — names the started task(s) so they're not abandoned.
 *  - todos all finished, not cleared     → "call action:clear before moving on".
 *  - no todos + a fresh prompt           → "if ambiguous use ask_user_question;
 *    if 3+ steps plan a todo list first".
 *
 * Why soft, not hard: you can't force an LLM to emit a specific tool call — tool
 * selection is the model's call. But re-surfacing the obligation EVERY turn is
 * far harder to drift from than a one-time system prompt (the failure mode this
 * catches: planning a list, then forgetting to update/clear it). Hard tool_call
 * blocking stays reserved for safety (safeguard.ts); there's no reliable signal
 * for "this is a 3+ step task" or "this request is ambiguous", so gating work
 * tools would just produce false-positive annoyance.
 *
 * The live list lives in todo.ts (single owner, applied in execute()). We read
 * it here via getTodos() — no second mirror to drift.
 *
 * Composes with ponytail.ts: both before_agent_start handlers append to
 * event.systemPrompt, and pi chains them, so order doesn't matter.
 */
// ponytail: soft enforcement via per-turn system-prompt append. Upgrade path if
// it's ignored in practice: add a mild tool_call gate that blocks work tools
// when a todo is stale beyond N turns (carries false-positive risk — last resort).
import { getTodos, type TodoItem } from "./todo.js";

// Local minimal type for the pi surface we touch (on). pi provides the real
// ExtensionAPI at load time; jiti strips these. `any[]` matches the sibling
// convention (index.ts) — keeps pass-through compatible with no node_modules.
interface ExtensionAPI {
	on(event: string, handler: (...args: any[]) => unknown): void;
}

export default function (pi: ExtensionAPI) {
	// ponytail: module-level state dies with the extension instance; pi reloads
	// the instance on /new, /resume, /fork, so this naturally scopes to one
	// session — same trick safeguard.ts uses for its sessionAllow map. todo.ts
	// resets its mirror on session_start, which is what we read, so no reset here.
	pi.on(
		"before_agent_start",
		async (event: { prompt?: string; systemPrompt?: string }) => {
			const todos: TodoItem[] = getTodos();
			let nudge = "";
			if (todos.length > 0) {
				const started = todos.filter((t) => t.status === "started");
				const open = todos.filter((t) => t.status === "open");
				const allDone = todos.every((t) => t.status === "finished");
				if (allDone) {
					nudge =
						'Your todo list is fully finished but not cleared — call todo action:"clear" before moving on.';
				} else {
					const bits: string[] = [];
					if (started.length)
						bits.push(
							`${started.length} started (resume/finish #${started
								.map((s) => s.id)
								.join(", #")})`,
						);
					if (open.length) bits.push(`${open.length} open`);
					nudge = `Todo list active (${bits.join(
						", ",
					)}). Keep it current with action:"update" as you work.`;
				}
			} else if (event.prompt && event.prompt.trim()) {
				nudge =
					"Fresh request: if it's ambiguous or has multiple valid approaches, use ask_user_question before acting; if it's 3+ steps, plan a todo list first.";
			}
			if (!nudge) return;
			return {
				systemPrompt: `${event.systemPrompt ?? ""}\n\n## Process discipline (auto-injected)\n- ${nudge}`,
			};
		},
	);
}
