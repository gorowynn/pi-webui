// Compact tool-group summary is pure presentation state; keep its wording stable.
const assert = require("node:assert/strict");
const { toolGroupSummary } = require("../public/tool-presentation.js");

assert.equal(toolGroupSummary(1, 1, 0), "1 tool · working");
assert.equal(toolGroupSummary(3, 0, 0, "400ms"), "3 tools · complete · 400ms");
assert.equal(toolGroupSummary(2, 0, 1, "1.2s"), "2 tools · 1 error · 1.2s");
assert.equal(toolGroupSummary(3, 2, 1), "3 tools · 1 error · working");

console.log("4 passed");
