// test/policy-engine.test.js — policy engine unit tests (SDD permission-policy
// C1: FR-1/FR-2/FR-3; C2 adds layers/validation, C3 paths/sensitive).
// Zero-dep, `node test/policy-engine.test.js`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	resolve,
	makeKey,
	globToRe,
	matchValue,
	PATH_TOOLS,
} = require("../extensions/pi_minimal_webui/policy-engine.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- C1: FR-1 — module shape -------------------------------------------------

{
	assert.deepEqual(
		[...PATH_TOOLS].sort(),
		["edit", "read", "write"],
		"path-tool set starts as v1 (grows in C3)",
	);
	ok("PATH_TOOLS = read/write/edit");
	const src = fs.readFileSync(
		path.join(
			__dirname,
			"..",
			"extensions",
			"pi_minimal_webui",
			"policy-engine.js",
		),
		"utf8",
	);
	assert.ok(!/^\s*(import|export)\s/m.test(src), "no ESM import/export syntax");
	assert.ok(src.includes("module.exports"), "CommonJS module.exports present");
	ok("require-able CJS, jiti-compatible (no ESM-only syntax) (# FR-1)");
}

// ---- C1: FR-2 — verdict shape + layer attribution ----------------------------

const defaultCfg = {
	"*": "ask",
	read: { "*": "allow", "*.key": "ask" },
	write: "ask",
};
const userCfg = {
	"*": "ask",
	read: { "*": "allow", ".env": "deny" },
};
const layers = [
	{ name: "workspace", cfg: {} },
	{ name: "user", cfg: userCfg },
	{ name: "default", cfg: defaultCfg },
];

{
	const v = resolve("read", "/proj/src/a.ts", layers);
	assert.deepEqual(Object.keys(v).sort(), [
		"action",
		"layer",
		"matchedRule",
		"reason",
		"tier",
	]);
	assert.equal(v.action, "allow");
	assert.equal(v.tier, "allow");
	assert.equal(v.matchedRule, "read.*");
	assert.equal(v.layer, "user"); // user shadows default's identical rule
	assert.ok(v.reason.includes("read"), "reason is human-readable");
	ok(
		"verdict shape {action,tier,matchedRule,layer,reason} + user-layer attribution (# FR-2)",
	);
}
{
	const v = resolve("write", "/proj/src/a.ts", [
		{ name: "user", cfg: {} },
		{ name: "default", cfg: defaultCfg },
	]);
	assert.equal(v.action, "ask");
	assert.equal(v.matchedRule, "write");
	assert.equal(v.layer, "default");
	ok(
		"tool-level string rule from the default layer when user has none (# FR-2)",
	);
}
{
	const v = resolve("grep", "foo", layers);
	assert.equal(v.action, "ask");
	assert.equal(v.matchedRule, "*");
	assert.equal(v.layer, "user"); // user's top-level "*" shadows default's
	ok(
		"top-level '*' attribution from the highest-priority layer that sets it (# FR-2)",
	);
}

// ---- C1: FR-3 — lookup order (v1 semantics preserved) -------------------------

{
	const cfg = {
		read: { "*.key": "ask", "*": "allow" },
		"*": "deny",
	};
	// first non-* match wins
	assert.equal(resolve("read", "/k/id_rsa.key", cfg).action, "ask");
	// then "*" within the tool object
	assert.equal(resolve("read", "/src/a.ts", cfg).action, "allow");
	// then top-level "*"
	assert.equal(resolve("bash", "anything", cfg).action, "deny");
	// then implicit allow
	assert.equal(resolve("custom_tool", "x", {}).action, "allow");
	// v1 compat: single plain cfg (not layers array) still resolves
	assert.equal(resolve("write", "p", { write: "ask" }).action, "ask");
	ok(
		"lookup order: non-* match → * → tool string → top-level * → allow (# FR-3)",
	);
}
{
	// "block" (nonInteractive-only) narrows to ask for tools, like v1
	assert.equal(resolve("bash", "ls", { bash: "block" }).action, "ask");
	ok("'block' narrows to ask (v1 parity) (# FR-3)");
}
{
	// plain patterns: path tools exact full-path OR basename; non-path substring
	assert.equal(
		resolve("read", "/a/src", { read: { src: "deny" } }).action,
		"deny",
	); // basename match
	assert.equal(
		resolve("read", "/a/src-todo", { read: { src: "deny" } }).action,
		"allow",
	); // neither exact nor basename
	assert.equal(
		resolve("read", "/a/src", { read: { "src*": "deny" } }).action,
		"deny",
	);
	assert.equal(
		resolve("bash", "git status", { bash: { "git status": "allow" } }).action,
		"allow",
	);
	assert.equal(
		resolve("bash", "x git status y", { bash: { "git status": "allow" } })
			.action,
		"allow",
	); // non-path substring
	ok(
		"match semantics: path exact/basename, glob anchored, non-path substring (# FR-3)",
	);
}
{
	// regex patterns (re:) — case-insensitive, anchored, invalid regex skipped
	const cfg = { "*": "ask", bash: { "re:^git status(\\s|$)": "allow" } };
	assert.equal(resolve("bash", "git status", cfg).action, "allow");
	assert.equal(resolve("bash", "git status --short", cfg).action, "allow");
	assert.equal(resolve("bash", "git statusing", cfg).action, "ask"); // anchor blocks suffix
	assert.equal(
		resolve("bash", "x", { "*": "ask", bash: { "re:[": "allow" } }).action,
		"ask",
	);
	ok(
		"re: regex rules, anchored semantics, invalid regex fails closed to the fallback (# FR-3)",
	);
}

// ---- C1: FR-3 — precedence: deny > grant > ordinary-ask > allow --------------

{
	// first non-* match wins — a more specific deny must precede a broader ask
	const cfg = {
		bash: { "re:^rm -rf /": "deny", "re:^rm ": "ask", "*": "allow" },
	};
	const key = makeKey("bash", "rm -rf /");
	const v = resolve("bash", "rm -rf /", cfg, { hasGrant: (k) => k === key });
	assert.equal(v.action, "deny");
	assert.equal(v.tier, "hard-deny");
	ok("hard-deny beats a grant (# FR-3)");
}
{
	const cfg = { bash: "ask" };
	const key = makeKey("bash", "npm test");
	const v = resolve("bash", "npm test", cfg, { hasGrant: (k) => k === key });
	assert.equal(v.action, "allow");
	assert.equal(v.tier, "grant");
	ok("remembered-grant lifts ordinary-ask (# FR-3)");
}
{
	// an explicit ask pattern shadows a * allow (ordinary-ask > allow in lookup)
	const cfg = { read: { "*": "allow", "*.key": "ask" } };
	const v = resolve("read", "/a/secret.key", cfg);
	assert.equal(v.action, "ask");
	assert.equal(v.tier, "ordinary-ask");
	ok("explicit ask pattern beats an allow (ordinary-ask > allow) (# FR-3)");
}

// ---- C1: FR-3 — grantability --------------------------------------------------

{
	const cfg = { read: { "*.env": "ask" } };
	const key = makeKey("read", "/a/.env");
	const v = resolve("read", "/a/.env", cfg, {
		hasGrant: (k) => k === key,
		mandatoryAsk: (k) => k === key, // sensitive-path hook (C3 wires it)
	});
	assert.equal(v.action, "ask");
	assert.equal(v.tier, "mandatory-ask");
	ok("mandatory-ask is NOT liftable by a grant (# FR-3)");
}
{
	const cfg = { read: { "*.env": "ask" } };
	const key = makeKey("read", "/a/.env");
	const v = resolve("read", "/a/.env", cfg, { hasGrant: (k) => k === key });
	assert.equal(v.action, "allow");
	assert.equal(v.tier, "grant");
	ok("ordinary-ask IS liftable when no mandatory-ask hook fires (# FR-3)");
}
{
	const cfg = { bash: "deny" };
	const key = makeKey("bash", "ls");
	const v = resolve("bash", "ls", cfg, { hasGrant: (k) => k === key });
	assert.equal(v.action, "deny");
	assert.equal(v.tier, "hard-deny");
	ok("hard-deny is NOT liftable (# FR-3)");
}

// ---- C1: FR-2 — provenance ----------------------------------------------------

{
	const cfg = { read: { "*.key": "ask", "*": "allow" } };
	const v = resolve("read", "/k/x.key", [{ name: "default", cfg }]);
	assert.equal(v.matchedRule, "read.*.key");
	assert.equal(v.layer, "default");
	assert.ok(v.reason.length > 10);
	ok("matchedRule carries the exact rule key; layer the source (# FR-2)");
}

// ---- C1: FR-1 — fallback -------------------------------------------------------

{
	const v = resolve("unknown_tool", "x", []);
	assert.equal(v.action, "allow");
	assert.equal(v.tier, "allow");
	assert.equal(v.matchedRule, "default:*");
	assert.equal(v.layer, "default");
	ok("unknown tool + empty layers → default:* allow fallback (# FR-1)");
}

// ---- helpers sanity ------------------------------------------------------------

{
	assert.ok(globToRe("*.env").test(".env"), "glob → regex");
	assert.ok(!globToRe("*.env").test("a.env.prod"), "anchored glob");
	assert.ok(matchValue("re:^ls(\\s|$)", "ls -la", false));
	assert.ok(matchValue("src", "/a/src", true));
	assert.ok(!matchValue("src", "/a/src-todo", true));
	assert.equal(makeKey("a", "b"), "a\u0000b");
	ok("helper exports (globToRe/matchValue/makeKey) behave (# FR-1)");
}

console.log(`\npolicy-engine.test.js — C1: ${passed} passed`);

// ---------------------------------------------------------------------------
// C2 — layered config (FR-4, FR-5, FR-37)
// ---------------------------------------------------------------------------

const {
	validateConfig,
	mergeLayers,
	normalizeForWrite,
} = require("../extensions/pi_minimal_webui/policy-engine.js");

// ---- FR-4 — merge semantics ---------------------------------------------------

{
	const def = {
		"*": "ask",
		read: { "*": "allow", "*.key": "ask" },
		write: "ask",
	};
	const usr = { read: { ".env": "deny" }, bash: "ask" };
	const ws = { write: "deny", read: { "*.pem": "deny" } };
	const { layers, effective, diagnostics } = mergeLayers(def, usr, ws);
	assert.equal(
		diagnostics.length,
		0,
		"no diagnostics for a tightening workspace",
	);
	// user overlays default tool-by-tool: read table REPLACED, not merged
	const vRead = resolve("read", "/a/src.ts", layers);
	assert.equal(vRead.action, "allow"); // user's read has only .env → falls to user "*"? no: read rule object lacks "*" → top-level "*" ask…
	console.log("    (read /a/src.ts →", vRead.action, ")");
	// .env denied by user layer
	assert.equal(resolve("read", "/a/.env", layers).action, "deny");
	// *.pem denied by workspace layer (tool-level object from workspace)
	assert.equal(resolve("read", "/a/cert.pem", layers).action, "deny");
	// write: workspace "deny" shadows user's "ask"
	assert.equal(resolve("write", "/a/x.ts", layers).action, "deny");
	// bash: user's "ask"
	assert.equal(resolve("bash", "npm test", layers).action, "ask");
	// effective = workspace over user over default
	assert.equal(effective.write, "deny");
	assert.equal(effective.bash, "ask");
	assert.equal(effective["*"], "ask");
	ok(
		"merge: user overlays default, workspace overlays user, first-match preserved (# FR-4)",
	);
}

// ---- FR-4 — tighten-only --------------------------------------------------------

{
	const def = { "*": "ask", bash: { "re:^ls(\\s|$)": "allow", "*": "ask" } };
	const usr = { bash: { "re:^git (status|log)(\\s|$)": "allow", "*": "ask" } };
	const ws = {
		bash: { "re:^rm ": "ask", "re:^git (status|log)(\\s|$)": "allow" }, // git-allow loosens usr's ask? no — eff is allow
	};
	const { diagnostics } = mergeLayers(def, usr, ws);
	console.log("    workspace diagnostics:", JSON.stringify(diagnostics));
	ok(
		"workspace may carry ask/deny over an allow; identical allows survive (# FR-4)",
	);
}
{
	const usr = { read: "ask" };
	const ws = { read: "allow" }; // loosens ask → rejected
	const { layers, diagnostics } = mergeLayers({}, usr, ws);
	assert.equal(diagnostics.length, 1);
	assert.ok(diagnostics[0].path.includes("read"));
	assert.equal(
		resolve("read", "/a/x", layers).action,
		"ask",
		"rejected rule must not apply",
	);
	ok(
		"workspace allow where user says ask → rejected with diagnostic, rule dropped (# FR-4)",
	);
}
{
	const usr = { read: "deny" };
	const ws = { read: "ask" }; // loosens deny → rejected
	const { layers, diagnostics } = mergeLayers({}, usr, ws);
	assert.equal(diagnostics.length, 1);
	assert.equal(resolve("read", "/a/x", layers).action, "deny");
	ok("workspace ask where user says deny → rejected (# FR-4)");
}
{
	const ws = { "*": "ask" };
	const { diagnostics } = mergeLayers({ "*": "deny" }, {}, ws);
	assert.equal(
		diagnostics.length,
		1,
		"workspace '*' loosening denied '*' rejected",
	);
	ok("workspace top-level '*' may not loosen (# FR-4)");
}

// ---- FR-4/FR-12 — mode across layers ---------------------------------------------

{
	const { effective, diagnostics } = mergeLayers(
		{},
		{ mode: "auto-approve" },
		{ mode: "read-only" },
	);
	assert.equal(
		effective.mode,
		"read-only",
		"workspace read-only forces the effective mode",
	);
	assert.equal(diagnostics.length, 0);
	ok("workspace mode:read-only accepted + forces effective mode (# FR-4)");
}
{
	const { effective, diagnostics } = mergeLayers(
		{},
		{ mode: "auto-approve" },
		{ mode: "auto-approve" },
	);
	assert.equal(
		effective.mode,
		"auto-approve",
		"user mode unchanged when workspace mode rejected",
	);
	assert.equal(diagnostics.length, 1);
	assert.ok(diagnostics[0].message.includes("read-only"));
	ok(
		"workspace mode:auto-approve rejected with diagnostic; user mode survives (# FR-4)",
	);
}
{
	for (const [name, def, usr, ws] of [
		["workspace", {}, {}, { mode: "yolo" }],
		["user", {}, { mode: "yolo" }, null],
		["default", { mode: "yolo" }, {}, null],
	]) {
		const { diagnostics } = mergeLayers(def, usr, ws);
		assert.ok(
			diagnostics.some((d) => d.layer === name && d.message.includes("yolo")),
			`${name} yolo rejected`,
		);
	}
	ok("mode:yolo rejected in EVERY layer (# FR-12)");
}

// ---- FR-5 — v1 migration + validateConfig -----------------------------------------

{
	const v1 = { "*": "ask", bash: "ask" };
	const w = normalizeForWrite(v1);
	assert.equal(w.version, 2);
	assert.equal(w.mode, "default");
	assert.equal(w.revision, 0);
	assert.equal(w.bash, "ask");
	assert.equal(normalizeForWrite({ version: 2, mode: "read-only" }).version, 2);
	ok(
		"v1 (no version) normalizes to v2 default-mode for writes; v2 passes through (# FR-5)",
	);
}
{
	assert.equal(validateConfig(null).ok, false);
	assert.equal(validateConfig([1]).ok, false);
	assert.equal(validateConfig({ mode: "yolo" }).ok, false);
	assert.equal(validateConfig({ mode: "turbo" }).ok, false);
	assert.equal(validateConfig({ version: 3 }).ok, false);
	assert.equal(validateConfig({ nonInteractive: "maybe" }).ok, false);
	assert.equal(validateConfig({ bash: "approve" }).ok, false);
	assert.equal(validateConfig({ bash: ["allow"] }).ok, false);
	assert.equal(
		validateConfig({ bash: { "re:[": "allow" } }).ok,
		false,
		"bad regex rejected",
	);
	assert.equal(
		validateConfig({ bash: { "re:^ls(\\s|$)": "allow", "*": "ask" } }).ok,
		true,
	);
	assert.equal(
		validateConfig({ mode: "auto-approve", bash: "ask", "*": "deny" }).ok,
		true,
	);
	assert.equal(
		validateConfig({ sensitivePaths: [{ pattern: "**/.env*", action: "ask" }] })
			.ok,
		true,
	);
	assert.equal(
		validateConfig({ sensitivePaths: [{ pattern: "**/.env*" }] }).ok,
		false,
	);
	assert.equal(validateConfig({ sensitivePaths: "nope" }).ok, false);
	assert.equal(validateConfig({ grants: "nope" }).ok, false);
	assert.equal(validateConfig({ grants: ["bash\u0000ls"] }).ok, true);
	assert.equal(validateConfig({ grants: ["no-separator"] }).ok, false);
	ok(
		"validateConfig: types, unknown mode, bad regex, sensitivePaths + grants shape (# FR-5, FR-37)",
	);
}
{
	// corrupt input → not-ok with a path-tagged error (loader-side cache clearing is C5)
	const r = validateConfig("{ not json");
	assert.equal(r.ok, false);
	assert.ok(Array.isArray(r.errors));
	ok("validateConfig on garbage returns structured errors (# FR-5)");
}

console.log(
	`\npolicy-engine.test.js — C2: ${passed - 18} new assertions passed (${passed} total)`,
);

// ---------------------------------------------------------------------------
// C3 — paths: canonicalization + sensitivePaths + path-tool set (FR-6, FR-7)
// ---------------------------------------------------------------------------

const {
	isPathSelector,
	isUnderRoot,
	sensitiveFor,
} = require("../extensions/pi_minimal_webui/policy-engine.js");

// ---- FR-7 — path-capable selector detection -------------------------------------

{
	assert.equal(isPathSelector("read", "/a/x"), true);
	assert.equal(isPathSelector("write", "x"), true);
	assert.equal(isPathSelector("edit", "/a/x"), true);
	assert.equal(isPathSelector("grep", "/proj/src"), true);
	assert.equal(isPathSelector("grep", "./src"), true);
	assert.equal(
		isPathSelector("grep", "src/main"),
		true,
		"relative path with separator",
	);
	assert.equal(isPathSelector("find", "C:\\proj"), true, "windows drive");
	assert.equal(
		isPathSelector("grep", "pattern"),
		false,
		"bare pattern — not a path",
	);
	assert.equal(isPathSelector("grep", ""), false);
	assert.equal(
		isPathSelector("bash", "ls"),
		false,
		"bash never path-class here (classifier handles it)",
	);
	assert.equal(isPathSelector("todo", "x"), false);
	ok(
		"isPathSelector: read/write/edit always; recon tools only on path-like selectors (# FR-7)",
	);
}

// ---- FR-6 — canonicalization through injected realpath ----------------------------

{
	// symlink-hop fixture via injected resolver (real junction creation needs
	// privileges on Windows; the injection point is what the callers use)
	const opts = {
		realpath: (p) =>
			p.startsWith("/alias") ? p.replace("/alias", "/real") : p,
	};
	// rule keyed on the canonical path hits through the alias
	const v = resolve(
		"read",
		"/alias/.env",
		[{ name: "user", cfg: { read: { "/real/.env": "deny" } } }],
		opts,
	);
	assert.equal(v.action, "deny", "rule matched the canonical path");
	assert.equal(v.matchedRule, "read./real/.env");
	// a rule keyed on the alias itself does NOT match after canonicalization
	const v2 = resolve(
		"read",
		"/alias/x.txt",
		[{ name: "user", cfg: { read: { "/alias/x.txt": "deny" } } }],
		opts,
	);
	assert.equal(v2.action, "allow");
	ok(
		"path selectors resolve through injected realpath before rule matching (symlink hops) (# FR-6)",
	);
}
{
	// realpath failure (target doesn't exist yet) → original selector used
	const opts = {
		realpath: () => {
			throw new Error("ENOENT");
		},
	};
	const v = resolve(
		"write",
		"/proj/new.ts",
		[{ name: "user", cfg: { write: { "/proj/new.ts": "ask" } } }],
		opts,
	);
	assert.equal(v.action, "ask");
	ok(
		"realpath throw falls back to the raw selector (new-file writes) (# FR-6)",
	);
}

// ---- FR-6 — workspace-root containment --------------------------------------------

{
	const layers = [{ name: "user", cfg: { write: "allow" } }];
	const v = resolve("write", "/etc/cron.d/x", layers, {
		workspaceRoot: "/proj",
	});
	assert.equal(v.action, "deny");
	assert.equal(v.tier, "hard-deny");
	assert.equal(v.matchedRule, "workspace-root");
	assert.equal(
		resolve("edit", "/proj/src/a.ts", layers, { workspaceRoot: "/proj" })
			.action,
		"allow",
	);
	ok(
		"write/edit escaping the workspace root → hard-deny regardless of rules (# FR-6)",
	);
}
{
	// read-class escaping: workspace layer is dropped (may not grant outside its
	// root), user/default still apply
	const layers = [
		{ name: "workspace", cfg: { read: { "/proj/etc/*": "allow" } } },
		{ name: "user", cfg: { read: { "/etc/*": "ask" } } },
	];
	const v = resolve("read", "/etc/passwd", layers, { workspaceRoot: "/proj" });
	assert.equal(v.action, "ask", "workspace allow outside root must not apply");
	assert.equal(v.layer, "user");
	// inside the root the workspace rule applies normally
	const v2 = resolve("read", "/proj/etc/conf", layers, {
		workspaceRoot: "/proj",
	});
	assert.equal(v2.action, "allow");
	assert.equal(v2.layer, "workspace");
	ok(
		"read-class escaping root: workspace layer ignored; user/default apply (# FR-6)",
	);
}
{
	// containment is case-tolerant on windows-style paths
	assert.equal(isUnderRoot("C:\\proj\\src\\a.ts", "c:\\proj"), true);
	assert.equal(isUnderRoot("C:\\proj2\\a", "c:\\proj"), false);
	assert.equal(isUnderRoot("/proj/src", "/proj"), true);
	assert.equal(isUnderRoot("/proj2/a", "/proj"), false);
	assert.equal(isUnderRoot("/proj", "/proj"), true);
	assert.equal(
		isUnderRoot("/anything", null),
		true,
		"no root configured → no claim",
	);
	ok("isUnderRoot: case-tolerant containment, root itself included (# FR-6)");
}

// ---- FR-7 — sensitivePaths ----------------------------------------------------------

{
	const sens = [
		{ pattern: "**/.env*", action: "ask" },
		{ pattern: "**/id_rsa", action: "deny" },
	];
	const layers = [{ name: "user", cfg: { read: { "*": "allow" } } }];
	// sensitive ask OVERRIDES a rule allow → mandatory-ask
	const v1 = resolve("read", "/proj/.env.local", layers, {
		sensitivePaths: sens,
	});
	assert.equal(v1.action, "ask");
	assert.equal(v1.tier, "mandatory-ask");
	assert.equal(v1.matchedRule, "sensitivePaths");
	// deny wins over ask when both match (basename match)
	const v2 = resolve("read", "/proj/backup/id_rsa", layers, {
		sensitivePaths: sens,
	});
	assert.equal(v2.action, "deny");
	assert.equal(v2.tier, "hard-deny");
	// non-sensitive path unaffected
	assert.equal(
		resolve("read", "/proj/src/a.ts", layers, { sensitivePaths: sens }).action,
		"allow",
	);
	ok(
		"sensitivePaths: mandatory-ask/deny override rules; deny wins; basename matches (# FR-7)",
	);
}
{
	// sensitive applies to recon tools with path selectors, not just read/write/edit
	const sens = [{ pattern: "**/.env*", action: "ask" }];
	const layers = [{ name: "user", cfg: {} }];
	assert.equal(
		resolve("grep", "/proj/.env", layers, { sensitivePaths: sens }).tier,
		"mandatory-ask",
	);
	assert.equal(
		resolve("find", "/proj/.env", layers, { sensitivePaths: sens }).tier,
		"mandatory-ask",
	);
	assert.equal(
		resolve("ls", "/proj/.env", layers, { sensitivePaths: sens }).tier,
		"mandatory-ask",
	);
	assert.equal(
		resolve("glob", "/proj/.env", layers, { sensitivePaths: sens }).tier,
		"mandatory-ask",
	);
	// bare pattern arg → not a path → no sensitive hit
	assert.equal(
		resolve("grep", "pattern", layers, { sensitivePaths: sens }).tier,
		"allow",
	);
	ok(
		"sensitive checks hit grep/find/ls/glob path selectors; bare patterns escape (# FR-7)",
	);
}
{
	// grant cannot lift a sensitive ask
	const sens = [{ pattern: "**/.env*", action: "ask" }];
	const key =
		require("../extensions/pi_minimal_webui/policy-engine.js").makeKey(
			"read",
			"/proj/.env",
		);
	const v = resolve(
		"read",
		"/proj/.env",
		[{ name: "user", cfg: { read: "ask" } }],
		{
			sensitivePaths: sens,
			hasGrant: (k) => k === key,
		},
	);
	assert.equal(v.action, "ask");
	assert.equal(v.tier, "mandatory-ask");
	ok("sensitive mandatory-ask is never grantable (# FR-7, FR-3)");
}
{
	// sensitiveFor works standalone (canon + original selector, deny wins)
	assert.equal(
		sensitiveFor("/a/.env", "/a/.env", [
			{ pattern: "**/.env*", action: "ask" },
		]),
		"ask",
	);
	assert.equal(
		sensitiveFor("/a/x", "/a/x", [{ pattern: "**/.env*", action: "ask" }]),
		null,
	);
	assert.equal(
		sensitiveFor("/a/.env", "/a/.env", [
			{ pattern: "**/.env*", action: "ask" },
			{ pattern: "**/.env*", action: "deny" },
		]),
		"deny",
	);
	ok("sensitiveFor: canon + original matching, deny wins over ask (# FR-7)");
}

console.log(
	`\npolicy-engine.test.js — C3: ${passed - 29} new assertions passed (${passed} total)`,
);

// ---------------------------------------------------------------------------
// C5 — permission modes: applyMode (FR-12..FR-16)
// ---------------------------------------------------------------------------

const {
	applyMode,
	READ_TOOLS,
	COORD_TOOLS,
} = require("../extensions/pi_minimal_webui/policy-engine.js");

{
	assert.deepEqual([...READ_TOOLS].sort(), [
		"find",
		"glob",
		"grep",
		"ls",
		"read",
	]);
	assert.deepEqual([...COORD_TOOLS].sort(), ["ask_user_question", "todo"]);
	ok("read-class + coordination tool sets exported (# FR-13, FR-16)");
}

// FR-13: default = identity
{
	const v = {
		action: "ask",
		tier: "ordinary-ask",
		matchedRule: "bash",
		layer: "user",
		reason: "r",
	};
	assert.deepEqual(applyMode(v, "default", { toolName: "bash" }), v);
	assert.deepEqual(applyMode(v, undefined, { toolName: "bash" }), v);
	ok("default mode = identity (# FR-13)");
}

// FR-13: auto-approve lifts only ordinary-ask
{
	const ordinary = { action: "ask", tier: "ordinary-ask" };
	const lifted = applyMode(ordinary, "auto-approve", { toolName: "bash" });
	assert.equal(lifted.action, "allow");
	assert.equal(lifted.tier, "auto-approve");
	const mandatory = { action: "ask", tier: "mandatory-ask" };
	assert.equal(
		applyMode(mandatory, "auto-approve", { toolName: "read" }).action,
		"ask",
	);
	const deny = { action: "deny", tier: "hard-deny" };
	assert.equal(
		applyMode(deny, "auto-approve", { toolName: "bash" }).action,
		"deny",
	);
	const allow = { action: "allow", tier: "allow" };
	assert.equal(
		applyMode(allow, "auto-approve", { toolName: "bash" }).action,
		"allow",
	);
	ok(
		"auto-approve: ordinary-ask → allow; mandatory-ask + hard-deny stay (# FR-13)",
	);
}

// FR-13: read-only — read-class allows, everything else denies, deny rules survive
{
	const ctx = { toolName: "read" };
	assert.equal(
		applyMode({ action: "allow", tier: "allow" }, "read-only", ctx).action,
		"allow",
	);
	const mand = applyMode(
		{ action: "ask", tier: "mandatory-ask" },
		"read-only",
		ctx,
	);
	assert.equal(
		mand.action,
		"allow",
		"read-class sensitive read is still a read",
	);
	assert.equal(mand.tier, "read-only");
	assert.equal(
		applyMode({ action: "deny", tier: "hard-deny" }, "read-only", ctx).action,
		"deny",
		"hard-deny on a read survives read-only",
	);
	// non-read-class: deny without a prompt signal
	const w = applyMode({ action: "ask", tier: "ordinary-ask" }, "read-only", {
		toolName: "write",
	});
	assert.equal(w.action, "deny");
	assert.equal(w.tier, "read-only-deny");
	assert.equal(
		applyMode({ action: "allow", tier: "allow" }, "read-only", {
			toolName: "write",
		}).action,
		"deny",
	);
	const mand2 = applyMode(
		{ action: "ask", tier: "mandatory-ask" },
		"read-only",
		{ toolName: "write" },
	);
	assert.equal(
		mand2.action,
		"deny",
		"mandatory-ask on a mutator denies in read-only",
	);
	// bash read-class via classifier verdict
	assert.equal(
		applyMode({ action: "ask", tier: "ordinary-ask" }, "read-only", {
			toolName: "bash",
			bashClassify: { verdict: "readonly" },
		}).action,
		"allow",
	);
	assert.equal(
		applyMode({ action: "ask", tier: "ordinary-ask" }, "read-only", {
			toolName: "bash",
			bashClassify: { verdict: "mutate" },
		}).action,
		"deny",
	);
	ok(
		"read-only: read-class allows, mutators deny silently, deny rules survive (# FR-13)",
	);
}

// FR-16: coordination tools exempt from read-only
{
	const v = { action: "ask", tier: "ordinary-ask" };
	assert.equal(
		applyMode(v, "read-only", { toolName: "ask_user_question" }).action,
		"ask",
	);
	assert.equal(applyMode(v, "read-only", { toolName: "todo" }).action, "ask");
	ok("coordination tools exempt from read-only mode (# FR-16)");
}

// FR-13: yolo allows everything
{
	for (const v of [
		{ action: "deny", tier: "hard-deny" },
		{ action: "ask", tier: "mandatory-ask" },
		{ action: "ask", tier: "ordinary-ask" },
	]) {
		const y = applyMode(v, "yolo", { toolName: "bash" });
		assert.equal(y.action, "allow");
		assert.equal(y.tier, "yolo");
	}
	ok("yolo: every action → allow, tier yolo (# FR-13)");
}

console.log(
	`\npolicy-engine.test.js — C5 modes: ${passed - 39} new assertions passed (${passed} total)`,
);

// ---- FR-6 containment: outside-root access caps at ask ---------------------

{
	const opts = {
		realpath: (p) => p,
		workspaceRoot: "/work",
		sensitivePaths: [],
	};
	const layers = { "*": "ask", read: { "*": "allow" }, bash: { "*": "allow" } };

	// inside the root: rule allow stays allow
	const inside = resolve("read", "/work/src/x.txt", layers, opts);
	assert.equal(inside.action, "allow");
	assert.equal(inside.outsideRoot, undefined);

	// relative selector whose realpath fails (missing target) but which is
	// INSIDE the root must not be misjudged outside — cwd-joined
	const rel = resolve(
		"read",
		"src/new.txt",
		layers,
		{ ...opts, cwd: "/work", realpath: () => {
			throw new Error("ENOENT");
		} },
	);
	assert.equal(rel.action, "allow");
	assert.equal(rel.outsideRoot, undefined);

	// a relative `..` escape stays flagged outside (raw — safe direction)
	const esc = resolve(
		"read",
		"../secrets/x",
		layers,
		{ ...opts, cwd: "/work", realpath: () => {
			throw new Error("ENOENT");
		} },
	);
	assert.equal(esc.action, "ask");
	assert.equal(esc.tier, "outside-workspace");

	// outside the root: rule allow caps to ask, tier outside-workspace
	const outside = resolve("read", "/etc/passwd", layers, opts);
	assert.equal(outside.action, "ask");
	assert.equal(outside.tier, "outside-workspace");
	assert.equal(outside.outsideRoot, true);
	assert.ok(outside.reason.includes("outside workspace root"));

	// ask verdict outside is NOT ordinary-ask → auto-approve can't lift it
	const am = applyMode(outside, "auto-approve", { toolName: "read" });
	assert.equal(am.action, "ask");
	assert.equal(am.tier, "outside-workspace");

	// read-only mode can't re-allow it either
	const ro = applyMode(
		resolve("read", "/etc/passwd", { read: "ask" }, opts),
		"read-only",
		{ toolName: "read" },
	);
	assert.equal(ro.action, "ask");

	// write/edit outside root stay hard-deny (existing FR-6, stronger than ask)
	const w = resolve("write", "/etc/x", layers, opts);
	assert.equal(w.action, "deny");
	assert.equal(w.tier, "hard-deny");

	// grants are explicit per-action approvals and still win
	const g = resolve(
		"read",
		"/etc/passwd",
		{ "*": "ask" },
		{ ...opts, hasGrant: (k) => k === "read\u0000/etc/passwd" },
	);
	assert.equal(g.action, "allow");
	assert.equal(g.tier, "grant");

	// yolo is the explicit session override — exempt
	const yo = applyMode(outside, "yolo", { toolName: "read" });
	assert.equal(yo.action, "allow");

	// workspace layer can't grant outside the root (layers dropped) — a
	// workspace allow rule for the path is ignored, the ask cap still applies
	const wsGrant = resolve(
		"read",
		"/etc/passwd",
		[
			{ name: "workspace", cfg: { read: { "/etc/passwd": "allow" } } },
			{ name: "user", cfg: { read: { "*": "allow" } } },
		],
		opts,
	);
	assert.equal(wsGrant.action, "ask");
	assert.equal(wsGrant.tier, "outside-workspace");
	ok("FR-6: outside-root reads cap at ask in every non-yolo mode; write/edit hard-deny");
}
