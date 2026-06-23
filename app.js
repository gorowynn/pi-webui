const $ = (id) => document.getElementById(id);
const transcript = $("transcript");
const inputEl = $("input");
const sendBtn = $("send");
const stopBtn = $("stop");
const compactBtn = $("compact");
const modeSel = $("mode");
const modelSel = $("model");
const dot = $("dot");
const statusText = $("status-text");
const activityEl = $("activity");
const actLabel = $("act-label");

let streaming = false;
let commands = []; // [{name, description, source}]
const toolBlocks = new Map(); // toolCallId -> {head, out}
let cur = null; // {bubble, textPar, textBuf, thinkEl, thinkBuf}
// ponytail: the tool currently awaiting/under a permission prompt. Set at
// tool_execution_start (which fires immediately before THIS tool's safeguard
// select, even in parallel mode — preparation is sequential) and read by
// renderEditDiffPreviews so the permission modal shows THIS tool's diff, not
// every edit/write streamed this turn. An earlier tool's select would
// otherwise drain an accumulated list and starve later ones (the write bug).
let curToolName = null;
let curToolArgs = null;

function api(obj) {
	const p = fetch("/api/cmd", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(obj),
	});
	// ponytail: mark the rejection handled so fire-and-forget callers
	// (refreshStats, init, UI buttons) don't log unhandled rejections on a
	// transient blip; the SSE channel re-syncs state. Awaited callers still
	// receive the rejection (a second handler on the same promise).
	p.catch(() => {});
	return p;
}
// ponytail: pi sends ANSI-colored status strings (e.g. "LSP Inactive"); the
// browser can't render them, so strip the escapes at the status boundary.
const stripAnsi = (s) => String(s).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");

function esc(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
}

// ---- markdown: fenced code, headings, lists, tables, blockquotes, hr, links ----
// ponytail: zero-dep inline parser. Block-level split (code vs prose), then
// per-line block detection, then inline formatting with code-span protection
// (placeholders so ** / * never touch code contents).
function inlineMd(sEsc) {
	const codes = [];
	let s = sEsc.replace(
		/`([^`]+)`/g,
		(_, c) => (codes.push(c), `\u0000${codes.length - 1}\u0000`),
	);
	s = s
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
		.replace(/~~([^~]+)~~/g, "<del>$1</del>")
		.replace(
			/\[([^\]]+)\]\(([^)\s]+)(?: +"([^"]*)")?\)/g,
			// ponytail: allow only http(s)/mailto/relative refs — assistant
			// output is semi-trusted; block javascript:/data: link schemes.
			(_m, t, url, title) =>
				/^(https?:|mailto:|#|\/|\?)/.test(url)
					? `<a href="${url}" target="_blank" rel="noopener noreferrer"${title ? ` title="${title}"` : ""}>${t}</a>`
					: t,
		);
	return s.replace(
		/\u0000(\d+)\u0000/g,
		(_, i) => "<code>" + codes[+i] + "</code>",
	);
}
function splitRow(line) {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((c) => c.trim());
}
function mdProse(src) {
	const lines = src.split("\n");
	const out = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}
		const m = /^(#{1,6})\s+(.*)$/.exec(line);
		if (m) {
			out.push(`<h${m[1].length}>${inlineMd(esc(m[2]))}</h${m[1].length}>`);
			i++;
			continue;
		}
		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			out.push("<hr>");
			i++;
			continue;
		}
		if (/^>\s?/.test(line)) {
			const buf = [];
			while (i < lines.length && /^>\s?/.test(lines[i])) {
				buf.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			out.push(`<blockquote>${mdProse(buf.join("\n"))}</blockquote>`);
			continue;
		}
		// table: header row + next line is a separator of |, -, :
		if (
			/\|/.test(line) &&
			i + 1 < lines.length &&
			/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
			/\|/.test(lines[i + 1])
		) {
			const header = splitRow(line);
			i += 2;
			const rows = [];
			while (i < lines.length && /\|/.test(lines[i])) {
				rows.push(splitRow(lines[i]));
				i++;
			}
			const th = header.map((h) => `<th>${inlineMd(esc(h))}</th>`).join("");
			const trs = rows
				.map(
					(r) =>
						`<tr>${r.map((c) => `<td>${inlineMd(esc(c))}</td>`).join("")}</tr>`,
				)
				.join("");
			out.push(
				`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`,
			);
			continue;
		}
		if (/^\s*[-*+]\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
				i++;
			}
			out.push(
				"<ul>" +
					items.map((it) => `<li>${inlineMd(esc(it))}</li>`).join("") +
					"</ul>",
			);
			continue;
		}
		if (/^\s*\d+\.\s+/.test(line)) {
			const items = [];
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
				i++;
			}
			out.push(
				"<ol>" +
					items.map((it) => `<li>${inlineMd(esc(it))}</li>`).join("") +
					"</ol>",
			);
			continue;
		}
		// paragraph: gather until blank/special/pipe
		const buf = [];
		while (
			i < lines.length &&
			lines[i].trim() &&
			!/^(#{1,6}\s|>\s?|\s*[-*+]\s|\s*\d+\.\s|\s*(-{3,}|\*{3,}|_{3,})\s*$)/.test(
				lines[i],
			) &&
			!/\|/.test(lines[i])
		) {
			buf.push(lines[i]);
			i++;
		}
		if (buf.length) {
			out.push(
				`<p>${inlineMd(esc(buf.join("\n"))).replace(/\n/g, "<br>")}</p>`,
			);
		} else {
			// ponytail: unhandled single line (e.g. a stray `|` that isn't a
			// table row, since the table branch above already consumed valid
			// tables). Render it as its own paragraph so i always advances —
			// without this the outer while spins forever on a pipe line and
			// freezes the tab.
			out.push(`<p>${inlineMd(esc(lines[i]))}</p>`);
			i++;
		}
	}
	return out.join("");
}
function md(text) {
	const src = String(text == null ? "" : text);
	if (!src) return "";
	// split on CLOSED fenced code blocks; matched ```...``` pairs are captured
	// by the regex. Any other ``` surviving into a prose segment is an
	// UNCLOSED fence from a still-streaming message -- handled below so the
	// live render matches the final post-reload render instead of flashing
	// raw fence markers + code-as-prose until the closer arrives.
	const segs = src.split(/(```[\s\S]*?```)/g);
	let html = "";
	for (let k = 0; k < segs.length; k++) {
		const seg = segs[k];
		if (!seg) continue;
		if (seg.startsWith("```") && seg.endsWith("```")) {
			// closed fence: slice off both ``` delimiters (slice(3, -3)). The
			// old slice(3) + replace(/\n$/) left the closing ``` inside the
			// code block as a stray trailing line.
			const body = seg.slice(3, -3);
			const nl = body.indexOf("\n");
			const lang = (nl >= 0 ? body.slice(0, nl) : "").trim();
			const code = nl >= 0 ? body.slice(nl + 1) : "";
			const cls = lang ? ` class="language-${esc(lang)}"` : "";
			html += `<pre><code${cls}>${esc(code.replace(/\n$/, ""))}</code></pre>`;
			continue;
		}
		const open = seg.indexOf("```");
		if (open >= 0) {
			// unclosed fence (streaming): render prose before it, then the
			// partial code as an open <pre> identical to its closed form.
			html += mdProse(seg.slice(0, open));
			const body = seg.slice(open + 3);
			const nl = body.indexOf("\n");
			const lang = (nl >= 0 ? body.slice(0, nl) : "").trim();
			const code = nl >= 0 ? body.slice(nl + 1) : "";
			const cls = lang ? ` class="language-${esc(lang)}"` : "";
			html += `<pre><code${cls}>${esc(code.replace(/\n$/, ""))}</code></pre>`;
		} else {
			html += mdProse(seg);
		}
	}
	return html;
}

function nearBottom() {
	return (
		transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight <
		120
	);
}
function scrollDown() {
	transcript.scrollTop = transcript.scrollHeight;
}
// ponytail: follow new output unless the user scrolled up to read.
let pinned = true;
transcript.addEventListener("scroll", () => {
	pinned = nearBottom();
});
function autoscroll() {
	if (pinned) scrollDown();
}

function addUser(text) {
	const m = document.createElement("div");
	m.className = "msg";
	m.innerHTML = `<div class="bubble user"><div class="role you">you</div></div>`;
	const b = m.querySelector(".user");
	const span = document.createElement("div");
	span.innerHTML = md(text);
	b.appendChild(span);
	transcript.appendChild(m);
	pinned = true;
	scrollDown();
}
// ponytail: render an extension `notify` payload as a real assistant
// message in the transcript (markdown-formatted). Used for substantial /
// multi-line notify content -- e.g. the ctx-stats skill dumps a full
// markdown table via notify, which a 4-second corner toast can't hold.
// Built standalone: it does NOT touch the global `cur`, so it's safe to
// call mid-stream without hijacking the in-progress assistant bubble.
function addAssistantText(text) {
	const m = document.createElement("div");
	m.className = "msg";
	m.innerHTML = `<div class="bubble"><div class="role">assistant</div></div>`;
	const p = document.createElement("div");
	p.innerHTML = md(text);
	m.querySelector(".bubble").appendChild(p);
	transcript.appendChild(m);
	scrollDown();
}

function newAssistantBubble() {
	const m = document.createElement("div");
	m.className = "msg";
	m.innerHTML = `<div class="bubble"><div class="role">assistant</div></div>`;
	transcript.appendChild(m);
	cur = {
		bubble: m.querySelector(".bubble"),
		textPar: null,
		textBuf: "",
		thinkEl: null,
		thinkDetails: null,
		thinkLabel: null,
		thinkCount: null,
		thinkBuf: "",
	};
	return cur;
}

