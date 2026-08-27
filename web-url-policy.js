// W01 — pure network target policy shared by web, fetch, and GitHub adapters.
"use strict";

const net = require("node:net");

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);
const DEFAULT_MAX_REDIRECTS = 5;
const MAX_HOSTNAME_LENGTH = 253;
const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"local",
	"localdomain",
	"broadcasthost",
	"ip6-localhost",
	"ip6-loopback",
	"ip6-allnodes",
	"ip6-allrouters",
	"metadata",
	"metadata.google.internal",
	"metadata.azure.com",
	"metadata.azure.internal",
	"metadata.tencentyun.com",
	"instance-data",
	"instance-data.ec2.internal",
]);

function failure(code, reason) {
	return { ok: false, error: { code, reason } };
}

function normalizeHostname(value) {
	let host = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (host.startsWith("[") && host.endsWith("]"))
		host = host.slice(1, -1);
	while (host.endsWith(".")) host = host.slice(0, -1);
	return host;
}

function normalizeAddress(value) {
	let address = typeof value === "string" ? value.trim() : "";
	if (address.startsWith("[") && address.endsWith("]"))
		address = address.slice(1, -1);
	return address;
}

function ipv4Parts(value) {
	if (typeof value !== "string") return null;
	const parts = value.split(".");
	if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part)))
		return null;
	const numbers = parts.map(Number);
	return numbers.every((part) => part >= 0 && part <= 255) ? numbers : null;
}

function classifyIpv4(value) {
	const parts = ipv4Parts(value);
	if (!parts) return "invalid";
	const [a, b, c, d] = parts;

	if ((a === 169 && b === 254 && c === 169 && d === 254) ||
		(a === 100 && b === 100 && c === 100 && d === 200))
		return "metadata";
	if (a === 0) return "unspecified";
	if (a === 127) return "loopback";
	if (a === 10 || (a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168))
		return "private";
	if (a === 100 && b >= 64 && b <= 127) return "shared";
	if (a === 169 && b === 254) return "link-local";
	if (a === 192 && b === 0 && c === 0) return "reserved";
	if (a === 192 && b === 0 && c === 2) return "documentation";
	if (a === 192 && b === 88 && c === 99) return "reserved";
	if (a === 198 && b >= 18 && b <= 19) return "reserved";
	if (a === 198 && b === 51 && c === 100) return "documentation";
	if (a === 203 && b === 0 && c === 113) return "documentation";
	if (a >= 224 && a <= 239) return "multicast";
	if (a >= 240) return "reserved";
	return "public";
}

function ipv6Bytes(value) {
	let text = normalizeAddress(value).toLowerCase();
	if (!text || text.includes("%")) return null;
	if (text.includes(".")) {
		const split = text.lastIndexOf(":");
		if (split < 0) return null;
		const v4 = ipv4Parts(text.slice(split + 1));
		if (!v4) return null;
		const first = ((v4[0] << 8) | v4[1]).toString(16);
		const second = ((v4[2] << 8) | v4[3]).toString(16);
		text = text.slice(0, split + 1) + first + ":" + second;
	}

	const halves = text.split("::");
	if (halves.length > 2) return null;
	const left = halves[0] ? halves[0].split(":") : [];
	const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
	const validGroup = (group) => /^[0-9a-f]{1,4}$/.test(group);
	if (left.some((group) => !validGroup(group)) ||
		right.some((group) => !validGroup(group)))
		return null;

	let groups;
	if (halves.length === 1) {
		if (left.length !== 8) return null;
		groups = left;
	} else {
		const missing = 8 - left.length - right.length;
		if (missing < 1) return null;
		groups = left.concat(Array(missing).fill("0"), right);
	}
	const bytes = [];
	for (const group of groups) {
		const number = parseInt(group, 16);
		bytes.push(number >> 8, number & 0xff);
	}
	return bytes;
}

function allZero(bytes, end = bytes.length) {
	for (let i = 0; i < end; i++) if (bytes[i] !== 0) return false;
	return true;
}

function samePrefix(bytes, prefix) {
	for (let i = 0; i < prefix.length; i++)
		if (bytes[i] !== prefix[i]) return false;
	return true;
}

