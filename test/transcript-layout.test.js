// Transcript hierarchy keeps assistant prose open and user prompts distinct.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");

assert.match(app, /m\.className = "msg"[\s\S]*classList\.add\("user-turn"\)/);
assert.match(
	app,
	/m\.className = "msg"[\s\S]*classList\.add\("assistant-turn"\)/,
);
assert.match(app, /const assistantTurnId = \{ n: 0 \}/);
assert.match(app, /turnNo,\s*textPar/);
assert.match(app, /renderUsageStrip\(cur\.bubble, msg, cur\.turnNo\)/);
assert.match(app, /const parts = \["turn " \+ turnNo\]/);
assert.match(app, /m\.className = "msg"[\s\S]*classList\.add\("system-turn"\)/);
assert.match(
	app,
	/turn\.className = "msg"[\s\S]*classList\.add\("tool-turn"\)/,
);
assert.match(
	css,
	/\.msg\.assistant-turn \.bubble\s*\{[\s\S]*background:\s*transparent/,
);
assert.match(css, /\.msg\.user-turn\s*\{[\s\S]*justify-content:\s*flex-end/);
assert.match(css, /\.msg\.user-turn \.bubble\s*\{[\s\S]*max-width:\s*min\(88%/);
assert.match(css, /\.msg\.tool-turn\s*\{[\s\S]*margin-inline:\s*8px/);

// C7 — safe tool-to-review links remain compact and explicit.
assert.match(app, /reviewTargetFromTool/);
assert.match(app, /data-review-path/);
assert.match(app, /Open in Changes/);
assert.match(app, /openRailWidget\("git"\)/);
assert.match(css, /\.tool-review-link/);

// ui-density-navigation FR-17/18: the repeated per-turn assistant label is a
// quiet marker — muted, lowercase, ≤11px — never accent competition.
const assistantRole =
	css.match(/\.msg\.assistant-turn \.role\s*\{([^}]*)\}/)?.[1] || "";
assert.match(assistantRole, /color:\s*var\(--muted\)/, "role label is muted");
assert.match(
	assistantRole,
	/text-transform:\s*lowercase/,
	"role label doesn't shout in caps",
);
assert.doesNotMatch(
	assistantRole,
	/font-size:\s*(1[2-9]|[2-9][0-9])px/,
	"role label never out-sizes metadata",
);
// FR-18: prose stays the strongest surface — transparent bubble, reading size.
assert.match(
	css,
	/\.msg\.assistant-turn \.bubble\s*\{[\s\S]*?font-size:\s*14px/,
);

console.log("25 passed");