function ensureTextPar() {
	if (!cur || cur.textPar) return;
	const p = document.createElement("div");
	cur.bubble.appendChild(p);
	cur.textPar = p;
}
function renderText() {
	if (cur && cur.textPar) {
		cur.textPar.innerHTML = md(cur.textBuf);
		autoscroll();
	}
}
// ponytail: thinking-block lifecycle. The <details> carries its own
// state: the .thinking class swaps the summary indicator from caret to
// spinner and drives a small live character count (so a collapsed trace
// still shows it's alive). The body is painted ONLY when the block is
// open or being finalized — rewriting a tens-of-KB pre-wrap node the
// user can't see is pure layout thrash and freezes the tab on long
// reasoning traces. The latest buffer is mirrored onto the element
// (d.__buf) so the toggle handler can paint lazily on open even after
// cur has moved on.
function ensureThink(active) {
	if (!cur || cur.thinkEl) return;
	const d = document.createElement("details");
	d.className = "think" + (active ? " thinking" : "");
	d.innerHTML =
		`<summary><span class="tspin"></span><span class="tcaret">▸</span>` +
		`<span class="tlabel">${active ? "thinking" : "thoughts"}</span>` +
		`<span class="tcount"></span></summary><div class="tbody"></div>`;
	const body = d.querySelector(".tbody");
	cur.bubble.appendChild(d);
	cur.thinkEl = body;
	cur.thinkDetails = d;
	cur.thinkLabel = d.querySelector(".tlabel");
	cur.thinkCount = d.querySelector(".tcount");
	// opened a collapsed trace — paint whatever we have right now (the
	// streaming path skips body paints while closed).
	d.addEventListener("toggle", () => {
		if (d.open) body.textContent = d.__buf || body.textContent || "";
	});
}
function finalizeThink() {
	if (!cur || !cur.thinkDetails) return;
	cur.thinkDetails.classList.remove("thinking");
	if (cur.thinkLabel) cur.thinkLabel.textContent = "thoughts";
	if (cur.thinkCount) cur.thinkCount.textContent = "";
}
// ponytail: throttle thinking paints to ~3/s while streaming. A long
// reasoning trace can be tens of KB; rewriting textContent every rAF
// forces a full layout+paint of a giant pre-wrap block each frame and
// freezes the tab. force=true bypasses the throttle for the immediate
// final paint on thinking_end / message_end.
let lastThinkPaint = 0;
function renderThink(force) {
	if (!cur || !cur.thinkEl || !cur.thinkDetails) return;
	const now = performance.now();
	const throttled = !force && now - lastThinkPaint < 300;
	const buf = cur.thinkBuf;
	// always remember the buffer on the node so opening a collapsed trace
	// (live or historical) can paint without cur still being valid.
	cur.thinkDetails.__buf = buf;
	// cheap progress tick on the summary — only while streaming
	if (
		!throttled &&
		cur.thinkCount &&
		cur.thinkDetails.classList.contains("thinking")
	) {
		cur.thinkCount.textContent = buf.length
			? `${(buf.length / 1000).toFixed(1)}k`
			: "";
	}
	if (throttled) return;
	lastThinkPaint = now;
	// expensive body paint only when visible or finalizing
	if (force || cur.thinkDetails.open) {
		cur.thinkEl.textContent = buf;
		autoscroll();
	}
}
// ponytail: coalesce per-token paints to one rAF. md() parses the whole
// buffer each call, so per-token renderText is O(n²) and freezes long
// answers. Delta handlers schedule; _end/finalize paths still render
// directly for an immediate final paint.
let renderRaf = 0;
function scheduleRender() {
	if (renderRaf) return;
	renderRaf = requestAnimationFrame(() => {
		renderRaf = 0;
		renderText(); // both no-op unless their buffer/element exists
		renderThink();
	});
}

function addToolCall(name, args) {
	if (!cur) newAssistantBubble();
	const line = document.createElement("div");
	line.style.margin = "4px 0";
	const a = args
		? (() => {
				try {
					return JSON.stringify(args);
				} catch {
					return "";
				}
			})()
		: "";
	line.innerHTML = `<span style="color:var(--accent)">▸ ${esc(name || "tool")}</span> <code>${esc(a)}</code>`;
	cur.bubble.appendChild(line);
	autoscroll();
}

function toolBlock(id, name, args, running) {
	let wrap = toolBlocks.get(id);
	if (!wrap) {
		const el = document.createElement("details");
		el.className = "tool" + (running ? " run" : "");
		if (running) el.open = true;
		const a = args ? JSON.stringify(args) : "";
		el.innerHTML = `<summary class="head"><span class="caret">▸</span><span class="name">${esc(name || "tool")}</span> <code>${esc(a)}</code></summary><div class="out"></div>`;
		transcript.appendChild(el);
		wrap = { el, out: el.querySelector(".out") };
		toolBlocks.set(id, wrap);
	}
	if (args != null) wrap.args = args;
	autoscroll();
	return wrap;
}

