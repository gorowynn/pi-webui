"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
	createPiSdkRuntime,
	normalizeEvent,
} = require("../pi-sdk-runtime.js");

const model = {
	provider: "fake",
	id: "fake-model",
	name: "Fake",
	reasoning: false,
	cost: { input: 1, output: 1 },
};

class FakeSessionManager {
	constructor(cwd, sessionDir) {
		this.cwd = cwd;
		this.sessionDir = sessionDir;
		this.entries = [];
	}
	static create(cwd, sessionDir) {
		return new FakeSessionManager(cwd, sessionDir);
	}
	static inMemory(cwd) {
		return new FakeSessionManager(cwd, undefined);
	}
	getCwd() {
		return this.cwd;
	}
	getEntries() {
		return this.entries;
	}
	getTree() {
		return [];
	}
	getLeafId() {
		return null;
	}
	getSessionFile() {
		return undefined;
	}
	isPersisted() {
		return false;
	}
}

class FakeSession {
	constructor(services, sessionManager) {
		this.services = services;
		this.sessionManager = sessionManager;
		this.modelRuntime = services.modelRuntime;
		this.extensionRunner = {
			getRegisteredCommands: () => [
				{
					invocationName: "fake",
					description: "fake command",
					sourceInfo: { path: "fake.ts" },
				},
			],
			emitUserBash: async () => undefined,
		};
		this.promptTemplates = [];
		this.resourceLoader = services.resourceLoader;
		this.listeners = new Set();
		this.messages = [];
		this.model = model;
		this.thinkingLevel = "off";
		this.isStreaming = false;
		this.isCompacting = false;
		this.steeringMode = "one-at-a-time";
		this.followUpMode = "one-at-a-time";
		this.sessionFile = undefined;
		this.sessionId = "fake-session";
		this.sessionName = undefined;
		this.autoCompactionEnabled = true;
		this.pendingMessageCount = 0;
	}
	get state() {
		return { messages: this.messages };
	}
	async bindExtensions(bindings) {
		if (this.services.failBind) throw new Error("bind failed");
		this.bindings = bindings;
	}
	subscribe(listener) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	dispose() {}
	async prompt(_text, options) {
		options.preflightResult(true);
		this.messages.push({ role: "assistant", content: "hello" });
		for (const listener of this.listeners) listener({ type: "agent_settled" });
	}
	async steer() {}
	async followUp() {}
	async abort() {}
	clearQueue() {
		return { steering: [], followUp: [] };
	}
	async waitForIdle() {}
	setModel(next) {
		this.model = next;
	}
	cycleModel() {
		return { model, thinkingLevel: "off", isScoped: false };
	}
	setThinkingLevel(level) {
		this.thinkingLevel = level;
	}
	cycleThinkingLevel() {
		return "off";
	}
	getAvailableThinkingLevels() {
		return ["off"];
	}
	setSteeringMode(mode) {
		this.steeringMode = mode;
	}
	setFollowUpMode(mode) {
		this.followUpMode = mode;
	}
	async compact() {
		return { tokensBefore: 1, estimatedTokensAfter: 1 };
	}
	setAutoCompactionEnabled(enabled) {
		this.autoCompactionEnabled = enabled;
	}
	setAutoRetryEnabled() {}
	abortRetry() {}
	abortBash() {}
	async executeBash() {
		return { output: "" };
	}
	recordBashResult() {}
	getSessionStats() {
		return { totalMessages: this.messages.length };
	}
	async navigateTree() {
		return { cancelled: false };
	}
	getLastAssistantText() {
		return "hello";
	}
	setSessionName(name) {
		this.sessionName = name;
	}
}

function fakeSdk(capture) {
	const sdk = {
		SessionManager: FakeSessionManager,
		SettingsManager: {
			create(cwd, agentDir, options) {
				capture.settings = { cwd, agentDir, options };
				return { cwd, agentDir };
			},
		},
		async createAgentSessionServices(options) {
			capture.services = options;
			return {
				cwd: options.cwd,
				agentDir: options.agentDir,
				settingsManager: options.settingsManager,
				failBind: capture.failBind,
				resourceLoader: {
					getSkills: () => ({ skills: [] }),
				},
				modelRuntime: {
					getAvailableSnapshot: () => [model],
					getModel: () => model,
				},
				diagnostics: [],
			};
		},
		async createAgentSessionFromServices({ services, sessionManager }) {
			return { session: new FakeSession(services, sessionManager) };
		},
		async createAgentSessionRuntime(factory, options) {
			capture.runtimeCreates = (capture.runtimeCreates || 0) + 1;
			const created = await factory({
				cwd: options.cwd,
				agentDir: options.agentDir,
				sessionManager: options.sessionManager,
			});
			return {
				session: created.session,
				services: created.services,
				setRebindSession(fn) {
					this.rebind = fn;
				},
				setBeforeSessionInvalidate(fn) {
					this.beforeInvalidate = fn;
				},
				async newSession() {
					return { cancelled: false };
				},
				async switchSession() {
					return { cancelled: false };
				},
				async fork() {
					return { cancelled: false };
				},
				async dispose() {
					capture.runtimeDisposals = (capture.runtimeDisposals || 0) + 1;
				},
			};
		},
	};
	return sdk;
}

