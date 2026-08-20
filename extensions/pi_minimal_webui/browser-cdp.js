

const crypto = require("node:crypto");

const DEFAULT_MAX_PAYLOAD = 2 * 1024 * 1024;
const CONTROL_MAX_PAYLOAD = 125;
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

class CdpProtocolError extends Error {
	constructor(message) {
		super(message);
		this.name = "CdpProtocolError";
		this.code = "cdp-protocol";
	}
}

function asBuffer(payload) {
	if (Buffer.isBuffer(payload)) return payload;
	if (payload instanceof Uint8Array) return Buffer.from(payload);
	if (typeof payload === "string") return Buffer.from(payload, "utf8");
	throw new TypeError("WebSocket payload must be a string or byte buffer");
}

function validateOpcode(opcode) {
	if (![OPCODE_CONTINUATION, OPCODE_TEXT, OPCODE_BINARY, OPCODE_CLOSE, OPCODE_PING, OPCODE_PONG].includes(opcode)) {
		throw new CdpProtocolError(`unsupported WebSocket opcode: ${opcode}`);
	}
}

function isControl(opcode) {
	return (opcode & 0x8) !== 0;
}

function encodeFrame(payload, options = {}) {
	const data = asBuffer(payload);
	const opcode = options.opcode == null ? OPCODE_TEXT : options.opcode;
	const fin = options.fin !== false;
	const mask = options.mask !== false;
	validateOpcode(opcode);
	if (isControl(opcode) && (!fin || data.length > CONTROL_MAX_PAYLOAD)) {
		throw new CdpProtocolError("WebSocket control frames must be final and <= 125 bytes");
	}

	let lengthBytes;
	let lengthCode;
	if (data.length < 126) {
		lengthCode = data.length;
		lengthBytes = Buffer.alloc(0);
	} else if (data.length <= 0xffff) {
		lengthCode = 126;
		lengthBytes = Buffer.alloc(2);
		lengthBytes.writeUInt16BE(data.length, 0);
	} else {
		lengthCode = 127;
		lengthBytes = Buffer.alloc(8);
		lengthBytes.writeBigUInt64BE(BigInt(data.length), 0);
	}

	const header = Buffer.alloc(2 + lengthBytes.length + (mask ? 4 : 0));
	header[0] = (fin ? 0x80 : 0) | opcode;
	header[1] = (mask ? 0x80 : 0) | lengthCode;
	lengthBytes.copy(header, 2);

	if (!mask) return Buffer.concat([header, data]);
	const key = options.maskingKey == null
		? crypto.randomBytes(4)
		: asBuffer(options.maskingKey);
	if (key.length !== 4) throw new CdpProtocolError("WebSocket masking key must be 4 bytes");
	key.copy(header, 2 + lengthBytes.length);
	const masked = Buffer.allocUnsafe(data.length);
	for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ key[i % 4];
	return Buffer.concat([header, masked]);
}

function decodeClosePayload(payload) {
	if (payload.length === 0) return { code: null, reason: "" };
	if (payload.length === 1) throw new CdpProtocolError("WebSocket close payload has one byte");
	const code = payload.readUInt16BE(0);
	const validCode =
		code === 1000 ||
		(code >= 1001 && code <= 1003) ||
		(code >= 1007 && code <= 1014) ||
		(code >= 3000 && code <= 4999);
	if (!validCode) throw new CdpProtocolError(`invalid WebSocket close code: ${code}`);
	let reason = "";
	try {
		reason = new (require("node:util").TextDecoder)("utf-8", { fatal: true }).decode(payload.subarray(2));
	} catch {
		throw new CdpProtocolError("WebSocket close reason is not valid UTF-8");
	}
	return { code, reason };
}

class FrameDecoder {
	constructor(options = {}) {
		this.maxPayload = options.maxPayload ?? DEFAULT_MAX_PAYLOAD;
		this.allowMasked = options.allowMasked === true;
		this.buffer = Buffer.alloc(0);
		this.fragmentOpcode = null;
		this.fragments = [];
		this.fragmentBytes = 0;
	}

	push(chunk) {
		const input = asBuffer(chunk);
		if (input.length) this.buffer = Buffer.concat([this.buffer, input]);
		const events = [];
		while (true) {
			const frame = this.#readFrame();
			if (!frame) break;
			this.#accept(frame, events);
		}
		return events;
	}

