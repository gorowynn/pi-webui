/*
 * workspace-file.test.js — node:assert/strict tests for workspace-file.js
 * (plan A5, task T2). Covers the version protocol: sha256 versionOf (T2.1),
 * matching-version writes (T2.2), mismatch → 409 (T2.3), create-only writes
 * (T2.4), deleted-file conflict (T2.5), and missing expectedVersion → 400
 * (T2.6). Runs against a temp-dir fixture; fs is injected. Written red first.
 */

const assert = require("assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");

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

// pinned sha256 vectors (node:crypto, well-known)
const SHA256_EMPTY =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SHA256_A =
	"ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

const wf = require("../workspace-file.js");

let dir;
function fixture(name, content) {
	const full = path.join(dir, name);
	if (content !== undefined) fs.writeFileSync(full, content, "utf8");
	return full;
}

// T2.1 versionOf: stable, content-sensitive, hex.
eq("T2.1 known empty vector", wf.versionOf(""), SHA256_EMPTY);
eq("T2.1 known 'a' vector", wf.versionOf("a"), SHA256_A);
eq(
	"T2.1 stable",
	wf.versionOf("line1\nline2\n"),
	wf.versionOf("line1\nline2\n"),
);
ok("T2.1 content-sensitive", wf.versionOf("a") !== wf.versionOf("b"));
ok("T2.1 hex shape", /^[0-9a-f]{64}$/.test(wf.versionOf("anything")));

dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfile-test-"));

// T2.2 matching version writes.
{
	const f = fixture("match.txt", "v1");
	const hash = wf.versionOf("v1");
	const out = wf.writeWorkspaceFileIfVersion(f, "v2", hash, fs);
	eq("T2.2 ok", out.ok, true);
	eq("T2.2 wrote", fs.readFileSync(f, "utf8"), "v2");
}

// T2.3 mismatch → 409 with the current version; disk untouched.
{
	const f = fixture("mismatch.txt", "v1");
	const wrong = wf.versionOf("different");
	const out = wf.writeWorkspaceFileIfVersion(f, "v2", wrong, fs);
	eq("T2.3 not ok", out.ok, false);
	eq("T2.3 status 409", out.status, 409);
	eq("T2.3 carries current version", out.version, wf.versionOf("v1"));
	ok(
		"T2.3 error message",
		typeof out.error === "string" && out.error.length > 0,
	);
	eq("T2.3 disk untouched", fs.readFileSync(f, "utf8"), "v1");
}

// T2.4 create-only (expectedVersion null): absent → writes; present → 409.
{
	const f = fixture("create.txt"); // no content → absent
	const out = wf.writeWorkspaceFileIfVersion(f, "new", null, fs);
	eq("T2.4 create ok", out.ok, true);
	eq("T2.4 created", fs.readFileSync(f, "utf8"), "new");
}
{
	const f = fixture("exists.txt", "v1");
	const out = wf.writeWorkspaceFileIfVersion(f, "v2", null, fs);
	eq("T2.4 exists not ok", out.ok, false);
	eq("T2.4 exists 409", out.status, 409);
	eq("T2.4 exists version", out.version, wf.versionOf("v1"));
	eq("T2.4 exists disk untouched", fs.readFileSync(f, "utf8"), "v1");
}

// T2.5 deleted file: expected hash but nothing on disk → 409 version null.
{
	const f = fixture("deleted.txt", "v1");
	const hash = wf.versionOf("v1");
	fs.unlinkSync(f);
	const out = wf.writeWorkspaceFileIfVersion(f, "v2", hash, fs);
	eq("T2.5 not ok", out.ok, false);
	eq("T2.5 status 409", out.status, 409);
	eq("T2.5 version null", out.version, null);
	ok(
		"T2.5 error message",
		typeof out.error === "string" && out.error.length > 0,
	);
	ok("T2.5 file still absent", !fs.existsSync(f));
}

// T2.6 missing expectedVersion → 400; no write.
{
	const f = fixture("nover.txt", "v1");
	const out = wf.writeWorkspaceFileIfVersion(f, "v2", undefined, fs);
	eq("T2.6 not ok", out.ok, false);
	eq("T2.6 status 400", out.status, 400);
	eq("T2.6 disk untouched", fs.readFileSync(f, "utf8"), "v1");
}

// nested dir creation on the write path (mkdir recursive parity).
{
	const f = path.join(dir, "nested", "sub", "deep.txt");
	const out = wf.writeWorkspaceFileIfVersion(f, "deep", null, fs);
	eq("T2 nested create ok", out.ok, true);
	eq("T2 nested wrote", fs.readFileSync(f, "utf8"), "deep");
}

// sanity: module shape.
ok(
	"T2 module exports",
	typeof wf.versionOf === "function" &&
		typeof wf.writeWorkspaceFileIfVersion === "function",
);

fs.rmSync(dir, { recursive: true, force: true });
console.log("\n" + pass + " passed");
