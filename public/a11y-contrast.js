// a11y-contrast.js — pure WCAG contrast math + theme-token scanner (U2/A4).
// Node-only: required by test/contrast.test.js (and later rail-resize tests).
// Zero-dep. Browser code does NOT load this module; the contract test file
// (test/a11y-contract.test.js) scans the real sources instead.

/** "#rrggbb" -> [r,g,b] 0-255. 6-digit hex only; anything else throws. */
function hexToRgb(hex) {
	if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
		throw new TypeError(
			`hexToRgb: expected "#rrggbb", got ${JSON.stringify(hex)}`,
		);
	}
	return [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16));
}

/** WCAG 2.x relative luminance of an [r,g,b] (0-255) array. */
function relativeLuminance(rgb) {
	const [r, g, b] = rgb.map((c) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function luminanceOf(hex) {
	return relativeLuminance(hexToRgb(hex));
}

/** WCAG contrast ratio of two "#rrggbb" strings; order-independent. */
function contrastRatio(a, b) {
	const la = luminanceOf(a);
	const lb = luminanceOf(b);
	const hi = Math.max(la, lb);
	const lo = Math.min(la, lb);
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * Scan a CSS text for theme palettes. Returns { dark, paperlike }, each a
 * map of `--var` -> "#rrggbb" (lowercased). Every bare `:root { ... }` block
 * merges into `dark` (later blocks override earlier — CSS semantics); every
 * bare `[data-theme="paperlike"] { ... }` block merges into `paperlike`.
 * A bare block is one whose `{` follows the selector immediately —
 * `[data-theme="paperlike"] #transcript { ... }` is NOT captured. Blocks
 * nested inside `@media` are NOT captured (media overrides are conditional,
 * not the default palette). Only `--name: #hex;` declarations are captured;
 * color-mix/rgba/short-hex and everything else is ignored (the theme files
 * keep derived tints in color-mix lines that must not parse as tokens).
 */
function extractThemeTokens(css) {
	const palettes = { dark: {}, paperlike: {} };
	// strip top-level @media blocks (brace-matched) so conditional `:root`
	// overrides never masquerade as the default palette; also strip comments
	// so a stray `}` inside a comment can never truncate a block capture
	const top = stripTopLevelMedia(css).replace(/\/\*[\s\S]*?\*\//g, "");
	const grab = (selector, out) => {
		const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(esc + "\\s*\\{([^{}]*)\\}", "gi");
		let m;
		while ((m = re.exec(top))) {
			for (const part of m[1].split(";")) {
				const d = part.match(
					/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*$/,
				);
				if (d) out[d[1]] = d[2].toLowerCase();
			}
		}
	};
	grab(":root", palettes.dark);
	grab('[data-theme="paperlike"]', palettes.paperlike);
	return palettes;
}

/** Remove top-level `@media ... { ... }` blocks (brace-matched). */
function stripTopLevelMedia(css) {
	let out = "";
	let depth = 0;
	let i = 0;
	while (i < css.length) {
		const ch = css[i];
		if (depth === 0 && ch === "@" && /^@media\b/.test(css.slice(i))) {
			const open = css.indexOf("{", i);
			if (open === -1) break;
			depth = 1;
			i = open + 1;
			continue;
		}
		if (depth > 0) {
			if (ch === "{") depth++;
			else if (ch === "}") depth--;
			i++;
			continue;
		}
		out += ch;
		i++;
	}
	return out;
}

/** Var lookup (palette["--x"]) or literal-hex passthrough (lowercased). */
function resolveToken(palette, nameOrHex) {
	if (typeof nameOrHex !== "string") {
		throw new TypeError(`resolveToken: expected string, got ${nameOrHex}`);
	}
	if (nameOrHex.startsWith("#")) {
		if (!/^#[0-9a-fA-F]{6}$/.test(nameOrHex)) {
			throw new TypeError(
				`resolveToken: bad literal hex ${JSON.stringify(nameOrHex)}`,
			);
		}
		return nameOrHex.toLowerCase();
	}
	if (!Object.hasOwn(palette, nameOrHex)) {
		throw new Error(`resolveToken: unknown token ${nameOrHex}`);
	}
	return palette[nameOrHex];
}

/**
 * Keyboard step for a percent-in-range splitter value (FR-6). The rail is
 * right-anchored: pointer drag LEFT widens it, so ArrowLeft = wider (+5),
 * ArrowRight = narrower (-5), Home/End jump to the range ends, any other
 * key passes the value through unchanged. Always clamped into [min, max].
 */
function resizeStep(percent, key, min, max) {
	const lo = Math.min(min, max);
	const hi = Math.max(min, max);
	let p = percent;
	if (key === "ArrowLeft") p += 5;
	else if (key === "ArrowRight") p -= 5;
	else if (key === "Home") p = lo;
	else if (key === "End") p = hi;
	return Math.max(lo, Math.min(hi, p));
}

/**
 * Coarse progress text for a wire event, or null when the event must NOT be
 * announced (FR-9). Only turn boundaries and notable transitions announce;
 * every streaming event (message_*, tool_execution_*, response) maps to
 * null so screen readers never hear per-token chatter.
 */
const STATUS_TEXTS = {
	agent_start: "assistant working",
	agent_end: "response complete",
	auto_retry_start: "retrying…",
	auto_retry_end: "retry finished",
	extension_error: "extension error",
	error: "error",
	compaction_start: "context compacted",
	compaction_end: "context compaction finished",
};
function statusTextForEvent(evt) {
	return Object.hasOwn(STATUS_TEXTS, evt) ? STATUS_TEXTS[evt] : null;
}

const api = {
	hexToRgb,
	relativeLuminance,
	contrastRatio,
	extractThemeTokens,
	resolveToken,
	resizeStep,
	statusTextForEvent,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.a11yContrast = api;
