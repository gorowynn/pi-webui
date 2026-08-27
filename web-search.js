// W03 — minimal server-side web search adapter and bounded result contract.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fetchWeb } = require("./web-fetch.js");
const { validateUrlTarget } = require("./web-url-policy.js");

const SEARCH_SCHEMA = "pi-webui.web-search/v1";
const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SEARCH_CONFIG_FILE = "web-search.json";
const SEARCH_CONFIG_VERSION = 1;
const MAX_API_KEY_CHARS = 512;
const DEFAULT_SEARCH_LIMITS = Object.freeze({
	maxQueryChars: 512,
	maxResults: 10,
	maxTitleChars: 256,
	maxSnippetChars: 1000,
	maxUrlChars: 2048,
	timeoutMs: 10000,
});
const ABSOLUTE_SEARCH_LIMITS = Object.freeze({
	maxQueryChars: 2048,
	maxResults: 20,
	maxTitleChars: 1024,
	maxSnippetChars: 4096,
	maxUrlChars: 4096,
	timeoutMs: 120000,
});
const MAX_PROVIDER_RESULTS = 100;

function failure(code, reason, meta = {}) {
	return { ...meta, ok: false, error: { code, reason } };
}

function hasOwn(value, key) {
	return Object.hasOwn(value, key);
}

function objectOptions(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? value
		: {};
}

function normalizeProvider(value) {
	if (typeof value !== "string") return "";
	const provider = value.trim().toLowerCase();
	return /^[a-z][a-z0-9-]{0,31}$/.test(provider) ? provider : "";
}

function secretValue(value) {
	return typeof value === "string" ? value.trim() : "";
}

function providerKeyName(provider) {
	return `PI_WEB_SEARCH_${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`;
}

function resolveSearchApiKey(provider, env) {
	const source = objectOptions(env);
	return secretValue(
		source[providerKeyName(provider)] || source.PI_WEB_SEARCH_API_KEY,
	);
}

function readSearchConfig(env = process.env) {
	const source = objectOptions(env);
	const provider = normalizeProvider(source.PI_WEB_SEARCH_PROVIDER);
	return Object.freeze({
		provider,
		apiKey: resolveSearchApiKey(provider, source),
	});
}

function searchConfigPath(home = os.homedir()) {
	const root = typeof home === "string" && home ? home : os.homedir();
	return path.join(root, ".pi", "agent", SEARCH_CONFIG_FILE);
}

function validateSearchConfig(value) {
	const source = objectOptions(value);
	const errors = [];
	const rawProvider = source.provider;
	const provider = normalizeProvider(rawProvider);
	if (rawProvider !== undefined && rawProvider !== "" && !provider)
		errors.push({ path: "provider", message: "provider name is invalid" });
	if (provider && !SEARCH_PROVIDER_NAMES.includes(provider))
		errors.push({ path: "provider", message: "provider is unavailable" });
	if (source.apiKey !== undefined && typeof source.apiKey !== "string")
		errors.push({ path: "apiKey", message: "apiKey must be a string" });
	const apiKey = secretValue(source.apiKey);
	if (Array.from(apiKey).length > MAX_API_KEY_CHARS)
		errors.push({ path: "apiKey", message: "apiKey is too long" });
	if (apiKey && !provider)
		errors.push({ path: "provider", message: "provider is required when apiKey is set" });
	return {
		ok: errors.length === 0,
		errors,
		config: { provider, apiKey },
	};
}

function readStoredSearchConfig(file = searchConfigPath(), fsImpl = fs) {
	try {
		const parsed = JSON.parse(fsImpl.readFileSync(file, "utf8"));
		const checked = validateSearchConfig(parsed);
		return checked.ok ? checked.config : { provider: "", apiKey: "" };
	} catch {
		return { provider: "", apiKey: "" };
	}
}

