/*
 * diff-view.test.js — node:assert/strict unit tests for public/diff-view.js
 * (plan A5, task T1). Covers LCS row alignment (equal/unequal change runs,
 * empty/final lines, tabs, Unicode), the monotonic gutter reserve (T1.6),
 * the dirty helper (T1.7), the large-hunk cell guard (T1.8), and
 * lineCountOf. Written red first.
 */

const assert = require("assert/strict");
const dv = require("../public/diff-view.js");

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
function eq(name, actual, expected) {
	ok(name + " === " + JSON.stringify(expected), actual === expected);
}
function rowsEq(name, actual, expected) {
	ok(
		name + " === " + JSON.stringify(expected),
		JSON.stringify(actual) === JSON.stringify(expected),
	);
}

// T1.1 equal-run alignment: identical inputs → ctx rows, no change rows.
rowsEq("T1.1 equal runs", dv.diffRows("a\nb\nc", "a\nb\nc"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "ctx", left: "b", right: "b" },
	{ kind: "ctx", left: "c", right: "c" },
]);
rowsEq("T1.1 diffLines equal tokens", dv.diffLines("a\nb", "a\nb"), [
	{ t: "ctx", s: "a" },
	{ t: "ctx", s: "b" },
]);

// T1.2 unequal change runs: matched del+add zips to 'mod'; lone del/add
// leaves the opposite side null; trailing runs drain in order.
rowsEq("T1.2 mod middle", dv.diffRows("a\nb\nc\nd", "a\nx\nc\nd"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "mod", left: "b", right: "x" },
	{ kind: "ctx", left: "c", right: "c" },
	{ kind: "ctx", left: "d", right: "d" },
]);
rowsEq("T1.2 pure add", dv.diffRows("a", "a\nb"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "add", left: null, right: "b" },
]);
rowsEq("T1.2 pure del", dv.diffRows("a\nb", "a"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "del", left: "b", right: null },
]);
rowsEq(
	"T1.2 unbalanced run zips then drains",
	dv.diffRows("a\nb\nc", "a\nX\nY\nc"),
	[
		{ kind: "ctx", left: "a", right: "a" },
		{ kind: "mod", left: "b", right: "X" },
		{ kind: "add", left: null, right: "Y" },
		{ kind: "ctx", left: "c", right: "c" },
	],
);
rowsEq("T1.2 full replace", dv.diffRows("a\nb", "x\ny"), [
	{ kind: "mod", left: "a", right: "x" },
	{ kind: "mod", left: "b", right: "y" },
]);

// T1.3 empty/final lines: empty strings are real lines; a trailing newline
// is a final empty line; empty/null inputs yield no rows.
rowsEq("T1.3 add into empty", dv.diffRows("", "x"), [
	{ kind: "add", left: null, right: "x" },
]);
rowsEq("T1.3 del to empty", dv.diffRows("x", ""), [
	{ kind: "del", left: "x", right: null },
]);
rowsEq("T1.3 trailing newline removed", dv.diffRows("a\n", "a"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "del", left: "", right: null },
]);
rowsEq("T1.3 trailing newline added", dv.diffRows("a", "a\n"), [
	{ kind: "ctx", left: "a", right: "a" },
	{ kind: "add", left: null, right: "" },
]);
rowsEq("T1.3 both empty", dv.diffRows("", ""), []);
rowsEq("T1.3 null old", dv.diffRows(null, "x"), [
	{ kind: "add", left: null, right: "x" },
]);

// T1.4 tabs: whitespace is preserved verbatim in row text.
rowsEq("T1.4 tabs preserved", dv.diffRows("a\tb", "a\tb"), [
	{ kind: "ctx", left: "a\tb", right: "a\tb" },
]);
rowsEq("T1.4 tab vs spaces mod", dv.diffRows("a\tb", "a  b"), [
	{ kind: "mod", left: "a\tb", right: "a  b" },
]);

