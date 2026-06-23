/**
 * md.js — zero-dependency Markdown → HTML parser.
 *
 * Contract: `md(markdownString)` returns an HTML string. Pure: no DOM, no
 * globals beyond `md` itself, no side effects. Loaded as a <script> BEFORE
 * app.js (which calls md(...)); also `require`-able in Node for unit tests —
 * that testability is the main reason it was extracted from the DOM-bound
 * app.js (whose top level touches `document`, so it can't be required).
 *
 * Output tags match the CSS (.bubble p/h1-6/ul/ol/li/blockquote/hr/a/table/
 * th/td/pre/code/strong/em/del/code) — don't change them without style.css.
 *
 * Robustness posture (this is a hand-rolled parser, so it leans hard on
 * defensive handling over CommonMark conformance):
 *   - Advance guarantee: every branch in every loop advances the cursor, so no
 *     input can stall (infinite-loop) or throw. Plain-text runs are batched.
 *   - Streaming-safe: unclosed fences / code spans / links render gracefully
 *     (as their partial form or literal text) so a half-received message looks
 *     like its final form instead of flashing raw markers.
 *   - XSS-safe: ALL dynamic text goes through esc(); link hrefs pass a scheme
 *     allowlist (http(s)/mailto/tel/ftp/relative) AND are esc()'d into the
 *     attribute, so javascript:/data: and quote-attribute-breakout can't land.
 *     Raw HTML is NOT passed through (assistant output is semi-trusted) — it is
 *     escaped, same as the parser this replaces.
 *   - Bounded: inline parsing recurses with a depth cap so pathological input
 *     (e.g. thousands of `*`) can't stack-overflow.
 *
 * esc() is ALSO exported (alongside md) as the single HTML-escaping source of
 * truth for the browser side — app.js drops its duplicate and uses this global.
 * It uses a module-scoped static entity map (no per-match allocation) and is
 * null-safe. One source of truth, no drift between the two modules.
 */
