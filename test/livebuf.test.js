"use strict";
// Unit tests for the current-turn live-event buffer (plan F§5.2 / Phase 5.1).
// The buffer is the whole reconnect-replay mechanism's correctness core, so it's
// exhaustively tested here (the client side is a thin `for…handle(payload)` loop
// over the same function live events use).   node test/livebuf.test.js
const assert = require("node:assert/strict");
const { createLiveBuffer, TURN_EVENT } = require("../livebuf.js");

let pass = 0;
const ok = (m) => (pass++, console.log("  ok -", m));

// 1. sequence is monotonic and assigned to EVERY event (even non-turn ones —
//    it tags the broadcast wrapper, independent of buffering).
{
	const b = createLiveBuffer();
	const s1 = b.push({ type: "response", id: "x" });
	const s2 = b.push({ type: "agent_start" });
	const s3 = b.push({ type: "compaction_start" });
	assert.ok(s1 < s2 && s2 < s3, "seq must increase");
	assert.equal(b.seq(), s3);
	ok("sequence is monotonic across all event types");
}

// 2. agent_start seeds the buffer with exactly itself.
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	const snap = b.snapshot();
	assert.equal(snap.length, 1);
	assert.equal(snap[0].payload.type, "agent_start");
	ok("agent_start seeds the buffer");
}

// 3. turn-content events append within a turn, preserving order + sequence.
{
	const b = createLiveBuffer();
	const sa = b.push({ type: "agent_start" });
	const su = b.push({
		type: "message_update",
		assistantMessageEvent: { type: "text_delta", delta: "hi" },
	});
	const st = b.push({
		type: "tool_execution_start",
		toolCallId: "t1",
		toolName: "read",
	});
	const snap = b.snapshot();
	assert.equal(snap.length, 3);
	assert.deepEqual(
		snap.map((e) => e.payload.type),
		["agent_start", "message_update", "tool_execution_start"],
	);
	assert.deepEqual(snap.map((e) => e.sequence), [sa, su, st]);
	ok("turn events append in order with their sequences");
}

// 4. agent_end clears the buffer (turn is committed → get_messages has it).
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta" } });
	b.push({ type: "agent_end" });
	assert.equal(b.snapshot().length, 0);
	ok("agent_end clears the buffer");
}

// 5. turn events OUTSIDE a turn are NOT buffered (before agent_start, or after
//    agent_end). Guards against a stray message_update with no open turn.
{
	const b = createLiveBuffer();
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta" } });
	b.push({ type: "tool_execution_end", toolCallId: "x" });
	assert.equal(b.snapshot().length, 0, "events before agent_start are dropped");
	b.push({ type: "agent_start" });
	b.push({ type: "agent_end" });
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta" } });
	assert.equal(b.snapshot().length, 0, "events after agent_end are dropped");
	ok("turn events outside a turn are not buffered");
}

// 6. non-turn events never enter the buffer (but still consume a sequence).
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	const before = b.seq();
	b.push({ type: "response", id: "r", success: true });
	b.push({ type: "command", command: "set_model", data: {} });
	b.push({ type: "compaction_start" });
	b.push({ type: "auto_retry_start" });
	b.push({ type: "queue_update" });
	b.push({ type: "session_info_changed" });
	const snap = b.snapshot();
	assert.equal(snap.length, 1, "only the agent_start is buffered");
	assert.equal(snap[0].payload.type, "agent_start");
	assert.ok(b.seq() > before, "non-turn events still advanced the sequence");
	ok("non-turn events (response/command/compaction/…) are never buffered");
}

// 7. a second agent_start discards the prior partial turn (new turn wins).
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "old" } });
	b.push({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash" });
	b.push({ type: "agent_start" }); // restart mid-turn
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "new" } });
	const snap = b.snapshot();
	assert.equal(snap.length, 2);
	assert.equal(snap[0].payload.type, "agent_start");
	assert.equal(snap[1].payload.assistantMessageEvent.delta, "new");
	ok("agent_start discards the prior partial turn");
}

// 8. snapshot() returns an independent copy — push() after snapshot doesn't
//    mutate it, and the payloads are shared (not deep-cloned).
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	const evt = { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "z" } };
	b.push(evt);
	const snap = b.snapshot();
	b.push({ type: "tool_execution_start", toolCallId: "t", toolName: "read" });
	assert.equal(snap.length, 2, "post-snapshot push didn't affect the copy");
	assert.equal(b.snapshot().length, 3, "live buffer did grow");
	assert.equal(snap[1].payload, evt, "payload objects are shared (not cloned)");
	ok("snapshot() is a point-in-time copy; payloads shared");
}

// 9. clear() empties the buffer but keeps the sequence monotonic (workspace
//    switch must not leak the old turn, and seq must not go backwards).
{
	const b = createLiveBuffer();
	b.push({ type: "agent_start" });
	b.push({ type: "message_update", assistantMessageEvent: { type: "text_delta" } });
	const sBefore = b.seq();
	b.clear();
	assert.equal(b.snapshot().length, 0);
	const sAfter = b.push({ type: "agent_start" });
	assert.ok(sAfter > sBefore, "sequence did not reset");
	ok("clear() empties the buffer, sequence stays monotonic");
}

// 10. TURN_EVENT is exactly the 6 message/tool events buffered via push();
//    agent_start/agent_end are turn BOUNDARIES handled explicitly (not in set).
{
	assert.deepEqual(
		[...TURN_EVENT].sort(),
		[
			"message_end",
			"message_start",
			"message_update",
			"tool_execution_end",
			"tool_execution_start",
			"tool_execution_update",
		],
	);
	assert.ok(!TURN_EVENT.has("agent_start") && !TURN_EVENT.has("agent_end"));
	assert.ok(!TURN_EVENT.has("response") && !TURN_EVENT.has("compaction_start"));
	ok("TURN_EVENT = the 6 buffered types; boundaries + control events excluded");
}

console.log(`\n${pass} passed`);
