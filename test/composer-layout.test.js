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
assert.match(
	footer,
	/id="attach-images"[\s\S]*type="button"[\s\S]*aria-label=/,
);
assert.match(
	footer,
	/id="image-picker"[\s\S]*type="file"[\s\S]*accept="image\/\*"/,
);
assert.match(footer, /id="image-picker"[\s\S]*multiple[\s\S]*hidden/);
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
assert.match(
	app,
	/attachImagesButton\.onclick = \(\) => imagePicker\.click\(\)/,
);
assert.match(app, /classList\.add\("dragging"\)/);
assert.match(app, /classList\.remove\("dragging"\)/);

console.log("16 passed");
