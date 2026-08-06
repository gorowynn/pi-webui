"use strict";
// Unit tests for compaction-aware message reconstruction (plan F§5.3 / Phase 5.2).
// Verifies the parent-chain walk, per-type mapping, visibility filter, and cycle
// guard — all against synthetic entries shaped like pi's real get_entries output.
//   node test/session-entries.test.js
const assert = require("node:assert/strict");
const { activeSessionMessages, messageFromEntry } = require("../session-entries.js");

let pass = 0;
const ok = (m) => (pass++, console.log("  ok -", m));

// helpers to build entries concisely
const E = (id, parentId, extra) => Object.assign({ id, parentId }, extra);
const M = (role, text) => ({ role, content: [{ type: "text", text }] });

// 1. message entry → its message, in chronological (root→leaf) order.
{
	const entries = [
		E("a", null, { type: "message", message: M("user", "hi") }),
		E("b", "a", { type: "message", message: M("assistant", "hello") }),
	];
	const out = activeSessionMessages(entries, "b");
	assert.equal(out.length, 2);
	assert.equal(out[0].role, "user");
	assert.equal(out[1].role, "assistant");
	ok("message entries map to their messages in chronological order");
}

// 2. a compaction entry becomes a visible custom/compaction marker.
{
	const entries = [
		E("c", null, { type: "compaction", summary: "## Earlier", tokensBefore: 50000 }),
		E("d", "c", { type: "message", message: M("user", "after compact") }),
	];
	const out = activeSessionMessages(entries, "d");
	assert.equal(out.length, 2);
	assert.equal(out[0].role, "custom");
	assert.equal(out[0].customType, "compaction");
	assert.equal(out[0].content, "## Earlier");
	assert.equal(out[0].display, true);
	assert.equal(out[0].tokensBefore, 50000);
	assert.equal(out[1].role, "user");
	ok("compaction entry → custom/compaction marker before the kept messages");
}

// 3. metadata entries (model_change, thinking_level_change) are dropped.
{
	const entries = [
		E("a", null, { type: "model_change", provider: "x", modelId: "y" }),
		E("b", "a", { type: "thinking_level_change" }),
		E("c", "b", { type: "message", message: M("user", "q") }),
	];
	const out = activeSessionMessages(entries, "c");
	assert.equal(out.length, 1);
	assert.equal(out[0].role, "user");
	ok("metadata entries (model_change/thinking_level_change) are filtered out");
}

// 4. custom_message: display:true kept, display:false dropped.
{
	const entries = [
		E("a", null, { type: "custom_message", customType: "note", content: "x", display: true }),
		E("b", "a", { type: "custom_message", customType: "hidden", content: "y", display: false }),
		E("c", "b", { type: "message", message: M("assistant", "a") }),
	];
	const out = activeSessionMessages(entries, "c");
	assert.equal(out.length, 2);
	assert.equal(out[0].customType, "note");
	assert.equal(out[1].role, "assistant");
	ok("custom_message display:true kept, display:false filtered");
}

// 5. cycle guard: a malformed chain (A→B→A) can't loop forever.
{
	const entries = [
		E("a", "b", { type: "message", message: M("user", "a") }),
		E("b", "a", { type: "message", message: M("user", "b") }),
	];
	const out = activeSessionMessages(entries, "a");
	// visits a then b then sees a again (visited) → stops. Both included once.
	assert.equal(out.length, 2);
	ok("cycle in parent-chain is bounded (no infinite loop)");
}

// 6. truncated fetch: a parentId pointing at a missing entry stops cleanly.
{
	const entries = [
		E("a", "MISSING", { type: "message", message: M("user", "x") }),
	];
	const out = activeSessionMessages(entries, "a");
	assert.equal(out.length, 1);
	assert.equal(out[0].role, "user");
	ok("missing parent entry breaks the walk cleanly (no throw)");
}

// 7. bad leafId → [].
{
	const entries = [E("a", null, { type: "message", message: M("user", "x") })];
	assert.deepEqual(activeSessionMessages(entries, null), []);
	assert.deepEqual(activeSessionMessages(entries, undefined), []);
	assert.deepEqual(activeSessionMessages(entries, "nope"), []);
	assert.deepEqual(activeSessionMessages(null, "a"), []);
	assert.deepEqual(activeSessionMessages([], "a"), []);
	ok("non-string/unknown leafId or missing entries → []");
}

// 8. toolResult messages survive (they render as tool cards, not dropped).
{
	const entries = [
		E("a", null, { type: "message", message: M("assistant", "thinking") }),
		E("b", "a", { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "42" }], toolCallId: "t1", toolName: "read" } }),
	];
	const out = activeSessionMessages(entries, "b");
	assert.equal(out.length, 2);
	assert.equal(out[1].role, "toolResult");
	ok("toolResult messages are kept (render as tool cards)");
}

// 9. messageFromEntry per-type contract (direct unit test).
{
	assert.equal(messageFromEntry(null).length, 0);
	assert.equal(messageFromEntry({ type: "model_change" }).length, 0);
	assert.equal(messageFromEntry({ type: "message" }).length, 0); // no .message
	assert.equal(
		messageFromEntry({ type: "message", message: { role: "user" } }).length,
		1,
	);
	assert.equal(messageFromEntry({ type: "compaction" }).length, 0); // no summary
	assert.equal(
		messageFromEntry({ type: "compaction", summary: "s" })[0].customType,
		"compaction",
	);
	assert.equal(messageFromEntry({ type: "custom_message" }).length, 0); // no customType
	assert.equal(
		messageFromEntry({ type: "custom_message", customType: "x" })[0].role,
		"custom",
	);
	ok("messageFromEntry per-type shape contract holds");
}

// 10. compaction appears at the RIGHT place: between the dropped (pre-compact)
//     messages and the kept (post-compact) ones — root→leaf order preserved.
{
	// chain: oldUser → oldAsst → COMPACTION → newUser
	const entries = [
		E("u1", null, { type: "message", message: M("user", "old q") }),
		E("a1", "u1", { type: "message", message: M("assistant", "old a") }),
		E("cmp", "a1", { type: "compaction", summary: "## Summary of old" }),
		E("u2", "cmp", { type: "message", message: M("user", "new q") }),
	];
	const out = activeSessionMessages(entries, "u2");
	assert.deepEqual(
		out.map((m) => m.role),
		["user", "assistant", "custom", "user"],
	);
	assert.equal(out[2].content, "## Summary of old");
	ok("compaction marker lands between pre- and post-compact messages");
}

console.log(`\n${pass} passed`);