function embeddedV4(bytes, start) {
	return [bytes[start], bytes[start + 1], bytes[start + 2], bytes[start + 3]].join(".");
}

function classifyIpv6(value) {
	const bytes = ipv6Bytes(value);
	if (!bytes) return "invalid";
	if (allZero(bytes)) return "unspecified";
	if (allZero(bytes, 15) && bytes[15] === 1) return "loopback";

	// Mapped, compatible, NAT64, and 6to4 forms can hide an unsafe IPv4 target.
	const mapped = allZero(bytes, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
	const compatible = allZero(bytes, 12);
	if (mapped || compatible) return classifyIpv4(embeddedV4(bytes, 12));
	if (samePrefix(bytes, [0x00, 0x64, 0xff, 0x9b]) && allZero(bytes.slice(4), 12))
		return classifyIpv4(embeddedV4(bytes, 12));
	if (bytes[0] === 0x20 && bytes[1] === 0x02)
		return classifyIpv4(embeddedV4(bytes, 2));

	if ((bytes[0] & 0xfe) === 0xfc) return "private";
	if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)
		return "link-local";
	if (bytes[0] === 0xff) return "multicast";
	if (samePrefix(bytes, [0x20, 0x01, 0x0d, 0xb8])) return "documentation";
	if (samePrefix(bytes, [0x20, 0x01, 0x00, 0x02])) return "reserved";
	if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 &&
		(bytes[3] & 0xf0) === 0x10)
		return "reserved";
	if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 &&
		bytes[3] === 0x00)
		return "reserved";
	return "public";
}

function classifyIp(value) {
	const address = normalizeAddress(value);
	const family = net.isIP(address);
	if (!family) return { family: 0, category: "invalid" };
	return {
		family,
		category: family === 4 ? classifyIpv4(address) : classifyIpv6(address),
	};
}

function isBlockedHostname(hostname) {
	if (BLOCKED_HOSTNAMES.has(hostname)) return true;
	return [".localhost", ".local", ".localdomain", ".internal", ".home.arpa"].some(
		(suffix) => hostname.endsWith(suffix),
	);
}

function unsafeReason(phase, category) {
	const label = category === "link-local" ? "link-local" : category;
	return `${phase} is a ${label} address and is not allowed`;
}

function parseUrlTarget(value) {
	if (typeof value !== "string" || !value.trim())
		return failure("WEB_URL_INVALID", "URL must be a non-empty HTTP(S) URL");
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		return failure("WEB_URL_INVALID", "URL could not be parsed");
	}
	if (!SAFE_PROTOCOLS.has(parsed.protocol))
		return failure("WEB_URL_SCHEME", "Only HTTP and HTTPS URLs are allowed");
	if (parsed.username || parsed.password)
		return failure("WEB_URL_CREDENTIALS", "URL credentials are not allowed");

	const hostname = normalizeHostname(parsed.hostname);
	if (!hostname || hostname.length > MAX_HOSTNAME_LENGTH)
		return failure("WEB_URL_HOST", "URL must contain a valid hostname");
	if (isBlockedHostname(hostname))
		return failure("WEB_URL_UNSAFE_TARGET", "Local and cloud metadata hostnames are not allowed");

	const ip = net.isIP(hostname);
	if (ip) {
		const classification = classifyIp(hostname);
		if (classification.category !== "public")
			return failure("WEB_URL_UNSAFE_TARGET", unsafeReason("URL target", classification.category));
	}
	let port = parsed.protocol === "https:" ? 443 : 80;
	if (parsed.port) port = Number(parsed.port);
	return {
		ok: true,
		url: parsed.href,
		canonicalUrl: parsed.href,
		protocol: parsed.protocol.slice(0, -1),
		hostname,
		port,
		isIp: Boolean(ip),
		dnsRequired: !ip,
		dnsChecked: Boolean(ip),
	};
}

function validateUrlTarget(value, options = {}) {
	const target = parseUrlTarget(value);
	if (!target.ok) return target;
	if (options && Object.prototype.hasOwnProperty.call(options, "resolvedAddresses"))
		return validateResolvedTarget(value, options.resolvedAddresses);
	return target;
}

