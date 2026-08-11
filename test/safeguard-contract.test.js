// test/safeguard-contract.test.js — source audit of the safeguard extension
// (SDD permission-policy C5: FR-10/12/13/14/15/16/32/42). Same pattern as
// a11y-contract.test.js: scans the REAL files for load-bearing invariants that
// behavior tests can't reach (wire contracts, session scoping, option sets).
// Zero-dep, `node test/safeguard-contract.test.js`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ext = path.join(ROOT, "extensions", "pi_minimal_webui");
const sg = fs.readFileSync(path.join(ext, "safeguard.ts"), "utf8");
const eng = fs.readFileSync(path.join(ext, "policy-engine.js"), "utf8");
const idx = fs.readFileSync(path.join(ext, "index.ts"), "utf8");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-42 — the engine is the single gate -------------------------------

{
	assert.ok(
		sg.includes('import engine from "./policy-engine.js"'),
		"engine imported",
	);
	assert.ok(
		sg.includes('import bashCls from "./bash-classifier.js"'),
		"classifier imported",
	);
	assert.ok(sg.includes("engine.resolve("), "gate resolves through the engine");
	assert.ok(
		sg.includes("engine.applyMode("),
		"mode transform through the engine",
	);
	assert.ok(
		sg.includes("engine.mergeLayers("),
		"layer merge through the engine",
	);
	// no inline allow/deny resolution logic left in the handler
	const handler = sg.slice(
		sg.indexOf('pi.on("tool_call"'),
		sg.indexOf("pi.registerCommand"),
	);
	assert.ok(!handler.includes("matchValue("), "no local rule matcher");
	assert.ok(!handler.includes("globToRe("), "no local glob compiler");
	ok(
		"single enforcement point: resolve/applyMode/mergeLayers all from the engine (# FR-42)",
	);
}
{
	// the config audits target the ENGINE now — DEFAULT_CONFIG lives there
	// (single copy; safeguard.ts aliases engine.DEFAULT_CONFIG)
	assert.ok(
		sg.includes("engine.DEFAULT_CONFIG"),
		"extension aliases the engine floor",
	);
	assert.ok(eng.includes("grants: []"), "shipped floor carries the grants key");
	assert.ok(
		!eng.replace(/\/\*[\s\S]*?\*\//g, "").includes("re:^echo "),
		"echo auto-allow removed from the shipped floor (# FR-10)",
	);
	assert.ok(
		eng.includes(
			'"re:^git (status|log|diff|show|blame|ls-files)(\\\\s|$)": "allow"',
		),
		"git recon allowlist narrowed to status|log|diff|show|blame|ls-files (# FR-10)",
	);
	assert.ok(
		eng.includes("git branch --show-current"),
		"branch --show-current allowed",
	);
	assert.ok(eng.includes("git remote -v"), "remote -v allowed");
	assert.ok(
		!eng.includes("git remote remove") && !eng.includes("git branch -D"),
		"mutating git verbs not in the allowlist (# FR-10)",
	);
	ok(
		"DEFAULT_CONFIG (engine): echo rule gone, git allowlist narrowed (# FR-10)",
	);
}

// ---- FR-12/14 — yolo is session-only ---------------------------------------

{
	assert.ok(
		!eng.includes('mode: "yolo"'),
		"engine's DEFAULT_CONFIG never carries yolo",
	);
	assert.ok(eng.includes('mode: "default"'), "DEFAULT_CONFIG mode is default");
	assert.ok(sg.includes("let sessionYolo = false"), "session yolo flag exists");
	const start = sg.indexOf('pi.on("session_start"');
	const startBlock = sg.slice(start, sg.indexOf('pi.on("tool_call"'));
	assert.ok(
		startBlock.includes("sessionYolo = false"),
		"yolo cleared on session_start",
	);
	const shutdown = sg.slice(sg.indexOf("session_shutdown"));
	assert.ok(
		shutdown.includes("sessionYolo = false"),
		"yolo cleared on session_shutdown",
	);
	assert.ok(sg.includes("const mode = sessionYolo"), "runtime yolo feeds the mode");
	ok(
		"yolo is session state: cleared on start+shutdown, never a config value (# FR-12/14)",
	);
}

// ---- FR-13/16 — mandatory-ask option set + coordination exemption ----------

{
	assert.ok(
		sg.includes('eff.tier === "mandatory-ask"'),
		"mandatory-ask tier branches the option set",
	);
	assert.ok(
		sg.includes("[ALLOW_ONCE, DENY]") &&
			sg.includes("[ALLOW_ONCE, ALLOW_SESSION, ALLOW_ALWAYS, DENY]"),
		"mandatory-ask: [Allow once, Deny]; ordinary: 4 buttons (# FR-13)",
	);
	assert.ok(
		eng.includes('ask_user_question: "allow"') && eng.includes('todo: "allow"'),
		"coordination tools allow-ruled in config",
	);
	assert.ok(
		eng.includes('COORD_TOOLS = new Set(["ask_user_question", "todo"])'),
		"engine defines the coordination set",
	);
	assert.ok(
		eng.includes("COORD_TOOLS.has(ctx.toolName)"),
		"engine applyMode exempts coordination tools from read-only (# FR-16)",
	);
	ok(
		"coordination tools: engine-exempt in read-only, allow-ruled in config (# FR-16)",
	);
}

// ---- FR-2 → browser provenance ----------------------------------------------

{
	assert.ok(
		sg.includes("ctx.ui.setStatus?.(") && sg.includes('"safeguard"'),
		"provenance context emitted via setStatus before the prompt",
	);
	assert.ok(sg.includes("tier: eff.tier"), "tier in the context");
	assert.ok(
		sg.includes("matchedRule: eff.matchedRule"),
		"matched rule in the context",
	);
	assert.ok(sg.includes("layer: eff.layer"), "layer in the context");
	ok(
		"provenance context (tier/rule/layer/reason/mode) precedes every select (# FR-2)",
	);
}

// ---- FR-14/32 — commands ----------------------------------------------------

{
	assert.ok(sg.includes('a === "mode yolo"'), "/safeguard mode yolo exists");
	assert.ok(
		sg.includes('"Engage YOLO"') && sg.includes("sessionYolo = true"),
		"yolo engagement is human-confirmed",
	);
	assert.ok(
		sg.includes("a.match(/^revoke\\s+(\\d+)$/)") || sg.includes('"revoke"'),
		"/safeguard revoke <n> exists",
	);
	assert.ok(
		sg.includes("sessionAllow.delete"),
		"revoke reaches the session set",
	);
	assert.ok(sg.includes('a === "reset"'), "/safeguard reset unchanged");
	ok("commands: mode yolo (confirmed), revoke <n>, reset (# FR-14/32)");
}

// ---- C7 refinement — exact-selector always-grants + FR-9 binding gate ---------

{
	assert.ok(
		sg.includes("cfg.grants = grants"),
		"ALLOW_ALWAYS writes an exact-selector grant, not a pattern rule",
	);
	assert.ok(
		!sg.includes('rule[selector] = "allow"'),
		"no pattern-rule write remains in saveAllowAlways",
	);
	assert.ok(
		sg.includes("effective.grants") && sg.includes("sessionAllow.has(k)"),
		"hasGrant consults session + persisted grants",
	);
	assert.ok(
		sg.includes("if (!bash || bash.gate.allow) return;"),
		"bash rule-allows are bound by the compound gate (FR-9)",
	);
	assert.ok(
		sg.includes('eff.tier === "read-only"') &&
			sg.includes('eff.tier === "auto-approve"') &&
			sg.includes('eff.tier === "yolo"'),
		"mode-induced allows bypass the compound gate (no prompts)",
	);
	assert.ok(eng.includes('"grants"'), "engine validates the grants key");
	ok(
		"C7 refinement: grants write path + FR-9 binding gate + mode-tier bypass (# FR-9/13)",
	);
}

// ---- FR-15 — headless composition ---------------------------------------------

{
	assert.ok(sg.includes("!ctx.hasUI"), "headless branch present");
	assert.ok(
		sg.includes('effective.nonInteractive === "block"'),
		"nonInteractive gate kept",
	);
	ok("headless (print/json) keeps the nonInteractive policy (# FR-15)");
}

// ---- wire contract preserved ---------------------------------------------------

{
	for (const label of [
		"Allow once",
		"Allow for this session",
		"Allow always (save to config)",
		"Deny",
	]) {
		assert.ok(sg.includes(`"${label}"`), `label present: ${label}`);
	}
	assert.ok(
		idx.includes("ASK_MARKER"),
		"ask bridge marker unchanged (index.ts untouched apart from the type comment)",
	);
	ok(
		"safeguard label wire contract intact (# FR-39 preview, C11 will lock the IDE side)",
	);
}

console.log(`\nsafeguard-contract.test.js — C5: ${passed} passed`);