(async () => {
	const capture = {};
	const events = [];
	const runtime = createPiSdkRuntime({
		cwd: "/workspace/project",
		agentDir: "/tmp/pi-agent",
		sessionDir: "/tmp/pi-sessions",
		bundledExtension: __filename,
		sdk: fakeSdk(capture),
		onEvent: (event) => events.push(event),
	});
	await runtime.start();
	assert.equal(capture.runtimeCreates, 1);
	assert.equal(capture.settings.options.projectTrusted, false);
	assert.deepEqual(
		capture.services.resourceLoaderOptions,
		{
			additionalExtensionPaths: [__filename],
			noExtensions: true,
		},
	);
	assert.equal(runtime.session.bindings.mode, "json");
	assert.equal(runtime.session.bindings.uiContext != null, true);

	const state = await runtime.command({ type: "get_state", id: "state" });
	assert.equal(state.success, true);
	assert.equal(state.data.sessionId, "fake-session");
	const command = await runtime.command({
		type: "set_session_name",
		id: "rename",
		name: "Demo",
	});
	assert.equal(command.success, true);

	const dialog = runtime.session.bindings.uiContext.select("Pick", ["A"]);
	const request = events.find((event) => event.type === "extension_ui_request");
	assert.equal(request.method, "select");
	assert.equal(runtime.resolveUiRequest(request.id, { value: "A" }), true);
	assert.equal(await dialog, "A");

	const confirm = runtime.session.bindings.uiContext.confirm("Confirm", "Proceed?");
	const confirmRequest = events.at(-1);
	assert.equal(confirmRequest.method, "confirm");
	assert.equal(runtime.resolveUiRequest(confirmRequest.id, { confirmed: true }), true);
	assert.equal(await confirm, true);

	const input = runtime.session.bindings.uiContext.input("Input", "placeholder");
	const inputRequest = events.at(-1);
	assert.equal(inputRequest.method, "input");
	assert.equal(runtime.resolveUiRequest(inputRequest.id, { value: "answer" }), true);
	assert.equal(await input, "answer");

	const editor = runtime.session.bindings.uiContext.editor("Edit", "prefill");
	const editorRequest = events.at(-1);
	assert.equal(editorRequest.method, "editor");
	assert.equal(editorRequest.prefill, "prefill");
	assert.equal(runtime.resolveUiRequest(editorRequest.id, { value: "edited" }), true);
	assert.equal(await editor, "edited");

	const timed = runtime.session.bindings.uiContext.input("Timeout", "", { timeout: 1 });
	assert.equal(await timed, undefined);
	const abortedController = new AbortController();
	abortedController.abort();
	assert.equal(
		await runtime.session.bindings.uiContext.confirm("Aborted", "", {
			signal: abortedController.signal,
		}),
		false,
	);

	const bounded = runtime.session.bindings.uiContext.select(
		"T".repeat(50_000),
		["O".repeat(50_000), "second"],
	);
	const boundedRequest = events.at(-1);
	assert.equal(boundedRequest.title.length <= 4096, true);
	assert.equal(boundedRequest.options.length <= 100, true);
	assert.equal(boundedRequest.options[0].length <= 512, true);
	assert.equal(runtime.resolveUiRequest(boundedRequest.id, { value: "second" }), true);
	assert.equal(await bounded, "second");

	assert.equal(await runtime.start(), runtime);
	assert.equal(capture.runtimeCreates, 1);

	const missingExtension = __filename + ".missing";
	assert.equal(fs.existsSync(missingExtension), false);
	const degradedCapture = {};
	const degraded = createPiSdkRuntime({
		cwd: "/workspace/project",
		agentDir: "/tmp/pi-agent",
		sessionDir: "/tmp/pi-sessions",
		bundledExtension: missingExtension,
		sdk: fakeSdk(degradedCapture),
	});
	await degraded.start();
	assert.deepEqual(degradedCapture.services.resourceLoaderOptions, {
		additionalExtensionPaths: [],
		noExtensions: true,
	});
	await degraded.dispose();

	const failedCapture = { failBind: true };
	const failed = createPiSdkRuntime({
		cwd: "/workspace/project",
		agentDir: "/tmp/pi-agent",
		sessionDir: "/tmp/pi-sessions",
		bundledExtension: __filename,
		sdk: fakeSdk(failedCapture),
	});
	await assert.rejects(failed.start(), /bind failed/);
	assert.equal(failed.runtime, null);
	assert.equal(failed.session, null);
	assert.equal(failedCapture.runtimeDisposals, 1);

	const invalid = createPiSdkRuntime({
		cwd: "",
		agentDir: "/tmp/pi-agent",
		sessionDir: "/tmp/pi-sessions",
		bundledExtension: __filename,
		sdk: fakeSdk({}),
	});
	await assert.rejects(invalid.start(), /cwd/);

	const normalized = normalizeEvent({
		type: "message_update",
		message: { role: "assistant", usage: { input: 1 } },
		assistantMessageEvent: { type: "text_delta", delta: "hi", partial: {} },
	});
	assert.deepEqual(normalized, {
		type: "message_update",
		usage: { input: 1 },
		assistantMessageEvent: { type: "text_delta", delta: "hi" },
	});
	await runtime.dispose();
	console.log("pi-sdk-runtime.test.js — SDK adapter contract passed");
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
