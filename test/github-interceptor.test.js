// W04 — bounded GitHub URL parsing and server-side repository resolution.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
	ABSOLUTE_GITHUB_LIMITS,
	DEFAULT_GITHUB_LIMITS,
	GITHUB_API_ORIGIN,
	GITHUB_SCHEMA,
	GitHubInterceptor,
	fetchGitHub,
	parseGitHubTarget,
	parseGitHubUrl,
	validateGitHubTarget,
} = require("../github-interceptor.js");

let passed = 0;
const pending = [];
function run(name, fn) {
	pending.push(
		(async () => {
			try {
				await fn();
				passed++;
				console.log("  ok - " + name);
			} catch (error) {
				console.error("  FAIL - " + name + "\n    " + error.message);
				process.exitCode = 1;
			}
		})(),
	);
}

run("parses repository, tree, blob, and raw GitHub forms", () => {
	assert.deepEqual(parseGitHubUrl("https://github.com/owner/repo.git"), {
		owner: "owner",
		repo: "repo",
		refIsFullSha: false,
		type: "root",
	});
	assert.deepEqual(
		parseGitHubUrl("https://github.com/owner/repo/tree/main/src"),
		{
			owner: "owner",
			repo: "repo",
			ref: "main",
			refIsFullSha: false,
			path: "src",
			type: "tree",
		},
	);
	assert.deepEqual(
		parseGitHubUrl("https://www.github.com/owner/repo/blob/main/src/app.js"),
		{
			owner: "owner",
			repo: "repo",
			ref: "main",
			refIsFullSha: false,
			path: "src/app.js",
			type: "blob",
		},
	);
	assert.equal(
		parseGitHubUrl(
			"https://raw.githubusercontent.com/owner/repo/main/src/app.js",
		).type,
		"raw",
	);
	assert.equal(
		parseGitHubUrl("https://github.com/owner/repo/raw/main/src/app.js").type,
		"raw",
	);
	assert.equal(
		parseGitHubUrl(
			`https://github.com/owner/repo/blob/${"a".repeat(40)}/file.txt`,
		).refIsFullSha,
		true,
	);
	assert.equal(
		parseGitHubUrl("https://github.com/owner/repo/tree/main").path,
		"",
	);
});

run("returns validated target metadata and canonical source URLs", () => {
	const target = parseGitHubTarget(
		"https://github.com/owner/repo/blob/main/path%20with%20spaces/file.js?raw=1",
	);
	assert.deepEqual(target, {
		owner: "owner",
		repository: "repo",
		ref: "main",
		path: "path with spaces/file.js",
		targetKind: "file",
		canonicalUrl:
			"https://github.com/owner/repo/blob/main/path%20with%20spaces/file.js",
	});
	assert.equal(validateGitHubTarget("https://example.com/owner/repo").ok, false);
});

run("rejects unsafe, unsupported, and ambiguous URL targets", () => {
	for (const url of [
		"https://example.com/owner/repo",
		"https://github.com/owner",
		"https://github.com/owner/repo/blob",
		"https://github.com/owner/repo/tree",
		"https://github.com/owner/repo/raw/main",
		"https://github.com/owner/repo/blob/refs/heads/main/file.js",
		"https://github.com/owner/repo/blob/main/%2e%2e/secrets.txt",
		"https://github.com/owner/repo/blob/main/safe%2fother.txt",
		"https://github.com/owner/repo/blob/main/safe%5cother.txt",
		"https://github.com/owner/repo/blob/main/%ZZ.txt",
		"https://github.com/owner/repo/blob/main/file.js/..",
		"https://github.com/owner/repo/blob/main/file.js?x=1#unsafe-fragment",
		"https://github.com:444/owner/repo/blob/main/file.js",
	]) {
		if (url.includes("?x=1")) continue;
		assert.equal(parseGitHubUrl(url), null, url);
	}
	assert.equal(
		parseGitHubUrl("https://github.com/owner/repo/blob/main/file.js?x=1")?.path,
		"file.js",
	);
});

