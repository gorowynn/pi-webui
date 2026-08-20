/*
 * subagents.test.js — node:assert/strict unit tests for subagents.js (the
 * pi-subagents async fleet file-inbox bridge). Uses a fake temp root via the
 * opts.roots injection (no env mutation), mirroring the plugin's on-disk
 * layout: async-subagent-runs/<id>/status.json + control/ inbox.
 */

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	listSubagentRuns,
	readRunLog,
	deliverControl,
	discoverRoots,
} = require("../subagents.js");

let pass = 0;
function ok(name, cond) {
	if (cond) {
		pass++;
		console.log("  ok - " + name);
	} else {
		console.error("  FAIL - " + name);
		process.exitCode = 1;
	}
}

function mkRoot() {
	// NOT named pi-subagents-* — the scan filter must not pick test roots up
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "piw-sa-test-"));
	process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}
function mkRun(root, id, status) {
	const dir = path.join(root, "async-subagent-runs", id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(status));
	return dir;
}
// happy-path deliverControl: records a failure instead of crashing the harness
function mustDeliver(input, root) {
	try {
		return deliverControl(input, { roots: [root] });
	} catch (e) {
		ok("deliverControl happy path threw: " + e.message, false);
		return null;
	}
}
// parse a control artifact, recording a failure instead of crashing
function readJsonOk(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		ok("read " + path.basename(file) + ": " + e.message, false);
		return undefined;
	}
}

// ---- listing ----
{
	const root = mkRoot();
	mkRun(root, "run-active", {
		runId: "uuid-a",
		state: "running",
		mode: "workflow",
		startedAt: 2000,
		currentTool: "bash",
		turnCount: 3,
		steps: [
			{
				index: 0,
				agent: "worker",
				status: "running",
				description: "fix tests",
			},
			{ index: 1, agent: "reviewer", status: "pending" },
		],
	});
	mkRun(root, "run-done", {
		runId: "uuid-b",
		state: "complete",
		startedAt: 1000,
		endedAt: 1500,
		steps: [{ index: 0, agent: "worker", status: "completed" }],
	});
	// malformed status.json must be skipped, not throw
	const bad = path.join(root, "async-subagent-runs", "run-bad");
	fs.mkdirSync(bad, { recursive: true });
	fs.writeFileSync(path.join(bad, "status.json"), "{ not json");

	const runs = listSubagentRuns({ roots: [root] });
	ok("lists 2 valid runs", runs.length === 2);
	ok(
		"dir attached for server-side use",
		runs.every((r) => typeof r.dir === "string"),
	);
	ok("active sorts first", runs[0].id === "run-active");
	ok(
		"steps projected",
		runs[0].steps.length === 2 && runs[0].steps[0].agent === "worker",
	);
	ok(
		"completed step normalized to complete chip state",
		runs[1].steps[0].status === "completed",
	);

	const pub = runs.map(({ dir, ...rest }) => rest);
	ok(
		"dir is strippable for the client payload",
		pub.every((r) => !("dir" in r)),
	);
}

// ---- id validation / unknown runs ----
{
	const root = mkRoot();
	const runs = listSubagentRuns({ roots: [root] });
	ok("empty root lists nothing", runs.length === 0);
	assert.throws(
		() => deliverControl({ id: "../evil", action: "stop" }, { roots: [root] }),
		/invalid run id/,
	);
	assert.throws(
		() => deliverControl({ id: "nope", action: "detonate" }, { roots: [root] }),
		/must be 'stop', 'force' or 'steer'/,
	);
	assert.throws(
		() => deliverControl({ id: "nope", action: "stop" }, { roots: [root] }),
		/unknown run/,
	);
	assert.throws(
		() => deliverControl({ id: "nope", action: "detonate" }, { roots: [root] }),
		/action/,
	);
	ok("traversal + unknown ids rejected", true);
}

