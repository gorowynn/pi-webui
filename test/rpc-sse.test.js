// Smoke test for the SDK command/SSE contract. Run against a booted server:
//   PORT=4401 node server.js &  node test/rpc-sse.test.js
const http = require("http");
const PORT = parseInt(process.env.PORT || "4401", 10);

function get(path) {
	return new Promise((resolve, reject) => {
		const req = http.get({ host: "127.0.0.1", port: PORT, path }, (res) => {
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => resolve({ status: res.statusCode, body }));
		});
		req.on("error", reject);
		req.setTimeout(15000, () => req.destroy(new Error("timeout")));
	});
}
function post(path, obj) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(obj);
		const req = http.request(
			{
				host: "127.0.0.1",
				port: PORT,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(data),
				},
			},
			(res) => {
				let body = "";
				res.on("data", (c) => (body += c));
				res.on("end", () => resolve({ status: res.statusCode, body }));
			},
		);
		req.on("error", reject);
		req.setTimeout(15000, () => req.destroy(new Error("timeout")));
		req.write(data);
		req.end();
	});
}

// open SSE, collect response payloads until predicate or 12s wall clock
function sseCollect(predicate) {
	return new Promise((resolve, reject) => {
		const seen = [];
		let res = null;
		let wall = null;
		let settled = false;
		const settle = (v) => {
			if (settled) return;
			settled = true;
			clearTimeout(wall);
			resolve(v);
		};
		const req = http.get(
			{ host: "127.0.0.1", port: PORT, path: "/api/events" },
			(r) => {
				res = r;
				let buf = "";
				res.on("data", (c) => {
					buf += c.toString();
					let i;
					while ((i = buf.indexOf("\n\n")) !== -1) {
						const frame = buf.slice(0, i);
						buf = buf.slice(i + 2);
						const line = frame.split("\n").find((l) => l.startsWith("data: "));
						if (!line) continue;
						try {
							const env = JSON.parse(line.slice(6));
							if (env.source === "pi" && env.payload) seen.push(env.payload);
						} catch {}
					}
					if (predicate(seen)) {
						res.destroy();
						settle(seen);
					}
				});
			},
		);
		req.on("error", (e) => {
			settled = true;
			reject(e);
		});
		// TEST-01: cap on WALL time, not an idle timeout — the server's SSE
		// heartbeat keeps the socket busy, so req.setTimeout never fires when
		// the predicate never matches and the test hangs forever.
		wall = setTimeout(() => {
			if (res) res.destroy();
			settle(seen); // resolve with whatever we got (don't fail on timeout)
		}, 12000);
	});
}

(async () => {
	let pass = 0;
	const ok = (m) => (pass++, console.log("  ok -", m));

	// Integration-only smoke test: requires a booted server on PORT. Fail fast
	// with guidance instead of a bare ECONNREFUSED when nothing is listening.
	try {
		await new Promise((resolve, reject) => {
			const req = http.get(
				{ host: "127.0.0.1", port: PORT, path: "/api/health" },
				(res) => {
					res.resume();
					res.on("end", resolve);
				},
			);
			req.on("error", reject);
			req.setTimeout(5000, () => req.destroy(new Error("timeout")));
		});
	} catch {
		console.error(
			`  ! no server on 127.0.0.1:${PORT} — boot one first, e.g.:\n      PORT=${PORT} node server.js &  node test/rpc-sse.test.js`,
		);
		process.exit(1);
	}

	// 1. fire-and-forget /api/cmd get_state — its response must arrive on SSE.
	const sseP = sseCollect((arr) =>
		arr.some((p) => p.id === "ff-state" && p.type === "response"),
	);
	await post("/api/cmd", { type: "get_state", id: "ff-state" });
	const sse = await sseP;
	if (sse.some((p) => p.id === "ff-state"))
		ok("fire-and-forget /api/cmd response still streams on SSE");
	else throw new Error("FAIL: fire-and-forget response NOT on SSE");

	// 2. /api/snapshot is assembled directly from the SDK runtime and does not
	//    need transport-shaped response fan-out.
	const snapRes = await get("/api/snapshot");
	const snapBody = JSON.parse(snapRes.body);
	if (!snapBody.ok || !Array.isArray(snapBody.messages))
		throw new Error(
			"FAIL: /api/snapshot body malformed: " + snapRes.body.slice(0, 200),
		);
	ok("/api/snapshot returns the SDK-backed state bundle");

	console.log(`\n${pass} passed`);
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
