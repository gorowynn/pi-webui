// test/git-review.test.js — pure review-state contract (C1).
const assert = require("node:assert/strict");
const {
	normalizeChangedFile,
	normalizeReviewSnapshot,
	reconcileReviewSelection,
	reviewDiffState,
	reviewTargetFromTool,
} = require("../public/git-review.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ✓ " + name);
};

// FR-6: status/count normalization -------------------------------------------
{
	const file = normalizeChangedFile({
		path: "src\\app.js",
		oldPath: "src\\old-app.js",
		status: "renamed",
		additions: "12",
		deletions: 3,
	});
	assert.deepEqual(file, {
		path: "src/app.js",
		oldPath: "src/old-app.js",
		status: "renamed",
		additions: 12,
		deletions: 3,
		diffAvailable: true,
	});
	assert.equal(
		normalizeChangedFile({ path: "x.bin", status: "binary" }).diffAvailable,
		false,
	);
	ok("normalizes paths, statuses, numeric counts, and binary availability (# FR-6)");
}

// FR-1/2/3/8: snapshot states and summary -------------------------------
{
	const ready = normalizeReviewSnapshot({
		repository: true,
		root: "D:/repo",
		branch: "feature/review",
		files: [
			{ path: "a.js", status: "modified", additions: 4, deletions: 1 },
			{ path: "b.js", status: "added", staged: true },
			{ path: "c.js", status: "untracked" },
		],
		summary: { staged: 1, unstaged: 1, untracked: 1 },
	});
	assert.equal(ready.state, "ready");
	assert.equal(ready.branch, "feature/review");
	assert.deepEqual(ready.summary, {
		changed: 3,
		staged: 1,
		unstaged: 1,
		untracked: 1,
		added: 1,
		modified: 1,
		deleted: 0,
		renamed: 0,
	});
	assert.equal(normalizeReviewSnapshot({ repository: true, files: [] }).state, "clean");
	assert.equal(normalizeReviewSnapshot({ repository: false }).state, "unavailable");
	assert.equal(normalizeReviewSnapshot({ ok: false, error: "git failed" }).state, "error");
	assert.equal(normalizeReviewSnapshot(null).state, "loading");
	ok("normalizes ready, clean, unavailable, error, and loading states (# FR-1–FR-3, FR-8)");
}

// FR-11/12/17/32: selection survives only in the active snapshot ---------
{
	const review = normalizeReviewSnapshot({
		repository: true,
		files: [
			{ path: "src/a.js", status: "modified" },
			{ path: "src/b.js", status: "deleted" },
		],
	});
	assert.deepEqual(reconcileReviewSelection(review, "src/a.js"), {
		path: "src/a.js",
		status: "modified",
	});
	assert.equal(reconcileReviewSelection(review, "src/missing.js"), null);
	assert.equal(reconcileReviewSelection({ state: "loading", files: [] }, "src/a.js"), null);
	ok("reconciles selected files against the current snapshot (# FR-11, FR-12, FR-17, FR-32)");
}

// FR-13/19/20/21: tool links are relative and conservative ---------------
{
	assert.deepEqual(
		reviewTargetFromTool("read", { path: "src\\app.js" }),
		{ path: "src/app.js", intent: "inspect" },
	);
	assert.deepEqual(
		reviewTargetFromTool("edit", { filePath: "src/app.js" }),
		{ path: "src/app.js", intent: "changed-file" },
	);
	for (const args of [
		{ path: "../outside.js" },
		{ path: "/etc/hosts" },
		{ path: "C:\\secret.txt" },
		{ command: "cat src/app.js" },
		{},
	]) {
		assert.equal(reviewTargetFromTool("read", args), null);
	}
	assert.equal(reviewTargetFromTool("bash", { path: "src/app.js" }), null);
	ok("rejects unsafe, ambiguous, and unsupported tool targets (# FR-13, FR-19–FR-21)");
}

// FR-7/12: bounded diff states -----------------------------------------------
{
	const ready = normalizeChangedFile({ path: "src/a.js", status: "modified" });
	assert.deepEqual(reviewDiffState(ready, { ok: true, diff: "@@ hunk" }), {
		state: "ready",
		diff: "@@ hunk",
		message: null,
	});
	assert.equal(
		reviewDiffState(
			normalizeChangedFile({ path: "image.png", status: "modified", binary: true }),
			{ ok: true, diff: "Binary files differ" },
		).state,
		"binary",
	);
	assert.equal(
		reviewDiffState(ready, { ok: true, diff: "", unavailable: "oversized" }).state,
		"oversized",
	);
	assert.equal(
		reviewDiffState(
			normalizeChangedFile({ path: "gone.js", status: "deleted" }),
			{ ok: false, error: "file no longer exists" },
		).state,
		"deleted",
	);
	assert.equal(reviewDiffState(null, { ok: true, diff: "x" }).state, "stale");
	ok("maps ready, binary, oversized, deleted, and stale diff responses (# FR-7, FR-12)");
}

console.log(`\ngit-review.test.js — C1/C4 helpers: ${passed} passed`);
