/**
 * md.js — thin shim over the vendored markdown-it (vendor/markdown-it.min.js).
 *
 * Contract unchanged: `md(markdownString)` → HTML string; `esc(text)` → HTML-
 * escaped string. Both are globals this file sets, loaded BEFORE app.js (which
 * calls md()/esc() at ~45 sites). Also require-able in Node:
 * `const {md, esc} = require('./md.js')` — used by the round-trip self-check.
 *
 * Why a shim, not a parser: the hand-rolled CommonMark-ish parser this file
 * used to be (~790 lines of inline/block/table/list/emphasis/link/fence logic)
 * is gone. We delegate to markdown-it 14.x — a UMD build that sets the global
 * `markdownit` when loaded as a plain <script> (same drop-in pattern as the
 * vendored highlight.js). markdown-it is CommonMark + GFM-conformant (validated
 * against the official spec suites) and XSS-safe by default: html:false escapes
 * raw HTML, and its built-in validateLink drops javascript:/data:/vbscript:
 * hrefs. esc() stays HERE as the project-wide HTML-escaping source of truth —
 * markdown-it gives us no such global, and ~45 app.js call sites depend on it.
 *
 * Config mirrors the old parser's visible behavior so the swap is a near-no-op:
 *   - GFM tables + strikethrough (markdown-it default preset)
 *   - linkify: bare URLs → links (an improvement; the old parser only linked
 *     <url> autolinks)
 *   - breaks:true → intra-paragraph \n becomes <br> (matches the old parser's
 *     `inline(...).replace(/\n/g,"<br>")`)
 *   - every <a> gets target=_blank rel=noopener noreferrer (matches old output)
 *
 * Streaming (gotcha #13 re-opened): app.js re-renders the WHOLE accumulated
 * buffer per rAF (scheduleRender → renderText/renderThink), so render() is only
 * ever called on complete or incrementally-growing text. markdown-it tolerates
 * partial input (an unclosed fence/emphasis/link renders as its literal/partial
 * form) and the message_end finalize re-renders from pi's authoritative
 * payload.message.content, so a transiently-wrong live token self-corrects.
 *
 * Degradation: if markdownit is absent (missing vendor file / standalone w/o the
 * asset) md() returns the text escaped in a <p> — never throws — mirroring the
 * highlight.js gating philosophy.
 */
var md, esc;
(() => {
	// ---------- HTML escaping (project-wide source of truth) ----------
	// ponytail: module-scoped static map — no per-match allocation. Null-safe:
	// esc(null) → "". Kept verbatim from the old parser; markdown-it exports no
	// escaping global, and app.js has ~45 call sites that depend on this one.
	var ENT = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	function escapeHtml(s) {
		return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ENT[c]);
	}

	// ---------- markdown-it engine (resolved once, env-agnostic) ----------
	// Browser: window.markdownit is set by the UMD loaded before this file.
	// Node (tests): require the same UMD — its wrapper does module.exports=e().
	var engine = null;
	function getEngine() {
		if (engine) return engine;
		var factory =
			typeof markdownit !== "undefined"
				? markdownit // browser global (UMD)
				: typeof require === "function"
					? (() => {
							try {
								return require("./vendor/markdown-it.min.js");
							} catch (e) {
								return null;
							}
						})()
					: null;
		if (typeof factory !== "function") return null; // missing asset → degrade
		engine = factory({
			html: false, // escape raw HTML (assistant output is semi-trusted)
			breaks: true, // \n in a paragraph → <br> (matches old parser output)
			linkify: true, // bare URLs → <a> (improvement over old autolink-only)
			typographer: false,
		});
		// every link opens safely in a new tab (matches old parser output)
		engine.renderer.rules.link_open = (tokens, idx, options, env, self) => {
			var tok = tokens[idx];
			if (!tok.attrGet("target")) tok.attrSet("target", "_blank");
			if (!tok.attrGet("rel")) tok.attrSet("rel", "noopener noreferrer");
			return self.renderToken(tokens, idx, options);
		};
		return engine;
	}

	function render(text) {
		var eng = getEngine();
		var src = String(text == null ? "" : text);
		if (!eng) return "<p>" + escapeHtml(src) + "</p>"; // degrade, never throw
		return eng.render(src);
	}

	md = function md(text) {
		var src = String(text == null ? "" : text);
		return src ? render(src) : "";
	};

	esc = escapeHtml;
	if (typeof module !== "undefined" && module.exports)
		module.exports = { md: md, esc: esc };
})();
