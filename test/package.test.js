// REL-01: published npm package must ship every root runtime module.
// Static guard: every root `require("./x.js")` in server.js/bin.js must be in
// package.json#files. Faster than npm pack in CI and catches the same class
// of omission. Spot-check with: npm pack --dry-run --json.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
} catch (e) {
  assert.fail(`package.json unreadable or invalid: ${e.message}`);
}
const whitelist = new Set(pkg.files);

// all root-level relative requires across the shipped entry/runtime files
const entries = ["server.js", "bin.js", ...pkg.files.filter((f) => f.endsWith(".js"))];
const required = new Set();
for (const entry of entries) {
  const src = fs.readFileSync(path.join(root, entry), "utf8");
  for (const m of src.matchAll(/require\(["']\.\/([a-zA-Z0-9_.-]+\.js)["']\)/g)) {
    const mod = m[1];
    // only root-level runtime modules matter for the pack whitelist
    if (!mod.includes("/") && fs.existsSync(path.join(root, mod))) required.add(mod);
  }
}

const missing = [...required].filter((m) => !whitelist.has(m) && !whitelist.has(`./${m}`));
assert.deepEqual(missing, [], `runtime modules missing from package.json#files: ${missing.join(", ")}`);
console.log(`package whitelist covers all ${required.size} root runtime modules`);
