/* C05 — advisor request/result normalization contract */
"use strict";

const assert = require("node:assert/strict");
const {
	ADVISOR_SOURCE_KINDS,
	ADVISOR_VERDICTS,
	DEFAULT_ADVISOR_LIMITS,
	normalizeAdvisorRequest,
	normalizeAdvisorResult,
	advisorFailure,
} = require("../advisor-contract.js");

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

ok("exposes the supported advisor sources and verdicts", () => {
	assert.deepEqual(ADVISOR_SOURCE_KINDS, [
		"draft",
		"assistant-turn",
		"request-context",
	]);
	assert.deepEqual(ADVISOR_VERDICTS, [
		"proceed",
		"revise",
		"stop",
		"unavailable",
	]);
});

ok("normalizes a draft source with selected-model provenance", () => {
	const out = normalizeAdvisorRequest({
		requestId: "advisor-draft",
		sourceKind: "draft",
		source: { text: "  review this draft  " },
		model: { provider: "openai", modelId: "reviewer" },
		createdAt: 10,
	});
	assert.equal(out.ok, true);
	assert.deepEqual(out.request, {
		requestId: "advisor-draft",
		sourceKind: "draft",
		source: { id: null, text: "review this draft" },
		model: { provider: "openai", modelId: "reviewer" },
		modelSource: "selected",
		contextTruncated: false,
		cancelRequested: false,
		createdAt: 10,
	});
});

ok("normalizes assistant-turn and request-context sources", () => {
	const turn = normalizeAdvisorRequest({
		requestId: "advisor-turn",
		sourceKind: "assistant-turn",
		source: { id: "turn-7", text: "assistant proposal" },
	});
	assert.equal(turn.ok, true);
	assert.equal(turn.request.sourceKind, "assistant-turn");
	assert.deepEqual(turn.request.source, {
		id: "turn-7",
		text: "assistant proposal",
	});
	assert.equal(turn.request.modelSource, "default");

	const context = normalizeAdvisorRequest({
		requestId: "advisor-context",
		sourceKind: "request-context",
		requestContext: "selected request context",
	});
	assert.equal(context.ok, true);
	assert.deepEqual(context.request.source, {
		id: null,
		text: "selected request context",
	});
});

ok("bounds source context and records truncation", () => {
	const out = normalizeAdvisorRequest(
		{
			requestId: "advisor-bounded",
			sourceKind: "draft",
			source: { text: "abcdef" },
		},
		{ contextChars: 4 },
	);
	assert.equal(out.ok, true);
	assert.equal(out.request.source.text, "abcd");
	assert.equal(out.request.contextTruncated, true);
});

ok("rejects missing or unsupported source context safely", () => {
	const missing = normalizeAdvisorRequest({
		requestId: "advisor-missing",
		sourceKind: "draft",
		source: { text: "   " },
	});
	assert.equal(missing.ok, false);
	assert.equal(missing.error.code, "ADVISOR_SOURCE_EMPTY");
	assert.equal(missing.error.retryable, false);

	const unsupported = normalizeAdvisorRequest({
		requestId: "advisor-unsupported",
		sourceKind: "tool-output",
		source: { text: "x" },
	});
	assert.equal(unsupported.ok, false);
	assert.equal(unsupported.error.code, "ADVISOR_SOURCE_UNSUPPORTED");
});

function requestForResult() {
	const out = normalizeAdvisorRequest({
		requestId: "advisor-result",
		sourceKind: "draft",
		source: { text: "draft", },
		model: { provider: "p", modelId: "m" },
	});
	assert.equal(out.ok, true);
	return out.request;
}

