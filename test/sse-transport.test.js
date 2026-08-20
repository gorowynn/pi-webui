const assert = require("node:assert/strict");
const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const { createSseDelivery } = require("../sse-queue.js");

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

function frame(type) {
	return `data: ${JSON.stringify({ type })}\n\n`;
}

function broadcast(deliveries, type) {
	const line = frame(type);
	for (const delivery of deliveries) {
		try {
			delivery.push(line);
		} catch {
			delivery.close("write-error");
		}
	}
}

function test(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => console.log(`ok - ${name}`));
}

async function main() {
	await test("isolates a paused tab from a healthy tab", () => {
		const slowRes = new FakeResponse([false, true]);
		const healthyRes = new FakeResponse([true, true]);
		const slow = createSseDelivery(slowRes);
		const healthy = createSseDelivery(healthyRes);
		const clients = [slow, healthy];
		broadcast(clients, "one");
		broadcast(clients, "two");
		assert.deepEqual(healthyRes.writes, [frame("one"), frame("two")]);
		assert.deepEqual(slowRes.writes, [frame("one")]);
		slowRes.emit("drain");
		assert.deepEqual(slowRes.writes, [frame("one"), frame("two")]);
	});

	await test("keeps the tail when an integrated drain re-pauses", () => {
		const res = new FakeResponse([false, false, true]);
		const delivery = createSseDelivery(res);
		const clients = [delivery];
		broadcast(clients, "one");
		broadcast(clients, "two");
		broadcast(clients, "three");
		res.emit("drain");
		assert.deepEqual(res.writes, [frame("one"), frame("two")]);
		res.emit("drain");
		assert.deepEqual(res.writes, [frame("one"), frame("two"), frame("three")]);
	});

	await test("overflows only the slow client", () => {
		const slowRes = new FakeResponse([false]);
		const healthyRes = new FakeResponse();
		const reasons = [];
		const slow = createSseDelivery(slowRes, {
			maxBytes: Buffer.byteLength(frame("one")),
			onClose: (reason) => reasons.push(reason),
		});
		const healthy = createSseDelivery(healthyRes);
		broadcast([slow, healthy], "one");
		broadcast([slow, healthy], "two");
		broadcast([slow, healthy], "three");
		assert.deepEqual(reasons, ["overflow"]);
		assert.equal(slowRes.endCount, 1);
		assert.deepEqual(healthyRes.writes, [
			frame("one"),
			frame("two"),
			frame("three"),
		]);
	});

	await test("contains one client's write failure", () => {
		const badRes = new FakeResponse();
		badRes.write = () => {
			throw new Error("socket failed");
		};
		const goodRes = new FakeResponse();
		const bad = createSseDelivery(badRes);
		const good = createSseDelivery(goodRes);
		assert.doesNotThrow(() => broadcast([bad, good], "event"));
		assert.equal(bad.state().closed, true);
		assert.deepEqual(goodRes.writes, [frame("event")]);
	});

	await test("cleans up a stalled integrated client", async () => {
		const res = new FakeResponse([false]);
		const delivery = createSseDelivery(res, { stallMs: 5 });
		broadcast([delivery], "event");
		await new Promise((resolve) => setTimeout(resolve, 15));
		assert.equal(delivery.state().closed, true);
		assert.equal(res.endCount, 1);
	});

	await test("keeps the server and browser reconnect contracts", () => {
		const server = fs.readFileSync(require.resolve("../server.js"), "utf8");
		const app = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
		assert.match(server, /require\("\.\/sse-queue\.js"\)/);
		assert.match(server, /client\.push\(line\)/);
		assert.match(server, /delivery = createSseDelivery\(res/);
		assert.match(server, /text\/event-stream/);
		assert.match(app, /es\.onopen[\s\S]*?fetchSnapshot\(\)/);
	});
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
