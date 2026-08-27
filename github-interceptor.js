

const { TextDecoder } = require("node:util");
const { fetchWeb } = require("./web-fetch.js");
const {
	labelUntrustedContent,
	validateUrlTarget,
} = require("./web-url-policy.js");

const GITHUB_SCHEMA = "pi-webui.github/v1";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_HOSTS = Object.freeze([
	"github.com",
	"www.github.com",
	"raw.githubusercontent.com",
]);
const GITHUB_OWNER_MAX_CHARS = 39;
const GITHUB_REPOSITORY_MAX_CHARS = 100;
const GITHUB_REF_MAX_CHARS = 256;
const GITHUB_PATH_MAX_CHARS = 4096;
const GITHUB_TOKEN_MAX_CHARS = 512;
const DEFAULT_GITHUB_LIMITS = Object.freeze({
	maxEntries: 100,
	maxFileBytes: 100 * 1024,
	maxTextChars: 100 * 1024,
	maxResponseBytes: 512 * 1024,
	timeoutMs: 10000,
});
const ABSOLUTE_GITHUB_LIMITS = Object.freeze({
	maxEntries: 500,
	maxFileBytes: 1024 * 1024,
	maxTextChars: 1024 * 1024,
	maxResponseBytes: 2 * 1024 * 1024,
	timeoutMs: 120000,
});
const NON_CODE_SEGMENTS = new Set([
	"actions",
	"branches",
	"commits",
	"compare",
	"discussions",
	"issues",
	"pull",
	"pulls",
	"releases",
	"security",
	"settings",
	"tags",
	"wiki",
]);
const AMBIGUOUS_REF_SEGMENTS = new Set([
	"heads",
	"refs",
	"remotes",
	"tags",
]);

function failure(code, reason, meta = {}) {
	return { ...meta, ok: false, error: { code, reason } };
}

function objectOptions(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

function boundedInteger(value, fallback, ceiling, minimum = 1) {
	if (value === undefined) return fallback;
	return Number.isSafeInteger(value) && value >= minimum && value <= ceiling
		? value
		: null;
}

function githubLimits(options = {}) {
	const settings = objectOptions(options);
	const maxEntries = boundedInteger(
		settings.maxEntries,
		DEFAULT_GITHUB_LIMITS.maxEntries,
		ABSOLUTE_GITHUB_LIMITS.maxEntries,
	);
	const maxFileBytes = boundedInteger(
		settings.maxFileBytes,
		DEFAULT_GITHUB_LIMITS.maxFileBytes,
		ABSOLUTE_GITHUB_LIMITS.maxFileBytes,
	);
	const maxTextChars = boundedInteger(
		settings.maxTextChars,
		DEFAULT_GITHUB_LIMITS.maxTextChars,
		ABSOLUTE_GITHUB_LIMITS.maxTextChars,
	);
	const maxResponseBytes = boundedInteger(
		settings.maxResponseBytes,
		DEFAULT_GITHUB_LIMITS.maxResponseBytes,
		ABSOLUTE_GITHUB_LIMITS.maxResponseBytes,
	);
	const timeoutMs = boundedInteger(
		settings.timeoutMs,
		DEFAULT_GITHUB_LIMITS.timeoutMs,
		ABSOLUTE_GITHUB_LIMITS.timeoutMs,
	);
	if (
		maxEntries == null ||
		maxFileBytes == null ||
		maxTextChars == null ||
		maxResponseBytes == null ||
		timeoutMs == null
	)
		return failure(
			"GITHUB_LIMITS",
			"GitHub request limits are invalid or exceed safety bounds",
		);
	return {
		ok: true,
		maxEntries,
		maxFileBytes,
		maxTextChars,
		maxResponseBytes,
		timeoutMs,
	};
}

function secretValue(value) {
	if (typeof value !== "string") return "";
	const token = value.trim();
	return token.length > 0 && token.length <= GITHUB_TOKEN_MAX_CHARS
		? token
		: "";
}

function resolveGitHubToken(env = process.env) {
	const source = objectOptions(env);
	return secretValue(source.GH_TOKEN) || secretValue(source.GITHUB_TOKEN);
}

function safeDecodedSegment(value) {
	if (typeof value !== "string" || !value || /%(?:2f|5c)/i.test(value))
		return null;
	let decoded;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return null;
	}
	if (
		!decoded ||
		decoded === "." ||
		decoded === ".." ||
		/[\\/\u0000-\u001f\u007f]/.test(decoded)
	)
		return null;
	return decoded;
}

