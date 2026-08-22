// UI density foundation: readable defaults and size-independent interaction targets.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
	path.join(__dirname, "..", "public", "style.css"),
	"utf8",
);

assert.match(css, /--ui-text-size:\s*13px/);
assert.match(css, /--ui-meta-size:\s*11px/);
assert.match(css, /--target-pointer:\s*32px/);
assert.match(css, /--target-touch:\s*44px/);
assert.match(
	css,
	/button\s*,\s*select\s*,\s*input:not\(\[type="hidden"\]\)\s*,\s*textarea\s*\{[\s\S]*min-height:\s*var\(--target-pointer\)/,
);
assert.match(
	css,
	/@media\s*\(hover:\s*none\)[\s\S]*button\s*,\s*select\s*,\s*input:not\(\[type="hidden"\]\)\s*,\s*textarea\s*\{[\s\S]*min-height:\s*var\(--target-touch\)/,
);
assert.match(
	css,
	/\.sb-meta\s*,\s*\.ws-meta\s*,\s*\.rt-badge\s*,\s*\.perm-muted\s*,\s*\.perm-layer\s*,\s*\.sa-note-foot\s*\{[\s\S]*font-size:\s*var\(--ui-meta-size\)/,
);
assert.match(
	css,
	/:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--accent\)/,
);

// Wide rail (FR-24/25/26/27): labels + badges at/above the metadata floor,
// selected tab carries visible non-color styling, targets meet 32px.
const rtLbl = css.match(/\.rail-strip \.rt-lbl\s*\{([^}]*)\}/)?.[1] || "";
assert.match(rtLbl, /font:[\s\S]*?10px/, "rail labels ≥ 10px (no clipped 9px)");
const rtBadge = css.match(/\.rt-badge\s*\{([^}]*)\}/)?.[1] || "";
assert.match(rtBadge, /font:[\s\S]*?10px/, "rail badges ≥ 10px");
const railTab = css.match(/^\.rail-tab\s*\{([^}]*)\}/m)?.[1] || "";
assert.match(railTab, /min-width:\s*32px/);
assert.match(railTab, /min-height:\s*(?:4[0-9]|[5-9][0-9])px/);
const railSel = css.match(/^\.rail-tab\.sel\s*\{([^}]*)\}/m)?.[1] || "";
assert.match(
	railSel,
	/background:\s*var\(--accent-soft\)/,
	"selection is visible fill, not a stripe",
);
assert.match(
	railSel,
	/border-color:/,
	"selection adds a border (non-color redundancy)",
);

// Narrow launcher (FR-27/29): strip tabs keep the 32px floor, no dead resize
// padding, and the body margin keeps the strip off the composer.
const narrowTab =
	css.match(/body\.w-narrow \.rail-tab\s*\{([^}]*)\}/m)?.[1] || "";
assert.match(narrowTab, /min-width:\s*32px/, "narrow rail tabs ≥ 32px");
const narrowRail =
	css.match(/body\.w-narrow \.rail-strip\s*\{([^}]*)\}/m)?.[1] || "";
assert.doesNotMatch(
	narrowRail,
	/padding-left:\s*24px/,
	"narrow strip drops the (hidden) resize-handle padding",
);
assert.match(
	css,
	/body\.rail-on\s*\{[\s\S]*?margin-right:\s*var\(--rail-strip\)/,
);

// Utility-page width (FR-30/31/32): wide displays widen Permissions/Fleet;
// the transcript reading cap stays untouched.
assert.match(
	css,
	/@media\s*\(min-width:\s*1440px\)\s*\{[\s\S]*?\.perm-body\s*\{[\s\S]*?max-width:\s*12[0-7][0-9]px/,
	"≥1440px viewports widen .perm-body into the 1100–1280px band",
);
assert.match(
	css,
	/padding:\s*16px max\(28px, calc\(\(100% - 1200px\) \/ 2\)\)/,
	"transcript reading cap unchanged (FR-30)",
);

console.log("ui-density.test.js — foundation assertions passed");
