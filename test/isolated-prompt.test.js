/*
 * isolated-prompt.test.js — node:assert/strict tests for the pure helpers in
 * isolated-prompt.js (cheapestAvailableModel, assistantText). runIsolatedPrompt
 * needs a live pi + auth; covered by a live smoke test, not here. Plan 4.7.
 */
"use strict";

const {
	cheapestAvailableModel,
	assistantText,
	assistantErrorMessage,
	IMPROVE_DIRECTIONS,
	buildIsolatedOptions,
	prepareIsolatedPrompt,
	runIsolatedPrompt,
} = require("../isolated-prompt.js");

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
				{
					id: "big",
					provider: "p",
					reasoning: true,
					cost: { input: 5, output: 30 },
				},
				{
					id: "cheap",
					provider: "p",
					reasoning: false,
					cost: { input: 0.1, output: 0.4 },
				},
				{
					id: "mid",
					provider: "p",
					reasoning: false,
					cost: { input: 1, output: 2 },
				},
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
				{
					id: "reasoner",
					provider: "p",
					reasoning: true,
					cost: { input: 1, output: 1 },
				},
				{
					id: "fast",
					provider: "p",
					reasoning: false,
					cost: { input: 1, output: 1 },
				},
			],
		},
	};
	ok(
		"reasoning tie-break: non-reasoning first",
		cheapestAvailableModel(resp).id === "fast",
	);
})();

(function () {
	ok(
		"filters out malformed models",
		cheapestAvailableModel({ data: { models: [{ id: "x" }] } }) === undefined,
	);
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
	ok(
		"extracts last assistant text (array content)",
		assistantText(resp) === "hello there",
	);
})();

(function () {
	ok(
		"surfaces a structured assistant error for diagnostics",
		assistantErrorMessage({
			data: {
				messages: [{ role: "assistant", errorMessage: "provider unavailable" }],
			},
		}) === "provider unavailable",
	);
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
	ok(
		"extracts LAST assistant (string content)",
		assistantText(resp) === "second answer",
	);
})();

(function () {
	ok(
		"trims whitespace",
		assistantText({
			data: { messages: [{ role: "assistant", content: "  x  " }] },
		}) === "x",
	);
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
	ok(
		"skips thinking-only assistant, finds text one",
		assistantText(resp) === "real answer",
	);
})();

(function () {
	ok(
		"no assistant → undefined",
		assistantText({ data: { messages: [{ role: "user", content: "x" }] } }) ===
			undefined,
	);
	ok("no messages → undefined", assistantText({ data: {} }) === undefined);
	ok("null → undefined", assistantText(null) === undefined);
})();

// ===== secondary-run preparation =====
(function () {
	const prepared = prepareIsolatedPrompt({
		prompt: "abcdef",
		systemPrompt: "review only",
		maxPromptChars: 4,
		maxOutputChars: 3,
		timeoutMs: 1,
		model: { provider: "p", modelId: "m" },
		thinkingLevel: "high",
	});
	ok(
		"bounds isolated input and carries truncation metadata",
		prepared.prompt === "abcd" && prepared.inputTruncated,
	);
	ok(
		"normalizes isolated output and timeout caps",
		prepared.limits.outputChars === 3 && prepared.limits.timeoutMs === 1,
	);
	ok(
		"carries the selected model and thinking level",
		prepared.model.modelId === "m" && prepared.thinkingLevel === "high",
	);
})();

(function () {
	const options = buildIsolatedOptions("system");
	ok(
		"isolated SDK options disable tools/resources",
		options.noTools === "all" &&
			options.thinkingLevel === "off" &&
			options.resourceLoaderOptions.noExtensions &&
			options.resourceLoaderOptions.noSkills &&
			options.resourceLoaderOptions.noContextFiles,
	);
})();

function fakeSdk(capture) {
	const model = {
		provider: "fake",
		id: "cheap",
		name: "Cheap",
		reasoning: false,
		cost: { input: 0.1, output: 0.2 },
	};
	const manager = { cwd: "/workspace", entries: [] };
	return {
		SessionManager: { inMemory: () => manager },
		SettingsManager: {
			create(cwd, agentDir, options) {
				capture.settings = { cwd, agentDir, options };
				return { cwd, agentDir };
			},
		},
		async createAgentSessionServices(options) {
			capture.services = options;
			return {
				modelRuntime: {
					getAvailableSnapshot: () => [model],
					getModel: () => model,
				},
				resourceLoader: {},
			};
		},
		async createAgentSessionFromServices({ noTools, thinkingLevel }) {
			capture.sessionOptions = { noTools, thinkingLevel };
			const session = {
				modelRuntime: {
					getAvailableSnapshot: () => [model],
					getModel: () => model,
				},
				messages: [],
				async setModel(selected) {
					capture.model = selected;
				},
				setThinkingLevel(level) {
					capture.thinkingLevel = level;
				},
				async prompt(prompt, options) {
					capture.prompt = { prompt, options };
					this.messages = [{ role: "assistant", content: "isolated answer" }];
				},
				async abort() {
					capture.aborted = true;
				},
				dispose() {
					capture.disposed = true;
				},
			};
			return { session };
		},
	};
}

// ===== IMPROVE_DIRECTIONS =====
(function () {
	ok("clarify preset present", !!IMPROVE_DIRECTIONS.clarify);
	ok("ideate preset present", !!IMPROVE_DIRECTIONS.ideate);
	ok("precise preset present", !!IMPROVE_DIRECTIONS.precise);
	ok("invalid direction → undefined", IMPROVE_DIRECTIONS.nope === undefined);
})();

(async function () {
	const capture = {};
	const isolated = await runIsolatedPrompt({
		cwd: process.cwd(),
		prompt: "question",
		sdk: fakeSdk(capture),
	});
	ok(
		"runs a prompt through an injected SDK session",
		isolated.text === "isolated answer" && capture.prompt.prompt === "question",
	);
	ok(
		"isolated SDK session keeps tools and extensions disabled",
		capture.sessionOptions.noTools === "all" &&
			capture.services.resourceLoaderOptions.noExtensions &&
			capture.services.resourceLoaderOptions.noSkills &&
			capture.services.resourceLoaderOptions.noContextFiles,
	);
	ok("isolated SDK session is disposed", capture.disposed === true);

	const controller = new AbortController();
	controller.abort();
	let error = null;
	try {
		await runIsolatedPrompt({
			cwd: process.cwd(),
			prompt: "x",
			signal: controller.signal,
		});
	} catch (e) {
		error = e;
	}
	ok(
		"already-aborted isolated run rejects without spawning",
		error && error.code === "SECONDARY_CANCELLED",
	);
	console.log("\n" + pass + " passed");
})();
