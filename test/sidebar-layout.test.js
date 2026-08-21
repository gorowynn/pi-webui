// Both sidebars share the same quiet surface hierarchy and accessible structure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

assert.match(
	html,
	/id="ws-workspaces-sec"[\s\S]*aria-labelledby="ws-workspaces-title"/,
);
assert.match(
	html,
	/id="ws-sessions-sec"[\s\S]*aria-labelledby="ws-sessions-title"/,
);
assert.match(html, /id="tools-rail"[\s\S]*role="tablist"/);
assert.match(
	css,
	/\.ws-sec \+ \.ws-sec\s*\{[\s\S]*border-top:\s*1px solid var\(--line\)/,
);
assert.match(
	css,
	/\.ws-row\.active\s*\{[\s\S]*background:\s*var\(--accent-soft\)/,
);
assert.match(css, /\.tools-rail\s*\{[\s\S]*background:\s*var\(--surface\)/);
assert.match(css, /\.rail-tab\.sel\s*\{[\s\S]*border-color:\s*color-mix/);
assert.match(
	css,
	/#toolsbar \.rt-lbl\s*\{[\s\S]*position:\s*static[\s\S]*font:[\s\S]*9px/,
);
assert.match(
	css,
	/\.rt-badge\s*\{[\s\S]*position:\s*static[\s\S]*font:[\s\S]*9px[\s\S]*color:\s*var\(--ink\)/,
);
assert.match(css, /var\(--rail-width, min\(440px, 60vw\)\)/);
assert.match(
	css,
	/\.tools-pane\s*\{[\s\S]*background:\s*var\(--surface-inset\)/,
);
assert.match(
	css,
	/\.tools-close:hover\s*\{[\s\S]*background:\s*var\(--accent-soft\)/,
);
assert.match(css, /#toolsbar \.an-head\s*\{[\s\S]*grid-template-columns/);
assert.match(css, /\.an-bars\s*\{[\s\S]*height:\s*64px/);
assert.match(css, /\.an-context-line\s*\{[\s\S]*position:\s*absolute/);
assert.match(css, /#toolsbar \.an-stat\.primary\s*\{[\s\S]*grid-column/);
assert.match(app, /"total",\s*"primary"/);
assert.match(app, /Provider cost is not available/);
assert.match(app, /No completed model turns yet/);
assert.match(app, /class="an-context-line"/);
assert.match(app, /line = context/);
assert.match(app, /SA\.formatTokens\(v\) \+ " out tok"/);
assert.match(app, /Math\.round\(context\) \+ "% context"/);
assert.doesNotMatch(css, /\.rail-tab\.sel::before/);

// C6 — workspace/session orientation and review reconciliation.
assert.match(app, /data-workspace-path/);
assert.match(app, /aria-label[\s\S]{0,200}workspace/i);
assert.match(app, /title = w\.path/);
assert.match(app, /resetGitReviewState\(\)/);
assert.match(app, /gitSelectedPath = null/);
assert.match(app, /sessionSizeLabel\(s\)/);
assert.match(css, /\.ws-meta\s*\{/);

console.log("29 passed");
