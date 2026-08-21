// test/git-review-contract.test.js — C3 Changes-surface source contract.
// Tests first: this file is intentionally red until the contextual Git rail is wired.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const html = read("public/index.html");
const css = read("public/style.css");
const app = read("public/app.js");
const server = read("server.js");

let passed = 0;
let failed = 0;
function check(name, condition) {
	try {
		assert.ok(condition, name);
		passed++;
		console.log("  ✓ " + name);
	} catch {
		failed++;
		console.error("  ✗ " + name);
	}
}

check(
	"git-review.js is whitelisted and loaded before app.js",
	server.includes('"/git-review.js"') &&
		html.indexOf('src="git-review.js"') < html.indexOf('src="app.js"'),
);
check(
	"Git rail exposes Changes/Files tab hooks",
	/data-git-tab/.test(app) && /role[=:]\s*["']tab/.test(app),
);
check(
	"Git rail normalizes snapshot state before rendering",
	/normalizeReviewSnapshot/.test(app),
);
check(
	"Git rail renders an explicit summary and file metadata",
	/git-summary/.test(app) && /git-status/.test(app) && /git-count/.test(app),
);
check(
	"Git rail has explicit clean and unavailable copy",
	/no changes/i.test(app) && /git unavailable/i.test(app),
);
check(
	"Git rail keeps generation-stamped stale response protection",
	/railGen\.stale\(g\)/.test(app),
);
check(
	"Git review styles bound tabs, rows, and long paths",
	/\.git-tabs/.test(css) && /\.git-file/.test(css) && /overflow-wrap/.test(css),
);
check(
	"Git review controls expose accessible names and selected state",
	/aria-label/.test(app) && /aria-selected/.test(app),
);

console.log(`git-review-contract: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