// T1.5 Unicode: multi-byte and astral text splits and aligns on \n only.
rowsEq("T1.5 latin-1 accent", dv.diffRows("héllo\nwörld", "héllo\nwörld"), [
	{ kind: "ctx", left: "héllo", right: "héllo" },
	{ kind: "ctx", left: "wörld", right: "wörld" },
]);
rowsEq("T1.5 cjk + add", dv.diffRows("日本語", "日本語\nEnglish"), [
	{ kind: "ctx", left: "日本語", right: "日本語" },
	{ kind: "add", left: null, right: "English" },
]);
rowsEq("T1.5 astral pairs", dv.diffRows("💾\n📁", "💾\n📁"), [
	{ kind: "ctx", left: "💾", right: "💾" },
	{ kind: "ctx", left: "📁", right: "📁" },
]);

// T1.6 gutterReserveCh: (digits+1)ch of the max line count, minimum 2ch,
// monotonic — grows with line counts, never shrinks.
eq("T1.6 floor 2ch (0)", dv.gutterReserveCh(0, undefined), 2);
eq("T1.6 floor 2ch (9)", dv.gutterReserveCh(9, undefined), 2);
eq("T1.6 2 digits → 3ch", dv.gutterReserveCh(10, undefined), 3);
eq("T1.6 2 digits (99)", dv.gutterReserveCh(99, undefined), 3);
eq("T1.6 3 digits → 4ch", dv.gutterReserveCh(100, undefined), 4);
eq("T1.6 4 digits → 5ch", dv.gutterReserveCh(9999, undefined), 5);
eq("T1.6 grows with current", dv.gutterReserveCh(10, 2), 3);
eq("T1.6 never shrinks (10,5)", dv.gutterReserveCh(10, 5), 5);
eq("T1.6 never shrinks (99,5)", dv.gutterReserveCh(99, 5), 5);
eq("T1.6 keeps larger reserve (100,5)", dv.gutterReserveCh(100, 5), 5);

// T1.7 dirty: strict inequality of baseline vs current proposal text.
eq("T1.7 clean", dv.dirty("abc", "abc"), false);
eq("T1.7 empty clean", dv.dirty("", ""), false);
eq("T1.7 drift", dv.dirty("abc", "abd"), true);
eq("T1.7 multiline drift", dv.dirty("a\nb", "a\nc"), true);
eq("T1.7 null base vs empty", dv.dirty(null, ""), true);

// T1.8 largeHunkExceeds: O(n*m) cell guard mirroring compute's on*nn > limit.
eq("T1.8 small", dv.largeHunkExceeds(100, 100), false);
eq("T1.8 at cap", dv.largeHunkExceeds(2000, 2000), false);
eq("T1.8 over cap", dv.largeHunkExceeds(2000, 2001), true);
eq("T1.8 zero rows", dv.largeHunkExceeds(0, 5), false);
eq("T1.8 null rows", dv.largeHunkExceeds(null, 10), false);
eq("T1.8 custom limit over", dv.largeHunkExceeds(10, 3, 20), true);
eq("T1.8 custom limit at", dv.largeHunkExceeds(10, 2, 20), false);

// lineCountOf: mirrors compute's on/nn derivation ("" and null → 0).
eq("T1 lineCountOf null", dv.lineCountOf(null), 0);
eq("T1 lineCountOf empty", dv.lineCountOf(""), 0);
eq("T1 lineCountOf single", dv.lineCountOf("a"), 1);
eq("T1 lineCountOf trailing nl", dv.lineCountOf("a\n"), 2);
eq("T1 lineCountOf two", dv.lineCountOf("a\nb"), 2);

// API shape sanity.
ok(
	"T1 module exports functions",
	typeof dv.diffRows === "function" && typeof dv.diffLines === "function",
);
ok(
	"T1 dual-mode exports",
	typeof module !== "undefined" &&
		module.exports &&
		!(typeof window !== "undefined" && window.diffView),
);

console.log("\n" + pass + " passed");
