const assert = require("node:assert/strict");
const {
	usageViewKind,
	opencodeGoWindows,
} = require("../public/usage-provider.js");

assert.equal(usageViewKind("zai"), "zai-quota");
assert.equal(usageViewKind("openai-codex"), "codex-quota");
assert.equal(usageViewKind("opencode-go"), "opencode-go-quota");
assert.equal(usageViewKind("anthropic"), "session");

// opencode-bar fixture: Next-style __next_f.push with JSON-stringified props
// (\" escapes, handled by the entity normalization).
const escaped = `<script>
self.__next_f.push([1,"{\\"rollingUsage\\":{\\"usagePercent\\":12.5,\\"resetInSec\\":3600},\\"weeklyUsage\\":{\\"usagePercent\\":\\"25\\",\\"resetInSec\\":\\"7200\\"},\\"monthlyUsage\\":{\\"usagePercent\\":50,\\"resetInSec\\":10800}}"])
</script>`;
let w = opencodeGoWindows(escaped);
assert.deepEqual(w, {
	rollingUsage: { usagePercent: 12.5, resetInSec: 3600 },
	weeklyUsage: { usagePercent: 25, resetInSec: 7200 },
	monthlyUsage: { usagePercent: 50, resetInSec: 10800 },
});

// SolidStart serialized $R[..]={...} references (opencode-bar fixture).
const solid = `<script>$R[24]($R[18],$R[30]={mine:!0,useBalance:!0,rollingUsage:$R[31]={status:"ok",resetInSec:18000,usagePercent:0},weeklyUsage:$R[32]={status:"ok",resetInSec:162822,usagePercent:31},monthlyUsage:$R[33]={status:"ok",resetInSec:1404782,usagePercent:21}});</script>`;
w = opencodeGoWindows(solid);
assert.deepEqual(w, {
	rollingUsage: { usagePercent: 0, resetInSec: 18000 },
	weeklyUsage: { usagePercent: 31, resetInSec: 162822 },
	monthlyUsage: { usagePercent: 21, resetInSec: 1404782 },
});

// Partial windows are kept; missing ones are omitted (opencode-bar fixture).
w = opencodeGoWindows(
	'<script>self.__next_f.push([1,"{\\"rollingUsage\\":{\\"usagePercent\\":64,\\"resetInSec\\":900}}"])</script>',
);
assert.deepEqual(w, { rollingUsage: { usagePercent: 64, resetInSec: 900 } });

// Decoy objects with the same keys (referral previews: beforePercent /
// afterPercent, no usagePercent) can precede the real windows — the parser
// must skip them and keep the real ones.
const withDecoys =
	`<script>$R[1]($R[2]={weeklyUsage:{beforePercent:0,afterPercent:0,resetInSec:0},monthlyUsage:{beforePercent:0,afterPercent:0,resetInSec:0}});</script>` +
	`<script>$R[30]={mine:!0,useBalance:!0,rollingUsage:$R[31]={status:"ok",resetInSec:18000,usagePercent:0},weeklyUsage:$R[32]={status:"ok",resetInSec:162822,usagePercent:31},monthlyUsage:$R[33]={status:"ok",resetInSec:1404782,usagePercent:21}});</script>`;
assert.deepEqual(opencodeGoWindows(withDecoys), {
	rollingUsage: { usagePercent: 0, resetInSec: 18000 },
	weeklyUsage: { usagePercent: 31, resetInSec: 162822 },
	monthlyUsage: { usagePercent: 21, resetInSec: 1404782 },
});

// A login page / non-dashboard HTML yields nothing.
assert.deepEqual(opencodeGoWindows("<html><body>sign in</body></html>"), {});
assert.deepEqual(opencodeGoWindows(""), {});
assert.deepEqual(opencodeGoWindows(null), {});

console.log("usage provider classifier: pass");
console.log("opencode go dashboard parser: pass");
