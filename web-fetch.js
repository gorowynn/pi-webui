// W02 — bounded server-side HTTP(S) fetch and text extraction.
"use strict";

const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const { TextDecoder } = require("node:util");
const {
	labelUntrustedContent,
	validateResolvedTarget,
	validateUrlTarget,
} = require("./web-url-policy.js");

const DEFAULT_FETCH_LIMITS = Object.freeze({
	maxResponseBytes: 1024 * 1024,
	maxTextChars: 100000,
	maxRedirects: 5,
	timeoutMs: 10000,
});
const ABSOLUTE_FETCH_LIMITS = Object.freeze({
	maxResponseBytes: 8 * 1024 * 1024,
	maxTextChars: 1024 * 1024,
	maxRedirects: 20,
	timeoutMs: 120000,
});
const SAFE_CONTINUATION = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

function failure(code, reason, meta = {}) {
	return { ...meta, ok: false, error: { code, reason } };
}

function codedError(code, reason) {
	const error = new Error(reason);
	error.code = code;
	return error;
}

function normalizedOptions(options) {
	return options && typeof options === "object" && !Array.isArray(options)
		? options
		: {};
}

function positiveLimit(value, fallback, ceiling) {
	if (value === undefined) return fallback;
	return Number.isSafeInteger(value) && value > 0 && value <= ceiling ? value : null;
}

function fetchLimits(options) {
	const maxResponseBytes = positiveLimit(
		options.maxResponseBytes === undefined ? options.maxBytes : options.maxResponseBytes,
		DEFAULT_FETCH_LIMITS.maxResponseBytes,
		ABSOLUTE_FETCH_LIMITS.maxResponseBytes,
	);
	const maxTextChars = positiveLimit(
		options.maxTextChars,
		DEFAULT_FETCH_LIMITS.maxTextChars,
		ABSOLUTE_FETCH_LIMITS.maxTextChars,
	);
	let maxRedirects = DEFAULT_FETCH_LIMITS.maxRedirects;
	if (options.maxRedirects !== undefined) {
		if (Number.isSafeInteger(options.maxRedirects) &&
			options.maxRedirects >= 0 &&
			options.maxRedirects <= ABSOLUTE_FETCH_LIMITS.maxRedirects)
			maxRedirects = options.maxRedirects;
		else maxRedirects = null;
	}
	const timeoutMs = positiveLimit(
		options.timeoutMs,
		DEFAULT_FETCH_LIMITS.timeoutMs,
		ABSOLUTE_FETCH_LIMITS.timeoutMs,
	);
	if (maxResponseBytes == null || maxTextChars == null || maxRedirects == null || timeoutMs == null)
		return failure("WEB_FETCH_LIMITS", "Fetch limits are invalid or exceed safety bounds");
	return {
		ok: true,
		maxResponseBytes,
		maxTextChars,
		maxRedirects,
		timeoutMs,
	};
}

function normalizeHeaders(headers) {
	const result = {};
	if (!headers || typeof headers !== "object") return result;
	for (const key of Object.keys(headers)) {
		const value = headers[key];
		if (value == null) continue;
		result[key.toLowerCase()] = Array.isArray(value)
			? String(value[0] || "")
			: String(value);
	}
	return result;
}

function header(headers, name) {
	return headers[name.toLowerCase()] || "";
}

function parseContentType(value) {
	const parts = value.split(";");
	const mime = parts.shift().trim().toLowerCase();
	let charset = "";
	for (const part of parts) {
		const match = part.match(/^\s*charset\s*=\s*(?:"([^"]+)"|([^\s;]+))/i);
		if (match) {
			charset = (match[1] || match[2]).trim().toLowerCase();
			break;
		}
	}
	return { mime, charset };
}

function supportedTextType(mime) {
	return mime.startsWith("text/") ||
		mime === "application/json" ||
		mime.endsWith("+json") ||
		mime === "application/xml" ||
		mime.endsWith("+xml") ||
		mime === "application/javascript" ||
		mime === "application/x-javascript" ||
		mime === "application/yaml" ||
		mime === "application/x-yaml";
}

function normalizeBody(body) {
	if (Buffer.isBuffer(body)) return body;
	if (body instanceof Uint8Array) return Buffer.from(body);
	if (typeof body === "string") return Buffer.from(body);
	if (body == null) return Buffer.alloc(0);
	return null;
}

function normalizedTransportResponse(response, maxResponseBytes) {
	if (!response || typeof response !== "object" ||
		!Number.isInteger(response.status) || response.status < 100 || response.status > 599)
		return failure("WEB_FETCH_RESPONSE", "Fetch transport returned an invalid response");
	const body = normalizeBody(response.body);
	if (!body) return failure("WEB_FETCH_RESPONSE", "Fetch transport returned an invalid body");
	const responseTruncated = response.responseTruncated === true || body.length > maxResponseBytes;
	return {
		ok: true,
		status: response.status,
		headers: normalizeHeaders(response.headers),
		body: responseTruncated ? body.subarray(0, maxResponseBytes) : body,
		responseTruncated,
	};
}

