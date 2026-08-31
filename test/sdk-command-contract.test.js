"use strict";

const assert = require("node:assert/strict");
const { PiSdkRuntime } = require("../pi-sdk-runtime.js");

const model = {
	provider: "fake",
	id: "fake-model",
	name: "Fake",
	reasoning: false,
	cost: { input: 1, output: 1 },
};

function makeRuntime() {
	const calls = [];
	let leafId = "leaf-1";
	const session = {
		modelRuntime: { getAvailableSnapshot: () => [model] },
		extensionRunner: {
			getRegisteredCommands: () => [],
			emitUserBash: async () => undefined,
		},
		promptTemplates: [],
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		messages: [{ role: "user", content: "hello" }],
		model,
		thinkingLevel: "off",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		sessionFile: "/tmp/session.jsonl",
		sessionId: "session-1",
		sessionName: "Demo",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		sessionManager: {
			getCwd: () => "/workspace",
			getLeafId: () => leafId,
			getEntries: () => [{ id: leafId }],
			getTree: () => [{ id: leafId }],
		},
		async prompt(message, options) {
			calls.push(["prompt", message, options.images, options.streamingBehavior]);
			options.preflightResult(true);
		},
		async steer(message, images) {
			calls.push(["steer", message, images]);
		},
		async followUp(message, images) {
			calls.push(["follow_up", message, images]);
		},
		async abort() {
			calls.push(["abort"]);
		},
		clearQueue() {
			calls.push(["clear_queue"]);
			return { steering: [], followUp: [] };
		},
		setModel(next) {
			calls.push(["set_model", next]);
		},
		cycleModel() {
			calls.push(["cycle_model"]);
			return { model, thinkingLevel: "off", isScoped: false };
		},
		setThinkingLevel(level) {
			calls.push(["set_thinking_level", level]);
		},
		cycleThinkingLevel() {
			calls.push(["cycle_thinking_level"]);
			return "off";
		},
		getAvailableThinkingLevels() {
			return ["off", "low"];
		},
		setSteeringMode(mode) {
			calls.push(["set_steering_mode", mode]);
		},
		setFollowUpMode(mode) {
			calls.push(["set_follow_up_mode", mode]);
		},
		async compact(instructions) {
			calls.push(["compact", instructions]);
			return { tokensBefore: 10, estimatedTokensAfter: 5 };
		},
		setAutoCompactionEnabled(enabled) {
			calls.push(["set_auto_compaction", enabled]);
		},
		setAutoRetryEnabled(enabled) {
			calls.push(["set_auto_retry", enabled]);
		},
		abortRetry() {
			calls.push(["abort_retry"]);
		},
		async executeBash(command, _shell, options) {
			calls.push(["bash", command, options]);
			return { output: "ok" };
		},
		abortBash() {
			calls.push(["abort_bash"]);
		},
		getSessionStats() {
			return { totalMessages: 1 };
		},
		getLastAssistantText() {
			return "answer";
		},
		setSessionName(name) {
			calls.push(["set_session_name", name]);
		},
	};
	const host = {
		async dispose() {},
		async newSession(options) {
			calls.push(["new_session", options]);
			return { sessionId: "new" };
		},
		async switchSession(sessionPath) {
			calls.push(["switch_session", sessionPath]);
			return { sessionId: "switched" };
		},
		async fork(entryId, options) {
			calls.push(["fork", entryId, options]);
			return { selectedText: "selected", cancelled: false };
		},
	};
	const runtime = new PiSdkRuntime({});
	runtime.ready = true;
	runtime.session = session;
	runtime.runtime = host;
	return { runtime, session, calls, setLeaf: (id) => (leafId = id) };
}

