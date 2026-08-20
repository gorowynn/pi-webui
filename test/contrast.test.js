// test/contrast.test.js — WCAG contrast math + theme-token scanner (FR-1).
// Zero-dep; reads the REAL public/style.css for the smoke test.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
	hexToRgb,
	relativeLuminance,
	contrastRatio,
	extractThemeTokens,
	resolveToken,
} = require("../public/a11y-contrast.js");

const css = fs.readFileSync(
	path.join(__dirname, "..", "public", "style.css"),
	"utf8",
);

// ---- WCAG anchors ----------------------------------------------------------

assert.equal(contrastRatio("#000000", "#ffffff"), 21, "black on white = 21:1");
assert.equal(contrastRatio("#ffffff", "#000000"), 21, "order-independent");
assert.ok(
	Math.abs(contrastRatio("#767676", "#ffffff") - 4.54) < 0.05,
	`WCAG documented example ~4.54, got ${contrastRatio("#767676", "#ffffff")}`,
);

const Lw = relativeLuminance([255, 255, 255]);
const Lb = relativeLuminance([0, 0, 0]);
const Lg = relativeLuminance([128, 128, 128]);
assert.ok(Math.abs(Lw - 1) < 1e-9, "white luminance ~1");
assert.ok(Math.abs(Lb - 0) < 1e-9, "black luminance ~0");
assert.ok(
	Math.abs(Lg - 0.2158) < 1e-3,
	`gray 128 luminance ~0.2158, got ${Lg}`,
);

// hexToRgb: 6-digit only, loud failure on anything else
assert.deepEqual(hexToRgb("#000000"), [0, 0, 0]);
assert.deepEqual(hexToRgb("#ffffff"), [255, 255, 255]);
assert.deepEqual(hexToRgb("#0e7490"), [14, 116, 144]);
assert.throws(() => hexToRgb("#abc"), /hexToRgb/);
assert.throws(() => hexToRgb("0e7490"), /hexToRgb/);
assert.throws(() => hexToRgb("#0e749"), /hexToRgb/);
assert.throws(() => hexToRgb(null), /hexToRgb/);

// ---- scanner: fixture -------------------------------------------------------

const fixture = [
	":root {",
	"\t/* dark palette — comment with a } inside? no braces, but colons: fine */",
	"\t--canvas: #000000;",
	"\t--accent: #4493f8;",
	"\t--derived: color-mix(in srgb, #4493f8 60%, #0d1117); /* must NOT parse as a token */",
	"\t--short: #abc; /* must be ignored (3-digit) */",
	"\t--rgba: rgba(10, 20, 30, 0.5); /* must be ignored */",
	"}",
	'[data-theme="paperlike"] {',
	"\t--canvas: #f5f0e6;",
	"\t--muted: #8a7f70;",
	"}",
	'[data-theme="paperlike"] #transcript {',
	"\tfont-size: 14px;",
	"}",
	":root {",
	"\t--accent: #ff0000; /* second bare :root block — later wins (CSS semantics) */",
	"}",
	"@media (max-width: 620px) {",
	"\t:root { --canvas: #111111; }",
	"}",
].join("\n");

const tokens = extractThemeTokens(fixture);
assert.deepEqual(
	tokens.dark,
	{
		"--canvas": "#000000",
		"--accent": "#ff0000",
	},
	"dark: two bare :root blocks merged, later wins; color-mix/short/rgba ignored",
);
assert.deepEqual(
	tokens.paperlike,
	{
		"--canvas": "#f5f0e6",
		"--muted": "#8a7f70",
	},
	"paperlike: bare block only — descendant rule not captured",
);
assert.deepEqual(
	extractThemeTokens('[data-theme="paperlike"] #transcript { color: red; }')
		.paperlike,
	{},
	"descendant selector alone yields an empty palette map",
);

// ---- scanner: real style.css smoke (FR-1) -----------------------------------

