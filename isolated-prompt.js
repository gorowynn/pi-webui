/*
 * isolated-prompt.js — run a one-shot prompt in a disposable pi process (plan 4.7).
 * Ported from pi-livecraft's run-isolated-prompt.ts + prompt-improvement.ts (MIT).
 *
 * runIsolatedPrompt({cwd, prompt, systemPrompt, model}) spawns a SEPARATE
 * `pi --mode rpc --no-session --no-tools --no-extensions --no-skills … --thinking
 * off --system-prompt …` in a dedicated profile dir (~/.pi/pi-webui-isolated) that
 * copies auth.json/models.json from the user's main config — so an isolated
 * --system-prompt and --no-tools can never write to the user's main settings,
 * while still authenticating (§6.4: the security boundary, kept exactly). The
 * process is terminated immediately after the response is extracted.
 *
 * Used by the "Improve prompt" composer action (plan 4.8): rewrites the current
 * draft via the cheapest available model (output cost → input cost → reasoning).
 *
 * CommonJS, depends only on jsonl.js (the strict codec). No browser side.
 */

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { JsonLineDecoder, encodeJsonLine } = require("./jsonl.js");
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

function killPidTree(pid) {
	if (!pid) return;
	try {
		if (process.platform === "win32")
			execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
			});
		else process.kill(pid, "SIGKILL");
	} catch {}
}

// ---- model / text helpers (pure, exported for tests) ----
function isObject(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}
// Cheapest usable model: output cost → input cost → reasoning (matches pi-auto-title).
function cheapestAvailableModel(response) {
	const data = isObject(response) ? response.data : null;
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
	const data = isObject(response) ? response.data : null;
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
	const data = isObject(response) ? response.data : null;
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

function buildIsolatedArgs(systemPrompt) {
	return [
		"--mode",
		"rpc",
		"--no-session",
		"--no-tools",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--thinking",
		"off",
		"--system-prompt",
		systemPrompt,
	];
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
		thinkingLevel:
			typeof source.thinkingLevel === "string"
				? source.thinkingLevel
				: undefined,
		signal: source.signal,
		limits,
	};
}

