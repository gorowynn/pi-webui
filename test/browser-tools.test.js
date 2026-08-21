const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../extensions/pi_minimal_webui/policy-engine.js");
const {
	DEFAULT_VIEWPORT_HEIGHT,
	DEFAULT_VIEWPORT_WIDTH,
	browserCandidates,
	buildLaunchArgs,
	closeBrowser,
	launchManagedBrowser,
	parseAllowedHosts,
	readBrowserConfig,
	reserveLoopbackPort,
	resolveBrowserBinary,
	startBrowser,
	validateBrowserUrl,
	validateCdpEndpoint,
} = require("../extensions/pi_minimal_webui/browser-runtime.js");
const {
	MAX_ELEMENTS,
	MAX_PAGE_TEXT_BYTES,
	SNAPSHOT_SCHEMA,
	SNAPSHOT_SCRIPT,
	SnapshotRefStore,
	normalizeSnapshot,
} = require("../extensions/pi_minimal_webui/browser-snapshot.js");
const {
	CONSOLE_SCHEMA,
	MAX_ENTRIES,
	MAX_TEXT_BYTES,
	ConsoleCollector,
} = require("../extensions/pi_minimal_webui/browser-console.js");
const {
	MAX_SCREENSHOT_BYTES,
	captureScreenshot,
} = require("../extensions/pi_minimal_webui/browser-screenshot.js");

let passed = 0;
function ok(name) {
	passed++;
	console.log("  ok -", name);
}
function throwsCode(fn, code, name) {
	assert.throws(fn, (error) => error.code === code, name);
	ok(name);
}

