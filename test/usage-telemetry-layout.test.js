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
// usage-tab C3 (FR-3): telemetry moved into collapsed PERFORMANCE details
assert.match(app, /PERFORMANCE/);
assert.match(app, /<details class="an-perf"/);
assert.doesNotMatch(app, /RECENT TELEMETRY/);
assert.match(app, /let anTelOpen/); // module var: open state survives re-render (E7)
assert.match(app, /anTelOpen = perf\.open/);
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
	"avg-turn", // usage-tab C3: moved into PERFORMANCE with median
	"median-turn",
])
	assert.match(app, new RegExp('"' + id + '"'));
assert.match(app, /TURN HISTORY/);
// usage-tab C3 (FR-2): headline is exactly 4 cards — no turns card
assert.match(app, /stat\(\s*"failures"/);
assert.doesNotMatch(app, /stat\(\s*"turns"/);
assert.match(app, /function analysisRender\(el\)[\s\S]*analysisBody\(\)/);
assert.match(app, /openRailWidget\("analysis"\)/);
assert.doesNotMatch(app, /function showAnalysisModal\(\)/);
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
assert.match(css, /\.an-perf summary\s*\{[\s\S]*cursor:\s*pointer/);
// usage-tab C4 (FR-4, FR-5): metric selector + persistence
assert.match(app, /pi:an-metric/); // read + write
assert.match(app, /localStorage\.setItem\("pi:an-metric", anMetric\)/);
assert.match(app, /let anMetric/); // resolved at render, module-scope (E7)
assert.match(app, /class="an-seg-btn/); // segmented control markup
assert.match(app, /data-metric=/);
assert.match(app, /disabled title="' \+ esc\(def\.reason/); // unavailable options disabled w/ title
assert.match(app, /const showOverlay = anMetric !== "context"/); // FR-5 overlay suppression
assert.match(css, /\.an-seg-btn\s*\{[\s\S]*cursor:\s*pointer/);
// usage-tab C5 (FR-6, FR-7, FR-8): window, legend, readout
assert.match(app, /capped\.slice\(-20\)/); // rail default window
assert.match(app, /let anShownAll/);
assert.match(app, /let anSelected/);
assert.match(app, /anSelected = anSelected === mi \? null : mi/); // click-again deselect
assert.match(app, /!shown\.some\(\(t\) => t\.messageIndex === anSelected\)/); // E5 auto-clear
assert.match(app, /class="an-legend"/);
assert.match(app, /an-sw-metric/);
assert.match(app, /an-sw-context/);
assert.match(app, /class="an-readout"/);
assert.match(app, /an-readout-jump/);
assert.match(app, /querySelectorAll\("\.an-bar"\)/); // bars wired separately
assert.match(app, /classList\.contains\("an-bar"\)\) return/); // wireAnalysis skips bars
assert.match(css, /\.an-bar\.sel\s*\{/);
// usage-tab C6 (FR-10, FR-13): notices render + dead modal CSS gone
assert.match(app, /SA\.sessionNotices\(/);
assert.match(app, /class="an-notice tone-/);
assert.match(app, /contextPercent: a\.contextPercent/);
assert.match(css, /\.an-notice\.tone-attention\s*\{/);
assert.match(css, /\.an-notice\.tone-danger\s*\{/);
assert.doesNotMatch(css, /an-card/); // FR-13: modal-only CSS removed

// ---- usage-tab C2: tools rows static + honest units (FR-11, FR-12) ----
assert.match(app, /class="an-row"/);
assert.match(app, /const staticItem = \(main, sub\) =>/);
assert.doesNotMatch(app, /jump\(\s*-1,/); // no direct jump(-1) calls
assert.doesNotMatch(app, /: -1,\s*\n/); // no ternary fallback into jump either
assert.match(app, /SA\.formatChars\(t\.outputLength\)/);
assert.doesNotMatch(app, /formatTokens\(t\.outputLength\)/);
assert.match(css, /\.an-row\s*\{[\s\S]*cursor:\s*default/);

console.log("usage telemetry browser wiring: pass");
