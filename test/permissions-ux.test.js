// test/permissions-ux.test.js — #permissions page pure helpers (SDD
// permission-policy C10: FR-30/31/32b/33/34/35). Zero-dep.
const assert = require("node:assert/strict");
const {
	buildLayerTree,
	applyRule,
	removeRule,
	ruleEditorMessages,
	redactSelector,
	explainView,
	modeState,
	permView,
	selectorExplain,
} = require("../public/permissions-ux.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// ---- FR-30 — layer tree ------------------------------------------------------

{
	const def = { "*": "ask", read: { "*": "allow" }, write: "ask" };
	const usr = { read: { ".env": "ask" } };
	const ws = { read: { "*.pem": "deny" } };
	const { tools, diagnostics } = buildLayerTree(def, usr, ws, [
		{ layer: "workspace", path: "x", message: "m" },
	]);
	assert.equal(tools.length, 2, "two tools, meta keys skipped");
	const read = tools.find((t) => t.tool === "read");
	assert.deepEqual(
		read.rules.find((r) => r.pattern === "*.pem").layers,
		["workspace"],
		"workspace-only rule carries its layer",
	);
	const env = read.rules.find((r) => r.pattern === ".env");
	assert.deepEqual(env.layers, ["user"], "user-only rule carries its layer");
	const star = read.rules.find((r) => r.pattern === "*");
	assert.deepEqual(
		star.layers,
		["default"],
		"default-only rule carries its layer",
	);
	assert.equal(read.fallback, "ask", "top-level * from the highest layer");
	assert.equal(diagnostics.length, 1, "diagnostics passed through");
	ok(
		"buildLayerTree: merged per-tool rules with per-rule layer badges (# FR-30)",
	);
}

// ---- FR-30 — action precedence: highest layer wins --------------------------

{
	const def = { read: { ".env": "ask" } };
	const usr = { read: { ".env": "deny" } };
	const { tools } = buildLayerTree(def, usr, {});
	const env = tools
		.find((t) => t.tool === "read")
		.rules.find((r) => r.pattern === ".env");
	assert.equal(env.action, "deny", "user override beats the floor's action");
	assert.deepEqual(
		env.layers,
		["user", "default"],
		"both layers still listed, highest first",
	);
	ok("buildLayerTree: shown action = highest-priority layer's action");
}

// ---- rule editor: applyRule / removeRule (user layer) -----------------------

{
	// add pattern rule to an empty config
	let r = applyRule({}, "bash", "re:^npm publish", "deny");
	assert.ok(r.ok);
	assert.deepEqual(r.config.bash, { "re:^npm publish": "deny" });
	// empty pattern → tool fallback "*"
	r = applyRule(r.config, "edit", "", "ask");
	assert.deepEqual(r.config.edit, { "*": "ask" });
	// add to an existing object keeps prior patterns
	r = applyRule(r.config, "bash", "re:^git push", "allow");
	assert.deepEqual(r.config.bash["re:^git push"], "allow");
	assert.equal(r.config.bash["re:^npm publish"], "deny");
	// string tool rule converts to object form (uniform editing)
	r = applyRule({ write: "ask" }, "write", "**/src/**", "deny");
	assert.deepEqual(r.config.write, { "*": "ask", "**/src/**": "deny" });
	// validation
	assert.ok(!applyRule({}, "mode", "x", "allow").ok, "meta key rejected");
	assert.ok(!applyRule({}, "", "x", "allow").ok, "empty tool rejected");
	assert.ok(!applyRule({}, "bash", "x", "bogus").ok, "bad effect rejected");
	// original config untouched (clone)
	const orig = { bash: { "re:^x": "allow" } };
	applyRule(orig, "bash", "re:^y", "deny");
	assert.deepEqual(orig, { bash: { "re:^x": "allow" } });
	ok("applyRule: add pattern/fallback rules to the user config");
}

{
	// remove a pattern rule; empty tool object collapses to no key
	let r = removeRule(
		{ bash: { "re:^x": "allow", "re:^y": "deny" } },
		"bash",
		"re:^x",
	);
	assert.ok(r.ok);
	assert.deepEqual(r.config.bash, { "re:^y": "deny" });
	r = removeRule(r.config, "bash", "re:^y");
	assert.deepEqual(r.config.bash, undefined, "empty tool object dropped");
	// remove a whole-tool (string) rule via its display form
	r = removeRule({ write: "ask" }, "write", "(tool default)");
	assert.deepEqual(r.config.write, undefined);
	// remove the "*" fallback key
	r = removeRule({ edit: { "*": "ask", x: "deny" } }, "edit", "*");
	assert.deepEqual(r.config.edit, { x: "deny" });
	// unknown tool → error, original untouched
	const cfg = { write: "ask" };
	r = removeRule(cfg, "nope", "(tool default)");
	assert.ok(!r.ok);
	assert.deepEqual(cfg, { write: "ask" }, "original untouched on failure");
	ok("removeRule: pattern/fallback/whole-tool removal, empty collapse");
}

// ---- FR-31/33 — editor validation messages -------------------------------------

{
	const rows = ruleEditorMessages({
		errors: [
			{ path: "mode", message: "yolo cannot be persisted" },
			{ path: "bash.re:[", message: "invalid regex" },
		],
	});
	assert.deepEqual(rows[0], {
		field: "mode",
		message: "yolo cannot be persisted",
		path: "mode",
	});
	assert.equal(rows[1].field, "bash", "field = first path segment");
	ok(
		"ruleEditorMessages: field/message rows from validateConfig output (# FR-31/33)",
	);
}

// ---- FR-34 — audit redaction ------------------------------------------------------

{
	const sens = [{ pattern: "**/.env*", action: "ask" }];
	assert.equal(
		redactSelector("/proj/.env.local", sens),
		"…/.env.local (sensitive)",
		"sensitive path → basename + marker",
	);
	assert.equal(
		redactSelector("/proj/src/a.ts", sens),
		"/proj/src/a.ts",
		"non-sensitive path unchanged",
	);
	const long = "x".repeat(500);
	assert.equal(
		redactSelector(long, null).length,
		402,
		"truncated at 400 + ellipsis",
	);
	assert.equal(redactSelector("", sens), "");
	ok(
		"redactSelector: basename-only for sensitive, 400-char truncation (# FR-34)",
	);
}

// ---- FR-35 — explain view ----------------------------------------------------------

{
	const v = explainView(
		{
			action: "ask",
			tier: "ordinary-ask",
			matchedRule: "bash.*",
			layer: "user",
			reason: "r",
		},
		{
			verdict: "mutate",
			parts: [
				{ cmd: "git status", readonly: true },
				{ cmd: "rm -rf ./src", readonly: false },
			],
		},
		{ allow: false, reason: "mutating command" },
	);
	assert.equal(v.autoAllowable, false);
	assert.equal(v.verdict, "mutate");
	assert.equal(v.parts.length, 2);
	assert.equal(v.parts[1].readonly, false);
	const allowed = explainView(
		{
			action: "allow",
			tier: "allow",
			matchedRule: "x",
			layer: "default",
			reason: "r",
		},
		{ verdict: "readonly", parts: [{ cmd: "git status", readonly: true }] },
		{ allow: true },
	);
	assert.equal(allowed.autoAllowable, true);
	ok("explainView: verdict + gate + per-part breakdown (# FR-35)");
}

// ---- FR-32b — mode state machine ----------------------------------------------------

{
	assert.deepEqual(modeState("default", "auto-approve"), {
		confirm: false,
		value: "auto-approve",
	});
	assert.deepEqual(
		modeState("default", "yolo"),
		{ confirm: true, value: "default" },
		"yolo needs confirm",
	);
	assert.deepEqual(modeState("default", "yolo", true), {
		confirm: false,
		value: "yolo",
	});
	assert.deepEqual(modeState("yolo", "read-only"), {
		confirm: false,
		value: "read-only",
	});
	ok("modeState: yolo confirm-gated, others pass through (# FR-32b)");
}

// ---- ui-density-navigation — prioritized view projection (FR-33..37) -------------

{
	const tree = buildLayerTree(
		{ bash: { "re:^npm test": "allow" }, read: "allow" },
		{ bash: { "re:^npm publish": "deny" }, write: { "*": "ask" } },
		{},
		[],
	);
	const view = permView(tree, {});
	assert.equal(view.counts.user, 2, "user-layer rules project as editable");
	assert.equal(view.counts.inherited, 2, "floor rules project as inherited");
	assert.ok(
		view.userRules.every((r) => r.editable && r.layers[0] === "user"),
		"editable rows carry user provenance (FR-35)",
	);
	assert.deepEqual(
		view.inheritedGroups.map((g) => g.tool),
		["bash", "read"],
		"inherited rules group by tool (FR-34)",
	);
	assert.equal(view.inheritedExpanded, false, "inherited starts collapsed");
	assert.equal(view.pendingCount, 0);

	const filtered = permView(tree, { filter: "PUBLISH" });
	assert.equal(filtered.counts.user, 1, "filter matches selector text (FR-36)");
	assert.equal(filtered.counts.inherited, 0);
	const byAction = permView(tree, { filter: "deny" });
	assert.equal(byAction.counts.user, 1, "filter matches action");
	const byLayer = permView(tree, { filter: "default" });
	assert.equal(byLayer.counts.inherited, 2, "filter matches layer");
	const none = permView(tree, { filter: "no-such-thing" });
	assert.equal(
		none.counts.user + none.counts.inherited,
		0,
		"no-match is explicit",
	);

	const pending = permView(tree, { filter: "no-such-thing", pendingCount: 2 });
	assert.equal(
		pending.pendingCount,
		2,
		"pending decisions ride along regardless of filter/collapse (FR-40)",
	);

	assert.equal(selectorExplain("re:^x"), "regex selector");
	assert.equal(selectorExplain("(tool default)"), "every call of this tool");
	assert.equal(selectorExplain("**/src/**"), "path glob selector");
	assert.equal(selectorExplain("C:\\Users\\x"), "path selector");
	assert.equal(selectorExplain(""), "", "unknown shapes get no explanation");

	const snapshot = JSON.stringify(tree);
	permView(tree, { filter: "x" });
	assert.equal(
		JSON.stringify(tree),
		snapshot,
		"projection never mutates (FR-59)",
	);
	ok("permView + selectorExplain: priority, grouping, filter, provenance");
}

console.log(`\npermissions-ux.test.js — C10 helpers: ${passed} passed`);

// ---- C10 — page wiring (source audit of app.js + index.html) -------------------

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

{
	assert.ok(
		app.includes('location.hash === "#permissions"'),
		"hash route exists",
	);
	assert.ok(
		app.includes('registerCommand(\n\t"permissions"'),
		"palette command registered",
	);
	assert.ok(
		html.includes('id="perm-page-btn"') && html.includes('id="perm-mode"'),
		"settings sidebar: mode select + page launcher (# FR-17, FR-29)",
	);
	assert.ok(app.includes("permPage.focus()"), "page focus management");
	assert.ok(app.includes('e.key === "Escape"'), "Esc closes the page");
	assert.ok(
		app.includes('fetch("/api/permissions")') &&
			app.includes('fetch("/api/permissions/config"') &&
			app.includes('fetch("/api/permissions/audit")') &&
			app.includes('fetch("/api/permissions/explain"') &&
			app.includes('fetch("/api/permissions/grants"'),
		"page talks only to the fixed /api/permissions surface (# FR-37)",
	);
	assert.ok(
		!app
			.slice(
				app.indexOf("#permissions page"),
				app.indexOf("function showStopped"),
			)
			.includes("safeguard.json"),
		"no browser-side policy file paths (# FR-37)",
	);
	ok(
		"page wiring: hash route, palette + settings launchers, focus/Esc, fixed endpoints only (# FR-29/36/37)",
	);
}
{
	assert.ok(app.includes("data-revoke="), "numbered per-grant revoke buttons");
	assert.ok(
		app.includes('fetch("/api/permissions/grants/" + b.dataset.revoke'),
		"revoke routes to the endpoint (# FR-32)",
	);
	assert.ok(
		app.includes('fetch("/api/permissions/grants", { method: "DELETE" })'),
		"clear-all routes to the endpoint (# FR-32)",
	);
	assert.ok(
		app.includes("applyModeSetting(permPageEls.mode.value)"),
		"settings mode select wired",
	);
	assert.ok(
		app.includes(
			"body: JSON.stringify({ revision: cur.revision, config: cfg })",
		),
		"persisted modes PUT with the revision (# FR-17/37)",
	);
	assert.ok(
		app.includes('api({ type: "prompt", message: "/safeguard mode yolo" })'),
		"yolo engages via the session command, never a config write (# FR-14)",
	);
	ok(
		"grants panel + mode select: numbered revoke, clear-all, PUT revision, yolo command (# FR-32/17)",
	);
}

// ---- ui-density-navigation — prioritized page integration (FR-33..37) ---------

{
	assert.match(
		html,
		/id="perm-filter"[\s\S]{0,200}aria-label="filter rules"/,
		"labelled filter input above the rule tree",
	);
	assert.match(
		app,
		/pu\.permView\(/,
		"page renders through the pure projection",
	);
	assert.match(
		app,
		/inherited policy/,
		"inherited rules sit behind a labelled disclosure (FR-34)",
	);
	assert.match(app, /no matching rules/, "filter no-match is explicit (FR-39)");
	assert.match(
		app,
		/pu\.selectorExplain\(/,
		"known selectors get a bounded explanation beside the raw text (FR-37)",
	);
	assert.match(
		app,
		/permFilterText/,
		"filter is transient client state re-rendered from the cached tree",
	);
	ok("perm page: prioritized projection + disclosure + filter wired");
}

console.log(`\npermissions-ux.test.js — C10 total: ${passed} passed`);