// ---- stop delivery (plugin's control/stop.json inbox) ----
{
	const root = mkRoot();
	const dir = mkRun(root, "run-x", {
		runId: "x",
		state: "running",
		startedAt: 1,
	});
	const out = mustDeliver({ id: "run-x", action: "stop" }, root);
	ok("stop delivered", out.delivered === "stop");
	const stop = readJsonOk(path.join(dir, "control", "stop.json"));
	ok(
		"stop.json shape matches the plugin contract",
		!!stop &&
			stop.type === "stop" &&
			typeof stop.ts === "number" &&
			stop.source === "pi-webui",
	);
	ok(
		"no temp files left behind",
		fs.readdirSync(path.join(dir, "control")).filter((f) => f.includes(".tmp-"))
			.length === 0,
	);
	// stopRequested shows in the listing while the run is still active
	let listed = listSubagentRuns({ roots: [root] });
	ok("stopRequested projected while active", listed[0].stopRequested === true);
	// a terminal run with a stale stop.json does NOT report stopping
	fs.writeFileSync(
		path.join(dir, "status.json"),
		JSON.stringify({ runId: "x", state: "complete", startedAt: 1 }),
	);
	listed = listSubagentRuns({ roots: [root] });
	ok("stopRequested false once terminal", listed[0].stopRequested === false);
}

// ---- force stop (timeout.json — the decisive kill path) ----
{
	const root = mkRoot();
	const dir = mkRun(root, "run-f", {
		runId: "f",
		state: "running",
		startedAt: 1,
	});
	const out = mustDeliver({ id: "run-f", action: "force" }, root);
	ok("force delivered", out.delivered === "force");
	const t = readJsonOk(path.join(dir, "control", "timeout.json"));
	ok(
		"timeout.json shape matches the plugin contract",
		!!t &&
			t.type === "timeout" &&
			typeof t.ts === "number" &&
			t.source === "pi-webui",
	);
}

// ---- steer delivery (control/steer-requests/<padded-ts>-<b64url>.json) ----
{
	const root = mkRoot();
	const dir = mkRun(root, "run-y", {
		runId: "y",
		state: "running",
		startedAt: 1,
	});
	const out = mustDeliver(
		{
			id: "run-y",
			action: "steer",
			message: "focus on the parser",
			targetIndex: 1,
		},
		root,
	);
	ok(
		"steer delivered with requestId",
		out.delivered === "steer" && /^webui-/.test(out.requestId),
	);
	const sdir = path.join(dir, "control", "steer-requests");
	const files = fs.readdirSync(sdir);
	ok("one steer request file", files.length === 1);
	ok(
		"filename is <13-padded-ts>-<base64url>.json",
		/^\d{13}-[A-Za-z0-9_-]+\.json$/.test(files[0]),
	);
	const req = readJsonOk(path.join(sdir, files[0]));
	ok(
		"steer request shape matches the plugin contract",
		req.type === "steer" &&
			req.message === "focus on the parser" &&
			req.targetIndex === 1 &&
			typeof req.id === "string" &&
			typeof req.ts === "number",
	);
	assert.throws(
		() =>
			deliverControl(
				{ id: "run-y", action: "steer", message: "  " },
				{ roots: [root] },
			),
		/not be empty/,
	);
	assert.throws(
		() =>
			deliverControl(
				{ id: "run-y", action: "steer", message: "x".repeat(40 * 1024) },
				{ roots: [root] },
			),
		/too large/,
	);
	assert.throws(
		() =>
			deliverControl(
				{ id: "run-y", action: "steer", message: "x", targetIndex: -1 },
				{ roots: [root] },
			),
		/targetIndex/,
	);
	ok("empty / oversized / bad-index steer rejected", true);
}

