// test/rail-resize.test.js — splitter keyboard math (FR-6).
// Direction contract: the rail is right-anchored; pointer drag LEFT widens it
// (app.js: `delta = startX - clientX; w = startW + delta`). Keyboard mirrors
// the pointer: ArrowLeft = wider (+5), ArrowRight = narrower (-5).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resizeStep } = require("../public/a11y-contrast.js");
const app = fs.readFileSync(
	path.join(__dirname, "..", "public", "app.js"),
	"utf8",
);

// basic steps
assert.equal(resizeStep(50, "ArrowLeft", 0, 100), 55, "ArrowLeft widens by 5");
assert.equal(
	resizeStep(50, "ArrowRight", 0, 100),
	45,
	"ArrowRight narrows by 5",
);

// clamping at the edges
assert.equal(resizeStep(97, "ArrowLeft", 0, 100), 100, "clamps to max(100)");
assert.equal(resizeStep(3, "ArrowRight", 0, 100), 0, "clamps to min(0)");
assert.equal(resizeStep(98, "ArrowLeft", 0, 100), 100, "97+5 = 102 -> 100");
assert.equal(resizeStep(2, "ArrowRight", 0, 100), 0, "2-5 = -3 -> 0");

// Home/End
assert.equal(resizeStep(50, "Home", 0, 100), 0, "Home -> min");
assert.equal(resizeStep(50, "End", 0, 100), 100, "End -> max");

// unknown keys pass through unchanged
assert.equal(resizeStep(42, "ArrowUp", 0, 100), 42);
assert.equal(resizeStep(42, "Tab", 0, 100), 42);
assert.equal(resizeStep(42, " ", 0, 100), 42);

// non-0/100 ranges (percent-space callers pass 0..100; still honor min/max)
assert.equal(resizeStep(5, "ArrowLeft", 10, 90), 10, "clamps into range low");
assert.equal(
	resizeStep(95, "ArrowRight", 10, 90),
	90,
	"clamps into range high",
);

// symmetry: ArrowLeft then ArrowRight round-trips within range
assert.equal(
	resizeStep(resizeStep(50, "ArrowLeft", 0, 100), "ArrowRight", 0, 100),
	50,
);
assert.equal(
	resizeStep(resizeStep(50, "ArrowRight", 0, 100), "ArrowLeft", 0, 100),
	50,
);

// idempotence at the clamps
assert.equal(resizeStep(0, "ArrowRight", 0, 100), 0, "already at min stays");
assert.equal(resizeStep(100, "ArrowLeft", 0, 100), 100, "already at max stays");

// ---- statusTextForEvent (FR-9) ------------------------------------------------
// Coarse announcements only — turn boundaries and notable transitions, never
// per-token streaming events (message_update/message_end must map to null).

const { statusTextForEvent } = require("../public/a11y-contrast.js");
assert.equal(statusTextForEvent("agent_start"), "assistant working");
assert.equal(statusTextForEvent("agent_end"), "response complete");
assert.equal(statusTextForEvent("auto_retry_start"), "retrying…");
assert.equal(statusTextForEvent("auto_retry_end"), "retry finished");
assert.equal(statusTextForEvent("extension_error"), "extension error");
assert.equal(statusTextForEvent("error"), "error");
assert.equal(statusTextForEvent("compaction_start"), "context compacted");
assert.equal(
	statusTextForEvent("compaction_end"),
	"context compaction finished",
);
// the noisy stream: never announced
assert.equal(statusTextForEvent("message_update"), null);
assert.equal(statusTextForEvent("message_end"), null);
assert.equal(statusTextForEvent("message_start"), null);
assert.equal(statusTextForEvent("tool_execution_start"), null);
assert.equal(statusTextForEvent("tool_execution_update"), null);
assert.equal(statusTextForEvent("response"), null);
assert.equal(statusTextForEvent("unknown_event"), null);
assert.equal(statusTextForEvent(undefined), null);

// C8 — only one drawer/sheet surface is active at narrow widths.
assert.match(app, /railNarrow\(\)[\s\S]{0,160}collapseWsbar/);
assert.match(app, /function expandWsbar\([^)]*\)[\s\S]*closeRail\(\)/);

console.log("rail-resize.test.js — all assertions passed");
