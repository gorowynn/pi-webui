// test/discipline-contract.test.js — cache-stability contract for the extension
// Zero-dep source audit: Node runs the shipped .ts through pi, while this test
// keeps the provider-facing prompt invariant visible without a TS runtime.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
	path.join(__dirname, "..", "extensions", "pi_minimal_webui", "discipline.ts"),
	"utf8",
);
const hookStart = source.indexOf('pi.on(\n\t\t"before_agent_start"');
assert.notEqual(hookStart, -1, "before_agent_start hook exists");
const hookEnd = source.indexOf("\n\t);", hookStart);
assert.notEqual(hookEnd, -1, "before_agent_start hook is bounded");
const hook = source.slice(hookStart, hookEnd);

assert.match(
	source,
	/const DISCIPLINE_NUDGE\s*=\s*"For ambiguous requests,/,
	"discipline nudge is a fixed string",
);
assert.match(hook, /DISCIPLINE_NUDGE/, "hook uses the fixed nudge");
assert.doesNotMatch(
	hook,
	/getTodos|allDone|openIds|unfinished|status\s*===/,
	"hook does not read live todo state into the system prompt",
);
const nudgeStart = source.indexOf("const DISCIPLINE_NUDGE");
const nudgeEnd = source.indexOf(";\n\tpi.on", nudgeStart);
assert.notEqual(nudgeEnd, -1, "fixed nudge declaration is bounded");
assert.doesNotMatch(
	source.slice(nudgeStart, nudgeEnd),
	/\$\{/,
	"fixed nudge contains no interpolation",
);

console.log("✓ discipline system-prompt suffix stays cache-stable");
