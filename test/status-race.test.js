// test/status-race.test.js — regression guard for the "stuck writing…" bug.
// Zero-dep. Two layers:
//   1. source-level audit of public/app.js — the fetchSnapshot race guard
//      (snap-recheck) must exist with the right structure: agentStarts bumped
//      on agent_start (live AND replay), snapRecheckStarts captured AFTER the
//      replay, finalizeDeadTurn used by BOTH finalize paths.
//   2. a state-machine simulation of the guard's exact semantics — proves the
//      stale-snapshot case converges to "ready" and a new turn starting while
//      the recheck is in flight is never clobbered.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const lines = app.split("\n");

function lineOf(substr) {
	const i = lines.findIndex((l) => l.includes(substr));
	assert.notEqual(i, -1, `expected source to contain: ${substr}`);
	return i;
}

// ---- 1. source-level structure ---------------------------------------------

// agent_start (live AND replay — both go through handle()) bumps the counter.
const agentStartCase = lineOf('case "agent_start":');
assert.ok(
	lines[agentStartCase + 1].includes("agentStarts++"),
	"agent_start bumps agentStarts before anything else",
);
const agentEndCase = lineOf('case "agent_end":');
assert.equal(
	lines[agentEndCase - 1].trim(),
	"break;",
	"agent_start must not fall through and disable streaming controls",
);

// the finalize helper exists and is a function declaration (hoisted, so the
// fetchSnapshot call site above it works).
const helperDecl = lineOf("function finalizeDeadTurn()");
assert.ok(
	lines
		.slice(helperDecl, helperDecl + 8)
		.join("\n")
		.includes('handle({ type: "agent_end" })'),
	"finalizeDeadTurn synthesizes agent_end",
);

// the OLD dead-turn path (snapshot says idle) uses the helper…
const staleIdleBranch = lineOf("if (replayed && !piStreaming)");
assert.ok(
	lines
		.slice(staleIdleBranch, staleIdleBranch + 8)
		.join("\n")
		.includes("finalizeDeadTurn()"),
	"the !piStreaming dead-turn branch calls finalizeDeadTurn",
);

// …and the race guard fires the recheck AFTER the replay (so replay's own
// agent_start bump is already counted when snapRecheckStarts is captured).
const recheckIssue = lineOf('api({ type: "get_state", id: "snap-recheck" })');
const replayCall = lineOf("const replayed = replayLiveEvents(snap.liveEvents)");
assert.ok(
	recheckIssue > replayCall,
	"snap-recheck is issued after replayLiveEvents",
);
assert.ok(
	lines[recheckIssue - 1].includes("snapRecheckStarts = agentStarts"),
	"snapRecheckStarts captured immediately before issuing the recheck",
);

// the recheck RESPONSE handler gates on fresh idle + no-new-turn, and never
// applyState()s the stale bundle back onto the UI.
const recheckHandler = lineOf('p.id === "snap-recheck"');
// the branch body ends at the closing brace before the next else-if; an
// 8-line window covers the nested if + finalizeDeadTurn without spilling into
// the following init-state/applyState line.
const handlerBody = lines.slice(recheckHandler, recheckHandler + 8).join("\n");
assert.ok(
	handlerBody.includes("p.data.isStreaming === false") &&
		handlerBody.includes("agentStarts === snapRecheckStarts"),
	"snap-recheck finalizes only when pi is freshly idle and no new turn started",
);
assert.ok(
	handlerBody.includes("finalizeDeadTurn()"),
	"snap-recheck finalizes via the shared helper",
);
assert.ok(
	!handlerBody.includes("applyState"),
	"snap-recheck must NOT re-apply the stale snapshot state",
);

const applyStateStart = lineOf("function applyState(data)");
const applyStateEnd = lineOf("function applyMessages(messages)");
const applyStateBody = lines.slice(applyStateStart, applyStateEnd).join("\n");
assert.ok(
	applyStateBody.includes("else if (data.isStreaming === false) {") &&
		applyStateBody.includes('setActivity("ready", false);'),
	"authoritative idle state clears a stale activity row",
);
const toolEndCase = lineOf('case "tool_execution_end":');
const toolEndBody = lines.slice(toolEndCase, toolEndCase + 160).join("\n");
assert.ok(
	toolEndBody.includes(
		'setActivity(streaming ? "thinking…" : "ready", streaming)',
	),
	"a late tool end cannot revive activity after agent_end",
);

