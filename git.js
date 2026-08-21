/*
 * git.js — read-only Git porcelain for the sidebar (plan 4.5).
 * Ported from pi-livecraft's server/features/git/git.ts (MIT), CommonJS.
 *
 * getGitSnapshot(cwd): status porcelain -z + numstat merge + unpushed commits →
 *   {repository, root, branch, files:[{path,status,additions,deletions}],
 *    ahead, commits:[{hash,subject,files}]}. One round of parallel git spawns.
 * getGitFileDiff(cwd, path, commitHash?): unified diff for a working-tree file or
 *   an unpushed commit's file. Validates the path is a known changed file first.
 *
 * The mutation actions (commit/push/reset/revert/discard) are plan 4.6 — NOT here.
 * All git commands run scoped to realpath(PI_CWD); no client path escapes the repo
 * (the diff path must be one of the snapshot's known changed files).
 *
 * Pure parsers (parseGitStatus / parseGitNameStatus / mergeNumstats / parseNumstat
 * / statusFor / numberOrNull) are exported for unit testing.
 */

const { spawn } = require("child_process");

// Windows command lookup consults PATHEXT and searches cwd before PATH. This
// repository contains git.js, so spawning bare "git" can launch that source
// file through its .js association instead of Git for Windows. An explicit
// .exe suffix bypasses the collision; POSIX keeps the normal command name.
function gitExecutableForPlatform(platform) {
	return platform === "win32" ? "git.exe" : "git";
}

// Explicit git.exe protects this module, but pi and its extensions/tools spawn
// their own commands. Remove only the executable .JS suffix from their inherited
// Windows environment so a local foo.js cannot shadow foo; keep .JSE and every
// other operator-configured suffix intact. Mutates env intentionally.
function sanitizeWindowsPathExt(env, platform) {
	if (platform !== "win32" || !env) return env;
	const key = Object.keys(env).find(
		(name) => name.toUpperCase() === "PATHEXT",
	);
	if (!key || typeof env[key] !== "string") return env;
	env[key] = env[key]
		.split(";")
		.filter((suffix) => suffix.trim().toUpperCase() !== ".JS")
		.join(";");
	return env;
}

const GIT_BIN = gitExecutableForPlatform(process.platform);

