/*
 * git.test.js — zero-dependency tests for git.js pure helpers and parsers.
 * (getGitSnapshot/getGitFileDiff need a real git repo; covered by the manual
 * smoke test, not here.) Plan 4.5.
 */

const {
	parseGitStatus,
	parseGitNameStatus,
	mergeNumstats,
	parseNumstat,
	summarizeGitChanges,
	boundedGitDiff,
	statusFor,
	numberOrNull,
	gitExecutableForPlatform,
	sanitizeWindowsPathExt,
} = require("../git.js");

let pass = 0;
function ok(name, cond) {
	if (cond) {
		pass++;
		console.log("  ok - " + name);
	} else {
		console.error("  FAIL - " + name);
		process.exitCode = 1;
	}
}

// ===== executable selection: avoid Windows PATHEXT/cwd collisions =====
(() => {
	ok(
		"Windows uses explicit git.exe",
		gitExecutableForPlatform("win32") === "git.exe",
	);
	ok("POSIX keeps bare git", gitExecutableForPlatform("linux") === "git");

	const winEnv = {
		PathExt: ".COM;.EXE;.JS;.JSE;.js;.CMD",
		KEEP: "yes",
	};
	ok(
		"Windows removes every .JS PATHEXT entry",
		sanitizeWindowsPathExt(winEnv, "win32") === winEnv &&
			winEnv.PathExt === ".COM;.EXE;.JSE;.CMD",
	);
	ok("Windows preserves unrelated environment entries", winEnv.KEEP === "yes");

	const posixEnv = { PATHEXT: ".JS;.EXE" };
	sanitizeWindowsPathExt(posixEnv, "linux");
	ok("POSIX leaves PATHEXT unchanged", posixEnv.PATHEXT === ".JS;.EXE");
})();

// ===== statusFor: porcelain code → status =====
(() => {
	ok("?? → added", statusFor("??") === "added");
	ok("A → added", statusFor("A ") === "added");
	ok(" M → modified", statusFor(" M") === "modified");
	ok("M  → modified", statusFor("M ") === "modified");
	ok("MM → modified", statusFor("MM") === "modified");
	ok("D → deleted", statusFor("D ") === "deleted");
	ok("R → renamed", statusFor("R ") === "renamed");
	ok("?? with content flag still added", statusFor("??") === "added");
})();

// ===== numberOrNull =====
(() => {
	ok("numberOrNull 42", numberOrNull("42") === 42);
	ok("numberOrNull '-' → null (binary)", numberOrNull("-") === null);
	ok("numberOrNull garbage → null", numberOrNull("x") === null);
})();

// ===== parseGitStatus: porcelain -z output =====
(() => {
	// " M file.js\0?? new.txt\0A  staged.js\0\0" (trailing empty = terminator)
	const out = " M file.js\0?? new.txt\0A  staged.js\0\0";
	const changes = parseGitStatus(out);
	ok("parses 3 changes", changes.length === 3);
	ok(
		"file.js modified",
		changes[0].path === "file.js" && changes[0].status === "modified",
	);
	ok(
		"new.txt added (untracked)",
		changes[1].path === "new.txt" && changes[1].status === "added",
	);
	ok(
		"staged.js added",
		changes[2].path === "staged.js" && changes[2].status === "added",
	);
})();

(() => {
	// rename entry consumes an extra \0 field (the source path)
	const out = "R  new.js\0old.js\0 M other.js\0\0";
	const changes = parseGitStatus(out);
	ok("rename: 2 changes (extra field consumed)", changes.length === 2);
	ok(
		"rename target is new.js",
		changes[0].path === "new.js" && changes[0].status === "renamed",
	);
	ok(
		"rename preserves old.js and staged flag",
		changes[0].oldPath === "old.js" &&
			changes[0].staged === true &&
			changes[0].unstaged === false,
	);
	ok(
		"next entry parsed correctly after rename",
		changes[1].path === "other.js",
	);
})();

