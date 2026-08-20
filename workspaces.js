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

// isKnownWorkspacePath(discovered, candidate) -> bool
//   the security gate (FR-5/SC-5): only a realpath-match of a DISCOVERED
//   workspace passes. Nonexistent, unmatched, or arbitrary paths -> false, so
//   the browser can never point pi at a dir pi hasn't already run in.
function isKnownWorkspacePath(discovered, candidate) {
	if (!candidate) return false;
	const r = real(candidate);
	if (!fs.existsSync(r)) return false; // real() falls back to input on a miss
	return discovered.some((w) => w.path === r);
}

module.exports = { discoverWorkspaces, isKnownWorkspacePath };
