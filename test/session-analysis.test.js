/*
 * session-analysis.test.js — node:assert/strict tests for session-analysis.js.
 * Covers usage extraction, request/turn/tool reconstruction, cost attribution,
 * tool summaries, the stats fallback, and formatters. Plan 4.2.
 */

// const assert unused — helpers ok()/eq() cover all checks
const A = require("../public/session-analysis.js");

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
function eq(name, actual, expected) {
	ok(name + " === " + JSON.stringify(expected), actual === expected);
}

// ---- message builders ----
function user(text) {
	return { role: "user", content: [{ type: "text", text }] };
}
function assistant(text, usage, calls) {
	const content = [];
	if (text) content.push({ type: "text", text });
	if (calls)
		for (const c of calls)
			content.push({
				type: "toolCall",
				id: c.id,
				name: c.name,
				arguments: c.args,
			});
	return { role: "assistant", content, usage };
}
function toolResult(callId, name, text, isError) {
	return {
		role: "toolResult",
		toolCallId: callId,
		toolName: name,
		content: [{ type: "text", text }],
		isError: !!isError,
	};
}
function usage(input, cacheRead, output, cost) {
	return {
		input,
		cacheRead,
		cacheWrite: 0,
		output,
		reasoning: 0,
		cost: { total: cost || 0 },
	};
}

// ===== messageUsage =====
(() => {
	eq(
		"messageUsage extracts fields",
		A.messageUsage(assistant("x", usage(100, 50, 10, 0.005))).cost,
		0.005,
	);
	eq(
		"messageUsage cacheMiss = input",
		A.messageUsage(assistant("x", usage(100, 50, 10))).cacheMiss,
		100,
	);
	eq(
		"messageUsage cacheRead",
		A.messageUsage(assistant("x", usage(100, 50, 10))).cacheRead,
		50,
	);
	ok(
		"messageUsage null when no usage",
		A.messageUsage(assistant("x", null)) === null,
	);
	ok(
		"messageUsage null when cost missing",
		A.messageUsage({
			role: "assistant",
			usage: { input: 1, cacheRead: 0, output: 1 },
		}) === null,
	);
})();

// ===== basic reconstruction: user -> assistant(+tool) -> toolResult -> assistant =====
(() => {
	const messages = [
		user("do a thing"),
		assistant("running it", usage(200, 100, 20, 0.01), [
			{ id: "c1", name: "bash", args: { command: "ls" } },
		]),
		toolResult("c1", "bash", "file1\nfile2", false),
		assistant("done", usage(300, 250, 15, 0.02)),
	];
	const a = A.analyzeSession(messages, null, false);
	eq("one request (one user)", a.requests.length, 1);
	eq("two assistant turns", a.turnCount, 2);
	eq("attributed cost sums turns", Math.round(a.attributedCost * 1000), 30);
	eq("one tool call", a.toolCalls.length, 1);
	eq("tool input length > 0", a.toolCalls[0].inputLength > 0, true);
	eq(
		"tool output length = text length",
		a.toolCalls[0].outputLength,
		"file1\nfile2".length,
	);
	eq("tool not pending (result present)", a.toolCalls[0].pending, false);
	eq("tool not error", a.toolCalls[0].isError, false);
	eq("no failed tool calls", a.failedToolCalls, 0);
	eq("average = total/2", Math.round(a.averageTurnCost * 1000), 15);
	eq("tokens available (attribution)", a.tokensAvailable, true);
	eq("tokens cacheMiss sums", a.tokens.cacheMiss, 500);
	eq("contextPercent undefined when no stats", a.contextPercent, undefined);
})();

// ===== multiple requests (two user cycles) =====
(() => {
	const messages = [
		user("first"),
		assistant("a1", usage(100, 0, 10, 0.001)),
		user("second"),
		assistant("a2", usage(200, 0, 10, 0.002), [
			{ id: "x", name: "read", args: { path: "f" } },
		]),
		toolResult("x", "read", "contents", false),
	];
	const a = A.analyzeSession(messages, null, false);
	eq("two requests", a.requests.length, 2);
	eq("request[0].title from first user", a.requests[0].title, "first");
	eq("request[1] has 1 tool call", a.requests[1].toolCalls.length, 1);
	eq("all complete when not running", a.requests[1].complete, true);
})();

