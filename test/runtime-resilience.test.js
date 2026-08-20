const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { execFileSync, spawn } = require("node:child_process");
const { PiUnavailableError, respondForwardError } = require("../server.js");

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
				timeout: 1500,
			},
			(res) => {
				const chunks = [];
				res.setEncoding("utf8");
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () =>
					resolve({
						status: res.statusCode,
						headers: res.headers,
						text: chunks.join(""),
					}),
				);
			},
		);
		req.on("timeout", () => req.destroy(new Error("request timeout")));
		req.on("error", reject);
		if (payload) req.write(payload);
		req.end();
	});
}

async function waitForHealth(port) {
	for (let i = 0; i < 50; i++) {
		try {
			const response = await request(port, "GET", "/api/health");
			if (response.status === 200) return;
		} catch {}
		await sleep(40);
	}
	throw new Error("server did not become healthy");
}

async function waitForUnavailable(port, method, pathname, body) {
	let last;
	for (let i = 0; i < 100; i++) {
		try {
			last = await request(port, method, pathname, body);
			if (last.status === 503) return last;
		} catch (error) {
			last = error;
		}
		await sleep(40);
	}
	assert.equal(
		last && last.status,
		503,
		`did not receive 503 for ${method} ${pathname}: ${JSON.stringify(last)}`,
	);
	return last;
}

function parseJson(response) {
	return JSON.parse(response.text);
}

function fakeResponse() {
	return {
		writableEnded: false,
		status: null,
		headers: null,
		text: "",
		writeHead(status, headers) {
			this.status = status;
			this.headers = headers;
		},
		end(text) {
			this.text = text || "";
			this.writableEnded = true;
		},
	};
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

function test(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`ok - ${name}`));
}

async function main() {
	await test("returns bounded 503 errors while pi is unavailable", async () => {
		const port = await freePort();
		const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
			cwd: ROOT,
			env: {
				...process.env,
				PORT: String(port),
				PI_BIN: `pi-webui-missing-${process.pid}`,
				PI_ARGS: "",
				PI_CWD: ROOT,
				PI_WEBUI_NO_OPEN: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.resume();
		child.stderr.resume();
		try {
			await waitForHealth(port);
			const cases = [
				["POST", "/api/cmd", { type: "prompt", message: "resilience" }],
				["POST", "/api/rpc", { type: "get_state", id: "resilience" }],
				["DELETE", "/api/permissions/grants"],
				["DELETE", "/api/permissions/grants/1"],
			];
			for (const [method, pathname, body] of cases) {
				const response = await waitForUnavailable(port, method, pathname, body);
				assert.match(response.headers["content-type"], /application\/json/);
				assert.equal(response.text.length < 256, true);
				assert.deepEqual(parseJson(response), {
					ok: false,
					error: "pi not running",
				});
				assert.equal((await request(port, "GET", "/api/health")).status, 200);
			}
		} finally {
			stopChild(child);
		}
	});

	await test("keeps existing body-validation posture", async () => {
		const port = await freePort();
		const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
			cwd: ROOT,
			env: {
				...process.env,
				PORT: String(port),
				PI_BIN: `pi-webui-missing-${process.pid}-body`,
				PI_ARGS: "",
				PI_CWD: ROOT,
				PI_WEBUI_NO_OPEN: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.resume();
		child.stderr.resume();
		try {
			await waitForHealth(port);
			const response = await new Promise((resolve, reject) => {
				const req = http.request(
					{
						hostname: "127.0.0.1",
						port,
						method: "POST",
						path: "/api/rpc",
						headers: { "Content-Type": "application/json" },
					},
					(res) => {
						let text = "";
						res.setEncoding("utf8");
						res.on("data", (chunk) => (text += chunk));
						res.on("end", () => resolve({ status: res.statusCode, text }));
					},
				);
				req.on("error", reject);
				req.end("not json");
			});
			assert.equal(response.status, 200);
			assert.equal(parseJson(response).ok, false);
		} finally {
			stopChild(child);
		}
	});

	await test("bounds unexpected forwarding failures without exposing a stack", () => {
		const unexpected = fakeResponse();
		respondForwardError(unexpected, new Error("injected failure"));
		assert.equal(unexpected.status, 500);
		assert.equal(JSON.parse(unexpected.text).error, "injected failure");
		assert.equal(unexpected.text.length < 256, true);
		assert.equal(unexpected.text.includes("Error:"), false);
		const unavailable = fakeResponse();
		respondForwardError(unavailable, new PiUnavailableError());
		assert.equal(unavailable.status, 503);
		assert.deepEqual(JSON.parse(unavailable.text), {
			ok: false,
			error: "pi not running",
		});
	});

	await test("keeps the forwarding boundary and commit ordering explicit", () => {
		const source = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
		assert.match(source, /class PiUnavailableError/);
		assert.match(source, /res\.writeHead\(unavailable \? 503 : 500/);
		assert.doesNotMatch(
			source,
			/respondForwardError\([\s\S]{0,500}error\.stack/,
		);
		const clearStart = source.indexOf(
			'url.pathname === "/api/permissions/grants"',
		);
		const clearEnd = source.indexOf("const grantRevoke", clearStart);
		const clearRoute = source.slice(clearStart, clearEnd);
		assert.ok(
			clearRoute.indexOf("sendToPi") <
				clearRoute.indexOf("grantsMirror.length = 0"),
		);
		const revokeStart = source.indexOf("const grantRevoke");
		const revokeEnd = source.indexOf(
			'url.pathname === "/api/permissions/explain"',
			revokeStart,
		);
		const revokeRoute = source.slice(revokeStart, revokeEnd);
		assert.ok(
			revokeRoute.indexOf("sendToPi") <
				revokeRoute.indexOf("grantsMirror.splice"),
		);
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
