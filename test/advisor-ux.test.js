/* C07 — pure advisor source, state, and presentation projections */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ux = require("../public/advisor-ux.js");
const ROOT = path.join(__dirname, "..");

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

ok("normalizes only supported review source kinds", () => {
	const draft = ux.normalizeSource("draft", "  draft text  ");
	assert.deepEqual(draft, {
		kind: "draft",
		label: "draft",
		id: null,
		text: "draft text",
		truncated: false,
	});
	assert.equal(ux.normalizeSource("tool-output", "x"), null);
	assert.equal(ux.normalizeSource("assistant-turn", "   "), null);
});

ok("finds bounded assistant-turn and request-context sources", () => {
	const messages = [
		{ role: "user", content: "question" },
		{ role: "assistant", id: "turn-1", content: [{ type: "text", text: "answer" }] },
		{ role: "toolResult", content: "private tool output" },
		{ role: "assistant", id: "turn-2", content: "latest answer" },
	];
	assert.deepEqual(ux.sourceFromMessages(messages, "assistant-turn"), {
		kind: "assistant-turn",
		label: "assistant turn",
		id: "turn-2",
		text: "latest answer",
		truncated: false,
	});
	const context = ux.sourceFromMessages(messages, "request-context", 16);
	assert.equal(context.kind, "request-context");
	assert.equal(context.label, "request context");
	assert.equal(context.truncated, true);
	assert.equal(context.text.includes("private tool output"), false);
});

ok("builds an explicit advisor request without send/apply operations", () => {
	const source = ux.normalizeSource("draft", "review me");
	const body = ux.requestPayload(
		source,
		{ provider: "p", modelId: "m" },
		"advisor-1",
	);
	assert.deepEqual(body, {
		kind: "advisor",
		requestId: "advisor-1",
		sourceKind: "draft",
		source: { id: null, text: "review me" },
		model: { provider: "p", modelId: "m" },
	});
	assert.equal("send" in body, false);
	assert.equal("apply" in body, false);
	assert.equal(ux.requestPayload(null, null, "advisor-2"), null);
});

ok("normalizes verdict, provenance, and retry/cancel state", () => {
	const run = ux.normalizeRun({
		id: "advisor-1",
		kind: "advisor",
		status: "completed",
		result: {
			verdict: "revise",
			summary: "tighten this",
			risks: ["risk"],
			actions: ["test"],
			model: { provider: "p", modelId: "m" },
			modelSource: "selected",
			contextTruncated: true,
			createdAt: 123,
			retryable: false,
		},
	});
	assert.equal(run.kind, "advisor");
	assert.equal(run.label, "review ready");
	assert.equal(run.active, false);
	assert.equal(ux.verdictMeta(run.result.verdict).label, "revise");
	assert.equal(ux.provenance(run.result).model, "p/m");
	assert.equal(ux.provenance(run.result).context, "context truncated");
	assert.equal(ux.canCancel(run), false);
	assert.equal(ux.canRetry(run), false);

	const failed = ux.normalizeRun({
		id: "advisor-2",
		kind: "advisor",
		status: "failed",
		result: { verdict: "unavailable", retryable: true },
	});
	assert.equal(ux.canRetry(failed), true);
	assert.match(ux.statusText(failed), /retry/i);
});

ok("materializes a recommendation for explicit composer copy", () => {
	const text = ux.materialize({
		verdict: "revise",
		summary: "Use a typed error.",
		risks: ["The fallback hides context."],
		actions: ["Add a regression test."],
	});
	assert.match(text, /Use a typed error/);
	assert.match(text, /Risks:/);
	assert.match(text, /Actions:/);
	assert.equal(ux.materialize({ verdict: "unavailable", summary: "offline" }), "offline");
});

ok("rejects stale active runs but accepts terminal replacements", () => {
	const current = { id: "advisor-1", status: "running" };
	assert.equal(
		ux.shouldApplyRun(current, { id: "advisor-2", status: "running" }),
		false,
	);
	assert.equal(
		ux.shouldApplyRun(current, { id: "advisor-1", status: "completed" }),
		true,
	);
	assert.equal(
		ux.shouldApplyRun(current, { id: "advisor-2", status: "failed" }),
		false,
	);
});

ok("wires labelled controls, provenance, and explicit copy without send", () => {
	const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
	const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
	const css = fs.readFileSync(path.join(ROOT, "public", "style.css"), "utf8");
	assert.ok(html.includes('id="advisor-pane"'));
	assert.ok(html.includes('id="advisor-source"'));
	assert.ok(html.includes('id="advisor-copy"'));
	assert.ok(html.indexOf('<script src="advisor-ux.js">') < html.indexOf('<script src="app.js">'));
	assert.match(app, /kind: "advisor"/);
	assert.match(app, /Review with advisor/);
	assert.match(app, /Copied recommendation to composer — not sent/);
	assert.match(app, /advisorProvenance/);
	assert.match(css, /\.advisor-pane\s*\{/);
	assert.match(css, /\.advisor-review-link:focus-visible/);
});

console.log("\n" + pass + " passed");
