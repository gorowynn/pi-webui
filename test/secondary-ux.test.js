/* secondary-ux.js — pure side-question projections */

const assert = require("node:assert/strict");
const ux = require("../public/secondary-ux.js");

let pass = 0;
function ok(name, fn) {
	try {
		fn();
		pass++;
		console.log("  ok - " + name);
	} catch (error) {
		console.error("  FAIL - " + name + "\n    " + error.message);
		process.exitCode = 1;
	}
}

ok("flattens text content without including tool payloads", () => {
	assert.equal(
		ux.contentText([{ type: "text", text: "hello" }, { type: "toolCall" }]),
		"hello",
	);
	assert.equal(ux.contentText("plain"), "plain");
});

ok("builds a bounded primary context snapshot", () => {
	const out = ux.contextSnapshot(
		[
			{ role: "user", content: "question" },
			{ role: "assistant", content: [{ type: "text", text: "answer" }] },
			{ role: "tool", content: "secret tool output" },
		],
		12,
	);
	assert.equal(out.text, "user: questi");
	assert.equal(out.truncated, true);
});

ok("keeps only the newest bounded side-thread turns", () => {
	const thread = ux.addTurn([], "user", "one", 2);
	const next = ux.addTurn(
		ux.addTurn(thread, "assistant", "two", 2),
		"user",
		"three",
		2,
	);
	assert.deepEqual(next, [
		{ role: "assistant", text: "two" },
		{ role: "user", text: "three" },
	]);
	assert.notEqual(next, thread);
});

ok("normalizes statuses and cancellation affordances", () => {
	const running = ux.normalizeRun({ id: "r1", status: "running" });
	assert.equal(running.label, "thinking…");
	assert.equal(running.active, true);
	assert.equal(ux.canCancel(running), true);
	assert.equal(ux.canSubmit(running), false);
	const done = ux.normalizeRun({
		id: "r1",
		status: "completed",
		result: { text: "ok" },
	});
	assert.equal(done.label, "ready");
	assert.equal(ux.canCancel(done), false);
	assert.equal(ux.canSubmit(done), true);
});

ok("unknown status is conservative and non-active", () => {
	const run = ux.normalizeRun({ id: "r2", status: "surprise" });
	assert.equal(run.status, "failed");
	assert.equal(run.active, false);
	assert.equal(ux.canCancel(run), false);
});

ok("accepts the server run after the local pending placeholder", () => {
	assert.equal(
		ux.shouldApplyRun(
			{ id: "pending", status: "queued" },
			{ id: "secondary-1", status: "running" },
		),
		true,
	);
	assert.equal(
		ux.shouldApplyRun(
			{ id: "secondary-1", status: "running" },
			{ id: "secondary-2", status: "running" },
		),
		false,
	);
	assert.equal(
		ux.shouldApplyRun(
			{ id: "secondary-1", status: "running" },
			{ id: "secondary-1", status: "completed" },
		),
		true,
	);
});

console.log("\n" + pass + " passed");