// ---- git spawn helper ----
function runGit(cwd, args, allowedExitCodes) {
	allowedExitCodes = allowedExitCodes || [0];
	return new Promise((resolve, reject) => {
		const p = spawn(GIT_BIN, args, {
			cwd: cwd,
			stdio: ["ignore", "pipe", "pipe"],
			// headless server (detached launcher, /webui, IDE panel): a console-less
			// parent spawning git.exe without CREATE_NO_WINDOW gets a flash window
			// per call — the snapshot fires 6 spawns in parallel, so it was a burst.
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		p.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		p.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		p.once("error", reject);
		p.once("close", (exitCode) => {
			const result = {
				exitCode: exitCode == null ? 1 : exitCode,
				stdout: stdout,
				stderr: stderr,
			};
			if (allowedExitCodes.indexOf(result.exitCode) >= 0) resolve(result);
			else reject(new Error(gitError(result)));
		});
	});
}
function gitError(result) {
	return (
		(result.stderr || "").trim() ||
		(result.stdout || "").trim() ||
		"The Git command failed."
	);
}

// ---- snapshot ----
async function getGitSnapshot(cwd) {
	const repository = await runGit(
		cwd,
		["rev-parse", "--is-inside-work-tree"],
		[0, 128],
	);
	if (repository.exitCode !== 0 || repository.stdout.trim() !== "true")
		return {
			repository: false,
			root: null,
			branch: null,
			files: [],
			summary: summarizeGitChanges([]),
			ahead: 0,
			commits: [],
		};

	const results = await Promise.all([
		runGit(cwd, ["rev-parse", "--show-toplevel"]),
		runGit(cwd, [
			"status",
			"--porcelain=v1",
			"-z",
			"--untracked-files=all",
		]),
		runGit(cwd, ["diff", "--numstat", "-z"]),
		runGit(cwd, ["diff", "--cached", "--numstat", "-z"]),
		runGit(cwd, ["branch", "--show-current"]),
		runGit(
			cwd,
			[
				"rev-parse",
				"--abbrev-ref",
				"--symbolic-full-name",
				"@{upstream}",
			],
			[0, 128],
		),
	]);
	const root = results[0],
		status = results[1],
		unstaged = results[2],
		staged = results[3],
		branch = results[4],
		upstream = results[5];

	const changes = parseGitStatus(status.stdout);
	const counts = mergeNumstats(unstaged.stdout, staged.stdout);
	// untracked files have no numstat; fetch per-file diff --no-index for additions
	await Promise.all(
		changes
			.filter((change) => change.untracked && !counts.has(change.path))
			.map((change) =>
				runGit(
					cwd,
					[
						"diff",
						"--no-index",
						"--numstat",
						"-z",
						"--",
						"/dev/null",
						change.path,
					],
					[0, 1],
				).then((result) => {
					const countsArr = parseNumstat(result.stdout);
					if (countsArr[0])
						counts.set(change.path, {
							additions: countsArr[0].additions,
							deletions: countsArr[0].deletions,
						});
				}),
			),
	);

	const commits = upstream.exitCode === 0 ? await unpushedCommits(cwd) : [];

	return {
		repository: true,
		root: root.stdout.trim() || null,
		branch: branch.stdout.trim() || "HEAD",
		summary: summarizeGitChanges(changes),
		files: changes.map((change) => {
			const count = counts.get(change.path);
			const binary =
				!!count && count.additions == null && count.deletions == null;
			return {
				path: change.path,
				oldPath: change.oldPath || null,
				status: change.status,
				staged: change.staged,
				unstaged: change.unstaged,
				untracked: change.untracked,
				additions: count ? count.additions : null,
				deletions: count ? count.deletions : null,
				binary,
				diffAvailable: !!count && !binary,
			};
		}),
		ahead: commits.length,
		commits: commits,
	};
}

async function unpushedCommits(cwd) {
	const result = await runGit(cwd, [
		"log",
		"--format=%H%x00%s%x00",
		"@{upstream}..HEAD",
	]);
	const fields = result.stdout.split("\0");
	const commits = [];
	for (let index = 0; index < fields.length - 1; index += 2) {
		const hash = fields[index].trim();
		const subject = fields[index + 1];
		if (!hash) continue;
		commits.push({ hash: hash, subject: subject, files: [] });
	}
	await Promise.all(
		commits.map(async (commit) => {
			const results = await Promise.all([
				runGit(cwd, [
					"diff-tree",
					"--no-commit-id",
					"--name-status",
					"-r",
					"-m",
					"--first-parent",
					"-z",
					commit.hash,
				]),
				runGit(cwd, [
					"diff-tree",
					"--no-commit-id",
					"--numstat",
					"-r",
					"-m",
					"--first-parent",
					"-z",
					commit.hash,
				]),
			]);
			const counts = mergeNumstats(results[1].stdout);
			commit.files = parseGitNameStatus(results[0].stdout).map(
				(change) => {
					const count = counts.get(change.path);
					return {
						path: change.path,
						oldPath: change.oldPath || null,
						status: change.status,
						additions: count ? count.additions : null,
						deletions: count ? count.deletions : null,
					};
				},
			);
		}),
	);
	return commits;
}

// ---- per-file diff (read-only) ----
async function getGitFileDiff(cwd, repoPath, commitHash) {
	const snapshot = await getGitSnapshot(cwd);
	if (commitHash) {
		const commit = snapshot.commits.find((c) => c.hash === commitHash);
		const file = commit && commit.files.find((c) => c.path === repoPath);
		if (
			!file ||
			!["added", "modified", "deleted", "renamed"].includes(file.status)
		)
			throw new Error("This file cannot be displayed.");
		const result = await runGit(cwd, [
			"diff-tree",
			"--no-commit-id",
			"--root",
			"--first-parent",
			"-m",
			"-p",
			commitHash,
			"--",
			repoPath,
		]);
		return boundedGitDiff(repoPath, result.stdout);
	}
	const file = snapshot.files.find((c) => c.path === repoPath);
	if (
		!file ||
		!["added", "modified", "deleted", "renamed", "untracked"].includes(
			file.status,
		)
	)
		throw new Error("This file cannot be displayed.");
	if (file.binary || file.diffAvailable === false)
		return { path: repoPath, diff: "", unavailable: "binary" };
	const trackedDiff = await runGit(
		cwd,
		["diff", "HEAD", "--", repoPath],
		[0, 128],
	);
	if (trackedDiff.stdout) return boundedGitDiff(repoPath, trackedDiff.stdout);
	if (file.status === "deleted")
		return { path: repoPath, diff: "", unavailable: "deleted" };
	const untrackedDiff = await runGit(
		cwd,
		["diff", "--no-index", "--", "/dev/null", repoPath],
		[0, 1],
	);
	return boundedGitDiff(repoPath, untrackedDiff.stdout);
}

// ---- pure parsers (exported for tests) ----
function parseGitStatus(output) {
	const fields = output.split("\0");
	const changes = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const field = fields[index];
		if (!field) continue;
		const code = field.slice(0, 2);
		const p = field.slice(3);
		const untracked = code === "??";
		const oldPath =
			code.indexOf("R") >= 0 || code.indexOf("C") >= 0
				? fields[++index] || null
				: null;
		changes.push({
			path: p,
			oldPath,
			status: statusFor(code),
			staged: !untracked && code[0] !== " " && code[0] !== "?",
			unstaged: !untracked && code[1] !== " " && code[1] !== "?",
			untracked,
		});
	}
	return changes;
}

function parseGitNameStatus(output) {
	const fields = output.split("\0");
	const changes = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const code = fields[index];
		const oldPath = fields[++index];
		if (!code || !oldPath) continue;
		if (code.startsWith("R") || code.startsWith("C")) {
			const newPath = fields[++index];
			if (newPath)
				changes.push({
					path: newPath,
					oldPath,
					status: statusFor(code),
				});
			continue;
		}
		changes.push({ path: oldPath, status: statusFor(code) });
	}
	return changes;
}