// ---- edit diff: LCS line diff from oldText/newText args ----
// ponytail: O(n*m) Uint32Array DP table. Fine for typical edits; swap for
// Myers if huge files start lagging the UI.
function diffLines(a, b) {
	const A = a == null || a === "" ? [] : String(a).split("\n");
	const B = b == null || b === "" ? [] : String(b).split("\n");
	const n = A.length,
		m = B.length;
	const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] =
				A[i] === B[j]
					? dp[i + 1][j + 1] + 1
					: Math.max(dp[i + 1][j], dp[i][j + 1]);
	const res = [];
	let i = 0,
		j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			res.push({ t: "ctx", s: A[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			res.push({ t: "del", s: A[i] });
			i++;
		} else {
			res.push({ t: "add", s: B[j] });
			j++;
		}
	}
	while (i < n) {
		res.push({ t: "del", s: A[i] });
		i++;
	}
	while (j < m) {
		res.push({ t: "add", s: B[j] });
		j++;
	}
	return res;
}
// ---- edit diff: side-by-side, new pane editable + live re-highlight ----
// diffRows: align the LCS token stream into paired left/right rows so
// both columns share exactly one row per line. A contiguous change run
// (dels then adds) is zipped into rows: matched del+add = 'mod' (shows
// old on the left, new on the right); a lone del/add leaves the opposite
// side null (rendered as an empty placeholder so the row still exists).
function diffRows(a, b) {
	const toks = diffLines(a, b);
	const rows = [];
	let i = 0;
	while (i < toks.length) {
		if (toks[i].t === "ctx") {
			rows.push({ kind: "ctx", left: toks[i].s, right: toks[i].s });
			i++;
		} else {
			const dels = [],
				adds = [];
			while (i < toks.length && toks[i].t !== "ctx") {
				if (toks[i].t === "del") dels.push(toks[i].s);
				else adds.push(toks[i].s);
				i++;
			}
			const n = Math.max(dels.length, adds.length);
			for (let k = 0; k < n; k++) {
				const d = dels[k],
					a2 = adds[k];
				rows.push({
					kind: d != null && a2 != null ? "mod" : d != null ? "del" : "add",
					left: d != null ? d : null,
					right: a2 != null ? a2 : null,
				});
			}
		}
	}
	return rows;
}
function rowsToSides(rows) {
	const left = [],
		right = [];
	let on = 0, // old file line counter
		nn = 0; // new file line counter
	rows.forEach((r) => {
		if (r.kind === "ctx") {
			left.push({ s: r.left, cls: "ln-ctx", num: ++on });
			right.push({ s: r.right, cls: "ln-ctx", num: ++nn });
		} else if (r.kind === "del") {
			left.push({ s: r.left, cls: "ln-del", num: ++on });
			right.push({ s: null, cls: "ln-empty", num: null });
		} else if (r.kind === "add") {
			left.push({ s: null, cls: "ln-empty", num: null });
			right.push({ s: r.right, cls: "ln-add", num: ++nn });
		} else {
			left.push({ s: r.left, cls: "ln-del", num: ++on });
			right.push({ s: r.right, cls: "ln-add", num: ++nn });
		}
	});
	return { left, right, maxNum: Math.max(on, nn) };
}
function sideHtml(lines) {
	return lines
		.map((l) => {
			const num = l.num == null ? "\u00a0" : String(l.num);
			const txt = l.s == null || l.s === "" ? "\u00a0" : esc(l.s);
			return `<span class="sx-line ${l.cls}"><span class="sx-gnum">${num}</span><span class="sx-ltxt">${txt}</span></span>`;
		})
		.join("");
}
function gutterCh(maxNum) {
	const digits = String(Math.max(maxNum || 1, 1)).length;
	return (digits < 2 ? 2 : digits) + "ch";
}
// ponytail: recover the hunk's real line offset from the file on disk so the
// gutter shows actual file line numbers instead of restarting at 1 per hunk.
// Pre-apply (permission modal) the file still has oldText; post-apply
// (transcript) it has newText -- try oldText then newText. Best-effort: any
// miss (file gone, hunk shifted, giant plainSide fallback) silently keeps the
// 1-based default. One local read per hunk; cache it only if this shows up
// in a profile.
function findStartLine(path, oldText, newText) {
	if (!path) return Promise.resolve(null);
	return fetch("/api/file?path=" + encodeURIComponent(path))
		.then((r) => r.json())
		.then((j) => {
			if (!j || !j.ok || j.content == null) return null;
			const c = j.content;
			for (const needle of [oldText, newText]) {
				if (!needle) continue;
				const idx = c.indexOf(needle);
				if (idx >= 0) return c.slice(0, idx).split("\n").length;
			}
			return null;
		})
		.catch(() => null);
}
// mountSideBySide: builds old | new into `host`. opt.readOnly renders two
// read-only scroll-synced columns (for the permission modal); otherwise
// the new pane is an editable transparent textarea layered over a colored
// body, with live re-highlight and an Apply button. Scrolling is synced
// across every column (vertical + horizontal); gutters are sticky so line
// numbers stay pinned during horizontal scroll.
function mountSideBySide(host, path, oldText, newText, isWrite, opt) {
	const ro = !!(opt && opt.readOnly);
	const baseOld = oldText == null ? "" : String(oldText);
	const baseNew = newText == null ? "" : String(newText);
	// ponytail: diffLines is O(n*m) with a full Uint32Array — a 10k×10k edit
	// is ~400MB and a frozen tab. Above this product skip the LCS and render
	// plain old|new text (same DOM shape, neutral coloring, still usable).
	const DIFF_CELL_LIMIT = 4_000_000;
	const plainSide = (txt) =>
		(txt ? txt.split("\n") : [""])
			.map(
				(s, i) =>
					`<span class="sx-line ln-ctx"><span class="sx-gnum">${i + 1}</span><span class="sx-ltxt">${esc(s === "" ? "\u00a0" : s)}</span></span>`,
			)
			.join("");
	const compute = (o, n) => {
		const on = o ? o.split("\n").length : 0;
		const nn = n ? n.split("\n").length : 0;
		if (on * nn > DIFF_CELL_LIMIT) {
			return {
				leftHtml: plainSide(o || ""),
				rightHtml: plainSide(n || ""),
				gutter: gutterCh(Math.max(on, nn)),
			};
		}
		const sides = rowsToSides(diffRows(o, n));
		return {
			leftHtml: sideHtml(sides.left),
			rightHtml: sideHtml(sides.right),
			gutter: gutterCh(sides.maxNum),
		};
	};
	const init = compute(baseOld, baseNew);
	host.innerHTML =
		`<div class="dpath">${esc(path || "(no path)")}${isWrite ? ' <span class="sx-tag">write</span>' : ""}</div>` +
		`<div class="sxs" style="--sx-gutter:${init.gutter}">` +
		`<div class="sx-col sx-old"><div class="sx-hdr">\u2212 original</div><div class="sx-body sx-left">${init.leftHtml}</div></div>` +
		`<div class="sx-col sx-new"><div class="sx-hdr">+ edited${ro ? "" : ' <button class="sx-apply" type="button">Apply</button>'}</div>` +
		(ro
			? `<div class="sx-body sx-right">${init.rightHtml}</div>`
			: `<div class="sx-edit"><div class="sx-body sx-hlbody" aria-hidden="true">${init.rightHtml}</div><textarea class="sx-ta" spellcheck="false" wrap="off"></textarea></div>`) +
		`</div></div>`;
	const leftBody = host.querySelector(".sx-left");
	const rightBody = host.querySelector(".sx-right, .sx-hlbody");
	let ta = null; // set only in editable mode
	// ponytail: gutters render 1-based immediately, then snap to the hunk's
	// real file line numbers once findStartLine resolves. Only the .sx-gnum
	// text + the --sx-gutter width change -- diff rows, content, and the
	// editable textarea are untouched, so scroll/selection/Apply survive.
	let lineStart = 1;
	const patchGutters = (start) => {
		let maxNum = start - 1;
		for (const body of [leftBody, rightBody]) {
			let n = start - 1;
			body.querySelectorAll(".sx-line").forEach((line) => {
				const gnum = line.querySelector(".sx-gnum");
				if (line.classList.contains("ln-empty")) {
					if (gnum) gnum.innerHTML = "\u00a0";
				} else {
					n++;
					if (gnum) gnum.textContent = String(n);
					if (n > maxNum) maxNum = n;
				}
			});
		}
		host
			.querySelector(".sxs")
			.style.setProperty("--sx-gutter", gutterCh(maxNum));
	};
	if (!isWrite && baseOld) {
		findStartLine(path, baseOld, baseNew).then((start) => {
			if (start) {
				lineStart = start;
				patchGutters(start);
			}
		});
	}
	// scroll sync: bidirectional, guarded against feedback loops
	let syncing = false;
	const syncFrom = (src) => {
		if (syncing) return;
		syncing = true;
		for (const t of [leftBody, rightBody, ta]) {
			if (t && t !== src) {
				t.scrollTop = src.scrollTop;
				t.scrollLeft = src.scrollLeft;
			}
		}
		syncing = false;
	};
	leftBody.addEventListener("scroll", () => syncFrom(leftBody));
	if (ro) {
		rightBody.addEventListener("scroll", () => syncFrom(rightBody));
		return;
	}
	// editable pane wiring
	ta = host.querySelector(".sx-ta");
	const applyBtn = host.querySelector(".sx-apply");
	ta.value = baseNew;
	ta.addEventListener("scroll", () => syncFrom(ta));
	let pend = false;
	const repaint = () => {
		const c = compute(baseOld, ta.value);
		host.querySelector(".sxs").style.setProperty("--sx-gutter", c.gutter);
		rightBody.innerHTML = c.rightHtml;
		leftBody.innerHTML = c.leftHtml;
		if (lineStart > 1) patchGutters(lineStart);
	};
	ta.addEventListener("input", () => {
		if (pend) return;
		pend = true;
		requestAnimationFrame(() => {
			pend = false;
			repaint();
		});
	});
	let baselineNew = baseNew;
	applyBtn.addEventListener("click", () =>
		applyEdit(path, baselineNew, ta.value, isWrite, applyBtn, () => {
			baselineNew = ta.value;
		}),
	);
}
// applyEdit: read current file, splice the edited hunk in (edit tool) or
// replace it wholesale (write tool), then POST to /api/write. For edits we
// anchor on baselineNew (the agent's newText now sitting on disk) and
// replace its first occurrence; if it can't be found the file moved under
// us and we bail instead of clobbering.
async function applyEdit(path, baselineNew, edited, isWrite, btn, onOk) {
	if (!path) {
		toast("no path to apply", "err");
		return;
	}
	if (!isWrite && edited === baselineNew) {
		toast("no changes to apply", "warn");
		return;
	}
	const prev = btn.textContent;
	btn.disabled = true;
	btn.textContent = "Applying…";
	try {
		let next;
		if (isWrite) {
			next = edited;
		} else {
			const r = await fetch("/api/file?path=" + encodeURIComponent(path));
			const j = await r.json();
			if (!j.ok) throw new Error(j.error || "read failed");
			const hits = j.content.split(baselineNew).length - 1;
			if (hits === 0)
				throw new Error("original hunk no longer present in file");
			// ponytail: String.replace hits only the FIRST match. If the agent's
			// newText is non-unique (common in refactors) we'd silently edit the
			// wrong occurrence — bail and tell the user instead of clobbering.
			if (hits > 1)
				throw new Error(
					"original hunk appears " +
						hits +
						" times in the file — open and edit it manually",
				);
			next = j.content.replace(baselineNew, edited);
		}
		const w = await fetch("/api/write", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ path, content: next }),
		});
		const wj = await w.json();
		if (!wj.ok) throw new Error(wj.error || "write failed");
		toast("applied \u2192 " + path, "ok");
		btn.textContent = "Applied \u2713";
		if (onOk) onOk();
		setTimeout(() => {
			btn.disabled = false;
			btn.textContent = prev;
		}, 1500);
	} catch (e) {
		toast("apply failed: " + e.message, "err");
		btn.disabled = false;
		btn.textContent = prev;
	}
}

// ---- working indicator: spinner + current activity ----
function describeTool(name, args) {
	if (!args) return name || "tool";
	if (name === "edit" || name === "write") return `${name} ${args.path || ""}`;
	if (name === "read") return `reading ${args.path || ""}`;
	if (name === "bash")
		return `bash: ${String(args.command || "").slice(0, 60)}`;
	if (name === "grep" || name === "find")
		return `${name}: ${args.pattern || args.path || ""}`;
	if (name === "todo") return `todo: ${args.action || ""}`;
	if (name === "web_search" || name === "web_fetch")
		return `${name}: ${String(args.query || args.url || "").slice(0, 60)}`;
	return name || "tool";
}
// ---- activity bar: one line above the chatbox that reports what the
// session is doing right now — "thinking…", "running bash: npm test",
// "waiting for your input…", or "ready" when idle and waiting for you.
// `working` swaps the spinner in and tints the label accent; `idle`
// shows a dim dot so it's obvious the turn is yours.
let lastActivity = "";
function setActivity(label, working) {
	const key = (working ? "1:" : "0:") + label;
	if (key === lastActivity) return;
	lastActivity = key;
	activityEl.className = "activity " + (working ? "working" : "idle");
	actLabel.textContent = label;
}

function note(text, cls) {
	const m = document.createElement("div");
	m.className = "msg";
	const b = document.createElement("div");
	b.className = "bubble";
	if (cls) b.style.color = `var(--${cls})`;
	b.textContent = text;
	m.appendChild(b);
	transcript.appendChild(m);
	scrollDown();
}

function toast(msg, kind) {
	const t = document.createElement("div");
	t.className = "toast" + (kind ? " " + kind : "");
	t.textContent = msg;
	document.body.appendChild(t);
	setTimeout(() => t.remove(), 4000);
}

// ---- extension UI modal ----
const modal = $("modal"),
	card = $("modal-card");