(() => {
	ok("empty status → []", parseGitStatus("\0").length === 0);
	const changes = parseGitStatus(
		" M work.js\0?? new.txt\0 D gone.js\0A  staged.js\0\0",
	);
	ok(
		"status flags distinguish staged, unstaged, and untracked",
		changes[0].unstaged === true &&
			changes[1].untracked === true &&
			changes[2].unstaged === true &&
			changes[3].staged === true,
	);
})();

// ===== Git review summary + bounded diff metadata =====
(() => {
	const summary = summarizeGitChanges([
		{ status: "added", staged: true },
		{ status: "modified", unstaged: true },
		{ status: "untracked", untracked: true },
		{ status: "deleted", staged: true },
		{ status: "renamed", unstaged: true },
	]);
	ok(
		"summary counts staged/unstaged/untracked and statuses",
		JSON.stringify(summary) ===
			JSON.stringify({
				changed: 5,
				staged: 2,
				unstaged: 2,
				untracked: 1,
				added: 1,
				modified: 1,
				deleted: 1,
				renamed: 1,
			}),
	);
	ok(
		"bounded diff keeps small output",
		boundedGitDiff("a.js", "@@ small", 32).unavailable === null,
	);
	const oversized = boundedGitDiff("a.js", "x".repeat(33), 32);
	ok(
		"bounded diff returns an explanatory oversized state",
		oversized.diff === "" && oversized.unavailable === "oversized",
	);
})();

// ===== parseNumstat =====
(() => {
	const out = "10\t2\tsrc/a.js\0\t-\tbinary.png\0\0";
	const counts = parseNumstat(out);
	ok("2 numstat entries", counts.length === 2);
	ok(
		"a.js +10 -2",
		counts[0].path === "src/a.js" &&
			counts[0].additions === 10 &&
			counts[0].deletions === 2,
	);
	ok(
		"binary deletions null",
		counts[1].path === "binary.png" && counts[1].deletions === null,
	);
})();

(() => {
	// git diff --numstat -z emits a rename as TWO normal entries: the new path
	// (additions) and the old path (deletions). No special old\0new pair.
	const out = "5\t1\tnew.js\0" + "0\t3\told.js\0\0";
	const counts = parseNumstat(out);
	ok("rename numstat → 2 entries (new + old)", counts.length === 2);
	ok(
		"new path entry",
		counts[0].path === "new.js" && counts[0].additions === 5,
	);
	ok(
		"old path entry",
		counts[1].path === "old.js" && counts[1].deletions === 3,
	);
})();

// ===== mergeNumstats: sums across staged + unstaged =====
(() => {
	const unstaged = "10\t2\ta.js\0\0";
	const staged = "5\t1\ta.js\0 3\t0\tb.js\0\0";
	const merged = mergeNumstats(unstaged, staged);
	ok(
		"a.js merged +15 -3",
		merged.get("a.js").additions === 15 && merged.get("a.js").deletions === 3,
	);
	ok(
		"b.js +3 -0",
		merged.get("b.js").additions === 3 && merged.get("b.js").deletions === 0,
	);
})();

(() => {
	// null (binary) + number shouldn't NaN the merge
	const a = "-\t-\tbin.png\0\0";
	const b = "4\t1\tbin.png\0\0";
	const merged = mergeNumstats(a, b);
	ok(
		"binary null + number → number (not NaN)",
		merged.get("bin.png").additions === 4,
	);
})();

// ===== parseGitNameStatus (diff-tree --name-status -z) =====
(() => {
	const out = "M\0src/a.js\0A\0src/b.js\0R100\0old.js\0new.js\0\0";
	const changes = parseGitNameStatus(out);
	ok("3 name-status changes", changes.length === 3);
	ok(
		"a.js modified",
		changes[0].path === "src/a.js" && changes[0].status === "modified",
	);
	ok(
		"b.js added",
		changes[1].path === "src/b.js" && changes[1].status === "added",
	);
	ok(
		"rename → new.js renamed",
		changes[2].path === "new.js" && changes[2].status === "renamed",
	);
	ok("name-status rename preserves old.js", changes[2].oldPath === "old.js");
})();

console.log("\n" + pass + " passed");