for (const raw of [
	"http://localhost:4317/",
	"http://127.0.0.1:3000/app",
	"http://[::1]:8080/",
]) {
	const result = validateBrowserUrl(raw);
	assert.match(result.url, /^https?:\/\//);
}
ok("loopback hosts are allowed by default");

const allowed = parseAllowedHosts("Example.test, [::1]");
assert.equal(
	validateBrowserUrl("https://EXAMPLE.test/path", allowed).hostname,
	"example.test",
);
ok("configured exact hosts are case-insensitive");

for (const raw of [
	"file:///tmp/secret",
	"data:text/html,secret",
	["java", "script"].join("") + ":alert(1)",
	"chrome://settings",
	"http://user:pass@localhost/",
	"https://not-allowed.example/",
]) {
	throwsCode(
		() => validateBrowserUrl(raw),
		raw.includes("not-allowed") ? "disallowed-host" : "invalid-url",
		`rejects ${raw.split(":")[0]} or unsafe host`,
	);
}
throwsCode(
	() => parseAllowedHosts("*.example.test"),
	"disallowed-host",
	"wildcard allowlist entries are rejected",
);
throwsCode(
	() => parseAllowedHosts("example.test:8443"),
	"disallowed-host",
	"port allowlist entries are rejected",
);

assert.equal(
	validateCdpEndpoint("http://127.0.0.1:9222/"),
	"http://127.0.0.1:9222/",
);
throwsCode(
	() => validateCdpEndpoint("http://192.0.2.1:9222"),
	"invalid-cdp-endpoint",
	"non-loopback CDP endpoint is rejected",
);
throwsCode(
	() => validateCdpEndpoint("ws://127.0.0.1:9222"),
	"invalid-cdp-endpoint",
	"WebSocket CDP endpoint is rejected",
);
throwsCode(
	() => validateCdpEndpoint("http://user:pass@127.0.0.1:9222"),
	"invalid-cdp-endpoint",
	"CDP credentials are rejected",
);
ok("CDP attachment policy is loopback HTTP(S)-only");

{
	const config = readBrowserConfig({
		PI_BROWSER_CDP_URL: "http://127.0.0.1:9222",
		PI_BROWSER_HEADLESS: "yes",
		PI_BROWSER_ALLOWED_HOSTS: "dev.example",
	});
	assert.equal(config.cdpUrl, "http://127.0.0.1:9222/");
	assert.equal(config.headless, true);
	assert.equal(config.allowedHosts.has("dev.example"), true);
	ok("environment configuration is normalized without a runtime dependency");
}

{
	const args = buildLaunchArgs({
		profileDir: path.join("tmp", "isolated"),
		port: 45678,
		headless: true,
	});
	assert.ok(args.includes("--remote-debugging-address=127.0.0.1"));
	assert.ok(args.includes("--remote-debugging-port=45678"));
	assert.ok(args.includes("--headless=new"));
	assert.ok(args.some((arg) => arg.startsWith("--user-data-dir=")));
	assert.ok(
		args.includes(
			`--window-size=${DEFAULT_VIEWPORT_WIDTH},${DEFAULT_VIEWPORT_HEIGHT}`,
		),
	);
	assert.equal(DEFAULT_VIEWPORT_WIDTH, 1920);
	assert.equal(DEFAULT_VIEWPORT_HEIGHT, 1080);
	assert.ok(!args.includes("--no-sandbox"));
	ok("managed launch arguments isolate the profile and default to 1080p");
}

if (process.platform === "win32") {
	const candidates = browserCandidates({
		LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
		ProgramFiles: "C:\\Program Files",
		"ProgramFiles(x86)": "C:\\Program Files (x86)",
	});
	const edge86 = candidates.find(
		(candidate) =>
			candidate.includes("Program Files (x86)") &&
			candidate.includes("msedge.exe"),
	);
	assert.ok(edge86, "Windows browser discovery includes 32-bit Edge");
	assert.equal(
		resolveBrowserBinary(
			{
				env: {
					LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
					ProgramFiles: "C:\\Program Files",
					"ProgramFiles(x86)": "C:\\Program Files (x86)",
				},
			},
			{
				statSync(candidate) {
					if (candidate === edge86) return { isFile: () => true };
					throw new Error("missing");
				},
			},
		),
		edge86,
	);
	ok("Windows browser discovery finds 32-bit Edge");
}

{
	assert.equal(
		resolveBrowserBinary({ binary: process.execPath }),
		process.execPath,
	);
	throwsCode(
		() =>
			resolveBrowserBinary(
				{ binary: "missing-browser" },
				{
					statSync: () => {
						throw new Error("missing");
					},
				},
			),
		"browser-unavailable",
		"missing explicit browser binary fails closed",
	);
}

{
	const browserSource = fs.readFileSync(
		path.join(__dirname, "../extensions/pi_minimal_webui/browser.ts"),
		"utf8",
	);
	const indexSource = fs.readFileSync(
		path.join(__dirname, "../extensions/pi_minimal_webui/index.ts"),
		"utf8",
	);
	const names = [...browserSource.matchAll(/name: "(browser_[^"]+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(names, [
		"browser_open",
		"browser_snapshot",
		"browser_screenshot",
		"browser_console",
	]);
	assert.equal(browserSource.includes("browser_evaluate"), false);
	assert.match(browserSource, /Emulation\.setDeviceMetricsOverride/);
	assert.match(browserSource, /session_shutdown/);
	assert.match(browserSource, /untrusted data/);
	assert.match(indexSource, /import browser from "\.\/browser\.js"/);
	assert.match(indexSource, /browser\(pi\)/);
	const { layers } = policy.mergeLayers(policy.DEFAULT_CONFIG, null, null);
	const openVerdict = policy.resolve(
		"browser_open",
		"http://127.0.0.1:4317",
		layers,
	);
	const snapshotVerdict = policy.resolve("browser_snapshot", "", layers);
	assert.equal(openVerdict.action, "ask");
	assert.equal(snapshotVerdict.action, "allow");
	assert.equal(
		policy.applyMode(snapshotVerdict, "read-only", {
			toolName: "browser_snapshot",
		}).action,
		"allow",
	);
	assert.equal(
		policy.applyMode(openVerdict, "read-only", { toolName: "browser_open" })
			.action,
		"deny",
	);
	ok(
		"extension registration and safeguard defaults cover only the four MVP tools",
	);
}

{
	const store = new SnapshotRefStore();
	const raw = {
		url: "http://127.0.0.1:4317/",
		title: "T".repeat(800),
		viewport: { width: 1440, height: 900 },
		pageText: "λ".repeat(MAX_PAGE_TEXT_BYTES),
		elements: [
			{
				index: 0,
				role: "button",
				name: "Send",
				text: "Send",
				rect: { x: 1, y: 2, width: 72, height: 32 },
				href: "https://example.test/send",
			},
			{
				index: 1,
				type: "password",
				value: "secret",
				rect: { x: 0, y: 0, width: 10, height: 10 },
			},
			{
				index: 2,
				role: "link",
				href: ["java", "script"].join("") + ":alert(1)",
				rect: { x: 0, y: 0, width: 10, height: 10 },
			},
			{ index: 3, role: "broken", rect: { x: NaN, y: 0, width: 1, height: 1 } },
			...Array.from({ length: MAX_ELEMENTS + 5 }, (_, index) => ({
				index: index + 4,
				role: "button",
				name: `B${index}`,
				rect: { x: 0, y: 0, width: 1, height: 1 },
			})),
		],
	};
	const snapshot = normalizeSnapshot(raw, store);
	assert.equal(snapshot.schema, SNAPSHOT_SCHEMA);
	assert.equal(snapshot.elements.length, MAX_ELEMENTS);
	assert.ok(
		Buffer.byteLength(snapshot.pageText, "utf8") <= MAX_PAGE_TEXT_BYTES,
	);
	assert.ok(Buffer.byteLength(snapshot.title, "utf8") <= 512);
	assert.equal(snapshot.elements[0].ref, "e1");
	assert.equal(snapshot.elements[1].value, null);
	assert.equal(snapshot.elements[2].href, undefined);
	assert.equal(Object.hasOwn(snapshot.elements[0], "selector"), false);
	assert.doesNotThrow(() => JSON.stringify(snapshot));
	ok("snapshot shape, bounds, password redaction, and unsafe href filtering");

	const same = normalizeSnapshot(raw, store);
	assert.equal(same.elements[0].ref, snapshot.elements[0].ref);
	assert.equal(store.resolve("e1").element.name, "Send");
	const changed = normalizeSnapshot(
		{ ...raw, elements: [{ ...raw.elements[0], name: "Changed" }] },
		store,
	);
	assert.notEqual(changed.elements[0].ref, "e1");
	throwsCode(
		() => store.resolve("e1"),
		"stale-ref",
		"changed snapshot invalidates old refs",
	);
	store.invalidate();
	throwsCode(
		() => store.resolve("e1"),
		"stale-ref",
		"navigation invalidates refs",
	);
	const empty = normalizeSnapshot(
		{ url: "http://localhost:4317", viewport: { width: 1, height: 1 } },
		store,
	);
	assert.deepEqual(empty.elements, []);
	ok("ref generations and empty snapshots are fail-closed");
	assert.match(SNAPSHOT_SCRIPT, /querySelectorAll/);
	assert.equal(/document\\.(eval|execScript)/.test(SNAPSHOT_SCRIPT), false);
	ok("snapshot inspection is a fixed DOM helper, not arbitrary evaluation");
}

{
	const collector = new ConsoleCollector();
	assert.equal(
		collector.push("Runtime.consoleAPICalled", {
			type: "log",
			args: [{ type: "string", value: "ignored" }],
		}),
		false,
	);
	assert.equal(
		collector.push("Runtime.consoleAPICalled", {
			type: "warning",
			args: [
				{ type: "string", value: "warning" },
				{ type: "number", value: 7 },
			],
			url: "https://example.test/app.js",
			lineNumber: 4,
			columnNumber: 2,
		}),
		true,
	);
	assert.equal(
		collector.push("Runtime.exceptionThrown", {
			exceptionDetails: {
				text: "boom",
				url: "https://example.test/app.js",
				lineNumber: 9,
				columnNumber: 1,
			},
		}),
		true,
	);
	for (let i = 0; i < MAX_ENTRIES + 10; i++)
		collector.push("Runtime.consoleAPICalled", {
			type: "error",
			text: `error-${i}`,
		});
	const result = collector.result("http://127.0.0.1:4317/");
	assert.equal(result.schema, CONSOLE_SCHEMA);
	assert.equal(result.entries.length, MAX_ENTRIES);
	assert.equal(result.entries.at(-1).text, "error-59");
	assert.equal(result.entries.at(-1).level, "error");
	assert.ok(
		Buffer.byteLength(result.entries.at(-1).text, "utf8") <= MAX_TEXT_BYTES,
	);
	assert.equal(
		result.entries.some((entry) => entry.text === "ignored"),
		false,
	);
	ok("console warnings/errors are normalized and capped at 50 entries");

	const subscriptions = new Map();
	const session = {
		on(method, handler) {
			subscriptions.set(method, handler);
			return () => subscriptions.delete(method);
		},
	};
	const subscribed = new ConsoleCollector();
	const cleanup = subscribed.subscribe(session);
	subscriptions.get("Runtime.consoleAPICalled")({
		type: "error",
		text: "from event",
	});
	assert.equal(subscribed.result("").entries[0].text, "from event");
	cleanup();
	assert.equal(subscriptions.size, 0);
	subscribed.unsubscribe();
	assert.deepEqual(new ConsoleCollector().result("").entries, []);
	ok("console subscriptions and empty results clean up safely");
}

(async () => {
	const smallJpeg = Buffer.from("fake-jpeg").toString("base64");
	const calls = [];
	const supported = await captureScreenshot(
		{
			command: async (method, params) => {
				calls.push({ method, params });
				return { data: smallJpeg };
			},
		},
		{
			imageSupported: true,
			url: "http://127.0.0.1:4317/",
			viewport: { width: 1440, height: 900 },
		},
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].method, "Page.captureScreenshot");
	assert.equal(calls[0].params.format, "jpeg");
	assert.equal(calls[0].params.captureBeyondViewport, false);
	assert.equal(supported.content[1].type, "image");
	assert.equal(supported.content[1].mimeType, "image/jpeg");
	assert.equal(supported.details.imageIncluded, true);
	ok("supported screenshot results contain one bounded image block");

	const qualityCalls = [];
	const resized = await captureScreenshot(
		{
			command: async (_method, params) => {
				qualityCalls.push(params.quality);
				return {
					data: Buffer.alloc(
						params.quality > 40 ? MAX_SCREENSHOT_BYTES + 1 : 8,
					).toString("base64"),
				};
			},
		},
		{
			imageSupported: true,
			url: "http://localhost:4317",
			viewport: { width: 99999, height: 99999 },
		},
	);
	assert.deepEqual(qualityCalls, [70, 60, 50, 40]);
	assert.equal(resized.details.width, 4096);
	assert.equal(resized.details.height, 4096);
	ok("oversized captures lower quality and clamp viewport metadata");

	const textOnly = await captureScreenshot(
		{
			command: async () => {
				throw new Error("must not capture");
			},
		},
		{
			imageSupported: false,
			url: "http://localhost:4317",
		},
	);
	assert.equal(textOnly.content.length, 1);
	assert.equal(textOnly.details.imageIncluded, false);
	ok("text-only models receive metadata guidance without image bytes");

	await assert.rejects(
		captureScreenshot(
			{
				command: async () => ({
					data: Buffer.alloc(MAX_SCREENSHOT_BYTES + 1).toString("base64"),
				}),
			},
			{
				imageSupported: true,
				url: "http://localhost:4317",
			},
		),
		(error) => error.code === "output-limit",
	);
	const abortError = Object.assign(new Error("aborted"), { code: "aborted" });
	await assert.rejects(
		captureScreenshot(
			{
				command: async () => {
					throw abortError;
				},
			},
			{ imageSupported: true, signal: {} },
		),
		(error) => error.code === "aborted",
	);
	ok("screenshot size and transport failures fail closed");

	const spawned = [];
	const removed = [];
	const killed = [];
	const handle = await launchManagedBrowser(
		{ binary: process.execPath, headless: false },
		{
			mkdtemp: async (prefix) => `${prefix}test-profile`,
			reservePort: async () => 45679,
			spawn: (binary, args, options) => {
				const child = {
					pid: 99,
					kill: (signal) => killed.push([child.pid, signal]),
				};
				spawned.push({ binary, args, options });
				return child;
			},
			remove: async (dir) => removed.push(dir),
		},
	);
	assert.equal(handle.ownership, "managed");
	assert.equal(handle.cdpUrl, "http://127.0.0.1:45679");
	assert.equal(spawned.length, 1);
	assert.equal(spawned[0].binary, process.execPath);
	assert.equal(spawned[0].options.detached, false);
	await closeBrowser(handle);
	await closeBrowser(handle);
	assert.deepEqual(killed, [[99, "SIGTERM"]]);
	assert.equal(removed.length, 1);
	ok("managed browser cleanup is idempotent and removes its profile");

	let attachedKill = 0;
	const attached = await startBrowser({ cdpUrl: "http://127.0.0.1:9222" });
	assert.equal(attached.ownership, "attached");
	await closeBrowser(attached, { kill: async () => attachedKill++ });
	assert.equal(attachedKill, 0);
	ok("attached browsers are never killed by cleanup");

	const removedAfterFailure = [];
	await assert.rejects(
		launchManagedBrowser(
			{ binary: process.execPath },
			{
				mkdtemp: async (prefix) => `${prefix}failed-profile`,
				reservePort: async () => 45680,
				spawn: () => {
					throw new Error("spawn failed");
				},
				remove: async (dir) => removedAfterFailure.push(dir),
			},
		),
		(error) => error.code === "browser-unavailable",
	);
	assert.equal(removedAfterFailure.length, 1);
	ok("failed managed startup removes its temporary profile");

	const port = await reserveLoopbackPort();
	assert.ok(port > 0 && port < 65536);
	ok("loopback port reservation returns an ephemeral port");

	console.log(`\n${passed} passed`);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
