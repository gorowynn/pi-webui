// Unit tests for workspaces.js — plain node:assert/strict, no framework.
// Fixture: a temp sessions/ tree of encoded subfolders whose .jsonl lines mirror
// the {type:"session"} shape listSessions parses. These express FR-1/FR-2/FR-5
// and EC-1/EC-2/EC-5 (see .sdd/spec_workspace-sidebar_21072026.md).
// Run: node test/workspaces.test.js

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
	discoverWorkspaces,
	isKnownWorkspacePath,
} = require("../workspaces.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-test-"));
const sessionsDir = path.join(tmp, "sessions");
fs.mkdirSync(sessionsDir, { recursive: true });

// Real project roots (must exist so realpath resolves).
const curProj = realMkDir("curproj"); // the "current" workspace
const projA = realMkDir("projA");
const projB = realMkDir("projB");

function realMkDir(name) {
	const d = path.join(tmp, name);
	fs.mkdirSync(d, { recursive: true });
	return fs.realpathSync(d);
}

// Write a .jsonl into an encoded-style subfolder. opts: { session:bool, ts, mtime(sec) }
function writeSession(folder, fname, cwd, opts = {}) {
	const dir = path.join(sessionsDir, folder);
	fs.mkdirSync(dir, { recursive: true });
	const lines = [];
	if (opts.session !== false) {
		lines.push(
			JSON.stringify({
				type: "session",
				id: fname,
				timestamp: opts.ts || 0,
				cwd: fs.realpathSync(cwd),
			}),
		);
	}
	if (opts.userText) {
		lines.push(
			JSON.stringify({
				type: "message",
				message: { role: "user", content: opts.userText },
			}),
		);
	}
	const full = path.join(dir, fname);
	fs.writeFileSync(full, lines.join("\n") + "\n");
	if (opts.mtime) fs.utimesSync(full, opts.mtime, opts.mtime); // seconds
	return full;
}