// ---- log tailing ----
{
	const root = mkRoot();
	const dir = mkRun(root, "run-z", {
		runId: "z",
		state: "complete",
		startedAt: 1,
		endedAt: 2,
	});
	fs.writeFileSync(path.join(dir, "output-0.log"), "line1\nline2\n");
	fs.writeFileSync(path.join(dir, "subagent-log-uuid-z.md"), "# run log\nbody");
	let log = readRunLog("run-z", 0, "output", { roots: [root] });
	ok("step output log read", log && log.text.includes("line2"));
	log = readRunLog("run-z", undefined, "run", { roots: [root] });
	ok(
		"run markdown log found by prefix glob",
		log &&
			log.name === "subagent-log-uuid-z.md" &&
			log.text.includes("# run log"),
	);
	ok(
		"bad step rejected",
		readRunLog("run-z", 5, "output", { roots: [root] }) === null,
	);
	ok(
		"traversal id rejected",
		readRunLog("../../etc", 0, "output", { roots: [root] }) === null,
	);
	ok(
		"unknown id rejected",
		readRunLog("ghost", 0, "output", { roots: [root] }) === null,
	);

	// tail-only for big logs
	fs.writeFileSync(
		path.join(dir, "output-1.log"),
		"x".repeat(64 * 1024) + "TAILMARK",
	);
	log = readRunLog("run-z", 1, "output", { roots: [root] });
	ok(
		"big log tailed to 32 KB",
		log.truncated === true &&
			log.text.length <= 32 * 1024 + 16 &&
			log.text.endsWith("TAILMARK"),
	);
}

// ---- workflow-step fallback: project-local transcript in <cwd>/.pi-subagents ----
{
	const root = mkRoot();
	// fake project dir (cwd referenced by status.json)
	const proj = fs.mkdtempSync(path.join(os.tmpdir(), "piw-sa-proj-"));
	process.on("exit", () => fs.rmSync(proj, { recursive: true, force: true }));
	const art = path.join(proj, ".pi-subagents", "artifacts");
	fs.mkdirSync(art, { recursive: true });
	const rec = (o) => JSON.stringify(o);
	// the real child transcript: first record ts ≈ step.startedAt
	fs.writeFileSync(
		path.join(art, "c3e2e679_worker_0_transcript.jsonl"),
		[
			rec({
				recordType: "message",
				role: "user",
				ts: 100100,
				text: "count the lines",
			}),
			rec({
				recordType: "tool_start",
				toolName: "bash",
				argsPreview: "wc -l app.js",
			}),
			rec({ recordType: "tool_end", toolName: "bash", isError: false }),
			rec({
				recordType: "message",
				role: "assistant",
				ts: 100200,
				text: "app.js: 6468 lines",
			}),
		].join("\n"),
	);
	// decoy from an older run of the same agent (ts far away)
	fs.writeFileSync(
		path.join(art, "aaaa0000_worker_0_transcript.jsonl"),
		[
			rec({
				recordType: "message",
				role: "user",
				ts: 100100 - 600000,
				text: "old task",
			}),
		].join("\n"),
	);
	mkRun(root, "run-w", {
		runId: "w",
		state: "running",
		startedAt: 100000,
		cwd: proj,
		steps: [
			{ agent: "worker", status: "running", startedAt: 100000 },
			{ agent: "scout", status: "running", startedAt: 100050 },
		],
	});
	// step 0 (worker): no output-0.log exists → transcript fallback, correlated
	// by agent + nearest ts (NOT the decoy)
	const log = readRunLog("run-w", 0, "output", { roots: [root] });
	ok(
		"workflow step falls back to project transcript",
		log && log.name === "c3e2e679_worker_0_transcript.jsonl",
	);
	ok(
		"transcript formatted readable",
		log.text.includes("→ bash wc -l app.js") &&
			log.text.includes("app.js: 6468 lines") &&
			log.text.includes("▸ count the lines"),
	);
	ok("transcript not the decoy", !log.text.includes("old task"));
	// step 1 (scout): no transcript → null (button shows no log)
	ok(
		"missing transcript step yields null",
		readRunLog("run-w", 1, "output", { roots: [root] }) === null,
	);
}