function readResponseBody(response, maxResponseBytes) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let stored = 0;
		let settled = false;
		let truncated = false;

		function finish(value) {
			if (settled) return;
			settled = true;
			resolve(value);
		}
		function fail(error) {
			if (settled) return;
			settled = true;
			reject(error);
		}
		response.on("data", (chunk) => {
			if (settled) return;
			const buffer = Buffer.from(chunk);
			const remaining = maxResponseBytes - stored;
			const take = Math.min(buffer.length, remaining);
			if (take > 0) {
				chunks.push(buffer.subarray(0, take));
				stored += take;
			}
			if (buffer.length > take) {
				truncated = true;
				finish({ body: Buffer.concat(chunks, stored), responseTruncated: true });
				response.resume();
				response.destroy();
			}
		});
		response.once("end", () =>
			finish({ body: Buffer.concat(chunks, stored), responseTruncated: truncated }),
		);
		response.once("aborted", () => {
			if (!truncated) fail(codedError("WEB_FETCH_NETWORK", "Web response was aborted"));
		});
		response.once("error", (error) => {
			if (!truncated) fail(error);
		});
		response.once("close", () => {
			if (!settled && !response.complete)
				fail(codedError("WEB_FETCH_NETWORK", "Web response closed before completion"));
		});
	});
}

function nodeTransport(request) {
	return new Promise((resolve, reject) => {
		let parsed;
		try {
			parsed = new URL(request.url);
		} catch {
			reject(codedError("WEB_FETCH_NETWORK", "Web request target is invalid"));
			return;
		}
		const client = parsed.protocol === "https:" ? https : http;
		const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
		const address = request.address || hostname;
		const family = net.isIP(address);
		const requestOptions = {
			protocol: parsed.protocol,
			hostname,
			port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
			path: parsed.pathname + parsed.search,
			method: "GET",
			headers: {
				accept: "text/*, application/json, application/xml;q=0.9",
				"accept-encoding": "identity",
				"user-agent": "pi-webui web-fetch",
				...(request.headers || {}),
			},
		};
		if (family) {
			requestOptions.family = family;
			requestOptions.lookup = (_host, _options, callback) => callback(null, address, family);
		}
		if (parsed.protocol === "https:" && !family) requestOptions.servername = hostname;

		let settled = false;
		let req;
		const timer = setTimeout(() => {
			const error = codedError("WEB_FETCH_TIMEOUT", "Web request timed out");
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(error);
			}
			if (req) req.destroy();
		}, request.timeoutMs);
		function finish(fn, value) {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		}
		try {
			req = client.request(requestOptions, (response) => {
				readResponseBody(response, request.maxResponseBytes).then(
					(value) => finish(resolve, { status: response.statusCode, headers: response.headers, ...value }),
					(error) => finish(reject, error),
				);
			});
			req.once("error", (error) => finish(reject, error));
			req.end();
		} catch (error) {
			finish(reject, error);
		}
	});
}

function timeoutPromise(promise, timeoutMs, code, reason) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(codedError(code, reason)), timeoutMs);
	});
	return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function errorInfo(error, phase) {
	if (error && error.code === "WEB_FETCH_TIMEOUT")
		return { code: "WEB_FETCH_TIMEOUT", reason: "Web request timed out" };
	if (error && error.code === "WEB_DNS_TIMEOUT")
		return { code: "WEB_DNS_TIMEOUT", reason: "DNS resolution timed out" };
	if (phase === "dns")
		return { code: "WEB_DNS_FAILED", reason: "DNS resolution failed" };
	return { code: "WEB_FETCH_NETWORK", reason: "Web request failed" };
}

function fetchMeta(requestedUrl, chain) {
	return {
		requestedUrl,
		finalUrl: chain.at(-1) || requestedUrl,
		redirectChain: chain.slice(),
		redirects: Math.max(0, chain.length - 1),
	};
}

function boundedText(text, maxTextChars) {
	if (text.length <= maxTextChars) return { text, truncated: false };
	return {
		text: Array.from(text).slice(0, maxTextChars).join(""),
		truncated: true,
	};
}

function safeContinuation(value) {
	let ref = "";
	if (typeof value === "string") ref = value;
	else if (value && typeof value.ref === "string") ref = value.ref;
	return SAFE_CONTINUATION.test(ref) ? ref : undefined;
}