// ---- 2. state-machine semantics ---------------------------------------------

// Mirror of the app's guard: agentStarts bumps on agent_start; the recheck
// finalizes iff fresh isStreaming===false AND no agent_start since capture.
function makeUI() {
	const ui = { label: "initial", working: false, streaming: false, starts: 0 };
	function setActivity(label, working) {
		if (ui.working === working && ui.label === label) return;
		ui.label = label;
		ui.working = working;
	}
	function handle(ev) {
		if (ev.type === "agent_start") {
			ui.starts++;
			ui.streaming = true;
			setActivity("thinking…", true);
		} else if (ev.type === "text_start") setActivity("writing…", true);
		else if (ev.type === "agent_end") {
			ui.streaming = false;
			setActivity("ready", false);
		}
	}
	return { ui, setActivity, handle };
}

// 2a. THE BUG: snapshot captured mid-turn, turn ends while in flight, live
//     stream consumes agent_end, stale snapshot then applies + replays. Old
//     code stuck at "writing…"; the guard converges to "ready".
{
	const { ui, handle } = makeUI();
	let snapRecheckStarts = -1;
	// live stream: turn starts, snapshot captured mid-turn (buffer held), then…
	handle({ type: "agent_start" });
	handle({ type: "text_start" });
	// …the turn ends; agent_end delivered AND consumed by the live stream.
	handle({ type: "agent_end" });
	// stale snapshot arrives: applyState(isStreaming=true) + replay (agent_start
	// replay bumps the counter — the guard captures AFTER replay).
	handle({ type: "agent_start" });
	handle({ type: "text_start" });
	snapRecheckStarts = ui.starts;
	// fresh recheck response: pi idle, no new turn → finalize.
	assert.equal(snapRecheckStarts, ui.starts);
	assert.equal(ui.streaming, true, "precondition: replay left streaming armed");
	if (ui.streaming) handle({ type: "agent_end" }); // finalizeDeadTurn
	assert.equal(ui.label, "ready", "stale snapshot must converge to ready");
	assert.equal(ui.streaming, false);
}

// 2b. A fresh authoritative idle snapshot clears a stale working indicator.
{
	const ui = {
		streaming: true,
		compacting: true,
		label: "thinking…",
		working: true,
	};
	const applyState = (state) => {
		if (state.isStreaming != null) ui.streaming = state.isStreaming === true;
		if (state.isCompacting != null) ui.compacting = state.isCompacting === true;
		if (state.isCompacting === true) {
			ui.label = "compacting context…";
			ui.working = true;
		} else if (state.isStreaming === true) {
			ui.label = "working…";
			ui.working = true;
		} else if (state.isStreaming === false) {
			ui.label = "ready";
			ui.working = false;
		}
	};
	applyState({ isStreaming: false, isCompacting: false });
	assert.equal(ui.label, "ready");
	assert.equal(ui.working, false);
	assert.equal(ui.streaming, false);
	assert.equal(ui.compacting, false);
}

// 2c. NEW turn started while the recheck was in flight: the guard must NOT
//     finalize the new turn — its own agent_end will land via the live stream.
{
	const { ui, handle } = makeUI();
	let snapRecheckStarts = -1;
	handle({ type: "agent_start" });
	handle({ type: "text_start" });
	snapRecheckStarts = ui.starts; // recheck issued
	// new turn begins before the recheck response arrives
	handle({ type: "agent_start" });
	assert.equal(ui.starts !== snapRecheckStarts, true);
	// stale recheck response (isStreaming captured before the new turn): guard
	// must skip finalize because the counter moved.
	const freshIdle = true;
	if (freshIdle && ui.starts === snapRecheckStarts)
		handle({ type: "agent_end" });
	assert.equal(ui.label, "thinking…", "new turn must not be clobbered");
	// the new turn completes normally.
	handle({ type: "text_start" });
	handle({ type: "agent_end" });
	assert.equal(ui.label, "ready");
}

console.log("status-race.test.js — snapshot race guard passed");