// ===== running flag marks last request incomplete =====
(() => {
	const messages = [user("hi"), assistant("hey", usage(10, 0, 5, 0.0001))];
	const a = A.analyzeSession(messages, null, true);
	eq(
		"last request incomplete when running",
		a.requests[a.requests.length - 1].complete,
		false,
	);
	const a2 = A.analyzeSession(messages, null, false);
	eq(
		"last request complete when not running",
		a2.requests[a2.requests.length - 1].complete,
		true,
	);
})();

// ===== failed tool call tracking =====
(() => {
	const messages = [
		user("go"),
		assistant("try", usage(10, 0, 5, 0.001), [
			{ id: "ok", name: "bash", args: {} },
			{ id: "bad", name: "edit", args: {} },
		]),
		toolResult("ok", "bash", "ok", false),
		toolResult("bad", "edit", "error: not found", true),
	];
	const a = A.analyzeSession(messages, null, false);
	eq("failed count = 1", a.failedToolCalls, 1);
	eq("request failedToolCalls = 1", a.requests[0].failedToolCalls, 1);
	eq("bad call isError true", a.toolCalls[1].isError, true);
})();

// ===== pending tool call (no result) =====
(() => {
	const messages = [
		user("go"),
		assistant("trying", usage(10, 0, 5, 0.001), [
			{ id: "p", name: "bash", args: {} },
		]),
	];
	const a = A.analyzeSession(messages, null, true);
	const p = a.toolCalls.find((c) => c.id === "p");
	eq("pending call flagged", p.pending, true);
	eq("pending output length 0", p.outputLength, 0);
})();

// ===== tool summaries sorted by count =====
(() => {
	const messages = [
		user("go"),
		assistant("a", usage(1, 0, 1, 0), [
			{ id: "1", name: "bash", args: {} },
			{ id: "2", name: "bash", args: {} },
			{ id: "3", name: "read", args: {} },
		]),
		toolResult("1", "bash", "x", false),
		toolResult("2", "bash", "y", false),
		toolResult("3", "read", "z", false),
	];
	const a = A.analyzeSession(messages, null, false);
	eq("two distinct tools", a.tools.length, 2);
	eq("bash ranked first (count 2)", a.tools[0].name, "bash");
	eq("bash count 2", a.tools[0].count, 2);
	eq("read count 1", a.tools[1].count, 1);
	eq("bash total output length", a.tools[0].outputLength, 2);
})();

// ===== stats fallback: tokens/cost from stats when per-message usage absent =====
(() => {
	const messages = [user("hi"), assistant("hey")]; // no usage on assistant
	const stats = {
		cost: 0.123,
		toolCalls: 5,
		tokens: { input: 1000, cacheRead: 4000, cacheWrite: 0, output: 500 },
		contextUsage: { percent: 42 },
	};
	const a = A.analyzeSession(messages, stats, false);
	eq("totalCost from stats", a.totalCost, 0.123);
	eq("costAvailable true", a.costAvailable, true);
	eq("tokens from stats cacheMiss", a.tokens.cacheMiss, 1000);
	eq("tokens from stats cacheRead", a.tokens.cacheRead, 4000);
	eq("contextPercent from stats", a.contextPercent, 42);
	eq("totalToolCalls from stats", a.totalToolCalls, 5);
	ok(
		"attribution NOT available (no per-message usage)",
		!a.attributionAvailable,
	);
})();

// ===== empty messages =====
(() => {
	const a = A.analyzeSession([], null, false);
	eq("no requests", a.requests.length, 0);
	eq("no turns", a.turnCount, 0);
	eq("totalCost 0", a.totalCost, 0);
	eq("no tools", a.tools.length, 0);
})();

