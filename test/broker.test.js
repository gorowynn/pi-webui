// test/broker.test.js — pending-approval broker (SDD permission-policy C6:
// FR-18/FR-19/FR-20). Zero-dep, `node test/broker.test.js`.
const assert = require("node:assert/strict");
const { createBroker } = require("../broker.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-18 — register + context association ---------------------------------

{
	const b = createBroker();
	assert.equal(b.size(), 0);
	// context comes from the most recent tool_execution_start
	b.setContext("tc-42", "bash");
	const rec = b.register({
		requestId: "r-1",
		method: "select",
		title: "🔐 Allow bash?",
		message: "…",
		options: ["Allow once", "Deny"],
	});
	assert.ok(rec, "register returns the record");
	assert.equal(rec.requestId, "r-1");
	assert.equal(rec.method, "select");
	assert.equal(rec.toolCallId, "tc-42");
	assert.equal(rec.toolName, "bash");
	assert.equal(rec.status, "pending");
	assert.equal(rec.decision, null);
	assert.ok(typeof rec.createdAt === "number");
	// provenance context attaches to the NEXT registration (same ordering
	// guarantee: extension emits setStatus immediately before the select)
	b.setProvenance({
		tier: "ordinary-ask",
		matchedRule: "bash.*",
		layer: "user",
	});
	const rec2 = b.register({ requestId: "r-2", method: "select" });
	assert.deepEqual(rec2.provenance, {
		tier: "ordinary-ask",
		matchedRule: "bash.*",
		layer: "user",
	});
	assert.equal(rec.provenance, null, "earlier record unaffected");
	// duplicate registration rejected
	assert.equal(b.register({ requestId: "r-1", method: "select" }), null);
	ok(
		"register: full record + tool identity from setContext + provenance (# FR-18)",
	);
}

// ---- FR-19 — first response wins ---------------------------------------------

{
	const b = createBroker();
	b.setContext("tc-7", "edit");
	b.register({ requestId: "r-1", method: "select" });
	const first = b.resolve("r-1", "deny");
	assert.equal(first.ok, true);
	assert.deepEqual(first.event, {
		requestId: "r-1",
		toolCallId: "tc-7",
		toolName: "edit",
		decision: "deny",
	});
	const second = b.resolve("r-1", "allow");
	assert.equal(second.ok, false);
	assert.equal(second.reason, "resolved");
	assert.equal(b.get("r-1").decision, "deny", "decision never overwritten");
	ok(
		"first response wins; later resolves rejected; decision immutable (# FR-19)",
	);
}
{
	const b = createBroker();
	assert.equal(b.resolve("nope", "allow").ok, false);
	assert.equal(b.resolve("nope", "allow").reason, "unknown");
	ok("unknown/stale id → rejected (# FR-19)");
}

// ---- FR-19 — resolved broadcast event + get ----------------------------------

{
	const b = createBroker();
	b.setContext("tc-9", "bash");
	b.register({ requestId: "r-3", method: "confirm" });
	const { event } = b.resolve("r-3", { confirmed: true });
	assert.deepEqual(Object.keys(event).sort(), [
		"decision",
		"requestId",
		"toolCallId",
		"toolName",
	]);
	assert.equal(event.requestId, "r-3");
	assert.equal(event.toolCallId, "tc-9");
	assert.equal(event.decision.confirmed, true);
	// get() returns a copy, not the live record
	const g = b.get("r-3");
	g.decision = "tampered";
	assert.equal(b.get("r-3").decision.confirmed, true, "get returns a copy");
	ok("resolve emits the broadcast event shape; get() is copy-safe (# FR-19)");
}

// ---- FR-20 — clear + snapshot -------------------------------------------------

{
	const b = createBroker();
	b.setContext("tc-1", "write");
	b.register({ requestId: "a" });
	b.register({ requestId: "b" });
	const snap = b.snapshot();
	assert.equal(snap.length, 2);
	assert.equal(b.snapshot().length, 2);
	snap[0].decision = "tampered";
	assert.equal(b.get("a").decision, null, "snapshot is a copy");
	b.clear();
	assert.equal(b.size(), 0);
	assert.equal(b.snapshot().length, 0);
	// context resets too: a registration after clear has no tool identity
	const rec = b.register({ requestId: "c" });
	assert.equal(rec.toolCallId, null);
	ok("clear() empties pending + context; snapshot() is a copy (# FR-20)");
}

// ---- FR-18 — dependency-free CommonJS ------------------------------------------

{
	const src = require("node:fs").readFileSync(
		require("node:path").join(__dirname, "..", "broker.js"),
		"utf8",
	);
	assert.ok(!/^\s*(import|export)\s/m.test(src), "no ESM syntax");
	assert.ok(src.includes("module.exports"));
	ok("broker is dependency-free CommonJS (# FR-18)");
}

console.log(`\nbroker.test.js — C6: ${passed} passed`);