	#readFrame() {
		if (this.buffer.length < 2) return null;
		const first = this.buffer[0];
		const second = this.buffer[1];
		if ((first & 0x70) !== 0) throw new CdpProtocolError("WebSocket reserved bits are set");
		const fin = (first & 0x80) !== 0;
		const opcode = first & 0x0f;
		validateOpcode(opcode);
		const masked = (second & 0x80) !== 0;
		if (masked && !this.allowMasked) throw new CdpProtocolError("masked server frame");
		const shortLength = second & 0x7f;
		let headerLength = 2;
		let payloadLength;
		if (shortLength < 126) {
			payloadLength = shortLength;
		} else if (shortLength === 126) {
			headerLength += 2;
			if (this.buffer.length < headerLength) return null;
			payloadLength = this.buffer.readUInt16BE(2);
		} else {
			headerLength += 8;
			if (this.buffer.length < headerLength) return null;
			const length = this.buffer.readBigUInt64BE(2);
			if ((length & 0x8000000000000000n) !== 0n || length > BigInt(this.maxPayload)) {
				throw new CdpProtocolError("WebSocket payload length exceeds the configured cap");
			}
			payloadLength = Number(length);
		}
		if (isControl(opcode) && (!fin || payloadLength > CONTROL_MAX_PAYLOAD)) {
			throw new CdpProtocolError("invalid WebSocket control frame");
		}
		if (payloadLength > this.maxPayload) throw new CdpProtocolError("WebSocket payload exceeds the configured cap");
		const maskLength = masked ? 4 : 0;
		const total = headerLength + maskLength + payloadLength;
		if (this.buffer.length < total) return null;

		const maskOffset = headerLength;
		const payloadOffset = headerLength + maskLength;
		const source = this.buffer.subarray(payloadOffset, total);
		let payload;
		if (!masked) {
			payload = Buffer.from(source);
		} else {
			const key = this.buffer.subarray(maskOffset, payloadOffset);
			payload = Buffer.allocUnsafe(payloadLength);
			for (let i = 0; i < payloadLength; i++) payload[i] = source[i] ^ key[i % 4];
		}
		this.buffer = this.buffer.subarray(total);
		return { fin, opcode, payload };
	}

	finish() {
		if (this.buffer.length) throw new CdpProtocolError("truncated WebSocket frame");
		if (this.fragmentOpcode != null) throw new CdpProtocolError("truncated fragmented WebSocket message");
	}

	#accept(frame, events) {
		const { fin, opcode, payload } = frame;
		if (opcode === OPCODE_PING) return events.push({ type: "ping", payload });
		if (opcode === OPCODE_PONG) return events.push({ type: "pong", payload });
		if (opcode === OPCODE_CLOSE) {
			const close = decodeClosePayload(payload);
			return events.push({ type: "close", payload, ...close });
		}
		if (opcode === OPCODE_CONTINUATION) {
			if (this.fragmentOpcode == null) throw new CdpProtocolError("unexpected WebSocket continuation frame");
		} else {
			if (this.fragmentOpcode != null) throw new CdpProtocolError("new WebSocket data frame during fragmentation");
			if (opcode !== OPCODE_TEXT && opcode !== OPCODE_BINARY) {
				throw new CdpProtocolError("invalid WebSocket data opcode");
			}
			this.fragmentOpcode = opcode;
		}
		this.fragmentBytes += payload.length;
		if (this.fragmentBytes > this.maxPayload) throw new CdpProtocolError("fragmented WebSocket message exceeds the configured cap");
		this.fragments.push(payload);
		if (!fin) return;
		const message = Buffer.concat(this.fragments, this.fragmentBytes);
		const messageOpcode = this.fragmentOpcode;
		this.fragments = [];
		this.fragmentBytes = 0;
		this.fragmentOpcode = null;
		events.push({
			type: "message",
			opcode: messageOpcode,
			payload: message,
			text: messageOpcode === OPCODE_TEXT ? message.toString("utf8") : undefined,
		});
	}
}

const DEFAULT_COMMAND_TIMEOUT = 15_000;
const DEFAULT_HTTP_TIMEOUT = 5_000;
const DEFAULT_MAX_JSON_BYTES = 1 * 1024 * 1024;
const CLOSE_GRACE_MS = 100;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function cdpError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function abortError() {
	return cdpError("aborted", "browser command aborted");
}

function timeoutError() {
	return cdpError("timeout", "browser command timed out");
}

function closedError() {
	return cdpError("cdp-protocol", "CDP transport is closed");
}

