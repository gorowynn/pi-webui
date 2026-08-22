// Session search: labelled input, pure filter, count/clear feedback, sticky controls.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const ux = require("../public/sidebar-ux.js");

// FR-14: labelled native search input + explicit clear + live count.
assert.match(html, /id="ws-search"[\s\S]{0,200}type="search"/);
assert.match(html, /id="ws-search"[\s\S]{0,300}aria-label="filter sessions"/);
assert.match(html, /id="ws-search-clear"/);
assert.match(
	html,
	/id="ws-search-clear"[\s\S]{0,200}aria-label="clear session filter"/,
);
assert.match(html, /id="ws-search-count"/);
assert.match(html, /aria-live="polite"/);

// FR-14: wiring delegates to the pure projection and shows counts + empty state.
assert.match(app, /sidebarUx(?:Safe)?\.sessionView\(/);
assert.match(app, /ws-search-clear/);
assert.match(app, /no matching sessions/);

// FR-15: new session clears the transient query.
assert.match(app, /wsState\.query = ""/);

// FR-13: sessions heading/search stay put while the list scrolls independently.
assert.match(css, /body\.ws-on #wsbar\s*\{[\s\S]*?display:\s*flex/);
assert.match(css, /#ws-sessions-sec\s*\{[\s\S]*?flex:\s*1 1 auto/);
assert.match(css, /#ws-sessions\s*\{[\s\S]*?overflow-y:\s*auto/);

// Pure projection spot-check (FR-14): firstPrompt and name both match.
const rows = [
	{ name: "Alpha", preview: "intro" },
	{ name: "beta", preview: "no match here", firstPrompt: "gamma task" },
];
assert.equal(ux.sessionView(rows, "gam").count, 1);
assert.equal(ux.sessionView(rows, "ALP").count, 1);

console.log("session-search.test.js — search + sticky assertions passed");
