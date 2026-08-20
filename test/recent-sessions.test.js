/*
 * recent-sessions.test.js — node:assert/strict unit tests for recent-sessions.js.
 * Covers the pure parser (metadata extraction) + the head/tail reader (real temp
 * files) + the directory lister. Plan 4.1.
 */
"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	parseSessionMeta,
	readHeadTail,
	listRecentSessions,
} = require("../recent-sessions.js");

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

// ---- helpers to build fake session text ----
function header(id, cwd, ts) {
	return JSON.stringify({ type: "session", id, timestamp: ts, cwd });
}
function msg(role, text, ts, id) {
	return JSON.stringify({
		type: "message",
		id: id || "m" + Math.random().toString(36).slice(2, 6),
		parentId: null,
		timestamp: ts,
		message: { role, content: [{ type: "text", text }] },
	});
}

// ===== parseSessionMeta (pure) =====
(function () {
	const text = [
		header("sess-1", "/proj", "2026-01-01T10:00:00.000Z"),
		msg("user", "hello world", "2026-01-01T10:00:05.000Z"),
		msg("assistant", "hi", "2026-01-01T10:00:10.000Z"),
		msg("user", "second question here", "2026-01-01T10:05:00.000Z"),
	].join("\n");
	const m = parseSessionMeta(text, "/p/sess-1.jsonl", 400, false);
	ok("returns metadata object", m && m.id === "sess-1");
	ok("cwd recovered from header", m.cwd === "/proj");
	ok("firstPrompt is first user message", m.firstPrompt === "hello world");
	ok("name falls back to firstPrompt", m.name === "hello world");
	ok("updatedAt is the LATEST message timestamp", m.updatedAt === Date.parse("2026-01-01T10:05:00.000Z"));
	ok("createdAt from header", m.createdAt === Date.parse("2026-01-01T10:00:00.000Z"));
	ok("messages counted exactly (not truncated)", m.messages === 3);
	ok("truncated flag passed through", m.truncated === false);
	ok("sessionPath passed through", m.sessionPath === "/p/sess-1.jsonl");
})();

// ===== no header -> null =====
(function () {
	const text = msg("user", "no header", "2026-01-01T10:00:00.000Z");
	ok("null when no session header", parseSessionMeta(text, "/p", 10, false) === null);
})();

// ===== header but no messages -> null =====
(function () {
	const text = header("s2", "/proj", "2026-01-01T10:00:00.000Z");
	ok("null when header but no messages", parseSessionMeta(text, "/p", 10, false) === null);
})();

// ===== truncated hides message count =====
(function () {
	const text = [
		header("s3", "/proj", "2026-01-01T10:00:00.000Z"),
		msg("user", "hi", "2026-01-01T10:00:05.000Z"),
	].join("\n");
	const m = parseSessionMeta(text, "/p", 999999, true);
	ok("messages null when truncated", m.messages === null);
	ok("size passed through", m.size === 999999);
})();

// ===== session_info name takes precedence over firstPrompt =====
(function () {
	const text = [
		header("s4", "/proj", "2026-01-01T10:00:00.000Z"),
		JSON.stringify({ type: "session_info", name: "  My Cool Session  " }),
		msg("user", "first prompt text", "2026-01-01T10:00:05.000Z"),
	].join("\n");
	const m = parseSessionMeta(text, "/p", 10, false);
	ok("name from session_info (trimmed)", m.name === "My Cool Session");
	ok("firstPrompt still captured separately", m.firstPrompt === "first prompt text");
})();

// ===== slash-command first message is skipped as firstPrompt =====
(function () {
	const text = [
		header("s5", "/proj", "2026-01-01T10:00:00.000Z"),
		msg("user", "/clear", "2026-01-01T10:00:05.000Z"),
		msg("user", "real question", "2026-01-01T10:00:10.000Z"),
	].join("\n");
	const m = parseSessionMeta(text, "/p", 10, false);
	ok("slash-command skipped as firstPrompt", m.firstPrompt === "real question");
	ok("name falls back to non-slash firstPrompt", m.name === "real question");
})();

// ===== no usable firstPrompt -> generic name =====
(function () {
	const text = [
		header("s6", "/proj", "2026-01-01T10:00:00.000Z"),
		msg("assistant", "no user here", "2026-01-01T10:00:05.000Z"),
	].join("\n");
	const m = parseSessionMeta(text, "/p", 10, false);
	ok("generic name when no user prompt", m.name === "New session");
	ok("firstPrompt empty string", m.firstPrompt === "");
})();

