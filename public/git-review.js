/*
 * git-review.js — pure review-state and tool-target helpers.
 *
 * No DOM or network access: app.js owns rendering and Git API calls. Keeping
 * this seam pure makes the review surface testable without a browser and keeps
 * path/link decisions conservative before they reach the existing Git boundary.
 */
(() => {
	const STATUSES = new Set([
		"added",
		"modified",
		"deleted",
		"renamed",
		"untracked",
		"binary",
		"unknown",
	]);
	const TARGET_TOOLS = new Set([
		"read",
		"edit",
		"write",
		"find",
		"grep",
		"ls",
		"glob",
	]);
	const INSPECT_TOOLS = new Set(["read", "find", "grep", "ls", "glob"]);

	function text(value) {
		return typeof value === "string" ? value : "";
	}

	function numberOrNull(value) {
		if (value == null || value === "") return null;
		const n = Number(value);
		return Number.isFinite(n) && n >= 0 ? n : null;
	}

	function normalizePath(value) {
		return text(value)
			.replace(/\\/g, "/")
			.replace(/^\.\/+/, "")
			.replace(/\/+/g, "/");
	}

	function normalizeStatus(value) {
		const status = text(value).toLowerCase();
		return STATUSES.has(status) ? status : "unknown";
	}

	function normalizeChangedFile(raw) {
		const source = raw && typeof raw === "object" ? raw : {};
		const path = normalizePath(
			source.path || source.filePath || source.file_path,
		);
		const status =
			source.binary === true ? "binary" : normalizeStatus(source.status);
		return {
			path,
			oldPath: normalizePath(source.oldPath || source.old_path) || null,
			status,
			additions: numberOrNull(source.additions),
			deletions: numberOrNull(source.deletions),
			diffAvailable:
				source.diffAvailable === false
					? false
					: status !== "binary" && path.length > 0,
		};
	}

	function countStatus(files, status) {
		return files.filter((file) => file.status === status).length;
	}

	function explicitCount(summary, source, key) {
		return numberOrNull(summary[key]) ?? numberOrNull(source[key]);
	}

	function summaryFor(source, files) {
		const summary =
			source.summary && typeof source.summary === "object"
				? source.summary
				: {};
		const changed = files.length;
		const staged =
			explicitCount(summary, source, "staged") ??
			(source.files || []).filter((file) => file && file.staged === true)
				.length;
		const untracked =
			explicitCount(summary, source, "untracked") ??
			countStatus(files, "untracked");
		const unstaged =
			explicitCount(summary, source, "unstaged") ??
			Math.max(0, changed - staged - untracked);
		return {
			changed,
			staged,
			unstaged,
			untracked,
			added: countStatus(files, "added"),
			modified: countStatus(files, "modified"),
			deleted: countStatus(files, "deleted"),
			renamed: countStatus(files, "renamed"),
		};
	}

	function emptySnapshot(state, error) {
		return {
			state,
			repository: false,
			root: null,
			branch: null,
			detached: false,
			files: [],
			summary: {
				changed: 0,
				staged: 0,
				unstaged: 0,
				untracked: 0,
				added: 0,
				modified: 0,
				deleted: 0,
				renamed: 0,
			},
			ahead: 0,
			commits: [],
			error: error || null,
		};
	}

	function normalizeReviewSnapshot(input) {
		if (input == null) return emptySnapshot("loading");
		if (input.ok === false)
			return emptySnapshot(
				"error",
				text(input.error) || "failed to load Git state",
			);
		const source =
			input.snapshot && typeof input.snapshot === "object"
				? input.snapshot
				: input;
		if (source.repository === false) return emptySnapshot("unavailable");

		const rawFiles = Array.isArray(source.files) ? source.files : [];
		const files = rawFiles
			.map(normalizeChangedFile)
			.filter((file) => file.path);
		const rawBranch = text(source.branch).trim();
		const detached = source.detached === true || rawBranch === "HEAD";
		const branch = rawBranch || (detached ? "HEAD" : null);
		return {
			state: files.length ? "ready" : "clean",
			repository: source.repository !== false,
			root: text(source.root) || null,
			branch,
			detached,
			files,
			summary: summaryFor(source, files),
			ahead: numberOrNull(source.ahead) ?? 0,
			commits: Array.isArray(source.commits) ? source.commits : [],
			error: null,
		};
	}

	function reconcileReviewSelection(review, selectedPath) {
		if (!review || !Array.isArray(review.files) || review.state !== "ready")
			return null;
		const path = normalizePath(selectedPath);
		const file = review.files.find((entry) => entry.path === path);
		return file ? { path: file.path, status: file.status } : null;
	}

	function reviewDiffState(file, response) {
		if (!file)
			return {
				state: "stale",
				diff: "",
				message: "File is no longer in the current Git snapshot.",
			};
		if (file.status === "binary")
			return {
				state: "binary",
				diff: "",
				message: "Binary or unavailable diff.",
			};
		if (response && response.unavailable === "oversized")
			return {
				state: "oversized",
				diff: "",
				message: "Diff is too large to display.",
			};
		if (response && response.unavailable)
			return {
				state: "unavailable",
				diff: "",
				message: String(response.unavailable),
			};
		if (file.diffAvailable === false)
			return {
				state: "binary",
				diff: "",
				message: "Binary or unavailable diff.",
			};
		if (!response || response.ok === false) {
			const deleted = file.status === "deleted";
			return {
				state: deleted ? "deleted" : "error",
				diff: "",
				message:
					(response && text(response.error)) ||
					(deleted ? "Deletion diff unavailable." : "Failed to load diff."),
			};
		}
		return { state: "ready", diff: String(response.diff || ""), message: null };
	}

	function relativeToolPath(value) {
		const raw = text(value).trim();
		if (!raw || /^[\\/]/.test(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return null;
		const path = normalizePath(raw);
		if (!path || path === "." || path.split("/").some((part) => part === ".."))
			return null;
		return path;
	}

	function reviewTargetFromTool(toolName, args) {
		const tool = text(toolName).toLowerCase();
		if (!TARGET_TOOLS.has(tool) || !args || typeof args !== "object")
			return null;
		const candidate =
			args.path || args.filePath || args.file_path || args.filename;
		const path = relativeToolPath(candidate);
		if (!path) return null;
		return {
			path,
			intent: INSPECT_TOOLS.has(tool) ? "inspect" : "changed-file",
		};
	}

	const api = {
		normalizeChangedFile,
		normalizeReviewSnapshot,
		reconcileReviewSelection,
		reviewDiffState,
		reviewTargetFromTool,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.gitReview = api;
})();
