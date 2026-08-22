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
(() => {
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
			var n = (x) => (Array.isArray(x) ? x.length : 0);
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

	// ---- header detail (the readable command/path for the card head) ----
	// describeToolCall returns the full activity label (e.g. "bash: npm test");
	// toolCallDetail returns just the meaningful part (command/path/pattern) for
	// the card's .cmd span alongside the tool name (plan 3.1 / U§2.3).
	function toolCallDetail(name, args) {
		if (!args) return "";
		switch (name) {
			case "bash":
				return String(args.command || "").slice(0, 80);
			case "read":
			case "edit":
			case "write":
				return args.path || "";
			case "grep":
			case "find":
				return args.pattern || args.path || "";
			case "web_search":
				return String(args.query || "").slice(0, 80);
			case "web_fetch":
				return args.url || "";
			case "todo": {
				var a = args.action;
				var n = (x) => (Array.isArray(x) ? x.length : 0);
				if (a === "plan" || a === "add")
					return a + " " + n(args.items) + " task(s)";
				if (a === "update") return "update " + n(args.updates);
				if (a === "remove") return "remove " + n(args.ids);
				if (a === "clear") return "cleared";
				return "";
			}
			default:
				return "";
		}
	}

	// A compact, text-first turn summary keeps tool detail inspectable without
	// making every result compete with the conversation.
	function toolUsageSummary(names) {
		var counts = new Map();
		var order = [];
		(Array.isArray(names) ? names : []).forEach((raw) => {
			var name = typeof raw === "string" && raw.trim() ? raw : "tool";
			if (!counts.has(name)) order.push(name);
			counts.set(name, (counts.get(name) || 0) + 1);
		});
		return order
			.map((name) => {
				var count = counts.get(name);
				return name + (count > 1 ? " ×" + count : "");
			})
			.join(", ");
	}

	function toolGroupSummary(count, running, errors, duration) {
		count = Math.max(0, Number(count) || 0);
		running = Math.max(0, Number(running) || 0);
		errors = Math.max(0, Number(errors) || 0);
		var parts = [count + (count === 1 ? " tool" : " tools")];
		if (errors) parts.push(errors + (errors === 1 ? " error" : " errors"));
		if (running) parts.push("working");
		else if (!errors) parts.push("complete");
		if (duration) parts.push(String(duration));
		return parts.join(" · ");
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
				"view " + p.remaining + " more line" + (p.remaining > 1 ? "s" : "");
			btn.addEventListener("click", () => {
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

	// ---- bounded CSV table (R§2.3) ----
	// Renders the parser's {headers, rows} as a <table>. Empty/unparseable input
	// falls back to the bounded text preview. When truncated, shows a "view
	// source" toggle that reveals the first 20KB raw (csvPreview.source).
	function renderCsvPreview(host, content) {
		var parsed = csvPreview.parse(content);
		if (!parsed.headers.length && !parsed.rows.length) {
			renderTextPreview(host, content);
			return;
		}
		var wrap = document.createElement("div");
		wrap.className = "csv-prev";
		if (parsed.truncated) {
			var cap = document.createElement("div");
			cap.className = "csv-cap";
			cap.textContent = "Preview limited for performance";
			wrap.appendChild(cap);
		}
		var ncols = parsed.headers.length;
		for (var r = 0; r < parsed.rows.length; r++)
			if (parsed.rows[r].length > ncols) ncols = parsed.rows[r].length;
		ncols = Math.min(ncols, 8);
		var table = document.createElement("table");
		if (parsed.headers.length) {
			var thead = document.createElement("thead");
			var htr = document.createElement("tr");
			for (var c = 0; c < ncols; c++) {
				var th = document.createElement("th");
				th.textContent = parsed.headers[c] || "";
				htr.appendChild(th);
			}
			thead.appendChild(htr);
			table.appendChild(thead);
		}
		var tbody = document.createElement("tbody");
		for (var r = 0; r < parsed.rows.length; r++) {
			var btr = document.createElement("tr");
			for (var c = 0; c < ncols; c++) {
				var td = document.createElement("td");
				td.textContent = parsed.rows[r][c] || "";
				btr.appendChild(td);
			}
			tbody.appendChild(btr);
		}
		table.appendChild(tbody);
		wrap.appendChild(table);
		if (parsed.truncated) {
			var btn = document.createElement("button");
			btn.type = "button";
			btn.className = "tool-more csv-src";
			btn.textContent = "view source";
			var pre = null;
			btn.addEventListener("click", () => {
				if (!pre) {
					pre = document.createElement("pre");
					pre.className = "tool-pre";
					pre.textContent = csvPreview.source(content);
					wrap.appendChild(pre);
					btn.textContent = "hide source";
				} else {
					pre.remove();
					pre = null;
					btn.textContent = "view source";
				}
			});
			wrap.appendChild(btn);
		}
		host.appendChild(wrap);
	}

	// ---- sandboxed HTML preview (R§2.4) ----
	// Two defense layers (both required): (1) <iframe sandbox=""> is the MOST
	// restrictive mode — no scripts, forms, popups, same-origin, or plugins; the
	// framed content cannot touch the parent. (2) stripScripts() scrubs <script>,
	// on* handlers and javascript: URLs beforehand as defense-in-depth. NEVER set
	// sandbox="allow-scripts" (or allow-same-origin) — that escapes the sandbox.
	// Opt-in: shows the source as code first; the user clicks to render.
	function stripScripts(html) {
		return String(html == null ? "" : html)
			.replace(/<script\b[^>]*>(?:[\s\S]*?<\/script\s*>|[\s\S]*)/gi, "")
			.replace(/<script\b[^>]*\/\s*>/gi, "")
			.replace(/<\/script\s*>/gi, "")
			.replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
			.replace(
				/\s+(?:href|src|action|formaction|poster|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi,
				"",
			);
	}
	function renderHtmlPreview(host, content) {
		content = content == null ? "" : String(content);
		// default: inert source code (opt-in render — untrusted HTML stays inert)
		renderNumberedCode(host, content, { lang: "xml" });
		var btn = document.createElement("button");
		btn.type = "button";
		btn.className = "tool-more html-render";
		btn.textContent = "render preview";
		var frame = null;
		btn.addEventListener("click", () => {
			if (!frame) {
				frame = document.createElement("iframe");
				frame.className = "html-prev";
				frame.setAttribute("sandbox", ""); // most restrictive
				frame.setAttribute("srcdoc", stripScripts(content));
				host.appendChild(frame);
				btn.textContent = "hide preview";
			} else {
				frame.remove();
				frame = null;
				btn.textContent = "render preview";
			}
		});
		host.appendChild(btn);
	}

	// ---- dispatch (R§2.1) ----
	// ctx: { name, args, text, isError }. Decides the render kind from the tool +
	// (for read) the path extension, then delegates. Appends to `host` (caller
	// clears it first). Errors fall to text (don't parse an error as code/csv).
	function renderToolOutput(host, ctx) {
		var name = ctx.name,
			args = ctx.args || {},
			text = ctx.text == null ? "" : String(ctx.text);
		// errors are always plain text (don't parse an error message as code/csv)
		if (!ctx.isError && name === "read" && args.path) {
			var kind = contentKindFromPath(args.path);
			if (kind === "csv") {
				renderCsvPreview(host, text);
				return;
			}
			if (kind === "html") {
				renderHtmlPreview(host, text);
				return;
			}
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
		}
		renderTextPreview(host, text);
	}

	// ---- height-preserving offscreen placeholder (R§2.7 virtualization) ----
	// When a typed tool-output preview (code/csv/table) scrolls far out of view,
	// swap its rendered DOM for a fixed-height <div> placeholder so a long
	// transcript doesn't keep dozens of highlighted-code / table subtrees alive.
	// Re-entering the viewport re-renders. Height is measured at collapse time
	// (offsetHeight) — sufficient and simpler than a ResizeObserver, which would
	// only matter if we needed to track size WHILE rendered. Only the typed-
	// preview path is virtualized; edit/write diffs + the subagent live view have
	// their own DOM and stay as-is.
	var previewObserver = null;
	var previewState = new WeakMap(); // managed el -> { ctx, rendered, height }
	function renderIntoManaged(managed, ctx) {
		managed.replaceChildren();
		renderToolOutput(managed, ctx);
	}
	function collapseManaged(managed) {
		var s = previewState.get(managed);
		if (!s || !s.rendered) return;
		s.height = managed.offsetHeight; // measure before clearing
		managed.replaceChildren();
		var ph = document.createElement("div");
		ph.className = "tp-ph";
		ph.style.height = s.height + "px";
		managed.appendChild(ph);
		s.rendered = false;
	}
	function ensurePreviewObserver() {
		if (previewObserver) return previewObserver;
		if (!("IntersectionObserver" in window)) return null;
		previewObserver = new IntersectionObserver(
			(entries) => {
				for (var i = 0; i < entries.length; i++) {
					var m = entries[i].target;
					var s = previewState.get(m);
					if (!s) continue;
					// cleanup detached nodes (transcript cleared / session switch)
					if (!m.isConnected) {
						previewObserver.unobserve(m);
						previewState.delete(m);
						continue;
					}
					// skip collapsed cards: their .out-wrap is display:none (content already
					// hidden), and collapsing here would force a wasteful re-render on reopen
					// (and re-triggered mid-close during the old grid animation = flicker).
					if (!m.closest(".tool.open")) continue;
					if (entries[i].isIntersecting) {
						if (!s.rendered) {
							renderIntoManaged(m, s.ctx);
							s.rendered = true;
						}
					} else if (s.rendered) {
						collapseManaged(m);
					}
				}
			},
			// generous margin: only virtualize when well offscreen (>~1500px), so
			// actively-visible + nearby content stays rendered for smooth scrolling.
			{ rootMargin: "1500px 0px 1500px 0px" },
		);
		return previewObserver;
	}
	// mountToolPreview(host, ctx): the virtualizing entry point. Renders the
	// typed preview into a managed wrapper, then lets the shared observer
	// collapse/re-render it as it leaves/re-enters the viewport. Callers that
	// used renderToolOutput directly now call this (plan 2.8).
	function mountToolPreview(host, ctx) {
		var managed = document.createElement("div");
		managed.className = "tp-managed";
		host.appendChild(managed);
		renderIntoManaged(managed, ctx);
		previewState.set(managed, { ctx: ctx, rendered: true, height: 0 });
		var obs = ensurePreviewObserver();
		if (obs) obs.observe(managed);
	}

	var api = {
		extOf: extOf,
		languageFromPath: languageFromPath,
		contentKindFromPath: contentKindFromPath,
		describeToolCall: describeToolCall,
		toolCallDetail: toolCallDetail,
		toolUsageSummary: toolUsageSummary,
		toolGroupSummary: toolGroupSummary,
		toolTextPreview: toolTextPreview,
		renderTextPreview: renderTextPreview,
		renderNumberedCode: renderNumberedCode,
		renderSvgPreview: renderSvgPreview,
		renderCsvPreview: renderCsvPreview,
		renderHtmlPreview: renderHtmlPreview,
		stripScripts: stripScripts,
		renderToolOutput: renderToolOutput,
		mountToolPreview: mountToolPreview,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.toolPresent = api;
})();
