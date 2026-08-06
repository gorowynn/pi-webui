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
"use strict";

const { spawn } = require("child_process");

// ---- git spawn helper ----
function runGit(cwd, args, allowedExitCodes) {
	allowedExitCodes = allowedExitCodes || [0];
	return new Promise((resolve, reject) => {
		const p = spawn("git", args, { cwd: cwd, stdio: ["ignore", "pipe", "pipe"] });
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
			const result = { exitCode: exitCode == null ? 1 : exitCode, stdout: stdout, stderr: stderr };
			if (allowedExitCodes.indexOf(result.exitCode) >= 0) resolve(result);
			else reject(new Error(gitError(result)));
		});
	});
}
function gitError(result) {
	return (result.stderr || "").trim() || (result.stdout || "").trim() || "The Git command failed.";
}

// ---- snapshot ----
async function getGitSnapshot(cwd) {
	const repository = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], [0, 128]);
	if (repository.exitCode !== 0 || repository.stdout.trim() !== "true")
		return { repository: false, root: null, branch: null, files: [], ahead: 0, commits: [] };

	const results = await Promise.all([
		runGit(cwd, ["rev-parse", "--show-toplevel"]),
		runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
		runGit(cwd, ["diff", "--numstat", "-z"]),
		runGit(cwd, ["diff", "--cached", "--numstat", "-z"]),
		runGit(cwd, ["branch", "--show-current"]),
		runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], [0, 128]),
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
			.filter((change) => change.status === "added" && !counts.has(change.path))
			.map(async (change) => {
				const result = await runGit(
					cwd,
					["diff", "--no-index", "--numstat", "-z", "--", "/dev/null", change.path],
					[0, 1],
				);
				const countsArr = parseNumstat(result.stdout);
				if (countsArr[0])
					counts.set(change.path, {
						additions: countsArr[0].additions,
						deletions: countsArr[0].deletions,
					});
			}),
	);

	const commits = upstream.exitCode === 0 ? await unpushedCommits(cwd) : [];

	return {
		repository: true,
		root: root.stdout.trim() || null,
		branch: branch.stdout.trim() || "HEAD",
		files: changes.map((change) => {
			const count = counts.get(change.path);
			return {
				path: change.path,
				status: change.status,
				additions: count ? count.additions : null,
				deletions: count ? count.deletions : null,
			};
		}),
		ahead: commits.length,
		commits: commits,
	};
}

async function unpushedCommits(cwd) {
	const result = await runGit(cwd, ["log", "--format=%H%x00%s%x00", "@{upstream}..HEAD"]);
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
			commit.files = parseGitNameStatus(results[0].stdout).map((change) => {
				const count = counts.get(change.path);
				return {
					path: change.path,
					status: change.status,
					additions: count ? count.additions : null,
					deletions: count ? count.deletions : null,
				};
			});
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
		if (!file || (file.status !== "added" && file.status !== "modified"))
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
		return { path: repoPath, diff: result.stdout };
	}
	const file = snapshot.files.find((c) => c.path === repoPath);
	if (!file || (file.status !== "added" && file.status !== "modified"))
		throw new Error("This file cannot be displayed.");
	const trackedDiff = await runGit(cwd, ["diff", "HEAD", "--", repoPath], [0, 128]);
	if (trackedDiff.stdout) return { path: repoPath, diff: trackedDiff.stdout };
	const untrackedDiff = await runGit(cwd, ["diff", "--no-index", "--", "/dev/null", repoPath], [0, 1]);
	return { path: repoPath, diff: untrackedDiff.stdout };
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
		if (code.indexOf("R") >= 0 || code.indexOf("C") >= 0) index += 1;
		changes.push({ path: p, status: statusFor(code) });
	}
	return changes;
}

function parseGitNameStatus(output) {
	const fields = output.split("\0");
	const changes = [];
	for (let index = 0; index < fields.length - 1; index += 1) {
		const code = fields[index];
		const p = fields[++index];
		if (!code || !p) continue;
		if (code.startsWith("R") || code.startsWith("C")) {
			const newPath = fields[++index];
			if (newPath) changes.push({ path: newPath, status: statusFor(code) });
			continue;
		}
		changes.push({ path: p, status: statusFor(code) });
	}
	return changes;
}

function mergeNumstats() {
	var outputs = Array.prototype.slice.call(arguments);
	const counts = new Map();
	for (const output of outputs) {
		for (const count of parseNumstat(output)) {
			const current = counts.get(count.path);
			counts.set(count.path, {
				additions:
					current && current.additions != null && count.additions != null
						? current.additions + count.additions
						: count.additions,
				deletions:
					current && current.deletions != null && count.deletions != null
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
			counts.push({ path: p, additions: numberOrNull(additions), deletions: numberOrNull(deletions) });
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

module.exports = {
	getGitSnapshot: getGitSnapshot,
	getGitFileDiff: getGitFileDiff,
	parseGitStatus: parseGitStatus,
	parseGitNameStatus: parseGitNameStatus,
	mergeNumstats: mergeNumstats,
	parseNumstat: parseNumstat,
	statusFor: statusFor,
	numberOrNull: numberOrNull,
};