function decodePathSegments(pathname) {
	if (typeof pathname !== "string" || !pathname.startsWith("/"))
		return null;
	const raw = pathname.slice(1).split("/");
	if (raw.at(-1) === "") raw.pop();
	if (!raw.length || raw.some((segment) => !segment)) return null;
	const decoded = raw.map(safeDecodedSegment);
	return decoded.every(Boolean) ? decoded : null;
}

function validOwner(value) {
	return (
	typeof value === "string" &&
	value.length <= GITHUB_OWNER_MAX_CHARS &&
	/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value)
	);
}

function validRepository(value) {
	return (
	typeof value === "string" &&
	value.length <= GITHUB_REPOSITORY_MAX_CHARS &&
	/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/.test(value)
	);
}

function validRef(value) {
	return (
	typeof value === "string" &&
	value.length <= GITHUB_REF_MAX_CHARS &&
	/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
	!value.endsWith(".lock") &&
	!value.includes("..") &&
	!value.includes("@{") &&
	!AMBIGUOUS_REF_SEGMENTS.has(value.toLowerCase())
	);
}

function validPath(parts) {
	return (
	Array.isArray(parts) &&
	parts.length > 0 &&
	parts.join("/").length <= GITHUB_PATH_MAX_CHARS &&
	parts.every((part) => Boolean(part) && part !== "." && part !== "..")
	);
}

function encodePath(parts) {
	return parts.map((part) => encodeURIComponent(part)).join("/");
}

function canonicalUrlForInfo(info) {
	const owner = encodeURIComponent(info.owner);
	const repo = encodeURIComponent(info.repo);
	if (info.type === "root") return `https://github.com/${owner}/${repo}`;
	const ref = encodeURIComponent(info.ref);
	const path = info.path ? `/${encodePath(info.path.split("/"))}` : "";
	if (info.type === "raw")
		return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}${path}`;
	return `https://github.com/${owner}/${repo}/${info.type}/${ref}${path}`;
}

function parseError(code, reason) {
	return { handled: true, ok: false, error: { code, reason } };
}

