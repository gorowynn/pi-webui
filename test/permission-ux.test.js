// test/permission-ux.test.js — browser approval wire (SDD permission-policy
// C8: FR-25/22/23/24/27). Two layers: source audit of the REAL app.js (marker
// shape, toolCallId map, ack flow) + state-machine simulations of the
// ack-before-close and stale-request semantics. Zero-dep.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- Runtime wiring guards ----------------------------------------------------

{
	assert.ok(
		app.includes("let lastSafeguardCtx = null"),
		"safeguard status provenance is mutable",
	);
	assert.ok(
		app.includes("body.confirmed = value != null && value.confirmed === true"),
		"confirm replies include pi's top-level confirmed field",
	);
	ok("safeguard status and confirm response wiring");
}

// ---- FR-25 — marker shape + stable decision enums -----------------------------

{
	assert.ok(
		app.includes("body.marker = { v: 1, toolCallId: p.toolCallId, decision }"),
		"approval responses carry the version-1 marker",
	);
	const enums = [
		"allow-once",
		"allow-session",
		"allow-always",
		"deny",
		"edited",
	];
	for (const e of enums) {
		assert.ok(app.includes(`"${e}"`), `decision enum present: ${e}`);
	}
	assert.ok(
		app.includes('return typeof label === "object" ? "edited" : "deny"'),
		"edited proposal maps to the edited enum; unknown → deny (fail closed)",
	);
	ok("marker {v:1, toolCallId, decision} with the 5 stable enums (# FR-25)");
}

// ---- FR-25 — toolCallId args map replaces the singleton in permission paths ----

{
	assert.ok(
		app.includes("const toolArgs = new Map()"),
		"toolCallId → args map exists",
	);
	assert.ok(
		app.includes("toolArgs.set(payload.toolCallId, payload.args)"),
		"map fed at tool_execution_start",
	);
	assert.ok(app.includes("toolArgs.clear()"), "map cleared per turn");
	// the permission paths read through the pending approval, not curToolArgs
	const rdp = app.slice(
		app.indexOf("function renderEditDiffPreviews"),
		app.indexOf("function buildDiffPayload"),
	);
	assert.ok(
		rdp.includes("pendingToolArgs()"),
		"diff preview reads via pendingToolArgs",
	);
	assert.ok(
		!rdp.includes("curToolArgs"),
		"no curToolArgs reads in the preview path",
	);
	const bdp = app.slice(
		app.indexOf("function buildDiffPayload"),
		app.indexOf("function openSelectModal"),
	);
	assert.ok(
		bdp.includes("pendingToolArgs()"),
		"diff payload reads via pendingToolArgs",
	);
	assert.ok(
		!bdp.includes("curToolArgs"),
		"no curToolArgs reads in the payload path",
	);
	ok(
		"toolCallId map fed at start; permission paths read via pendingToolArgs (# FR-25)",
	);
}

// ---- FR-22/23/24 — ack-before-close semantics ----------------------------------

{
	assert.ok(
		app.includes("function sendApprovalDecision(id, value, decision)"),
		"decision helper exists",
	);
	assert.ok(
		app.includes(
			"if (j && j.ok) return; // resolved — the broadcast closes the UI",
		),
		"200 → wait for the broadcast (no close)",
	);
	assert.ok(
		app.includes('err === "stale toolCallId"'),
		"stale marker keeps the UI with a retry",
	);
	assert.ok(
		app.includes('err === "resolved" || err === "unknown"'),
		"already-decided → close + warn",
	);
	assert.ok(
		app.includes("Decision not acknowledged — retry"),
		"2s watchdog keeps the UI + prompts retry",
	);
	ok(
		"ack-before-close: broadcast closes, 410 paths keep/close per reason, watchdog (# FR-22/24)",
	);
}
{
	assert.ok(
		app.includes("pendingApproval.requestId === env.requestId"),
		"approval_resolved matched by requestId",
	);
	assert.ok(
		app.includes('env.source === "server" && env.type === "approval_resolved"'),
		"broadcast handler wired",
	);
	ok("approval_resolved handler closes only the matching approval (# FR-24)");
}
{
	assert.ok(
		app.includes("pendingApproval && !pendingSending"),
		"Esc/backdrop deny gate",
	);
	assert.ok(
		app.includes(
			'sendApprovalDecision(pendingApproval.requestId, "Deny", "deny")',
		),
		"Esc/backdrop → Deny through the ack path (# FR-23)",
	);
	ok(
		"Esc/backdrop = Deny via the broker, inert while a decision is in flight (# FR-23)",
	);
}

// ---- state machine: ack-before-close + stale rejection --------------------------

