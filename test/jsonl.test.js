// Unit tests for jsonl.js — plain node:assert/strict, no framework.
// Run: node test/jsonl.test.js

const assert = require("node:assert/strict");
const { encodeJsonLine, JsonLineDecoder } = require("../jsonl.js");

let passed = 0;
const ok = (name) => {
	passed++;
	console.log("  ok -", name);
};

// ── encodeJsonLine ──────────────────────────────────────────────────────────
{
	const out = encodeJsonLine({ a: 1, b: "x" });
	assert.equal(out, '{"a":1,"b":"x"}\n', "encode = JSON + newline");
	ok("encodeJsonLine: JSON + trailing \\n");
}
{
	assert.equal(encodeJsonLine(null), "null\n", "null encodes");
	assert.equal(encodeJsonLine([1, 2]), "[1,2]\n", "array encodes");
	ok("encodeJsonLine: null + arrays");
}

// ── JsonLineDecoder ─────────────────────────────────────────────────────────
function decodeChunks(chunks, maxBytes) {
	const d = new JsonLineDecoder(maxBytes);
	const out = [];
	for (const c of chunks) d.push(Buffer.from(c, "utf8"), (o) => out.push(o));
	return out;
}

{
	const got = decodeChunks(['{"a":1}\n{"b":2}\n']);
	assert.deepEqual(got, [{ a: 1 }, { b: 2 }], "two records in one chunk");
	ok("two records in one chunk");
}
{
	// CRLF line endings: the \r must be stripped before JSON.parse.
	const got = decodeChunks(['{"a":1}\r\n']);
	assert.deepEqual(got, [{ a: 1 }], "trailing \\r stripped");
	ok("CRLF: trailing \\r stripped");
}
{
	// record split across chunks (byte seam)
	const got = decodeChunks(['{"a":"', "hel", 'lo"}\n']);
	assert.deepEqual(got, [{ a: "hello" }], "record across chunks");
	ok("record split across chunks");
}
{
	// multibyte char split on a chunk boundary — must NOT become U+FFFD.
	const snowman = "λ"; // 2-byte UTF-8
	const idx = '{"a":"' + snowman + '"}\n';
	const splitAt = '{"a":"'.length + 1; // split inside the multibyte sequence
	const got = decodeChunks([idx.slice(0, splitAt), idx.slice(splitAt)]);
	assert.deepEqual(got, [{ a: snowman }], "multibyte char across chunk boundary");
	assert.equal(got[0] && got[0].a, snowman, "no U+FFFD replacement");
	ok("multibyte UTF-8 survives a chunk seam (GOTCHAS #1/#2)");
}
{
	// non-JSON line is dropped (not thrown)
	const got = decodeChunks(["not json\n{\"a\":1}\n"]);
	assert.deepEqual(got, [{ a: 1 }], "non-JSON line dropped");
	ok("non-JSON line dropped, parsing resumes");
}
{
	// blank lines skipped
	const got = decodeChunks(["\n{\"a\":1}\n\n"]);
	assert.deepEqual(got, [{ a: 1 }], "blank lines skipped");
	ok("blank lines skipped");
}
{
	// a single record split across chunks (no newline in chunk 1) joins.
	const got = decodeChunks(['{"a":1', '}\n']);
	assert.deepEqual(got, [{ a: 1 }], "partial record joins with later chunk");
	ok("buffered partial joins with later chunk");
}
{
	// runaway guard: a single line exceeding the cap is dropped, and the decoder
	// recovers at the next record boundary.
	const big = '{"a":"' + "x".repeat(50) + '"}\n'; // ~55 bytes
	const got = decodeChunks([big, big], 32);
	assert.deepEqual(got, [], "oversized lines dropped");
	ok("runaway cap: oversized records dropped");
	// and recovery: a normal record after the cap reset still parses
	const got2 = decodeChunks([big + '{"ok":1}\n'], 32);
	assert.deepEqual(got2, [{ ok: 1 }], "decoder recovers after oversized line");
	ok("runaway cap: decoder recovers at next boundary");
}

console.log(`\n${passed} passed`);
process.exitCode = 0;