function parseGitHubUrlInternal(value) {
	if (typeof value !== "string" || !value.trim())
		return { handled: false };
	if (value.includes("\\"))
		return parseError("GITHUB_URL_INVALID", "GitHub URL is invalid or unsafe");

	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return { handled: false };
	}
	const host = parsed.hostname.toLowerCase();
	if (!GITHUB_HOSTS.includes(host)) return { handled: false };
	const safeUrl = validateUrlTarget(value);
	if (!safeUrl.ok)
		return parseError("GITHUB_URL_INVALID", "GitHub URL is invalid or unsafe");
	if (parsed.port)
		return parseError("GITHUB_URL_INVALID", "GitHub URL is invalid or unsafe");

	const segments = decodePathSegments(parsed.pathname);
	if (!segments) return parseError("GITHUB_PATH_INVALID", "GitHub path is invalid");
	if (segments.length < 2)
		return parseError("GITHUB_URL_INVALID", "GitHub URL must name a repository");

	const owner = segments[0];
	const repo = segments[1].replace(/\.git$/, "");
	if (!validOwner(owner) || !validRepository(repo))
		return parseError(
			"GITHUB_TARGET_INVALID",
			"GitHub owner or repository name is invalid",
		);

	if (host === "raw.githubusercontent.com") {
		if (segments.length < 4)
			return parseError(
				"GITHUB_REF_INVALID",
				"Raw GitHub URL must include a ref and file path",
			);
		const ref = segments[2];
		const pathParts = segments.slice(3);
		if (!validRef(ref) || !validPath(pathParts))
			return parseError(
				validRef(ref) ? "GITHUB_PATH_INVALID" : "GITHUB_REF_INVALID",
				validRef(ref)
					? "GitHub path is invalid"
					: "GitHub ref is invalid or ambiguous",
			);
		const info = {
			owner,
			repo,
			ref,
			refIsFullSha: /^[0-9a-f]{40}$/i.test(ref),
			path: pathParts.join("/"),
			type: "raw",
		};
		return { handled: true, ok: true, info };
	}

	if (segments.length === 2) {
		return {
			handled: true,
			ok: true,
			info: { owner, repo, refIsFullSha: false, type: "root" },
		};
	}

	const action = segments[2].toLowerCase();
	if (NON_CODE_SEGMENTS.has(action)) return { handled: false };
	if (action !== "blob" && action !== "tree" && action !== "raw")
		return { handled: false };
	if (segments.length < 4)
		return parseError(
			"GITHUB_REF_INVALID",
			"GitHub URL must include a ref",
		);

	const ref = segments[3];
	const pathParts = segments.slice(4);
	if (!validRef(ref))
		return parseError("GITHUB_REF_INVALID", "GitHub ref is invalid or ambiguous");
	if (action !== "tree" && !validPath(pathParts))
		return parseError("GITHUB_PATH_INVALID", "GitHub file path is invalid");
	if (action === "tree" && pathParts.length && !validPath(pathParts))
		return parseError("GITHUB_PATH_INVALID", "GitHub path is invalid");

	const type = action;
	return {
		handled: true,
		ok: true,
		info: {
			owner,
			repo,
			ref,
			refIsFullSha: /^[0-9a-f]{40}$/i.test(ref),
			...(pathParts.length ? { path: pathParts.join("/") } : { path: "" }),
			type,
		},
	};
}

/**
 * Parse supported GitHub URL forms without ever resolving a user path locally.
 * Unsupported non-code GitHub pages return null so a normal web fetch can take
 * over; malformed supported forms are also represented as null here.
 */
function parseGitHubUrl(value) {
	const parsed = parseGitHubUrlInternal(value);
	return parsed.handled && parsed.ok ? parsed.info : null;
}

function targetFromInfo(info) {
	let targetKind = "raw";
	if (info.type === "root") targetKind = "repository";
	else if (info.type === "tree") targetKind = "tree";
	else if (info.type === "blob") targetKind = "file";
	return {
		owner: info.owner,
		repository: info.repo,
		ref: info.ref || null,
		path: info.path || "",
		targetKind,
		canonicalUrl: canonicalUrlForInfo(info),
	};
}

function parseGitHubTarget(value) {
	const parsed = parseGitHubUrlInternal(value);
	return parsed.handled && parsed.ok ? targetFromInfo(parsed.info) : null;
}

function validateGitHubTarget(value) {
	const parsed = parseGitHubUrlInternal(value);
	if (!parsed.handled)
		return failure(
			"GITHUB_UNSUPPORTED_URL",
			"URL is not a supported GitHub repository target",
		);
	if (!parsed.ok) return parsed;
	return { ok: true, target: targetFromInfo(parsed.info) };
}

function apiPathForTarget(target) {
	const owner = encodeURIComponent(target.owner);
	const repo = encodeURIComponent(target.repository);
	let path = `/repos/${owner}/${repo}/contents`;
	if (target.path) path += `/${encodePath(target.path.split("/"))}`;
	return path;
}

function apiUrlForTarget(target, limits) {
	try {
		const url = new URL(`${GITHUB_API_ORIGIN}${apiPathForTarget(target)}`);
		if (target.ref) url.searchParams.set("ref", target.ref);
		if (target.targetKind === "repository" || target.targetKind === "tree")
			url.searchParams.set("per_page", String(Math.min(limits.maxEntries, 100)));
		return url.href;
	} catch {
		return null;
	}
}