function writeStoredSearchConfig(
	config,
	file = searchConfigPath(),
	fsImpl = fs,
) {
	const checked = validateSearchConfig(config);
	if (!checked.ok) {
		const error = new Error("web search settings are invalid");
		error.code = "WEB_SEARCH_CONFIG";
		throw error;
	}
	const target = typeof file === "string" && file ? file : searchConfigPath();
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	fsImpl.mkdirSync(path.dirname(target), { recursive: true });
	try {
		fsImpl.writeFileSync(
			temporary,
			JSON.stringify({
				version: SEARCH_CONFIG_VERSION,
				provider: checked.config.provider,
				apiKey: checked.config.apiKey,
			}) + "\n",
			{ encoding: "utf8", flag: "wx", mode: 0o600 },
		);
		try {
			fsImpl.chmodSync(temporary, 0o600);
		} catch {
			// Windows and injected test filesystems may not expose chmod.
		}
		fsImpl.renameSync(temporary, target);
	} finally {
		try {
			fsImpl.unlinkSync(temporary);
		} catch {
			// The rename succeeded or the write failed before a temp was created.
		}
	}
	return {
		provider: checked.config.provider,
		configured: Boolean(checked.config.apiKey),
	};
}

function readConfiguredSearchConfig(
	env = process.env,
	file = searchConfigPath(),
) {
	const environment = readSearchConfig(env);
	const stored = readStoredSearchConfig(file);
	return Object.freeze({
		provider: environment.provider || stored.provider,
		apiKey: environment.apiKey || stored.apiKey,
	});
}

function boundedInteger(value, fallback, ceiling, minimum = 1) {
	if (value === undefined) return fallback;
	return Number.isSafeInteger(value) && value >= minimum && value <= ceiling
		? value
		: null;
}

function searchLimits(options) {
	const maxQueryChars = boundedInteger(
		options.maxQueryChars,
		DEFAULT_SEARCH_LIMITS.maxQueryChars,
		ABSOLUTE_SEARCH_LIMITS.maxQueryChars,
	);
	const requestedResults =
		options.limit === undefined ? options.maxResults : options.limit;
	const maxResults = boundedInteger(
		requestedResults,
		DEFAULT_SEARCH_LIMITS.maxResults,
		ABSOLUTE_SEARCH_LIMITS.maxResults,
	);
	const maxTitleChars = boundedInteger(
		options.maxTitleChars,
		DEFAULT_SEARCH_LIMITS.maxTitleChars,
		ABSOLUTE_SEARCH_LIMITS.maxTitleChars,
	);
	const maxSnippetChars = boundedInteger(
		options.maxSnippetChars,
		DEFAULT_SEARCH_LIMITS.maxSnippetChars,
		ABSOLUTE_SEARCH_LIMITS.maxSnippetChars,
	);
	const maxUrlChars = boundedInteger(
		options.maxUrlChars,
		DEFAULT_SEARCH_LIMITS.maxUrlChars,
		ABSOLUTE_SEARCH_LIMITS.maxUrlChars,
	);
	const timeoutMs = boundedInteger(
		options.timeoutMs,
		DEFAULT_SEARCH_LIMITS.timeoutMs,
		ABSOLUTE_SEARCH_LIMITS.timeoutMs,
	);
	if (
		maxQueryChars == null ||
		maxResults == null ||
		maxTitleChars == null ||
		maxSnippetChars == null ||
		maxUrlChars == null ||
		timeoutMs == null
	)
		return failure(
			"WEB_SEARCH_LIMITS",
			"Search limits are invalid or exceed safety bounds",
		);
	return {
		ok: true,
		maxQueryChars,
		maxResults,
		maxTitleChars,
		maxSnippetChars,
		maxUrlChars,
		timeoutMs,
	};
}

function redactSecret(value, secret) {
	if (typeof value !== "string" || !secret) return value;
	return value.split(secret).join("[redacted]");
}

function boundedText(value, maxChars) {
	if (typeof value !== "string") return { value: "", truncated: false };
	const text = value.trim();
	const chars = Array.from(text);
	if (chars.length <= maxChars) return { value: text, truncated: false };
	return {
		value: chars.slice(0, maxChars).join(""),
		truncated: true,
	};
}