// ---- same-agent parallel children: sessionFile correlation wins over ts ----
{
	const root = mkRoot();
	const proj = fs.mkdtempSync(path.join(os.tmpdir(), "piw-sa-proj-"));
	process.on("exit", () => fs.rmSync(proj, { recursive: true, force: true }));
	const art = path.join(proj, ".pi-subagents", "artifacts");
	fs.mkdirSync(art, { recursive: true });
	const rec = (o) => JSON.stringify(o);
	// two delegate children spawned 100 ms apart — ts-proximity alone
	// cross-matched them (seen live: step 1 showed GAMMA instead of DELTA)
	fs.writeFileSync(
		path.join(art, "4bc84e84_delegate_0_transcript.jsonl"),
		[
			rec({
				recordType: "message",
				role: "user",
				ts: 100050,
				text: "say GAMMA",
			}),
			rec({
				recordType: "message",
				role: "assistant",
				ts: 100100,
				text: "GAMMA-OK",
			}),
		].join("\n"),
	);
	fs.writeFileSync(
		path.join(art, "6e165d09_delegate_0_transcript.jsonl"),
		[
			rec({
				recordType: "message",
				role: "user",
				ts: 100150,
				text: "say DELTA",
			}),
			rec({
				recordType: "message",
				role: "assistant",
				ts: 100200,
				text: "DELTA-OK",
			}),
		].join("\n"),
	);
	mkRun(root, "run-parallel", {
		runId: "p",
		state: "running",
		startedAt: 100000,
		cwd: proj,
		steps: [
			{
				agent: "delegate",
				status: "running",
				startedAt: 100000,
				// NOTE: sessionFile ts-distance (50) is FARTHER than the sibling's
				// (100) — the exact-id path must win anyway
				sessionFile: path.join(proj, "4bc84e84", "run-0", "session.jsonl"),
			},
			{
				agent: "delegate",
				status: "running",
				startedAt: 100100,
				sessionFile: path.join(proj, "6e165d09", "run-0", "session.jsonl"),
			},
		],
	});
	const log0 = readRunLog("run-parallel", 0, "output", { roots: [root] });
	const log1 = readRunLog("run-parallel", 1, "output", { roots: [root] });
	ok(
		"step 0 correlates via sessionFile id",
		log0 &&
			log0.name === "4bc84e84_delegate_0_transcript.jsonl" &&
			log0.text.includes("GAMMA-OK"),
	);
	ok(
		"step 1 correlates via sessionFile id (not the ts-nearest sibling)",
		log1 &&
			log1.name === "6e165d09_delegate_0_transcript.jsonl" &&
			log1.text.includes("DELTA-OK"),
	);
}

// ---- run-log fallback: events.jsonl when no subagent-log-*.md ----
{
	const root = mkRoot();
	const dir = mkRun(root, "run-ev", {
		runId: "ev",
		state: "running",
		startedAt: 1,
	});
	fs.writeFileSync(
		path.join(dir, "events.jsonl"),
		[
			JSON.stringify({
				ts: 1786817471804,
				type: "subagent.workflow.started",
				runId: "ev",
			}),
			JSON.stringify({
				ts: 1786817471960,
				type: "subagent.workflow.trace",
				trace: [{ key: "count-lines", state: "started" }],
			}),
		].join("\n"),
	);
	let log = readRunLog("run-ev", undefined, "run", { roots: [root] });
	ok(
		"run log falls back to formatted events",
		log && log.name === "events.jsonl",
	);
	ok(
		"events formatted with prefix stripped + trace",
		log.text.includes("workflow.started") &&
			log.text.includes("count-lines:started") &&
			!log.text.includes("subagent."),
	);
	// markdown log still wins when present
	fs.writeFileSync(path.join(dir, "subagent-log-uuid-ev.md"), "# md log");
	log = readRunLog("run-ev", undefined, "run", { roots: [root] });
	ok("markdown run log preferred over events", log && log.text === "# md log");
}

// ---- discoverRoots: env override + pi-subagents-* scan ----
{
	const root = mkRoot();
	fs.mkdirSync(
		path.join(root, "pi-subagents-uid-42", "async-subagent-runs", "a"),
		{ recursive: true },
	);
	fs.writeFileSync(
		path.join(
			root,
			"pi-subagents-uid-42",
			"async-subagent-runs",
			"a",
			"status.json",
		),
		JSON.stringify({ state: "running", startedAt: 1 }),
	);
	const roots = discoverRoots({ tmpdir: () => root });
	ok(
		"scans pi-subagents-* dirs",
		roots.length === 1 && roots[0].endsWith("pi-subagents-uid-42"),
	);
	const viaEnv = discoverRoots({ envRoot: path.join(root, "explicit") });
	ok(
		"env override wins",
		viaEnv.length === 1 && viaEnv[0].endsWith("explicit"),
	);
}

console.log(`subagents: ${pass} checks${process.exitCode ? " (FAILED)" : ""}`);