// ---- the one-shot run ----
function runIsolatedPrompt(options) {
	return new Promise((resolve, reject) => {
		const prepared = prepareIsolatedPrompt(options);
		const signal = prepared.signal;
		if (signal && signal.aborted) {
			reject(
				codedError("SECONDARY_CANCELLED", "secondary run cancelled"),
			);
			return;
		}
		ensureIsolatedDir();
		const cwd = prepared.cwd;
		const prompt = prepared.prompt;
		const systemPrompt = prepared.systemPrompt;
		const model = prepared.model;
		let selectedModel = model;
		const thinkingLevel = prepared.thinkingLevel;
		const piBin = process.env.PI_BIN || "pi";
		const args = buildIsolatedArgs(systemPrompt);
		// Windows: pi is a .cmd shim needing shell:true to resolve PATHEXT (same as the
		// main pi spawn in server.js). All args are trusted/fixed strings (systemPrompt
		// has no shell metacharacters; the user draft goes via RPC stdin, not argv).
		const useShell = process.platform === "win32";
		const child = useShell
			? spawn(`${piBin} ${args.join(" ")}`, [], {
					cwd: cwd,
					env: Object.assign({}, process.env, {
						PI_CODING_AGENT_DIR: ISOLATED_DIR,
					}),
					stdio: ["pipe", "pipe", "pipe"],
					shell: true,
					windowsHide: true,
				})
			: spawn(piBin, args, {
					cwd: cwd,
					env: Object.assign({}, process.env, {
						PI_CODING_AGENT_DIR: ISOLATED_DIR,
					}),
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
					windowsHide: true,
				});

		const dec = new JsonLineDecoder();
		let nextId = 1;
		const pending = new Map(); // id → resolve
		let settled = false;
		let agentSettled = false;
		const settledWaiters = [];
		let abortListener = null;
		let timeout = null;

		function send(cmd) {
			if (settled)
				return Promise.resolve({
					ok: false,
					error: "isolated prompt stopped",
				});
			const id = nextId++;
			return new Promise((res) => {
				pending.set(id, res);
				try {
					child.stdin.write(
						encodeJsonLine(Object.assign({ id: id }, cmd)),
					);
				} catch (e) {
					pending.delete(id);
					res({ ok: false, error: e.message });
				}
			});
		}

		child.stdout.on("data", (chunk) => {
			dec.push(chunk, (obj) => {
				if (
					obj.type === "response" &&
					obj.id != null &&
					pending.has(obj.id)
				) {
					const r = pending.get(obj.id);
					pending.delete(obj.id);
					r(obj);
				} else if (obj.type === "agent_settled") {
					agentSettled = true;
					while (settledWaiters.length) settledWaiters.shift()();
				}
			});
		});
		child.stdin.on("error", () => {
			if (!settled)
				finish(
					codedError("SECONDARY_FAILED", "isolated pi input failed"),
				);
		});
		child.stderr.resume();

		function finish(err, result) {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			if (signal && abortListener)
				signal.removeEventListener("abort", abortListener);
			while (settledWaiters.length) settledWaiters.shift()();
			killPidTree(child.pid);
			if (err) reject(err);
			else resolve(result);
		}
		timeout = setTimeout(() => {
			finish(
				codedError("SECONDARY_TIMEOUT", "isolated prompt timed out"),
			);
		}, prepared.limits.timeoutMs);
		if (signal) {
			abortListener = () =>
				finish(
					codedError(
						"SECONDARY_CANCELLED",
						"secondary run cancelled",
					),
				);
			signal.addEventListener("abort", abortListener, { once: true });
		}

		child.once("error", () => {
			finish(
				codedError("SECONDARY_FAILED", "isolated pi failed to start"),
			);
		});
		child.once("exit", () => {
			if (!settled)
				finish(
					codedError(
						"SECONDARY_FAILED",
						"pi exited before completing",
					),
				);
		});

		function waitForSettled() {
			return new Promise((res) => {
				if (agentSettled) res();
				else settledWaiters.push(res);
			});
		}

		(async () => {
			try {
				// 1. model: explicit, or auto-select the cheapest available
				if (model) {
					await send({
						type: "set_model",
						provider: model.provider,
						modelId: model.modelId,
					});
				} else {
					const avail = await send({ type: "get_available_models" });
					const cheapest = cheapestAvailableModel(avail);
					if (!cheapest)
						throw codedError(
							"SECONDARY_NO_MODEL",
							"No model is available to run the prompt",
						);
					selectedModel = {
						provider: cheapest.provider,
						modelId: cheapest.id,
					};
					await send({
						type: "set_model",
						provider: selectedModel.provider,
						modelId: selectedModel.modelId,
					});
				}
				if (thinkingLevel)
					await send({
						type: "set_thinking_level",
						level: thinkingLevel,
					});
				// 2. prompt + wait for the turn to settle (--no-tools → single turn)
				await Promise.all([
					send({ type: "prompt", message: prompt }),
					waitForSettled(),
				]);
				// 3. extract the assistant text
				const msgs = await send({ type: "get_messages" });
				const text = assistantText(msgs);
				if (!text) {
					const modelError = assistantErrorMessage(msgs);
					throw codedError(
						modelError ? "SECONDARY_MODEL" : "SECONDARY_NO_TEXT",
						modelError || "The model returned no text",
					);
				}
				const output = boundedText(text, prepared.limits.outputChars);
				finish(null, {
					text: output.text,
					inputTruncated: prepared.inputTruncated,
					outputTruncated: output.truncated,
					model: selectedModel,
					modelSource: model ? "selected" : "resolved",
				});
			} catch (e) {
				finish(e);
			}
		})();
	});
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
	buildIsolatedArgs: buildIsolatedArgs,
	prepareIsolatedPrompt: prepareIsolatedPrompt,
	runIsolatedPrompt: runIsolatedPrompt,
	IMPROVE_DIRECTIONS: IMPROVE_DIRECTIONS,
	ISOLATED_DIR: ISOLATED_DIR,
};
