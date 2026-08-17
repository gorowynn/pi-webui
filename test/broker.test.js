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
	// resolved records are dropped from the replay list (a reload mid-session
	// must not re-open an already-answered modal) while still answering
	// stale-id 410s via get()/resolve()
	b.resolve("a", "allow");
	assert.equal(b.snapshot().length, 1, "resolved excluded from snapshot");
	assert.equal(
		b.resolve("a", "deny").reason,
		"resolved",
		"stale 410 still works",
	);
	b.clear();
	assert.equal(b.size(), 0);
	assert.equal(b.snapshot().length, 0);
	// context resets too: a registration after clear has no tool identity
	const rec = b.register({ requestId: "c" });
	assert.equal(rec.toolCallId, null);
	ok("clear() empties pending + context; snapshot() is a copy (# FR-20)");
}

// ---- SEC-07 — decisions validated against offered options ----------------------

{
	// mandatory-ask: gate offered only Allow once/Deny; the IDE's four-label
	// answer "Allow always (save to config)" must be rejected — and the record
	// must STAY pending (a correct client can still answer)
	const b = createBroker();
	b.register({
		requestId: "r-ma",
		method: "select",
		options: ["Allow once", "Deny"],
	});
	const bad = b.resolve("r-ma", "Allow always (save to config)");
	assert.equal(bad.ok, false);
	assert.equal(bad.reason, "invalid-option");
	assert.equal(b.get("r-ma").status, "pending", "record stays pending");
	// a correct client can still answer afterwards
	const good = b.resolve("r-ma", "Allow once");
	assert.equal(good.ok, true);
	ok(
		"invalid option rejected, record stays pending, correct answer still wins (# SEC-07)",
	);
}
{
	// session label too — the review's exact evidence
	const b = createBroker();
	b.register({
		requestId: "r-ma2",
		method: "select",
		options: ["Allow once", "Deny"],
	});
	const bad = b.resolve("r-ma2", "Allow for this session");
	assert.equal(bad.ok, false);
	assert.equal(bad.reason, "invalid-option");
	assert.equal(b.get("r-ma2").status, "pending");
	ok("session label rejected on mandatory-ask (# SEC-07)");
}
{
	// editable-diff object decision: the label is extracted from {label,oldFull,newFull}
	const b = createBroker();
	b.register({
		requestId: "r-ed",
		method: "select",
		options: ["Allow once", "Allow always (save to config)", "Deny"],
	});
	const good = b.resolve("r-ed", {
		label: "Allow once",
		oldFull: "a",
		newFull: "b",
	});
	assert.equal(good.ok, true);
	assert.equal(good.event.decision.label, "Allow once");
	// and an object with an illegal label is rejected
	const b2 = createBroker();
	b2.register({
		requestId: "r-ed2",
		method: "select",
		options: ["Allow once", "Deny"],
	});
	assert.equal(b2.resolve("r-ed2", { label: "Deny" }).ok, true);
	const b3 = createBroker();
	b3.register({
		requestId: "r-ed3",
		method: "select",
		options: ["Allow once", "Deny"],
	});
	assert.equal(
		b3.resolve("r-ed3", { label: "Allow always (save to config)" }).reason,
		"invalid-option",
	);
	ok("object decisions validated by extracted label (# SEC-07)");
}
{
	// freeform methods (confirm/input/editor) have no options — any value accepted
	const b = createBroker();
	b.register({ requestId: "r-c", method: "confirm" });
	assert.equal(b.resolve("r-c", { confirmed: true }).ok, true);
	const b2 = createBroker();
	b2.register({ requestId: "r-i", method: "input" });
	assert.equal(b2.resolve("r-i", "any text").ok, true);
	ok("freeform (confirm/input/editor) unchanged (# SEC-07)");
}
{
	// option objects normalize to labels; malformed entries skipped
	const b = createBroker();
	b.register({
		requestId: "r-obj",
		method: "select",
		options: ["Allow once", { label: "Deny" }, null, {}, 42],
	});
	assert.equal(
		b.resolve("r-obj", "Deny").ok,
		true,
		"object option normalized to label",
	);
	const b2 = createBroker();
	b2.register({
		requestId: "r-obj2",
		method: "select",
		options: ["Allow once", { label: "Deny" }, null, {}, 42],
	});
	assert.equal(
		b2.resolve("r-obj2", "Allow always (save to config)").reason,
		"invalid-option",
	);
	ok("option objects normalize; malformed entries skipped (# SEC-07)");
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
