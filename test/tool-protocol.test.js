// tool-protocol.js extraction tests (plan 2.7 / R§2.9)
const assert = require("assert/strict");
const {
	toolCallsInMessage,
	toolResultInMessage,
	toolExecutionUpdateInEvent,
	toolContentText,
} = require("../public/tool-protocol.js");

let pass = 0;
function ok(name, cond) {
	if (!cond) throw new Error("FAIL: " + name);
	pass++;
	console.log("  ✓ " + name);
}

// ---- toolContentText (the headline flatten) ----
// 1. array of text parts (our common case)
ok(
	"text array",
	toolContentText([{ type: "text", text: "a" }, { type: "text", text: "b" }]) === "a\nb",
);
// 2. single string
ok("string", toolContentText("hello") === "hello");
// 3. nested {content: {content: [...]}} — the shape our old code dropped
ok(
	"nested twice",
	toolContentText({ content: { content: [{ type: "text", text: "deep" }] } }) === "deep",
);
// 4. nested one level with array
ok(
	"nested once",
	toolContentText({ content: [{ type: "text", text: "x" }] }) === "x",
);
// 5. non-text parts ignored
ok(
	"ignores non-text",
	toolContentText([{ type: "image", data: "x" }, { type: "text", text: "only" }]) === "only",
);
// 6. null/undefined
ok("null", toolContentText(null) === "");
ok("undefined", toolContentText(undefined) === "");
// 7. empty array
ok("empty array", toolContentText([]) === "");
// 8. non-object garbage
ok("number", toolContentText(42) === "");

// ---- toolCallsInMessage ----
// 9. assistant message with tool calls
{
	const calls = toolCallsInMessage({
		role: "assistant",
		content: [
			{ type: "text", text: "thinking..." },
			{ type: "toolCall", id: "c1", name: "read", arguments: { path: "/a" } },
			{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "ls" } },
		],
	});
	ok("2 calls found", calls.length === 2);
	ok("call0 args", JSON.stringify(calls[0].args) === JSON.stringify({ path: "/a" }));
	ok("call1 name", calls[1].name === "bash");
}
// 10. non-assistant message -> []
ok("non-assistant empty", toolCallsInMessage({ role: "user", content: [] }).length === 0);
// 11. malformed call parts skipped
{
	const calls = toolCallsInMessage({
		role: "assistant",
		content: [{ type: "toolCall", id: "x" }, { type: "text", text: "hi" }],
	});
	ok("malformed skipped", calls.length === 0);
}

// ---- toolResultInMessage ----
// 12. valid result
{
	const r = toolResultInMessage({
		role: "toolResult",
		toolCallId: "c1",
		toolName: "read",
		content: [{ type: "text", text: "file" }],
	});
	ok("result parsed", r && r.toolCallId === "c1" && r.isError === false);
}
// 13. error flag preserved
ok(
	"error flag",
	toolResultInMessage({ role: "toolResult", toolCallId: "c", toolName: "x", isError: true })
		.isError === true,
);
// 14. invalid -> null
ok(
	"invalid result null",
	toolResultInMessage({ role: "toolResult", toolName: "x" }) === null,
);

// ---- toolExecutionUpdateInEvent ----
// 15. valid partial result
{
	const u = toolExecutionUpdateInEvent({
		type: "tool_execution_update",
		toolCallId: "c1",
		toolName: "bash",
		partialResult: { content: [{ type: "text", text: "out" }], details: { mode: "single" } },
	});
	ok("update parsed", u && u.partialResult.toolCallId === "c1");
	ok("update details", u && isObj(u.partialResult.details));
}
// 16. missing partial -> null
ok(
	"update no partial null",
	toolExecutionUpdateInEvent({ type: "tool_execution_update", toolCallId: "c", toolName: "x" }) ===
		null,
);

function isObj(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

console.log("\n" + pass + " passed");
