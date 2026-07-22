const assert = require("node:assert/strict");
const { usageViewKind } = require("../public/usage-provider.js");

assert.equal(usageViewKind("zai"), "zai-quota");
assert.equal(usageViewKind("openai-codex"), "codex-quota");
assert.equal(usageViewKind("anthropic"), "session");

console.log("usage provider classifier: pass");
