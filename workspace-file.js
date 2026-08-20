/*
 * workspace-file.js — versioned workspace-file write protocol (plan A5,
 * FR-6). `versionOf(content)` is the server-only optimistic-concurrency tag
 * (sha256 hex via node:crypto — never computed in the browser);
 * `writeWorkspaceFileIfVersion` performs the expectedVersion check
 * (hash = must match; null = must not exist; missing = 400) so /api/write
 * can reject stale overwrites with a 409 instead of silently clobbering.
 * fs is injected (defaults to require("fs")) so tests run against temp
 * fixtures. Zero-dep CommonJS, mirroring jsonl.js. safePath resolution stays
 * in server.js — this module receives an already-resolved absolute path.
 */

const crypto = require("crypto");

function versionOf(content) {
	return crypto.createHash("sha256").update(String(content)).digest("hex");
}

// Result shapes:
//   { ok: true }
//   { ok: false, status: 400, error }                       (no expectedVersion)
//   { ok: false, status: 409, error, version }              (version = current
//     hash, or null when the file is absent — the client recovers without a
//     second fetch)
function writeWorkspaceFileIfVersion(full, content, expectedVersion, fsImpl) {
	const fsApi = fsImpl || require("fs");
	if (expectedVersion === undefined)
		return {
			ok: false,
			status: 400,
			error: "expectedVersion is required",
		};
	let current = null;
	try {
		current = fsApi.readFileSync(full, "utf8");
	} catch (e) {
		if (e.code !== "ENOENT")
			return { ok: false, status: 500, error: e.message };
	}
	const currentVersion = current == null ? null : versionOf(current);
	if (expectedVersion === null) {
		// create-only: the file must NOT exist yet.
		if (currentVersion !== null)
			return {
				ok: false,
				status: 409,
				error: "file already exists",
				version: currentVersion,
			};
	} else if (currentVersion !== expectedVersion) {
		return {
			ok: false,
			status: 409,
			error:
				currentVersion === null
					? "file no longer exists on disk"
					: "file changed on disk",
			version: currentVersion,
		};
	}
	try {
		fsApi.mkdirSync(require("path").dirname(full), { recursive: true });
		fsApi.writeFileSync(full, String(content), "utf8");
		return { ok: true };
	} catch (e) {
		return { ok: false, status: 500, error: e.message };
	}
}

module.exports = { versionOf, writeWorkspaceFileIfVersion };