{
	// mirror of sendApprovalDecision + the approval_resolved handler
	let closed = false;
	let pending = { requestId: "r-1", toolCallId: "tc-1" };
	const hideModal = () => (closed = true);
	const clearPending = () => (pending = null);
	// the POST resolves ok → we do NOT close (we wait for the broadcast)
	const serverOk = { ok: true };
	assert.equal(serverOk.ok, true);
	assert.equal(closed, false, "must NOT close on the POST response alone");
	// broadcast for THIS requestId → close
	if (pending && pending.requestId === "r-1") {
		hideModal();
		clearPending();
	}
	assert.equal(closed, true, "closed only after approval_resolved");
	assert.equal(pending, null);
	ok(
		"sim: UI closes on approval_resolved, never on the POST 200 alone (# FR-22)",
	);
}
{
	// mismatched broadcast must not close a different approval
	let closed = false;
	const pending = { requestId: "r-1" };
	const env = { requestId: "r-2" }; // someone else's resolution
	if (pending && pending.requestId === env.requestId) closed = true;
	assert.equal(
		closed,
		false,
		"foreign requestId does not close our UI (# FR-24)",
	);
	ok("sim: mismatched approval_resolved requestId → no close (# FR-24)");
}
{
	// stale marker response keeps the UI + shows retry
	const closed = false;
	let pendingSending = true;
	let toastMsg = "";
	const j = { ok: false, error: "stale toolCallId" };
	if (j.ok) {
		/* wait for broadcast */
	} else if (j.error === "stale toolCallId") {
		pendingSending = false;
		toastMsg = "Decision too late — retry";
	}
	assert.equal(closed, false, "UI stays");
	assert.equal(toastMsg.includes("retry"), true);
	assert.equal(pendingSending, false, "retry re-enabled");
	ok(
		"sim: stale marker → UI stays + retry toast + dismissal unlocked (# FR-24)",
	);
}
{
	// resolved/unknown 410 → close (someone else decided / id gone)
	let closed = false;
	const j = { ok: false, error: "resolved" };
	if (j.error === "resolved" || j.error === "unknown") closed = true;
	assert.equal(closed, true);
	ok(
		"sim: resolved/unknown 410 → close (decision recorded elsewhere) (# FR-19/24)",
	);
}

// ---- FR-27 — ask-question ordering preserved -------------------------------------

{
	// the ask latch handler must still run before the generic dialog branch and
	// keep its immediate-close response path (no sendApprovalDecision reroute)
	const askBlock = app.slice(
		app.indexOf('if (method === "input" && req.title === ASK_MARKER)'),
		app.indexOf('if (method === "notify")'),
	);
	assert.ok(
		askBlock.includes("askQuestion(a)"),
		"rich ask modal still rendered",
	);
	assert.ok(
		askBlock.includes('api({ type: "extension_ui_response", id, value: "" })'),
		"declined-answer fallback keeps the plain response",
	);
	assert.ok(
		!askBlock.includes("sendApprovalDecision"),
		"ask flow not rerouted",
	);
	const askModal = app.slice(
		app.indexOf("function askQuestion(args)"),
		app.indexOf("function shellLooks"),
	);
	assert.ok(
		askModal.includes('showModal("", false)') &&
			!askModal.includes('showModal("", false, true)'),
		"ask question opens the blocking modal (width only with diffs, bce9bcf)",
	);
	assert.ok(
		askModal.includes('toast("Your input is needed", "warn")'),
		"ask question emits a visible notification",
	);
	ok("ask bridge ordering + full-page notification flow preserved (# FR-27)");
}

// ---- C9 — full-page approval modal + notification (FR-26/28) --------------------

{
	assert.ok(
		!app.includes("function renderApprovalInCard"),
		"no approval UI is rendered inside a tool card",
	);
	assert.ok(
		!app.includes("function approvalSurfaceHost"),
		"approval placement no longer depends on card visibility",
	);
	assert.ok(
		app.includes('card.className = fullPage ? "card wide" : "card"'),
		"full-page modal variant exists",
	);
	assert.ok(
		app.includes("async function openSelectModal(req)") &&
			!app.includes("notify = false"),
		"select modal takes no notify flag (toasts live in the dialog branches)",
	);
	assert.ok(
		(app.match(/toast\("Your input is needed", "warn"\)/g) || []).length >=
			3,
		"ask/input/editor branches emit a warning notification",
	);
	assert.ok(
		app.includes(
			'showModal(`<h3>${esc(req.title || "Input")}</h3>`, false)',
		) &&
			app.includes(
				'showModal(`<h3>${esc(req.title || "Edit")}</h3>`, false)',
			) &&
			!app.includes(
				'showModal(`<h3>${esc(req.title || "Input")}</h3>`, false, true)',
			),
		"input/editor open the blocking modal (width only with diffs, bce9bcf)",
	);
	assert.ok(
		app.includes('labels.filter((l) => l === "Allow once" || l === "Deny")'),
		"mandatory-ask renders only Allow once / Deny (# FR-26)",
	);
	assert.ok(
		app.includes('allowed.has(typeof o === "string" ? o : o.label)'),
		"mandatory options are filtered before page-modal buttons render",
	);
	assert.ok(
		app.includes("APPROVAL_RECEIPTS_MAX = 50"),
		"receipt ring capped at 50 (# FR-28)",
	);
	assert.ok(app.includes("pushReceipt("), "decisions recorded (# FR-28)");
	ok(
		"full-page approval modal, notification, mandatory options, receipts (# FR-26/28)",
	);
}
{
	const css = fs.readFileSync(path.join(ROOT, "public", "style.css"), "utf8");
	assert.ok(
		!css.includes(".tool .approval"),
		"no in-card approval styles remain",
	);
	assert.ok(
		css.includes("#modal:has(.card.wide)"),
		"wide cards receive the full-page modal surface",
	);
	assert.ok(
		!css.includes("@media (max-width: 720px)"),
		"no bare 720px media rule (U1 shell contract A-2.3)",
	);
	ok("style.css: full-page tool interaction modal (# FR-26)");
}

console.log(`\npermission-ux.test.js — C8+C9: ${passed} passed`);
