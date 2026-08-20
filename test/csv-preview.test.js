// csv-preview.js bounded parser tests (plan 2.3 / R§2.3)
// node test/csv-preview.test.js — no framework, node:assert/strict.
const assert = require("assert/strict");
const { parse, source } = require("../public/csv-preview.js");

let pass = 0;
function ok(name, cond) {
	if (!cond) throw new Error("FAIL: " + name);
	pass++;
	console.log("  ✓ " + name);
}

// 1. basic parse: header + rows
{
	const r = parse("a,b,c\n1,2,3\n4,5,6");
	ok("headers", JSON.stringify(r.headers) === JSON.stringify(["a", "b", "c"]));
	ok("2 body rows", r.rows.length === 2);
	ok("row0", JSON.stringify(r.rows[0]) === JSON.stringify(["1", "2", "3"]));
	ok("not truncated", !r.truncated);
}

// 2. quoted fields with commas inside
{
	const r = parse('name,note\n"Doe, Jane","hello, world"');
	ok("quoted comma field", r.rows[0][0] === "Doe, Jane");
	ok("quoted second field", r.rows[0][1] === "hello, world");
}

// 3. escaped double-quotes ("") inside a quoted field
{
	const r = parse('msg\n"He said ""hi"" loudly"');
	ok("escaped quotes", r.rows[0][0] === 'He said "hi" loudly');
}

// 4. CRLF line endings
{
	const r = parse("a,b\r\n1,2\r\n3,4");
	ok("crlf header", JSON.stringify(r.headers) === JSON.stringify(["a", "b"]));
	ok("crlf 2 rows", r.rows.length === 2);
	ok("crlf no \r leak", r.rows[0][1] === "2");
}

// 5. lone \r line endings (old Mac)
{
	const r = parse("x,y\r1,2");
	ok("lone-cr 1 row", r.rows.length === 1);
	ok("lone-cr value", r.rows[0][0] === "1");
}

// 6. row cap (MAX_ROWS = 20 incl header)
{
	const lines = ["h"];
	for (let i = 0; i < 30; i++) lines.push("r" + i);
	const r = parse(lines.join("\n"));
	ok("row cap 19 body", r.rows.length === 19);
	ok("row cap truncated", r.truncated);
}

// 7. column cap (MAX_COLS = 8)
{
	const r = parse("a,b,c,d,e,f,g,h,i,j\n1,2,3,4,5,6,7,8,9,10");
	ok("col cap header 8", r.headers.length === 8);
	ok("col cap body 8", r.rows[0].length === 8);
}

// 8. scan cap (content > 64KB -> truncated)
{
	const big = "col\n" + "x".repeat(70000);
	const r = parse(big);
	ok("scan cap truncated", r.truncated);
}

// 9. cell cap (CELL_CAP = 160)
{
	const long = "x".repeat(300);
	const r = parse("val\n" + long);
	ok("cell capped len", r.rows[0][0].length === 161); // 160 + ellipsis
	ok("cell ellipsis char", r.rows[0][0].endsWith("\u2026"));
}

// 10. empty content
{
	const r = parse("");
	ok("empty no headers", r.headers.length === 0);
	ok("empty no rows", r.rows.length === 0);
	ok("empty not truncated", !r.truncated);
}

// 11. single column (no commas)
{
	const r = parse("title\nfoo\nbar");
	ok("single-col header", r.headers[0] === "title");
	ok("single-col 2 rows", r.rows.length === 2);
}

// 12. source() caps at 20KB
{
	const big = "z".repeat(30000);
	ok("source cap 20KB", source(big).length === 20480);
	ok("source small passthrough", source("abc") === "abc");
}

// 13. trailing field with no newline flushes
{
	const r = parse("a,b\n1,2");
	ok("trailing flush", r.rows.length === 1 && r.rows[0][1] === "2");
}

console.log("\n" + pass + " passed");