function httpJson(url, options = {}) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return Promise.reject(cdpError("target-unavailable", "CDP discovery URL is invalid"));
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return Promise.reject(cdpError("target-unavailable", "CDP discovery requires HTTP(S)"));
	}
	const client = parsed.protocol === "https:" ? require("node:https") : require("node:http");
	const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value);
		};
		const request = client.get(parsed, (response) => {
			const chunks = [];
			let bytes = 0;
			response.on("data", (chunk) => {
				bytes += chunk.length;
				if (bytes > maxBytes) {
					request.destroy();
					finish(cdpError("output-limit", "CDP discovery response exceeds its limit"));
					return;
				}
				chunks.push(chunk);
			});
			response.on("end", () => {
				if (settled) return;
				if (response.statusCode !== 200) {
					finish(cdpError("target-unavailable", `CDP discovery returned HTTP ${response.statusCode || 0}`));
					return;
				}
				try {
					finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch {
					finish(cdpError("cdp-protocol", "CDP discovery returned invalid JSON"));
				}
			});
		});
		request.once("error", (error) => {
			if (!settled) finish(cdpError("target-unavailable", `CDP discovery failed: ${error.message}`));
		});
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			finish(cdpError("timeout", "CDP discovery timed out"));
		});
		timer = setTimeout(() => {
			request.destroy();
			finish(cdpError("timeout", "CDP discovery timed out"));
		}, timeoutMs);
		if (options.signal) {
			const onAbort = () => {
				request.destroy();
				finish(abortError());
			};
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}
	});
}

async function discoverTarget(endpoint, options = {}) {
	let base;
	try {
		base = new URL(endpoint);
	} catch {
		throw cdpError("target-unavailable", "CDP endpoint is invalid");
	}
	if (base.protocol !== "http:" && base.protocol !== "https:") {
		throw cdpError("target-unavailable", "CDP endpoint must use HTTP(S)");
	}
	const root = `${base.origin}`;
	await httpJson(`${root}/json/version`, options);
	const targets = await httpJson(`${root}/json/list`, options);
	if (!Array.isArray(targets)) throw cdpError("target-unavailable", "CDP target list is invalid");
	const target = targets.find(
		(item) => item && item.type === "page" && typeof item.webSocketDebuggerUrl === "string",
	);
	if (!target) throw cdpError("target-unavailable", "CDP has no page target");
	return {
		id: String(target.id || "page"),
		type: "page",
		title: typeof target.title === "string" ? target.title : "",
		url: typeof target.url === "string" ? target.url : "",
		webSocketDebuggerUrl: target.webSocketDebuggerUrl,
	};
}

function connectWebSocket(target, options = {}) {
	let ws;
	try {
		ws = new URL(target.webSocketDebuggerUrl);
	} catch {
		return Promise.reject(cdpError("target-unavailable", "CDP target has an invalid WebSocket URL"));
	}
	if (ws.protocol !== "ws:" && ws.protocol !== "wss:") {
		return Promise.reject(cdpError("target-unavailable", "CDP target has an invalid WebSocket URL"));
	}
	const client = ws.protocol === "wss:" ? require("node:https") : require("node:http");
	const key = crypto.randomBytes(16).toString("base64");
	const expectedAccept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
	const timeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HTTP_TIMEOUT;
	return new Promise((resolve, reject) => {
		let settled = false;
		let timer;
		const finish = (error, session) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(session);
		};
		const request = client.request({
			protocol: ws.protocol === "wss:" ? "https:" : "http:",
			hostname: ws.hostname,
			port: ws.port || (ws.protocol === "wss:" ? 443 : 80),
			path: `${ws.pathname || "/"}${ws.search}`,
			headers: {
				Connection: "Upgrade",
				Upgrade: "websocket",
				Host: ws.host,
				"Sec-WebSocket-Version": "13",
				"Sec-WebSocket-Key": key,
			},
		}, (response) => {
			response.resume();
			finish(cdpError("target-unavailable", `CDP WebSocket upgrade returned HTTP ${response.statusCode || 0}`));
		});
		request.once("upgrade", (response, socket, head) => {
			if (response.headers["sec-websocket-accept"] !== expectedAccept) {
				socket.destroy();
				finish(cdpError("cdp-protocol", "CDP WebSocket handshake was rejected"));
				return;
			}
			finish(null, new CdpSession(socket, head, options));
		});
		request.once("error", (error) => {
			if (!settled) finish(cdpError("target-unavailable", `CDP WebSocket failed: ${error.message}`));
		});
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			finish(cdpError("timeout", "CDP WebSocket handshake timed out"));
		});
		timer = setTimeout(() => {
			request.destroy();
			finish(cdpError("timeout", "CDP WebSocket handshake timed out"));
		}, timeoutMs);
		if (options.signal) {
			const onAbort = () => {
				request.destroy();
				finish(abortError());
			};
			if (options.signal.aborted) onAbort();
			else options.signal.addEventListener("abort", onAbort, { once: true });
		}
		request.end();
	});
}

class CdpSession {
	constructor(socket, head, options = {}) {
		this.socket = socket;
		this.decoder = new FrameDecoder({ maxPayload: options.maxPayload ?? DEFAULT_MAX_PAYLOAD });
		this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT;
		this.pending = new Map();
		this.listeners = new Map();
		this.nextId = 1;
		this.closed = false;
		this.closePromise = null;
		this.onData = (chunk) => this.#handleData(chunk);
		this.onError = (error) => this.#fail(cdpError("cdp-protocol", `CDP socket failed: ${error.message}`));
		this.onClose = () => this.#fail(closedError());
		socket.on("data", this.onData);
		socket.once("error", this.onError);
		socket.once("close", this.onClose);
		socket.setNoDelay?.(true);
		if (head && head.length) this.#handleData(head);
	}

