// Smoke test for the awaitable-RPC additionality invariant (plan F§5.1):
// the JSONL reader must STILL broadcast every payload to SSE — including the
// responses to the awaitable RPCs — so the fire-and-forget path + smuggle
// channels keep working unchanged. Run against a booted server:
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

// open SSE, collect `response` payloads until predicate or 12s
function sseCollect(predicate) {
	return new Promise((resolve, reject) => {
		const seen = [];
		const req = http.get(
			{ host: "127.0.0.1", port: PORT, path: "/api/events" },
			(res) => {
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
						resolve(seen);
					}
				});
			},
		);
		req.on("error", reject);
		req.setTimeout(15000, () => {
			res && res.destroy();
			resolve(seen); // resolve with whatever we got (don't fail on timeout)
		});
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

	// 2. /api/snapshot's responses (snap-*) must ALSO be broadcast on SSE —
	//    proving the awaitable path is additive (didn't swallow them).
	const snapP = sseCollect((arr) => arr.some((p) => p.id === "snap-state"));
	await get("/api/snapshot");
	const snapSse = await snapP;
	const snapIds = new Set(
		snapSse.filter((p) => p.type === "response").map((p) => p.id),
	);
	if (snapIds.has("snap-state"))
		ok(
			"awaitable /api/snapshot responses are also broadcast on SSE (additive)",
		);
	else
		throw new Error(
			"FAIL: snapshot responses not broadcast (additivity broken)",
		);

	// 3. /api/rpc returns the payload directly AND it was broadcast (both).
	const rpc = await post("/api/rpc", { type: "get_state", id: "rpc-direct" });
	const rpcObj = JSON.parse(rpc.body);
	if (
		rpcObj.ok &&
		rpcObj.id === "rpc-direct" &&
		rpcObj.data &&
		rpcObj.data.model
	)
		ok("/api/rpc resolves with the {data} payload directly");
	else
		throw new Error(
			"FAIL: /api/rpc payload malformed: " + rpc.body.slice(0, 200),
		);

	// 4. a direct /api/rpc call's response is ALSO broadcast on SSE (additivity
	//    holds for the awaitable path, not just snapshot). The strict per-call
	//    ordering invariant (tool_execution_start smuggle before its sibling
	//    response) is a STRUCTURAL guarantee — resolveRpc runs on the line after
	//    broadcast in the same reader callback, so it can't reorder events — not
	//    something network timing can prove.
	const ordSse = sseCollect((arr) => arr.some((p) => p.id === "ord-1"));
	await post("/api/rpc", { type: "get_state", id: "ord-1" });
	const ordSseSeen = await ordSse;
	if (ordSseSeen.some((p) => p.id === "ord-1"))
		ok("direct /api/rpc response is also broadcast on SSE (additive)");
	else throw new Error("FAIL: direct /api/rpc response not broadcast");

	console.log(`\n${pass} passed`);
	process.exit(0);
})().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
