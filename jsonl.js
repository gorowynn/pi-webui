"use strict";
// Strict JSON Lines codec — factors the inline buf+StringDecoder loop that used
// to live inside server.js's pi-stdout reader (plan F§4.5). Two pieces:
//
//   encodeJsonLine(obj) -> JSON.stringify(obj) + "\n"
//   new JsonLineDecoder()  .push(bufferChunk, cb)        (chunk -> parsed objs)
//
// The decoder splits on "\n" only, strips a trailing "\r", and buffers
// incomplete UTF-8 across chunks via StringDecoder (so a multibyte char split
// on a stdout seam decodes instead of becoming U+FFFD — GOTCHAS #1/#2). It also
// enforces a per-record byte cap as defense-in-depth against a runaway line that
// never hits a newline (a misbehaving pi stream could otherwise grow `buf`
// without bound). Non-JSON lines are dropped, exactly as the old inline reader
// did.
//
// Pure CommonJS, no deps. Self-test: `node -e "console.log(require('./jsonl.js').encodeJsonLine({a:1}))"`.

const { StringDecoder } = require("string_decoder");

// 8 MiB per line. Legacy/integration records are normally small (a few KB to maybe a low-MB
// get_messages on a huge session); this is a runaway guard, not a tight limit.
const DEFAULT_MAX_RECORD = 8 * 1024 * 1024;

function encodeJsonLine(obj) {
	return JSON.stringify(obj) + "\n";
}

class JsonLineDecoder {
	constructor(maxRecordBytes) {
		this._dec = new StringDecoder("utf8");
		this._buf = "";
		this._max = maxRecordBytes || DEFAULT_MAX_RECORD;
	}

	// Feed a Buffer chunk; cb(obj) is invoked once per complete, parseable record.
	// Never throws — a malformed/oversized line is skipped (same posture as the
	// old reader, which `continue`s on JSON.parse failure).
	push(chunk, cb) {
		this._buf += this._dec.write(chunk);
		// Process every complete record first (split on \n, strip \r). Each line is
		// individually capped: a single oversized record is skipped, not buffered.
		let i;
		while ((i = this._buf.indexOf("\n")) !== -1) {
			let line = this._buf.slice(0, i);
			this._buf = this._buf.slice(i + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line) continue;
			if (line.length > this._max) continue; // single oversized record — skip
			let obj;
			try {
				obj = JSON.parse(line);
			} catch {
				continue;
			} // ignore non-JSON noise on pi's stdout
			cb(obj);
		}
		// Runaway-line guard: after the loop, _buf holds only the partial tail (no
		// newline yet). If THAT exceeds the cap, a misbehaving stream is emitting
		// one endless line — drop the tail so it can't grow without bound. The
		// next newline resets cleanly; completed records above were already emitted.
		if (this._buf.length > this._max) this._buf = "";
	}
}

module.exports = { encodeJsonLine, JsonLineDecoder, DEFAULT_MAX_RECORD };
