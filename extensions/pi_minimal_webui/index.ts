/**
 * pi-webui — Ask User Question (RPC bridge).
 *
 * Problem: the stock @juicesharp/rpiv-ask-user-question tool renders its UI via
 * `ctx.ui.custom(factory)`, which is a no-op stub in `pi --mode rpc` (returns
 * undefined instantly → tool resolves as "User declined" before the browser can
 * answer). This extension shadows that tool (project-local loads before npm;
 * tool registration is first-wins) and routes the answer through `ctx.ui.input`,
 * which RPC mode DOES bridge end-to-end.
 *
 * Two-channel smuggle (both already work in RPC, no node_modules patch needed):
 *   - OUT  tool→browser: tool_execution_start carries the full args verbatim
 *     (questions/options/descriptions/previews/multiSelect) — the browser renders
 *     the rich modal straight from there, zero fidelity loss.
 *   - BACK browser→tool: ctx.ui.input(MARKER) is a blocking latch; the browser
 *     replies with extension_ui_response{value: JSON.stringify(result)}.
 *
 * MARKER title makes the input request invisible to the normal input UI.
 *
 * ponytail: copies the LLM-facing envelope shape from the npm package so the
 * model sees identical "Q"="A" output. promptSnippet/guidelines copied too,
 * since first-wins drops the npm tool's system-prompt contributions.
 */

// Local minimal types for the pi extension surface we touch. pi provides the real
// ExtensionAPI at load time; jiti strips these so they never ship. Declared
// locally to avoid a node_modules resolution dependency from this dir.
interface ExtensionUIContext {
	input(title: string, placeholder?: string): Promise<string | undefined>;
}
interface ToolExecutionContext {
	hasUI: boolean;
	ui: ExtensionUIContext;
}
interface AgentToolResult {
	content: { type: "text"; text: string }[];
	details: unknown;
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

// Both sides agree on this exact string. Null-prefixed so it can't collide with a
// human-authored title and renders as nothing if it ever leaks to the screen.
export const ASK_MARKER = "\u0000pi-webui:ask-user-question";

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
const DECLINE_MESSAGE = "User declined to answer questions";
const ENVELOPE_PREFIX = "User has answered your questions:";
const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
const NO_INPUT_PLACEHOLDER = "(no input)";
const CHAT_CONTINUATION =
	"User wants to chat about this. Continue the conversation to help them decide.";

interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "chat" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}
interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	error?: string;
}
interface OptionLike {
	label: string;
	description: string;
	preview?: string;
}
interface QuestionLike {
	question: string;
	header: string;
	multiSelect?: boolean;
	options: OptionLike[];
}

function toolResult(text: string, details: QuestionnaireResult) {
	return { content: [{ type: "text" as const, text }], details };
}

function formatScalar(a: QuestionAnswer): string {
	switch (a.kind) {
		case "chat":
			return CHAT_CONTINUATION;
		case "multi":
			return a.selected && a.selected.length > 0
				? a.selected.join(", ")
				: NO_INPUT_PLACEHOLDER;
		case "custom":
			return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
		case "option":
			return a.answer ?? NO_INPUT_PLACEHOLDER;
	}
}

function buildSegment(a: QuestionAnswer): string {
	const parts = [`"${a.question}"="${formatScalar(a)}"`];
	if (a.preview && a.preview.length > 0)
		parts.push(`selected preview: ${a.preview}`);
	if (a.notes && a.notes.length > 0) parts.push(`user notes: ${a.notes}`);
	return `${parts.join(". ")}.`;
}

function buildResponse(
	result: QuestionnaireResult | null | undefined,
	params: { questions?: QuestionLike[] },
) {
	if (!result || result.cancelled) {
		return toolResult(DECLINE_MESSAGE, {
			answers: result?.answers ?? [],
			cancelled: true,
		});
	}
	const segs: string[] = [];
	const qs = params.questions ?? [];
	for (let i = 0; i < qs.length; i++) {
		const a = (result.answers || []).find((x) => x.questionIndex === i);
		if (a) segs.push(buildSegment(a));
	}
	if (segs.length === 0) {
		return toolResult(DECLINE_MESSAGE, {
			answers: result.answers ?? [],
			cancelled: true,
		});
	}
	return toolResult(
		`${ENVELOPE_PREFIX} ${segs.join(" ")} ${ENVELOPE_SUFFIX}`,
		result,
	);
}

