// Workspace section starts compact, expands on demand, resets on switch.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");

// FR-8: labelled native disclosure control with expanded-state semantics.
assert.match(
	html,
	/id="ws-toggle"[\s\S]{0,300}aria-expanded=/,
	"workspace section carries a disclosure toggle",
);
assert.match(
	html,
	/id="ws-toggle"[\s\S]{0,300}aria-controls="ws-workspaces"/,
	"toggle controls the workspace list",
);
assert.match(
	html,
	/id="ws-toggle"[\s\S]{0,300}aria-label=/,
	"toggle exposes an accessible name",
);

// FR-7/FR-9: only inactive rows hide; the active row stays visible.
assert.match(css, /#wsbar\.ws-collapsed[^{]*\{[\s\S]*?display:\s*none/);
assert.match(css, /\.ws-row\.active\s*\{[\s\S]*?display:\s*(?:flex|block)/);
assert.doesNotMatch(css, /#wsbar\.ws-collapsed[^{]*\.ws-row\.active\s*\{/);

// FR-11: successful switch returns the section to compact.
assert.match(app, /function setWorkspaceCollapsed\(/);
assert.match(app, /setWorkspaceCollapsed\(true\)/);
assert.match(app, /sidebarUx(?:Safe)?\.resetState\(\)/);
assert.match(app, /sidebarUx(?:Safe)?\.workspaceView\(/);

// FR-10: fetch failure and empty data never look collapsed-and-empty.
assert.match(app, /status\s*=\s*"error"|classList\.add\("ws-error"\)/);
assert.match(app, /no workspaces/);

// FR-12: IDE no-switch still hides the whole section.
assert.match(
	css,
	/body\.no-switch #ws-workspaces-sec\s*\{[\s\S]*?display:\s*none/,
);

// W1 fix: ALL rows render; the CSS class alone reveals/hides — the render
// loop must not consume the collapsed projection's rows.
assert.match(app, /for \(const w of wsAll\) \{/);

// Workspace removal = server-side archive (recoverable, auto-deleted after 7
// days). The browser-local hide experiment was dropped in favor of it.
assert.match(app, /ws-row-wrap/);
assert.match(app, /ws-row-x/);
assert.match(
	app,
	/remove workspace/,
	"remove button carries an accessible name",
);
assert.match(
	app,
	/e\.stopPropagation\(\)/,
	"remove click never switches workspace",
);
assert.match(
	app,
	/\/api\/workspaces\/remove/,
	"remove routes to the archive endpoint",
);
assert.match(app, /7 days/, "confirm explains the retention window");
assert.match(app, /confirmModal\(/, "removal is confirm-gated");
assert.match(app, /ws-archived/, "archived disclosure rendered");
assert.match(app, /data-restore=/, "per-entry restore buttons");
assert.match(app, /\/api\/workspaces\/restore/, "restore endpoint wired");
assert.match(css, /\.ws-row-wrap\s*\{/);
assert.match(css, /\.ws-row-x\s*\{/);
assert.match(css, /\.ws-archived\s*\{/);
assert.doesNotMatch(app, /pi:ws-hidden/, "browser-local hide list is gone");

// Server contract: archive endpoints exist, gate on known + non-active
// workspaces, refuse in no-switch mode, and purge before listing.
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
assert.match(server, /\/api\/workspaces\/remove/);
assert.match(server, /\/api\/workspaces\/restore/);
assert.match(server, /cannot remove the active workspace/);
assert.match(
	server,
	/\/api\/workspaces\/remove[\s\S]{0,600}isKnownWorkspacePath/,
	"remove reuses the known-workspace security gate",
);
assert.match(server, /purgeArchived\(ARCHIVE_DIR\)/, "purge runs on read");
assert.match(
	server,
	/archived: listArchived\(ARCHIVE_DIR\)/,
	"workspaces payload carries the archive list",
);

console.log("workspace-collapse.test.js — integration assertions passed");
