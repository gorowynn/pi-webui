// Static contract test — SDD adaptive-shell slice (tasks_adaptive-shell_07082026.md).
//
// Parses public/index.html, public/style.css, public/app.js with
// whitespace-insensitive regexes and asserts the FR contracts of the spec
// (spec_adaptive-shell_07082026.md). Every assertion FAILS until its task
// lands (TiCoder: tests-first, red now / green per-chunk).
//
// Run: node test/shell-contract.test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("public/index.html");
const css = read("public/style.css");
const app = read("public/app.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(_group, id, fr, desc, cond) {
	try {
		assert.ok(cond, desc);
		passed++;
	} catch {
		failed++;
		failures.push(`${id} [${fr}] ${desc}`);
	}
}

// ---- Task 2: width classes + media-query migration (FR-1, FR-11) ----
check(
	"T2",
	"A-2.1",
	"FR-11",
	'app.js has no matchMedia("(max-width: 720px)")',
	!/matchMedia\(\s*"\(max-width:\s*720px\)"/.test(app),
);
check(
	"T2",
	"A-2.2",
	"FR-1",
	"app.js registers a widthchange listener",
	/\bwidthchange\b/.test(app),
);
check(
	"T2",
	"A-2.3",
	"FR-11",
	"style.css has no @media (max-width: 720px) rule",
	!/@media\s*\(max-width:\s*720px\)/.test(css),
);
check(
	"T2",
	"A-2.4",
	"FR-11",
	"style.css has >=1 body.w-narrow selector",
	/body\.w-narrow/.test(css),
);
check(
	"T2",
	"A-2.5",
	"FR-1",
	"index.html post-<body> inline script has clientWidth + w-narrow",
	/<body>\s*<script[^>]*>[\s\S]*?clientWidth[\s\S]*?w-narrow/.test(html),
);

// ---- Task 3: wsbar drawer + scrim (FR-2, FR-12) ----
check(
	"T3",
	"A-3.1",
	"FR-2",
	'index.html has id="ws-scrim"',
	/id="ws-scrim"/.test(html),
);
check(
	"T3",
	"A-3.2",
	"FR-2",
	"index.html #ws-rail launcher buttons carry aria-expanded",
	/id="ws-rail-sessions"[\s\S]{0,300}aria-expanded=/.test(html) &&
		/id="ws-rail-workspaces"[\s\S]{0,300}aria-expanded=/.test(html),
);
check(
	"T3",
	"A-3.5",
	"FR-2",
	"app.js ws-rail buttons own one view each (click-again on the active view closes)",
	/wsRailFocus = b;[\s\S]{0,260}collapseWsbar\(\)/.test(app) &&
		/expandWsbar\(v\)/.test(app),
);
check(
	"T3",
	"A-3.6",
	"FR-2",
	"both rails share one-line labels and full accessible names",
	/\.rail-strip \.rt-lbl\s*\{[\s\S]{0,300}white-space:\s*nowrap[\s\S]{0,80}text-overflow:\s*ellipsis/.test(
		css,
	) &&
		/aria-label="workspaces"/.test(html) &&
		/aria-label="sessions"/.test(html),
);
check(
	"T3",
	"A-3.7",
	"FR-2",
	"one wsbar view at a time (body[data-ws-view] hides the other section); the ws-collapse button is gone",
	/body\[data-ws-view="workspaces"\] #ws-sessions-sec[\s\S]{0,120}display:\s*none/.test(
		css,
	) &&
		/body\[data-ws-view="sessions"\] #ws-workspaces-sec/.test(css) &&
		!/ws-collapse/.test(html) &&
		!/\.ws-x /.test(css),
);
check(
	"T3",
	"A-3.3",
	"FR-2",
	"style.css #ws-scrim sits at z-index: 29",
	/#ws-scrim[\s\S]{0,200}z-index:\s*29/.test(css),
);
check(
	"T3",
	"A-3.4",
	"FR-2",
	"style.css has a drawer off-canvas translateX rule for #wsbar",
	/#wsbar[\s\S]{0,200}translateX\(calc\(-100% - var\(--rail-strip\)\)\)/.test(
		css,
	),
);
check(
	"T3",
	"A-3.5",
	"FR-2",
	"app.js wires ws-scrim and aria-expanded",
	/ws-scrim/.test(app) && /aria-expanded/.test(app),
);