var md, esc;
(() => {
	// ---------- HTML escaping (project-wide source of truth) ----------
	// ponytail: module-scoped static map — no object/closure allocated per matched
	// char (the old app.js copy built a fresh {}/fn on every character). Null-safe:
	// esc(null) → "" (the app.js copy returned the literal "null"). The local name
	// is `escapeHtml` so it can assign the OUTER `esc` global below (a local
	// `function esc` would shadow it — see the expose block at the end).
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

	// ---------- URL handling (scheme allowlist + sanitize) ----------
	// ponytail: blocks javascript:/data:/vbscript: etc. Relative refs allowed.
	var OK_SCHEME = /^(https?:|mailto:|tel:|ftp:|\/|\.\/|\.\.\/|#|\?)/i;
	function cleanUrl(raw) {
		if (raw == null) return null;
		var u = String(raw).replace(/\s+/g, ""); // no whitespace (incl. newlines) in URLs
		if (!u) return null;
		if (!OK_SCHEME.test(u)) return null;
		return u;
	}

	// ---------- link reference definitions ([id]: url "title") ----------
	// ponytail: collected in a md() prepass (defs may appear anywhere in the doc).
	// Module-scoped + reset per md() call — JS is single-threaded so no race.
	// Hidden (blanked) from rendering so they don't surface as stray paragraphs.
	var DEFS = {};
	var DEF_RE =
		/^\[([^\]]+)\]:\s*(<[^>]*>|\S+)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*$/;
	function normLabel(s) {
		return String(s).trim().replace(/\s+/g, " ").toLowerCase();
	}

	// ---------- inline parsing (recursive descent, depth-bounded) ----------
	// Replaces the old sequential regex-replace inline parser, which couldn't
	// nest emphasis, only handled single-backtick code spans, and had no escape
	// handling. This scanner walks left→right and dispatches per construct.
	var MAX_INLINE_DEPTH = 40;

	function isWord(c) {
		return c != null && /[A-Za-z0-9_]/.test(c);
	}
	// length of a run of char `c` starting at i
	function runLen(s, i, c) {
		var n = 0,
			k = i;
		while (k < s.length && s[k] === c) {
			n++;
			k++;
		}
		return n;
	}

	// code span at backtick index i. Supports multi-backtick (`` x`y ``) so
	// interior backticks work. Returns {code,next} or null (unclosed → literal).
	function codeSpan(s, i) {
		var k = runLen(s, i, "`");
		if (!k) return null;
		var from = i + k;
		var j = from;
		while (j < s.length) {
			if (s[j] === "`") {
				var rk = runLen(s, j, "`");
				if (rk >= k) {
					var code = s.slice(from, j);
					// CommonMark: strip one leading + trailing space when both
					// present and the content isn't only spaces.
					if (
						code.length > 2 &&
						code[0] === " " &&
						code[code.length - 1] === " " &&
						code.trim()
					) {
						code = code.slice(1, -1);
					}
					return { code: code, next: j + rk };
				}
				j += rk;
			} else {
				j++;
			}
		}
		return null; // unclosed → caller emits a literal backtick (streaming-safe)
	}

	// can `c` open emphasis at i? `*` always; `_` only when left-flanking
	// (prev char isn't a word char) so snake_case stays literal.
	function canOpen(s, i, c) {
		if (c === "*") return true;
		return i === 0 || !isWord(s[i - 1]);
	}
	// can a run of `c` of length n ending-closing at i close emphasis? `*`
	// always; `_` only when right-flanking (char after the run isn't a word char).
	function canClose(s, i, c, n) {
		if (c === "*") return true;
		return i + n >= s.length || !isWord(s[i + n]);
	}

	// find a closing run of `c` of length >= minRun starting the scan at `from`.
	// skips backslash-escaped chars. Returns the run's start index or -1.
	function findClose(s, from, c, minRun) {
		var j = from;
		while (j < s.length) {
			if (s[j] === "\\") {
				j += 2;
				continue;
			}
			if (s[j] === c) {
				var rk = runLen(s, j, c);
				if (rk >= minRun && canClose(s, j, c, rk)) return j;
				j += rk;
			} else {
				j++;
			}
		}
		return -1;
	}
	// find an em closer: a single `c` (not part of a 2+ run) that's right-flanking.
	function findCloseEm(s, from, c) {
		var j = from;
		while (j < s.length) {
			if (s[j] === "\\") {
				j += 2;
				continue;
			}
			if (s[j] === c) {
				if (s[j + 1] === c) {
					j += 2;
					continue;
				} // belongs to a strong run
				if (canClose(s, j, c, 1)) return j;
				j++;
			} else {
				j++;
			}
		}
		return -1;
	}

	function inline(src, depth) {
		if (depth > MAX_INLINE_DEPTH) return escapeHtml(src);
		var out = "",
			plain = "",
			i = 0,
			n = src.length;
		function flush() {
			if (plain) {
				out += escapeHtml(plain);
				plain = "";
			}
		}
		while (i < n) {
			var c = src[i];

			// backslash escape: next char is literal
			if (c === "\\" && i + 1 < n) {
				plain += src[i + 1];
				i += 2;
				continue;
			}
			// code span
			if (c === "`") {
				var cs = codeSpan(src, i);
				if (cs) {
					flush();
					out += "<code>" + escapeHtml(cs.code) + "</code>";
					i = cs.next;
					continue;
				}
			}
			// strikethrough ~~…~~
			if (c === "~" && src[i + 1] === "~") {
				var dc = findClose(src, i + 2, "~", 2);
				if (dc > 0) {
					flush();
					out += "<del>" + inline(src.slice(i + 2, dc), depth + 1) + "</del>";
					i = dc + 2;
					continue;
				}
			}
			// strong **…** / __…__  (also ***…*** → em-inside-strong)
			if ((c === "*" || c === "_") && src[i + 1] === c && canOpen(src, i, c)) {
				var sc = findClose(src, i + 2, c, 2);
				if (sc > 0) {
					flush();
					// ***…*** : both opener and closer have a spare delimiter → peel
					// one from each side and wrap em inside strong (bold-italic).
					if (src[i + 2] === c && src[sc + 2] === c) {
						out +=
							"<strong><em>" +
							inline(src.slice(i + 3, sc), depth + 1) +
							"</em></strong>";
						i = sc + 3;
					} else {
						out +=
							"<strong>" +
							inline(src.slice(i + 2, sc), depth + 1) +
							"</strong>";
						i = sc + 2;
					}
					continue;
				}
			}
			// em *…* / _…_
			if ((c === "*" || c === "_") && canOpen(src, i, c)) {
				var ec = findCloseEm(src, i + 1, c);
				if (ec > 0) {
					flush();
					out += "<em>" + inline(src.slice(i + 1, ec), depth + 1) + "</em>";
					i = ec + 1;
					continue;
				}
			}
			// link [text](url "title")
			if (c === "[") {
				var lk = link(src, i, depth);
				if (lk) {
					flush();
					out += lk.html;
					i = lk.next;
					continue;
				}
			}
			// autolink <scheme:…> / <email>
			if (c === "<") {
				var al = autolink(src, i);
				if (al) {
					flush();
					out += al.html;
					i = al.next;
					continue;
				}
			}
			// plain text (batched for performance on long messages)
			plain += c;
			i++;
		}
		flush();
		return out;
	}

	// Build an <a> for a resolved (url, title, text). Shared by inline + ref links.
	function anchor(url, title, text, depth) {
		return (
			'<a href="' +
			escapeHtml(url) +
			'" target="_blank" rel="noopener noreferrer"' +
			(title ? ' title="' + escapeHtml(title) + '"' : "") +
			">" +
			inline(text, depth) +
			"</a>"
		);
	}

	// [text](url) / [text](url "title") / [text][id] / [text][] / [text]. Allows
	// one level of nested brackets in the text. Unclosed or unknown ref → null
	// (literal). Inline url uses balanced () so URLs containing parens survive.
	function link(s, i, depth) {
		var j = i + 1,
			depthb = 1,
			textEnd = -1;
		while (j < s.length) {
			if (s[j] === "\\") {
				j += 2;
				continue;
			}
			if (s[j] === "[") depthb++;
			else if (s[j] === "]") {
				depthb--;
				if (depthb === 0) {
					textEnd = j;
					break;
				}
			}
			j++;
		}
		if (textEnd < 0) return null;
		var text = s.slice(i + 1, textEnd);

		// inline link [text](url …): balanced-paren scan so a URL with its own
		// parens (e.g. wiki/Foo_(bar)) isn't truncated at the first ')'.
		if (s[textEnd + 1] === "(") {
			var d = 1,
				p = textEnd + 2,
				close = -1;
			while (p < s.length) {
				if (s[p] === "(") d++;
				else if (s[p] === ")") {
					d--;
					if (d === 0) {
						close = p;
						break;
					}
				}
				p++;
			}
			if (close < 0) return null; // unclosed → not a link (streaming-safe)
			var inner = s.slice(textEnd + 2, close);
			var tm = inner.match(/^\s*(\S*)\s*("([^"]*)"|'([^']*)')?\s*$/);
			if (!tm) return null;
			var url = tm[1];
			var title = tm[3] != null ? tm[3] : tm[4] != null ? tm[4] : null;
			var cu = cleanUrl(url);
			if (cu == null) return { html: inline(text, depth), next: close + 1 };
			return { html: anchor(cu, title, text, depth), next: close + 1 };
		}

		// reference link [text][id] / [text][] / shortcut [text]. Unknown id →
		// null (renders literally), matching CommonMark.
		var id,
			after = textEnd + 1;
		if (s[after] === "[") {
			var rb = s.indexOf("]", after + 1);
			if (rb < 0) return null;
			id = rb === after + 1 ? text : s.slice(after + 1, rb); // [] → reuse text
			after = rb;
		} else {
			id = text;
		}
		var def = DEFS[normLabel(id)];
		if (!def) return null;
		return { html: anchor(def.url, def.title, text, depth), next: after + 1 };
	}

	// <scheme:path> or <user@host.tld>. Bare '<' stays an escaped literal.
	var AUTOLINK_RE =
		/^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]+|[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+)>/;
	function autolink(s, i) {
		if (s[i] !== "<") return null;
		var m = s.slice(i).match(AUTOLINK_RE);
		if (!m) return null;
		var dest = m[1];
		var cu;
		if (dest.indexOf("@") > 0 && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(dest)) {
			cu = "mailto:" + dest; // bare email → mailto
		} else {
			cu = cleanUrl(dest);
		}
		if (cu == null) return null;
		return {
			html:
				'<a href="' +
				escapeHtml(cu) +
				'" target="_blank" rel="noopener noreferrer">' +
				escapeHtml(dest) +
				"</a>",
			next: i + m[0].length,
		};
	}

	// ---------- block parsing ----------
	function indentOf(line) {
		var m = /^(\s*)/.exec(line);
		return m ? m[1].replace(/\t/g, "    ").length : 0;
	}
	function isBlank(l) {
		return /^\s*$/.test(l);
	}

	var HR_RE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
	// heading START (strict: needs a space or EOL after the #'s) — used for both
	// heading detection and the paragraph-gathering guard, so "#foo" stays prose.
	var HEADING_START_RE = /^ {0,3}#{1,6}(?:\s|$)/;
	var SETEXT_UNDER_RE = /^ {0,3}(=+|-{2,})\s*$/;
	var FENCE_OPEN_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

	function fenceOpen(line) {
		var m = FENCE_OPEN_RE.exec(line);
		if (!m) return null;
		var lang = (m[3] || "").trim().split(/\s+/)[0] || "";
		return { char: m[2][0], len: m[2].length, lang: lang };
	}
	function fenceClose(line, open) {
		var m = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(line);
		if (!m || m[2][0] !== open.char || m[2].length < open.len) return false;
		return true;
	}

	function splitRow(line) {
		return line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((c) => c.trim());
	}
	function alignOf(cell) {
		var a = cell.trim();
		var left = a[0] === ":";
		var right = a[a.length - 1] === ":";
		if (left && right) return "center";
		if (right) return "right";
		if (left) return "left";
		return null;
	}
	// a valid GFM table here: current line has a pipe AND the next line is a
	// separator row (|, -, :). Returns the per-column alignments or null.
	var SEP_RE = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/;
	var SEP_RE_SINGLE = /^\s*\|?\s*:?-+:?\s*\|?\s*$/;
	function looksLikeTable(lines, i) {
		if (!/\|/.test(lines[i])) return null;
		var sep = lines[i + 1];
		if (sep == null) return null;
		if (!(SEP_RE.test(sep) || SEP_RE_SINGLE.test(sep))) return null;
		return splitRow(sep).map(alignOf);
	}

	function cellTag(tag, content, align) {
		var style = align ? ' style="text-align:' + align + '"' : "";
		return "<" + tag + style + ">" + inline(content) + "</" + tag + ">";
	}

	// ---- lists ----
	var UL_RE = /^(\s*)([-*+])([ \t]+)/;
	var OL_RE = /^(\s*)(\d+)([.)])([ \t]+)/;
	var TASK_RE = /^\[([ xX])\][ \t]+/;

	function isMarkerLine(line) {
		if (isBlank(line)) return false;
		return UL_RE.test(line) || OL_RE.test(line);
	}
	function matchMarker(line) {
		var m = UL_RE.exec(line) || OL_RE.exec(line);
		if (!m) return null;
		var ordered = /\d/.test(m[2][0]);
		var indent = m[1].replace(/\t/g, "    ").length;
		return {
			ordered: ordered,
			indent: indent,
			text: line.slice(m[0].length),
			num: ordered ? +m[2] : null,
		};
	}
	// remove up to `count` leading columns (spaces; tabs count as 4) — used to
	// dedent nested list content before recursing into mdProse.
	function dedent(line, count) {
		var seen = 0,
			out = "";
		for (var k = 0; k < line.length; k++) {
			var ch = line[k];
			if (seen >= count) {
				out = line.slice(k);
				break;
			}
			if (ch === " ") {
				seen++;
			} else if (ch === "\t") {
				seen += 4;
			} else {
				out = line.slice(k);
				break;
			}
		}
		return out;
	}

	// collect a contiguous list region (markers, nested/indented lines, and
	// blank lines that are still inside the list) starting at a marker line.
	function collectListRegion(lines, start) {
		var baseIndent = matchMarker(lines[start]).indent;
		var region = [];
		var i = start;
		while (i < lines.length) {
			var l = lines[i];
			if (isBlank(l)) {
				var next = lines[i + 1];
				if (
					next != null &&
					(isMarkerLine(next) || indentOf(next) > baseIndent)
				) {
					region.push(l);
					i++;
					continue;
				}
				break;
			}
			if (isMarkerLine(l) || indentOf(l) > baseIndent) {
				region.push(l);
				i++;
				continue;
			}
			break;
		}
		return region;
	}

	function parseList(region) {
		var first = matchMarker(region[0]);
		var baseIndent = first.indent;
		var ordered = first.ordered;
		var startAttr =
			ordered && first.num !== 1 ? ' start="' + first.num + '"' : "";
		var html = "<" + (ordered ? "ol" : "ul") + startAttr + ">";
		var i = 0;
		while (i < region.length) {
			var l = region[i];
			if (isBlank(l)) {
				i++;
				continue;
			}
			var mk = matchMarker(l);
			if (!mk) {
				i++;
				continue;
			} // safety: always advance
			var head = mk.text;
			var nested = [];
			var tm = TASK_RE.exec(head);
			var done = tm ? tm[1] === "x" || tm[1] === "X" : null;
			if (tm) head = head.slice(tm[0].length);
			i++;
			while (i < region.length) {
				var l2 = region[i];
				if (isBlank(l2)) {
					var nx = region[i + 1];
					if (nx != null && (isMarkerLine(nx) || indentOf(nx) > baseIndent)) {
						nested.push("");
						i++;
						continue;
					}
					break;
				}
				if (indentOf(l2) > baseIndent) {
					nested.push(dedent(l2, baseIndent + 2));
					i++;
					continue;
				} // nested content
				break; // sibling marker / end of item
			}
			var inner =
				inline(head) + (nested.length ? mdProse(nested.join("\n")) : "");
			html +=
				"<li>" +
				(done === true ? "☒ " : done === false ? "☐ " : "") +
				inner +
				"</li>";
		}
		html += "</" + (ordered ? "ol" : "ul") + ">";
		return html;
	}

	// ---- prose blocks ----
	function mdProse(src) {
		var lines = String(src == null ? "" : src).split("\n");
		var out = [];
		var i = 0,
			n = lines.length;
		while (i < n) {
			var line = lines[i];

			if (isBlank(line)) {
				i++;
				continue;
			}

			// fenced code block (handled here, not just at top level, so a fence
			// indented inside a list item stays in its <li> instead of being
			// ripped out as a sibling block).
			var open = fenceOpen(line);
			if (open) {
				var j = i + 1;
				while (j < n && !fenceClose(lines[j], open)) j++;
				var closed = j < n;
				var code = lines.slice(i + 1, closed ? j : n).join("\n");
				if (code && code[code.length - 1] === "\n") code = code.slice(0, -1);
				var cls = open.lang
					? ' class="language-' + escapeHtml(open.lang) + '"'
					: "";
				// unclosed fence (streaming) → render the partial code as a <pre>,
				// identical to its closed form, and consume to end.
				out.push("<pre><code" + cls + ">" + escapeHtml(code) + "</code></pre>");
				i = closed ? j + 1 : n;
				continue;
			}

			// indented code block (4+ spaces). Only at a block boundary (after a
			// blank line / BOF) so it doesn't eat lazy paragraph continuation or
			// lines already claimed by a list region (those advance past i).
			if ((i === 0 || isBlank(lines[i - 1])) && indentOf(line) >= 4) {
				var cl = [];
				while (i < n) {
					var ln = lines[i];
					if (isBlank(ln)) {
						cl.push(ln);
						i++;
						continue;
					}
					if (indentOf(ln) >= 4) {
						cl.push(dedent(ln, 4));
						i++;
						continue;
					}
					break;
				}
				while (cl.length && isBlank(cl[cl.length - 1])) cl.pop();
				out.push("<pre><code>" + escapeHtml(cl.join("\n")) + "</code></pre>");
				continue;
			}

			// ATX heading (# … ######)
			if (HEADING_START_RE.test(line)) {
				var hm = /^ {0,3}(#{1,6})\s*(.*?)(?:\s+#+\s*)?$/.exec(line);
				var lvl = hm ? hm[1].length : 1;
				var htext = hm ? hm[2] : "";
				out.push("<h" + lvl + ">" + inline(htext) + "</h" + lvl + ">");
				i++;
				continue;
			}

			// horizontal rule
			if (HR_RE.test(line)) {
				out.push("<hr>");
				i++;
				continue;
			}

			// blockquote (consecutive > lines, strip marker, recurse)
			if (/^ {0,3}>/.test(line)) {
				var buf = [];
				while (i < n && /^ {0,3}>/.test(lines[i])) {
					buf.push(lines[i].replace(/^ {0,3}>[ ]?/, ""));
					i++;
				}
				out.push("<blockquote>" + mdProse(buf.join("\n")) + "</blockquote>");
				continue;
			}

			// GFM table
			var aligns = looksLikeTable(lines, i);
			if (aligns) {
				var header = splitRow(line);
				i += 2;
				var rows = [];
				while (i < n && !isBlank(lines[i]) && /\|/.test(lines[i])) {
					rows.push(splitRow(lines[i]));
					i++;
				}
				var th = header.map((h, idx) => cellTag("th", h, aligns[idx])).join("");
				var trs = rows
					.map(
						(r) =>
							"<tr>" +
							r.map((c, idx) => cellTag("td", c, aligns[idx])).join("") +
							"</tr>",
					)
					.join("");
				out.push(
					"<table><thead><tr>" +
						th +
						"</tr></thead><tbody>" +
						trs +
						"</tbody></table>",
				);
				continue;
			}

			// list
			if (isMarkerLine(line)) {
				var region = collectListRegion(lines, i);
				out.push(parseList(region));
				i += region.length;
				continue;
			}

			// paragraph (also resolves setext headings). Gathers until a blank
			// line or the start of another block; a stray `|` does NOT break a
			// paragraph (only a real table separator would have made it a table).
			var pbuf = [];
			while (
				i < n &&
				!isBlank(lines[i]) &&
				!HEADING_START_RE.test(lines[i]) &&
				!HR_RE.test(lines[i]) &&
				!SETEXT_UNDER_RE.test(lines[i]) &&
				!/^ {0,3}>/.test(lines[i]) &&
				!isMarkerLine(lines[i]) &&
				!fenceOpen(lines[i])
			) {
				pbuf.push(lines[i]);
				i++;
			}
			if (pbuf.length) {
				if (i < n && SETEXT_UNDER_RE.test(lines[i])) {
					var under = SETEXT_UNDER_RE.exec(lines[i])[1];
					var slvl = under[0] === "=" ? 1 : 2;
					out.push(
						"<h" + slvl + ">" + inline(pbuf.join(" ")) + "</h" + slvl + ">",
					);
					i++;
				} else {
					// soft line breaks within a paragraph → <br> (preserves prior
					// rendering behavior; \n can't survive inside emitted tags)
					out.push(
						"<p>" + inline(pbuf.join("\n")).replace(/\n/g, "<br>") + "</p>",
					);
				}
				continue;
			}

			// advance guarantee: nothing above consumed this line — render it as
			// its own paragraph and move on (can't stall, can't throw).
			out.push("<p>" + inline(line) + "</p>");
			i++;
		}
		return out.join("");
	}

	// ---------- top level: link-def prepass, then mdProse (which owns fences) ----------
	md = function md(text) {
		var src = String(text == null ? "" : text);
		if (!src) return "";
		DEFS = {};
		var lines = src.split("\n");
		// Collect link reference definitions, fence/indent-aware (a [id]: url
		// inside a code block is literal, not a def). Defs may sit anywhere in
		// the doc; blank their lines so they don't render as stray paragraphs.
		var inFence = false,
			fenceInfo = null;
		for (var k = 0; k < lines.length; k++) {
			var lk = lines[k];
			if (inFence) {
				if (fenceClose(lk, fenceInfo)) inFence = false;
				continue;
			}
			var fo = fenceOpen(lk);
			if (fo) {
				inFence = true;
				fenceInfo = fo;
				continue;
			}
			if (indentOf(lk) >= 4) continue; // indented code: literal
			var dm = DEF_RE.exec(lk);
			if (dm) {
				var url = dm[2];
				if (url.charAt(0) === "<" && url.charAt(url.length - 1) === ">")
					url = url.slice(1, -1);
				if (cleanUrl(url) == null) continue;
				DEFS[normLabel(dm[1])] = {
					url: url,
					title: dm[3] != null ? dm[3] : dm[4] != null ? dm[4] : null,
				};
				lines[k] = "";
			}
		}
		return mdProse(lines.join("\n"));
	};

	// expose esc as a global, parallel to md. app.js (and any later browser
	// module) uses it as the single HTML-escaping source of truth — no duplicate.
	esc = escapeHtml;
	if (typeof module !== "undefined" && module.exports)
		module.exports = { md: md, esc: esc };
})();