function normalizedHeaders(headers) {
	const result = {};
	if (!headers || typeof headers !== "object") return result;
	for (const [key, value] of Object.entries(headers)) {
		if (value == null) continue;
		result[key.toLowerCase()] = Array.isArray(value)
			? String(value[0] || "")
			: String(value);
	}
	return result;
}

function redactSecret(value, secret) {
	if (typeof value !== "string" || !secret) return value;
	return value.split(secret).join("[redacted]");
}

function safeTarget(target, token) {
	return {
		...target,
		authScope: token ? "configured-private" : "public",
	};
}

function targetFailure(code, reason, target, token, status) {
	const meta = { target: safeTarget(target, token) };
	if (Number.isInteger(status)) meta.status = status;
	return failure(code, reason, meta);
}

function retryableTargetFailure(code, reason, target, token, status) {
	return {
		...targetFailure(code, reason, target, token, status),
		retryable: true,
	};
}

function transportFailure(error, target, token) {
	const code = error && typeof error === "object" ? error.code : "";
	if (code === "WEB_FETCH_TIMEOUT" || code === "WEB_DNS_TIMEOUT")
		return retryableTargetFailure(
			"GITHUB_TIMEOUT",
			"GitHub request timed out; retry the request",
			target,
			token,
		);
	if (code === "WEB_DNS_UNSAFE_TARGET")
		return targetFailure(
			"GITHUB_UNSAFE_TARGET",
			"GitHub request target failed network safety checks",
			target,
			token,
		);
	return retryableTargetFailure(
		"GITHUB_REQUEST",
		"GitHub request failed; retry the request",
		target,
		token,
	);
}

function statusFailure(status, headers, target, token) {
	const remaining = headers["x-ratelimit-remaining"];
	if (status === 429 || (status === 403 && remaining === "0"))
		return retryableTargetFailure(
			"GITHUB_RATE_LIMIT",
			"GitHub API rate limit exceeded; retry later or configure access",
			target,
			token,
			status,
		);
	if (status === 401)
		return targetFailure(
			token ? "GITHUB_PRIVATE_AUTH" : "GITHUB_AUTH_REQUIRED",
			token
				? "GitHub rejected the configured private-repository credentials"
				: "GitHub requires credentials for this repository",
			target,
			token,
			status,
		);
	if (status === 404)
		return targetFailure(
			"GITHUB_NOT_FOUND",
			"GitHub repository, ref, or path was not found (or is private)",
			target,
			token,
			status,
		);
	if (status === 403)
		return targetFailure(
			"GITHUB_FORBIDDEN",
			"GitHub denied access to this repository target",
			target,
			token,
			status,
		);
	if (status === 422)
		return targetFailure(
			"GITHUB_TARGET_INVALID",
			"GitHub rejected the repository target",
			target,
			token,
			status,
		);
	if (status >= 500)
		return retryableTargetFailure(
			"GITHUB_API_UNAVAILABLE",
			"GitHub API is unavailable; retry the request",
			target,
			token,
			status,
		);
	return targetFailure(
		"GITHUB_API_ERROR",
		"GitHub API returned an error",
		target,
		token,
		status,
	);
}

