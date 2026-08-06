/*
 * recent-sessions.js — head/tail metadata reader for pi session JSONL files.
 * Ported from pi-livecraft's server/pi-session-store.ts (MIT), vanilla CommonJS.
 *
 * A session file is append-only JSONL whose header ({type:"session"} → id/timestamp/
 * cwd) and first user prompt live near the START, while the newest activity lives at
 * the END. To list recent sessions we only need that metadata — never the gigabytes
 * of middle history (huge tool outputs). So we read only the first 64 KB (head) plus
 * a backward-scanned tail (64 KB chunks, ≤2 MB scan budget), joining them and parsing
 * line by line. Small files (≤ HEAD+TAIL) are read whole.
 *
 * Exact message count is only possible when the whole file fits in the window; for
 * larger files we report `size` (bytes, always accurate) and `messages:null` so the
 * UI can fall back to a humanized size instead of a misleading undercount.
 *
 * Exports: readHeadTail, parseSessionMeta, listRecentSessions (+ the tunables).
 * Plan 4.1 / F§4.1.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 64 * 1024;
const TAIL_SCAN_BUDGET = 2 * 1024 * 1024;
const MAX_SESSIONS = 30;

function isObject(v) {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

// One JSONL record, or null (non-{ lines, bad JSON, non-objects).
function parseLine(line) {
	if (!line || line[0] !== "{") return null;
	try {
		const v = JSON.parse(line);
		return isObject(v) ? v : null;
	} catch {
		return null;
	}
}

// True once the accumulated tail text holds at least one complete JSON line — the
// signal to stop scanning further back (we have the newest activity).
function hasParseableLine(text) {
	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (parseLine(lines[i])) return true;
	}
	return false;
}

// Reads head + backward-scanned tail and returns {text, truncated, size}. Sync
// (the server's session-list path is sync). fd is closed in finally.
function readHeadTail(fullPath) {
	const size = fs.statSync(fullPath).size;
	if (size <= HEAD_BYTES + TAIL_BYTES) {
		return { text: fs.readFileSync(fullPath, "utf8"), truncated: false, size };
	}
	const fd = fs.openSync(fullPath, "r");
	try {
		const headBuf = Buffer.alloc(HEAD_BYTES);
		const headBytes = fs.readSync(fd, headBuf, 0, HEAD_BYTES, 0);
		let tail = "";
		let position = size;
		let scanned = 0;
		while (position > HEAD_BYTES && scanned < TAIL_SCAN_BUDGET && !hasParseableLine(tail)) {
			const chunkSize = Math.min(TAIL_BYTES, position - HEAD_BYTES);
			position -= chunkSize;
			const chunk = Buffer.alloc(chunkSize);
			const bytesRead = fs.readSync(fd, chunk, 0, chunkSize, position);
			tail = chunk.subarray(0, bytesRead).toString("utf8") + tail;
			scanned += chunkSize;
		}
		return {
			text: headBuf.subarray(0, headBytes).toString("utf8") + tail,
			truncated: true,
			size,
		};
	} finally {
		fs.closeSync(fd);
	}
}

// Flatten a message's content (string | [{type:"text",text}] | other) to trimmed text.
function firstUserText(content) {
	let t = "";
	if (typeof content === "string") t = content;
	else if (Array.isArray(content)) {
		const parts = [];
		for (let i = 0; i < content.length; i++) {
			const b = content[i];
			if (isObject(b) && b.type === "text" && typeof b.text === "string") parts.push(b.text);
		}
		t = parts.join(" ");
	}
	return t.replace(/\s+/g, " ").trim();
}

// Parse head+tail text into session metadata, or null if it isn't a usable session
// (no header, or no messages). Pure — the unit-test workhorse.
function parseSessionMeta(text, sessionPath, size, truncated) {
	const lines = text.split("\n");
	const header = parseLine(lines[0]);
	if (
		!header ||
		header.type !== "session" ||
		typeof header.id !== "string" ||
		typeof header.timestamp !== "string" ||
		typeof header.cwd !== "string"
	)
		return null;

	let hasMessage = false;
	let name;
	let firstPrompt;
	let updatedAt;
	let messageCount = 0;

	for (let i = 1; i < lines.length; i++) {
		const v = parseLine(lines[i]);
		if (!v) continue;
		// A named session (set_session_name) — prefer it over the first-prompt fallback.
		if (v.type === "session_info" && typeof v.name === "string" && v.name.trim()) {
			name = v.name.trim();
			continue;
		}
		if (v.type !== "message") continue;
		messageCount++;
		const msg = isObject(v.message) ? v.message : null;
		if (!msg) continue;
		hasMessage = true;
		if (typeof v.timestamp === "string") {
			const ts = Date.parse(v.timestamp);
			if (!Number.isNaN(ts) && (updatedAt === undefined || ts > updatedAt)) updatedAt = ts;
		}
		if (firstPrompt === undefined && msg.role === "user") {
			const content = firstUserText(msg.content);
			if (content && !content.startsWith("/")) firstPrompt = content.slice(0, 160);
		}
	}
	if (!hasMessage) return null;

	const createdAt = Date.parse(header.timestamp);
	const finalUpdatedAt =
		updatedAt !== undefined ? updatedAt : Number.isNaN(createdAt) ? 0 : createdAt;
	return {
		id: header.id,
		cwd: header.cwd,
		createdAt: Number.isNaN(createdAt) ? null : createdAt,
		updatedAt: finalUpdatedAt,
		name: name || firstPrompt || "New session",
		firstPrompt: firstPrompt || "",
		// Exact only when the whole file was read; large files undercount, so hide it.
		messages: truncated ? null : messageCount,
		size,
		truncated,
		sessionPath,
	};
}

// Scan a session directory, parse each .jsonl's head+tail, drop unparseable/
// message-less files, sort by last activity (mtime tiebreak), cap the count.
function listRecentSessions(dir, opts) {
	const maxSessions = (opts && opts.maxSessions) || MAX_SESSIONS;
	let files = [];
	try {
		files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	} catch {
		return []; // no sessions dir yet (fresh project)
	}
	const out = [];
	for (let i = 0; i < files.length; i++) {
		const full = path.join(dir, files[i]);
		let mtime = 0;
		try {
			mtime = fs.statSync(full).mtimeMs;
		} catch {
			continue;
		}
		let rt;
		try {
			rt = readHeadTail(full);
		} catch {
			continue;
		}
		const meta = parseSessionMeta(rt.text, full, rt.size, rt.truncated);
		if (!meta) continue;
		out.push(Object.assign(meta, { mtime }));
	}
	out.sort((a, b) => (b.updatedAt || b.mtime) - (a.updatedAt || a.mtime));
	return out.slice(0, maxSessions);
}

module.exports = {
	readHeadTail,
	parseSessionMeta,
	listRecentSessions,
	HEAD_BYTES,
	TAIL_BYTES,
	TAIL_SCAN_BUDGET,
	MAX_SESSIONS,
};
