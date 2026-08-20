/*
 * isolated-prompt.test.js — node:assert/strict tests for the pure helpers in
 * isolated-prompt.js (cheapestAvailableModel, assistantText). runIsolatedPrompt
 * needs a live pi + auth; covered by a live smoke test, not here. Plan 4.7.
 */
"use strict";

const assert = require("assert/strict");
const { cheapestAvailableModel, assistantText, IMPROVE_DIRECTIONS } = require("../isolated-prompt.js");

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

// ===== cheapestAvailableModel =====
(function () {
	const resp = {
		data: {
			models: [
				{ id: "big", provider: "p", reasoning: true, cost: { input: 5, output: 30 } },
				{ id: "cheap", provider: "p", reasoning: false, cost: { input: 0.1, output: 0.4 } },
				{ id: "mid", provider: "p", reasoning: false, cost: { input: 1, output: 2 } },
			],
		},
	};
	const c = cheapestAvailableModel(resp);
	ok("cheapest by output cost", c && c.id === "cheap");
})();

(function () {
	// tie on output → input cost decides
	const resp = {
		data: {
			models: [
				{ id: "a", provider: "p", reasoning: false, cost: { input: 2, output: 1 } },
				{ id: "b", provider: "p", reasoning: false, cost: { input: 1, output: 1 } },
			],
		},
	};
	ok("tie on output → input cost", cheapestAvailableModel(resp).id === "b");
})();

(function () {
	// tie on output+input → non-reasoning wins
	const resp = {
		data: {
			models: [
				{ id: "reasoner", provider: "p", reasoning: true, cost: { input: 1, output: 1 } },
				{ id: "fast", provider: "p", reasoning: false, cost: { input: 1, output: 1 } },
			],
		},
	};
	ok("reasoning tie-break: non-reasoning first", cheapestAvailableModel(resp).id === "fast");
})();

(function () {
	ok("filters out malformed models", cheapestAvailableModel({ data: { models: [{ id: "x" }] } }) === undefined);
	ok("no data → undefined", cheapestAvailableModel({}) === undefined);
	ok("null → undefined", cheapestAvailableModel(null) === undefined);
})();

// ===== assistantText =====
(function () {
	const resp = {
		data: {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: [{ type: "text", text: "hello there" }] },
			],
		},
	};
	ok("extracts last assistant text (array content)", assistantText(resp) === "hello there");
})();

(function () {
	const resp = {
		data: {
			messages: [
				{ role: "assistant", content: "first answer" },
				{ role: "assistant", content: "second answer" },
			],
		},
	};
	ok("extracts LAST assistant (string content)", assistantText(resp) === "second answer");
})();

(function () {
	ok("trims whitespace", assistantText({ data: { messages: [{ role: "assistant", content: "  x  " }] } }) === "x");
})();

(function () {
	// assistant with only thinking (no text part) → skipped, falls back
	const resp = {
		data: {
			messages: [
				{ role: "assistant", content: [{ type: "thinking", text: "hmm" }] },
				{ role: "assistant", content: [{ type: "text", text: "real answer" }] },
			],
		},
	};
	ok("skips thinking-only assistant, finds text one", assistantText(resp) === "real answer");
})();

(function () {
	ok("no assistant → undefined", assistantText({ data: { messages: [{ role: "user", content: "x" }] } }) === undefined);
	ok("no messages → undefined", assistantText({ data: {} }) === undefined);
	ok("null → undefined", assistantText(null) === undefined);
})();

// ===== IMPROVE_DIRECTIONS =====
(function () {
	ok("clarify preset present", !!IMPROVE_DIRECTIONS.clarify);
	ok("ideate preset present", !!IMPROVE_DIRECTIONS.ideate);
	ok("precise preset present", !!IMPROVE_DIRECTIONS.precise);
	ok("invalid direction → undefined", IMPROVE_DIRECTIONS.nope === undefined);
})();

console.log("\n" + pass + " passed");
