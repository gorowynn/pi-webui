// Header status overflow: whole items move, primaries stay, races resolve.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";

// FR-50: connection state, settings, and density stay outside the overflow.
const sec =
	header.match(/<details class="sb-sec"[\s\S]*?<\/details>/)?.[0] || "";
assert.ok(sec, "overflow disclosure exists in the header");
for (const id of [
	"statusbar",
	"status-text",
	"settings-btn",
	"view-btn",
	"refresh-btn",
]) {
	assert.ok(
		header.includes(`id="${id}"`) && !sec.includes(`id="${id}"`),
		`${id} stays outside the overflow disclosure`,
	);
}

// FR-52: overflow preserves full text — items are MOVED whole (appendChild/
// prepend of the live nodes), never re-rendered or truncated.
assert.match(app, /for \(const item of sbMeta\) sbInline\.appendChild\(item\)/);
assert.match(app, /sbOverflow\.prepend\(sbInline\.lastElementChild\)/);
assert.doesNotMatch(
	app,
	/sbOverflow[\s\S]{0,120}(?:innerHTML|textContent\s*=)/,
	"overflow never rewrites item text",
);

// Overflow disclosure is labelled and native.
assert.match(sec, /aria-label="more session status"/);
assert.match(sec, /<summary/);

// T13.4: resize + status races re-sync — widthchange and ResizeObserver both
// funnel into the same single-pass sync.
assert.match(
	app,
	/document\.body\.addEventListener\("widthchange", syncSbOverflow\)/,
);
assert.match(app, /new ResizeObserver\(queueSbOverflow\)/);

// FR-5: inline repo remains bounded with ellipsis; model/thinking selectors
// live in the composer instead of duplicating controls in the top bar.
assert.match(css, /#sb-repo\s*\{[\s\S]*?max-width:/);
assert.doesNotMatch(header, /id="sb-model"|id="sb-think"/);
assert.match(
	css,
	/header \.statusbar code\s*\{[\s\S]*?text-overflow:\s*ellipsis/,
);

console.log("header-overflow.test.js — assertions passed");