// ---- Task 4: sdd rail floor cap + overlay (FR-3) ----
check(
	"T4",
	"A-4.1",
	"FR-3",
	"style.css defines --wsbar-w",
	/--wsbar-w/.test(css),
);
check(
	"T4",
	"A-4.2",
	"FR-3",
	"style.css rail-open margin rule carries the 560 floor cap",
	/rail-on\.rail-open[\s\S]{0,300}560/.test(css),
);
check(
	"T4",
	"A-4.3",
	"FR-3",
	"style.css w-mid/w-narrow rail-open keeps rail-only margin",
	/body\.w-(?:mid|narrow)[\s\S]{0,150}rail-open/.test(css),
);
check(
	"T4",
	"A-4.4",
	"FR-3",
	"app.js contains the 560 rail clamp constant",
	/\b560\b/.test(app),
);

// ---- Task 5: composer primary/overflow split (FR-4, FR-5) ----
check(
	"T5",
	"A-5.1",
	"FR-4",
	'index.html has class="bar-ovf" details',
	/class="bar-ovf"/.test(html),
);
check(
	"T5",
	"A-5.2",
	"FR-5",
	"style.css hides sessions/new only in ws-on.w-wide",
	/body\.ws-on\.w-wide[\s\S]{0,300}(?:#sessions|#new)/.test(css),
);
check(
	"T5",
	"A-5.3",
	"FR-4",
	"style.css has a body.w-narrow .bar-ovf popover rule",
	/body\.w-narrow[\s\S]{0,300}bar-ovf/.test(css),
);
check(
	"T5",
	"A-5.4",
	"FR-4",
	"composer actions auto-close only in the narrow popover",
	/if \(sbNarrow && e\.target\.closest\("select, button"\)\)/.test(app),
);

// ---- Task 6: idle activity hiding + stateful empty state (FR-6, FR-8) ----
check(
	"T6",
	"A-6.1",
	"FR-6",
	"style.css hides .activity without body.act-on",
	/body:not\(\.act-on\)[\s\S]{0,150}\.activity/.test(css),
);
check(
	"T6",
	"A-6.2",
	"FR-8",
	"style.css no longer has #transcript:empty::before",
	!/#transcript:empty::before/.test(css),
);
check(
	"T6",
	"A-6.3",
	"FR-8",
	'index.html has id="empty-state"',
	/id="empty-state"/.test(html),
);
check(
	"T6",
	"A-6.4",
	"FR-8",
	"app.js defines updateEmptyState",
	/\bupdateEmptyState\b/.test(app),
);
check(
	"T6",
	"A-6.5",
	"FR-6",
	"app.js toggles act-on in setActivity",
	/\bact-on\b/.test(app),
);

// ---- Task 7: context-pressure meter + compact promotion (FR-10) ----
check(
	"T7",
	"A-7.1",
	"FR-10",
	'index.html has id="ctx-meter"',
	/id="ctx-meter"/.test(html),
);
check(
	"T7",
	"A-7.2",
	"FR-10",
	"style.css has a .ctx-hot rule",
	/\.ctx-hot/.test(css),
);
check(
	"T7",
	"A-7.3",
	"FR-10",
	"app.js toggles ctx-hot with the 70 threshold",
	/\bctx-hot\b/.test(app) && /\b70\b/.test(app),
);

// ---- Task 8: viewport + safe-area (FR-9) ----
check(
	"T8",
	"A-8.1",
	"FR-9",
	"index.html viewport meta has viewport-fit=cover",
	/viewport-fit=cover/.test(html),
);
check("T8", "A-8.2", "FR-9", "style.css uses 100dvh", /\b100dvh\b/.test(css));

// ---- report ----
console.log(`shell-contract: ${passed} passed, ${failed} failed`);
if (failures.length) {
	console.log("failures:");
	for (const f of failures) console.log("  - " + f);
}
process.exitCode = failed ? 1 : 0;