// ===== updatedAt falls back to createdAt when messages have no timestamp =====
(function () {
	const text = [
		header("s7", "/proj", "2026-01-01T10:00:00.000Z"),
		JSON.stringify({ type: "message", id: "x", parentId: null, message: { role: "user", content: "x" } }),
	].join("\n");
	const m = parseSessionMeta(text, "/p", 10, false);
	ok("updatedAt falls back to createdAt", m.updatedAt === Date.parse("2026-01-01T10:00:00.000Z"));
})();

// ===== readHeadTail: small file read whole =====
(function () {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
	const f = path.join(dir, "small.jsonl");
	const content = [header("h", "/p", "2026-01-01T10:00:00.000Z"), msg("user", "hi", "2026-01-01T10:00:01.000Z")].join("\n");
	fs.writeFileSync(f, content, "utf8");
	const rt = readHeadTail(f);
	ok("small file not truncated", rt.truncated === false);
	ok("small file size accurate", rt.size === Buffer.byteLength(content, "utf8"));
	ok("small file text is full content", rt.text === content);
	fs.rmSync(dir, { recursive: true, force: true });
})();

// ===== readHeadTail: large file truncated, head+tail joined =====
(function () {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
	const f = path.join(dir, "big.jsonl");
	const headLine = header("big", "/p", "2026-01-01T10:00:00.000Z");
	// Pad middle with a huge line so the file exceeds HEAD+TAIL (128 KB).
	const pad = "X".repeat(300 * 1024);
	const tailLine = msg("user", "TAIL_MARKER", "2026-01-02T10:00:00.000Z");
	fs.writeFileSync(f, headLine + "\n" + JSON.stringify({ type: "message", id: "pad", parentId: null, message: { role: "user", content: pad } }) + "\n" + tailLine + "\n", "utf8");
	const rt = readHeadTail(f);
	ok("large file truncated", rt.truncated === true);
	ok("head present (header line at start)", rt.text.indexOf('"type":"session"') >= 0 && rt.text.startsWith(headLine));
	ok("tail present (TAIL_MARKER found)", rt.text.indexOf("TAIL_MARKER") >= 0);
	ok("middle padding excluded", rt.text.indexOf(pad) < 0);
	// And the joined text still parses into valid metadata:
	const m = parseSessionMeta(rt.text, f, rt.size, rt.truncated);
	ok("truncated file still yields metadata", m && m.id === "big");
	ok("truncated file updatedAt from tail", m && m.updatedAt === Date.parse("2026-01-02T10:00:00.000Z"));
	ok("truncated file messages hidden", m && m.messages === null);
	fs.rmSync(dir, { recursive: true, force: true });
})();

// ===== listRecentSessions: scans dir, sorts by updatedAt, caps, drops junk =====
(function () {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rs-"));
	// older session
	fs.writeFileSync(
		path.join(dir, "a.jsonl"),
		[header("old", "/p", "2026-01-01T10:00:00.000Z"), msg("user", "old", "2026-01-01T11:00:00.000Z")].join("\n"),
		"utf8",
	);
	// newer session
	fs.writeFileSync(
		path.join(dir, "b.jsonl"),
		[header("new", "/p", "2026-01-02T10:00:00.000Z"), msg("user", "new", "2026-01-02T12:00:00.000Z")].join("\n"),
		"utf8",
	);
	// junk file (no header) — must be dropped
	fs.writeFileSync(path.join(dir, "junk.jsonl"), "not a session\n", "utf8");
	// non-jsonl file — ignored
	fs.writeFileSync(path.join(dir, "readme.txt"), "hi", "utf8");
	const list = listRecentSessions(dir);
	ok("list drops junk + non-jsonl, keeps 2", list.length === 2);
	ok("sorted newest-first by updatedAt", list[0].id === "new" && list[1].id === "old");
	// cap test: add 3 more, cap at 3
	for (let i = 0; i < 3; i++) {
		fs.writeFileSync(
			path.join(dir, "c" + i + ".jsonl"),
			[header("c" + i, "/p", "2026-01-0" + (3 + i) + "T10:00:00.000Z"), msg("user", "c", "2026-01-0" + (3 + i) + "T11:00:00.000Z")].join("\n"),
			"utf8",
		);
	}
	const capped = listRecentSessions(dir, { maxSessions: 3 });
	ok("respects maxSessions cap", capped.length === 3);
	ok("cap keeps the newest 3", capped[0].id === "c2" && capped[1].id === "c1" && capped[2].id === "c0");
	fs.rmSync(dir, { recursive: true, force: true });
})();

// ===== listRecentSessions: missing dir -> [] =====
(function () {
	ok("missing directory returns []", listRecentSessions("/no/such/dir/xyz").length === 0);
})();

console.log("\n" + pass + " passed");
