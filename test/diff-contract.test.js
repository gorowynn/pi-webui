// Static contract test — SDD editable-diff slice (tasks_editable-diff_07082026.md).
//
// Parses public/index.html, public/style.css, public/app.js, server.js with
// whitespace-insensitive regexes and asserts the FR contracts of the spec
// (spec_editable-diff_07082026.md). Written RED first: C-3.4 (T2) and C-3.8
// (T1) are green; C-3.1/2/5/6/7 flip when T5 lands, C-3.3 when T4 lands.
//
// Run: node test/diff-contract.test.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("public/index.html");
const css = read("public/style.css");
const app = read("public/app.js");
const server = read("server.js");

let passed = 0;
let failed = 0;
const failures = [];

function check(_group, id, fr, desc, cond) {
	try {
		assert.ok(cond, desc);
		passed++;
	} catch {
		failed++;
		failures.push(`${id} [${fr}] ${desc}`);
	}
}

// ---- Task 1/3: module load order + server version protocol (FR-12, FR-6) ----
check(
	"T1",
	"C-3.8",
	"FR-12",
	"index.html loads diff-view.js before app.js",
	html.indexOf('<script src="diff-view.js">') !== -1 &&
		html.indexOf('<script src="diff-view.js">') <
			html.indexOf('<script src="app.js">'),
);
check(
	"T2",
	"C-3.4a",
	"FR-6",
	"server.js /api/write requires expectedVersion",
	/expectedVersion/.test(server),
);
check(
	"T2",
	"C-3.4b",
	"FR-6",
	"server.js /api/file returns version",
	/\/api\/file[\s\S]{0,400}\bversion\b/.test(server),
);

// ---- Task 4: shared geometry vars (FR-1) ----
check(
	"T4",
	"C-3.3a",
	"FR-1",
	"style.css defines --sx-lh (fixed-px line height)",
	/--sx-lh\s*:\s*[0-9.]+px/.test(css),
);
check(
	"T4",
	"C-3.3b",
	"FR-1",
	"style.css defines --sx-gutter-pad",
	/--sx-gutter-pad/.test(css),
);
check(
	"T4",
	"C-3.3c",
	"FR-1",
	"style.css defines --sx-fs and --sx-font",
	/--sx-fs\s*:/.test(css) && /--sx-font\s*:/.test(css),
);

// ---- Task 5: overlay plane deleted (FR-3) ----
check(
	"T5",
	"C-3.1",
	"FR-3",
	"style.css has no -webkit-text-fill-color (transparent overlay gone)",
	!/-webkit-text-fill-color/.test(css),
);
check(
	"T5",
	"C-3.2",
	"FR-3",
	"style.css has no .sx-hlbody rule (overlay plane deleted)",
	!/\.sx-hlbody/.test(css),
);
check(
	"T5",
	"C-3.6",
	"FR-3",
	"app.js has no -webkit-text-fill-color usage",
	!/-webkit-text-fill-color/.test(app),
);
check(
	"T5",
	"C-3.5a",
	"FR-3",
	"app.js has an aria-pressed mode toggle",
	/\baria-pressed\b/.test(app),
);
check(
	"T5",
	"C-3.5b",
	"FR-3",
	"app.js has Review/Edit toggle labels",
	/\bReview\b/.test(app) && /\bEdit\b/.test(app),
);

// ---- Task 8: file-named editor (FR-8) ----
check(
	"T8",
	"C-3.7",
	"FR-8",
	"app.js sets a file-name aria-label on the diff textarea",
	/aria-label/.test(app) && /\.sx-ta/.test(app),
);

// ---- Contextual Git review diff (C4 / FR-7, FR-11, FR-12, FR-13) ----
check(
	"C4",
	"G-4.1",
	"FR-7/12",
	"app maps Git diff responses through the pure review state helper",
	/reviewDiffState\(/.test(app),
);
check(
	"C4",
	"G-4.2",
	"FR-11",
	"app exposes back, refresh, and selected-status hooks",
	/git-back/.test(app) && /git-refresh/.test(app) && /git-diff-status/.test(app),
);
check(
	"C4",
	"G-4.3",
	"FR-12",
	"server propagates bounded diff availability metadata",
	/unavailable:\s*result\.unavailable/.test(server),
);
check(
	"C4",
	"G-4.4",
	"FR-12/13",
	"diff styles bound review state and preformatted output",
	/\.git-diff-state/.test(css) && /max-height:\s*60vh/.test(css),
);

if (failures.length) {
	console.error("FAILED:");
	for (const f of failures) console.error("  " + f);
}
console.log(
	`\n${passed} passed, ${failed} failed${failed ? " (still red — pending tasks)" : ""}`,
);
if (failed) process.exitCode = 1;