async function requestGitHub(url, target, token, settings, limits) {
	const fetcher = settings.fetcher || fetchWeb;
	if (typeof fetcher !== "function")
		return targetFailure(
			"GITHUB_CONFIG",
			"GitHub request fetcher must be a function",
			target,
			token,
		);
	const headers = {
		accept: "application/vnd.github+json",
		"x-github-api-version": GITHUB_API_VERSION,
	};
	if (token) headers.authorization = `Bearer ${token}`;

	let response;
	try {
		response = await fetcher(url, {
			timeoutMs: limits.timeoutMs,
			maxResponseBytes: limits.maxResponseBytes,
			maxTextChars: Math.min(limits.maxResponseBytes, 1024 * 1024),
			maxRedirects: 3,
			headers,
		});
	} catch (error) {
		return transportFailure(error, target, token);
	}
	if (!response || typeof response !== "object")
		return targetFailure(
			"GITHUB_API_RESPONSE",
			"GitHub returned an invalid response",
			target,
			token,
		);

	const responseHeaders = normalizedHeaders(response.headers);
	const status = Number.isInteger(response.status) ? response.status : null;
	if (status !== null && (status < 200 || status >= 300))
		return statusFailure(status, responseHeaders, target, token);
	if (response.ok === false)
		return transportFailure(response.error, target, token);
	if (response.responseTruncated === true)
		return targetFailure(
			"GITHUB_RESPONSE_TOO_LARGE",
			"GitHub response exceeded the configured size limit",
			target,
			token,
			status,
		);

	let payload = response.payload;
	if (payload === undefined) {
		if (typeof response.text !== "string")
			return targetFailure(
				"GITHUB_API_RESPONSE",
				"GitHub returned an invalid response body",
				target,
				token,
			);
		if (Buffer.byteLength(response.text, "utf8") > limits.maxResponseBytes)
			return targetFailure(
				"GITHUB_RESPONSE_TOO_LARGE",
				"GitHub response exceeded the configured size limit",
				target,
				token,
				status,
			);
		try {
			payload = JSON.parse(response.text);
		} catch {
			return targetFailure(
				"GITHUB_API_RESPONSE",
				"GitHub returned invalid JSON",
				target,
				token,
				status,
			);
		}
	}
	return { ok: true, status: status || 200, headers: responseHeaders, payload };
}

function safeApiPath(value) {
	if (typeof value !== "string" || !value || value.length > GITHUB_PATH_MAX_CHARS)
		return null;
	const parts = value.split("/");
	if (parts.some((part) => !part || part === "." || part === "..")) return null;
	if (
		parts.some(
			(part) =>
			/[\\\u0000-\u001f\u007f]/.test(part) ||
			/(?:^|%)2f/i.test(part) ||
			/(?:^|%)5c/i.test(part),
		)
	)
		return null;
	return value;
}

function boundedText(value, maxChars) {
	if (typeof value !== "string") return "";
	return value.length > maxChars ? value.slice(0, maxChars) : value;
}

function entryType(value) {
	if (value === "dir" || value === "tree") return "directory";
	if (value === "file" || value === "blob") return "file";
	if (value === "symlink") return "symlink";
	if (value === "submodule" || value === "commit") return "submodule";
	return "other";
}

function entryUrl(target, entry, rawItem) {
	if (target.ref) {
		const info = {
			owner: target.owner,
			repo: target.repository,
			ref: target.ref,
			refIsFullSha: /^[0-9a-f]{40}$/i.test(target.ref),
			path: entry.path,
			type: entry.type === "directory" ? "tree" : "blob",
		};
		return canonicalUrlForInfo(info);
	}
	if (rawItem && typeof rawItem.html_url === "string") {
		const parsed = parseGitHubUrl(rawItem.html_url);
		if (parsed) return canonicalUrlForInfo(parsed);
	}
	return undefined;
}

function normalizeEntries(payload, target, limits, secret = "") {
	let source = null;
	if (Array.isArray(payload)) source = payload;
	else if (payload && typeof payload === "object" && Array.isArray(payload.tree))
		source = payload.tree;
	if (!source) return null;
	const entries = [];
	let droppedEntries = 0;
	const inspected = source.slice(0, limits.maxEntries);
	for (const item of inspected) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			droppedEntries++;
			continue;
		}
		const rawPath = safeApiPath(item.path || item.name);
		if (!rawPath) {
			droppedEntries++;
			continue;
		}
		const path = redactSecret(rawPath, secret);
		const type = entryType(item.type);
		const name = boundedText(
			redactSecret(
				typeof item.name === "string" ? item.name : path.split("/").pop(),
				secret,
			),
			256,
		);
		if (!name || /[\u0000-\u001f\u007f\\/]/.test(name)) {
			droppedEntries++;
			continue;
		}
		const entry = { name, path, type };
		if (Number.isSafeInteger(item.size) && item.size >= 0)
			entry.size = item.size;
		if (typeof item.sha === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(item.sha))
			entry.sha = redactSecret(item.sha, secret);
		const url = entryUrl(target, entry, item);
		if (url) entry.url = url;
		entries.push(entry);
	}
	return {
		entries,
		truncated:
			Boolean(payload && payload.truncated) || source.length > limits.maxEntries,
		droppedEntries,
	};
}