function resultArray(payload) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== "object") return null;
	if (payload.web && Array.isArray(payload.web.results))
		return payload.web.results;
	if (Array.isArray(payload.results)) return payload.results;
	return null;
}

function sourceUrl(value, maxUrlChars) {
	if (typeof value !== "string" || Array.from(value).length > maxUrlChars)
		return null;
	const checked = validateUrlTarget(value.trim());
	return checked.ok ? checked.canonicalUrl : null;
}

function normalizeSearchResults(
	provider,
	query,
	payload,
	limits = searchLimits({}),
	secret = "",
) {
	if (!limits.ok) return limits;
	const sourceResults = resultArray(payload);
	if (!sourceResults)
		return failure(
			"WEB_SEARCH_RESPONSE",
			"Search provider returned an invalid result list",
			{ provider },
		);

	const results = [];
	let truncated = sourceResults.length > MAX_PROVIDER_RESULTS;
	let droppedResults = 0;
	const inspected = sourceResults.slice(0, MAX_PROVIDER_RESULTS);
	for (const item of inspected) {
		if (results.length >= limits.maxResults) {
			truncated = true;
			break;
		}
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			droppedResults++;
			continue;
		}
		const rawUrl = item.url || item.link || item.sourceUrl;
		if (typeof rawUrl === "string" && secret && rawUrl.includes(secret)) {
			droppedResults++;
			continue;
		}
		const url = sourceUrl(rawUrl, limits.maxUrlChars);
		if (!url || results.some((entry) => entry.url === url)) {
			droppedResults++;
			continue;
		}
		const title = boundedText(
			redactSecret(item.title || item.name, secret),
			limits.maxTitleChars,
		);
		const snippet = boundedText(
			redactSecret(
				item.description || item.snippet || item.content,
				secret,
			),
			limits.maxSnippetChars,
		);
		results.push({
			title: title.value,
			snippet: snippet.value,
			url,
		});
		truncated = truncated || title.truncated || snippet.truncated;
	}

	return {
		ok: true,
		schema: SEARCH_SCHEMA,
		provider,
		query: redactSecret(query, secret),
		results,
		resultCount: results.length,
		requestedLimit: limits.maxResults,
		truncated,
		droppedResults,
		untrusted: true,
		instructionBoundary: "data-only",
		retrievedAt: Date.now(),
	};
}

function searchErrorCode(error) {
	const code = error && typeof error.code === "string" ? error.code : "";
	if (
		code === "WEB_FETCH_TIMEOUT" ||
		code === "WEB_DNS_TIMEOUT" ||
		code === "WEB_SEARCH_TIMEOUT"
	)
		return "WEB_SEARCH_TIMEOUT";
	if (code === "WEB_SEARCH_RESPONSE") return "WEB_SEARCH_RESPONSE";
	return "WEB_SEARCH_REQUEST";
}

async function braveSearch({
	query,
	limit,
	apiKey,
	timeoutMs,
	fetcher = fetchWeb,
}) {
	const url = new URL(BRAVE_SEARCH_ENDPOINT);
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(limit));
	let response;
	try {
		response = await fetcher(url.href, {
			timeoutMs,
			maxResponseBytes: 512 * 1024,
			maxTextChars: 512 * 1024,
			maxRedirects: 2,
			headers: {
				accept: "application/json",
				"x-subscription-token": apiKey,
			},
		});
	} catch (error) {
		return failure(
			searchErrorCode(error),
			"Search provider request failed",
		);
	}
	if (!response || typeof response !== "object")
		return failure(
			"WEB_SEARCH_RESPONSE",
			"Search provider returned an invalid response",
		);
	if (response.ok !== true) {
		return failure(
			searchErrorCode(response.error),
			"Search provider request failed",
		);
	}
	let payload = response.payload;
	if (payload === undefined && typeof response.text === "string") {
		try {
			payload = JSON.parse(response.text);
		} catch {
			return failure(
				"WEB_SEARCH_RESPONSE",
				"Search provider returned invalid JSON",
			);
		}
	}
	return { ok: true, payload };
}