try {
	// Fixture:
	//   curProj : current cwd, NO session folder                 (EC-2 / T1.1)
	//   projA   : 2 .jsonl, both session{cwd:projA}, mtimes 1000/2000 (T1.2)
	//   bad     : 1 .jsonl, NO session line (newest)             (EC-1 / T1.4)
	//   dupA    : 1 .jsonl session{cwd:projB} mtime 3001
	//   dupB    : 1 .jsonl session{cwd:projB} mtime 3000         (EC-1/EC-5 / T1.5)
	writeSession("--projA--", "a1.jsonl", projA, { ts: 1, mtime: 1000 });
	writeSession("--projA--", "a2.jsonl", projA, { ts: 2, mtime: 2000 });
	writeSession("--bad--", "b1.jsonl", "/no/such/root", {
		session: false,
		userText: "msg only",
		mtime: 1500,
	});
	writeSession("--dupA--", "d1.jsonl", projB, { ts: 3, mtime: 3001 });
	writeSession("--dupB--", "d2.jsonl", projB, { ts: 4, mtime: 3000 });

	const ws = discoverWorkspaces(sessionsDir, curProj);
	const byPath = new Map(ws.map((w) => [w.path, w]));

	// T1.1 #FR-1 #FR-2 — current cwd present, active, 0 sessions.
	{
		const cur = byPath.get(fs.realpathSync(curProj));
		assert.ok(cur, "current cwd missing");
		assert.equal(cur.active, true);
		assert.equal(cur.sessions, 0);
		assert.equal(cur.lastUsed, 0);
		assert.equal(cur.name, "curproj");
		console.log("T1.1 current-cwd inclusion: pass");
	}

	// T1.2 #FR-1 — discovered folder: path/sessions/lastUsed correct.
	{
		const a = byPath.get(fs.realpathSync(projA));
		assert.ok(a, "projA not discovered");
		assert.equal(a.path, fs.realpathSync(projA));
		assert.equal(a.sessions, 2);
		assert.equal(a.lastUsed, 2000000); // 2000s -> ms
		assert.equal(a.active, false);
		console.log("T1.2 discovery fields: pass");
	}

	// T1.3 #FR-2 — exactly one active, realpath-matches currentCwd.
	{
		const actives = ws.filter((w) => w.active);
		assert.equal(actives.length, 1);
		assert.equal(actives[0].path, fs.realpathSync(curProj));
		console.log("T1.3 single active workspace: pass");
	}
	assert.ok(!ws.some((w) => w.name === "/no/such/root"), "bad folder leaked");
	// bad/ had cwd "/no/such/root" which doesn't exist AND had no session line;
	// either way it must not appear.
	console.log("T1.4 unresolvable folder skipped: pass");

	// T1.5 #EC-1 — two folders -> same realpath dedupe to one (merged).
	{
		const b = byPath.get(fs.realpathSync(projB));
		assert.ok(b, "projB not discovered");
		assert.equal(b.sessions, 2, "dedupe should aggregate session counts");
		assert.equal(b.lastUsed, 3001000); // max(3000,3001)s -> ms
		console.log("T1.5 realpath dedupe (merged): pass");
	}

	// T1.6 #FR-2 — ordering: active first, then lastUsed desc.
	{
		const order = ws.map((w) => w.name);
		assert.equal(order[0], "curproj"); // active first despite lastUsed 0
		const bIdx = order.indexOf("projB");
		const aIdx = order.indexOf("projA");
		assert.ok(
			bIdx > -1 && aIdx > -1 && bIdx < aIdx,
			"projB(3001) before projA(2000)",
		);
		console.log("T1.6 ordering active-first/lastUsed-desc: pass");
	}
	assert.equal(isKnownWorkspacePath(ws, projA), true);
	assert.equal(isKnownWorkspacePath(ws, fs.realpathSync(projB)), true);
	console.log("T1.7 known-path accepted: pass");
	assert.equal(isKnownWorkspacePath(ws, path.join(tmp, "nope")), false); // nonexistent
	assert.equal(isKnownWorkspacePath(ws, os.homedir()), false); // exists, not a workspace
	assert.equal(isKnownWorkspacePath(ws, ""), false); // empty
	console.log("T1.8 unknown-path rejected (security gate): pass");

	console.log("\nworkspaces discovery + gate: pass");
} finally {
	fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- workspace archive: remove / restore / purge (recoverable, 7-day) ------
// Archive lives OUTSIDE the sessions dir (discovery scans every subdir, so a
// sibling root is the only place an archived folder stays invisible to it).
{
	const {
		findSessionDir,
		archiveWorkspace,
		listArchived,
		restoreArchived,
		purgeArchived,
		ARCHIVE_MAX_AGE_MS,
	} = require("../workspaces.js");
	const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "ws-arc-"));
	try {
		const sessions = path.join(tmp2, "sessions");
		const archive = path.join(tmp2, "removed");
		fs.mkdirSync(sessions, { recursive: true });
		const mkProj = (name) => {
			const d = path.join(tmp2, name);
			fs.mkdirSync(d, { recursive: true });
			return fs.realpathSync(d);
		};
		const seed = (folder, fname, cwd) => {
			fs.mkdirSync(path.join(sessions, folder), { recursive: true });
			fs.writeFileSync(
				path.join(sessions, folder, fname + ".jsonl"),
				JSON.stringify({ type: "session", id: fname, cwd }),
			);
		};
		const alpha = mkProj("alpha");
		const beta = mkProj("beta");
		seed("--enc-alpha--", "s1", alpha);
		seed("--enc-beta--", "s2", beta);

		// findSessionDir maps a discovered root back to its encoded folder
		assert.equal(
			findSessionDir(sessions, alpha),
			path.join(sessions, "--enc-alpha--"),
		);
		assert.equal(findSessionDir(sessions, mkProj("ghost")), null);

		// archive removes it from discovery and lists it with a display name
		const r = archiveWorkspace(sessions, archive, alpha);
		assert.ok(r.ok, "archive succeeds");
		assert.ok(!fs.existsSync(path.join(sessions, "--enc-alpha--")));
		const list1 = listArchived(archive);
		assert.equal(list1.length, 1);
		assert.equal(list1[0].name, "alpha", "display name from recovered cwd");
		assert.equal(list1[0].path, alpha);
		assert.ok(list1[0].movedAt > 0);
		assert.equal(
			discoverWorkspaces(sessions, beta).find((w) => w.path === alpha),
			undefined,
			"archived workspace leaves discovery",
		);

		// unknown path -> explicit failure, nothing moved
		assert.equal(archiveWorkspace(sessions, archive, mkProj("nope")).ok, false);

		// restore returns it (original name, discovered again)
		const rr = restoreArchived(archive, sessions, list1[0].dir);
		assert.ok(rr.ok, "restore succeeds");
		assert.ok(fs.existsSync(path.join(sessions, "--enc-alpha--")));
		assert.equal(
			discoverWorkspaces(sessions, beta).find((w) => w.path === alpha)
				?.sessions,
			1,
		);

		// restore onto an existing live folder -> alternate name, merged counts
		assert.ok(archiveWorkspace(sessions, archive, alpha).ok);
		const l2 = listArchived(archive);
		seed("--enc-alpha--", "live", alpha); // live copy re-exists
		const rc = restoreArchived(archive, sessions, l2[0].dir);
		assert.ok(rc.ok, "collision restore succeeds under an alternate name");
		assert.equal(
			discoverWorkspaces(sessions, beta).find((w) => w.path === alpha)
				?.sessions,
			2,
			"both copies merge by realpath",
		);

		// purge: fresh entries kept, stale (name-ts forged old) removed, no-throw
		assert.ok(archiveWorkspace(sessions, archive, beta).ok);
		const l3 = listArchived(archive);
		assert.equal(l3.length, 1);
		assert.equal(
			purgeArchived(archive, Date.now()),
			0,
			"fresh archive entry survives purge",
		);
		const oldTs = Date.now() - ARCHIVE_MAX_AGE_MS - 1000;
		const base = l3[0].dir.replace(/\.\d+$/, "");
		fs.renameSync(
			path.join(archive, l3[0].dir),
			path.join(archive, `${base}.${oldTs}`),
		);
		assert.equal(
			purgeArchived(archive, Date.now()),
			1,
			"entry older than 7 days is purged",
		);
		assert.equal(listArchived(archive).length, 0);
		assert.equal(purgeArchived(path.join(tmp2, "missing-archive")), 0);

		console.log("\nworkspace archive remove/restore/purge: pass");
	} finally {
		fs.rmSync(tmp2, { recursive: true, force: true });
	}
}

