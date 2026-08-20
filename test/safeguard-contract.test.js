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
	assert.ok(
		sg.includes("const mode = sessionYolo"),
		"runtime yolo feeds the mode",
	);
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

// ---- SEC-02b — mode-induced bash allows require the per-part gate -----------

{
	// the gate hands bashGate to applyMode so read-only bash can't ride the
	// classifier label alone (env rm -rf . / find . -delete / sed -i …)
	assert.ok(
		sg.includes("bashGate: bash ? bash.gate : null"),
		"applyMode receives the per-part gate for bash (SEC-02b)",
	);
	// engine side: read-only read-class for bash requires verdict AND gate
	assert.ok(
		eng.includes("ctx.bashGate &&") && eng.includes("ctx.bashGate.allow"),
		"engine read-only bash read-class requires bashGate.allow (SEC-02b)",
	);
	// engine side: auto-approve never lifts a bash ask when the gate blocks
	assert.ok(
		eng.includes(
			'ctx.toolName === "bash" && ctx.bashGate && !ctx.bashGate.allow',
		),
		"auto-approve bash blocked by the gate stays ask (SEC-02b)",
	);
	ok(
		"SEC-02b: mode transforms are bound by the per-part bash gate (# SEC-02b)",
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

// ---- SEC-15 — fail-closed config + atomic writes (behavioral, real tmp dirs) -------
// Node 24 type-strips the .ts; we drive the REAL gate with a mock pi API and a
// temp HOME/workspace, so these exercise readCfgOrEmpty/loadLayers/saveConfig.

const os = require("node:os");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sg15-"));

(async () => {
	/** Load a FRESH safeguard instance pinned to temp HOME (+ optional workspace). */
	function freshSafeguard({ userCfg, wsCfg, userDirAsFile = false }) {
		const home = fs.mkdtempSync(path.join(tmpRoot, "home-"));
		const agentDir = path.join(home, ".pi", "agent");
		if (userDirAsFile) {
			fs.mkdirSync(path.join(home, ".pi"));
			fs.writeFileSync(agentDir, "i am a file, not a dir");
		} else {
			fs.mkdirSync(agentDir, { recursive: true });
			if (userCfg !== undefined)
				fs.writeFileSync(
					path.join(agentDir, "safeguard.json"),
					JSON.stringify(userCfg),
				);
		}
		const workspace = fs.mkdtempSync(path.join(tmpRoot, "ws-"));
		if (wsCfg !== undefined) {
			fs.mkdirSync(path.join(workspace, ".pi"));
			fs.writeFileSync(
				path.join(workspace, ".pi", "safeguard.json"),
				typeof wsCfg === "string" ? wsCfg : JSON.stringify(wsCfg),
			);
		}
		const oldHome = process.env.HOME;
		const oldUser = process.env.USERPROFILE;
		const oldCwd = process.cwd();
		process.env.HOME = home;
		process.env.USERPROFILE = home;
		process.chdir(workspace);
		// Node 24's type-stripping loader keeps a per-file cache that survives
		// require.cache deletion, so re-requiring safeguard.ts would NOT re-run
		// with the new HOME (CONFIG_PATH would point at the previous scenario's
		// home). Copy the module to a per-scenario filename → distinct cache key
		// → a genuinely fresh instance per scenario.
		const copyPath = path.join(
			ROOT,
			"extensions",
			"pi_minimal_webui",
			`safeguard-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
		);
		fs.copyFileSync(
			path.join(ROOT, "extensions", "pi_minimal_webui", "safeguard.ts"),
			copyPath,
		);
		const factory = require(copyPath).default;
		const handlers = {};
		let selectResult = null;
		let selectCalls = 0;
		const notified = [];
		const pi = {
			on: (ev, fn) => (handlers[ev] = fn),
			registerCommand: () => {},
		};
		factory(pi);
		const ctx = (hasUI) => ({
			hasUI,
			ui: {
				notify: (m, lvl) => notified.push({ m, lvl }),
				select: async () => {
					selectCalls++;
					return selectResult;
				},
				setStatus: () => {},
			},
		});
		return {
			handlers,
			ctx,
			get notified() {
				return notified;
			},
			setSelect: (r) => (selectResult = r),
			get selectCalls() {
				return selectCalls;
			},
			home,
			workspace,
			agentDir,
			copyPath,
			restore() {
				try {
					fs.unlinkSync(copyPath);
				} catch {}
				process.env.HOME = oldHome;
				process.env.USERPROFILE = oldUser;
				process.chdir(oldCwd);
			},
		};
	}

	{
		// valid configs → no config-error warnings on a deny
		const s = freshSafeguard({
			userCfg: { bash: { "re:^evil$ (\\s|$)": "deny" } },
		});
		const out = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "evil" } },
			s.ctx(true),
		);
		assert.ok(out && out.block, "deny still blocks");
		assert.ok(
			!s.notified.some(
				(n) => n.lvl === "warning" && /config|safeguard\.json/i.test(n.m),
			),
			"no config-error warning on valid configs (# SEC-15a)",
		);
		s.restore();
	}

	{
		// malformed USER config after a good parse → last-known-good layer still
		// denies AND the error is surfaced
		const s = freshSafeguard({ userCfg: { bash: { "re:^evil$": "deny" } } });
		await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "ls" } },
			s.ctx(true),
		);
		fs.writeFileSync(path.join(s.agentDir, "safeguard.json"), "{not json");
		const out = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "evil" } },
			s.ctx(true),
		);
		assert.ok(
			out && out.block,
			"last-known-good user config still denies (# SEC-15a)",
		);
		assert.ok(
			s.notified.some(
				(n) => n.lvl === "warning" && /safeguard\.json/i.test(n.m),
			),
			"malformed user config surfaced as a warning (# SEC-15a)",
		);
		s.restore();
	}

	{
		// malformed WORKSPACE config (never parsed) → error surfaced, no silent
		// empty layer masquerading as a workspace decision
		const s = freshSafeguard({ wsCfg: "{broken" });
		await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "ls" } },
			s.ctx(true),
		);
		assert.ok(
			s.notified.some(
				(n) => n.lvl === "warning" && /safeguard\.json/i.test(n.m),
			),
			"malformed workspace config surfaced (# SEC-15a)",
		);
		s.restore();
	}

	{
		// missing configs → no warnings (normal cold start)
		const s = freshSafeguard({});
		await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "ls" } },
			s.ctx(true),
		);
		assert.ok(
			!s.notified.some((n) => n.lvl === "warning" && /config/i.test(n.m)),
			"missing files produce no config warnings (# SEC-15a)",
		);
		s.restore();
	}

	{
		// SEC-15b: successful ALLOW_ALWAYS → atomic replace, no temp leftover,
		// revision bumped, grant persisted, call released
		const s = freshSafeguard({ userCfg: {} });
		s.setSelect("Allow always (save to config)");
		const out = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "npm test" } },
			s.ctx(true),
		);
		assert.equal(
			out,
			undefined,
			"successful save releases the call (# SEC-15b)",
		);
		const saved = JSON.parse(
			fs.readFileSync(path.join(s.agentDir, "safeguard.json"), "utf8"),
		);
		assert.ok(
			Array.isArray(saved.grants) &&
				saved.grants.includes("bash\u0000npm test"),
			"grant persisted (# SEC-15b)",
		);
		assert.equal(saved.revision, 1, "revision bumped (# SEC-15b)");
		const leftovers = fs
			.readdirSync(s.agentDir)
			.filter((f) => f.includes(".tmp"));
		assert.equal(leftovers.length, 0, "no temp files left (# SEC-15b)");
		s.restore();
	}

	{
		// SEC-15b: save failure → ALLOW_ALWAYS blocks with a visible warning;
		// Allow once still releases; no session grant is recorded
		const s = freshSafeguard({ userDirAsFile: true });
		s.setSelect("Allow always (save to config)");
		const out = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "npm test" } },
			s.ctx(true),
		);
		assert.ok(out && out.block, "failed save blocks the call (# SEC-15b)");
		assert.ok(
			/save/i.test(out.reason),
			"reason names the failed save (# SEC-15b)",
		);
		assert.ok(
			s.notified.some((n) => n.lvl === "warning" && /save/i.test(n.m)),
			"save failure surfaced as a warning (# SEC-15b)",
		);
		// Allow once still works (no write needed)
		s.setSelect("Allow once");
		const out2 = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "npm test" } },
			s.ctx(true),
		);
		assert.equal(
			out2,
			undefined,
			"Allow once releases without a write (# SEC-15b)",
		);
		// failed always-save must not have session-allowed the command
		s.setSelect("Deny");
		const out3 = await s.handlers.tool_call(
			{ toolName: "bash", input: { command: "npm test" } },
			s.ctx(true),
		);
		assert.ok(
			out3 && out3.block,
			"no phantom session grant after failed save (# SEC-15b)",
		);
		s.restore();
	}

	console.log(`\nsafeguard-contract.test.js — C5: ${passed} passed`);
})().catch((e) => {
	console.error(e);
	process.exit(1);
});
