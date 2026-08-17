/*
 * subagents-ux.test.js — node:assert/strict unit tests for
 * public/subagents-ux.js (pure HTML builders for the fleet page + notices).
 */

const ux = require("../public/subagents-ux.js");

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

// ---- notices ----
ok("notify type detected", ux.isSubagentNotice("subagent-notify") === true);
ok(
	"steering type detected",
	ux.isSubagentNotice("subagent_steering_notice") === true,
);
ok(
	"control type detected",
	ux.isSubagentNotice("subagent_control_notice") === true,
);
ok("other types ignored", ux.isSubagentNotice("compaction") === false);

{
	const html = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "",
		details: {
			agent: "worker",
			status: "completed",
			taskInfo: "task 'fix tests'",
			durationMs: 65000,
			resultPreview: "all green\nsecond line",
			sessionLabel: "run",
			sessionValue: "abc123",
		},
	});
	ok(
		"notify renders agent+status",
		html.includes("worker") && html.includes("completed"),
	);
	ok(
		"notify renders task + duration",
		html.includes("fix tests") && html.includes("1m 5s"),
	);
	ok(
		"notify first line only",
		html.includes("all green") && !html.includes("second line"),
	);
	ok("notify session foot", html.includes("run: abc123"));
	ok("notify ok class", html.includes("sa-note-ok"));
}
{
	const html = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "",
		details: {
			agent: "<script>x</script>",
			status: "failed",
			resultPreview: "boom",
		},
	});
	ok("notify escapes html", !html.includes("<script>"));
	ok("failed → err class", html.includes("sa-note-err"));
}
{
	// content-only notify (details lost): parses the plugin's own markdown
	// (notify.ts formatSingleCompletion) — agent+status from line 1, preview
	// from line 3+. Previously this painted ✗/err with "subagent · ?".
	const html = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content:
			"Background task completed: **worker**\n\nall tests pass\nSession: abc",
	});
	ok("content-parsed agent+status", html.includes("worker · completed"));
	ok("content-parsed green", html.includes("sa-note-ok") && html.includes("✓"));
	ok("content-parsed preview body", html.includes("all tests pass"));
	ok("no raw markdown leaks", !html.includes("**"));
	// the exact shape seen live: workflow completion, agent literally "workflow"
	const wf = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "Background task completed: **workflow**",
	});
	ok(
		"workflow-shaped notice green",
		wf.includes("workflow · completed") && wf.includes("sa-note-ok"),
	);
	// grouped batch: agents from the bold spans, count as taskInfo
	const grp = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "Background tasks completed (2): **alpha**, **beta**",
	});
	ok(
		"grouped agents parsed",
		grp.includes("alpha, beta · completed") && grp.includes("(2)"),
	);
	// failure status parses red
	const fail = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "Background task failed: **worker**",
	});
	ok(
		"content-parsed failure red",
		fail.includes("worker · failed") && fail.includes("sa-note-err"),
	);
	// fully unparseable content → NEUTRAL card, not red
	const junk = ux.noticeHtml({
		role: "custom",
		customType: "subagent-notify",
		content: "something odd happened",
	});
	ok(
		"unparseable neutral",
		junk.includes("sa-note-none") && !junk.includes("sa-note-err"),
	);
}
{
	const html = ux.noticeHtml({
		role: "custom",
		customType: "subagent_steering_notice",
		content: "steer missed for child 2",
	});
	ok("steering notice renders content", html.includes("steer missed"));
	ok(
		"non-notice custom ignored",
		ux.noticeHtml({
			role: "custom",
			customType: "compaction",
			content: "x",
		}) === "",
	);
	ok(
		"non-custom ignored",
		ux.noticeHtml({ role: "user", content: "x" }) === "",
	);
}

// ---- fleet rows ----
{
	const html = ux.fleetHtml([
		{
			id: "r1",
			runId: "uuid-1",
			state: "running",
			mode: "workflow",
			description: "parallel review fanout",
			startedAt: Date.now() - 3000,
			currentTool: "bash",
			turnCount: 4,
			steps: [
				{
					index: 0,
					agent: "reviewer-a",
					status: "running",
					description: "check parser",
				},
				{ index: 1, agent: "reviewer-b", status: "complete" },
			],
		},
		{
			id: "r2",
			state: "failed",
			startedAt: 1,
			endedAt: 2,
			error: "child crashed",
			steps: [{ index: 0, agent: "worker", status: "failed" }],
		},
	]);
	ok(
		"row per run",
		html.includes('data-id="r1"') && html.includes('data-id="r2"'),
	);
	ok("running row has stop button", html.includes('class="fl-stop"'));
	ok("failed row has run-log button", html.includes("fl-log-run"));
	ok("error surfaced", html.includes("child crashed"));
	ok(
		"step log buttons only for running/complete",
		(html.match(/data-step=/g) || []).length === 2,
	); // r1:0 running, r1:1 complete; failed r2:0 has none
	ok("step description shown", html.includes("check parser"));
}
ok("empty fleet hint", ux.fleetHtml([]).includes("no background subagent"));
ok(
	"fmtDur",
	ux.fmtDur(500) === "0s" &&
		ux.fmtDur(65000) === "1m 5s" &&
		ux.fmtDur(0) === "",
);
ok(
	"active states",
	ux.isActive("running") && ux.isActive("paused") && !ux.isActive("complete"),
);
ok(
	"unknown state degrades",
	ux.stateMeta("weird").label === "weird" &&
		ux.stateMeta("weird").cls === "unknown",
);

{
	// agents fallback when no description
	const html = ux.fleetHtml([
		{
			id: "r3",
			state: "complete",
			steps: [{ index: 0, agent: "alpha", status: "completed" }],
			startedAt: 1,
			endedAt: 2,
		},
	]);
	ok("agents used as title fallback", html.includes("alpha"));
}

// run "complete" with all children failed must not read as green done
{
	const html = ux.fleetHtml([
		{
			id: "r4",
			state: "complete",
			steps: [
				{ index: 0, agent: "worker", status: "failed" },
				{ index: 1, agent: "scout", status: "failed" },
			],
			startedAt: 1,
			endedAt: 2,
		},
	]);
	ok(
		"all-failed complete run shows failed chip",
		html.includes("fl-chip fl-failed") && !html.includes(">done<"),
	);
	// mixed: complete run, one of two failed → done chip + red count
	const html2 = ux.fleetHtml([
		{
			id: "r5",
			state: "complete",
			steps: [
				{ index: 0, agent: "a", status: "completed" },
				{ index: 1, agent: "b", status: "failed" },
			],
			startedAt: 1,
			endedAt: 2,
		},
	]);
	ok(
		"mixed run keeps done chip + failure count",
		html2.includes(">done<") && html2.includes("1✗"),
	);
}

// stopping state: stopRequested run shows stopping chip + force button
{
	const html = ux.fleetHtml([
		{
			id: "r6",
			state: "running",
			stopRequested: true,
			startedAt: 1,
			steps: [{ index: 0, agent: "a", status: "running" }],
		},
	]);
	ok("stopping chip shown", html.includes(">stopping<"));
	ok(
		"button escalates to force stop",
		html.includes("force stop") && html.includes('data-force="1"'),
	);
}

console.log(
	`subagents-ux: ${pass} checks${process.exitCode ? " (FAILED)" : ""}`,
);
