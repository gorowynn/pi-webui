/**
 * pi_minimal_webui — Todo list tool.
 *
 * Registers `todo`: an INCREMENTAL todo list the agent uses to plan multi-step
 * work and track progress. Each task has a stable `id` (agent-supplied) and a
 * status: open | started | finished. The agent plans the list ONCE, then flips
 * individual statuses cheaply by id — no need to resend the whole list on every
 * status change (the common case during execution).
 *
 * Actions (one per call):
 *   plan    items:[{id,subject,status?}]   replace the whole list (all `open`
 *                                          unless a status is given). Use this
 *                                          once up front and to fully re-plan.
 *   add     items:[{id,subject,status?}]   append tasks (new ids).
 *   update  updates:[{id,status}]          set status(es) by id. THE frequent,
 *                                          cheap call — send only what changed.
 *   remove  ids:[id...]                    drop tasks by id.
 *   clear                              empty the list.
 *
 * Architecture (the webui's proven OUT smuggling channel): the browser renders
 * straight from `tool_execution_start` args. The FRONTEND owns the list state
 * (it already did) and applies each call's action to its own `todos`, then
 * re-renders — see applyTodoOp() in app.js. execute() only acknowledges, so
 * there is no server-side state to lose across context compaction, new
 * sessions, or pi crashes/restarts. If the agent ever loses track of the list,
 * it just `plan`s the full list again (a full replace) to resync.
 *
 * This replaces the earlier full-state-replace design (send the entire list
 * every call). Status flips no longer resend unchanged tasks. Tool name `todo`
 * intentionally matches the webui's UI hooks (describeTool /
 * tool_execution_start); project-local loads before npm and registration is
 * first-wins, so this shadows any other `todo` tool cleanly — same trick
 * ask_user_question uses.
 */

// Local minimal types for the pi extension surface we touch. pi provides the
// real ExtensionAPI at load time; jiti strips these so they never ship.
// Declared locally (like index.ts) to avoid a node_modules resolution dependency.
type TodoStatus = "open" | "started" | "finished";
interface TodoPlanItem {
	id: string | number;
	subject: string;
	status?: TodoStatus;
}
interface TodoUpdate {
	id: string | number;
	status: TodoStatus;
}
type TodoAction = "plan" | "add" | "update" | "remove" | "clear";
interface TodoParams {
	action: TodoAction;
	items?: TodoPlanItem[];
	updates?: TodoUpdate[];
	ids?: (string | number)[];
}
export interface TodoItem {
	id: string | number;
	subject: string;
	status: TodoStatus;
}
const STATUS_OK = new Set<TodoStatus>(["open", "started", "finished"]);
function normItem(raw: TodoPlanItem): TodoItem {
	const status = raw.status && STATUS_OK.has(raw.status) ? raw.status : "open";
	return { id: raw.id, subject: raw.subject ?? "", status };
}

// ponytail: the extension's own mirror of the list. The browser owns the
// rendered list (it applies each op at tool_execution_start); this mirror is
// the source for the agent-facing tool RESULT and for discipline.ts nudges, so
// the agent can see the live state after every call and catch stale/stuck
// tasks instead of getting a bare "Updated N" ack. Applied here in execute()
// (same idempotent semantics the browser uses) and reset per session.
let todos: TodoItem[] = [];
export function getTodos(): TodoItem[] {
	return todos;
}
function summarize(): string {
	if (!todos.length) return "  (empty)";
	return todos.map((t) => `  #${t.id} [${t.status}] ${t.subject}`).join("\n");
}
interface AgentToolResult {
	content: { type: "text"; text: string }[];
	details: unknown;
}
interface ToolExecutionContext {
	hasUI: boolean;
}
interface ToolDefinition {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: unknown;
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolExecutionContext,
	): Promise<AgentToolResult>;
}
interface ExtensionAPI {
	registerTool(def: ToolDefinition): void;
	on(event: string, handler: (...args: any[]) => unknown): void;
}

// JSON-schema literal (TypeBox schemas are plain JSON Schema; jiti strips the
// type constraint). `action` discriminates the call; the array fields are used
// per action and validated leniently in execute() (kept optional in the schema
// since which one applies depends on `action`).
const parameters = {
	type: "object",
	required: ["action"],
	properties: {
		action: {
			type: "string",
			enum: ["plan", "add", "update", "remove", "clear"],
			description:
				"What to do. `plan` replaces the whole list (call once up front, or to fully re-plan). `update` flips one or more task statuses by id — the frequent, cheap call that does NOT resend the list. `add` appends, `remove` drops by id, `clear` empties the list.",
		},
		items: {
			type: "array",
			description:
				"For `plan` and `add`. Each item: { id, subject, status? }. `id` is a stable key you choose (simple sequential ints like 1,2,3 work well — reuse the same id when updating it later). `subject` is a short imperative. `status` defaults to `open`.",
			items: {
				type: "object",
				properties: {
					id: {
						type: ["string", "number"],
						description:
							"Stable task id. Reuse it in later update/remove calls.",
					},
					subject: {
						type: "string",
						description:
							'A short imperative task description, e.g. "Add input validation to login form".',
					},
					status: {
						type: "string",
						enum: ["open", "started", "finished"],
						description: "Defaults to `open`.",
					},
				},
				required: ["id", "subject"],
			},
		},
		updates: {
			type: "array",
			description:
				"For `update`. Each: { id, status } where status is open | started | finished. Send ONLY the tasks whose status changed — no need to resend unchanged tasks.",
			items: {
				type: "object",
				properties: {
					id: { type: ["string", "number"] },
					status: {
						type: "string",
						enum: ["open", "started", "finished"],
						description:
							"open = not started. started = actively working on it right now (keep at most ONE started at a time). finished = done.",
					},
				},
				required: ["id", "status"],
			},
		},
		ids: {
			type: "array",
			description: "For `remove`. The task ids to drop.",
			items: { type: ["string", "number"] },
		},
	},
};