// JSON-schema literal (TypeBox schemas are plain JSON Schema; jiti strips the
// type constraint). Mirrors the npm tool's QuestionParamsSchema so the model
// calls it identically.
const parameters = {
	type: "object",
	properties: {
		questions: {
			type: "array",
			minItems: 1,
			maxItems: 4,
			description: "Questions to ask the user (1-4 questions)",
			items: {
				type: "object",
				properties: {
					question: {
						type: "string",
						description:
							'The complete question to ask. End with a question mark. Example: "Which library should we use for date formatting?"',
					},
					header: {
						type: "string",
						maxLength: 16,
						description:
							'MAX 16 CHARACTERS — hard limit. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".',
					},
					multiSelect: {
						type: "boolean",
						default: false,
						description:
							"Set to true to allow the user to select multiple options instead of just one.",
					},
					options: {
						type: "array",
						minItems: 2,
						maxItems: 4,
						description:
							"The available choices (2-4 options). The 'Type something.' row is appended automatically — do NOT author it.",
						items: {
							type: "object",
							properties: {
								label: {
									type: "string",
									maxLength: 60,
									description:
										"MAX 60 CHARACTERS — hard limit. The display text for this option (1-5 words).",
								},
								description: {
									type: "string",
									description:
										"Explanation of what this option means or its trade-offs.",
								},
								preview: {
									type: "string",
									description:
										"Optional preview content (mockups, code, configs) rendered when focused. Single-select only.",
								},
							},
							required: ["label", "description"],
						},
					},
				},
				required: ["question", "header", "options"],
			},
		},
	},
	required: ["questions"],
};

const DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users will always be able to type a custom answer ("Type something." row is appended automatically to every single-select question) or pick "Chat about this" to abandon the questionnaire and continue in free-form conversation. Do NOT author "Other" / "Type something." / "Chat about this" labels yourself — duplicates are rejected at runtime.
- Use multiSelect: true to allow multiple answers to be selected for a question. The "Type something." row is suppressed on multi-select questions, and is ALSO suppressed on single-select questions where any option carries a \`preview\` (the side-by-side layout has no room for inline custom text — "Chat about this" remains as the free-form escape hatch).
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

const PROMPT_SNIPPET =
	"Ask the user up to 4 structured questions (2-4 options each) when requirements are ambiguous";

const PROMPT_GUIDELINES = [
	"Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to 4 questions per invocation.",
	'Each question MUST have 2-4 options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer ("Type something." row is appended automatically to single-select questions) or pick "Chat about this" to abandon the questionnaire.',
	'Set multiSelect: true when multiple answers are valid; this suppresses the "Type something." row. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. NOTE: any non-empty preview on a single-select question ALSO suppresses the "Type something." row (no room in the side-by-side layout); "Chat about this" remains as the free-form escape hatch. If you recommend a specific option, make it the first option and append "(Recommended)" to its label.',
	"Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters,

		// ponytail: execute does almost nothing. tool_execution_start already shipped
		// the full args to the browser; input(MARKER) just blocks until the browser
		// replies with the JSON-encoded result. Build the envelope, return it.
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return toolResult(ERROR_NO_UI, {
					answers: [],
					cancelled: true,
					error: "no_ui",
				});
			}
			const json = await ctx.ui.input(ASK_MARKER, ASK_MARKER);
			let result: QuestionnaireResult | null = null;
			try {
				result = json ? (JSON.parse(json) as QuestionnaireResult) : null;
			} catch {
				result = null;
			}
			if (!result || typeof result !== "object") {
				result = { answers: [], cancelled: true };
			}
			return buildResponse(
				result,
				(params as { questions?: QuestionLike[] }) || {},
			);
		},
	});
}
