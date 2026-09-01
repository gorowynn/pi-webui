// Composer keeps the writing surface primary while exposing image-drop feedback.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0] || "";

assert.match(footer, /id="input"[\s\S]*enterkeyhint="send"/);
assert.match(footer, /class="bar"/);
assert.match(footer, /id="bar-ovf"/);
assert.match(
	css,
	/\.composer\s*\{[\s\S]*background:\s*var\(--surface-raised\)/,
);
assert.match(css, /\.composer:focus-within,[\s\S]*\.composer\.dragging/);
assert.match(
	css,
	/textarea:not\(\.sx-ta\)\s*\{[\s\S]*background:\s*var\(--surface-inset\)/,
);
assert.match(css, /\.bar\s*\{[\s\S]*border-top:\s*1px solid var\(--line\)/);
assert.match(app, /function draggingFiles|const draggingFiles/);
assert.match(app, /function syncImageAttachmentUi\(\)/);
assert.match(app, /const id = currentModelId \|\| savedModelId/);
assert.doesNotMatch(app, /attachImagesButton|imagePicker/);
assert.match(app, /classList\.add\("dragging"\)/);
assert.match(app, /classList\.remove\("dragging"\)/);

// C8 — primary actions remain reachable while low-frequency actions overflow.
assert.match(css, /\.bar > button\s*\{[\s\S]*flex:\s*0 0 auto/);
assert.match(css, /body\.w-narrow \.composer \.bar-ovf-items\s*\{/);

// ui-density-navigation: posture/Send/Stop stay direct; Compact + Improve
// remain in the labelled overflow; session/new/delivery/image buttons are gone.
const ovf =
	footer.match(/<details class="bar-ovf"[\s\S]*?<\/details>/)?.[0] || "";
for (const id of ["mode-chip", "send", "stop"]) {
	assert.ok(
		footer.includes(`id="${id}"`) && !ovf.includes(`id="${id}"`),
		`${id} stays a direct composer control`,
	);
}
for (const id of ["compact", "improve"]) {
	assert.ok(ovf.includes(`id="${id}"`), `${id} lives in the overflow`);
}
for (const id of ["sessions", "new", "mode", "attach-images"]) {
	assert.ok(!footer.includes(`id="${id}"`), `${id} is removed from the composer`);
}
assert.match(
	css,
	/body\.ctx-hot #compact\s*\{[\s\S]*?border-color:\s*var\(--danger\)/,
	"ctx-hot styles Compact inside the popover",
);
assert.match(
	css,
	/body\.w-narrow\.ctx-hot \.composer \.bar-ovf > summary\s*\{[\s\S]*?border-color:\s*var\(--danger\)/,
	"ctx-hot flags the overflow toggle itself at narrow",
);
assert.doesNotMatch(
	css,
	/body\.w-narrow #compact\s*\{[\s\S]*?display:\s*none/,
	"Compact is never fully hidden (one action away, FR-54)",
);

console.log("31 passed");
