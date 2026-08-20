// Per-client SSE delivery state. Keeps backpressure policy out of server.js so
// queue transitions can be exercised without opening a listening HTTP server.
const MAX_SSE_QUEUE_BYTES = 1024 * 1024;
const SSE_STALL_MS = 20000;

function createSseDelivery(res, options = {}) {
	const maxBytes = options.maxBytes ?? MAX_SSE_QUEUE_BYTES;
	const stallMs = options.stallMs ?? SSE_STALL_MS;
	const onClose =
		typeof options.onClose === "function" ? options.onClose : () => {};
	let pendingFrames = [];
	let pendingBytes = 0;
	let paused = false;
	let closed = false;
	let deadline = null;
	let drainArmed = false;

	function clearDeadline() {
		if (deadline !== null) clearTimeout(deadline);
		deadline = null;
	}

	function flush() {
		drainArmed = false;
		if (closed) return;
		clearDeadline();
		while (pendingFrames.length) {
			const frame = pendingFrames.shift();
			pendingBytes -= Buffer.byteLength(frame, "utf8");
			try {
				if (!res.write(frame)) {
					paused = true;
					armDrain();
					return;
				}
			} catch {
				close("write-error");
				return;
			}
		}
		paused = false;
	}

	function armDrain() {
		if (closed || drainArmed) return;
		drainArmed = true;
		res.once("drain", flush);
		deadline = setTimeout(() => close("stall"), stallMs);
	}

	function close(reason = "closed") {
		if (closed) return false;
		closed = true;
		paused = false;
		pendingFrames = [];
		pendingBytes = 0;
		clearDeadline();
		if (drainArmed && typeof res.removeListener === "function")
			res.removeListener("drain", flush);
		drainArmed = false;
		try {
			onClose(reason);
		} catch {}
		try {
			if (!res.writableEnded) res.end();
		} catch {}
		return true;
	}

	function push(frame) {
		if (typeof frame !== "string")
			throw new TypeError("SSE frame must be a string");
		if (closed) return "closed";
		const bytes = Buffer.byteLength(frame, "utf8");
		if (paused) {
			if (pendingBytes + bytes > maxBytes) {
				close("overflow");
				return "overflow";
			}
			pendingFrames.push(frame);
			pendingBytes += bytes;
			return "queued";
		}
		try {
			if (res.write(frame)) return "delivered";
		} catch {
			close("write-error");
			return "write-error";
		}
		paused = true;
		armDrain();
		return "paused";
	}

	return {
		push,
		close,
		flush,
		state() {
			return {
				closed,
				paused,
				pendingBytes,
				pendingFrames: pendingFrames.slice(),
			};
		},
	};
}

module.exports = { MAX_SSE_QUEUE_BYTES, SSE_STALL_MS, createSseDelivery };