// ===== median cost =====
(() => {
	const messages = [
		user("1"),
		assistant("a", usage(1, 0, 1, 0.01)),
		user("2"),
		assistant("b", usage(1, 0, 1, 0.03)),
		user("3"),
		assistant("c", usage(1, 0, 1, 0.02)),
	];
	const a = A.analyzeSession(messages, null, false);
	// sorted costs [0.01, 0.02, 0.03], median (q=0.5, ceil(3*0.5)-1=idx1) = 0.02
	eq("median turn cost", a.medianTurnCost, 0.02);
})();

// ===== formatters =====
(() => {
	eq("formatTurnCost normal", A.formatTurnCost(0.03), "$0.03");
	eq("formatTurnCost tiny (4 digits)", A.formatTurnCost(0.001), "$0.0010");
	eq("formatTokens k", A.formatTokens(8400), "8k");
	eq("formatTokens million", A.formatTokens(1200000), "1M");
	eq("formatTokens billion", A.formatTokens(2300000000), "2B");
	eq("formatTokens small", A.formatTokens(410), "410");
	ok("formatDuration ms", A.formatDuration(500) === "500 ms");
	ok("formatDuration seconds", /\.?\d?\s/.test(A.formatDuration(2500)));
})();

// ===== notices + chars formatter (usage-tab FR-10 / FR-12) =====
(() => {
	const ids = (input) => A.sessionNotices(input).map((n) => n.id);
	// context-high # FR-10
	ok(
		"context-high fires at 80 and 95",
		ids({ contextPercent: 80 }).includes("context-high") &&
			ids({ contextPercent: 95 }).includes("context-high"),
	);
	ok(
		"context-high absent at 79",
		!ids({ contextPercent: 79 }).includes("context-high"),
	);
	ok(
		"context-high absent when contextPercent null/missing (E3)",
		!ids({ contextPercent: null }).includes("context-high") &&
			!ids({}).includes("context-high"),
	);
	// tool-errors # FR-10
	ok(
		"tool-errors fires at 1/5 (20%)",
		ids({ failedToolCalls: 1, totalToolCalls: 5 }).includes("tool-errors"),
	);
	ok(
		"tool-errors absent at 1/6 (17%)",
		!ids({ failedToolCalls: 1, totalToolCalls: 6 }).includes("tool-errors"),
	);
	ok(
		"tool-errors absent below min-call gate (4/4)",
		!ids({ failedToolCalls: 4, totalToolCalls: 4 }).includes("tool-errors"),
	);
	// pending-idle # FR-10
	ok(
		"pending-idle fires at 2 pending, not running",
		ids({ pendingTools: 2, running: false }).includes("pending-idle"),
	);
	ok(
		"pending-idle absent while running",
		!ids({ pendingTools: 2, running: true }).includes("pending-idle"),
	);
	ok(
		"pending-idle absent at 0 pending",
		!ids({ pendingTools: 0, running: false }).includes("pending-idle"),
	);
	// ordering + purity # FR-10
	const all = A.sessionNotices({
		contextPercent: 90,
		failedToolCalls: 3,
		totalToolCalls: 10,
		pendingTools: 1,
		running: false,
	});
	ok(
		"ordering context-high -> tool-errors -> pending-idle",
		JSON.stringify(all.map((n) => n.id)) ===
			JSON.stringify(["context-high", "tool-errors", "pending-idle"]),
	);
	const pureIn = {
		contextPercent: 85,
		failedToolCalls: 2,
		totalToolCalls: 8,
		pendingTools: 1,
		running: false,
	};
	const pureSnapshot = JSON.stringify(pureIn);
	const outA = A.sessionNotices(pureIn);
	const outB = A.sessionNotices(pureIn);
	ok(
		"pure: equal output, input not mutated",
		JSON.stringify(outA) === JSON.stringify(outB) &&
			JSON.stringify(pureIn) === pureSnapshot,
	);
	ok(
		"tones: context-high attention, tool-errors danger",
		all[0].tone === "attention" && all[1].tone === "danger",
	);
	// formatChars # FR-12
	eq("formatChars k", A.formatChars(8400), "8.4k chars");
	eq("formatChars small", A.formatChars(410), "410 chars");
	eq("formatChars million", A.formatChars(1200000), "1.2M chars");
})();

console.log("\n" + pass + " passed");