const SEARCH_PROVIDERS = Object.freeze({
	// Keep the built-in surface intentionally small; add a provider only with a
	// separate adapter, key policy, and bounded response contract.
	brave: Object.freeze({
		name: "brave",
		endpoint: BRAVE_SEARCH_ENDPOINT,
		requiresKey: true,
		search: braveSearch,
	}),
});
const SEARCH_PROVIDER_NAMES = Object.freeze(Object.keys(SEARCH_PROVIDERS));

async function searchWeb(query, options = {}) {
	const settings = objectOptions(options);
	const limits = searchLimits(settings);
	if (!limits.ok) return limits;
	if (typeof query !== "string" || !query.trim())
		return failure(
			"WEB_SEARCH_QUERY",
			"Search query must be a non-empty string",
		);
	const normalizedQuery = query.trim();
	if (Array.from(normalizedQuery).length > limits.maxQueryChars)
		return failure(
			"WEB_SEARCH_QUERY",
			"Search query exceeds the maximum length",
		);

	const config = hasOwn(settings, "config")
		? objectOptions(settings.config)
		: readSearchConfig(settings.env);
	const providerWasSelected = hasOwn(settings, "provider");
	const provider = normalizeProvider(
		providerWasSelected ? settings.provider : config.provider,
	);
	if (!provider)
		return failure(
			providerWasSelected
				? "WEB_SEARCH_PROVIDER_UNAVAILABLE"
				: "WEB_SEARCH_PROVIDER_REQUIRED",
			providerWasSelected
				? "Requested search provider is unavailable"
				: "Select a web search provider before searching",
		);

	const providers = objectOptions(settings.providers);
	const adapter = hasOwn(settings, "providers")
		? providers[provider]
		: SEARCH_PROVIDERS[provider];
	if (!adapter || typeof adapter.search !== "function")
		return failure(
			"WEB_SEARCH_PROVIDER_UNAVAILABLE",
			"Requested search provider is unavailable",
			{ provider },
		);

	const apiKey = hasOwn(settings, "apiKey")
		? secretValue(settings.apiKey)
		: secretValue(config.apiKey);
	if (adapter.requiresKey !== false && !apiKey)
		return failure(
			"WEB_SEARCH_UNAUTHENTICATED",
			"Selected search provider has no configured credentials",
			{ provider },
		);

	let response;
	try {
		response = await adapter.search({
			query: normalizedQuery,
			limit: limits.maxResults,
			timeoutMs: limits.timeoutMs,
			apiKey,
			fetcher: settings.fetcher || fetchWeb,
		});
	} catch {
		return failure("WEB_SEARCH_REQUEST", "Search provider request failed", {
			provider,
		});
	}
	if (!response || typeof response !== "object")
		return failure(
			"WEB_SEARCH_RESPONSE",
			"Search provider returned an invalid response",
			{ provider },
		);
	if (response.ok === false)
		return failure(
			searchErrorCode(response.error),
			response.error?.code === "WEB_SEARCH_RESPONSE"
				? "Search provider returned an invalid response"
				: "Search provider request failed",
			{ provider },
		);

	const payload = hasOwn(response, "payload") ? response.payload : response;
	const result = normalizeSearchResults(
		provider,
		normalizedQuery,
		payload,
		limits,
		apiKey,
	);
	if (!result.ok) return result;
	return result;
}

module.exports = {
	ABSOLUTE_SEARCH_LIMITS,
	BRAVE_SEARCH_ENDPOINT,
	DEFAULT_SEARCH_LIMITS,
	MAX_API_KEY_CHARS,
	MAX_PROVIDER_RESULTS,
	SEARCH_CONFIG_FILE,
	SEARCH_CONFIG_VERSION,
	SEARCH_PROVIDER_NAMES,
	SEARCH_PROVIDERS,
	SEARCH_SCHEMA,
	normalizeSearchResults,
	readConfiguredSearchConfig,
	readSearchConfig,
	readStoredSearchConfig,
	resolveSearchApiKey,
	searchConfigPath,
	searchWeb,
	validateSearchConfig,
	writeStoredSearchConfig,
};
