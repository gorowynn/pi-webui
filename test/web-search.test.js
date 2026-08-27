// W03 — configurable provider selection and bounded web-search results.

const assert = require("node:assert/strict");
const {
	ABSOLUTE_SEARCH_LIMITS,
	BRAVE_SEARCH_ENDPOINT,
	MAX_PROVIDER_RESULTS,
	SEARCH_PROVIDER_NAMES,
	SEARCH_SCHEMA,
	readSearchConfig,
	searchWeb,
} = require("../web-search.js");

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

run(
	"reads one explicit provider and resolves its key server-side",
	async () => {
		assert.deepEqual(
			readSearchConfig({
				PI_WEB_SEARCH_PROVIDER: " BRAVE ",
				PI_WEB_SEARCH_BRAVE_API_KEY: " brave-secret ",
			}),
			{ provider: "brave", apiKey: "brave-secret" },
		);
		assert.deepEqual(
			readSearchConfig({
				PI_WEB_SEARCH_PROVIDER: "brave",
				PI_WEB_SEARCH_API_KEY: "generic-secret",
			}),
			{ provider: "brave", apiKey: "generic-secret" },
		);
	},
);

run("normalizes bounded canonical results and retrieval metadata", async () => {
	const calls = [];
	const result = await searchWeb("  pi webui  ", {
		provider: "brave",
		apiKey: "brave-secret",
		limit: 2,
		maxTitleChars: 12,
		maxSnippetChars: 18,
		fetcher: async (url, options) => {
			calls.push({ url, options });
			return {
				ok: true,
				text: JSON.stringify({
					web: {
						results: [
							{
								title: "brave-secret result title",
								description: "A very long result description",
								url: "HTTPS://Example.com/first",
							},
							{
								title: "Second",
								description: "Second description",
								url: "https://example.org/second",
							},
							{
								title: "Not requested",
								url: "https://example.net/third",
							},
						],
					},
				}),
			};
		},
	});
	assert.equal(result.ok, true);
	assert.equal(result.schema, SEARCH_SCHEMA);
	assert.equal(result.provider, "brave");
	assert.equal(result.query, "pi webui");
	assert.equal(result.resultCount, 2);
	assert.equal(result.results[0].url, "https://example.com/first");
	assert.equal(result.results[1].url, "https://example.org/second");
	assert.ok(result.results[0].title.length <= 12);
	assert.ok(result.results[0].snippet.length <= 18);
	assert.equal(result.truncated, true);
	assert.equal(result.untrusted, true);
	assert.equal(result.instructionBoundary, "data-only");
	assert.equal(typeof result.retrievedAt, "number");
	assert.equal(
		new URL(calls[0].url).origin,
		new URL(BRAVE_SEARCH_ENDPOINT).origin,
	);
	assert.equal(new URL(calls[0].url).searchParams.get("q"), "pi webui");
	assert.equal(new URL(calls[0].url).searchParams.get("count"), "2");
	assert.equal(calls[0].options.headers["x-subscription-token"], "brave-secret");
	assert.doesNotMatch(JSON.stringify(result), /brave-secret/);
});

run(
	"does not fall back across unavailable or uncredentialed providers",
	async () => {
		let called = false;
		const fetcher = async () => {
			called = true;
			return { ok: true, text: '{"results":[]}' };
		};
		const required = await searchWeb("pi", { config: {}, fetcher });
		assert.equal(required.ok, false);
		assert.equal(required.error.code, "WEB_SEARCH_PROVIDER_REQUIRED");

		const unavailable = await searchWeb("pi", {
			provider: "google",
			apiKey: "google-secret",
			fetcher,
		});
		assert.equal(unavailable.ok, false);
		assert.equal(unavailable.error.code, "WEB_SEARCH_PROVIDER_UNAVAILABLE");

		const uncredentialed = await searchWeb("pi", {
			provider: "brave",
			config: { provider: "brave", apiKey: "" },
			fetcher,
		});
		assert.equal(uncredentialed.ok, false);
		assert.equal(uncredentialed.error.code, "WEB_SEARCH_UNAUTHENTICATED");
		assert.equal(called, false);
	},
);

run("rejects query and limit values beyond the safety bounds", async () => {
	const fetcher = async () => {
		throw new Error("must not request");
	};
	const longQuery = await searchWeb("x", {
		provider: "brave",
		apiKey: "secret",
		maxQueryChars: ABSOLUTE_SEARCH_LIMITS.maxQueryChars + 1,
		fetcher,
	});
	assert.equal(longQuery.ok, false);
	assert.equal(longQuery.error.code, "WEB_SEARCH_LIMITS");

	const tooMuch = await searchWeb(
		"x".repeat(ABSOLUTE_SEARCH_LIMITS.maxQueryChars + 1),
		{
			provider: "brave",
			apiKey: "secret",
			fetcher,
		},
	);
	assert.equal(tooMuch.ok, false);
	assert.equal(tooMuch.error.code, "WEB_SEARCH_QUERY");

	const tooMany = await searchWeb("x", {
		provider: "brave",
		apiKey: "secret",
		limit: ABSOLUTE_SEARCH_LIMITS.maxResults + 1,
		fetcher,
	});
	assert.equal(tooMany.ok, false);
	assert.equal(tooMany.error.code, "WEB_SEARCH_LIMITS");
});

run(
	"supports only a bounded adapter surface and drops unsafe duplicate sources",
	async () => {
		assert.deepEqual(SEARCH_PROVIDER_NAMES, ["brave"]);
		assert.ok(SEARCH_PROVIDER_NAMES.length <= 2);
		const result = await searchWeb("pi", {
			provider: "test",
			providers: {
				test: {
					requiresKey: false,
					search: async () => ({
						results: [
							{ url: "https://Example.com/", title: "first" },
							{ url: "https://example.com", title: "duplicate" },
							{ url: "http://127.0.0.1/private", title: "unsafe" },
							...Array.from({ length: MAX_PROVIDER_RESULTS + 1 }, (_, i) => ({
								url: `https://example.org/${i}`,
							})),
						],
					}),
				},
			},
			limit: 3,
		});
		assert.equal(result.ok, true);
		assert.equal(result.results.length, 3);
		assert.equal(result.results[0].url, "https://example.com/");
		assert.equal(result.droppedResults > 0, true);
		assert.equal(result.truncated, true);
		assert.equal(JSON.stringify(result).includes("127.0.0.1"), false);
	},
);

run("maps provider failures to bounded retryable errors", async () => {
	const result = await searchWeb("pi", {
		provider: "brave",
		apiKey: "secret",
		fetcher: async () => ({
			ok: false,
			error: { code: "WEB_FETCH_TIMEOUT", reason: "secret socket details" },
		}),
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "WEB_SEARCH_TIMEOUT");
	assert.equal(result.error.reason, "Search provider request failed");
	assert.doesNotMatch(JSON.stringify(result), /secret/);
});

Promise.all(pending).then(() => {
	console.log("\n" + passed + " passed");
});