function listingText(target, entries, truncated) {
	const lines = [`${target.owner}/${target.repository}${target.path ? `/${target.path}` : ""}`];
	for (const entry of entries) {
		const size = Number.isSafeInteger(entry.size) ? `\t${entry.size} bytes` : "";
		lines.push(`${entry.type}\t${entry.path}${size}`);
	}
	if (truncated) lines.push("[Listing truncated at the configured entry limit]");
	return lines.join("\n");
}

function resultBase(target, token, status) {
	return {
		ok: true,
		schema: GITHUB_SCHEMA,
		target: safeTarget(target, token),
		requestedUrl: target.canonicalUrl,
		finalUrl: target.canonicalUrl,
		status,
		retrievedAt: Date.now(),
	};
}

function decodeFilePayload(payload, limits) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return failure("GITHUB_API_RESPONSE", "GitHub returned an invalid file record");
	if (payload.type && payload.type !== "file")
		return failure("GITHUB_TARGET_TYPE", "GitHub target is not a regular text file");
	if (payload.size !== undefined &&
		(!Number.isSafeInteger(payload.size) || payload.size < 0))
		return failure("GITHUB_API_RESPONSE", "GitHub returned an invalid file size");
	if (Number.isSafeInteger(payload.size) && payload.size > limits.maxFileBytes)
		return failure(
			"GITHUB_FILE_TOO_LARGE",
			"GitHub file exceeds the configured size limit",
		);

	let bytes;
	if (payload.encoding && payload.encoding !== "base64")
		return failure(
			"GITHUB_API_RESPONSE",
			"GitHub returned an unsupported file encoding",
		);
	if (typeof payload.content === "string") {
		const encoded = payload.content.replace(/\s+/g, "");
		if (
			encoded.length % 4 !== 0 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
		)
			return failure("GITHUB_API_RESPONSE", "GitHub returned invalid file content");
		if (encoded.length > Math.ceil((limits.maxFileBytes / 3) * 4) + 4)
			return failure(
				"GITHUB_FILE_TOO_LARGE",
				"GitHub file exceeds the configured size limit",
			);
		bytes = Buffer.from(encoded, "base64");
	} else if (typeof payload.text === "string") {
		bytes = Buffer.from(payload.text, "utf8");
	} else {
		return failure(
			"GITHUB_API_RESPONSE",
			"GitHub returned no readable file content",
		);
	}
	if (bytes.length > limits.maxFileBytes)
		return failure(
			"GITHUB_FILE_TOO_LARGE",
			"GitHub file exceeds the configured size limit",
		);

	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return failure(
			"GITHUB_BINARY_FILE",
			"GitHub target is not valid UTF-8 text",
		);
	}
	if (text.includes("\u0000"))
		return failure(
			"GITHUB_BINARY_FILE",
			"GitHub target appears to be a binary file",
		);
	if (text.length > limits.maxTextChars)
		return failure(
			"GITHUB_FILE_TOO_LARGE",
			"GitHub file exceeds the configured text limit",
		);
	return { ok: true, text, bytes: bytes.length };
}

