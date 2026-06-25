/**
 * pi_minimal_webui — Process-discipline enforcement for the todo list.
 *
 * Two layers, covering different drift windows:
 *
 *  1. before_agent_start (soft, per-turn system-prompt nudge) — handles the
 *     cases a mid-turn gate CAN'T see: no list yet ("plan one if 3+ steps / use
 *     ask_user_question if ambiguous"), and all-finished-but-not-cleared
 *     ("call action:clear before moving on"). Fires once per turn.
 *
 *  2. tool_call (HARD gate, per tool call) — forces the intermediate `update`
 *     calls the soft nudge alone couldn't get. The reported failure mode: the
 *     agent plans, marks task 1 started, then runs a burst of work for tasks
 *     2..N and only marks everything finished at the end — so the panel never
 *     showed the intermediate transitions. before_agent_start can't catch that
 *     (it doesn't re-fire mid-turn); tool_call does. Rule: block any *work*
 *     tool (everything except `todo` / `ask_user_question`) when the list is
 *     active and has unfinished work but ZERO tasks marked started. That forces
 *     the documented rhythm (todo.ts already says "one started at a time"):
 *     plan → update(1:started) before any work → work → update(1:finished) →
 *     update(2:started) before more work → … → update(last:finished) (all-done,
 *     allowed) → clear. Every transition is now visible in the panel.
 *
 * Why a gate and not a smarter detector: mapping a given bash/read call to a
 * specific task is unreliable (no clean signal), so we gate on the one sound,
 * contract-level invariant — at most one started, and there must be one to do
 * work. Ceiling: a correctly-batched `[update(1:started), read(...)]` right
 *     after `plan` preflights the `read` before the sibling `update` executes
 *     (parallel tool mode), so it false-positives once; self-correcting (the
 *     retried `read` sees the now-started task). Upgrade path: inspect
 *     ctx.sessionManager for in-flight sibling todo updates if pi exposes that
 *     reliably; until then the one-retry cost is the price of strictness.
 *
 * Safety stays in safeguard.ts (deny/ask). A block here composes: both hook
 * tool_call, both must allow. This gate only ever BLOCKs on the stale-list
 * invariant, never on the tool's own merits.
 *
 * Composes with ponytail.ts: both before_agent_start handlers append to
 * event.systemPrompt; pi chains them, order doesn't matter.
 */
import { getTodos, type TodoItem } from "./todo.js";

// Local minimal types for the pi surface we touch. pi provides the real
// ExtensionAPI at load time; jiti strips these. `any[]` matches the sibling
// convention (index.ts) — keeps pass-through compatible with no node_modules.
interface ExtensionAPI {
	on(event: string, handler: (...args: any[]) => unknown): void;
}

// Tools that are never "work" — they don't advance a task, so the stale-list
// gate doesn't apply. `todo` is the lever the agent uses to FIX the invariant
// (gating it would deadlock it out of compliance); `ask_user_question` is a
// clarification, not progress on a task.
const EXEMPT = new Set(["todo", "ask_user_question"]);

export default function (pi: ExtensionAPI) {
	// ponytail: module-level state dies with the extension instance; pi reloads
	// the instance on /new, /resume, /fork, so this naturally scopes to one
	// session — same trick safeguard.ts uses for its sessionAllow map. todo.ts
	// resets its mirror on session_start, which is what we read, so no reset here.

	// --- Hard gate: force a started task before any work proceeds -------------
	// Blocks work tools when the list is active with unfinished work but nothing
	// started. See file header for the rationale + the parallel-sibling ceiling.
	pi.on("tool_call", async (event: { toolName: string; input?: unknown }) => {
		if (EXEMPT.has(event.toolName)) return;
		const todos: TodoItem[] = getTodos();
		if (todos.length === 0) return; // no list → soft nudge's job
		const unfinished = todos.filter((t) => t.status !== "finished");
		if (unfinished.length === 0) return; // all done → soft nudge ("clear it")
		if (unfinished.some((t) => t.status === "started")) return; // one started → work proceeds
		// 0 started while unfinished work remains → the drift this catches.
		const openIds = unfinished.map((t) => `#${t.id}`).join(", ");
		return {
			block: true as const,
			reason:
				`Process discipline: you're calling a work tool (${event.toolName}) with an active todo list but no task marked "started". ` +
				`Use the todo tool — action:"update", updates:[{id, status:"started"}] — to mark exactly ONE task started (${openIds}) before doing its work. ` +
				`Keep one started, flip it to "finished" when done, then start the next.`,
		};
	});

	// --- Soft nudge: per-turn system-prompt reminder --------------------------
	pi.on(
		"before_agent_start",
		async (event: { prompt?: string; systemPrompt?: string }) => {
			const todos: TodoItem[] = getTodos();
			let nudge = "";
			if (todos.length > 0) {
				// ponytail: constant nudge — no live ids/counts. The hard tool_call gate
				// above enforces the invariant mid-turn; this only reminds of the rhythm.
				// A byte-constant suffix keeps the provider prompt cache stable across
				// turns (O3 — see docs/plans.md).
				const allDone = todos.every((t) => t.status === "finished");
				if (allDone) {
					nudge =
						'Your todo list is fully finished but not cleared — call todo action:"clear" before moving on.';
				} else {
					nudge =
						'Todo list active. Keep it current with action:"update" as you work — one started at a time, flip to finished when done.';
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
