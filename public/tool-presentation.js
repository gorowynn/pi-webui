/*
 * tool-presentation.js — tool-output content-type detection + typed renderers.
 *
 * Zero-dep, vanilla DOM. Loaded after md.js (esc, md) + highlight.min.js and
 * before app.js. Exposes the `toolPresent` global. Plan 2.1–2.6 / R§2.x.
 *
 * SECURITY (R§4 — verbatim from the adoption doc): raw tool content is NEVER
 * innerHTML'd. Only textContent, the safe markdown pipeline (md.js escapes),
 * <img> from a data URL (SVG — img doesn't execute SVG scripts), or a sandboxed
 * <iframe> (HTML — empty sandbox + stripScripts defense-in-depth) ever touches
 * the DOM. No inline SVG, no srcdoc-without-sandbox, ever.
 */
(function () {
	"use strict";

	// ---- content-type detection (R§2.1) ----
	// extension → hljs language. Keys are lowercased exts without the dot.
	var LANG = {
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		jsx: "javascript",
		ts: "typescript",
		tsx: "typescript",
		mts: "typescript",
		cts: "typescript",
		json: "json",
		json5: "json",
		jsonc: "json",
		css: "css",
		scss: "scss",
		less: "less",
		xml: "xml",
		md: "markdown",
		markdown: "markdown",
		py: "python",
		pyi: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
		java: "java",
		c: "c",
		h: "c",
		cpp: "cpp",
		cc: "cpp",
		cxx: "cpp",
		hpp: "cpp",
		hh: "cpp",
		cs: "csharp",
		php: "php",
		swift: "swift",
		kt: "kotlin",
		kts: "kotlin",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		fish: "bash",
		yml: "yaml",
		yaml: "yaml",
		toml: "ini",
		ini: "ini",
		cfg: "ini",
		conf: "ini",
		sql: "sql",
		lua: "lua",
		pl: "perl",
		r: "r",
		scala: "scala",
		dart: "dart",
		gradle: "groovy",
		groovy: "groovy",
		ps1: "powershell",
		psm1: "powershell",
		dockerfile: "dockerfile",
		makefile: "makefile",
		vue: "xml",
		svelte: "xml",
	};
	// extensions that get a typed (non-code, non-text) render. Everything with a
	// known LANG but not here → "code" (highlighted, numbered). Unknown → "text".
	var TYPED = {
		csv: "csv",
		tsv: "csv",
		html: "html",
		htm: "html",
		svg: "svg",
	};
	function extOf(path) {
		if (!path) return "";
		var p = String(path);
		// Dockerfile/Makefile have no extension — match the basename.
		var base = p.toLowerCase().replace(/.*[\\/]/, "");
		if (base === "dockerfile") return "dockerfile";
		if (base === "makefile" || base === "gnumakefile") return "makefile";
		var m = p.toLowerCase().match(/\.([a-z0-9]+)$/);
		return m ? m[1] : "";
	}
	function languageFromPath(path) {
		return LANG[extOf(path)] || null;
	}
	function contentKindFromPath(path) {
		var e = extOf(path);
		if (TYPED[e]) return TYPED[e];
		if (LANG[e]) return "code";
		return "text";
	}

	// ---- header label (moved from app.js describeTool; R§2.1 / F§4.4) ----
	// One-line description of a tool call, shown in the activity bar + box head.
	function describeToolCall(name, args) {
		if (!args) return name || "tool";
		if (name === "edit" || name === "write")
			return `${name} ${args.path || ""}`;
		if (name === "read") return `reading ${args.path || ""}`;
		if (name === "bash")
			return `bash: ${String(args.command || "").slice(0, 60)}`;
		if (name === "grep" || name === "find")
			return `${name}: ${args.pattern || args.path || ""}`;
		if (name === "todo") {
			var a = args && args.action;
			var n = function (x) {
				return Array.isArray(x) ? x.length : 0;
			};
			if (a === "plan" || a === "add")
				return `todo ${a}: ${n(args.items)} task(s)`;
			if (a === "update") return `todo update: ${n(args.updates)} change(s)`;
			if (a === "remove") return `todo remove: ${n(args.ids)}`;
			if (a === "clear") return "todo cleared";
			return "todo";
		}
		if (name === "web_search" || name === "web_fetch")
			return `${name}: ${String(args.query || args.url || "").slice(0, 60)}`;
		return name || "tool";
	}

	// ---- bounded text preview (R§2.6) ----
	// Returns the first `maxLines` lines plus a `remaining` count. The renderer
	// shows a "view M more lines" button that swaps in the full text. Stops a
	// 2000-line grep/bash result from dominating the transcript.
	function toolTextPreview(text, maxLines) {
		text = text == null ? "" : String(text);
		maxLines = maxLines || 4;
		var lines = text.split("\n");
		if (lines.length <= maxLines) return { text: text, remaining: 0 };
		return {
			text: lines.slice(0, maxLines).join("\n"),
			remaining: lines.length - maxLines,
			full: text,
		};
	}
	function renderTextPreview(host, text) {
		var p = toolTextPreview(text, 4);
		var pre = document.createElement("pre");
		pre.className = "tool-pre";
		pre.textContent = p.text;
		host.appendChild(pre);
		if (p.remaining > 0) {
			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "tool-more";
			btn.textContent =
				"view " +
				p.remaining +
				" more line" +
				(p.remaining > 1 ? "s" : "");
			btn.addEventListener("click", function () {
				pre.textContent = p.full;
				btn.remove();
			});
			host.appendChild(btn);
		}
	}

	// ---- line-numbered highlighted code (R§2.2) ----
	// A two-column layout: a dimmed right-aligned line-number gutter (starting at
	// `startLine`, from the read tool's `offset`) beside a <pre><code> that the
	// deferred highlighter (app.js highlightCode) colors when scrolled near.
	// Lines correspond 1:1; code uses white-space:pre (horizontal scroll, no wrap)
	// so the gutter stays aligned. Highlighting is capped at 50K chars (canHighlight)
	// — beyond that it degrades to plain numbered pre.
	var HIGHLIGHT_CAP = 50000;
	function canHighlight(text) {
		return text != null && text.length <= HIGHLIGHT_CAP;
	}
	function renderNumberedCode(host, text, opts) {
		opts = opts || {};
		var startLine = opts.startLine || 1;
		var lang = opts.lang || null;
		text = text == null ? "" : String(text);
		var lines = text.replace(/\n$/, "").split("\n");
		if (text === "") lines = [];

		var wrap = document.createElement("div");
		wrap.className = "numcode";

		var gutter = document.createElement("div");
		gutter.className = "nc-gutter";
		gutter.setAttribute("aria-hidden", "true");
		var end = startLine + Math.max(lines.length, 1) - 1;
		for (var n = startLine; n <= end; n++) {
			var g = document.createElement("span");
			g.className = "nc-ln";
			g.textContent = n;
			gutter.appendChild(g);
		}

		var pre = document.createElement("pre");
		pre.className = "nc-code";
		var code = document.createElement("code");
		if (lang && canHighlight(text)) code.className = "language-" + lang;
		code.textContent = text;
		pre.appendChild(code);
		// cap notice (plain numbered pre beyond 50K — don't materialize a huge
		// hljs parse)
		if (!canHighlight(text)) {
			var note = document.createElement("div");
			note.className = "nc-cap";
			note.textContent =
				"Highlighting disabled beyond " +
				HIGHLIGHT_CAP.toLocaleString() +
				" characters";
			wrap.appendChild(note);
		}

		wrap.appendChild(gutter);
		wrap.appendChild(pre);
		host.appendChild(wrap);
		// hand off to the deferred highlighter (app.js IntersectionObserver).
		if (typeof highlightCode === "function") highlightCode(wrap);
	}

	// ---- SVG as <img> (R§2.5) ----
	// An <img> loaded from an SVG data URL does NOT execute scripts in the SVG
	// (unlike inline SVG, where <script>/onload would run). Safe by construction.
	function renderSvgPreview(host, content) {
		var src =
			"data:image/svg+xml;charset=utf-8," +
			encodeURIComponent(content == null ? "" : String(content));
		var img = document.createElement("img");
		img.className = "tool-svg";
		img.alt = "SVG preview";
		img.src = src;
		host.appendChild(img);
	}

	// ---- dispatch (R§2.1) ----
	// ctx: { name, args, text, isError }. Decides the render kind from the tool +
	// (for read) the path extension, then delegates. Appends to `host` (caller
	// clears it first). csv/html are added in follow-up commits; until then they
	// fall through to the bounded text preview.
	function renderToolOutput(host, ctx) {
		var name = ctx.name,
			args = ctx.args || {},
			text = ctx.text == null ? "" : String(ctx.text);
		// errors are always plain text (don't parse an error message as code/csv)
		if (!ctx.isError && name === "read" && args.path) {
			var kind = contentKindFromPath(args.path);
			if (kind === "svg") {
				renderSvgPreview(host, text);
				return;
			}
			if (kind === "code") {
				renderNumberedCode(host, text, {
					lang: languageFromPath(args.path),
					startLine: args.offset || 1,
				});
				return;
			}
			// csv / html → text preview for now (replaced in plan 2.3/2.4)
		}
		renderTextPreview(host, text);
	}

	window.toolPresent = {
		extOf: extOf,
		languageFromPath: languageFromPath,
		contentKindFromPath: contentKindFromPath,
		describeToolCall: describeToolCall,
		toolTextPreview: toolTextPreview,
		renderTextPreview: renderTextPreview,
		renderNumberedCode: renderNumberedCode,
		renderSvgPreview: renderSvgPreview,
		renderToolOutput: renderToolOutput,
	};
})();
