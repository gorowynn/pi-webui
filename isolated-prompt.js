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
"use strict";

const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { JsonLineDecoder, encodeJsonLine } = require("./jsonl.js");

const ISOLATED_DIR = path.join(os.homedir(), ".pi", "pi-webui-isolated");
const TIMEOUT_MS = 120000;

// ---- isolated profile dir (copy auth/models once) ----
let dirReady = false;
function ensureIsolatedDir() {
	if (dirReady) return;
	fs.mkdirSync(ISOLATED_DIR, { recursive: true });
	const mainDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	for (const file of ["auth.json", "models.json"]) {
		const dest = path.join(ISOLATED_DIR, file);
		try {
			fs.statSync(dest);
		} catch {
			try {
				fs.copyFileSync(path.join(mainDir, file), dest);
			} catch {
				// file may not exist (e.g. no custom models.json) — fine
			}
		}
	}
	dirReady = true;
}

function killPidTree(pid) {
	try {
		if (process.platform === "win32")
			execSync("taskkill /pid " + pid + " /T /F", { stdio: "ignore" });
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
	const models = data.models.filter(function (m) {
		return (
			isObject(m) &&
			typeof m.id === "string" &&
			typeof m.provider === "string" &&
			isObject(m.cost) &&
			typeof m.cost.input === "number" &&
			typeof m.cost.output === "number" &&
			typeof m.reasoning === "boolean"
		);
	});
	models.sort(function (a, b) {
		return (
			a.cost.output - b.cost.output ||
			a.cost.input - b.cost.input ||
			Number(a.reasoning) - Number(b.reasoning)
		);
	});
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
			if (isObject(part) && part.type === "text" && typeof part.text === "string")
				parts.push(part.text);
		}
		const text = parts.join("");
		if (text.trim()) return text.trim();
	}
	return undefined;
}

// ---- the one-shot run ----
function runIsolatedPrompt(options) {
	return new Promise(function (resolve, reject) {
		ensureIsolatedDir();
		const cwd = options.cwd;
		const prompt = options.prompt;
		const systemPrompt = options.systemPrompt || "";
		const model = options.model;
		const piBin = process.env.PI_BIN || "pi";
		const args = [
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
		// Windows: pi is a .cmd shim needing shell:true to resolve PATHEXT (same as the
		// main pi spawn in server.js). All args are trusted/fixed strings (systemPrompt
		// has no shell metacharacters; the user draft goes via RPC stdin, not argv).
		const useShell = process.platform === "win32";
		const child = useShell
			? spawn(piBin + " " + args.join(" "), [], {
					cwd: cwd,
					env: Object.assign({}, process.env, { PI_CODING_AGENT_DIR: ISOLATED_DIR }),
					stdio: ["pipe", "pipe", "pipe"],
					shell: true,
					windowsHide: true,
				})
			: spawn(piBin, args, {
					cwd: cwd,
					env: Object.assign({}, process.env, { PI_CODING_AGENT_DIR: ISOLATED_DIR }),
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
		let stderr = "";

		function send(cmd) {
			const id = nextId++;
			return new Promise(function (res) {
				pending.set(id, res);
				try {
					child.stdin.write(encodeJsonLine(Object.assign({ id: id }, cmd)));
				} catch (e) {
					pending.delete(id);
					res({ ok: false, error: e.message });
				}
			});
		}

		child.stdout.on("data", function (chunk) {
			dec.push(chunk, function (obj) {
				if (obj.type === "response" && obj.id != null && pending.has(obj.id)) {
					const r = pending.get(obj.id);
					pending.delete(obj.id);
					r(obj);
				} else if (obj.type === "agent_settled") {
					agentSettled = true;
					while (settledWaiters.length) settledWaiters.shift()();
				}
			});
		});
		child.stderr.on("data", function (c) {
			stderr += c.toString("utf8");
		});

		const timeout = setTimeout(function () {
			finish(new Error("isolated prompt timed out"));
		}, TIMEOUT_MS);

		function finish(err, result) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			killPidTree(child.pid);
			if (err) reject(err);
			else resolve(result);
		}

		child.once("error", function (e) {
			finish(e);
		});
		child.once("exit", function (code) {
			if (!settled) finish(new Error("pi exited before completing (code " + code + "): " + stderr.trim()));
		});

		function waitForSettled() {
			return new Promise(function (res) {
				if (agentSettled) res();
				else settledWaiters.push(res);
			});
		}

		(async function () {
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
						throw new Error("No model is available to run the prompt");
					await send({
						type: "set_model",
						provider: cheapest.provider,
						modelId: cheapest.id,
					});
				}
				// 2. prompt + wait for the turn to settle (--no-tools → single turn)
				await Promise.all([send({ type: "prompt", message: prompt }), waitForSettled()]);
				// 3. extract the assistant text
				const msgs = await send({ type: "get_messages" });
				const text = assistantText(msgs);
				if (!text) throw new Error("The model returned no text");
				finish(null, { text: text });
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
	ideate:
		"Encourage the model to suggest ideas, alternatives, or approaches relevant to the draft. Do not impose a format, count, or structure.",
	precise:
		"Make the request precise and unambiguous. Use specific, well-defined terms. Preserve all existing facts and constraints; do not add assumptions.",
};
function improvePrompt(cwd, draft, direction) {
	const dir = IMPROVE_DIRECTIONS[direction];
	const instruction = dir
		? "Direction: " + dir + "\n\n"
		: "";
	const prompt =
		instruction +
		"Rewrite the following draft prompt. Output only the rewritten prompt:\n\n" +
		draft;
	return runIsolatedPrompt({ cwd: cwd, prompt: prompt, systemPrompt: IMPROVE_SYSTEM_PROMPT });
}

module.exports = {
	runIsolatedPrompt: runIsolatedPrompt,
	improvePrompt: improvePrompt,
	cheapestAvailableModel: cheapestAvailableModel,
	assistantText: assistantText,
	IMPROVE_DIRECTIONS: IMPROVE_DIRECTIONS,
	ISOLATED_DIR: ISOLATED_DIR,
};
