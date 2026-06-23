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

function len(arr: unknown): number {
	return Array.isArray(arr) ? arr.length : 0;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "todo",
		label: "Todo List",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters,
		// execute does almost nothing. tool_execution_start already shipped the
		// action args to the browser, which applied them to its own todos state
		// and re-rendered instantly. Just acknowledge so the call completes
		// cleanly (and gives the agent a useful summary).
		async execute(_toolCallId, params) {
			const p = (params || {}) as TodoParams;
			const action = p.action as TodoAction;
			let text: string;
			switch (action) {
				case "plan":
					text = `Todo list planned: ${len(p.items)} task(s).`;
					break;
				case "add":
					text = `Added ${len(p.items)} task(s).`;
					break;
				case "update":
					text = `Updated ${len(p.updates)} task(s).`;
					break;
				case "remove":
					text = `Removed ${len(p.ids)} task(s).`;
					break;
				case "clear":
					text = "Todo list cleared.";
					break;
				default:
					text = `Unknown todo action: ${String(p.action ?? "")}`;
			}
			return {
				content: [{ type: "text" as const, text }],
				details: { action },
			};
		},
	});
}
