/*
 * pi-sdk-runtime.js — the webui's in-process Pi adapter.
 *
 * The browser-facing protocol remains deliberately small (commands in, SSE
 * events out), but the agent itself is owned through the official SDK. This
 * keeps the webui independent from Pi's CLI transport and gives it a single
 * runtime object for sessions, models, resources, extension UI, and events.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

let sdkPromise;
function loadPiSdk() {
	if (!sdkPromise) {
		sdkPromise = import("@earendil-works/pi-coding-agent").catch((error) => {
			sdkPromise = undefined;
			throw error;
		});
	}
	return sdkPromise;
}

function success(id, command, data) {
	const response = { id, type: "response", command, success: true };
	if (data !== undefined) response.data = data;
	return response;
}

function failure(id, command, message) {
	return { id, type: "response", command, success: false, error: message };
}

function normalizeAssistantMessageEvent(event) {
	if (!event || event.type !== "toolcall_start") {
		if (!event || !Object.prototype.hasOwnProperty.call(event, "partial"))
			return event;
		const { partial: _partial, ...delta } = event;
		return delta;
	}
	const toolCall = event.partial?.content?.[event.contentIndex];
	const { partial: _partial, ...delta } = event;
	if (!toolCall || toolCall.type !== "toolCall") return delta;
	return { ...delta, id: toolCall.id, toolName: toolCall.name };
}

// The SDK's JSON event helper is intentionally internal. Keep this tiny
// compatibility normalizer local so the existing browser event contract does
// not need to know about the SDK's richer message_update payload.
function normalizeEvent(event) {
	if (!event || event.type !== "message_update") return event;
	if (event.message?.role !== "assistant") return event;
	return {
		type: "message_update",
		usage: event.message.usage,
		assistantMessageEvent: normalizeAssistantMessageEvent(
			event.assistantMessageEvent,
		),
	};
}

function requiredRuntimeValue(value, name) {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} is required`);
	return value;
}

function existingExtensionPaths(value) {
	if (typeof value !== "string" || !value.trim()) return [];
	try {
		return fs.statSync(value).isFile() ? [value] : [];
	} catch {
		return [];
	}
}

const UI_TEXT_MAX = 4096;
const UI_OPTION_MAX = 512;
const UI_OPTIONS_MAX = 100;
const SESSION_REBIND_COMMANDS = new Set([
	"new_session",
	"switch_session",
	"fork",
	"clone",
]);

function boundedUiText(value, limit = UI_TEXT_MAX) {
	return typeof value === "string" ? value.slice(0, limit) : "";
}

function boundedUiPayload(payload) {
	const out = { ...payload };
	for (const key of ["title", "message", "placeholder", "prefill", "statusText"])
		if (key in out) out[key] = boundedUiText(out[key]);
	if (Array.isArray(out.options))
		out.options = out.options
			.slice(0, UI_OPTIONS_MAX)
			.map((option) => boundedUiText(option, UI_OPTION_MAX));
	return out;
}

function requiredCommandText(command, name) {
	const value = command && command[name];
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} is required`);
	return value;
}

function requiredCommandBoolean(command, name) {
	if (!command || typeof command[name] !== "boolean")
		throw new Error(`${name} is required`);
	return command[name];
}

function dialogContext(emit, pending) {
	function dialog(opts, defaultValue, request, parse) {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
		const id = crypto.randomUUID();
		return new Promise((resolve) => {
			let timer;
			const cleanup = () => {
				if (timer) clearTimeout(timer);
				opts?.signal?.removeEventListener("abort", onAbort);
				pending.delete(id);
			};
			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });
			if (opts?.timeout) {
				timer = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}
			pending.set(id, {
				resolve: (response) => {
					cleanup();
					resolve(parse(response || {}));
				},
			});
			emit({
				type: "extension_ui_request",
				id,
				...boundedUiPayload(request),
			});
		});
	}

	const fire = (method, payload) =>
		emit({
			type: "extension_ui_request",
			id: crypto.randomUUID(),
			method,
			...boundedUiPayload(payload),
		});

	return {
		select: (title, options, opts) =>
			dialog(
				opts,
				undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(response) =>
					response.cancelled ? undefined : response.value,
			),
		confirm: (title, message, opts) =>
			dialog(
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(response) =>
					response.cancelled ? false : response.confirmed === true,
			),
		input: (title, placeholder, opts) =>
			dialog(
				opts,
				undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(response) =>
					response.cancelled || typeof response.value !== "string"
						? undefined
						: response.value,
			),
		notify(message, type) {
			fire("notify", { message, notifyType: type });
		},
		onTerminalInput() {
			return () => {};
		},
		setStatus(key, text) {
			fire("setStatus", { statusKey: key, statusText: text });
		},
		setWorkingMessage() {},
		setWorkingVisible() {},
		setWorkingIndicator() {},
		setHiddenThinkingLabel() {},
		setWidget(key, content, options) {
			if (content === undefined || Array.isArray(content)) {
				fire("setWidget", {
					widgetKey: key,
					widgetLines: content,
					widgetPlacement: options?.placement,
				});
			}
		},
		setFooter() {},
		setHeader() {},
		setTitle(title) {
			fire("setTitle", { title });
		},
		async custom() {
			return undefined;
		},
		pasteToEditor(text) {
			this.setEditorText(text);
		},
		setEditorText(text) {
			fire("set_editor_text", { text });
		},
		getEditorText() {
			return "";
		},
		editor: (title, prefill) =>
			dialog(
				undefined,
				undefined,
				{ method: "editor", title, prefill },
				(response) =>
					response.cancelled || typeof response.value !== "string"
						? undefined
						: response.value,
			),
		addAutocompleteProvider() {},
		setEditorComponent() {},
		getEditorComponent() {
			return undefined;
		},
		get theme() {
			return undefined;
		},
		getAllThemes() {
			return [];
		},
		getTheme() {
			return undefined;
		},
		setTheme() {
			return { success: false, error: "Themes are not available in web mode" };
		},
		getToolsExpanded() {
			return false;
		},
		setToolsExpanded() {},
	};
}

class PiSdkRuntime {
	constructor(options) {
		this.options = { ...options };
		this.runtime = null;
		this.session = null;
		this.unsubscribe = null;
		this.pending = new Map();
		this.ready = false;
		this.startPromise = null;
		this.generation = 0;
	}

	async start() {
		if (this.ready && this.runtime && this.session) return this;
		if (this.startPromise) return this.startPromise;
		const operation = (async () => {
			try {
				await this.startRuntime();
				return this;
			} catch (error) {
				await this.dispose();
				throw error;
			}
		})();
		this.startPromise = operation;
		try {
			return await operation;
		} finally {
			if (this.startPromise === operation) this.startPromise = null;
		}
	}

	async startRuntime() {
		const sdk = this.options.sdk || (await loadPiSdk());
		this.sdk = sdk;
		const {
			SessionManager,
			SettingsManager,
			createAgentSessionServices,
			createAgentSessionFromServices,
			createAgentSessionRuntime,
		} = sdk;
		const { cwd, agentDir, sessionDir, bundledExtension } = this.options;
		requiredRuntimeValue(cwd, "cwd");
		requiredRuntimeValue(agentDir, "agentDir");
		requiredRuntimeValue(sessionDir, "sessionDir");
		const additionalExtensionPaths = existingExtensionPaths(bundledExtension);
		const sessionManager = SessionManager.create(cwd, sessionDir);
		const createRuntime = async ({
			cwd: runtimeCwd,
			agentDir: runtimeAgentDir,
			sessionManager: runtimeSessionManager,
			sessionStartEvent,
		}) => {
			const settingsManager = SettingsManager.create(
				runtimeCwd,
				runtimeAgentDir,
				{ projectTrusted: false },
			);
			const services = await createAgentSessionServices({
				cwd: runtimeCwd,
				agentDir: runtimeAgentDir,
				settingsManager,
				resourceLoaderOptions: {
					// Preserve Pi's global/project context-file loading, but only load
					// the package-owned bridge extension. Project extensions remain off.
					// A missing bridge is degraded operation, never a reason to load a
					// workspace-local extension.
					additionalExtensionPaths,
					noExtensions: true,
				},
			});
			const created = await createAgentSessionFromServices({
				services,
				sessionManager: runtimeSessionManager,
				sessionStartEvent,
			});
			return {
				...created,
				services,
				diagnostics: services.diagnostics,
			};
		};

		this.runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir,
			sessionManager,
		});
		this.runtime.setBeforeSessionInvalidate(() => this.cancelPendingUi());
		this.runtime.setRebindSession(async () => this.bindSession());
		await this.bindSession();
		this.ready = true;
		return this;
	}

	async bindSession() {
		this.generation++;
		if (this.unsubscribe) this.unsubscribe();
		this.unsubscribe = null;
		this.session = this.runtime.session;
		await this.session.bindExtensions({
			uiContext: dialogContext((event) => this.emit(event), this.pending),
			mode: "json",
			commandContextActions: {
				waitForIdle: () => this.session.waitForIdle(),
				newSession: (options) => this.runtime.newSession(options),
				fork: async (entryId, options) => {
					const result = await this.runtime.fork(entryId, options);
					return { cancelled: result.cancelled };
				},
				navigateTree: (targetId, options) =>
					this.session.navigateTree(targetId, options),
				switchSession: (sessionPath, options) =>
					this.runtime.switchSession(sessionPath, options),
				reload: () => this.session.reload(),
			},
			abortHandler: () => {
				void this.session.abort();
			},
			shutdownHandler: () => this.options.onShutdown?.(),
			onError: (error) =>
				this.emit({
					type: "extension_error",
					extensionPath: error.extensionPath,
					event: error.event,
					error: error.error,
				}),
		});
		this.unsubscribe = this.session.subscribe((event) =>
			this.emit(normalizeEvent(event)),
		);
	}

	emit(event) {
		if (typeof this.options.onEvent === "function") this.options.onEvent(event);
	}

	cancelPendingUi() {
		for (const request of this.pending.values()) request.resolve({ cancelled: true });
		this.pending.clear();
	}

	resolveUiRequest(id, response) {
		const pending = this.pending.get(id);
		if (!pending) return false;
		pending.resolve(response);
		return true;
	}

	async command(command) {
		if (!this.ready || !this.session) throw new Error("pi not ready");
		const generation = this.generation;
		const targetRuntime = this.runtime;
		const id = command && command.id;
		const type = command && command.type;
		const response = await this.dispatch(command);
		const expectedRebind =
			SESSION_REBIND_COMMANDS.has(type) &&
			this.runtime === targetRuntime &&
			this.ready &&
			this.generation === generation + 1;
		if (generation !== this.generation && !expectedRebind)
			return failure(id, type, "stale runtime operation");
		return response;
	}

	async dispatch(command) {
		const id = command && command.id;
		const type = command && command.type;
		try {
			switch (type) {
				case "prompt":
					requiredCommandText(command, "message");
					return await this.prompt(command);
				case "steer":
					await this.session.steer(
						requiredCommandText(command, "message"),
						command.images,
					);
					return success(id, type);
				case "follow_up":
					await this.session.followUp(
						requiredCommandText(command, "message"),
						command.images,
					);
					return success(id, type);
				case "abort":
					await this.session.abort();
					return success(id, type);
				case "clear_queue":
					return success(id, type, this.session.clearQueue());
				case "new_session":
					if (
						command.parentSession !== undefined &&
						(typeof command.parentSession !== "string" ||
							!command.parentSession.trim())
					)
						throw new Error("parentSession is invalid");
					return success(id, type, await this.runtime.newSession(
						command.parentSession
							? { parentSession: command.parentSession }
							: undefined,
					));
				case "get_state":
					return success(id, type, this.state());
				case "set_model": {
					const provider = requiredCommandText(command, "provider");
					const modelId = requiredCommandText(command, "modelId");
					const model = this.session.modelRuntime
						.getAvailableSnapshot()
						.find(
							(item) =>
								item.provider === provider &&
								item.id === modelId,
						);
					if (!model)
						return failure(
							id,
							type,
							`Model not found: ${command.provider}/${command.modelId}`,
						);
					await this.session.setModel(model);
					return success(id, type, model);
				}
				case "cycle_model":
					return success(id, type, await this.session.cycleModel());
				case "get_available_models":
					return success(id, type, {
						models: this.session.modelRuntime.getAvailableSnapshot(),
					});
				case "set_thinking_level":
					this.session.setThinkingLevel(
						requiredCommandText(command, "level"),
					);
					return success(id, type);
				case "cycle_thinking_level":
					return success(id, type, {
						level: this.session.cycleThinkingLevel(),
					});
				case "get_available_thinking_levels":
					return success(id, type, {
						levels: this.session.getAvailableThinkingLevels(),
					});
				case "set_steering_mode":
					this.session.setSteeringMode(
						requiredCommandText(command, "mode"),
					);
					return success(id, type);
				case "set_follow_up_mode":
					this.session.setFollowUpMode(
						requiredCommandText(command, "mode"),
					);
					return success(id, type);
				case "compact":
					return success(id, type, await this.session.compact(command.customInstructions));
				case "set_auto_compaction":
					this.session.setAutoCompactionEnabled(
						requiredCommandBoolean(command, "enabled"),
					);
					return success(id, type);
				case "set_auto_retry":
					this.session.setAutoRetryEnabled(
						requiredCommandBoolean(command, "enabled"),
					);
					return success(id, type);
				case "abort_retry":
					this.session.abortRetry();
					return success(id, type);
				case "bash": {
					const bashCommand = requiredCommandText(command, "command");
					const eventResult = await this.session.extensionRunner.emitUserBash({
						type: "user_bash",
						command: bashCommand,
						excludeFromContext: command.excludeFromContext ?? false,
						cwd: this.session.sessionManager.getCwd(),
					});
					if (eventResult?.result) {
						this.session.recordBashResult(bashCommand, eventResult.result, {
							excludeFromContext: command.excludeFromContext,
						});
						return success(id, type, eventResult.result);
					}
					return success(
						id,
						type,
						await this.session.executeBash(bashCommand, undefined, {
							excludeFromContext: command.excludeFromContext,
							id,
						},
					),
					);
				}
				case "abort_bash":
					this.session.abortBash();
					return success(id, type);
				case "get_session_stats":
					return success(id, type, this.session.getSessionStats());
				case "switch_session":
					return success(
						id,
						type,
						await this.runtime.switchSession(
							requiredCommandText(command, "sessionPath"),
						),
					);
				case "fork": {
					const result = await this.runtime.fork(
						requiredCommandText(command, "entryId"),
					);
					return success(id, type, {
						text: result.selectedText,
						cancelled: result.cancelled,
					});
				}
				case "clone": {
					const leafId = this.session.sessionManager.getLeafId();
					if (!leafId) return failure(id, type, "Cannot clone session: no current entry selected");
					return success(id, type, await this.runtime.fork(leafId, { position: "at" }));
				}
				case "get_entries": {
					let entries = this.session.sessionManager.getEntries();
					if (command.since !== undefined) {
						const index = entries.findIndex((entry) => entry.id === command.since);
						if (index === -1) return failure(id, type, `Entry not found: ${command.since}`);
						entries = entries.slice(index + 1);
					}
					return success(id, type, {
						entries,
						leafId: this.session.sessionManager.getLeafId(),
					});
				}
				case "get_tree":
					return success(id, type, {
						tree: this.session.sessionManager.getTree(),
						leafId: this.session.sessionManager.getLeafId(),
					});
				case "get_last_assistant_text":
					return success(id, type, { text: this.session.getLastAssistantText() });
				case "set_session_name": {
					const name = requiredCommandText(command, "name").trim();
					this.session.setSessionName(name);
					return success(id, type);
				}
				case "get_messages":
					return success(id, type, { messages: this.session.messages });
				case "get_commands":
					return success(id, type, { commands: this.commands() });
				default:
					return failure(id, type, `Unknown command: ${type}`);
			}
		} catch (error) {
			return failure(id, type, error instanceof Error ? error.message : String(error));
		}
	}

	async prompt(command) {
		return new Promise((resolve, reject) => {
			let responded = false;
			const respond = (response) => {
				if (responded) return;
				responded = true;
				resolve(response);
			};
			void this.session
				.prompt(command.message, {
					images: command.images,
					streamingBehavior: command.streamingBehavior,
					source: "interactive",
					preflightResult: (accepted) => {
						if (accepted) respond(success(command.id, "prompt"));
					},
				})
				.then(() => {
					if (!responded) respond(success(command.id, "prompt"));
				})
				.catch((error) => {
					if (!responded) reject(error);
				});
		});
	}

	state() {
		return {
			model: this.session.model,
			thinkingLevel: this.session.thinkingLevel,
			isStreaming: this.session.isStreaming,
			isCompacting: this.session.isCompacting,
			steeringMode: this.session.steeringMode,
			followUpMode: this.session.followUpMode,
			sessionFile: this.session.sessionFile,
			sessionId: this.session.sessionId,
			sessionName: this.session.sessionName,
			autoCompactionEnabled: this.session.autoCompactionEnabled,
			messageCount: this.session.messages.length,
			pendingMessageCount: this.session.pendingMessageCount,
		};
	}

	commands() {
		const commands = [];
		for (const command of this.session.extensionRunner.getRegisteredCommands()) {
			commands.push({
				name: command.invocationName,
				description: command.description,
				source: "extension",
				sourceInfo: command.sourceInfo,
			});
		}
		for (const template of this.session.promptTemplates) {
			commands.push({
				name: template.name,
				description: template.description,
				source: "prompt",
				sourceInfo: template.sourceInfo,
			});
		}
		for (const skill of this.session.resourceLoader.getSkills().skills) {
			commands.push({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill",
				sourceInfo: skill.sourceInfo,
			});
		}
		return commands;
	}

	snapshot() {
		return {
			state: this.state(),
			messages: this.session.messages,
			commands: this.commands(),
			models: this.session.modelRuntime.getAvailableSnapshot(),
			stats: this.session.getSessionStats(),
		};
	}

	async dispose() {
		this.generation++;
		this.ready = false;
		this.cancelPendingUi();
		const unsubscribe = this.unsubscribe;
		const runtime = this.runtime;
		this.unsubscribe = null;
		this.runtime = null;
		this.session = null;
		try {
			if (unsubscribe) unsubscribe();
		} finally {
			if (runtime) await runtime.dispose();
		}
	}
}

function createPiSdkRuntime(options) {
	return new PiSdkRuntime(options);
}

module.exports = {
	PiSdkRuntime,
	createPiSdkRuntime,
	loadPiSdk,
	normalizeEvent,
};
