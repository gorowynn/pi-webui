/* secondary-run HTTP/SSE lifecycle smoke test with a disposable fake pi */

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
	for (let i = 0; i < 80; i++) {
		try {
			if ((await request(port, "GET", "/api/health")).status === 200) return;
		} catch {}
		await sleep(40);
	}
	throw new Error("server did not become healthy");
}

async function waitForRun(port, id, status) {
	for (let i = 0; i < 100; i++) {
		const response = await request(
			port,
			"GET",
			`/api/secondary?id=${encodeURIComponent(id)}`,
		);
		if (response.status === 200) {
			const run = parse(response).run;
			if (
				!status ||
				run.status === status ||
				["completed", "failed", "cancelled", "expired"].includes(run.status)
			)
				return run;
		}
		await sleep(40);
	}
	throw new Error(`secondary run ${id} did not reach ${status || "terminal"}`);
}

function waitForSse(port, predicate) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			req.destroy();
			reject(new Error("SSE event timeout"));
		}, 8000);
		let req;
		let response;
		try {
			req = http.get(
				{ hostname: "127.0.0.1", port, path: "/api/events" },
				(res) => {
					response = res;
					let buffer = "";
					res.setEncoding("utf8");
					res.on("data", (chunk) => {
						buffer += chunk;
						let split;
						while ((split = buffer.indexOf("\n\n")) >= 0) {
							const frame = buffer.slice(0, split);
							buffer = buffer.slice(split + 2);
							const line = frame.split("\n").find((item) => item.startsWith("data: "));
							if (!line) continue;
							try {
								const value = JSON.parse(line.slice(6));
								if (!predicate(value)) continue;
								clearTimeout(timer);
								response.destroy();
								resolve(value);
								return;
							} catch {}
						}
					});
				},
			);
		} catch (error) {
			clearTimeout(timer);
			reject(error);
			return;
		}
		req.on("error", (error) => {
			if (error.code !== "ECONNRESET") {
				clearTimeout(timer);
				reject(error);
			}
		});
	});
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function makeFakePi(dir) {
	const fake = path.join(dir, "fake-pi.js");
	fs.writeFileSync(
		fake,
		`"use strict";
const readline = require("node:readline");
const isolated = process.argv.includes("--no-session");
const rl = readline.createInterface({ input: process.stdin });
function send(value) { process.stdout.write(JSON.stringify(value) + "\\n"); }
rl.on("line", (line) => {
  let cmd;
  try { cmd = JSON.parse(line); } catch { return; }
  if (cmd.type === "get_available_models") {
    send({ type: "response", id: cmd.id, success: true, data: { models: [{ id: "fake", provider: "fake", reasoning: false, cost: { input: 0, output: 0 } }] } });
  } else if (cmd.type === "set_model") {
    send({ type: "response", id: cmd.id, success: true, data: {} });
  } else if (cmd.type === "set_thinking_level") {
    send({ type: "response", id: cmd.id, success: true, data: {} });
  } else if (cmd.type === "prompt") {
    send({ type: "response", id: cmd.id, success: true, data: {} });
    if (!isolated || !String(cmd.message).includes("slow")) send({ type: "agent_settled" });
  } else if (cmd.type === "get_messages") {
    send({ type: "response", id: cmd.id, success: true, data: { messages: [{ role: "assistant", content: "fake side answer" }] } });
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
		process.platform === "win32" ? "fake-pi.cmd" : "fake-pi.sh",
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
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-webui-secondary-"));
	fs.mkdirSync(path.join(temp, "agent"), { recursive: true });
	const wrapper = makeFakePi(temp);
	const port = await freePort();
	const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
		cwd: ROOT,
		env: {
			...process.env,
			PORT: String(port),
			PI_BIN: wrapper,
			PI_ARGS: "",
			PI_CWD: ROOT,
			PI_CODING_AGENT_DIR: path.join(temp, "agent"),
			PI_WEBUI_NO_OPEN: "1",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.resume();
	child.stderr.resume();
	try {
		await waitForHealth(port);

		const events = waitForSse(
			port,
			(value) =>
				value.source === "server" &&
				value.type === "secondary_run" &&
				value.run &&
				["completed", "failed", "cancelled", "expired"].includes(value.run.status),
		);
		const start = await request(port, "POST", "/api/secondary", {
			question: "What is this?",
			context: "assistant: a bounded context",
			model: { provider: "fake", modelId: "fake" },
			thinkingLevel: "high",
		});
		assert.equal(start.status, 202);
		const started = parse(start);
		assert.equal(started.ok, true);
		assert.equal(["queued", "running"].includes(started.run.status), true);
		assert.equal("prompt" in started.run, false);
		const event = await events;
		assert.equal(event.run.status, "completed");
		const completed = await waitForRun(port, started.run.id, "completed");
		assert.equal(completed.result.text, "fake side answer");
		assert.equal(completed.kind, "side-question");
		console.log("ok - secondary run completes outside the primary transcript");
		console.log("ok - terminal completion is broadcast over SSE");

		const truncated = await request(port, "POST", "/api/secondary", {
			question: "bounded",
			context: "x".repeat(70_000),
		});
		assert.equal(truncated.status, 202);
		const truncatedRun = await waitForRun(
			port,
			parse(truncated).run.id,
			"completed",
		);
		assert.equal(truncatedRun.inputTruncated, true);
		console.log("ok - oversized context is bounded and labelled");

		const slow = await request(port, "POST", "/api/secondary", {
			question: "slow question",
		});
		const slowId = parse(slow).run.id;
		const cancelled = await request(port, "POST", "/api/secondary/cancel", {
			id: slowId,
		});
		assert.equal(cancelled.status, 200);
		assert.equal(parse(cancelled).run.status, "cancelled");
		assert.equal((await waitForRun(port, slowId)).status, "cancelled");
		console.log(
			"ok - cancelling a secondary run does not affect the primary child",
		);

		const toClear = await request(port, "POST", "/api/secondary", {
			question: "slow question to clear",
		});
		const toClearId = parse(toClear).run.id;
		const cleared = await request(port, "POST", "/api/secondary/clear");
		assert.equal(cleared.status, 200);
		assert.equal(
			(
				await request(
					port,
					"GET",
					`/api/secondary?id=${encodeURIComponent(toClearId)}`,
				)
			).status,
			404,
		);
		console.log("ok - clearing Btw cancels and removes secondary runs");

		assert.equal(
			(await request(port, "POST", "/api/secondary", { question: "" })).status,
			400,
		);
		assert.equal(
			(
				await request(port, "POST", "/api/secondary", {
					kind: "advisor",
					question: "x",
				})
			).status,
			400,
		);
		assert.equal(
			(
				await request(port, "POST", "/api/secondary", {
					question: "x",
					model: { provider: "fake;bad", modelId: "fake" },
				})
			).status,
			400,
		);
		assert.equal(
			(
				await request(port, "POST", "/api/secondary", {
					question: "x",
					thinkingLevel: "turbo",
				})
			).status,
			400,
		);
		assert.equal(
			(await request(port, "POST", "/api/secondary/cancel", { id: "missing" }))
				.status,
			404,
		);
		console.log("ok - malformed and stale secondary requests are rejected");
	} finally {
		stopChild(child);
		fs.rmSync(temp, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