function summarizeGitChanges(changes) {
	const list = Array.isArray(changes) ? changes : [];
	return {
		changed: list.length,
		staged: list.filter((change) => change && change.staged === true).length,
		unstaged: list.filter((change) => change && change.unstaged === true).length,
		untracked: list.filter((change) => change && change.untracked === true).length,
		added: list.filter((change) => change && change.status === "added").length,
		modified: list.filter((change) => change && change.status === "modified").length,
		deleted: list.filter((change) => change && change.status === "deleted").length,
		renamed: list.filter((change) => change && change.status === "renamed").length,
	};
}

const MAX_DIFF_BYTES = 1024 * 1024;
function boundedGitDiff(repoPath, diff, maxBytes) {
	const text = typeof diff === "string" ? diff : "";
	const limit = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : MAX_DIFF_BYTES;
	if (Buffer.byteLength(text, "utf8") <= limit)
		return { path: repoPath, diff: text, unavailable: null };
	return { path: repoPath, diff: "", unavailable: "oversized" };
}

function mergeNumstats() {
	var outputs = Array.prototype.slice.call(arguments);
	const counts = new Map();
	for (const output of outputs) {
		for (const count of parseNumstat(output)) {
			const current = counts.get(count.path);
			counts.set(count.path, {
				additions:
					current &&
					current.additions != null &&
					count.additions != null
						? current.additions + count.additions
						: count.additions,
				deletions:
					current &&
					current.deletions != null &&
					count.deletions != null
						? current.deletions + count.deletions
						: count.deletions,
			});
		}
	}
	return counts;
}

function parseNumstat(output) {
	const fields = output.split("\0");
	const counts = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const field = fields[index];
		if (!field) continue;
		const parts = field.split("\t");
		const additions = parts[0],
			deletions = parts[1],
			p = parts[2];
		if (p) {
			counts.push({
				path: p,
				additions: numberOrNull(additions),
				deletions: numberOrNull(deletions),
			});
			continue;
		}
		// rename: <add>\t<del>\t<oldPath>\0<newPath>
		const oldPath = fields[++index];
		const newPath = fields[++index];
		if (oldPath && newPath)
			counts.push({
				path: newPath,
				additions: numberOrNull(additions),
				deletions: numberOrNull(deletions),
			});
	}
	return counts;
}

function statusFor(code) {
	if (code === "??" || code.indexOf("A") >= 0) return "added";
	if (code.indexOf("D") >= 0) return "deleted";
	if (code.indexOf("R") >= 0) return "renamed";
	return "modified";
}

function numberOrNull(value) {
	const n = parseInt(value, 10);
	return Number.isNaN(n) ? null : n;
}

// ---- mutations (plan 4.6) ----
// All gated client-side behind a confirm modal. reset/revert require a clean tree
// (pi-livecraft's invariant); commit/push/discard operate on the working tree.

