// Shell chrome stays compact without hiding the controls from assistive tech.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";
const footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0] || "";

assert.match(header, /id="statusbar"/);
assert.match(header, /class="header-actions"/);
assert.doesNotMatch(footer, /id="statusbar"/);
assert.match(header, /id="sb-inline"/);
assert.match(header, /id="sb-overflow"/);
assert.match(header, /data-sb-meta/);
assert.match(css, /--rail-strip:\s*64px/);
assert.match(
	css,
	/\.rail-tab\s*\{[\s\S]*height:\s*64px[\s\S]*min-height:\s*64px/,
);
assert.match(
	css,
	/body\.w-narrow \.rail-tab\s*\{[\s\S]*height:\s*40px[\s\S]*min-height:\s*40px/,
);
assert.doesNotMatch(css, /\.rail-tab\.sel::before/);
assert.match(css, /\.rt-lbl\s*\{[\s\S]*clip:\s*rect\(0 0 0 0\)/);
assert.match(css, /header \.statusbar\s*\{[\s\S]*justify-content:\s*center/);
assert.match(css, /\.statusbar \.sb-inline\s*\{[\s\S]*flex:\s*0 1 auto/);
assert.match(app, /function syncHeaderStatusOverflow\(\)/);
assert.match(app, /function refreshOpenAnalysis\(\)/);
assert.match(app, /function appendLiveAssistant\(message\)/);
assert.match(app, /addUser\(txt, imgs, false\)/);
assert.match(app, /turns\.slice\(-Math\.min\(100, turns\.length\)\)/);
assert.match(app, /context usage by turn/);
assert.match(app, /billed model turns/);
assert.match(app, /<div class="an-sec-h">TURN HISTORY<\/div>/);
assert.match(app, /function focusModalControl\(\)/);
assert.match(app, /textContent = "Waiting for approval"/);
assert.match(app, /setActivity\("waiting for approval…", false\)/);
assert.match(app, /lastFocus && lastFocus\.isConnected/);
assert.match(
	css,
	/\.approval-wait\s*\{[\s\S]*border:\s*1px solid var\(--warning\)/,
);
assert.match(app, /\[data-sb-meta\]/);
assert.match(app, /sbSec\.hidden = false/);

// C5 — active repository/branch/change context (FR-1..4, FR-22, FR-27)
assert.match(header, /id="sb-git"/);
assert.match(header, /title="open Changes review"/);
assert.match(css, /\.sb-git-link/);
assert.match(app, /openRailWidget\("git"\)/);
assert.match(app, /HEAD \(detached\)/);
assert.match(app, /Git unavailable/);
assert.match(app, /sb\.repo\.title/);

// C8 — drawer/sheet surfaces are mutually exclusive on narrow widths.
assert.match(app, /railNarrow\(\)[\s\S]{0,160}collapseWsbar/);
assert.match(app, /function expandWsbar\([^)]*\)[\s\S]*closeRail\(\)/);
assert.match(css, /body\.w-mid\.rail-on\.rail-open #toolsbar/);
assert.match(
	css,
	/body\.w-mid\.rail-on\.rail-open \.rail-tab\s*\{[\s\S]*calc\(var\(--rail-strip\) - 24px\)/,
);
assert.match(
	css,
	/body\.w-narrow\.rail-on\.rail-open \.rail-tab\s*\{[\s\S]*calc\(var\(--rail-strip\) - 16px\)/,
);

console.log("41 passed");
