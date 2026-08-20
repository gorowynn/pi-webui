const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { MAX_SSE_QUEUE_BYTES, createSseDelivery } = require("../sse-queue.js");

class FakeResponse extends EventEmitter {
	constructor(results = []) {
		super();
		this.results = results.slice();
		this.writes = [];
		this.endCount = 0;
		this.writableEnded = false;
	}
	write(frame) {
		this.writes.push(frame);
		return this.results.length ? this.results.shift() : true;
	}
	end() {
		this.endCount++;
		this.writableEnded = true;
	}
}

function test(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`ok - ${name}`));
}

async function main() {
	await test("counts UTF-8 bytes and accepts the inclusive limit", () => {
		const res = new FakeResponse([false]);
		const reasons = [];
		const delivery = createSseDelivery(res, {
			onClose: (reason) => reasons.push(reason),
		});
		assert.equal(delivery.push("a"), "paused");
		const exact = "é".repeat(MAX_SSE_QUEUE_BYTES / 2);
		assert.equal(Buffer.byteLength(exact), MAX_SSE_QUEUE_BYTES);
		assert.equal(delivery.push(exact), "queued");
		assert.equal(delivery.state().pendingBytes, MAX_SSE_QUEUE_BYTES);
		assert.equal(delivery.push("z"), "overflow");
		assert.deepEqual(reasons, ["overflow"]);
	});

	await test("drains queued frames once in FIFO order", () => {
		const res = new FakeResponse([false, true, true]);
		const delivery = createSseDelivery(res);
		assert.equal(delivery.push("a"), "paused");
		assert.equal(delivery.push("b"), "queued");
		assert.equal(delivery.push("c"), "queued");
		res.emit("drain");
		assert.deepEqual(res.writes, ["a", "b", "c"]);
		assert.deepEqual(delivery.state(), {
			closed: false,
			paused: false,
			pendingBytes: 0,
			pendingFrames: [],
		});
	});

	await test("preserves the unwritten tail across a second pause", () => {
		const res = new FakeResponse([false, false, true]);
		const delivery = createSseDelivery(res);
		delivery.push("a");
		delivery.push("b");
		delivery.push("c");
		res.emit("drain");
		assert.deepEqual(res.writes, ["a", "b"]);
		assert.deepEqual(delivery.state().pendingFrames, ["c"]);
		res.emit("drain");
		assert.deepEqual(res.writes, ["a", "b", "c"]);
		assert.equal(delivery.state().pendingBytes, 0);
	});

	await test("rejects a single oversized frame", () => {
		const res = new FakeResponse([false]);
		const delivery = createSseDelivery(res);
		delivery.push("a");
		assert.equal(
			delivery.push("x".repeat(MAX_SSE_QUEUE_BYTES + 1)),
			"overflow",
		);
		assert.equal(delivery.state().closed, true);
		assert.equal(delivery.state().pendingFrames.length, 0);
	});

	await test("close is idempotent and late drains are harmless", () => {
		const res = new FakeResponse([false]);
		const delivery = createSseDelivery(res);
		assert.equal(delivery.push("a"), "paused");
		assert.equal(delivery.close("client-close"), true);
		assert.equal(delivery.close("again"), false);
		assert.doesNotThrow(() => res.emit("drain"));
		assert.equal(delivery.push("b"), "closed");
		assert.equal(res.endCount, 1);
	});

	await test("closes a stalled paused response", async () => {
		const res = new FakeResponse([false]);
		const reasons = [];
		const delivery = createSseDelivery(res, {
			stallMs: 5,
			onClose: (reason) => reasons.push(reason),
		});
		delivery.push("a");
		await new Promise((resolve) => setTimeout(resolve, 15));
		assert.equal(delivery.state().closed, true);
		assert.deepEqual(reasons, ["stall"]);
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
