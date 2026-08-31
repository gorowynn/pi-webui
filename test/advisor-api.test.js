/*
 * C06 — isolated advisor execution through a provider-backed SDK server.
 * Opt in explicitly: PI_WEBUI_LIVE_INTEGRATION=1 node test/advisor-api.test.js
 */
"use strict";

if (process.env.PI_WEBUI_LIVE_INTEGRATION !== "1") {
	console.log("advisor-api.test.js — skipped (provider-backed SDK integration)");
	process.exit(0);
}

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
	return new Promise((resolve, reject) => {
		const probe = net.createServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const port = probe.address().port;
			probe.close(() => resolve(port));
		});
	});
}

function request(port, method, pathname, body) {
	return new Promise((resolve, reject) => {
		const payload = body == null ? null : JSON.stringify(body);
		const req = http.request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path: pathname,
				headers: payload
					? {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(payload),
						}
					: undefined,
				timeout: 3000,
			},
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (text += chunk));
				res.on("end", () => resolve({ status: res.statusCode, text }));
			},
		);
		req.on("timeout", () => req.destroy(new Error("request timeout")));
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

function parse(response) {
	return JSON.parse(response.text);
}

async function waitForHealth(port) {
	for (let i = 0; i < 100; i++) {
		try {
			if ((await request(port, "GET", "/api/health")).status === 200) return;
		} catch {}
		await sleep(40);
	}
	throw new Error("server did not become healthy");
}

async function waitForRun(port, id) {
	for (let i = 0; i < 120; i++) {
		const response = await request(
			port,
			"GET",
			`/api/secondary?id=${encodeURIComponent(id)}`,
		);
		if (response.status === 200) {
			const run = parse(response).run;
			if (["completed", "failed", "cancelled", "expired"].includes(run.status))
				return run;
		}
		await sleep(40);
	}
	throw new Error(`advisor run ${id} did not reach a terminal state`);
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `\'"'"'`)}'`;
}

function makeFakePi(dir) {
	const fake = path.join(dir, "fake-advisor-pi.js");
	fs.writeFileSync(
		fake,
		`"use strict";
const fs = require("node:fs");
const readline = require("node:readline");
const isolated = process.argv.includes("--no-session");
const logPath = process.env.FAKE_PI_LOG;
let promptMessage = "";
function log(value) {
  fs.appendFileSync(logPath, JSON.stringify({ isolated, argv: process.argv.slice(2), ...value }) + "\\n");
}
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
log({ type: "start" });
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let cmd;
  try { cmd = JSON.parse(line); } catch { return; }
  log({ type: cmd.type, message: cmd.message });
  if (cmd.type === "get_available_models") {
    send({ type: "response", id: cmd.id, success: true, data: { models: [] } });
  } else if (cmd.type === "set_model" || cmd.type === "set_thinking_level") {
    send({ type: "response", id: cmd.id, success: true, data: {} });
  } else if (cmd.type === "prompt") {
    promptMessage = String(cmd.message);
    send({ type: "response", id: cmd.id, success: true, data: {} });
    if (!promptMessage.includes("CANCEL_CASE")) send({ type: "agent_settled" });
  } else if (cmd.type === "get_messages") {
    if (promptMessage.includes("CREDENTIAL_CASE")) {
      send({ type: "response", id: cmd.id, success: true, data: { messages: [{ role: "assistant", errorMessage: "OAuth refresh failed: /secret/auth.json" }] } });
    } else if (promptMessage.includes("SUCCESS_CASE")) {
      send({ type: "response", id: cmd.id, success: true, data: { messages: [{ role: "assistant", content: JSON.stringify({ verdict: "revise", summary: "Review before applying.", risks: ["The change may hide a failure."], actions: ["Add a regression test."] }) }] } });
    } else {
      send({ type: "response", id: cmd.id, success: true, data: { messages: [{ role: "assistant", content: "unexpected" }] } });
    }
  } else if (cmd.type === "get_state") {
    send({ type: "response", id: cmd.id, success: true, data: { isStreaming: false, model: { provider: "fake", id: "fake" }, sessionFile: null } });
  } else if (cmd.type === "get_entries") {
    send({ type: "response", id: cmd.id, success: true, data: { entries: [], leafId: null } });
  } else if (cmd.type === "get_commands") {
    send({ type: "response", id: cmd.id, success: true, data: { commands: [] } });
  } else if (cmd.type === "get_session_stats") {
    send({ type: "response", id: cmd.id, success: true, data: {} });
  }
});
`,
		"utf8",
	);
	const wrapper = path.join(
		dir,
		process.platform === "win32" ? "fake-advisor-pi.cmd" : "fake-advisor-pi.sh",
	);
	if (process.platform === "win32") {
		fs.writeFileSync(
			wrapper,
			`@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`,
			"utf8",
		);
	} else {
		fs.writeFileSync(
			wrapper,
			`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fake)} "$@"\n`,
			"utf8",
		);
		fs.chmodSync(wrapper, 0o755);
	}
	return wrapper;
}