async function extractText(response, request, meta, options) {
	const contentType = parseContentType(header(response.headers, "content-type"));
	if (header(response.headers, "content-encoding").trim().toLowerCase() &&
		header(response.headers, "content-encoding").trim().toLowerCase() !== "identity")
		return failure("WEB_FETCH_COMPRESSED", "Compressed responses are not accepted", meta);
	if (!contentType.mime || !supportedTextType(contentType.mime))
		return failure("WEB_FETCH_CONTENT_TYPE", "Response content type is not supported as text", meta);

	const charset = contentType.charset || "utf-8";
	let decoder;
	try {
		decoder = new TextDecoder(charset, { fatal: !response.responseTruncated });
	} catch {
		return failure("WEB_FETCH_ENCODING", "Response character encoding is not supported", meta);
	}
	let text;
	try {
		text = decoder.decode(response.body);
	} catch {
		return failure("WEB_FETCH_ENCODING", "Response body has invalid character encoding", meta);
	}
	const bounded = boundedText(text, request.maxTextChars);
	let continuationRef;
	if (bounded.truncated && !response.responseTruncated && typeof options.continuationStore === "function") {
		try {
			continuationRef = safeContinuation(await options.continuationStore({
				body: response.body,
				requestedUrl: meta.requestedUrl,
				finalUrl: meta.finalUrl,
				contentType: contentType.mime,
				charset,
				status: response.status,
			}));
		} catch {
			continuationRef = undefined;
		}
	}
	const marked = labelUntrustedContent(bounded.text, meta.finalUrl);
	return {
		...meta,
		ok: true,
		status: response.status,
		contentType: contentType.mime,
		charset,
		text: marked.text,
		untrusted: marked.untrusted,
		instructionBoundary: marked.instructionBoundary,
		bytes: response.body.length,
		responseTruncated: response.responseTruncated,
		textTruncated: bounded.truncated,
		truncated: response.responseTruncated || bounded.truncated,
		continuationRef,
		retrievedAt: Date.now(),
	};
}

async function fetchWeb(url, options = {}) {
	const settings = normalizedOptions(options);
	const limits = fetchLimits(settings);
	if (!limits.ok) return limits;
	const initial = validateUrlTarget(url);
	if (!initial.ok) return initial;
	const requestedUrl = initial.canonicalUrl;
	const resolve = settings.resolve || ((hostname) => dns.lookup(hostname, { all: true, verbatim: true }));
	const transport = settings.transport || nodeTransport;
	if (typeof resolve !== "function" || typeof transport !== "function")
		return failure("WEB_FETCH_CONFIG", "Fetch resolver and transport must be functions");

	let currentUrl = requestedUrl;
	let chain = [];
	for (;;) {
		const syntax = validateUrlTarget(currentUrl);
		if (!syntax.ok) return failureWithMeta(syntax, requestedUrl, chain);
		let checked;
		if (syntax.isIp) {
			checked = validateResolvedTarget(currentUrl);
		} else {
			let addresses;
			try {
				addresses = await timeoutPromise(
					resolve(syntax.hostname, { url: syntax.canonicalUrl, port: syntax.port }),
					limits.timeoutMs,
					"WEB_DNS_TIMEOUT",
					"DNS resolution timed out",
				);
			} catch (error) {
				const info = errorInfo(error, "dns");
				return failure(info.code, info.reason, fetchMeta(requestedUrl, chain));
			}
			checked = validateResolvedTarget(currentUrl, addresses);
		}
		if (!checked.ok) return failureWithMeta(checked, requestedUrl, chain);
		chain.push(checked.canonicalUrl);

		let rawResponse;
		try {
			rawResponse = await timeoutPromise(
				transport({
					url: checked.canonicalUrl,
					hostname: checked.hostname,
					address: checked.resolvedAddresses && checked.resolvedAddresses[0],
					maxResponseBytes: limits.maxResponseBytes,
					timeoutMs: limits.timeoutMs,
					headers: settings.headers,
				}),
				limits.timeoutMs,
				"WEB_FETCH_TIMEOUT",
				"Web request timed out",
			);
		} catch (error) {
			const info = errorInfo(error, "fetch");
			return failure(info.code, info.reason, fetchMeta(requestedUrl, chain));
		}
		const response = normalizedTransportResponse(rawResponse, limits.maxResponseBytes);
		if (!response.ok) return failureWithMeta(response, requestedUrl, chain);
		const location = header(response.headers, "location").trim();
		if (response.status >= 300 && response.status < 400 && response.status !== 304 && location) {
			if (chain.length - 1 >= limits.maxRedirects)
				return failure("WEB_FETCH_REDIRECT_LIMIT", "Redirect chain exceeds the maximum allowed hops", fetchMeta(requestedUrl, chain));
			try {
				currentUrl = new URL(location, checked.canonicalUrl).href;
			} catch {
				return failure("WEB_FETCH_REDIRECT_INVALID", "Redirect location is not a valid URL", fetchMeta(requestedUrl, chain));
			}
			continue;
		}
		return extractText(response, { ...limits }, fetchMeta(requestedUrl, chain), settings);
	}
}

function failureWithMeta(result, requestedUrl, chain) {
	return failure(result.error.code, result.error.reason, fetchMeta(requestedUrl, chain));
}

module.exports = {
	DEFAULT_FETCH_LIMITS,
	fetchWeb,
};
