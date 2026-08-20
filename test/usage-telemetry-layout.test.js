// Browser wiring keeps telemetry bounded, optional, and independent of the rail.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

assert.match(
	server,
	/"\/usage-telemetry\.js"\s*:\s*\{[\s\S]*file:\s*"usage-telemetry\.js"/,
);
const usageScript = html.indexOf('src="usage-telemetry.js"');
const appScript = html.indexOf('src="app.js"');
assert(usageScript >= 0 && usageScript < appScript);
assert.doesNotMatch(server, /\/api\/usage/);
assert.match(app, /const USAGE_SAMPLE_MS = 10000/);
assert.match(app, /setInterval\(recordUsageSample, USAGE_SAMPLE_MS\)/);
assert.match(app, /document\.hidden/);
assert.match(app, /usageTelemetry\.pauseHistory\(usageHistory\)/);
assert.match(app, /usageTelemetry\.resumeHistory\(usageHistory\)/);
assert.match(app, /usageTelemetry\.loadHistory\(null, key/);
assert.match(app, /usageTelemetry\.saveHistory\(null, usageHistory/);
assert.match(
	app,
	/usageTelemetry\.sampleFromAnalysis\([\s\S]*lastStats[\s\S]*usageEvents/,
);
assert.match(app, /usageEvents\.startTurn\(/);
assert.match(app, /usageEvents\.endTurn\(/);
assert.match(app, /usageEvents\.startTool\(/);
assert.match(app, /usageEvents\.pauseTool\(/);
assert.match(app, /usageEvents\.resumeTool\(/);
assert.match(app, /function hasPermissionProvenance\(/);
assert.match(app, /approval_resolved[\s\S]*resumePermissionTool\(/);
assert.match(app, /usageEvents\.endTool\(/);
assert.match(app, /function resetUsageSession\(\)/);
assert.match(app, /resetUsageSession\(\);[\s\S]*workspace_changed/);
assert.match(app, /!suppressUsageEnd[\s\S]*usageEvents\.endTurn/);
assert.match(
	app,
	/function finalizeDeadTurn\(\)[\s\S]*usageEvents\.reset\(usageEvents\.snapshot\(\)\)/,
);
assert.match(app, /function analysisBody\(\)/);
assert.match(app, /\.metricViews\(usageHistory\)/);
assert.match(app, /usageTelemetry\.metricCardParts\(/);
assert.match(app, /class="an-spark-bg"/);
assert.match(app, /RECENT TELEMETRY/);
for (const id of [
	"output-tps",
	"avg-output-call",
	"cost-minute",
	"tool-error",
	"tool-calls-minute",
	"pending-tools",
	"headroom",
	"turn-duration",
	"first-token",
	"tool-latency",
])
	assert.match(app, new RegExp('"' + id + '"'));
assert.match(app, /TURN HISTORY/);
assert.match(app, /function analysisRender\(el\)[\s\S]*analysisBody\(\)/);
assert.match(app, /function showAnalysisModal\(\)[\s\S]*analysisBody\(\)/);
assert.match(app, /pendingApproval/);
assert.match(app, /payload\.isError/);
assert.match(
	css,
	/\.an-stat\s*\{[\s\S]*position:\s*relative[\s\S]*overflow:\s*hidden/,
);
assert.match(css, /\.an-spark-bg\s*\{[\s\S]*pointer-events:\s*none/);
assert.match(css, /\.an-spark path\s*\{[\s\S]*stroke:\s*currentColor/);
assert.match(css, /\.an-stat-main\s*\{[\s\S]*z-index:\s*1/);
assert.match(css, /\.an-metrics\s*\{[\s\S]*grid-template-columns/);
assert.match(css, /#toolsbar \.an-metrics\s*\{[\s\S]*repeat\(2/);
assert.match(css, /prefers-reduced-motion:[\s\S]*\.an-spark-bg/);

console.log("usage telemetry browser wiring: pass");
