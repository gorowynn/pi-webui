"use strict";
// Current-turn event buffer for live reconnect replay (plan F§5.2 / Phase 5.1).
//
// Keeps the IN-FLIGHT agent turn's events (agent_start → … → last event, NO
// agent_end) so a reconnecting tab can rebuild in-flight tool cards + streaming
// text instead of losing them. The buffer is reset on agent_start (new turn) and
// cleared on agent_end (turn committed → get_messages has it; replaying it would
// duplicate). Only turn-content events are buffered (the handle() switch in
// app.js): command/response/state/compaction events are excluded so replay can't
// re-trigger side effects (switch_session, set_model, …).
//
// Every pi event is also assigned a monotonic `sequence` (returned from push,
// attached to the SSE broadcast wrapper) for observability + a foundation for
// future incremental (gap-only) replay. The current client replays the whole
// buffer after a transcript clear, so the sequence isn't used to filter yet.
//
// Pure CommonJS, no deps. Self-test:
//   node -e "const b=require('./livebuf.js').createLiveBuffer(); b.push({type:'agent_start'}); console.log(b.snapshot().length)"

// Turn-content events handle() renders into the transcript. These are the only
// events ever buffered: agent_start / agent_end are turn BOUNDARIES (handled
// explicitly below — start seeds, end clears) and everything else pi emits
// (response = RPC reply, command = switch_session/set_model/…, compaction_*,
// auto_retry_start, queue_update, session_info_changed) is a state/control event
// — replaying it would re-fire side effects, so it's kept out of the buffer.
const TURN_EVENT = new Set([
	"message_start",
	"message_update",
	"message_end",
	"tool_execution_start",
	"tool_execution_update",
	"tool_execution_end",
]);

function createLiveBuffer() {
	let seq = 0;
	let buf = []; // [{sequence, payload}]

	return {
		// Assign the next sequence and buffer the event if it's turn content.
		// Returns the assigned sequence (the caller attaches it to the SSE
		// broadcast wrapper — NOT to pi's payload, which stays untouched).
		push(obj) {
			const s = ++seq;
			if (!obj || typeof obj.type !== "string") return s;
			if (obj.type === "agent_start") {
				// new turn — start fresh (discard any prior partial turn)
				buf = [{ sequence: s, payload: obj }];
			} else if (obj.type === "agent_end") {
				// turn committed → get_messages has it; drop so a later reconnect
				// replays from messages, not a duplicate of the buffered turn.
				buf = [];
			} else if (buf.length && TURN_EVENT.has(obj.type)) {
				// only buffer turn content WITHIN a turn (after agent_start, before
				// agent_end). A stray message_update outside a turn is ignored.
				buf.push({ sequence: s, payload: obj });
			}
			return s;
		},
		// Point-in-time shallow copy for /api/snapshot. The endpoint awaits its RPC
		// fan-out first, then calls this + JSON.stringify synchronously, so a push()
		// landing mid-snapshot can't mutate the returned array: buf = […] on
		// agent_start/end rebinds to a NEW array (the copy is independent), and
		// push() mutates the live array, not this slice. Payload objects are shared
		// (never mutated), which is safe.
		snapshot() {
			return buf.slice();
		},
		// Drop the buffer without resetting the sequence counter. Used on workspace
		// switch: the old project's in-flight turn must not leak into the new one's
		// transcript when tabs resync off the workspace_changed broadcast.
		clear() {
			buf = [];
		},
		// last assigned sequence (observability / tests)
		seq() {
			return seq;
		},
	};
}

module.exports = { createLiveBuffer, TURN_EVENT };
