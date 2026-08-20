const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TRUTHY = new Set(["1", "true", "yes", "on"]);

function browserError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function normalizeHost(host) {
	let value = String(host || "")
		.trim()
		.toLowerCase();
	if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
	return value;
}

function isLoopbackHost(host) {
	return DEFAULT_HOSTS.has(normalizeHost(host));
}

function parseAllowedHosts(value) {
	if (!value) return new Set();
	const hosts = new Set();
	for (const raw of String(value).split(",")) {
		const host = normalizeHost(raw);
		if (
			!host ||
			host.includes("*") ||
			host.includes("/") ||
			host.includes("@")
		) {
			throw browserError(
				"disallowed-host",
				"PI_BROWSER_ALLOWED_HOSTS contains an invalid host",
			);
		}
		if (host.includes(":")) {
			if (host !== "::1")
				throw browserError(
					"disallowed-host",
					"PI_BROWSER_ALLOWED_HOSTS accepts hostnames, not ports",
				);
		}
		hosts.add(host);
	}
	return hosts;
}

function validateBrowserUrl(raw, allowedHosts = []) {
	let url;
	try {
		url = new URL(String(raw));
	} catch {
		throw browserError("invalid-url", "browser URL is invalid");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw browserError("invalid-url", "browser URL must use HTTP(S)");
	}
	if (url.username || url.password)
		throw browserError(
			"invalid-url",
			"browser URL credentials are not allowed",
		);
	const hostname = normalizeHost(url.hostname);
	const extra =
		allowedHosts instanceof Set ? allowedHosts : new Set(allowedHosts);
	if (!isLoopbackHost(hostname) && !extra.has(hostname)) {
		throw browserError(
			"disallowed-host",
			`browser host is not allowed: ${hostname}`,
		);
	}
	return { url: url.toString(), hostname };
}

function validateCdpEndpoint(raw) {
	let url;
	try {
		url = new URL(String(raw));
	} catch {
		throw browserError("invalid-cdp-endpoint", "PI_BROWSER_CDP_URL is invalid");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw browserError(
			"invalid-cdp-endpoint",
			"PI_BROWSER_CDP_URL must use HTTP(S)",
		);
	}
	if (url.username || url.password || !isLoopbackHost(url.hostname)) {
		throw browserError(
			"invalid-cdp-endpoint",
			"PI_BROWSER_CDP_URL must be loopback without credentials",
		);
	}
	return url.toString();
}

function readBrowserConfig(env = process.env) {
	const cdpUrl = env.PI_BROWSER_CDP_URL
		? validateCdpEndpoint(env.PI_BROWSER_CDP_URL)
		: null;
	return {
		binary: env.PI_BROWSER_BIN ? String(env.PI_BROWSER_BIN).trim() : "",
		cdpUrl,
		headless: TRUTHY.has(
			String(env.PI_BROWSER_HEADLESS || "")
				.trim()
				.toLowerCase(),
		),
		allowedHosts: parseAllowedHosts(env.PI_BROWSER_ALLOWED_HOSTS),
	};
}

function browserCandidates(env = process.env) {
	const candidates = [];
	if (process.platform === "win32") {
		const local = env.LOCALAPPDATA || "";
		const program = env.ProgramFiles || "C:\\Program Files";
		const program86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
		candidates.push(
			path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
			path.join(program, "Google", "Chrome", "Application", "chrome.exe"),
			path.join(program86, "Google", "Chrome", "Application", "chrome.exe"),
			path.join(program, "Microsoft", "Edge", "Application", "msedge.exe"),
		);
	} else if (process.platform === "darwin") {
		candidates.push(
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		);
	} else {
		candidates.push(
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/microsoft-edge",
		);
	}
	return candidates.filter(Boolean);
}