let lastFocus = null;
// ponytail: modal a11y. Esc fires the modal's [data-dismiss] button if present
// (so pi's latch is always resolved, never stranded); Tab cycles inside the
// card. Focus moves into the modal on open and back to the trigger on close.
function onModalKey(e) {
	if (e.key === "Escape") {
		const d = card.querySelector("[data-dismiss]");
		if (d) {
			e.preventDefault();
			d.click();
		}
		return;
	}
	if (e.key === "Tab") {
		const fs = Array.from(
			card.querySelectorAll(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			),
		).filter((el) => !el.disabled && el.offsetParent !== null);
		if (fs.length < 2) return;
		const first = fs[0],
			last = fs[fs.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	}
}
function openModal() {
	lastFocus = document.activeElement;
	modal.style.display = "flex";
	modal.setAttribute("aria-modal", "true");
	document.addEventListener("keydown", onModalKey, true);
	requestAnimationFrame(() => {
		const f = card.querySelector(
			"button, [href], input, select, textarea, [tabindex]",
		);
		if (f) f.focus();
	});
}
function showModal(html) {
	// reset any per-modal modifier (e.g. .wide) so it can't leak across opens
	card.className = "card";
	card.innerHTML = html;
	openModal();
}
function hideModal() {
	modal.style.display = "none";
	modal.setAttribute("aria-modal", "false");
	document.removeEventListener("keydown", onModalKey, true);
	if (lastFocus) {
		try {
			lastFocus.focus();
		} catch {}
		lastFocus = null;
	}
}

// ---- todo panel: reconstruct state from rpiv-todo result texts ----
const todopanel = $("todopanel"),
	tpBody = $("tp-body"),
	tpCount = $("tp-count");
let todos = []; // {id, subject, status}
function parseTodo(text) {
	if (!text) {
		renderTodos();
		return;
	}
	let m;
	// Multi-line list output: [status] #id subject [(activeForm)] [⛓ deps].
	// ponytail: list is the source of truth — rebuild fully when present.
	const listLines = text.split("\n").filter((l) => /^\[\w+\]\s*#\d+/.test(l));
	if (listLines.length) {
		todos = listLines
			.map((l) => {
				const lm = /^\[(\w+)\]\s*#(\d+)\s+(.*)$/.exec(l);
				if (!lm) return null;
				let subject = lm[3];
				const depIdx = subject.indexOf("⛓");
				if (depIdx !== -1) subject = subject.slice(0, depIdx);
				return { id: +lm[2], subject: subject.trim(), status: lm[1] };
			})
			.filter(Boolean);
		renderTodos();
		return;
	}
	if ((m = /^Created #(\d+):\s*(.*?)\s*\((\w+)\)/.exec(text))) {
		const ex = todos.find((t) => t.id === +m[1]);
		if (ex) {
			ex.subject = m[2];
			ex.status = m[3];
		} else {
			todos.push({ id: +m[1], subject: m[2], status: m[3] });
		}
	} else if ((m = /^Updated #(\d+)\s*\(\w+\s*→\s*(\w+)\)/.exec(text))) {
		const ex = todos.find((t) => t.id === +m[1]);
		if (ex) ex.status = m[2];
	} else if ((m = /^Deleted #(\d+):/.exec(text))) {
		todos = todos.filter((t) => t.id !== +m[1]);
	} else if (/^Cleared \d+ (todos?|tasks?)/.test(text)) {
		todos = [];
	}
	renderTodos();
}
function renderTodos() {
	if (!todos.length) {
		todopanel.style.display = "none";
		return;
	}
	todopanel.style.display = "block";
	const done = todos.filter((t) => t.status === "completed").length;
	tpCount.textContent = `${done}/${todos.length}`;
	tpBody.innerHTML = "";
	todos.forEach((t) => {
		const row = document.createElement("div");
		row.className = "ti " + (t.status === "completed" ? "done" : t.status);
		const ck =
			t.status === "completed" ? "✓" : t.status === "in_progress" ? "●" : "○";
		row.innerHTML = `<span class="ck ${t.status === "completed" ? "done" : t.status === "in_progress" ? "live" : "pend"}">${ck}</span><span class="id">#${t.id}</span><span class="sbj">${esc(t.subject)}</span>`;
		tpBody.appendChild(row);
	});
}

// ---- ask_user_question: rich modal, answer flows back as the tool result ----
// pi-webui extension shadows the npm tool (which auto-declines in RPC mode:
// ctx.ui.custom is a no-op stub). The extension blocks on ctx.ui.input(MARKER);
// tool_execution_start already shipped the full args (previews/multiselect) here,
// so we render the rich modal from args and reply with a JSON-encoded result.
// ponytail: marker comes from server.js (window.__PI_ASK_MARKER) so the literal
// can't drift between the browser and the pi_minimal_webui extension.
const ASK_MARKER = window.__PI_ASK_MARKER || "\u0000pi-webui:ask-user-question";
// ponytail: ask_user_question is a TWO-stage permission-then-UI flow. The old
// code opened the modal at tool_execution_start, but that fires BEFORE the
// safeguard "Allow?" select — so showModal() for the permission prompt
// clobbered the questions and nothing reopened them after Allow. Correct order:
//   1. tool_execution_start (full args) → stash args here.
//   2. safeguard select ("Allow ask_user_question?") → user approves.
//   3. tool's execute() runs ctx.ui.input(MARKER) → render the modal NOW from
//      the stashed args. Order is guaranteed by pi-agent-core
//      (tool_execution_start → prepareToolCall hook → execute).
let askId = null; // extension_ui_response id for the active questionnaire
let pendingAskArgs = null; // ask_user_question args stashed at tool_execution_start
function askQuestion(args) {
	const qs = (args && args.questions) || [];
	if (!qs.length) return;
	const answers = qs.map(() => null); // per-question: string | string[]
	let step = 0; // current question index (one-at-a-time multistep)
	const total = qs.length;
	openModal();

	// advance to the next question, or commit once the last is answered
	function choose(qi, value) {
		answers[qi] = value;
		if (qi + 1 < total) {
			step = qi + 1;
			renderStep();
		} else {
			commit();
		}
	}

	// ponytail: one chat-kind answer for q0 → envelope tells the model to continue.
	function goChat() {
		if (askId) {
			const result = {
				cancelled: false,
				answers: [
					{
						questionIndex: 0,
						question: qs[0].question,
						kind: "chat",
						answer: "Chat about this",
					},
				],
			};
			api({
				type: "extension_ui_response",
				id: askId,
				value: JSON.stringify(result),
			});
			askId = null;
		}
		setActivity("thinking…", true);
		hideModal();
	}

	function renderStep() {
		const qi = step;
		const q = qs[qi];
		const multi = !!q.multiSelect;
		const opts = (q.options || []).map((o) =>
			typeof o === "string" ? { label: o } : o,
		);
		// previews switch single-select to a side-by-side layout and suppress
		// the "Type something." custom row (no room in the split).
		const hasPreview =
			!multi && opts.some((o) => o.preview && o.preview.length);

		card.innerHTML = "";
		const form = document.createElement("div");
		form.className = "qform";

		// step indicator + progress bar (only meaningful with >1 question)
		if (total > 1) {
			const prog = document.createElement("div");
			prog.className = "qprog";
			prog.innerHTML =
				`<div class="qsteps">Step ${qi + 1} of ${total}</div>` +
				`<div class="qbar"><i style="width:${((qi + 1) / total) * 100}%"></i></div>`;
			form.appendChild(prog);
		}

		const blk = document.createElement("div");
		blk.className = "qblk";
		blk.innerHTML =
			(q.header ? `<span class="qchip">${esc(q.header)}</span>` : "") +
			`<p class="qq">${esc(q.question)}</p>`;

		const body = document.createElement("div");
		body.className = "qbody" + (hasPreview ? " split" : "");
		const list = document.createElement("div");
		list.className = "qopts";

		const optBtn = (o, lbl) => {
			const b = document.createElement("button");
			b.className = "qopt";
			b.innerHTML =
				`<span class="qlbl">${esc(lbl)}</span>` +
				(o.description
					? `<span class="qdesc">${esc(o.description)}</span>`
					: "");
			return b;
		};

		if (multi) {
			const chosen = new Set(Array.isArray(answers[qi]) ? answers[qi] : []);
			opts.forEach((o) => {
				const lbl = o.label;
				const b = optBtn(o, lbl);
				const sync = () => {
					b.classList.toggle("sel", chosen.has(lbl));
					b.querySelector(".qlbl").textContent =
						(chosen.has(lbl) ? "☑ " : "☐ ") + lbl;
				};
				sync();
				b.onclick = () => {
					if (chosen.has(lbl)) chosen.delete(lbl);
					else chosen.add(lbl);
					sync();
					submit.querySelector(".qlbl").textContent =
						`Submit${chosen.size ? " (" + chosen.size + ")" : ""}`;
				};
				list.appendChild(b);
			});
			const submit = document.createElement("button");
			submit.className = "qopt qsubmit";
			submit.innerHTML = `<span class="qlbl">Submit${chosen.size ? " (" + chosen.size + ")" : ""}</span>`;
			submit.onclick = () => choose(qi, [...chosen]);
			list.appendChild(submit);
		} else {
			opts.forEach((o) => {
				const lbl = o.label;
				const b = optBtn(o, lbl);
				b.onclick = () => choose(qi, lbl);
				list.appendChild(b);
			});
			if (!hasPreview) {
				const row = document.createElement("div");
				row.className = "qrow";
				const inp = document.createElement("input");
				inp.type = "text";
				inp.placeholder = "Type something…";
				const prev = answers[qi];
				if (typeof prev === "string" && !opts.some((o) => o.label === prev))
					inp.value = prev;
				const ok = document.createElement("button");
				ok.textContent = "Send";
				ok.onclick = () => {
					if (!inp.value.trim()) return;
					choose(qi, inp.value.trim());
				};
				row.append(inp, ok);
				list.appendChild(row);
			}
		}
		body.appendChild(list);

		// side-by-side preview pane (single-select + any preview). Updates on
		// hover/focus; defaults to the first option that carries a preview.
		if (hasPreview) {
			const pane = document.createElement("div");
			pane.className = "qprev";
			const show = (o) => {
				pane.innerHTML =
					`<div class="qprev-h">preview</div>` +
					`<pre class="qprev-b">${esc((o && o.preview) || "")}</pre>`;
			};
			show(opts.find((o) => o.preview && o.preview.length) || opts[0]);
			list.querySelectorAll(".qopt").forEach((b, i) => {
				const o = opts[i];
				if (o && o.preview) {
					b.addEventListener("mouseenter", () => show(o));
					b.addEventListener("focus", () => show(o));
				}
			});
			body.appendChild(pane);
		}

		blk.appendChild(body);
		form.appendChild(blk);

		const foot = document.createElement("div");
		foot.className = "qfoot";
		if (qi > 0) {
			const back = document.createElement("button");
			back.className = "qlink";
			back.textContent = "← Back";
			back.onclick = () => {
				step = qi - 1;
				renderStep();
			};
			foot.appendChild(back);
		}
		const chat = document.createElement("button");
		chat.className = "qlink";
		chat.textContent = "Chat about this instead";
		chat.onclick = goChat;
		chat.dataset.dismiss = ""; // ponytail: Esc → goChat resolves the latch, model continues
		foot.appendChild(chat);
		form.appendChild(foot);

		card.appendChild(form);
		card.scrollTop = 0;
	}

	renderStep();

	function commit() {
		if (!askId) {
			toast("answer target not ready — try again", "warn");
			return;
		}
		// Build a QuestionnaireResult the extension's envelope builder understands.
		const resultAnswers = qs.map((q, qi) => {
			const a = answers[qi];
			if (Array.isArray(a)) {
				return {
					questionIndex: qi,
					question: q.question,
					kind: "multi",
					answer: null,
					selected: a,
				};
			}
			const opt = (q.options || []).find(
				(o) => (typeof o === "string" ? o : o.label) === a,
			);
			const isOption = !!opt;
			return {
				questionIndex: qi,
				question: q.question,
				kind: isOption ? "option" : "custom",
				answer: a,
				preview: isOption && opt && opt.preview ? opt.preview : undefined,
			};
		});
		api({
			type: "extension_ui_response",
			id: askId,
			value: JSON.stringify({ cancelled: false, answers: resultAnswers }),
		});
		askId = null;
		setActivity("thinking…", true);
		hideModal();
	}
}

// ---- permission-prompt risk classification (pure heuristic, no model) ----
// ponytail: confirm/select permission prompts can carry a huge raw command
// in req.message. We classify it and scan for destructive patterns.
// Intentionally a static rule table -- instant, offline, deterministic,
// and immune to LLM phrasing. (Plain-english summary removed; replacement planned.)
const SHELL_VERBS =
	/^(sudo\s+)?(npm|pnpm|yarn|npx|git|rm|rmdir|cp|mv|mkdir|touch|cat|ls|curl|wget|ssh|scp|rsync|tar|zip|unzip|chmod|chown|kill|killall|docker|kubectl|helm|terraform|ansible|make|gcc|python|python3|pip|pip3|node|ruby|go|cargo|rustc|java|mvn|gradle|bash|sh|zsh|powershell|cmd|echo|cd|export|source|systemctl|service|brew|apt|apt-get|yum|dnf|pacman|choco|winget|del|copy|move|ren|format|taskkill|netstat|ping)\b/i;
// [regex, severity(1-3), tag, why]. Tag dedupes so a generic match (sev 2)
// yields to a specific one (sev 3) instead of stacking reasons.
const RISK_RULES = [
	[
		/\brm\b[^|&;\n]*(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\b[^|&;\n]*-f\b|-f\b[^|&;\n]*-r\b|--no-preserve-root)/i,
		3,
		"rm",
		"recursively force-deletes files -- irreversible",
	],
	[/\brm\b/i, 2, "rm", "deletes files"],
	[
		/\bgit\s+push\b[^|&;\n]*(?:--force|-f\b)/i,
		3,
		"gitpush",
		"force-pushes -- overwrites remote history",
	],
	[/\bgit\s+push\b/i, 2, "gitpush", "publishes commits to the remote"],
	[
		/\bgit\s+reset\s+(?:--hard|--keep)/i,
		3,
		"gitreset",
		"resets the branch -- discards changes",
	],
	[
		/\bgit\s+clean\b[^|&;\n]*-[a-z]*d/i,
		3,
		"gitclean",
		"permanently deletes untracked files",
	],
	[
		/\b(?:drop|truncate)\s+/i,
		3,
		"sql",
		"destroys database data (DROP/TRUNCATE)",
	],
	[/\bmkfs(?:\.\w+)?\b/i, 3, "mkfs", "formats a filesystem -- erases the disk"],
	[/\bdd\b[^|&;\n]*\bof=\/dev\//i, 3, "dd", "raw-writes to a block device"],
	[
		/\b(?:shutdown|reboot|halt|poweroff|init\s+0)\b/i,
		3,
		"power",
		"stops or restarts the machine",
	],
	[/\bformat\b\s+[a-z]:/i, 3, "format", "formats a drive"],
	[
		/(?:curl|wget)\b[^|&;\n]*\|\s*(?:sh|bash|zsh|sudo|python)/i,
		3,
		"pipeshell",
		"pipes a download into a shell -- runs arbitrary code",
	],
	[/\bsudo\b/i, 2, "sudo", "runs with elevated (root) privileges"],
	[/\bgit\s+commit\b/i, 2, "gitcommit", "creates a git commit"],
	[
		/\b(?:chmod|chown)\b[^|&;\n]*-r/i,
		2,
		"chmod",
		"recursively changes permissions/ownership",
	],
	[
		/\bkill\s+-9\b|\btaskkill\b[^|&;\n]*\/[fF]/i,
		2,
		"kill",
		"force-kills a process",
	],
	[
		/\bdocker\s+(?:rm|rmi|prune|system\s+prune|volume\s+rm)\b/i,
		2,
		"docker",
		"removes docker resources",
	],
	[/\bkubectl\s+delete\b/i, 2, "k8s", "deletes a kubernetes resource"],
	[
		/\bterraform\s+(?:apply|destroy)\b/i,
		2,
		"tf",
		"changes infrastructure state",
	],
	[/\bnpm\s+publish\b/i, 2, "publish", "publishes a package to the registry"],
	[
		/\b(?:npm|pnpm|yarn)\s+(?:install|ci|add|i|up|upgrade)\b|\bpip3?\s+install\b|\bcargo\s+add\b|\bgo\s+get\b/i,
		1,
		"install",
		"installs packages (runs install scripts)",
	],
	[/\b(?:curl|wget)\b/i, 1, "fetch", "makes a network request"],
];
function shellLooks(t) {
	// ponytail: tolerate a leading terminal prompt ($, >) — pasted blocks
	// like "$ npm test" would otherwise miss the ^-anchored verb match and
	// fall through to the prose-detail path.
	const stripped = t.trim().replace(/^[$>]\s+/, "");
	if (SHELL_VERBS.test(stripped)) return true;
	if (/&&|\|\||;|>>|\$\(|\|/.test(t)) return true;
	for (const l of t.split(/\r?\n/)) {
		const lt = l.trim().replace(/^[$>]\s+/, "");
		if (lt && SHELL_VERBS.test(lt)) return true;
	}
	return false;
}

function analyzePermission(title, message) {
	const raw = (message || title || "").trim();
	// ponytail: strip markdown code fences (```bash ... ```) and join
	// backslash line-continuations. pi often wraps the command in a fenced
	// block; the fence markers would otherwise inflate the line count and
	// leak into the detail viewer as a phony command line.
	const cleaned = raw
		.replace(/^\s*```[a-zA-Z0-9_-]*\s*$/gm, "")
		.replace(/\\\n\s*/g, " ")
		.trim();
	const isShell = shellLooks(cleaned);
	const cmd = cleaned;
	// scan whole raw text -- regexes are word-boundary based, so they fire
	// inside prose ('Allow rm -rf?') AND anywhere in a multi-line script or
	// fenced block, no matter which line the dangerous token sits on. Keep
	// highest sev per tag so rm -rf (sev 3) wins over plain rm (sev 2).
	const byTag = new Map();
	for (const rule of RISK_RULES) {
		if (rule[0].test(raw)) {
			const ex = byTag.get(rule[2]);
			if (!ex || rule[1] > ex.sev)
				byTag.set(rule[2], { sev: rule[1], why: rule[3] });
		}
	}
	const risks = [...byTag.values()].sort((a, b) => b.sev - a.sev);
	const maxSev = risks.length ? risks[0].sev : 0;
	const lineCount = cmd.split(/\r?\n/).length;
	const big = cmd.length > 300 || lineCount > 6;
	return {
		isShell,
		cmd,
		risks,
		maxSev,
		big,
		lineCount,
	};
}
// shared card body (risk banner + command) for confirm & select
function buildPermissionBody(title, message) {
	const a = analyzePermission(title, message);
	let h = "";
	if (a.risks.length) {
		const lvl = a.maxSev >= 3 ? "high" : a.maxSev === 2 ? "med" : "low";
		const head =
			lvl === "high"
				? "Potentially destructive -- review carefully"
				: lvl === "med"
					? "Heads up -- notable side effects"
					: "Note";
		const icon = lvl === "high" ? "⚠" : lvl === "med" ? "▲" : "ℹ";
		h += `<div class='crisk ${lvl}'><span class='cicon'>${icon}</span><div><div class='chead'>${esc(head)}</div><ul>${a.risks.map((r) => `<li>${esc(r.why)}</li>`).join("")}</ul></div></div>`;
	}
	const showDetail = a.isShell || a.big || a.risks.length;
	if (showDetail) {
		const meta = a.isShell
			? `${a.lineCount} line${a.lineCount === 1 ? "" : "s"} · ${a.cmd.length} chars`
			: `${a.cmd.length} chars`;
		const vlabel = a.isShell ? "command" : "detail";
		h += `<details class='cmd'${a.big ? "" : " open"}><summary><span class='sverb'>${vlabel}</span><span class='cmdmeta'>${meta}</span></summary><div class='cmdbody'>${esc(a.cmd)}</div></details>`;
	}
	return { html: h, maxSev: a.maxSev };
}
// renderEditDiffPreviews: mount a read-only side-by-side diff for the tool
// CURRENTLY awaiting a permission decision (curToolName/curToolArgs, set at
// tool_execution_start) into `container`. Used in the permission modal so you
// see exactly what you're approving for THIS prompt. An edit with N hunks → N
// tabs; a write → one pane (original side empty — we don't fetch disk).
//
// Order guarantee: tool_execution_start fires immediately before each tool's
// safeguard select (even in parallel mode, preparation is sequential), so
// curToolName/curToolArgs always describe the prompt currently on screen.
//
// Note on approval granularity: the RPC permission protocol carries ONE
// allow/deny response per prompt, so the browser can't approve individual
// hunks independently — the tabs are for *review*, the buttons below
// decide the whole prompt.
function renderEditDiffPreviews(container) {
	if (!container) return null;
	const name = curToolName;
	const inp = curToolArgs || {};
	const isEdit =
		name === "edit" && Array.isArray(inp.edits) && inp.edits.length;
	const isWrite = name === "write";
	if (!isEdit && !isWrite) return null;
	// Flatten into per-hunk review items so an edit with N hunks yields N
	// tabs (each independently diffable), and a write yields one.
	const items = [];
	const base = (inp.path || "(no path)").split(/[\\/]/).pop();
	if (isEdit) {
		inp.edits.forEach((e, ei) => {
			items.push({
				label:
					inp.edits.length > 1
						? base + " \u00b7 edit " + (ei + 1) + "/" + inp.edits.length
						: base,
				build: (host) =>
					mountSideBySide(
						host,
						inp.path || "",
						e.oldText || "",
						e.newText || "",
						false,
						{ readOnly: true },
					),
			});
		});
	} else {
		items.push({
			label: base + " \u00b7 write",
			build: (host) =>
				mountSideBySide(host, inp.path || "", null, inp.content || "", true, {
					readOnly: true,
				}),
		});
	}
	if (!items.length) return null;

	// single hunk: no tab chrome, just the diff
	if (items.length === 1) {
		const host = document.createElement("div");
		host.className = "sx-host";
		container.appendChild(host);
		items[0].build(host);
		return host;
	}

	// multiple: tab strip (one per hunk) + stacked panels
	const wrap = document.createElement("div");
	wrap.className = "sx-tabs-wrap";
	const strip = document.createElement("div");
	strip.className = "sx-tabs";
	wrap.appendChild(strip);
	container.appendChild(wrap);
	const panels = [];
	items.forEach((it, i) => {
		const tab = document.createElement("button");
		tab.type = "button";
		tab.className = "sx-tab" + (i === 0 ? " active" : "");
		tab.textContent = it.label;
		tab.title = it.label;
		tab.onclick = () => {
			strip
				.querySelectorAll(".sx-tab")
				.forEach((t) => t.classList.remove("active"));
			tab.classList.add("active");
			panels.forEach((p, j) => p.classList.toggle("active", i === j));
		};
		strip.appendChild(tab);
	});
	items.forEach((it, i) => {
		const panel = document.createElement("div");
		panel.className = "sx-panel" + (i === 0 ? " active" : "");
		const host = document.createElement("div");
		host.className = "sx-host";
		panel.appendChild(host);
		wrap.appendChild(panel);
		panels.push(panel);
		it.build(host);
	});
	return wrap;
}
function uiRequest(req) {
	const { id, method } = req;
	// ponytail: ask_user_question latch. input(MARKER) arrives AFTER the user
	// approves the safeguard prompt (it fires inside the tool's execute(),
	// which runs after the permission hook). Record where to send the result,
	// then render the rich modal from the args stashed at tool_execution_start.
	// (Rendering earlier — at tool_execution_start — was the bug: the permission
	// select fired next and clobbered the questions with showModal().)
	if (method === "input" && req.title === ASK_MARKER) {
		askId = id;
		if (pendingAskArgs) {
			const a = pendingAskArgs;
			pendingAskArgs = null;
			askQuestion(a);
			setActivity("waiting for your input…", false);
		} else {
			// args never arrived (reload mid-turn / missed tool_execution_start).
			// Resolve the latch so the tool doesn't hang — the extension treats
			// an empty/null result as "declined".
			api({ type: "extension_ui_response", id, value: "" });
			askId = null;
		}
		return;
	}
	if (method === "notify") {
		const msg = req.message || "";
		// Short status pings ("Done!", "Extension loaded!", "Compaction
		// completed") stay as transient toasts. Substantial / multi-line
		// content (ctx-stats tables, anything worth reading and keeping) is
		// real output -- render it as an assistant message in the transcript
		// instead of a 4s corner popup that vanishes.
		if (msg.includes("\n") || msg.length > 200) addAssistantText(msg);
		else toast(msg, req.notifyType);
		return;
	}
	if (method === "setStatus") {
		statusText.textContent = stripAnsi(
			req.statusText || statusText.textContent.replace(/\s*•.*$/, ""),
		);
		return;
	}
	if (method === "set_editor_text") {
		inputEl.value = req.text || "";
		autosize();
		return;
	}
	if (method === "setTitle") {
		document.title = req.title || "pi";
		return;
	}
	if (method === "setWidget") {
		const lines = req.widgetLines;
		if (!Array.isArray(lines) || lines.length === 0) {
			widget.style.display = "none";
		} else {
			widget.innerHTML = `<div class="whead">${esc(req.widgetKey || "widget")}</div>${esc(lines.join("\n"))}`;
			widget.style.display = "block";
		}
		return;
	}

	// dialog methods
	if (method === "select") {
		const opts = (req.options || []).map((o) =>
			typeof o === "string" ? { label: o } : o,
		);
		// detect a permission-style prompt (Allow/Block, Yes/No) so we can show
		// the risk banner for the command in question.
		const labels = opts.map((o) => (o.label || "").toLowerCase());
		const isPermission =
			labels.some((l) =>
				/\b(allow|permit|approve|yes|run|execute|trust|continue)\b/.test(l),
			) &&
			labels.some((l) =>
				/\b(block|deny|cancel|no|stop|reject|skip|abort)\b/.test(l),
			);
		let bodyHtml = "";
		let maxSev = 0;
		if (isPermission) {
			const body = buildPermissionBody(req.title, req.message);
			bodyHtml = body.html;
			maxSev = body.maxSev;
		}
		showModal(
			`<h3>${esc(req.title || "Choose")}</h3>${bodyHtml}<div class='opts'></div>`,
		);
		const stack = renderEditDiffPreviews(card);
		if (stack) {
			card.classList.add("wide");
			card.querySelector(".opts").before(stack);
		}
		const list = card.querySelector(".opts");
		opts.forEach((o) => {
			const b = document.createElement("button");
			const val = o.label;
			const desc = o.description;
			b.innerHTML =
				esc(val) + (desc ? `<span class='desc'>${esc(desc)}</span>` : "");
			// tint the approve option red on high-risk prompts
			if (
				maxSev >= 3 &&
				/\b(allow|permit|approve|yes|run|execute|continue)\b/.test(
					(val || "").toLowerCase(),
				)
			)
				b.className = "danger";
			b.onclick = () => {
				hideModal();
				api({ type: "extension_ui_response", id, value: val });
			};
			list.appendChild(b);
		});
	} else if (method === "confirm") {
		const body = buildPermissionBody(req.title, req.message);
		showModal(`<h3>${esc(req.title || "Confirm")}</h3>${body.html}`);
		const stack = renderEditDiffPreviews(card);
		if (stack) card.classList.add("wide");
		const row = document.createElement("div");
		row.className = "row";
		const no = document.createElement("button");
		no.textContent = "No";
		no.dataset.dismiss = ""; // ponytail: Esc = decline
		no.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, confirmed: false });
		};
		const yes = document.createElement("button");
		if (body.maxSev >= 3) {
			yes.className = "danger";
			yes.textContent = "Yes, allow";
		} else {
			yes.textContent = "Yes";
		}
		yes.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, confirmed: true });
		};
		row.append(no, yes);
		card.appendChild(row);
	} else if (method === "input") {
		showModal(`<h3>${esc(req.title || "Input")}</h3>`);
		const inp = document.createElement("input");
		inp.type = "text";
		inp.placeholder = req.placeholder || "";
		card.appendChild(inp);
		const row = document.createElement("div");
		row.className = "row";
		const ok = document.createElement("button");
		ok.textContent = "OK";
		ok.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, value: inp.value });
		};
		const cancel = document.createElement("button");
		cancel.textContent = "Cancel";
		cancel.dataset.dismiss = ""; // ponytail: Esc = cancel
		cancel.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, cancelled: true });
		};
		row.append(ok, cancel);
		card.append(inp, row);
		setTimeout(() => inp.focus(), 10);
	} else if (method === "editor") {
		showModal(`<h3>${esc(req.title || "Edit")}</h3>`);
		const ta = document.createElement("textarea");
		ta.rows = 12;
		ta.value = req.prefill || "";
		card.appendChild(ta);
		const row = document.createElement("div");
		row.className = "row";
		const ok = document.createElement("button");
		ok.textContent = "OK";
		ok.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, value: ta.value });
		};
		const cancel = document.createElement("button");
		cancel.textContent = "Cancel";
		cancel.dataset.dismiss = ""; // ponytail: Esc = cancel
		cancel.onclick = () => {
			hideModal();
			api({ type: "extension_ui_response", id, cancelled: true });
		};
		row.append(ok, cancel);
		card.append(ta, row);
		setTimeout(() => ta.focus(), 10);
	}
}

// ---- history rendering (full messages from get_messages) ----
function renderMessage(msg) {
	if (msg.role === "user") {
		let txt = "";
		const c = msg.content;
		if (typeof c === "string") txt = c;
		else if (Array.isArray(c))
			txt = c
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
		addUser(txt);
	} else if (msg.role === "assistant") {
		newAssistantBubble();
		for (const b of msg.content || []) {
			if (b.type === "text") {
				cur.textBuf = b.text;
				ensureTextPar();
				renderText();
				cur.textPar = null;
				cur.textBuf = "";
			} else if (b.type === "thinking") {
				cur.thinkBuf = b.thinking || "";
				ensureThink(false);
				renderThink(true);
				cur.thinkDetails = null;
				cur.thinkLabel = null;
				cur.thinkCount = null;
				cur.thinkEl = null;
				cur.thinkBuf = "";
			} else if (b.type === "toolCall") {
				addToolCall(b.name, b.arguments);
			}
		}
		cur = null;
	} else if (msg.role === "toolResult") {
		const t = (msg.content || [])
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
		const w = toolBlock(
			msg.toolCallId || "r" + Math.random(),
			msg.toolName || "result",
			null,
			false,
		);
		w.el.classList.remove("run");
		w.el.classList.add(msg.isError ? "err" : "done");
		w.out.textContent = t;
	} else if (msg.role === "bashExecution") {
		const el = document.createElement("details");
		el.className = "tool done";
		el.innerHTML = `<summary class="head"><span class="caret">▸</span><span class="name">bash</span> <code>${esc(msg.command || "")}</code></summary><div class="out">${esc(msg.output || "")}</div>`;
		transcript.appendChild(el);
	}
}

// ---- streaming state ----
function setStreaming(on) {
	streaming = on;
	dot.classList.toggle("live", on);
	stopBtn.disabled = !on;
	if (!on) cur = null;
}
// ponytail: compaction state -- disables the Compact button and drives the
// activity bar while the context is being summarized, whether the trigger
// was the button, a /compact, or auto-compaction at the threshold.
let compacting = false;
function setCompacting(on) {
	compacting = on;
	compactBtn.disabled = on;
}

// ---- event dispatch ----
function handle(payload) {
	switch (payload.type) {
		case "agent_start":
			setStreaming(true);
			setActivity("thinking…", true);
			// reset per-tool tracking for a fresh turn
			curToolName = null;
			curToolArgs = null;
			break;
		case "agent_end":
			setStreaming(false);
			setActivity("ready", false);
			break;

		case "message_start":
			if (payload.message && payload.message.role === "assistant")
				cur = newAssistantBubble();
			else if (payload.message && payload.message.role === "user") {
				/* server echoes? skip */
			}
			break;
		case "message_end":
			// finalize current text/think buffers
			if (cur) {
				renderText();
				renderThink(true);
				finalizeThink();
			}
			cur = null;
			break;

		case "message_update": {
			const e = payload.assistantMessageEvent;
			if (!e) break;
			if (
				!cur &&
				(e.type === "text_start" ||
					e.type === "text_delta" ||
					e.type === "thinking_start" ||
					e.type === "thinking_delta" ||
					e.type === "toolcall_start")
			)
				cur = newAssistantBubble();
			if (e.type === "text_start") {
				ensureTextPar();
				cur.textBuf = "";
				setActivity("writing…", true);
			} else if (e.type === "text_delta") {
				ensureTextPar();
				cur.textBuf += e.delta || "";
				scheduleRender();
			} else if (e.type === "text_end") {
				ensureTextPar();
				if (e.content != null) cur.textBuf = e.content;
				renderText();
			} else if (e.type === "thinking_start") {
				ensureThink(true);
				cur.thinkBuf = "";
				setActivity("thinking…", true);
			} else if (e.type === "thinking_delta") {
				ensureThink(true);
				cur.thinkBuf += e.delta || "";
				scheduleRender();
			} else if (e.type === "thinking_end") {
				if (e.content != null) {
					ensureThink(true);
					cur.thinkBuf = e.content;
				}
				renderThink(true);
				finalizeThink();
			} else if (e.type === "toolcall_start") {
				addToolCall(e.toolName);
			}
			// toolcall_end is intentionally not handled: diff previews now source
			// from tool_execution_start args (the exact tool whose prompt is on
			// screen), not the accumulated toolcall_end stream — which was the
			// source of the drain bug (an earlier tool's select emptied the list).
			break;
		}

		case "tool_execution_start": {
			toolBlock(payload.toolCallId, payload.toolName, payload.args, true);
			// record the current tool for the permission-modal diff — fires right
			// before THIS tool's safeguard select, so it's always the right one.
			curToolName = payload.toolName || null;
			curToolArgs = payload.args || null;
			if (payload.toolName === "ask_user_question") {
				// DON'T open the modal yet: the safeguard "Allow?" select fires
				// next and would clobber it. Stash args; the modal renders from
				// input(MARKER) once the user approves.
				pendingAskArgs = payload.args || null;
			}
			setActivity(describeTool(payload.toolName, payload.args), true);
			break;
		}
		case "tool_execution_update": {
			const w = toolBlocks.get(payload.toolCallId);
			if (w && payload.partialResult) {
				const t = (payload.partialResult.content || [])
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
				w.out.textContent = t;
			}
			break;
		}
		case "tool_execution_end": {
			const w = toolBlocks.get(payload.toolCallId);
			// ponytail: hoist t out of the if(w) block — parseTodo(t) needs it in scope.
			// (was block-scoped → ReferenceError → panel never updated.)
			let t = "";
			if (w) {
				w.el.classList.remove("run");
				w.el.classList.add(payload.isError ? "err" : "done");
				t = ((payload.result && payload.result.content) || [])
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
				if (
					(payload.toolName === "edit" || payload.toolName === "write") &&
					w.args &&
					!payload.isError
				) {
					// rich side-by-side diff; the new pane is editable + applyable
					w.el.classList.add("hasdiff");
					w.el.open = true;
					w.out.innerHTML = "";
					const ea = w.args;
					if (
						payload.toolName === "edit" &&
						Array.isArray(ea.edits) &&
						ea.edits.length
					) {
						ea.edits.forEach((e, idx) => {
							if (ea.edits.length > 1) {
								const dh = document.createElement("div");
								dh.className = "dhunk";
								dh.textContent = `edit ${idx + 1}/${ea.edits.length}`;
								w.out.appendChild(dh);
							}
							const host = document.createElement("div");
							host.className = "sx-host";
							w.out.appendChild(host);
							mountSideBySide(
								host,
								ea.path || "",
								e.oldText || "",
								e.newText || "",
								false,
							);
						});
					} else if (payload.toolName === "write") {
						const host = document.createElement("div");
						host.className = "sx-host";
						w.out.appendChild(host);
						mountSideBySide(host, ea.path || "", null, ea.content || "", true);
					}
					if (t) {
						const rt = document.createElement("div");
						rt.className = "sx-restext";
						rt.textContent = t;
						w.out.appendChild(rt);
					}
				} else {
					w.out.textContent = t;
					if (t.length > 500) w.el.open = false;
				}
			}
			// clear the per-tool snapshot now that this tool is done — prevents a
			// stale edit/write diff leaking onto an unrelated later select/confirm
			curToolName = null;
			curToolArgs = null;
			if (payload.toolName === "todo") parseTodo(t);
			setActivity("thinking…", true);
			autoscroll();
			break;
		}

		case "queue_update": {
			const s = (payload.steering || []).length,
				f = (payload.followUp || []).length;
			statusText.textContent =
				s || f
					? `queued: ${s} steer / ${f} follow-up`
					: streaming
						? "working…"
						: "ready";
			break;
		}
		case "auto_retry_start":
			toast(
				`retry ${payload.attempt}/${payload.maxAttempts}: ${(payload.errorMessage || "").slice(0, 80)}`,
				"warn",
			);
			break;
		case "compaction_start":
			setCompacting(true);
			setActivity("compacting context…", true);
			note("compacting context…", "warn");
			break;
		case "compaction_end": {
			// ponytail: result carries tokensBefore/estimatedTokensAfter so we
			// can show the payoff in the note. Aborted (result null + aborted)
			// and failed (result null + errorMessage) are distinct cases.
			setCompacting(false);
			setActivity(streaming ? "working…" : "ready", !!streaming);
			const r = payload;
			if (r.aborted) {
				note("compaction aborted", "warn");
			} else if (r.errorMessage) {
				note(`compaction failed: ${r.errorMessage}`, "err");
			} else if (
				r.result &&
				r.result.tokensBefore != null &&
				r.result.estimatedTokensAfter != null &&
				r.result.tokensBefore > 0
			) {
				const pct = Math.round(
					(1 - r.result.estimatedTokensAfter / r.result.tokensBefore) * 100,
				);
				note(
					`compacted: ${fmt(r.result.tokensBefore)} → ${fmt(r.result.estimatedTokensAfter)} tokens (−${pct}%${r.reason === "overflow" ? ", retrying" : ""})`,
					"ok",
				);
			} else {
				note("compacted.", "ok");
			}
			refreshStats();
			break;
		}

		case "response":
			// rpc command ack; surface failures
			if (payload.success === false)
				toast(
					`${payload.command || "cmd"} failed: ${payload.error || ""}`,
					"err",
				);
			break;

		default:
			break;
	}
}

const sb = [
	"repo",
	"git",
	"model",
	"think",
	"ctx",
	"cache",
	"tok",
	"cost",
].reduce((o, k) => ((o[k] = $("sb-" + k)), o), {});
function refreshSbModel() {
	sb.model.textContent = (modelSel.selectedOptions[0] || {}).textContent || "…";
}
const fmt = (n) =>
	n == null
		? "…"
		: n >= 1e6
			? (n / 1e6).toFixed(1) + "M"
			: n >= 1e3
				? (n / 1e3).toFixed(1) + "k"
				: String(n);
function refreshHealth() {
	fetch("/api/health")
		.then((r) => r.json())
		.then((h) => {
			if (!h) return;
			if (h.cwd) sb.repo.textContent = h.cwd;
			sb.git.textContent = h.git
				? `${h.git.branch}${h.git.changes ? ` (${h.git.changes}Δ)` : ""}`
				: "—";
		})
		.catch(() => {});
}
function refreshStats() {
	api({ type: "get_session_stats", id: "sb-stats" });
}
// ---- SSE ----
const es = new EventSource("/api/events");
es.onopen = () => {
	statusText.textContent = "ready";
	setActivity("ready", false);
	refreshHealth();
	refreshStats();
	api({ type: "get_state", id: "init-state" });
	api({ type: "get_messages", id: "init-msgs" });
	api({ type: "get_commands", id: "init-cmds" });
	api({ type: "get_available_models", id: "init-models" });
};
// ponytail: pause stat/health polling while the tab is backgrounded — avoids
// burning a request every 3s/6s on an unseen window. Re-sync on return.
let statsTimer = setInterval(refreshStats, 3000);
let healthTimer = setInterval(refreshHealth, 6000);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		clearInterval(statsTimer);
		clearInterval(healthTimer);
	} else {
		refreshStats();
		refreshHealth();
		statsTimer = setInterval(refreshStats, 3000);
		healthTimer = setInterval(refreshHealth, 6000);
	}
});
es.onmessage = (ev) => {
	let env;
	try {
		env = JSON.parse(ev.data);
	} catch {
		return;
	}
	if (env.source === "pi") {
		const p = env.payload;
		// intercept init responses to populate UI
		if (p.type === "response" && p.success) {
			if (p.id === "init-state" && p.data) {
				if (p.data.thinkingLevel != null)
					sb.think.textContent = p.data.thinkingLevel;
				if (p.data.isStreaming != null && p.data.isStreaming) {
					setStreaming(true);
					setActivity("working…", true);
				}
				if (p.data.isCompacting) {
					setCompacting(true);
					setActivity("compacting context…", true);
				}
				const mid = modelIdOf(p.data.model);
				if (mid) {
					currentModelId = mid;
					applyCurrentModel();
				}
			} else if (
				p.id === "init-msgs" &&
				p.data &&
				Array.isArray(p.data.messages)
			) {
				transcript.innerHTML = "";
				toolBlocks.clear();
				p.data.messages.forEach(renderMessage);
				scrollDown();
			} else if (
				p.id === "init-cmds" &&
				p.data &&
				Array.isArray(p.data.commands)
			) {
				commands = p.data.commands;
			} else if (
				p.id === "init-models" &&
				p.data &&
				Array.isArray(p.data.models)
			) {
				populateModels(p.data.models);
			} else if (p.id === "sb-stats" && p.data) {
				const t = p.data.tokens || {};
				sb.tok.textContent = `${fmt(t.input)}↓ ${fmt(t.output)}↑`;
				sb.cache.textContent = `${fmt(t.cacheRead)}↓ ${fmt(t.cacheWrite)}↑`;
				sb.cost.textContent =
					p.data.cost != null ? p.data.cost.toFixed(3) : "…";
				const cu = p.data.contextUsage;
				sb.ctx.textContent =
					cu && cu.percent != null
						? `${cu.percent.toFixed(0)}% (${fmt(cu.tokens)}/${fmt(cu.contextWindow)})`
						: "—";
			} else if (p.command === "set_model" && p.data) {
				const mid = modelIdOf(p.data);
				if (mid) {
					currentModelId = mid;
					localStorage.setItem("pi:model", mid);
				}
			}
		} else if (p.type === "extension_ui_request") {
			uiRequest(p);
		} else {
			if (p.type === "thinking_level_changed" && p.level != null)
				sb.think.textContent = p.level;
			else if (p.type === "agent_end" || p.type === "session_info_changed")
				refreshStats();
			handle(p);
		}
	} else if (env.source === "stderr") {
		// pi logs warnings here; show faintly only if it looks like an error
		if (/error|warn/i.test(env.payload))
			toast(env.payload.split("\n")[0].slice(0, 90), "warn");
	} else if (env.source === "pi_exit") {
		toast("pi subprocess exited — reconnecting…", "err");
	}
};
es.onerror = () => {
	statusText.textContent = "reconnecting…";
	setActivity("reconnecting…", false);
};

// ponytail: get_available_models returns no current id, so reconcile from
// get_state.model (truth) + a localStorage hint for the very first load.
let currentModelId = null;
const savedModelId = localStorage.getItem("pi:model");
function modelIdOf(m) {
	return m && m.provider && m.id ? m.provider + "/" + m.id : null;
}
function applyCurrentModel() {
	const id = currentModelId || savedModelId;
	if (!id) {
		refreshSbModel();
		return;
	}
	for (const opt of modelSel.options) {
		try {
			const v = JSON.parse(opt.value);
			if (v && v.provider + "/" + v.modelId === id) {
				opt.selected = true;
				refreshSbModel();
				return;
			}
		} catch {}
	}
	refreshSbModel();
}
function populateModels(models) {
	modelSel.innerHTML = "";
	if (!models.length) {
		const o = document.createElement("option");
		o.textContent = "no models";
		modelSel.appendChild(o);
		return;
	}
	models.forEach((m) => {
		const o = document.createElement("option");
		o.value = JSON.stringify({ provider: m.provider, modelId: m.id });
		o.textContent = (m.name || m.id) + " · " + m.provider;
		modelSel.appendChild(o);
	});
	applyCurrentModel();
}
modelSel.onchange = () => {
	refreshSbModel();
	try {
		const v = JSON.parse(modelSel.value);
		currentModelId = v.provider + "/" + v.modelId;
		localStorage.setItem("pi:model", currentModelId);
		api({ type: "set_model", provider: v.provider, modelId: v.modelId });
	} catch {}
};
$("models-btn").onclick = () =>
	api({ type: "get_available_models", id: "init-models" });

// ---- composer ----
function autosize() {
	inputEl.style.height = "auto";
	inputEl.style.height = Math.min(200, inputEl.scrollHeight) + "px";
}
inputEl.oninput = () => {
	autosize();
	updatePalette();
};

async function send() {
	const text = inputEl.value.trim();
	if (!text) return;
	inputEl.value = "";
	autosize();
	hidePalette();
	addUser(text);
	let cmd;
	if (text.startsWith("/")) {
		// extension command / skill / template: send as prompt (rpc expands it)
		cmd = { type: "prompt", message: text };
	} else if (streaming) {
		const mode = modeSel.value;
		// ponytail: RPC wire key is "follow_up" (snake-case), not "followUp";
		// auto defaults to steer. See pi dist modes/rpc/rpc-types.d.ts.
		const how =
			mode === "auto" ? "steer" : mode === "followUp" ? "follow_up" : mode;
		cmd =
			how === "prompt"
				? { type: "prompt", message: text }
				: { type: how, message: text };
	} else {
		cmd = { type: "prompt", message: text };
	}
	try {
		await api(cmd);
	} catch (e) {
		toast("send failed: " + e.message, "err");
	}
}
sendBtn.onclick = send;
stopBtn.onclick = () => api({ type: "abort" });
compactBtn.onclick = () => api({ type: "compact" });
$("new").onclick = () => {
	if (confirm("Start a new session? Current chat stays saved on the pi side."))
		api({ type: "new_session" });
};

inputEl.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
});

// ---- slash command palette ----
const palette = $("palette");
const widget = $("widget");
let palSel = 0;
let palItems = [];
function buildFilteredList(q) {
	const term = q.slice(1).toLowerCase();
	return commands
		.filter((c) => ("/" + c.name).toLowerCase().includes(term))
		.slice(0, 8);
}
function updatePalette() {
	const v = inputEl.value;
	if (v.startsWith("/")) {
		palItems = buildFilteredList(v);
		if (palItems.length) {
			renderPalette();
			palette.style.display = "block";
			return;
		}
	}
	hidePalette();
}
function renderPalette() {
	palette.innerHTML = "";
	palItems.forEach((c, i) => {
		const d = document.createElement("div");
		d.className = "item" + (i === palSel ? " sel" : "");
		d.innerHTML = `<span class="nm">/${esc(c.name)}</span> <span class="ds">${esc(c.description || c.source || "")}</span>`;
		d.onclick = () => {
			inputEl.value = "/" + c.name + " ";
			autosize();
			inputEl.focus();
			hidePalette();
		};
		palette.appendChild(d);
	});
}
function hidePalette() {
	palette.style.display = "none";
	palItems = [];
	palSel = 0;
}
inputEl.addEventListener("keydown", (e) => {
	if (palette.style.display !== "block") return;
	if (e.key === "ArrowDown") {
		e.preventDefault();
		palSel = (palSel + 1) % palItems.length;
		renderPalette();
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		palSel = (palSel - 1 + palItems.length) % palItems.length;
		renderPalette();
	} else if (e.key === "Tab" && palItems.length) {
		e.preventDefault();
		inputEl.value = "/" + palItems[palSel].name + " ";
		autosize();
		hidePalette();
		inputEl.focus();
	} else if (e.key === "Escape") {
		hidePalette();
	}
});
document.addEventListener("click", (e) => {
	if (!e.target.closest(".composer")) hidePalette();
});

autosize();
