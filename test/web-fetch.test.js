// W02 — bounded HTTP fetch and text extraction contracts
"use strict";

const assert = require("node:assert/strict");
const { fetchWeb } = require("../web-fetch.js");

let pass = 0;
const pending = [];
function run(name, fn) {
	pending.push(
		(async () => {
			try {
				await fn();
				pass++;
				console.log("  ok - " + name);
			} catch (error) {
				console.error("  FAIL - " + name + "\n    " + error.message);
				process.exitCode = 1;
			}
		})(),
	);
}

function transportFor(responses, calls) {
	return async (request) => {
		calls.push(request);
		const response = responses.shift();
		if (!response) throw new Error("unexpected transport call");
		if (response.error) throw response.error;
		return response;
	};
}

const publicResolve = async () => [
	{ address: "93.184.216.34", family: 4 },
];

run("fetches bounded text with canonical and untrusted metadata", async () => {
	const calls = [];
	const result = await fetchWeb("HTTPS://Example.com/start?q=1", {
		resolve: publicResolve,
		transport: transportFor(
			[
				{
					status: 200,
					headers: { "content-type": "text/plain; charset=utf-8" },
					body: "hello from the web",
				},
			],
			calls,
		),
	});
	assert.equal(result.ok, true);
	assert.equal(result.requestedUrl, "https://example.com/start?q=1");
	assert.equal(result.finalUrl, "https://example.com/start?q=1");
	assert.equal(result.status, 200);
	assert.equal(result.contentType, "text/plain");
	assert.equal(result.charset, "utf-8");
	assert.equal(result.text, "hello from the web");
	assert.equal(result.untrusted, true);
	assert.equal(result.instructionBoundary, "data-only");
	assert.equal(typeof result.retrievedAt, "number");
	assert.equal(result.redirects, 0);
	assert.equal(calls[0].address, "93.184.216.34");
});

run("checks resolver output before opening a connection", async () => {
	const calls = [];
	const result = await fetchWeb("https://example.com/", {
		resolve: async () => ["192.168.0.10"],
		transport: transportFor([], calls),
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "WEB_DNS_UNSAFE_TARGET");
	assert.equal(calls.length, 0);
});

run("follows bounded redirects and revalidates the final target", async () => {
	const calls = [];
	const result = await fetchWeb("https://example.com/start", {
		resolve: publicResolve,
		transport: transportFor(
			[
				{ status: 302, headers: { location: "/final" }, body: "" },
				{
					status: 200,
					headers: { "content-type": "text/html" },
					body: "<p>done</p>",
				},
			],
			calls,
		),
	});
	assert.equal(result.ok, true);
	assert.equal(result.finalUrl, "https://example.com/final");
	assert.equal(result.redirects, 1);
	assert.deepEqual(result.redirectChain, [
		"https://example.com/start",
		"https://example.com/final",
	]);
	assert.equal(calls.length, 2);

	const unsafeCalls = [];
	const unsafe = await fetchWeb("https://example.com/start", {
		resolve: publicResolve,
		transport: transportFor(
			[{ status: 302, headers: { location: "http://127.0.0.1/admin" }, body: "" }],
			unsafeCalls,
		),
	});
	assert.equal(unsafe.ok, false);
	assert.equal(unsafe.error.code, "WEB_URL_UNSAFE_TARGET");
	assert.equal(unsafeCalls.length, 1);

	const limited = await fetchWeb("https://example.com/", {
		maxRedirects: 0,
		resolve: publicResolve,
		transport: transportFor(
			[{ status: 302, headers: { location: "https://example.org/" }, body: "" }],
			[],
		),
	});
	assert.equal(limited.ok, false);
	assert.equal(limited.error.code, "WEB_FETCH_REDIRECT_LIMIT");
});

run("returns response and text truncation provenance with safe continuation refs", async () => {
	let stored;
	const byteLimited = await fetchWeb("https://example.com/bytes", {
		maxResponseBytes: 5,
		resolve: publicResolve,
		transport: transportFor(
			[
				{
					status: 200,
					headers: { "content-type": "text/plain" },
					body: "123456789",
				},
			],
			[],
		),
	});
	assert.equal(byteLimited.ok, true);
	assert.equal(byteLimited.text, "12345");
	assert.equal(byteLimited.responseTruncated, true);
	assert.equal(byteLimited.truncated, true);
	assert.equal(byteLimited.continuationRef, undefined);

	const textLimited = await fetchWeb("https://example.com/text", {
		maxTextChars: 4,
		resolve: publicResolve,
		transport: transportFor(
			[
				{
					status: 200,
					headers: { "content-type": "text/plain" },
					body: "abcdefgh",
				},
			],
			[],
		),
		continuationStore: async (entry) => {
			stored = entry;
			return "web-cont-123";
		},
	});
	assert.equal(textLimited.ok, true);
	assert.equal(textLimited.text, "abcd");
	assert.equal(textLimited.textTruncated, true);
	assert.equal(textLimited.truncated, true);
	assert.equal(textLimited.continuationRef, "web-cont-123");
	assert.equal(stored.finalUrl, "https://example.com/text");
	assert.equal(Buffer.isBuffer(stored.body), true);

	const unsafeRef = await fetchWeb("https://example.com/text", {
		maxTextChars: 1,
		resolve: publicResolve,
		transport: transportFor(
			[{ status: 200, headers: { "content-type": "text/plain" }, body: "ab" }],
			[],
		),
		continuationStore: () => "/tmp/arbitrary-path",
	});
	assert.equal(unsafeRef.ok, true);
	assert.equal(unsafeRef.continuationRef, undefined);
});

run("rejects compressed, binary, unsupported, and invalid-encoding responses safely", async () => {
	const cases = [
		{
			headers: { "content-type": "text/plain", "content-encoding": "gzip" },
			body: "secret compressed payload",
			code: "WEB_FETCH_COMPRESSED",
		},
		{
			headers: { "content-type": "application/octet-stream" },
			body: "secret binary payload",
			code: "WEB_FETCH_CONTENT_TYPE",
		},
		{
			headers: { "content-type": "text/plain; charset=x-unknown" },
			body: "secret unsupported encoding",
			code: "WEB_FETCH_ENCODING",
		},
		{
			headers: { "content-type": "text/plain; charset=utf-8" },
			body: Buffer.from([0xc3, 0x28]),
			code: "WEB_FETCH_ENCODING",
		},
	];
	for (const item of cases) {
		const result = await fetchWeb("https://example.com/data", {
			resolve: publicResolve,
			transport: transportFor(
				[{ status: 200, headers: item.headers, body: item.body }],
				[],
			),
		});
		assert.equal(result.ok, false);
		assert.equal(result.error.code, item.code);
		assert.doesNotMatch(JSON.stringify(result), /secret/);
	}
});

run("turns bounded transport failures into actionable errors", async () => {
	const timeout = Object.assign(new Error("raw socket details"), {
		code: "WEB_FETCH_TIMEOUT",
	});
	const result = await fetchWeb("https://example.com/slow", {
		resolve: publicResolve,
		transport: transportFor([{ error: timeout }], []),
	});
	assert.equal(result.ok, false);
	assert.equal(result.error.code, "WEB_FETCH_TIMEOUT");
	assert.equal(result.error.reason, "Web request timed out");
	assert.doesNotMatch(JSON.stringify(result), /raw socket details/);
});

Promise.all(pending).then(() => {
	console.log("\n" + pass + " passed");
});
