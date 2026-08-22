// Compact tool-group summary is pure presentation state; keep its wording stable.
const assert = require("node:assert/strict");
const {
	toolGroupSummary,
	toolUsageSummary,
} = require("../public/tool-presentation.js");

assert.equal(toolUsageSummary(["read"]), "read");
assert.equal(
	toolUsageSummary(["read", "read", "edit", "read"]),
	"read ×3, edit",
);
assert.equal(toolUsageSummary([null, "", "write"]), "tool ×2, write");
assert.equal(toolUsageSummary(["Read", "read"]), "Read, read");
assert.equal(toolUsageSummary.length, 1);

assert.equal(toolGroupSummary(1, 1, 0), "1 tool · working");
assert.equal(toolGroupSummary(3, 0, 0, "400ms"), "3 tools · complete · 400ms");
assert.equal(toolGroupSummary(2, 0, 1, "1.2s"), "2 tools · 1 error · 1.2s");
assert.equal(toolGroupSummary(3, 2, 1), "3 tools · 1 error · working");

console.log("9 passed");
