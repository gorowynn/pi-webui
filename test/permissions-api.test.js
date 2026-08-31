// test/permissions-api.test.js — server /api/permissions surface (SDD
// permission-policy C7: FR-21/22/24/37 + FR-35). Source/contract audit of the
// REAL server.js: endpoint existence, CSRF gating, revision conflicts, marker
// validation, broadcast, snapshot replay. Zero-dep, `node test/permissions-api.test.js`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const sv = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-37 — exactly the 7 fixed endpoints ----------------------------------

{
	const endpoints = [
		'GET" && url.pathname === "/api/permissions"', // GET /api/permissions
		'GET" && url.pathname === "/api/permissions/mode"', // GET mode (composer chip)
		'PUT" && url.pathname === "/api/permissions/config"', // PUT config
		'DELETE" && url.pathname === "/api/permissions/grants"', // DELETE grants
		"grantRevoke = url.pathname.match", // DELETE grants/:id (regex route)
		'POST" && url.pathname === "/api/permissions/explain"', // POST explain
		'GET" && url.pathname === "/api/permissions/audit"', // GET audit
	];
	for (const e of endpoints) {
		assert.ok(sv.includes(e), `endpoint present: ${e}`);
	}
	// no other /api/permissions surface beyond these
	const others = sv.match(/\/api\/permissions\/[a-z]+/g) ?? [];
	assert.ok(
		others.every((o) =>
			[
				"/api/permissions/mode",
				"/api/permissions/config",
				"/api/permissions/explain",
				"/api/permissions/audit",
				"/api/permissions/grants",
			].includes(o),
		),
		`no unexpected endpoints: ${[...new Set(others)].join(", ")}`,
	);
	ok("exactly the 7 fixed /api/permissions endpoints exist (# FR-37)");
}

// ---- FR-37 — CSRF gate + body cap --------------------------------------------

{
	const gateLine = sv.indexOf("if (!isAllowed(req))");
	const permLine = sv.indexOf('url.pathname === "/api/permissions"');
	const auditLine = sv.indexOf('url.pathname === "/api/permissions/audit"');
	assert.ok(
		permLine > gateLine,
		"permissions endpoints sit inside the isAllowed gate",
	);
	assert.ok(
		sv.slice(permLine, auditLine + 500).includes("await readBody(req)"),
		"endpoints use the size-capped readBody",
	);
	assert.ok(sv.includes("const MAX_BODY"), "readBody carries the body cap");
	ok("all permission endpoints are behind isAllowed + the body cap (# FR-37)");
}

// ---- FR-37 — revision-conflict + atomic write --------------------------------

{
	const put = sv.slice(
		sv.indexOf('"/api/permissions/config"'),
		sv.indexOf('"/api/permissions/grants"'),
	);
	assert.ok(
		put.includes("onDisk.revision !== body.revision"),
		"stale revision check",
	);
	assert.ok(put.includes("res.writeHead(409"), "409 on conflict");
	assert.ok(put.includes("atomicWriteJson"), "atomic temp+rename write");
	assert.ok(put.includes("validateConfig"), "server-side schema validation");
	ok(
		"PUT: schema-validated, revision-checked, atomic write with 409 path (# FR-37)",
	);
}

// ---- FR-21 — snapshot replay ---------------------------------------------------

{
	assert.ok(
		sv.includes("pendingApprovals: broker.snapshot()"),
		"/api/snapshot carries pending approvals",
	);
	ok("pendingApprovals in the snapshot bundle (# FR-21)");
}

// ---- FR-24 — marker validation --------------------------------------------------

{
	const cmd = sv.slice(sv.indexOf('"/api/cmd"'), sv.indexOf('"/api/snapshot"'));
	assert.ok(
		cmd.includes('obj.type === "extension_ui_response"'),
		"response interception",
	);
	assert.ok(
		cmd.includes("marker.toolCallId !== rec.toolCallId"),
		"toolCallId marker check",
	);
	assert.ok(cmd.includes("res.writeHead(410"), "stale → 410");
	assert.ok(cmd.includes("broker.resolve"), "resolution through the broker");
	assert.ok(
		cmd.includes("first response wins") || cmd.includes("!r.ok"),
		"resolved-once guard",
	);
	ok(
		"extension_ui_response: marker validated, broker resolves once, 410 on stale (# FR-24)",
	);
}

// ---- FR-19/22 — approval_resolved broadcast -------------------------------------

{
	assert.ok(
		sv.includes('type: "approval_resolved"') &&
			sv.includes("...r.event") &&
			sv.includes("broadcast({"),
		"approval_resolved broadcast on resolve (wrap-tolerant)",
	);
	ok("approval_resolved emitted via broadcast() (# FR-19/22)");
}

// ---- FR-35 — explain uses the SAME engine -----------------------------------------

{
	const explain = sv.slice(
		sv.indexOf('"/api/permissions/explain"'),
		sv.indexOf('"/api/permissions/audit"'),
	);
	assert.ok(
		explain.includes("policyEngine.resolve("),
		"explain resolves via the engine",
	);
	assert.ok(
		explain.includes("policyEngine.mergeLayers("),
		"explain merges the same layers",
	);
	assert.ok(
		explain.includes("bashCls.classify"),
		"explain classifies bash like the gate",
	);
	assert.ok(
		!explain.includes("matchValue(") && !explain.includes("new RegExp"),
		"no second rule implementation inside explain",
	);
	ok("explain: same engine + classifier as the live gate (# FR-35)");
}

// ---- broker lifecycle wiring --------------------------------------------------------

{
	assert.ok(sv.includes("broker.clear()"), "broker cleared somewhere");
	const failure = sv.slice(
		sv.indexOf("function handlePiStartFailure"),
		sv.indexOf("async function switchWorkspace"),
	);
	assert.ok(failure.includes("broker.clear()"), "cleared on SDK runtime failure");
	const switchBlock = sv.slice(sv.indexOf("async function switchWorkspace"));
	assert.ok(
		switchBlock.includes("broker.clear()"),
		"cleared on workspace switch",
	);
	ok("broker cleared on SDK failure AND workspace switch (# FR-20)");
}

console.log(`\npermissions-api.test.js — C7: ${passed} passed`);