const DESCRIPTION = `Track multi-step work with an incremental todo list. Each task has a stable id and a status: open | started | finished. Plan the list ONCE, then flip statuses cheaply by id — you do NOT resend the whole list on every status change.

Actions:
- plan   { items: [{id, subject, status?}] }  — replace the whole list. Call once up front (and to fully re-plan). All tasks start \`open\` unless you set a status.
- update { updates: [{id, status}] }           — set status(es) by id. THE frequent call: send only the tasks that changed.
- add    { items: [{id, subject, status?}] }   — append tasks.
- remove { ids: [id...] }                      — drop tasks by id.
- clear  { }                                   — empty the list.

When to use it:
- ANY task with 3+ steps or several distinct sub-tasks. Plan the list BEFORE you start executing.
- Break the problem into small, focused chunks (one clear outcome each).

How to keep it current:
- Choose stable ids (simple sequential ints: 1, 2, 3 …) and reuse them.
- Use \`update\` to flip a task to \`started\` the moment you begin it (one \`started\` at a time), and to \`finished\` the moment it's done. Send only the changed ids.
- If you lose track of the current list (e.g. after context compaction), just \`plan\` the full list again — it replaces everything and resyncs.

Do NOT use it for single-step tasks or open-ended questions with no plan.`;

const PROMPT_SNIPPET =
	"Plan multi-step work once (action: plan), then flip task statuses by id with action: update (open → started → finished) — no need to resend the whole list";

const PROMPT_GUIDELINES = [
	'Use the todo tool for ANY task with 3+ steps or multiple distinct sub-tasks. Start with action:"plan" and items:[{id,subject}] for each step. `id` is a stable key YOU choose — simple sequential ints (1,2,3) work well; reuse the same id whenever you touch that task later. All tasks begin `open`.',
	'To change progress, use action:"update" with updates:[{id,status}] where status is open | started | finished. Send ONLY the tasks whose status changed — do NOT resend the whole list. Flip a task to `started` right before you begin it (keep at most ONE `started` at a time) and to `finished` the moment it\'s done.',
	'action:"add" appends tasks; action:"remove" drops tasks by id; action:"clear" empties the list. Keep each task small and focused (one concrete outcome).',
	'If you ever lose track of the current list (e.g. after context compaction), just action:"plan" the full list again — it replaces everything and resyncs. Skip the tool entirely for single-step tasks.',
];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		todos = [];
	});
	pi.registerTool({
		name: "todo",
		label: "Todo List",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters,
		// tool_execution_start already shipped the action args to the browser,
		// which applied them to its own list and re-rendered. Here we mirror the
		// same op into our own state and RETURN THE LIVE LIST so the agent can
		// verify progress and is told about unknown ids / stuck tasks — that's
		// the feedback that keeps the list from drifting.
		async execute(_toolCallId, params) {
			const p = (params || {}) as TodoParams;
			const action = p.action as TodoAction;
			let head = "";
			const notes: string[] = [];
			switch (action) {
				case "plan":
					todos = (p.items ?? []).map(normItem).filter(Boolean);
					head = `Planned ${todos.length} task(s).`;
					break;
				case "add": {
					const added = (p.items ?? []).map(normItem).filter(Boolean);
					todos = todos.concat(added);
					head = `Added ${added.length} task(s).`;
					break;
				}
				case "update": {
					const ups = p.updates ?? [];
					const seen = new Set<string>();
					let matched = 0;
					for (const u of ups) {
						if (!u || u.id == null) continue;
						const key = String(u.id);
						seen.add(key);
						const t = todos.find((x) => String(x.id) === key);
						if (!t) {
							notes.push(`#${u.id} not found (no such task — skipped)`);
							continue;
						}
						if (STATUS_OK.has(u.status)) {
							t.status = u.status;
							matched++;
						}
					}
					// a started task this update didn't touch is at risk of stalling —
					// surface it so it isn't quietly abandoned.
					const stuck = todos.filter(
						(t) => t.status === "started" && !seen.has(String(t.id)),
					);
					if (stuck.length)
						notes.push(
							`${stuck.map((s) => "#" + s.id).join(", ")} still started — finish or re-scope before it stalls`,
						);
					head = `Updated ${matched}/${ups.length} task(s).`;
					break;
				}
				case "remove": {
					const drop = new Set((p.ids ?? []).map(String));
					const before = todos.length;
					todos = todos.filter((t) => !drop.has(String(t.id)));
					head = `Removed ${before - todos.length} task(s).`;
					break;
				}
				case "clear":
					todos = [];
					head = "Cleared.";
					break;
				default:
					head = `Unknown todo action: ${String(p.action ?? "")}`;
			}
			const text =
				head +
				"\nCurrent list:\n" +
				summarize() +
				(notes.length ? "\n⚠ " + notes.join("; ") : "");
			return {
				content: [{ type: "text" as const, text }],
				details: { action, todos: [...todos] },
			};
		},
	});
}
