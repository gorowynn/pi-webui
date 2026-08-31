"use strict";

const assert = require("node:assert/strict");
const { PiSdkRuntime, normalizeEvent } = require("../pi-sdk-runtime.js");

function session(id) {
	const listeners = new Set();
	return {
		sessionId: id,
		bindExtensions: async () => {},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		emit(event) {
			for (const listener of listeners) listener(event);
		},
	};
}

function assertEventNormalization() {
	assert.deepEqual(
		normalizeEvent({
			type: "message_update",
			message: { role: "assistant", usage: { input: 3 } },
			assistantMessageEvent: {
				type: "text_delta",
				delta: "hello",
				partial: { content: ["not for the browser"] },
			},
		}),
		{
			type: "message_update",
			usage: { input: 3 },
			assistantMessageEvent: { type: "text_delta", delta: "hello" },
		},
	);
	assert.deepEqual(
		normalizeEvent({
			type: "message_update",
			message: { role: "assistant" },
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				partial: { content: [{ type: "toolCall", id: "t1", name: "bash" }] },
			},
		}),
		{
			type: "message_update",
			usage: undefined,
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				id: "t1",
				toolName: "bash",
			},
		},
	);
	assert.deepEqual(
		normalizeEvent({
			type: "message_update",
			message: { role: "assistant" },
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				partial: { content: [] },
			},
		}),
		{
			type: "message_update",
			usage: undefined,
			assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 },
		},
	);
	assert.deepEqual(
		normalizeEvent({ type: "agent_start", sessionId: "s1" }),
		{ type: "agent_start", sessionId: "s1" },
	);
}

async function assertRebindIsSingleSubscription() {
	const events = [];
	const first = session("first");
	const second = session("second");
	const runtime = new PiSdkRuntime({ onEvent: (event) => events.push(event) });
	runtime.runtime = { session: first };
	runtime.session = first;
	await runtime.bindSession();
	first.emit({ type: "agent_start", sessionId: "first" });
	runtime.runtime.session = second;
	await runtime.bindSession();
	first.emit({ type: "agent_start", sessionId: "stale" });
	second.emit({ type: "agent_start", sessionId: "second" });
	assert.deepEqual(events, [
		{ type: "agent_start", sessionId: "first" },
		{ type: "agent_start", sessionId: "second" },
	]);
	assert.equal(runtime.generation, 2);
}

function assertSnapshotUsesCurrentSession() {
	const current = session("current");
	Object.assign(current, {
		model: { provider: "fake", id: "model" },
		thinkingLevel: "off",
		isStreaming: false,
		isCompacting: false,
		steeringMode: "one-at-a-time",
		followUpMode: "one-at-a-time",
		sessionFile: "/tmp/current.jsonl",
		sessionName: "Current",
		autoCompactionEnabled: true,
		pendingMessageCount: 0,
		messages: [{ role: "assistant", content: "answer" }],
		modelRuntime: { getAvailableSnapshot: () => [{ provider: "fake", id: "model" }] },
		extensionRunner: { getRegisteredCommands: () => [] },
		promptTemplates: [],
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		sessionManager: { getEntries: () => [], getLeafId: () => null, getTree: () => [] },
		getSessionStats: () => ({ totalMessages: 1 }),
	});
	const runtime = new PiSdkRuntime({});
	runtime.ready = true;
	runtime.session = current;
	const snapshot = runtime.snapshot();
	assert.equal(snapshot.state.sessionId, "current");
	assert.equal(snapshot.messages, current.messages);
	assert.equal(snapshot.stats.totalMessages, 1);
	assert.deepEqual(snapshot.models, [{ provider: "fake", id: "model" }]);
}

(async () => {
	assertEventNormalization();
	await assertRebindIsSingleSubscription();
	assertSnapshotUsesCurrentSession();
	console.log("sdk-events.test.js — event and snapshot contract passed");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