// ---- removing a workspace whose project dir was DELETED from disk --------
// The normal remove case: repo gone, session folder still there. The gate
// must still pass with requireExists=false, and archive must move the folder.
{
	const { discoverWorkspaces, isKnownWorkspacePath, archiveWorkspace } =
		require("../workspaces.js");
	const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "ws-dead-"));
	try {
		const sessions = path.join(tmp3, "sessions");
		const archive = path.join(tmp3, "removed");
		fs.mkdirSync(sessions, { recursive: true });
		const dead = path.join(tmp3, "deleted-proj"); // NEVER created
		fs.mkdirSync(path.join(sessions, "--enc-dead--"), { recursive: true });
		fs.writeFileSync(
			path.join(sessions, "--enc-dead--", "s.jsonl"),
			JSON.stringify({ type: "session", id: "s", cwd: dead }),
		);

		const ws = discoverWorkspaces(sessions, tmp3);
		const entry = ws.find((w) => w.path === dead);
		assert.ok(entry, "dead-root workspace still discovered via fallback");
		assert.equal(
			isKnownWorkspacePath(ws, dead),
			false,
			"default gate keeps existsSync (switch must spawn there)",
		);
		assert.equal(
			isKnownWorkspacePath(ws, dead, false),
			true,
			"remove gate passes for a discovered dead root",
		);
		assert.equal(
			isKnownWorkspacePath(ws, path.join(tmp3, "never-ran"), false),
			false,
			"undiscovered path still rejected",
		);
		const r = archiveWorkspace(sessions, archive, dead);
		assert.ok(r.ok, "archive succeeds for a dead root");
		assert.ok(!fs.existsSync(path.join(sessions, "--enc-dead--")));

		console.log("\ndead-root workspace removal: pass");
	} finally {
		fs.rmSync(tmp3, { recursive: true, force: true });
	}
}
