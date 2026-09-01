// Minimal source contracts for the screenshot-guided shell adaptation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/style.css"), "utf8");
const app = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

assert.doesNotMatch(html, /id="header-new"/);
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";
assert.doesNotMatch(header, /id="sb-model"|id="sb-think"/);
assert.match(html, /id="sb-tok"/);
assert.match(html, /id="sb-cost"/);
assert.match(app, /document\.createElement\("optgroup"\)/);
assert.match(app, /group\.label = provider/);
assert.match(
	css,
	/body\.w-wide\[data-ws-view="workspaces"\] #ws-sessions-sec[\s\S]{0,100}display:\s*flex/,
);
assert.match(
	css,
	/body\.w-wide\[data-ws-view="sessions"\] #ws-workspaces-sec[\s\S]{0,100}display:\s*block/,
);
assert.match(html, /id="ws-workspaces-sec"[\s\S]*aria-labelledby=/);
assert.match(html, /id="ws-sessions-sec"[\s\S]*aria-labelledby=/);
assert.match(css, /\.tool\.done\s*\{[\s\S]*border-color:/);
assert.match(css, /\.tool\.run\s*\{[\s\S]*border-color:\s*var\(--accent\)/);
assert.match(css, /\.tool\.err\s*\{[\s\S]*border-color:\s*var\(--danger\)/);
assert.match(css, /\.composer\s*\{[\s\S]*box-shadow:\s*var\(--shadow\)/);
const footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0] || "";
assert.match(footer, /id="send"/);
assert.match(footer, /id="stop"/);
assert.match(footer, /id="mode-chip"/);
assert.match(footer, /id="composer-model"/);
assert.match(footer, /id="composer-think"/);
assert.match(footer, /class="bar-ovf"/);
assert.match(app, /composerModelSel\.onchange/);
assert.match(app, /composerThinkSel\.onchange/);
assert.match(app, /const mode = "auto"/);
for (const id of ["new", "sessions", "mode", "attach-images"]) {
	assert.doesNotMatch(footer, new RegExp(`id="${id}"`));
}
assert.match(html, /placeholder="Message…"/);
assert.match(
	css,
	/\.composer #send\s*\{[\s\S]*position:\s*absolute[\s\S]*top:\s*16px/,
);
assert.match(css, /padding:\s*12px 84px 12px 12px/);

console.log("reference-ui: passed");