const live = extractThemeTokens(css);
const REQUIRED = [
	"--canvas",
	"--surface",
	"--surface-raised",
	"--ink",
	"--muted",
	"--accent",
	"--secondary",
	"--cyan",
	"--success",
	"--warning",
	"--danger",
	"--bubble-user",
	"--surface-inset",
];
for (const theme of ["dark", "paperlike"]) {
	for (const tok of REQUIRED) {
		assert.match(
			live[theme][tok] ?? "",
			/^#[0-9a-f]{6}$/,
			`${theme} defines ${tok} as a 6-digit hex`,
		);
	}
}

// ---- resolveToken -------------------------------------------------------------

assert.equal(
	resolveToken(live.paperlike, "--muted"),
	live.paperlike["--muted"],
);
assert.equal(
	resolveToken({}, "#0E7490"),
	"#0e7490",
	"literal hex passes through, lowercased",
);
assert.throws(() => resolveToken({}, "--nope"), /--nope/);
assert.throws(() => resolveToken({}, "#xyz"), /resolveToken/);

// ---- pair table: AA (4.5:1) on BOTH themes (FR-2, FR-3) ------------------------
// px is informational (smallest real use) — every row is ≤13px text, so the
// threshold is 4.5 for all. P14/P15 usage-audited: accent-as-text at ≤13px on
// surface/raised is real (.sx-tab.active 12px on the tabs strip, .sx-mode-btn
// active state) — not just button backgrounds.

const PAIRS = [
	{ id: "P1", fg: "--ink", bg: "--canvas", px: 12, ctx: "body" },
	{ id: "P2", fg: "--ink", bg: "--surface", px: 11, ctx: "statusbar/header" },
	{ id: "P3", fg: "--ink", bg: "--surface-raised", px: 11, ctx: "tool cards" },
	{ id: "P4", fg: "--ink", bg: "--bubble-user", px: 13, ctx: "user bubble" },
	{ id: "P5", fg: "--muted", bg: "--canvas", px: 10, ctx: "timestamps" },
	{ id: "P6", fg: "--muted", bg: "--surface", px: 10, ctx: "statusbar meta" },
	{
		id: "P7",
		fg: "--muted",
		bg: "--surface-raised",
		px: 10,
		ctx: "cost/cache strips",
	},
	{
		id: "P8",
		fg: "--secondary",
		bg: "--canvas",
		px: 11,
		ctx: "thinking label",
	},
	{
		id: "P9",
		fg: "--secondary",
		bg: "--surface-inset",
		px: 11,
		ctx: "thinking panel",
	},
	{ id: "P10", fg: "--success", bg: "--canvas", px: 11, ctx: "success strips" },
	{
		id: "P11",
		fg: "--success",
		bg: "--surface-raised",
		px: 11,
		ctx: "git badges",
	},
	{ id: "P12", fg: "--warning", bg: "--canvas", px: 11, ctx: "warnings" },
	{ id: "P13", fg: "--cyan", bg: "--canvas", px: 13, ctx: "links" },
	{ id: "P14", fg: "--accent", bg: "--surface", px: 13, ctx: "buttons/tabs" },
	{
		id: "P15",
		fg: "--accent",
		bg: "--surface-raised",
		px: 12,
		ctx: "active tabs",
	},
	{ id: "P16", fg: "--danger", bg: "--canvas", px: 12, ctx: "errors" },
];

const fails = [];
for (const theme of ["dark", "paperlike"]) {
	const pal = live[theme];
	for (const p of PAIRS) {
		const fg = resolveToken(pal, p.fg);
		const bg = resolveToken(pal, p.bg);
		const ratio = contrastRatio(fg, bg);
		if (ratio < 4.5) {
			fails.push(
				`${theme} ${p.id} ${p.fg} on ${p.bg} (${p.ctx}, ${p.px}px): ` +
					`${ratio.toFixed(2)} < 4.5 (fg=${fg}, bg=${bg})`,
			);
		}
	}
}
assert.deepEqual(
	fails,
	[],
	"all AA pairs pass — failing rows:\n  " + fails.join("\n  "),
);

console.log("contrast.test.js — all assertions passed");
