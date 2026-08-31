/*
 * isolated-prompt.js — run a one-shot prompt in a disposable SDK session.
 * Ported from pi-livecraft's run-isolated-prompt.ts + prompt-improvement.ts (MIT).
 *
 * runIsolatedPrompt({cwd, prompt, systemPrompt, model}) creates a SEPARATE
 * in-memory AgentSession with a dedicated profile dir (~/.pi/pi-webui-isolated)
 * that copies auth.json/models.json from the user's main config — so an
 * isolated system prompt and no-tools policy can never write to the user's
 * main settings, while still authenticating (§6.4: the security boundary).
 *
 * Used by the "Improve prompt" composer action (plan 4.8): rewrites the current
 * draft via the cheapest available model (output cost → input cost → reasoning).
 *
 * CommonJS, no browser side.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadPiSdk } = require("./pi-sdk-runtime.js");
const { boundedText, normalizeLimits } = require("./secondary-runs.js");

const ISOLATED_DIR = path.join(os.homedir(), ".pi", "pi-webui-isolated");

// ---- isolated profile dir (copy auth/models once) ----
let dirReady = false;
function ensureIsolatedDir() {
	if (!dirReady) {
		fs.mkdirSync(ISOLATED_DIR, { recursive: true });
		dirReady = true;
	}
	const mainDir =
		process.env.PI_CODING_AGENT_DIR ||
		path.join(os.homedir(), ".pi", "agent");
	for (const file of ["auth.json", "models.json"]) {
		const source = path.join(mainDir, file);
		const dest = path.join(ISOLATED_DIR, file);
		try {
			const sourceStat = fs.statSync(source);
			let copy = true;
			try {
				const destStat = fs.statSync(dest);
				copy =
					sourceStat.size !== destStat.size ||
					sourceStat.mtimeMs > destStat.mtimeMs;
			} catch {}
			if (copy) fs.copyFileSync(source, dest);
		} catch {
			// file may not exist (e.g. no custom models.json) — fine
		}
	}
}

// ---- model / text helpers (pure, exported for tests) ----
function isObject(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
// Cheapest usable model: output cost → input cost → reasoning (matches pi-auto-title).
function cheapestAvailableModel(response) {
	const data = isObject(response?.data) ? response.data : response;
	if (!isObject(data) || !Array.isArray(data.models)) return undefined;
	const models = data.models.filter(
		(m) =>
			isObject(m) &&
			typeof m.id === "string" &&
			typeof m.provider === "string" &&
			isObject(m.cost) &&
			typeof m.cost.input === "number" &&
			typeof m.cost.output === "number" &&
			typeof m.reasoning === "boolean",
	);
	models.sort(
		(a, b) =>
			a.cost.output - b.cost.output ||
			a.cost.input - b.cost.input ||
			Number(a.reasoning) - Number(b.reasoning),
	);
	return models[0];
}
// Last assistant text from a completed disposable session.
function assistantText(response) {
	const data = isObject(response?.data) ? response.data : response;
	if (!isObject(data) || !Array.isArray(data.messages)) return undefined;
	for (let i = data.messages.length - 1; i >= 0; i--) {
		const message = data.messages[i];
		if (!isObject(message) || message.role !== "assistant") continue;
		if (typeof message.content === "string" && message.content.trim())
			return message.content.trim();
		if (!Array.isArray(message.content)) continue;
		const parts = [];
		for (const part of message.content) {
			if (
				isObject(part) &&
				part.type === "text" &&
				typeof part.text === "string"
			)
				parts.push(part.text);
		}
		const text = parts.join("");
		if (text.trim()) return text.trim();
	}
	return undefined;
}

function assistantErrorMessage(response) {
	const data = isObject(response?.data) ? response.data : response;
	if (!isObject(data) || !Array.isArray(data.messages)) return undefined;
	for (let i = data.messages.length - 1; i >= 0; i--) {
		const message = data.messages[i];
		if (
			isObject(message) &&
			message.role === "assistant" &&
			typeof message.errorMessage === "string" &&
			message.errorMessage.trim()
		)
			return message.errorMessage.trim();
	}
	return undefined;
}

function codedError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function buildIsolatedOptions(systemPrompt) {
	return {
		noTools: "all",
		thinkingLevel: "off",
		resourceLoaderOptions: {
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt,
		},
	};
}

function prepareIsolatedPrompt(options) {
	const source = options && typeof options === "object" ? options : {};
	const limits = normalizeLimits({
		contextChars: source.maxPromptChars,
		outputChars: source.maxOutputChars,
		timeoutMs: source.timeoutMs,
	});
	const prompt = boundedText(source.prompt, limits.contextChars);
	return {
		cwd: source.cwd,
		prompt: prompt.text,
		inputTruncated: prompt.truncated,
		systemPrompt:
			typeof source.systemPrompt === "string" ? source.systemPrompt : "",
		model: source.model,
		sdk: source.sdk,
		thinkingLevel:
			typeof source.thinkingLevel === "string"
				? source.thinkingLevel
				: undefined,
		signal: source.signal,
		limits,
	};
}


function runIsolatedPrompt(options) {
	return (async () => {
		const prepared = prepareIsolatedPrompt(options);
		const signal = prepared.signal;
		if (signal?.aborted)
			throw codedError("SECONDARY_CANCELLED", "secondary run cancelled");
		ensureIsolatedDir();

		const sdk = prepared.sdk || (await loadPiSdk());
		const {
			SessionManager,
			SettingsManager,
			createAgentSessionServices,
			createAgentSessionFromServices,
		} = sdk;
		const settingsManager = SettingsManager.create(
			prepared.cwd,
			ISOLATED_DIR,
			{ projectTrusted: false },
		);
		const optionsForSdk = buildIsolatedOptions(prepared.systemPrompt);
		const services = await createAgentSessionServices({
			cwd: prepared.cwd,
			agentDir: ISOLATED_DIR,
			settingsManager,
			resourceLoaderOptions: optionsForSdk.resourceLoaderOptions,
		});
		const { session } = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(prepared.cwd),
			noTools: optionsForSdk.noTools,
			thinkingLevel: prepared.thinkingLevel || optionsForSdk.thinkingLevel,
		});

		let timeout;
		let abortListener;
		let finished = false;
		const stop = async (error) => {
			if (finished) return;
			finished = true;
			if (timeout) clearTimeout(timeout);
			if (signal && abortListener)
				signal.removeEventListener("abort", abortListener);
			if (error) {
				try {
					await session.abort();
				} catch {}
			}
			try {
				session.dispose();
			} catch {}
		};

		const cancellation = new Promise((_, reject) => {
			timeout = setTimeout(
				() =>
					reject(
						codedError("SECONDARY_TIMEOUT", "isolated prompt timed out"),
					),
				prepared.limits.timeoutMs,
			);
			if (signal) {
				abortListener = () =>
					reject(
						codedError(
							"SECONDARY_CANCELLED",
							"secondary run cancelled",
						),
					);
				signal.addEventListener("abort", abortListener, { once: true });
			}
		});

		try {
			let selectedModel = prepared.model;
			if (selectedModel) {
				const model = session.modelRuntime.getModel(
					selectedModel.provider,
					selectedModel.modelId,
				);
				if (!model)
					throw codedError(
						"SECONDARY_NO_MODEL",
						`Model not found: ${selectedModel.provider}/${selectedModel.modelId}`,
					);
				await session.setModel(model);
			} else {
				const cheapest = cheapestAvailableModel({
					models: session.modelRuntime.getAvailableSnapshot(),
				});
				if (!cheapest)
					throw codedError(
						"SECONDARY_NO_MODEL",
						"No model is available to run the prompt",
					);
				selectedModel = {
					provider: cheapest.provider,
					modelId: cheapest.id,
				};
				const model = session.modelRuntime.getModel(
					selectedModel.provider,
					selectedModel.modelId,
				);
				await session.setModel(model);
			}
			if (prepared.thinkingLevel)
				session.setThinkingLevel(prepared.thinkingLevel);

			await Promise.race([
				session.prompt(prepared.prompt, { source: "interactive" }),
				cancellation,
			]);
			const text = assistantText({ messages: session.messages });
			if (!text) {
				const modelError = assistantErrorMessage({ messages: session.messages });
				throw codedError(
					modelError ? "SECONDARY_MODEL" : "SECONDARY_NO_TEXT",
					modelError || "The model returned no text",
				);
			}
			const output = boundedText(text, prepared.limits.outputChars);
			await stop();
			return {
				text: output.text,
				inputTruncated: prepared.inputTruncated,
				outputTruncated: output.truncated,
				model: selectedModel,
				modelSource: prepared.model ? "selected" : "resolved",
			};
		} catch (error) {
			await stop(error);
			throw error;
		}
	})();
}

// ---- improve-prompt presets (plan 4.8) ----
const IMPROVE_SYSTEM_PROMPT =
	"You rewrite the user's draft prompt to be clearer and more effective. " +
	"Output ONLY the rewritten prompt text — no preamble, no explanation, no markdown code fence. " +
	"Preserve the user's intent and all concrete details; do not add assumptions.";
const IMPROVE_DIRECTIONS = {
	clarify:
		"Clarify the request. Make the expected outcome, scope, and constraints explicit only when they are already implied by the draft.",
	ideate: "Encourage the model to suggest ideas, alternatives, or approaches relevant to the draft. Do not impose a format, count, or structure.",
	precise:
		"Make the request precise and unambiguous. Use specific, well-defined terms. Preserve all existing facts and constraints; do not add assumptions.",
};
function improvePrompt(cwd, draft, direction) {
	const dir = IMPROVE_DIRECTIONS[direction];
	const instruction = dir ? `Direction: ${dir}\n\n` : "";
	const prompt =
		instruction +
		"Rewrite the following draft prompt. Output only the rewritten prompt:\n\n" +
		draft;
	return runIsolatedPrompt({
		cwd: cwd,
		prompt: prompt,
		systemPrompt: IMPROVE_SYSTEM_PROMPT,
	});
}

module.exports = {
	improvePrompt: improvePrompt,
	cheapestAvailableModel: cheapestAvailableModel,
	assistantText: assistantText,
	assistantErrorMessage: assistantErrorMessage,
	buildIsolatedOptions: buildIsolatedOptions,
	prepareIsolatedPrompt: prepareIsolatedPrompt,
	runIsolatedPrompt: runIsolatedPrompt,
	IMPROVE_DIRECTIONS: IMPROVE_DIRECTIONS,
	ISOLATED_DIR: ISOLATED_DIR,
};