	on(eventName, handler) {
		if (typeof handler !== "function") throw new TypeError("CDP event handler must be a function");
		let handlers = this.listeners.get(eventName);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(eventName, handlers);
		}
		handlers.add(handler);
		return () => {
			handlers.delete(handler);
			if (handlers.size === 0) this.listeners.delete(eventName);
		};
	}

	command(method, params = {}, signal, options = {}) {
		if (typeof method !== "string" || !method) return Promise.reject(cdpError("cdp-protocol", "CDP method is required"));
		return this.#commandNow(method, params, signal, options.timeoutMs ?? this.commandTimeoutMs);
	}

	#commandNow(method, params, signal, timeoutMs) {
		if (this.closed) return Promise.reject(closedError());
		if (signal?.aborted) return Promise.reject(abortError());
		return new Promise((resolve, reject) => {
			const id = this.nextId++;
			let timer;
			const onAbort = () => {
				if (!this.pending.has(id)) return;
				this.pending.delete(id);
				clearTimeout(timer);
				reject(abortError());
			};
			const settle = (error, value) => {
				if (!this.pending.has(id)) return;
				this.pending.delete(id);
				clearTimeout(timer);
				if (signal) signal.removeEventListener("abort", onAbort);
				if (error) reject(error);
				else resolve(value);
			};
			this.pending.set(id, { settle });
			timer = setTimeout(() => settle(timeoutError()), timeoutMs);
			if (signal) signal.addEventListener("abort", onAbort, { once: true });
			try {
				const message = JSON.stringify({ id, method, params });
				this.socket.write(encodeFrame(message));
			} catch (error) {
				settle(error);
			}
		});
	}

	#handleData(chunk) {
		if (this.closed) return;
		try {
			for (const event of this.decoder.push(chunk)) {
				if (event.type === "ping") {
					this.socket.write(encodeFrame(event.payload, { opcode: OPCODE_PONG }));
				} else if (event.type === "close") {
					this.#fail(cdpError("cdp-protocol", "CDP peer closed the transport"));
				} else if (event.type === "message") {
					this.#handleMessage(event.text);
				}
			}
		} catch (error) {
			this.#fail(error.code ? error : new CdpProtocolError(error.message));
		}
	}

	#handleMessage(text) {
		let message;
		try {
			message = JSON.parse(text);
		} catch {
			throw new CdpProtocolError("CDP message is not valid JSON");
		}
		if (!message || typeof message !== "object") throw new CdpProtocolError("CDP message is not an object");
		if (message.id != null) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			if (message.error) {
				pending.settle(cdpError("cdp-protocol", message.error.message || "CDP command failed"));
			} else {
				pending.settle(null, message.result);
			}
			return;
		}
		if (typeof message.method !== "string") throw new CdpProtocolError("CDP event has no method");
		for (const handler of this.listeners.get(message.method) || []) {
			try {
				handler(message.params);
			} catch {
				// Event observers must not be able to break the transport.
			}
		}
	}

	#fail(error) {
		if (this.closed) return;
		this.closed = true;
		for (const { settle } of this.pending.values()) settle(error);
		this.pending.clear();
		this.socket.destroy();
	}

	close() {
		if (this.closePromise) return this.closePromise;
		this.closePromise = Promise.resolve().then(() => {
			if (this.closed) return;
			this.closed = true;
			for (const { settle } of this.pending.values()) settle(closedError());
			this.pending.clear();
			try {
				this.socket.write(encodeFrame(Buffer.from([0x03, 0xe8]), { opcode: OPCODE_CLOSE }));
			} catch {
				// The peer is already gone; cleanup below is still sufficient.
			}
			this.socket.end();
			setTimeout(() => this.socket.destroy(), CLOSE_GRACE_MS).unref?.();
		});
		return this.closePromise;
	}
}

async function connectCdpTarget(target, options = {}) {
	return connectWebSocket(target, options);
}

module.exports = {
	CONTROL_MAX_PAYLOAD,
	DEFAULT_COMMAND_TIMEOUT,
	DEFAULT_HTTP_TIMEOUT,
	DEFAULT_MAX_PAYLOAD,
	CdpProtocolError,
	CdpSession,
	FrameDecoder,
	OPCODE_BINARY,
	OPCODE_CLOSE,
	OPCODE_CONTINUATION,
	OPCODE_PING,
	OPCODE_PONG,
	OPCODE_TEXT,
	connectCdpTarget,
	decodeClosePayload,
	discoverTarget,
	encodeFrame,
};