function resolveBrowserBinary(config = {}, fsImpl = fs) {
	const explicit = config.binary || config.PI_BROWSER_BIN || "";
	const candidates = explicit
		? [explicit]
		: browserCandidates(config.env || process.env);
	for (const candidate of candidates) {
		try {
			if (fsImpl.statSync(candidate).isFile()) return candidate;
		} catch {
			// Continue through conservative known candidates.
		}
	}
	if (explicit)
		throw browserError(
			"browser-unavailable",
			"PI_BROWSER_BIN does not point to a browser binary",
		);
	throw browserError(
		"browser-unavailable",
		"no Chromium or Edge browser binary was found",
	);
}

function buildLaunchArgs({ profileDir, port, headless = false }) {
	if (!profileDir || !Number.isInteger(port) || port < 1 || port > 65535) {
		throw browserError(
			"browser-unavailable",
			"managed browser launch settings are invalid",
		);
	}
	const args = [
		`--user-data-dir=${profileDir}`,
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${port}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-extensions",
	];
	if (headless) args.push("--headless=new");
	return args;
}

function reserveLoopbackPort() {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.once("error", reject);
		server.listen({ host: "127.0.0.1", port: 0 }, () => {
			const port = server.address().port;
			server.close((error) => (error ? reject(error) : resolve(port)));
		});
	});
}

async function launchManagedBrowser(config = {}, deps = {}) {
	const fsPromises = deps.fsPromises || fs.promises;
	const mkdtemp = deps.mkdtemp || ((prefix) => fsPromises.mkdtemp(prefix));
	const remove =
		deps.remove ||
		((dir) => fsPromises.rm(dir, { recursive: true, force: true }));
	const spawn = deps.spawn || childProcess.spawn;
	const reservePort = deps.reservePort || reserveLoopbackPort;
	const binary = config.binary || resolveBrowserBinary(config, deps.fs || fs);
	const profileDir = await mkdtemp(path.join(os.tmpdir(), "pi-webui-browser-"));
	let child;
	try {
		const port = await reservePort();
		const args = buildLaunchArgs({
			profileDir,
			port,
			headless: config.headless,
		});
		child = spawn(binary, args, {
			stdio: "ignore",
			detached: false,
			windowsHide: true,
		});
		if (!child || !child.pid)
			throw browserError(
				"browser-unavailable",
				"managed browser did not start",
			);
		return {
			ownership: "managed",
			binary,
			args,
			child,
			profileDir,
			cdpUrl: `http://127.0.0.1:${port}`,
			closed: false,
			remove,
		};
	} catch (error) {
		if (child?.kill) child.kill();
		await remove(profileDir).catch(() => undefined);
		throw error.code
			? error
			: browserError("browser-unavailable", "managed browser failed to start");
	}
}

async function startBrowser(config = {}, deps = {}) {
	if (config.cdpUrl) {
		return {
			ownership: "attached",
			cdpUrl: validateCdpEndpoint(config.cdpUrl),
			closed: false,
		};
	}
	return launchManagedBrowser(config, deps);
}

async function defaultKill(child) {
	if (!child?.pid) return;
	try {
		child.kill("SIGTERM");
	} catch {
		// The browser may have exited between the state check and cleanup.
	}
}

async function closeBrowser(handle, deps = {}) {
	if (!handle || handle.closed) return;
	handle.closed = true;
	if (handle.ownership !== "managed") return;
	const kill = deps.kill || defaultKill;
	const remove =
		handle.remove ||
		deps.remove ||
		((dir) => fs.promises.rm(dir, { recursive: true, force: true }));
	await kill(handle.child);
	if (handle.profileDir) await remove(handle.profileDir).catch(() => undefined);
}

module.exports = {
	DEFAULT_HOSTS,
	browserCandidates,
	browserError,
	buildLaunchArgs,
	closeBrowser,
	isLoopbackHost,
	launchManagedBrowser,
	normalizeHost,
	parseAllowedHosts,
	readBrowserConfig,
	reserveLoopbackPort,
	resolveBrowserBinary,
	startBrowser,
	validateBrowserUrl,
	validateCdpEndpoint,
};
