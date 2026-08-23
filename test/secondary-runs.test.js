/* secondary-runs.js — pure lifecycle/safety contract */

const assert = require("assert/strict");
const {
	SECONDARY_STATES,
	DEFAULT_LIMITS,
	boundedText,
	normalizeLimits,
	createRun,
	transitionRun,
	cancelRun,
	safeError,
	publicRun,
} = require("../secondary-runs.js");

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

ok("exposes the six lifecycle states", () => {
	assert.deepEqual(SECONDARY_STATES, [
		"queued",
		"running",
		"completed",
		"failed",
		"cancelled",
		"expired",
	]);
});

ok("bounds text and reports truncation", () => {
	assert.deepEqual(boundedText("abcdef", 4), { text: "abcd", truncated: true });
	assert.deepEqual(boundedText("abcd", 4), { text: "abcd", truncated: false });
	assert.deepEqual(boundedText(null, 4), { text: "", truncated: false });
});

ok("normalizes caps and never raises the configured ceilings", () => {
	const limits = normalizeLimits({
		contextChars: 999999,
		outputChars: 100,
		timeoutMs: 1,
		threadTurns: 999,
	});
	assert.equal(limits.contextChars, DEFAULT_LIMITS.contextChars);
	assert.equal(limits.outputChars, 100);
	assert.equal(limits.timeoutMs, 1);
	assert.equal(limits.threadTurns, DEFAULT_LIMITS.threadTurns);
	assert.deepEqual(normalizeLimits({}), DEFAULT_LIMITS);
});

ok("creates a queued run without retaining input text", () => {
	const run = createRun({
		id: "secondary-1",
		kind: "side-question",
		inputTruncated: true,
		createdAt: 10,
	});
	assert.deepEqual(run, {
		id: "secondary-1",
		kind: "side-question",
		status: "queued",
		createdAt: 10,
		startedAt: null,
		finishedAt: null,
		inputTruncated: true,
		outputTruncated: false,
		cancelRequested: false,
		result: null,
		error: null,
	});
	assert.throws(() => createRun({}), /id is required/);
});

ok("allows queued → running → completed", () => {
	const queued = createRun({ id: "secondary-2" });
	const running = transitionRun(queued, "running");
	assert.equal(running.ok, true);
	assert.equal(running.run.status, "running");
	assert.ok(running.run.startedAt != null);
	const done = transitionRun(running.run, "completed", {
		result: { text: "answer" },
		outputTruncated: true,
	});
	assert.equal(done.ok, true);
	assert.equal(done.run.status, "completed");
	assert.ok(done.run.finishedAt != null);
	assert.equal(done.run.result.text, "answer");
	assert.equal(done.run.outputTruncated, true);
});

ok("rejects invalid transitions and late terminal responses", () => {
	const queued = createRun({ id: "secondary-3" });
	assert.equal(transitionRun(queued, "completed").ok, false);
	const done = transitionRun(queued, "failed", { error: { code: "X" } }).run;
	assert.deepEqual(transitionRun(done, "completed"), {
		ok: false,
		reason: "terminal",
	});
});

ok("cancels queued or running work exactly once", () => {
	const running = transitionRun(createRun({ id: "secondary-4" }), "running").run;
	const cancelled = cancelRun(running, "ignored detail");
	assert.equal(cancelled.ok, true);
	assert.equal(cancelled.run.status, "cancelled");
	assert.equal(cancelled.run.cancelRequested, true);
	assert.equal(cancelled.run.error.code, "SECONDARY_CANCELLED");
	assert.equal(cancelRun(cancelled.run).ok, false);
});

ok("maps internal errors to bounded public errors", () => {
	assert.deepEqual(
		safeError({ code: "SECONDARY_TIMEOUT", message: "C:\\secret\\token=abc" }),
		{
			code: "SECONDARY_TIMEOUT",
			message: "secondary run timed out",
		},
	);
	assert.deepEqual(
		safeError({ code: "UNKNOWN", message: "/home/user/.env API_KEY=secret" }),
		{
			code: "UNKNOWN",
			message: "secondary run failed",
		},
	);
	assert.deepEqual(
		safeError({
			code: "SECONDARY_MODEL",
			message: "OAuth refresh failed with 401",
		}),
		{
			code: "SECONDARY_MODEL",
			message: "model authentication failed; check Pi login",
		},
	);
});

ok("publicRun omits private input and exposes bounded result metadata", () => {
	const running = transitionRun(createRun({ id: "secondary-5" }), "running").run;
	const run = transitionRun(running, "completed", {
		result: { text: "answer", privatePrompt: "do not expose" },
		outputTruncated: true,
		error: null,
	}).run;
	const pub = publicRun(run);
	assert.equal(pub.result.text, "answer");
	assert.equal("privatePrompt" in pub.result, false);
	assert.equal("prompt" in pub, false);
	assert.equal(pub.outputTruncated, true);
});

console.log("\n" + pass + " passed");
