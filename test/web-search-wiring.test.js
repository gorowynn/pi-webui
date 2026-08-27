// W03 wiring — server-owned settings, extension registration, and policy gate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const webSearch = require("../web-search.js");

const ROOT = path.join(__dirname, "..");
const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const indexSource = fs.readFileSync(
	path.join(ROOT, "extensions/pi_minimal_webui/index.ts"),
	"utf8",
);
const webSource = fs.readFileSync(
	path.join(ROOT, "extensions/pi_minimal_webui/web.ts"),
	"utf8",
);
const policySource = fs.readFileSync(
	path.join(ROOT, "extensions/pi_minimal_webui/policy-engine.js"),
	"utf8",
);
const htmlSource = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appSource = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const styleSource = fs.readFileSync(path.join(ROOT, "public/style.css"), "utf8");

let passed = 0;
function ok(name) {
	passed++;
	console.log("  ok - " + name);
}

{
	const valid = webSearch.validateSearchConfig({
		provider: "BRAVE",
		apiKey: "secret",
	});
	assert.equal(valid.ok, true);
	assert.deepEqual(valid.config, { provider: "brave", apiKey: "secret" });
	assert.equal(
		webSearch.validateSearchConfig({ provider: "google", apiKey: "secret" }).ok,
		false,
	);
	assert.equal(
		webSearch.validateSearchConfig({
			provider: "brave",
			apiKey: "x".repeat(webSearch.MAX_API_KEY_CHARS + 1),
		}).ok,
		false,
	);
	assert.equal(
		webSearch.validateSearchConfig({ provider: "brave", apiKey: "" }).ok,
		true,
	);
	ok("settings validation accepts Brave, rejects unknown providers, and bounds keys");
}

{
	const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-webui-search-"));
	const file = path.join(temp, ".pi", "agent", "web-search.json");
	try {
		const saved = webSearch.writeStoredSearchConfig(
			{ provider: "brave", apiKey: "file-secret" },
			file,
		);
		assert.deepEqual(saved, { provider: "brave", configured: true });
		assert.deepEqual(webSearch.readStoredSearchConfig(file), {
			provider: "brave",
			apiKey: "file-secret",
		});
		assert.deepEqual(webSearch.readConfiguredSearchConfig({}, file), {
			provider: "brave",
			apiKey: "file-secret",
		});
		assert.deepEqual(
			webSearch.readConfiguredSearchConfig(
				{
					PI_WEB_SEARCH_PROVIDER: "brave",
					PI_WEB_SEARCH_BRAVE_API_KEY: "env-secret",
				},
				file,
			),
			{ provider: "brave", apiKey: "env-secret" },
		);
	} finally {
		fs.rmSync(temp, { recursive: true, force: true });
	}
	ok("settings persist atomically and environment configuration remains server-side");
}

{
	const getStart = serverSource.indexOf(
		'url.pathname === "/api/web-search/config"',
	);
	const putStart = serverSource.indexOf(
		'url.pathname === "/api/web-search/config"',
		getStart + 1,
	);
	assert.ok(getStart >= 0);
	assert.ok(putStart > getStart);
	const getRoute = serverSource.slice(getStart, putStart);
	assert.match(getRoute, /webSearchConfigPayload/);
	assert.match(serverSource, /configured/);
	assert.doesNotMatch(getRoute, /apiKey/);
	assert.match(serverSource, /webSearch\.writeStoredSearchConfig/);
	assert.match(serverSource, /Buffer\.byteLength\(raw, "utf8"\) > 4096/);
	assert.ok(serverSource.indexOf("if (!isAllowed(req))") < getStart);
	ok("settings API is CSRF-gated, fixed-path, bounded, and never returns the key");
}

{
	assert.match(indexSource, /import web from "\.\/web\.js"/);
	assert.match(indexSource, /\tweb\(pi\);/);
	assert.match(webSource, /name: "web_search"/);
	assert.match(webSource, /readConfiguredSearchConfig/);
	assert.match(webSource, /searchWeb\(input\.query, options\)/);
	assert.match(webSource, /untrusted data/);
	assert.doesNotMatch(webSource, /web_fetch/);
	assert.match(policySource, /web_search: "ask"/);
	ok("web_search is registered, settings-backed, untrusted, and asks by default");
}

{
	for (const id of [
		"web-search-provider",
		"web-search-key",
		"web-search-save",
		"web-search-clear",
		"web-search-key-state",
	])
		assert.match(htmlSource, new RegExp(`id="${id}"`));
	assert.match(htmlSource, /id="web-search-key"[\s\S]*type="password"/);
	assert.match(htmlSource, /autocomplete="new-password"/);
	assert.match(htmlSource, /role="status"[\s\S]*aria-live="polite"/);
	assert.match(appSource, /refreshWebSearchSettings/);
	assert.match(appSource, /saveWebSearchSettings/);
	assert.match(appSource, /fetch\("\/api\/web-search\/config"/);
	assert.doesNotMatch(appSource, /localStorage\.setItem\([^\n]*web-search/);
	assert.match(styleSource, /#settings input\[type="password"\]/);
	ok("settings exposes a labelled password field without browser persistence");
}

console.log("\n" + passed + " passed");