function resolvedAddressValue(value) {
	if (typeof value === "string") return normalizeAddress(value);
	if (value && typeof value.address === "string") return normalizeAddress(value.address);
	return "";
}

function validateResolvedTarget(value, addresses) {
	const target = parseUrlTarget(value);
	if (!target.ok) return target;
	if (addresses === undefined) {
		if (target.isIp)
			return { ...target, connectionTargetChecked: true, resolvedAddresses: [target.hostname] };
		return failure("WEB_DNS_REQUIRED", "Hostname resolution must be checked before connection");
	}
	if (!Array.isArray(addresses))
		return failure("WEB_DNS_INVALID", "DNS results must be an address list");
	if (!addresses.length)
		return failure("WEB_DNS_NO_RESULT", "DNS returned no connection targets");

	const resolvedAddresses = [];
	for (const item of addresses) {
		const address = resolvedAddressValue(item);
		const classification = classifyIp(address);
		if (classification.category === "invalid")
			return failure("WEB_DNS_INVALID", "DNS returned an invalid connection target");
		if (classification.category !== "public")
			return failure("WEB_DNS_UNSAFE_TARGET", unsafeReason("Resolved connection target", classification.category));
		if (!resolvedAddresses.includes(address)) resolvedAddresses.push(address);
	}
	if (!resolvedAddresses.length)
		return failure("WEB_DNS_NO_RESULT", "DNS returned no connection targets");
	return {
		...target,
		dnsRequired: false,
		dnsChecked: true,
		connectionTargetChecked: true,
		resolvedAddresses,
	};
}

function redirectHop(hop) {
	if (typeof hop === "string") return { url: hop, hasAddresses: false };
	if (!hop || typeof hop !== "object" || Array.isArray(hop)) return null;
	return {
		url: hop.url,
		hasAddresses: Object.prototype.hasOwnProperty.call(hop, "addresses"),
		addresses: hop.addresses,
	};
}

function validateRedirectChain(hops, options = {}) {
	if (!Array.isArray(hops) || !hops.length)
		return failure("WEB_REDIRECT_INVALID", "Redirect chain must contain an initial URL");
	options = options && typeof options === "object" && !Array.isArray(options) ? options : {};
	const maxRedirects = options.maxRedirects == null
		? DEFAULT_MAX_REDIRECTS
		: options.maxRedirects;
	if (!Number.isInteger(maxRedirects) || maxRedirects < 0)
		return failure("WEB_REDIRECT_INVALID", "Redirect limit must be a non-negative integer");
	if (hops.length - 1 > maxRedirects)
		return failure("WEB_REDIRECT_LIMIT", "Redirect chain exceeds the maximum allowed hops");

	const urls = [];
	let requiresResolution = false;
	for (const hop of hops) {
		const item = redirectHop(hop);
		if (!item || typeof item.url !== "string")
			return failure("WEB_REDIRECT_INVALID", "Every redirect hop must contain a URL");
		const checked = item.hasAddresses
			? validateResolvedTarget(item.url, item.addresses)
			: validateUrlTarget(item.url);
		if (!checked.ok) return checked;
		urls.push(checked.canonicalUrl);
		if (checked.dnsRequired && !checked.dnsChecked) requiresResolution = true;
	}
	if (options.requireResolved && requiresResolution)
		return failure("WEB_DNS_REQUIRED", "Every redirect target must be DNS-checked before connection");
	return {
		ok: true,
		urls,
		initialUrl: urls[0],
		finalUrl: urls.at(-1),
		redirects: urls.length - 1,
		requiresResolution,
		dnsChecked: !requiresResolution,
	};
}

function labelUntrustedContent(text, sourceUrl) {
	const result = {
		kind: "web-content",
		untrusted: true,
		instructionBoundary: "data-only",
		text: typeof text === "string" ? text : "",
	};
	if (typeof sourceUrl === "string") {
		const source = validateUrlTarget(sourceUrl);
		if (source.ok) result.sourceUrl = source.canonicalUrl;
	}
	return result;
}

module.exports = {
	classifyIp,
	validateUrlTarget,
	validateResolvedTarget,
	validateRedirectChain,
	labelUntrustedContent,
};
