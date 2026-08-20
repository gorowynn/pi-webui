

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const {
	CdpProtocolError,
	FrameDecoder,
	OPCODE_CLOSE,
	OPCODE_CONTINUATION,
	OPCODE_PING,
	OPCODE_TEXT,
	connectCdpTarget,
	decodeClosePayload,
	discoverTarget,
	encodeFrame,
} = require("../extensions/pi_minimal_webui/browser-cdp.js");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

async function waitFor(predicate, timeoutMs = 1000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("test condition timed out");
}

async function createFakeCdp() {
	const sockets = new Set();
	const state = {
		commands: [],
		paths: [],
		pongs: [],
		socket: null,
		onCommand: null,
	};
	const server = http.createServer((request, response) => {
		state.paths.push(request.url);
		response.setHeader("content-type", "application/json");
		if (request.url === "/json/version") {
			response.end(JSON.stringify({ Browser: "fake", webSocketDebuggerUrl: state.wsUrl }));
			return;
		}
		if (request.url === "/json/list") {
			response.end(JSON.stringify([
				{ id: "worker", type: "service_worker", webSocketDebuggerUrl: state.wsUrl },
				{ id: "page-1", type: "page", title: "Fake", url: "http://127.0.0.1:4317", webSocketDebuggerUrl: state.wsUrl },
			]));
			return;
		}
		response.statusCode = 404;
		response.end(JSON.stringify({ error: "not found" }));
	});
	server.on("upgrade", (request, socket, head) => {
		const key = request.headers["sec-websocket-key"];
		const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
		socket.write([
			"HTTP/1.1 101 Switching Protocols",
			"Upgrade: websocket",
			"Connection: Upgrade",
			`Sec-WebSocket-Accept: ${accept}`,
			"",
			"",
		].join("\r\n"));
		state.socket = socket;
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		const decoder = new FrameDecoder({ allowMasked: true });
		const consume = (chunk) => {
			try {
				for (const event of decoder.push(chunk)) {
					if (event.type === "pong") state.pongs.push(event.payload.toString("utf8"));
					if (event.type !== "message") continue;
					const command = JSON.parse(event.text);
					state.commands.push(command);
					Promise.resolve(state.onCommand?.(command)).catch(() => undefined);
				}
			} catch {
				socket.destroy();
			}
		};
		socket.on("data", consume);
		if (head.length) consume(head);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	state.endpoint = `http://127.0.0.1:${port}`;
	state.wsUrl = `ws://127.0.0.1:${port}/devtools/page/1`;
	state.send = (message) => state.socket.write(encodeFrame(JSON.stringify(message), { mask: false }));
	state.respond = (id, result) => state.send({ id, result });
	state.event = (method, params) => state.send({ method, params });
	state.ping = (payload) => state.socket.write(encodeFrame(payload, { opcode: OPCODE_PING, mask: false }));
	state.close = async () => {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(() => resolve()));
	};
	return state;
}

let passed = 0;
function ok(name) {
	passed++;
	console.log("  ok -", name);
}
function throwsProtocol(fn, name) {
	assert.throws(fn, (error) => error instanceof CdpProtocolError && error.code === "cdp-protocol", name);
	ok(name);
}

// Small, ordinary payloads use the 7-bit length and client masking.
{
	const key = Buffer.from([1, 2, 3, 4]);
	const frame = encodeFrame("hello", { maskingKey: key });
	assert.equal(frame[0], 0x81, "final text frame");
	assert.equal(frame[1] & 0x7f, 5, "7-bit payload length");
	assert.equal(frame[1] & 0x80, 0x80, "client frame is masked");
	const original = Buffer.from(frame);
	const events = new FrameDecoder({ allowMasked: true }).push(frame);
	assert.deepEqual(events[0].payload, Buffer.from("hello"));
	assert.deepEqual(frame, original, "decoding does not mutate the source frame");
	ok("7-bit length, masking, and source preservation");
}

// Extended lengths are encoded without a dependency on a WebSocket package.
{
	const short = encodeFrame(Buffer.alloc(126), { mask: false });
	assert.equal(short[1], 126);
	assert.equal(short.readUInt16BE(2), 126);
	const medium = encodeFrame(Buffer.alloc(0xffff), { mask: false });
	assert.equal(medium[1], 126);
	assert.equal(medium.readUInt16BE(2), 0xffff);
	const long = encodeFrame(Buffer.alloc(0x10000), { mask: false });
	assert.equal(long[1], 127);
	assert.equal(long.readBigUInt64BE(2), 0x10000n);
	ok("16-bit and 64-bit payload lengths");
}

// Fragments may be split at arbitrary byte seams and control frames may
// interleave without becoming part of the application message.
{
	const first = encodeFrame("hel", { fin: false, mask: false });
	const ping = encodeFrame("?", { opcode: OPCODE_PING, mask: false });
	const last = encodeFrame("lo", { opcode: OPCODE_CONTINUATION, mask: false });
	const bytes = Buffer.concat([first, ping, last]);
	const decoder = new FrameDecoder();
	assert.deepEqual(decoder.push(bytes.subarray(0, 4)), []);
	const events = decoder.push(bytes.subarray(4));
	assert.equal(events[0].type, "ping");
	assert.equal(events[1].type, "message");
	assert.equal(events[1].text, "hello");
	assert.equal(events[1].opcode, OPCODE_TEXT);
	ok("fragmentation, continuation, ping, and partial input");
}

{
	const decoder = new FrameDecoder();
	decoder.push(encodeFrame("partial", { fin: false, mask: false }));
	throwsProtocol(() => decoder.finish(), "unfinished fragmented message is rejected");
}

{
	const truncatedLength = Buffer.from([0x81, 126, 0]);
	const decoder = new FrameDecoder();
	assert.deepEqual(decoder.push(truncatedLength), []);
	throwsProtocol(() => decoder.finish(), "truncated extended length is rejected at stream end");
}

// Protocol invariants are checked before a frame reaches the CDP layer.
throwsProtocol(() => new FrameDecoder().push(Buffer.from([0xc1, 0])), "reserved bits are rejected");
throwsProtocol(() => new FrameDecoder().push(Buffer.from([0x83, 0])), "unknown opcode is rejected");
throwsProtocol(() => new FrameDecoder().push(Buffer.from([0x09, 0])), "fragmented control frame is rejected");
throwsProtocol(() => new FrameDecoder().push(Buffer.from([0x81, 127, 0x80, 0, 0, 0, 0, 0, 0, 0])), "64-bit high bit is rejected");

{
	const decoder = new FrameDecoder({ maxPayload: 4 });
	throwsProtocol(() => decoder.push(encodeFrame("12345", { mask: false })), "payload cap is enforced");
	throwsProtocol(
		() => new FrameDecoder({ maxPayload: 4 }).push(Buffer.concat([
			encodeFrame("12", { fin: false, mask: false }),
			encodeFrame("345", { opcode: OPCODE_CONTINUATION, mask: false }),
		])),
		"fragmented message cap is enforced",
	);
}

{
	const close = encodeFrame(Buffer.concat([Buffer.from([0x03, 0xe8]), Buffer.from("bye")]), {
		opcode: OPCODE_CLOSE,
		mask: false,
	});
	const event = new FrameDecoder().push(close)[0];
	assert.equal(event.type, "close");
	assert.equal(event.code, 1000);
	assert.equal(event.reason, "bye");
	assert.deepEqual(decodeClosePayload(Buffer.alloc(0)), { code: null, reason: "" });
	throwsProtocol(() => decodeClosePayload(Buffer.from([0x03])), "one-byte close payload is rejected");
	throwsProtocol(() => decodeClosePayload(Buffer.from([0x03, 0xec])), "reserved close code is rejected");
	ok("close code and reason validation");
}

(async () => {
	const fake = await createFakeCdp();
	try {
		const target = await discoverTarget(fake.endpoint);
		assert.equal(target.id, "page-1");
		assert.deepEqual(fake.paths, ["/json/version", "/json/list"]);
		const session = await connectCdpTarget(target, { commandTimeoutMs: 250 });
		const observed = [];
		const unsubscribe = session.on("Runtime.consoleAPICalled", (params) => observed.push(params));
		const first = session.command("First", { value: 1 });
		const second = session.command("Second", { value: 2 });
		await waitFor(() => fake.commands.length === 2);
		assert.deepEqual(fake.commands.map((command) => command.method), ["First", "Second"]);
		fake.event("Runtime.consoleAPICalled", { type: "warning" });
		fake.ping("heartbeat");
		await waitFor(() => observed.length === 1 && fake.pongs.includes("heartbeat"));
		fake.respond(fake.commands[1].id, { order: 2 });
		fake.respond(fake.commands[0].id, { order: 1 });
		assert.deepEqual(await first, { order: 1 });
		assert.deepEqual(await second, { order: 2 });
		assert.deepEqual(observed, [{ type: "warning" }]);
		unsubscribe();
		unsubscribe();
		await Promise.all([session.close(), session.close()]);
		ok("discovery, request correlation, events, ping/pong, and idempotent close");

		const timeoutSession = await connectCdpTarget(target, { commandTimeoutMs: 25 });
		await assert.rejects(timeoutSession.command("Never"), (error) => error.code === "timeout");
		const controller = new AbortController();
		const aborted = timeoutSession.command("AbortMe", {}, controller.signal, { timeoutMs: 500 });
		await waitFor(() => fake.commands.some((command) => command.method === "AbortMe"));
		controller.abort();
		await assert.rejects(aborted, (error) => error.code === "aborted");
		await timeoutSession.close();
		ok("command timeout and abort do not leave a pending caller");

		const malformedSession = await connectCdpTarget(target, { commandTimeoutMs: 250 });
		const malformed = malformedSession.command("Malformed");
		await waitFor(() => fake.commands.some((command) => command.method === "Malformed"));
		fake.socket.write(encodeFrame("not-json", { mask: false }));
		await assert.rejects(malformed, (error) => error.code === "cdp-protocol");
		await malformedSession.close();
		ok("malformed CDP messages fail the session with a stable protocol error");
	} finally {
		await fake.close();
	}
	console.log(`\n${passed} passed`);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
