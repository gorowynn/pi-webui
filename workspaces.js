// workspaces.js — pure-ish workspace discovery + switch validation for pi-webui.
// CommonJS, fs reads only (no server/pi/process state) so it unit-tests against a
// temp fixture. See .sdd/spec_workspace-sidebar_21072026.md (FR-1, FR-2, FR-5).
//
// Sessions live under ~/.pi/agent/sessions/--<sanitized-realpath-cwd>--/ as
// append-only JSONL. The folder *name* is pi's own encoding (see sessionDirFor in
// server.js), but we deliberately IGNORE it and recover each project root from
// the newest .jsonl's first {type:"session"}.cwd — so discovery can't drift if
// pi changes its encoding, and works for folders we didn't encode ourselves.

const fs = require("fs");
const path = require("path");

// realpath with a soft fallback (mirrors sessionDirFor): nonexistent -> as-is,
// caller decides. Never throws.
function real(p) {
	try {
		return fs.realpathSync(p);
	} catch {
		return p;
	}
}

// First {type:"session"}.cwd in a .jsonl, or null if none parseable (EC-1).
// Parses the same shape listSessions does.
function cwdFromJsonl(file) {
	let txt;
	try {
		txt = fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
	for (const l of txt.split("\n")) {
		if (!l || l[0] !== "{") continue;
		let e;
		try {
			e = JSON.parse(l);
		} catch {
			continue;
		}
		if (e && e.type === "session" && e.cwd) return e.cwd;
	}
	return null;
}

// discoverWorkspaces(sessionsDir, currentCwd) -> Workspace[]
//   scan <sessionsDir> subdirs; each dir's newest .jsonl's first session entry
//   recovers the project root (skip the dir if none — EC-1); dedupe by realpath
//   (EC-5); always include realpath(currentCwd) even with 0 sessions (EC-2);
//   active = realpath match (EC-7); sort active-first then lastUsed desc (FR-2).
function discoverWorkspaces(sessionsDir, currentCwd) {
	const currentReal = real(currentCwd);
	const byPath = new Map(); // realpath -> workspace (aggregated on collision)

	const upsert = (w) => {
		const ex = byPath.get(w.path);
		if (!ex) {
			byPath.set(w.path, w);
			return;
		}
		// ponytail: same realpath from two encoded folders -> one entry, merged,
		// so a project split across stale encodings still reports all its sessions.
		ex.sessions += w.sessions;
		if (w.lastUsed > ex.lastUsed) ex.lastUsed = w.lastUsed;
	};

	let dirs = [];
	try {
		dirs = fs
			.readdirSync(sessionsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		dirs = []; // no sessions dir yet (fresh agent) -> only current cwd below
	}

	for (const name of dirs) {
		const sub = path.join(sessionsDir, name);
		let files = [];
		try {
			files = fs.readdirSync(sub).filter((f) => f.endsWith(".jsonl"));
		} catch {
			continue;
		}
		if (!files.length) continue;
		let newest = null;
		let newestM = -1;
		let maxM = 0;
		for (const f of files) {
			const full = path.join(sub, f);
			let m = 0;
			try {
				m = fs.statSync(full).mtimeMs;
			} catch {}
			if (m > maxM) maxM = m;
			if (m > newestM) {
				newestM = m;
				newest = full;
			}
		}
		const cwd = newest && cwdFromJsonl(newest);
		if (!cwd) continue; // EC-1: can't recover root from newest .jsonl -> skip
		const root = real(cwd);
		upsert({
			path: root,
			name: path.basename(root) || root,
			lastUsed: maxM,
			sessions: files.length,
			active: root === currentReal,
		});
	}

	// EC-2: current project always present even before it has a session folder.
	if (!byPath.has(currentReal)) {
		byPath.set(currentReal, {
			path: currentReal,
			name: path.basename(currentReal) || currentReal,
			lastUsed: 0,
			sessions: 0,
			active: true,
		});
	}

	return [...byPath.values()].sort((a, b) => {
		if (a.active !== b.active) return a.active ? -1 : 1; // active first
		return b.lastUsed - a.lastUsed; // then recency desc
	});
}

// isKnownWorkspacePath(discovered, candidate, requireExists=true) -> bool
//   the security gate (FR-5/SC-5): only a realpath-match of a DISCOVERED
//   workspace passes. Nonexistent, unmatched, or arbitrary paths -> false, so
//   the browser can never point pi at a dir pi hasn't already run in.
//   requireExists=false (remove/archive): the project dir may have been deleted
//   from disk — removal targets the SESSION folder, so only the discovered-match
//   matters. Both sides go through real()'s as-is fallback, so a dead path still
//   string-matches its discovery-time encoding.
function isKnownWorkspacePath(discovered, candidate, requireExists = true) {
	if (!candidate) return false;
	const r = real(candidate);
	if (requireExists && !fs.existsSync(r)) return false; // real() falls back to input on a miss
	return discovered.some((w) => w.path === r);
}

// ---- workspace archive (remove / restore / purge) -------------------------
// Removing a workspace moves its encoded session folder OUT of the sessions
// dir (discovery scans every subdir, so the archive root must be a sibling,
// never inside it). Archived folders carry a `.<ts>` name suffix — the
// authoritative age for the 7-day purge (dir mtimes are not reliable across
// Windows renames). All functions are fs-only and never throw (they return
// {ok:false,error}); a missing archive dir is an empty archive.

const ARCHIVE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// encoded-dir scan shared by discovery and archive lookups: newest .jsonl's
// session cwd -> {root, files, maxM} or null when nothing recovers (EC-1).
function recoverEntry(sub) {
	let files = [];
	try {
		files = fs.readdirSync(sub).filter((f) => f.endsWith(".jsonl"));
	} catch {
		return null;
	}
	if (!files.length) return null;
	let newest = null;
	let newestM = -1;
	let maxM = 0;
	for (const f of files) {
		const full = path.join(sub, f);
		let m = 0;
		try {
			m = fs.statSync(full).mtimeMs;
		} catch {}
		if (m > maxM) maxM = m;
		if (m > newestM) {
			newestM = m;
			newest = full;
		}
	}
	const cwd = newest && cwdFromJsonl(newest);
	if (!cwd) return null;
	return { root: real(cwd), files, maxM };
}

// findSessionDir(sessionsDir, workspacePath) -> absolute encoded folder whose
// recovered cwd matches workspacePath (newest encoding wins on stale-encoded
// collisions), or null.
function findSessionDir(sessionsDir, workspacePath) {
	const target = real(workspacePath);
	let best = null;
	let bestM = -1;
	let dirs = [];
	try {
		dirs = fs
			.readdirSync(sessionsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory());
	} catch {
		return null;
	}
	for (const d of dirs) {
		const e = recoverEntry(path.join(sessionsDir, d.name));
		if (!e || e.root !== target) continue;
		if (e.maxM > bestM) {
			bestM = e.maxM;
			best = path.join(sessionsDir, d.name);
		}
	}
	return best;
}

// split "--name--.1234567890" -> {base:"--name--", ts:1234567890 | null}.
// The ts suffix must be all-digits — encoded names legitimately contain dots
// (e.g. `--C-Users-Maik-.pi--`), so `.pi` is NOT parsed as a timestamp.
function splitTs(name) {
	const m = /^(.*)\.(\d{8,})$/.exec(name);
	return m ? { base: m[1], ts: Number(m[2]) } : { base: name, ts: null };
}

// archiveWorkspace(sessionsDir, archiveDir, workspacePath) -> {ok, archived}
function archiveWorkspace(sessionsDir, archiveDir, workspacePath) {
	const src = findSessionDir(sessionsDir, workspacePath);
	if (!src) return { ok: false, error: "no session folder for workspace" };
	try {
		fs.mkdirSync(archiveDir, { recursive: true });
		let destName = path.basename(src) + "." + Date.now();
		while (fs.existsSync(path.join(archiveDir, destName)))
			destName =
				path.basename(src) +
				"." +
				Date.now() +
				"-" +
				Math.random().toString(36).slice(2, 6);
		fs.renameSync(src, path.join(archiveDir, destName));
		return { ok: true, archived: destName };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

// listArchived(archiveDir) -> [{dir, name, path, movedAt}]
function listArchived(archiveDir) {
	let dirs = [];
	try {
		dirs = fs
			.readdirSync(archiveDir, { withFileTypes: true })
			.filter((d) => d.isDirectory());
	} catch {
		return [];
	}
	const out = [];
	for (const d of dirs) {
		const sub = path.join(archiveDir, d.name);
		const e = recoverEntry(sub);
		let movedAt = splitTs(d.name).ts;
		if (movedAt == null) {
			try {
				movedAt = fs.statSync(sub).mtimeMs;
			} catch {
				movedAt = 0;
			}
		}
		const root = e ? e.root : null;
		out.push({
			dir: d.name,
			path: root,
			name: root ? path.basename(root) || root : d.name,
			movedAt,
		});
	}
	return out.sort((a, b) => b.movedAt - a.movedAt);
}

// restoreArchived(archiveDir, sessionsDir, entryName) -> {ok, restored}
// entryName is validated to a bare basename (no traversal). A name collision
// with a live folder restores under `--<inner>-restored-<ts>--`; discovery
// merges both by realpath anyway.
function restoreArchived(archiveDir, sessionsDir, entryName) {
	const name = path.basename(String(entryName || ""));
	const src = path.join(archiveDir, name);
	if (!name || name !== entryName || !fs.existsSync(src))
		return { ok: false, error: "no such archived workspace" };
	const base = splitTs(name).base;
	let dest = path.join(sessionsDir, base);
	try {
		fs.mkdirSync(sessionsDir, { recursive: true });
		if (fs.existsSync(dest)) {
			const inner = base.replace(/^--/, "").replace(/--$/, "");
			dest = path.join(
				sessionsDir,
				`--${inner}-restored-${Date.now()}--`,
			);
		}
		fs.renameSync(src, dest);
		return { ok: true, restored: path.basename(dest) };
	} catch (e) {
		return { ok: false, error: e.message };
	}
}

// purgeArchived(archiveDir, now?, maxAge?) -> number removed. Never throws.
function purgeArchived(
	archiveDir,
	now = Date.now(),
	maxAge = ARCHIVE_MAX_AGE_MS,
) {
	const list = listArchived(archiveDir);
	let removed = 0;
	for (const e of list) {
		if (now - e.movedAt <= maxAge) continue;
		try {
			fs.rmSync(path.join(archiveDir, e.dir), {
				recursive: true,
				force: true,
			});
			removed++;
		} catch {}
	}
	return removed;
}

module.exports = {
	discoverWorkspaces,
	isKnownWorkspacePath,
	findSessionDir,
	archiveWorkspace,
	listArchived,
	restoreArchived,
	purgeArchived,
	ARCHIVE_MAX_AGE_MS,
};