async function main() {
	const { runtime, session, calls, setLeaf } = makeRuntime();
	const image = [{ type: "image", data: "abc" }];
	const cases = [
		[{ type: "steer", id: "1", message: "steer", images: image }, "steer"],
		[{ type: "follow_up", id: "2", message: "follow", images: image }, "follow_up"],
		[{ type: "abort", id: "3" }, "abort"],
		[{ type: "clear_queue", id: "4" }, "clear_queue"],
		[{ type: "set_thinking_level", id: "5", level: "low" }, "set_thinking_level"],
		[{ type: "set_steering_mode", id: "6", mode: "all" }, "set_steering_mode"],
		[{ type: "set_follow_up_mode", id: "7", mode: "all" }, "set_follow_up_mode"],
		[{ type: "set_auto_compaction", id: "8", enabled: false }, "set_auto_compaction"],
		[{ type: "set_auto_retry", id: "9", enabled: true }, "set_auto_retry"],
		[{ type: "abort_retry", id: "10" }, "abort_retry"],
		[{ type: "abort_bash", id: "11" }, "abort_bash"],
	];
	for (const [command, expected] of cases) {
		const response = await runtime.command(command);
		assert.equal(response.success, true, command.type);
		assert.equal(calls.at(-1)[0], expected, command.type);
	}

	assert.equal((await runtime.command({
		type: "prompt",
		id: "prompt",
		message: "hello",
		images: image,
		streamingBehavior: "follow-up",
	})).success, true);
	assert.deepEqual(calls.at(-1), ["prompt", "hello", image, "follow-up"]);
	assert.equal((await runtime.command({ type: "bash", id: "bash", command: "pwd" })).success, true);
	assert.equal(calls.at(-1)[0], "bash");
	assert.equal((await runtime.command({
		type: "set_model",
		id: "model",
		provider: "fake",
		modelId: "fake-model",
	})).success, true);
	assert.equal(calls.at(-1)[0], "set_model");
	assert.equal((await runtime.command({ type: "cycle_model", id: "cycle" })).success, true);
	assert.equal((await runtime.command({ type: "get_available_models", id: "models" })).data.models.length, 1);
	assert.deepEqual((await runtime.command({ type: "get_available_thinking_levels", id: "levels" })).data.levels, ["off", "low"]);
	assert.equal((await runtime.command({ type: "cycle_thinking_level", id: "cycle-level" })).data.level, "off");
	assert.equal((await runtime.command({ type: "compact", id: "compact", customInstructions: "short" })).success, true);
	assert.equal((await runtime.command({ type: "get_session_stats", id: "stats" })).data.totalMessages, 1);

	assert.deepEqual((await runtime.command({ type: "new_session", id: "new" })).data, { sessionId: "new" });
	const switchSession = runtime.runtime.switchSession;
	runtime.runtime.switchSession = async (sessionPath) => {
		const result = await switchSession(sessionPath);
		// AgentSessionRuntime invokes the adapter's rebind callback on success.
		runtime.generation++;
		return result;
	};
	const switched = await runtime.command({
		type: "switch_session",
		id: "switch",
		sessionPath: "/tmp/other.jsonl",
	});
	assert.equal(switched.success, true);
	assert.deepEqual(switched.data, { sessionId: "switched" });
	assert.equal((await runtime.command({ type: "fork", id: "fork", entryId: "entry-1" })).data.text, "selected");
	assert.equal((await runtime.command({ type: "clone", id: "clone" })).success, true);
	assert.equal((await runtime.command({ type: "get_entries", id: "entries" })).data.entries.length, 1);
	assert.equal((await runtime.command({ type: "get_tree", id: "tree" })).data.tree.length, 1);
	assert.equal((await runtime.command({ type: "get_last_assistant_text", id: "last" })).data.text, "answer");
	assert.equal((await runtime.command({ type: "set_session_name", id: "name", name: "Renamed" })).success, true);
	assert.equal((await runtime.command({ type: "get_messages", id: "messages" })).data.messages, session.messages);
	assert.equal((await runtime.command({ type: "get_commands", id: "commands" })).success, true);

	const beforeInvalid = calls.length;
	for (const command of [
		{ type: "prompt", message: "" },
		{ type: "steer" },
		{ type: "follow_up", message: "" },
		{ type: "bash", command: "" },
		{ type: "set_model", provider: "fake" },
		{ type: "set_thinking_level" },
		{ type: "set_steering_mode", mode: "" },
		{ type: "set_follow_up_mode" },
		{ type: "set_auto_retry", enabled: undefined },
		{ type: "switch_session" },
		{ type: "fork" },
		{ type: "set_session_name", name: "  " },
	]) {
		const response = await runtime.command(command);
		assert.equal(response.success, false, command.type);
		assert.match(response.error, /required|cannot be empty/i);
	}
	assert.equal(calls.length, beforeInvalid);

	const unknown = await runtime.command({ type: "not-a-command", id: "unknown" });
	assert.equal(unknown.success, false);
	assert.match(unknown.error, /unknown command/i);

	let releaseSteer;
	const originalSteer = session.steer;
	session.steer = () => new Promise((resolve) => (releaseSteer = resolve));
	const staleCommand = runtime.command({ type: "steer", id: "stale", message: "wait" });
	await Promise.resolve();
	await runtime.dispose();
	releaseSteer();
	const staleResponse = await staleCommand;
	assert.equal(staleResponse.success, false);
	assert.match(staleResponse.error, /stale|disposed/i);
	session.steer = originalSteer;

	const notReady = new PiSdkRuntime({});
	await assert.rejects(
		() => notReady.command({ type: "get_state" }),
		/pi not ready/,
	);

	const empty = makeRuntime();
	empty.setLeaf(null);
	const cloneWithoutLeaf = await empty.runtime.command({ type: "clone", id: "clone-empty" });
	assert.equal(cloneWithoutLeaf.success, false);
	assert.match(cloneWithoutLeaf.error, /cannot clone/i);

	console.log("sdk-command-contract.test.js — command adapter contract passed");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