// Resets only the latest local commit, preserving its changes in the worktree.
async function resetGitCommit(cwd, hash) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	if (snapshot.files.length > 0)
		throw new Error(
			"The repository must be clean before resetting a commit.",
		);
	if (!snapshot.commits[0] || snapshot.commits[0].hash !== hash)
		throw new Error("Only the latest unpushed commit can be reset.");
	await runGit(cwd, ["reset", hash + "^"]);
	return { hash: hash };
}

// Reverts a displayed local commit by creating its inverse (no history rewrite).
async function revertGitCommit(cwd, hash) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	if (snapshot.files.length > 0)
		throw new Error(
			"The repository must be clean before reverting a commit.",
		);
	if (!snapshot.commits.some((c) => c.hash === hash))
		throw new Error("This commit cannot be reverted.");
	await runGit(cwd, ["revert", "--no-edit", hash]);
	return { hash: hash };
}

// Commits all current changes (git add -A) with the given message.
async function commitChanges(cwd, message) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	if (snapshot.files.length === 0)
		throw new Error("There are no changes to commit.");
	if (!message.trim()) throw new Error("A commit message is required.");
	await runGit(cwd, ["add", "-A"]);
	await runGit(cwd, ["commit", "-m", message.trim()]);
}

// Pushes commits ahead of the tracked branch.
async function pushCommits(cwd) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	if (snapshot.ahead === 0) throw new Error("There are no commits to push.");
	const push = await runGit(cwd, ["push"], [0, 1]);
	return push.exitCode === 0
		? { pushed: true }
		: { pushed: false, pushError: gitError(push) };
}

// Discards changes for one file (staged, unstaged, or untracked).
function pathsForGitStatus(output, targetPath) {
	const fields = output.split("\0");
	for (let index = 0; index < fields.length - 1; index += 1) {
		const field = fields[index];
		if (!field) continue;
		const code = field.slice(0, 2);
		const p = field.slice(3);
		if (code.indexOf("R") >= 0 || code.indexOf("C") >= 0) {
			const oldPath = fields[++index];
			if (p === targetPath) return oldPath ? [p, oldPath] : [p];
			continue;
		}
		if (p === targetPath) return [p];
	}
	throw new Error("This file has no changes to discard.");
}
async function discardFileChanges(cwd, repoPath) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	const file = snapshot.files.find((c) => c.path === repoPath);
	if (!file) throw new Error("This file has no changes to discard.");
	if (file.status === "added") {
		await runGit(
			cwd,
			["rm", "-f", "--cached", "--", repoPath],
			[0, 1, 128],
		);
		await runGit(cwd, ["clean", "-fd", "--", repoPath]);
		return;
	}
	const status = await runGit(cwd, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	]);
	const paths = pathsForGitStatus(status.stdout, repoPath);
	await runGit(
		cwd,
		["restore", "--source=HEAD", "--staged", "--worktree", "--"].concat(
			paths,
		),
	);
}

// Discards ALL uncommitted changes (including untracked, excluding ignored).
async function discardChanges(cwd) {
	const snapshot = await getGitSnapshot(cwd);
	if (!snapshot.repository)
		throw new Error("The current directory is not a Git repository.");
	if (snapshot.files.length === 0)
		throw new Error("There are no changes to discard.");
	const branch = await runGit(cwd, ["rev-parse", "--verify", "HEAD"], [0, 1]);
	if (branch.exitCode === 0) {
		await runGit(cwd, ["reset", "--hard", "HEAD"]);
	} else {
		await runGit(cwd, ["rm", "-rf", "--cached", "."]);
	}
	await runGit(cwd, ["clean", "-fd"]);
}

module.exports = {
	getGitSnapshot: getGitSnapshot,
	getGitFileDiff: getGitFileDiff,
	commitChanges: commitChanges,
	pushCommits: pushCommits,
	resetGitCommit: resetGitCommit,
	revertGitCommit: revertGitCommit,
	discardFileChanges: discardFileChanges,
	discardChanges: discardChanges,
	parseGitStatus: parseGitStatus,
	parseGitNameStatus: parseGitNameStatus,
	mergeNumstats: mergeNumstats,
	parseNumstat: parseNumstat,
	summarizeGitChanges: summarizeGitChanges,
	boundedGitDiff: boundedGitDiff,
	statusFor: statusFor,
	numberOrNull: numberOrNull,
	gitExecutableForPlatform: gitExecutableForPlatform,
	sanitizeWindowsPathExt: sanitizeWindowsPathExt,
};