function stopChild(child) {
	if (!child || child.exitCode != null) return;
	if (process.platform === "win32") {
		try {
			execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
				stdio: "ignore",
			});
		} catch {}
	} else {
		try {
			child.kill("SIGKILL");
		} catch {}
	}
}

async function main() {
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-webui-advisor-"));
	fs.mkdirSync(path.join(temp, "agent"), { recursive: true });
	const logPath = path.join(temp, "fake.log");
	const port = await freePort();
	const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
		cwd: ROOT,
		env: {
			...process.env,
			HOME: temp,
			PORT: String(port),
			PI_CWD: ROOT,
			PI_CODING_AGENT_DIR: path.join(temp, "agent"),
			FAKE_PI_LOG: logPath,
			PI_WEBUI_NO_OPEN: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.resume();
	child.stderr.resume();
	try {
		await waitForHealth(port);

		const success = await request(port, "POST", "/api/secondary", {
			kind: "advisor",
			requestId: "advisor-success",
			sourceKind: "draft",
			source: { text: "SUCCESS_CASE review this draft" },
			model: { provider: "fake", modelId: "fake" },
		});
		assert.equal(success.status, 202);
		const successRun = await waitForRun(port, parse(success).run.id);
		assert.equal(successRun.kind, "advisor");
		assert.equal(successRun.status, "completed");
		assert.equal(successRun.result.verdict, "revise");
		assert.equal(successRun.result.summary, "Review before applying.");
		assert.deepEqual(successRun.result.model, {
			provider: "fake",
			modelId: "fake",
		});
		assert.equal(successRun.result.sourceKind, "draft");
		assert.equal(successRun.result.retryable, false);
		assert.equal(successRun.result.text, successRun.result.summary);
		console.log("ok - advisor returns a structured isolated review");

		const noModel = await request(port, "POST", "/api/secondary", {
			kind: "advisor",
			requestId: "advisor-no-model",
			sourceKind: "request-context",
			source: { text: "NO_MODEL_CASE" },
		});
		const noModelRun = await waitForRun(port, parse(noModel).run.id);
		assert.equal(noModelRun.status, "failed");
		assert.equal(noModelRun.result.verdict, "unavailable");
		assert.equal(noModelRun.result.retryable, true);
		assert.equal(noModelRun.result.error.code, "ADVISOR_NO_MODEL");
		console.log("ok - missing reviewer model remains retryable");

		const credential = await request(port, "POST", "/api/secondary", {
			kind: "advisor",
			requestId: "advisor-credential",
			sourceKind: "assistant-turn",
			source: { id: "turn-1", text: "CREDENTIAL_CASE" },
			model: { provider: "fake", modelId: "fake" },
		});
		const credentialRun = await waitForRun(port, parse(credential).run.id);
		assert.equal(credentialRun.status, "failed");
		assert.equal(credentialRun.result.error.code, "ADVISOR_CREDENTIAL");
		assert.equal(credentialRun.result.retryable, true);
		assert.equal(credentialRun.result.error.message.includes("auth.json"), false);
		console.log("ok - credential failures are bounded and retryable");

		const cancelling = await request(port, "POST", "/api/secondary", {
			kind: "advisor",
			requestId: "advisor-cancel",
			sourceKind: "draft",
			source: { text: "CANCEL_CASE" },
			model: { provider: "fake", modelId: "fake" },
		});
		const cancelId = parse(cancelling).run.id;
		const cancelled = await request(port, "POST", "/api/secondary/cancel", {
			id: cancelId,
		});
		assert.equal(cancelled.status, 200);
		const cancelledRun = await waitForRun(port, cancelId);
		assert.equal(cancelledRun.status, "cancelled");
		assert.equal(cancelledRun.result.verdict, "unavailable");
		assert.equal(cancelledRun.result.error.code, "ADVISOR_CANCELLED");
		assert.equal(cancelledRun.result.retryable, true);
		console.log("ok - cancellation preserves an explicit retryable result");

		assert.equal(
			(
				await request(port, "POST", "/api/secondary", {
					kind: "advisor",
					requestId: "advisor-invalid",
					sourceKind: "draft",
					source: { text: "   " },
				})
			).status,
			400,
		);
		console.log("ok - advisor execution cannot mutate or send the primary session");
	} finally {
		stopChild(child);
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
