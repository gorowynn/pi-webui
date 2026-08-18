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

console.log("12 passed");
