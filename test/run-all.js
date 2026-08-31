"use strict";

// The two *-api integration fixtures require a provider-backed SDK session and the
// SDK/SSE smoke test expects an externally booted server. Keep those manual
// fixtures out of the package's deterministic contract suite; opt into them with
// PI_WEBUI_LIVE_INTEGRATION=1 when credentials and a provider are available.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const manual = new Set([
	"advisor-api.test.js",
	"secondary-api.test.js",
	"rpc-sse.test.js",
]);
const files = fs
	.readdirSync(__dirname)
	.filter((name) => name.endsWith(".test.js") && !manual.has(name))
	.sort()
	.map((name) => path.join(__dirname, name));
const result = spawnSync(process.execPath, ["--test", ...files], {
	stdio: "inherit",
});
process.exit(result.status == null ? 1 : result.status);
