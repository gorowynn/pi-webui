// Pure workspace/session projections for the compact sidebar.
const assert = require("node:assert/strict");
const ux = require("../public/sidebar-ux.js");

const workspaces = [
	{ path: "/repo/current", name: "current", active: true },
	{ path: "/repo/other", name: "other", active: false },
];
const compact = ux.workspaceView(workspaces, { expanded: false });
assert.deepEqual(compact.rows, [workspaces[0]]);
assert.equal(compact.activePath, "/repo/current");
assert.equal(compact.expanded, false);
assert.equal(compact.canExpand, true);

const expanded = ux.workspaceView(workspaces, { expanded: true });
assert.deepEqual(expanded.rows, workspaces);
assert.equal(expanded.expanded, true);

const noActive = ux.workspaceView(
	[
		{ path: "/repo/a", active: false },
		{ path: "/repo/b", active: false },
	],
	{ expanded: false },
);
assert.equal(
	noActive.rows.length,
	2,
	"unknown active workspace never hides every row",
);
assert.equal(noActive.expanded, true);

const failed = ux.workspaceView([], { status: "error" });
assert.equal(failed.status, "error");
assert.deepEqual(failed.rows, []);

const sessions = [
	{ name: "Fix Login", preview: "auth flow" },
	{ name: "Docs", firstPrompt: "Write the login guide" },
	{ name: "Other", preview: "unrelated" },
];
assert.deepEqual(
	ux.sessionView(sessions, "LOGIN").rows,
	[sessions[0], sessions[1]],
	"name, preview, and first prompt are case-insensitive search fields",
);
assert.deepEqual(ux.sessionView(sessions, ""), {
	rows: sessions,
	query: "",
	total: 3,
	count: 3,
	empty: false,
});
assert.equal(ux.sessionView(sessions, "missing").empty, true);
assert.deepEqual(ux.sidebarState(), { expanded: false, query: "" });
assert.deepEqual(ux.resetState(), { expanded: false, query: "" });

const original = { expanded: false, query: "login" };
ux.workspaceView(workspaces, original);
ux.sessionView(sessions, original.query);
assert.deepEqual(original, { expanded: false, query: "login" });

console.log("sidebar-ux.test.js — projection assertions passed");
