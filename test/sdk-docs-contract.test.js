"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const current = [
	"server.js",
	"bin.js",
	"AGENTS.md",
	"docs/roadmap.md",
	"docs/browser-tools.md",
	"test/run-all.js",
	"test/secondary-api.test.js",
	"test/advisor-api.test.js",
	"public/app.js",
	"jsonl.js",
];
const stalePrimaryRuntime = /Pi RPC|RPC subprocess|pi --mode rpc|PI_BIN|PI_ARGS|spawned pi|respawned pi|kill the pi child|synthetic CLI agent/i;

for (const file of current) {
	assert.doesNotMatch(read(file), stalePrimaryRuntime, `${file} still describes the old primary transport`);
}

const server = read("server.js");
assert.match(server, /@earendil-works\/pi-coding-agent SDK/);
assert.match(server, /createPiSdkRuntime/);
assert.doesNotMatch(server, /\bspawn\s*\(/);

const pkg = JSON.parse(read("package.json"));
assert.equal(typeof pkg.dependencies?.["@earendil-works/pi-coding-agent"], "string");
assert.match(String(pkg.engines?.node), />=22\.19/);
assert.ok(pkg.files.includes("pi-sdk-runtime.js"));

console.log("sdk-docs-contract.test.js — SDK architecture documentation contract passed");