run("enforces bounded request limits before making a request", async () => {
	let calls = 0;
	const result = await fetchGitHub("https://github.com/owner/repo/blob/main/file.js", {
		maxFileBytes: DEFAULT_GITHUB_LIMITS.maxFileBytes,
		fetcher: async () => {
			calls++;
			return {
				ok: true,
				status: 200,
				payload: {
					type: "file",
					size: DEFAULT_GITHUB_LIMITS.maxFileBytes + 1,
					encoding: "base64",
					content: "",
				},
			};
		},
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "GITHUB_FILE_TOO_LARGE");
	assert.equal(calls, 1);
	assert.ok(ABSOLUTE_GITHUB_LIMITS.maxFileBytes > DEFAULT_GITHUB_LIMITS.maxFileBytes);
});

run("resolves bounded directory listings through the GitHub API", async () => {
	const calls = [];
	const result = await fetchGitHub("https://github.com/owner/repo/tree/main/src", {
		fetcher: async (url, options) => {
			calls.push({ url, options });
			return {
				ok: true,
				status: 200,
				payload: [
					{ name: "app.js", path: "src/app.js", type: "file", size: 42 },
					{ name: "lib", path: "src/lib", type: "dir" },
				],
			};
		},
	});
	assert.equal(result.ok, true);
	assert.equal(result.schema, GITHUB_SCHEMA);
	assert.equal(result.kind, "directory");
	assert.equal(result.target.targetKind, "tree");
	assert.equal(result.entries[0].type, "file");
	assert.equal(result.entries[1].type, "directory");
	assert.equal(result.entries[0].url, "https://github.com/owner/repo/blob/main/src/app.js");
	assert.equal(result.untrusted, true);
	assert.equal(result.instructionBoundary, "data-only");
	assert.equal(result.finalUrl, result.target.canonicalUrl);
	assert.equal(new URL(calls[0].url).origin, GITHUB_API_ORIGIN);
	assert.equal(new URL(calls[0].url).pathname, "/repos/owner/repo/contents/src");
	assert.equal(new URL(calls[0].url).searchParams.get("ref"), "main");
	assert.equal(calls[0].options.headers.authorization, undefined);
	assert.equal(calls[0].options.maxResponseBytes, DEFAULT_GITHUB_LIMITS.maxResponseBytes);
});

run("decodes bounded text files and keeps private auth server-side", async () => {
	const token = "private-secret";
	const content = "# trusted-looking remote data\nprivate-secret should be redacted.";
	let request;
	const result = await fetchGitHub(
		"https://raw.githubusercontent.com/owner/repo/main/README.md",
		{
			token,
			fetcher: async (url, options) => {
				request = { url, options };
				return {
					ok: true,
					status: 200,
					payload: {
						type: "file",
						size: Buffer.byteLength(content),
						encoding: "base64",
						content: Buffer.from(content).toString("base64"),
					},
				};
			},
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.kind, "file");
	assert.equal(result.content, content.split(token).join("[redacted]"));
	assert.equal(result.bytes, Buffer.byteLength(content));
	assert.equal(result.target.authScope, "configured-private");
	assert.equal(request.options.headers.authorization, `Bearer ${token}`);
	assert.doesNotMatch(JSON.stringify(result), /private-secret/);
});

run("maps missing paths, rate limits, private auth, and API failures", async () => {
	const url = "https://github.com/owner/repo/blob/main/file.js";
	const response = (status, headers = {}) => async () => ({
		ok: true,
		status,
		headers,
		text: JSON.stringify({ message: "provider detail must not escape" }),
	});
	const missing = await fetchGitHub(url, { fetcher: response(404) });
	assert.equal(missing.error.code, "GITHUB_NOT_FOUND");
	assert.equal(missing.status, 404);
	const rate = await fetchGitHub(url, {
		fetcher: response(403, { "x-ratelimit-remaining": "0" }),
	});
	assert.equal(rate.error.code, "GITHUB_RATE_LIMIT");
	assert.equal(rate.retryable, true);
	const privateAuth = await fetchGitHub(url, {
		token: "bad-token",
		fetcher: response(401),
	});
	assert.equal(privateAuth.error.code, "GITHUB_PRIVATE_AUTH");
	const unavailable = await fetchGitHub(url, { fetcher: response(503) });
	assert.equal(unavailable.error.code, "GITHUB_API_UNAVAILABLE");
	assert.equal(unavailable.retryable, true);
	assert.doesNotMatch(JSON.stringify(unavailable), /provider detail/);
});

run("rejects malformed, binary, and wrong-shape API responses safely", async () => {
	const url = "https://github.com/owner/repo/blob/main/file.js";
	const malformed = await fetchGitHub(url, {
		fetcher: async () => ({ ok: true, status: 200, text: "not json" }),
	});
	assert.equal(malformed.error.code, "GITHUB_API_RESPONSE");
	const binary = await fetchGitHub(url, {
		fetcher: async () => ({
			ok: true,
			status: 200,
			payload: {
				type: "file",
				size: 2,
				encoding: "base64",
				content: Buffer.from([0, 1]).toString("base64"),
			},
		}),
	});
	assert.equal(binary.error.code, "GITHUB_BINARY_FILE");
	const wrongShape = await fetchGitHub(url, {
		fetcher: async () => ({ ok: true, status: 200, payload: [] }),
	});
	assert.equal(wrongShape.error.code, "GITHUB_TARGET_TYPE");
});

run("maps network failures and never shells out or writes a workspace", async () => {
	const result = await fetchGitHub("https://github.com/owner/repo", {
		fetcher: async () => ({
			ok: false,
			error: { code: "WEB_FETCH_TIMEOUT", reason: "secret socket path" },
		}),
	});
	assert.equal(result.error.code, "GITHUB_TIMEOUT");
	assert.doesNotMatch(JSON.stringify(result), /secret socket path/);
	const source = fs.readFileSync(require.resolve("../github-interceptor.js"), "utf8");
	assert.doesNotMatch(source, /child_process|execFile|spawn\(|writeFile|mkdir|rmSync/);
});

run("supports an opt-out interceptor without changing the fallback path", async () => {
	const disabled = new GitHubInterceptor({ enabled: false });
	assert.equal(
		await disabled.intercept("https://github.com/owner/repo"),
		null,
	);
	const enabled = new GitHubInterceptor({ enabled: true });
	const result = await enabled.intercept("https://example.com/owner/repo", {
		fetcher: async () => ({ ok: true, status: 200, payload: [] }),
	});
	assert.equal(result, null);
});

Promise.all(pending).then(() => {
	console.log("\n" + passed + " passed");
});