ok("normalizes structured reviewer output and preserves provenance", () => {
	const result = normalizeAdvisorResult(
		JSON.stringify({
			verdict: "revise",
			summary: "Tighten the error handling.",
			risks: ["The fallback hides the root cause."],
			actions: ["Return a typed failure."],
		}),
		{
			request: requestForResult(),
			completedAt: 123,
		},
	);
	assert.deepEqual(result, {
		requestId: "advisor-result",
		sourceKind: "draft",
		verdict: "revise",
		summary: "Tighten the error handling.",
		risks: ["The fallback hides the root cause."],
		actions: ["Return a typed failure."],
		model: { provider: "p", modelId: "m" },
		modelSource: "selected",
		contextTruncated: false,
		outputTruncated: false,
		retryable: false,
		createdAt: 123,
	});
});

ok("bounds summary and lists with output truncation provenance", () => {
	const result = normalizeAdvisorResult(
		{
			verdict: "proceed",
			summary: "abcdef",
			risks: ["12345", "ignored"],
			actions: ["uvwxyz"],
		},
		{
			request: requestForResult(),
			completedAt: 456,
			limits: { summaryChars: 4, itemChars: 3, maxItems: 1 },
		},
	);
	assert.equal(result.verdict, "proceed");
	assert.equal(result.summary, "abcd");
	assert.deepEqual(result.risks, ["123"]);
	assert.deepEqual(result.actions, ["uvw"]);
	assert.equal(result.outputTruncated, true);
});

ok("turns malformed or empty output into retryable unavailable", () => {
	const metadata = { request: requestForResult(), completedAt: 789 };
	const malformed = normalizeAdvisorResult("not structured JSON", metadata);
	assert.equal(malformed.verdict, "unavailable");
	assert.equal(malformed.retryable, true);
	assert.equal(malformed.error.code, "ADVISOR_MALFORMED_OUTPUT");
	assert.equal(malformed.summary.includes("not structured"), false);
	assert.equal(malformed.createdAt, 789);

	const empty = normalizeAdvisorResult({ verdict: "proceed", summary: "" }, metadata);
	assert.equal(empty.verdict, "unavailable");
	assert.equal(empty.error.code, "ADVISOR_EMPTY_OUTPUT");

	const unknown = normalizeAdvisorResult(
		{ verdict: "approve", summary: "looks good" },
		metadata,
	);
	assert.equal(unknown.verdict, "unavailable");
	assert.equal(unknown.error.code, "ADVISOR_MALFORMED_OUTPUT");
});

ok("normalizes stop and keeps unavailable retryable", () => {
	const stop = normalizeAdvisorResult(
		{ verdict: "stop", summary: "Do not apply this change." },
		{ request: requestForResult(), completedAt: 799 },
	);
	assert.equal(stop.verdict, "stop");
	assert.equal(stop.retryable, false);

	const result = normalizeAdvisorResult(
		{ verdict: "unavailable", summary: "reviewer is offline" },
		{ request: requestForResult(), completedAt: 800 },
	);
	assert.equal(result.verdict, "unavailable");
	assert.equal(result.retryable, true);
	assert.equal(result.error.code, "ADVISOR_UNAVAILABLE");
	assert.equal(result.summary, "reviewer is offline");
});

ok("maps runtime failures to bounded retryable states", () => {
	const request = requestForResult();
	const cases = [
		["SECONDARY_NO_MODEL", "ADVISOR_NO_MODEL"],
		["SECONDARY_MODEL", "ADVISOR_CREDENTIAL"],
		["SECONDARY_TIMEOUT", "ADVISOR_TIMEOUT"],
		["SECONDARY_CANCELLED", "ADVISOR_CANCELLED"],
		["SECONDARY_NO_TEXT", "ADVISOR_EMPTY_OUTPUT"],
	];
	for (const [inputCode, outputCode] of cases) {
		const result = advisorFailure(
			{ code: inputCode, message: "/secret/auth.json token=hidden" },
			{ request, completedAt: 900, contextTruncated: true },
		);
		assert.equal(result.verdict, "unavailable");
		assert.equal(result.retryable, true);
		assert.equal(result.error.code, outputCode);
		assert.equal(result.contextTruncated, true);
		assert.equal(result.summary.includes("secret"), false);
	}
});

console.log("\n" + pass + " passed");