async function resolveParsedTarget(target, settings, limits) {
	const token = Object.hasOwn(settings, "token")
		? secretValue(settings.token)
		: resolveGitHubToken(settings.env);
	const apiUrl = apiUrlForTarget(target, limits);
	if (!apiUrl)
		return targetFailure(
			"GITHUB_TARGET_INVALID",
			"GitHub target could not be converted to a safe API request",
			target,
			token,
		);
	const response = await requestGitHub(
		apiUrl,
		target,
		token,
		settings,
		limits,
	);
	if (!response.ok) return response;

	if (target.targetKind === "repository" || target.targetKind === "tree") {
		const listing = normalizeEntries(response.payload, target, limits, token);
		if (!listing)
			return targetFailure(
				"GITHUB_API_RESPONSE",
				"GitHub returned an invalid directory listing",
				target,
				token,
				response.status,
			);
		const text = listingText(target, listing.entries, listing.truncated);
		const marked = labelUntrustedContent(text, target.canonicalUrl);
		return {
			...resultBase(target, token, response.status),
			kind: "directory",
			entries: listing.entries,
			resultCount: listing.entries.length,
			truncated: listing.truncated,
			droppedEntries: listing.droppedEntries,
			text: marked.text,
			untrusted: marked.untrusted,
			instructionBoundary: marked.instructionBoundary,
		};
	}

	if (Array.isArray(response.payload))
		return targetFailure(
			"GITHUB_TARGET_TYPE",
			"GitHub file target resolved to a directory",
			target,
			token,
			response.status,
		);
	const file = decodeFilePayload(response.payload, limits);
	if (!file.ok)
		return targetFailure(
			file.error.code,
			file.error.reason,
			target,
			token,
			response.status,
		);
	const marked = labelUntrustedContent(
		redactSecret(file.text, token),
		target.canonicalUrl,
	);
	return {
		...resultBase(target, token, response.status),
		kind: "file",
		content: marked.text,
		text: marked.text,
		bytes: file.bytes,
		truncated: false,
		untrusted: marked.untrusted,
		instructionBoundary: marked.instructionBoundary,
	};
}

async function fetchGitHub(url, options = {}) {
	const settings = objectOptions(options);
	const limits = githubLimits(settings);
	if (!limits.ok) return limits;
	const parsed = parseGitHubUrlInternal(url);
	if (!parsed.handled)
		return failure(
			"GITHUB_UNSUPPORTED_URL",
			"URL is not a supported GitHub repository target",
		);
	if (!parsed.ok) return failure(parsed.error.code, parsed.error.reason);
	return resolveParsedTarget(targetFromInfo(parsed.info), settings, limits);
}

async function interceptGitHubUrl(url, options = {}) {
	const settings = objectOptions(options);
	const limits = githubLimits(settings);
	if (!limits.ok) return limits;
	const parsed = parseGitHubUrlInternal(url);
	if (!parsed.handled) return null;
	if (!parsed.ok) return failure(parsed.error.code, parsed.error.reason);
	return resolveParsedTarget(targetFromInfo(parsed.info), settings, limits);
}

async function resolveGitHubTarget(target, options = {}) {
	if (!target || typeof target !== "object" || Array.isArray(target))
		return failure("GITHUB_TARGET_INVALID", "GitHub target is invalid");
	if (typeof target.canonicalUrl !== "string")
		return failure("GITHUB_TARGET_INVALID", "GitHub target is invalid");
	return fetchGitHub(target.canonicalUrl, options);
}

class GitHubInterceptor {
	constructor(options = {}) {
		this.options = { ...objectOptions(options) };
		this.enabled = this.options.enabled === true;
	}

	get resolvedOptions() {
		return Object.freeze({
			enabled: this.enabled,
			...githubLimits(this.options),
		});
	}

	async intercept(url, options = {}) {
		if (!this.enabled) return null;
		return interceptGitHubUrl(url, { ...this.options, ...objectOptions(options) });
	}
}

module.exports = {
	ABSOLUTE_GITHUB_LIMITS,
	DEFAULT_GITHUB_LIMITS,
	GITHUB_API_ORIGIN,
	GITHUB_API_VERSION,
	GITHUB_HOSTS,
	GITHUB_SCHEMA,
	GITHUB_TOKEN_MAX_CHARS,
	GitHubInterceptor,
	fetchGitHub,
	githubLimits,
	interceptGitHubUrl,
	parseGitHubTarget,
	parseGitHubUrl,
	resolveGitHubTarget,
	resolveGitHubToken,
	validateGitHubTarget,
};
