const $ = (id) => document.getElementById(id);
const transcript = $("transcript");
const inputEl = $("input");
const sendBtn = $("send");
const stopBtn = $("stop");
const compactBtn = $("compact");
const modeSel = $("mode");
const modelSel = $("model");
const thinkSel = $("think-sel");
const ponySel = $("pony-sel");
const dot = $("dot");
const statusText = $("status-text");
const activityEl = $("activity");
const actLabel = $("act-label");

let streaming = false;
let commands = []; // [{name, description, source}]
let availableModels = []; // from get_available_models; drives model + tier selects
// subagent live-view density, set from the sidebar toggle. localStorage hint
// mirrors the pi:model / pi:todos idiom; default "full".
let subagentDensity = localStorage.getItem("pi:sa-density") || "full";
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

// md() + esc() now live in md.js (loaded via <script> BEFORE app.js). The old
// parser cluster (esc / inlineMd / splitRow / mdProse / md) was extracted there
// as the single Markdown + HTML-escaping source of truth for the browser side.

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
let lastScrollTop = transcript.scrollTop;
transcript.addEventListener("scroll", () => {
	const top = transcript.scrollTop;
	// Un-pin only on a genuine UPWARD scroll (user reading back). scrollDown()
	// and content growth never move the viewport up, so they can't un-pin —
	// that was the bug: a scrollDown's scroll event fired AFTER a big streamed
	// chunk landed (scrollHeight grew), nearBottom() read false, and the log
	// stopped following and drifted to the middle. Re-pin whenever we're back
	// near the bottom.
	if (nearBottom()) pinned = true;
	else if (top + 4 < lastScrollTop) pinned = false;
	lastScrollTop = top;
});
// ponytail: coalesce autoscroll to ONE rAF. It's called from every streaming
// hot site (renderText, renderThink, toolBlock, tool_execution_end); each
// synchronous scrollHeight read forces layout, so a burst of N onmessage tasks
// = N forced layouts in a frame (the [Violation] forced-reflow + slow 'message'
// handler). One rAF collapses them to one layout/scroll per frame. scrollDown()
// (explicit snap-to-bottom) stays synchronous — it's one-off, never in a burst.
let scrollRaf = 0;
function autoscroll() {
	if (scrollRaf) return;
	scrollRaf = requestAnimationFrame(() => {
		scrollRaf = 0;
		if (pinned) transcript.scrollTop = transcript.scrollHeight;
	});
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
		content: [], // raw {type:"text"|"thinking", text/thinking} blocks, rendered once at message_end
		_blk: null, // block currently being filled by *_delta
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
// ponytail: drop blocks with no text/thinking — a text_start that never got a
// delta, or an assistant turn that went straight to tool calls, would leave an
// empty bubble otherwise. Shared by live (finalizeBubble) and reload
// (renderMessage) so both suppress empty messages identically.
function nonEmptyContent(content) {
	return (content || []).filter(
		(b) =>
			(b.type === "text" && b.text) || (b.type === "thinking" && b.thinking),
	);
}
// ponytail: the ONE render path for assistant text + thinking blocks, shared
// by the live stream (message_end → finalizeBubble) and reload (renderMessage).
// Text is NOT streamed live — it renders once, fully formed, at message_end —
// so md() gets identical input live and after reload: no more "renders broken
// until reload". Thinking still streams live above; this just (re)renders its
// finalized form. Mirrors what renderMessage used to inline.
function renderAssistantContent(content) {
	for (const b of nonEmptyContent(content)) {
		if (b.type === "text") {
			cur.textBuf = b.text || "";
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
		}
	}
}
// definitive render into cur's bubble, replacing any live-streamed nodes (keeps
// the .role label). Called from message_end (normal, with pi's AUTHORITATIVE
// message.content) and agent_end (safety net, falls back to accumulated
// cur.content if message_end never fired).
//
// ponytail: the authoritative source matters. message_end carries the final
// AssistantMessage pi assembles server-side — the SAME object it persists and
// returns via get_messages (reload). Deltas re-accumulated in the browser are
// lossy/corruptible in the SSE transport (dropped/merged words, stripped
// spaces — the "renders broken until reload" bug). Rendering from
// payload.message.content makes live read byte-identical input to reload, so
// the two can't diverge regardless of transport hiccups.
function finalizeBubble(content) {
	if (!cur) return;
	const src = content != null ? content : cur.content;
	// nothing renderable (tool-only / truly-empty turn) — drop the whole message
	// so no stray "assistant" label is left. cur.bubble is .bubble; .msg wraps it.
	if (!nonEmptyContent(src).length) {
		const msg = cur.bubble.parentElement;
		if (msg) msg.remove();
		return;
	}
	const role = cur.bubble.querySelector(".role");
	cur.bubble.innerHTML = "";
	if (role) cur.bubble.appendChild(role);
	// reset per-block cursors so renderAssistantContent creates FRESH nodes instead
	// of painting into the live-streamed (now detached) ones it still points at.
	cur.textPar = null;
	cur.textBuf = "";
	cur.thinkEl = null;
	cur.thinkDetails = null;
	cur.thinkLabel = null;
	cur.thinkCount = null;
	cur.thinkBuf = "";
	renderAssistantContent(src);
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
// ponytail: coalesce thinking-delta paints to one rAF. Only thinking streams
// live now (text renders once at message_end), so this just feeds renderThink;
// thinking_end/finalize paint directly for an immediate final paint.
let renderRaf = 0;
function scheduleRender() {
	if (renderRaf) return;
	renderRaf = requestAnimationFrame(() => {
		renderRaf = 0;
		renderThink();
	});
}

function toolBlock(id, name, args, running) {
	let wrap = toolBlocks.get(id);
	if (!wrap) {
		const el = document.createElement("details");
		el.className = "tool" + (running ? " run" : "");
		if (running) el.open = true;
		const a = args ? JSON.stringify(args) : "";
		// two-line head: line 1 = caret + tool name, line 2 = the call args.
		const argsHtml = a ? `<code>${esc(a)}</code>` : "";
		el.innerHTML = `<summary class="head"><span class="trow"><span class="caret">▸</span><span class="name">${esc(name || "tool")}</span></span>${argsHtml}</summary><div class="out"></div>`;
		transcript.appendChild(el);
		wrap = { el, out: el.querySelector(".out") };
		toolBlocks.set(id, wrap);
	}
	if (args != null) wrap.args = args;
	autoscroll();
	return wrap;
}

// ---- subagent live view ----
// The `subagent` tool streams its live state via partialResult.details
// {mode, results:[{agent, model, turns, exitCode, messages:[...child tool calls +
// partial output...], usage}]}. agent-session.js forwards partialResult whole, so
// everything below is already arriving on tool_execution_update — this just renders
// it instead of dropping it. Same details land once more at tool_execution_end.
// ponytail: keep it compact — collapsed shows agent+model+status+recent child
// actions; the density toggle (sidebar) trims to status-only. See docs/plans.md.
const SUBAGENT_TIERS = {
	// model id prefix → tier label + color (matches subagent.ts TIERS defaults)
	"glm-5.2": { label: "capable", color: "var(--accent)" },
	"glm-5-turbo": { label: "implement", color: "var(--cyan)" },
	"glm-5.1": { label: "implement", color: "var(--cyan)" },
	"glm-4.5-air": { label: "lookup", color: "var(--muted)" },
};
function tierOf(model) {
	if (!model) return null;
	for (const k in SUBAGENT_TIERS)
		if (model.includes(k)) return SUBAGENT_TIERS[k];
	return null;
}
function describeChildCall(name, args) {
	if (name === "bash")
		return "$ " + String((args && args.command) || "").slice(0, 50);
	if (name === "read")
		return "read " + ((args && (args.path || args.file_path)) || "");
	if (name === "edit" || name === "write")
		return name + " " + ((args && args.path) || "");
	if (name === "grep" || name === "find")
		return name + " " + ((args && args.pattern) || (args && args.path) || "");
	if (name === "ls") return "ls " + ((args && args.path) || ".");
	return name || "?";
}
// render one child's messages as a compact stream of recent actions + any text
function childItems(messages, limit) {
	const items = [];
	for (const msg of messages || []) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content || []) {
			if (part.type === "toolCall")
				items.push({
					k: "call",
					t: describeChildCall(part.name, part.arguments),
				});
			else if (part.type === "text" && part.text && part.text.trim())
				items.push({ k: "text", t: part.text });
		}
	}
	const out = limit ? items.slice(-limit) : items;
	return out
		.map((it) =>
			it.k === "call"
				? `<div class="sa-call">→ ${esc(it.t)}</div>`
				: `<div class="sa-text">${esc(it.t.split("\n").slice(0, 3).join(" ").slice(0, 120))}</div>`,
		)
		.join("");
}
function statusIcon(r) {
	if (r.exitCode === -1) return "⏳";
	if (
		r.exitCode !== 0 ||
		r.stopReason === "error" ||
		r.stopReason === "aborted"
	)
		return "✗";
	return "✓";
}
// density: "full" = child actions + text; "compact" = status + actions only
function renderSubagentView(host, details, density) {
	if (!details || !details.results || !details.results.length) {
		host.textContent = "";
		return;
	}
	const mode = details.mode || "single";
	let html = `<div class="sa sa-${esc(mode)}">`;
	if (mode === "parallel") {
		const done = details.results.filter((r) => r.exitCode !== -1).length;
		const run = details.results.length - done;
		html += `<div class="sa-sum">${done}/${details.results.length} done${run ? `, ${run} running` : ""}</div>`;
	} else if (mode === "chain") {
		const ok = details.results.filter((r) => r.exitCode === 0).length;
		html += `<div class="sa-sum">chain ${ok}/${details.results.length} steps</div>`;
	}
	const itemLimit = density === "compact" ? 4 : 8;
	for (const r of details.results) {
		const t = tierOf(r.model);
		const tier = t
			? ` <span class="sa-tier" style="color:${t.color}">${esc(t.label)}</span>`
			: "";
		const model = r.model
			? ` <span class="sa-model">${esc(r.model.split("/").pop())}</span>`
			: "";
		const turns = r.turns ? ` <span class="sa-turns">${r.turns}t</span>` : "";
		html += `<div class="sa-row"><span class="sa-ic">${statusIcon(r)}</span><span class="sa-agent">${esc(r.agent)}</span>${tier}${model}${turns}</div>`;
		html += `<div class="sa-items">${childItems(r.messages, itemLimit)}</div>`;
	}
	html += "</div>";
	host.innerHTML = html;
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
	if (name === "todo") {
		const a = args && args.action;
		const n = (x) => (Array.isArray(x) ? x.length : 0);
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
	card = $("modal-card"),
	modalX = $("modal-x");
let lastFocus = null;
let modalFree = false; // true = no pi latch pending; safe to close freely (Usage)
// ponytail: modal a11y. Esc fires the modal's [data-dismiss] button if present
// (so pi's latch is always resolved, never stranded); Tab cycles inside the
// card. Focus moves into the modal on open and back to the trigger on close.
function onModalKey(e) {
	if (e.key === "Escape") {
		// settings drawer closes first (it's non-latching); only if it's closed do
		// we hand Escape to the modal's pi-latch dismiss path.
		if (settingsEl.classList.contains("open")) {
			e.preventDefault();
			closeSettings();
			return;
		}
		e.preventDefault();
		dismissModal();
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
	modalFree = false; // default: assume a latch modal; free openers opt in below
	if (modalX) modalX.hidden = true;
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
function showModal(html, free) {
	// reset any per-modal modifier (e.g. .wide) so it can't leak across opens
	card.className = "card";
	card.innerHTML = html;
	openModal();
	if (free) {
		modalFree = true;
		if (modalX) modalX.hidden = false;
	}
}
// ponytail: shared close path for the x button, Esc, and overlay click. For
// latch modals (pi awaits an extension_ui_response) click the [data-dismiss]
// button so the latch resolves cleanly (Cancel/No/"Chat about this"); for free
// modals just hide. The permission "choose" prompt has neither, so close is
// intentionally inert there — closing without a choice would strand pi.
function dismissModal() {
	const d = card.querySelector("[data-dismiss]");
	if (d) {
		d.click();
		return;
	}
	if (modalFree) hideModal();
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
if (modalX) modalX.onclick = dismissModal;
modal.addEventListener("click", (e) => {
	// click on the backdrop (not the card/x) closes via the shared path
	if (e.target === modal) dismissModal();
});

// ---- z.ai usage / quota tracker ----
// Server proxies api.z.ai (keeps the key off the wire + dodges CORS). Key
// resolution on the server: ZAI_API_KEY env -> pi's ~/.pi/agent/auth.json -> a
// UI-pasted value (sent via header, stored in localStorage). We decode z.ai's
// real /quota/limit shape (data.limits[]) and always keep the raw JSON as a
// fallback.
const ZAI_KEY = "pi:zai-key";
const getZaiKey = () => localStorage.getItem(ZAI_KEY) || "";
// ponytail: z.ai /quota/limit returns data.limits[] — each entry is either a
// count pair (usage = total, currentValue = used) or percentage-only, with an
// optional per-model usageDetails breakdown and a top-level level (plan). The
// previous code guessed field names and matched none of this; decode the real
// shape. Window unit codes (1=s 2=m 3=h 4=d 5=month 6=year) cross-checked
// against the reset-time deltas.
const LIMIT_TYPES = { TIME_LIMIT: "Time", TOKENS_LIMIT: "Tokens" };
const LIMIT_UNITS = {
	1: "second",
	2: "minute",
	3: "hour",
	4: "day",
	5: "month",
	6: "year",
};
// ponytail: nominal 30d month / 365d year; real calendar months drift but this
// is only for the glance reset-progress bar, never billing.
const UNIT_MS = {
	second: 1e3,
	minute: 6e4,
	hour: 36e5,
	day: 864e5,
	month: 2592e6,
	year: 31536e6,
};
function windowLabel(l) {
	const u = LIMIT_UNITS[l.unit];
	if (!u || !l.number) return "";
	return `${l.number} ${u}${l.number > 1 ? "s" : ""}`;
}
function windowMs(l) {
	const u = LIMIT_UNITS[l.unit];
	if (!u || !l.number) return 0;
	return (UNIT_MS[u] || 0) * l.number;
}
function zaiLimits(data) {
	const out = [];
	if (!data || typeof data !== "object") return out;
	const limits = Array.isArray(data.limits) ? data.limits : [];
	for (const l of limits) {
		if (!l || typeof l !== "object") continue;
		const base = {
			label: LIMIT_TYPES[l.type] || (l.type || "quota").replace(/_/g, " "),
			window: windowLabel(l),
			windowMs: windowMs(l),
			reset: l.nextResetTime ? new Date(l.nextResetTime) : null,
		};
		if (typeof l.usage === "number" && typeof l.currentValue === "number")
			out.push({
				...base,
				used: l.currentValue,
				total: l.usage,
				details: Array.isArray(l.usageDetails) ? l.usageDetails : null,
			});
		else if (typeof l.percentage === "number")
			out.push({ ...base, pct: l.percentage });
	}
	return out;
}
function pctOf(b) {
	if (typeof b.pct === "number") return b.pct;
	return b.total > 0 ? Math.min(100, (b.used / b.total) * 100) : 0;
}
function zaiBarHtml(b) {
	const pct = pctOf(b);
	const cls = pct >= 90 ? "hi" : pct >= 70 ? "mid" : "lo";
	const val =
		typeof b.used === "number"
			? `${Number(b.used).toLocaleString()} / ${Number(b.total).toLocaleString()} · ${pct.toFixed(1)}%`
			: `${pct.toFixed(1)}%`;
	const sub = [b.window, b.reset ? `resets ${b.reset.toLocaleString()}` : ""]
		.filter(Boolean)
		.join(" · ");
	const details =
		b.details && b.details.length
			? `<div class="um-details">${b.details
					.map(
						(d) =>
							`${esc(d.modelCode || "?")} ${Number(d.usage || 0).toLocaleString()}`,
					)
					.join(" · ")}</div>`
			: "";
	return (
		`<div class="um-bar"><div class="um-head"><span class="um-lbl">${esc(b.label)}</span><span class="um-val">${val}</span></div>` +
		(sub ? `<div class="um-sub">${esc(sub)}</div>` : "") +
		`<div class="um-track"><div class="um-fill ${cls}" style="width:${pct}%"></div></div>` +
		`${details}</div>`
	);
}
function fmtTokens(n) {
	n = Number(n) || 0;
	if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
	if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
	return String(n);
}
function fmtDur(ms) {
	if (ms < 0) ms = 0;
	const s = Math.floor(ms / 1e3),
		m = Math.floor(s / 60),
		h = Math.floor(m / 60),
		d = Math.floor(h / 24);
	if (d > 0) return `${d}d ${h % 24}h`;
	if (h > 0) return `${h}h ${m % 60}m`;
	if (m > 0) return `${m}m`;
	return `${s}s`;
}
// tokencost is higher 14:00–18:00 UTC+8 (= 06:00–10:00 UTC). Surfaced as a
// badge on the usage bar; recomputed on each 60s poll so it's minute-accurate.
function inPeakHours() {
	const h = new Date().getUTCHours();
	return h >= 6 && h < 10;
}
// Full-width inline bar: token usage (bar + %) and reset countdown (bar +
// time remaining). Tokens row colors by how close to the limit; the reset row
// is a calm accent (it just tracks progress toward the next window).
function renderUsageInline(bars) {
	if (!bars.length) return "";
	const tok =
		bars.find((b) => b.label === "Tokens") ||
		bars.find((b) => typeof b.total === "number") ||
		bars[0];
	// soonest nextResetTime across all limits; keep its bar so the Reset fill
	// uses THAT limit's windowMs (not the Tokens window — they can differ).
	const resetBar =
		bars.filter((b) => b.reset).sort((a, b) => a.reset - b.reset)[0] || null;
	const reset = resetBar ? resetBar.reset : null;
	const rows = [];
	{
		const pct = pctOf(tok);
		const cls = pct >= 90 ? "hi" : pct >= 70 ? "mid" : "lo";
		const val =
			typeof tok.used === "number"
				? `${fmtTokens(tok.used)} / ${fmtTokens(tok.total)} · ${pct.toFixed(1)}%`
				: `${pct.toFixed(1)}%`;
		rows.push(
			`<div class="ub-row"><span class="ub-lbl">Tokens</span>` +
				`<span class="ub-track" title="${esc(tok.label)}: ${esc(val)}"><span class="ub-fill ${cls}" style="width:${pct}%"></span></span>` +
				`<span class="ub-val">${esc(val)}</span></div>`,
		);
	}
	if (reset) {
		const remain = reset - Date.now();
		const wm = (resetBar && resetBar.windowMs) || 0;
		// fill = elapsed / window; windowMs is nominal so clamp to [0,100].
		const fill =
			wm > 0 ? Math.max(0, Math.min(100, (1 - remain / wm) * 100)) : 0;
		rows.push(
			`<div class="ub-row"><span class="ub-lbl">Reset</span>` +
				`<span class="ub-track"><span class="ub-fill time" style="width:${fill}%"></span></span>` +
				`<span class="ub-val">in ${fmtDur(remain)}</span></div>`,
		);
	}
	return rows.join("");
}
function usageKeyForm() {
	return (
		`<p class="um-hint">Enter your z.ai API key. It's stored only in this browser ` +
		`(localStorage); the server forwards it to api.z.ai on demand. Operators can ` +
		`also set the <code>ZAI_API_KEY</code> env var.</p>` +
		`<form id="um-key-form"><input type="password" id="um-key" class="um-key" placeholder="z.ai API key" autocomplete="off" />` +
		`<div class="row"><button>Save &amp; load</button></div></form>`
	);
}
async function renderUsage() {
	const u = await fetch("/api/zai-usage", {
		headers: { "X-ZAI-Key": getZaiKey() },
	}).then((r) => r.json());
	if (!u.ok && u.error === "no API key" && !getZaiKey()) return usageKeyForm();
	if (!u.ok)
		return (
			`<p class="um-err">\u26a0 ${esc(u.error || "request failed")}` +
			`${u.status ? ` (HTTP ${u.status})` : ""}</p>` +
			(u.raw
				? `<details class="um-raw"><summary>response</summary><pre>${esc(u.raw)}</pre></details>`
				: "")
		);
	const bars = zaiLimits(u.data);
	const barsHtml = bars.length
		? bars.map(zaiBarHtml).join("")
		: `<p class="um-err">no quota fields found in the response</p>`;
	const tier =
		u.data && u.data.level
			? `<span class="um-tier">${esc(u.data.level)}</span>`
			: "";
	const raw = JSON.stringify(u.data, null, 2);
	return (
		`<div class="um-meta"><span>${new Date().toLocaleTimeString()}` +
		`${bars.length ? ` · ${bars.length} limit${bars.length > 1 ? "s" : ""}` : ""}` +
		`${u.status ? ` · HTTP ${u.status}` : ""}</span>${tier}` +
		`<button id="um-refresh" class="um-refresh">\u21bb refresh</button></div>` +
		barsHtml +
		`<details class="um-raw"><summary>raw response</summary><pre>${esc(raw)}</pre></details>`
	);
}
async function showUsage() {
	showModal(`<h3>z.ai usage</h3><p class="um-hint">loading\u2026</p>`, true);
	let inner;
	try {
		inner = await renderUsage();
	} catch (e) {
		inner = `<p class="um-err">\u26a0 ${esc(e.message)}</p>`;
	}
	card.innerHTML = `<h3>z.ai usage</h3>` + inner;
	const rb = card.querySelector("#um-refresh");
	if (rb) rb.onclick = showUsage;
	const form = card.querySelector("#um-key-form");
	if (form)
		form.onsubmit = (e) => {
			e.preventDefault();
			localStorage.setItem(ZAI_KEY, $("um-key").value.trim());
			refreshUsageBar();
			showUsage();
		};
}

// ---- usage bar: inline in header, polls every 60s ----
// Compact glance of the same z.ai data; click for the full modal. The server
// resolves the key (ZAI_API_KEY -> auth.json zai.key -> X-ZAI-Key header), so we
// must NOT pre-gate on a local key — a key in auth.json (where pi itself reads
// it) would otherwise hide the bar. Let the server's "no API key" response be
// the only gate (same shape the modal uses).
const usageBar = $("usagebar");
async function refreshUsageBar() {
	let u;
	try {
		u = await fetch("/api/zai-usage", {
			headers: { "X-ZAI-Key": getZaiKey() },
		}).then((r) => r.json());
	} catch {
		return;
	}
	if (!u.ok) {
		usageBar.style.display = "none";
		return;
	}
	const bars = zaiLimits(u.data);
	if (!bars.length) {
		usageBar.style.display = "none";
		return;
	}
	usageBar.innerHTML = renderUsageInline(bars);
	usageBar.style.display = "flex";
	// peak-hours signal: subtle warn-colored border on the bar itself.
	usageBar.classList.toggle("peak", inPeakHours());
}
usageBar.onclick = showUsage;
usageBar.title = "z.ai usage — click for details";

// ---- todo panel: incremental state from the `todo` tool ----
// The `todo` tool (extensions/pi_minimal_webui/todo.ts) sends one ACTION per
// call (plan/add/update/remove/clear); we apply it to our own `todos` state and
// re-render straight from tool_execution_start args. Tasks carry a stable `id`
// (agent-supplied) and a status: open | started | finished. The frontend owns
// the state — same proven OUT smuggling channel as ask_user_question, and
// nothing to lose across compaction / new sessions / pi restarts.
const todopanel = $("todopanel"),
	tpBody = $("tp-body"),
	tpCount = $("tp-count");
let todos = []; // {id, subject, status}
const TODO_OK = new Set(["open", "started", "finished"]);
// ponytail: localStorage is a reload HINT, mirroring the pi:model idiom.
// The browser owns the live state; without this, a page reload empties the
// panel until the agent's next todo call (tool_execution_start only fires
// once). Keyed under pi:todos; the new-session reset (setTodos([]) above)
// flows through persistTodos() so a fresh session clears it automatically.
const TODO_KEY = "pi:todos";
function persistTodos() {
	try {
		localStorage.setItem(TODO_KEY, JSON.stringify(todos));
	} catch (e) {
		/* private mode / quota — non-fatal, live state still renders */
	}
}
function normStatus(s) {
	return TODO_OK.has(s) ? s : "open";
}
function todoItem(raw) {
	if (!raw || typeof raw.subject !== "string") return null;
	return {
		id: raw.id != null ? raw.id : raw.subject,
		subject: raw.subject,
		status: normStatus(raw.status),
	};
}
function setTodos(list) {
	// full replace — used by the new-session reset (and as a safety fallback)
	todos = (Array.isArray(list) ? list : []).map(todoItem).filter(Boolean);
	persistTodos();
	renderTodos();
}
function applyTodoOp(args) {
	if (!args || typeof args !== "object") return;
	const a = args.action;
	if (a === "plan") {
		todos = (Array.isArray(args.items) ? args.items : [])
			.map(todoItem)
			.filter(Boolean);
	} else if (a === "add") {
		(Array.isArray(args.items) ? args.items : [])
			.map(todoItem)
			.filter(Boolean)
			.forEach((t) => todos.push(t));
	} else if (a === "update") {
		const ups = Array.isArray(args.updates) ? args.updates : [];
		ups.forEach((u) => {
			if (!u || u.id == null) return;
			const t = todos.find((x) => String(x.id) === String(u.id));
			if (t) t.status = normStatus(u.status);
		});
	} else if (a === "remove") {
		const drop = new Set((Array.isArray(args.ids) ? args.ids : []).map(String));
		todos = todos.filter((t) => !drop.has(String(t.id)));
	} else if (a === "clear") {
		todos = [];
	}
	persistTodos();
	renderTodos();
}
function renderTodos() {
	// ponytail: hide once every task is finished — a fully-done list has done
	// its job; lingering checkmarks are clutter. State is kept (a later plan/add
	// re-opens the panel), and persistTodos already saved it for reload safety.
	const allDone =
		todos.length > 0 && todos.every((t) => t.status === "finished");
	if (!todos.length || allDone) {
		todopanel.style.display = "none";
		return;
	}
	todopanel.style.display = "block";
	const done = todos.filter((t) => t.status === "finished").length;
	tpCount.textContent = `${done}/${todos.length}`;
	tpBody.innerHTML = "";
	todos.forEach((t, i) => {
		const cls =
			t.status === "finished"
				? "done"
				: t.status === "started"
					? "live"
					: "pend";
		const ck =
			t.status === "finished" ? "✓" : t.status === "started" ? "●" : "○";
		const row = document.createElement("div");
		row.className = "ti " + cls;
		row.innerHTML = `<span class="ck ${cls}">${ck}</span><span class="id">#${t.id != null ? esc(String(t.id)) : i + 1}</span><span class="sbj">${esc(t.subject)}</span>`;
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
async function diffInIde(req) {
	const { id } = req;
	try {
		const payload = await buildDiffPayload();
		const decision = await window.piWebuiOpenDiff(payload);
		api({ type: "extension_ui_response", id, value: decision });
	} catch (_e) {
		toast("IDE diff unavailable — showing in webui", "warn");
		openSelectModal(req);
	}
}

// ponytail: left = current file via the existing /api/file endpoint (resolves
// under PI_CWD); right = left with every edit hunk applied (first-occurrence
// replace, like the edit tool), or the write content. Path resolution stays in
// server.js — the plugin only renders left vs right.
async function buildDiffPayload() {
	const inp = curToolArgs || {};
	const path = inp.path || "";
	const filename = path.split(/[\\/]/).pop() || "change";
	let leftText = "";
	try {
		const r = await fetch("/api/file?path=" + encodeURIComponent(path));
		const j = await r.json();
		if (j && j.ok && j.content != null) leftText = j.content;
	} catch (_e) {
		/* new / unreadable file → empty left */
	}
	let rightText = leftText;
	if (curToolName === "edit" && Array.isArray(inp.edits)) {
		for (const e of inp.edits)
			rightText = rightText.replace(e.oldText || "", e.newText || "");
	} else if (curToolName === "write") {
		rightText = inp.content || "";
	}
	return { filename, leftText, rightText };
}

// The webui permission modal, factored out so the IDE-diff path can fall back
// to it. Unchanged behavior — extracted verbatim from the old select branch.
function openSelectModal(req) {
	const { id } = req;
	const opts = (req.options || []).map((o) =>
		typeof o === "string" ? { label: o } : o,
	);
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
		// ponytail: when the JetBrains plugin hosts this page it injects
		// window.piWebuiOpenDiff — route edit/write approvals to the IDE's native
		// diff dialog as the gate. The decision comes back over the SAME
		// extension_ui_response channel with safeguard's option labels, so
		// safeguard.ts (the security gate) is unchanged. Falls back to the modal
		// if the bridge is absent or rejects.
		if (
			(curToolName === "edit" || curToolName === "write") &&
			typeof window.piWebuiOpenDiff === "function"
		) {
			void diffInIde(req);
			return;
		}
		openSelectModal(req);
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
		// suppress empty assistant messages (tool-only / blank) — parity with the
		// live path's finalizeBubble, which also drops them. No bubble = no label.
		if (nonEmptyContent(msg.content).length) {
			newAssistantBubble();
			renderAssistantContent(msg.content);
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
		el.innerHTML = `<summary class="head"><span class="trow"><span class="caret">▸</span><span class="name">bash</span></span><code>${esc(msg.command || "")}</code></summary><div class="out">${esc(msg.output || "")}</div>`;
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
			// safety net: render if message_end never fired (broken stream).
			// finalizeBubble drops an empty bubble, so this can't leave a stray label.
			// setStreaming(false) below then nulls cur.
			if (cur) finalizeBubble();
			setStreaming(false);
			setActivity("ready", false);
			break;

		case "message_start":
			// ponytail: do NOT create the bubble eagerly. A turn that goes straight to
			// tool calls (or ends empty) would leave a bare "assistant" label.
			// Creation is lazy: message_update only builds one when real text/thinking
			// arrives (the !cur guard there). User-role echoes are ignored too.
			break;
		case "message_end":
			// authoritative render: payload.message is pi's final, server-assembled
			// AssistantMessage — identical to what get_messages returns (reload).
			// Render from IT, not the browser-re-accumulated deltas (lossy in the SSE
			// transport): live and reload now read the same bytes and can't diverge.
			// The live thinking <details> is swapped for a finalized one here too
			// (collapsed by default → invisible).
			if (cur)
				finalizeBubble(
					payload.message && Array.isArray(payload.message.content)
						? payload.message.content
						: null,
				);
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
					e.type === "thinking_delta")
			)
				cur = newAssistantBubble();
			if (e.type === "text_start") {
				// ponytail: text does NOT render live (user doesn't need it; only
				// thinking streams). Accumulate raw blocks; the ONE definitive md()
				// render happens at message_end via renderAssistantContent —
				// identical to reload, so they can't diverge. cur._blk is the block
				// currently being filled; survives a missing text_end.
				cur._blk = { type: "text", text: "" };
				cur.content.push(cur._blk);
				setActivity("writing…", true);
			} else if (e.type === "text_delta") {
				if (!cur._blk || cur._blk.type !== "text") {
					cur._blk = { type: "text", text: "" };
					cur.content.push(cur._blk);
				}
				cur._blk.text += e.delta || "";
			} else if (e.type === "text_end") {
				if (cur._blk && cur._blk.type === "text" && e.content != null)
					cur._blk.text = e.content;
				cur._blk = null;
			} else if (e.type === "thinking_start") {
				// multiple thinking blocks: each gets its own live <details>.
				if (cur.thinkEl) {
					cur.thinkEl = null;
					cur.thinkDetails = null;
					cur.thinkLabel = null;
					cur.thinkCount = null;
				}
				cur._blk = { type: "thinking", thinking: "" };
				cur.content.push(cur._blk);
				ensureThink(true);
				cur.thinkBuf = "";
				setActivity("thinking…", true);
			} else if (e.type === "thinking_delta") {
				ensureThink(true);
				cur.thinkBuf += e.delta || "";
				if (cur._blk && cur._blk.type === "thinking")
					cur._blk.thinking += e.delta || "";
				scheduleRender();
			} else if (e.type === "thinking_end") {
				if (cur._blk && cur._blk.type === "thinking" && e.content != null)
					cur._blk.thinking = e.content;
				cur._blk = null;
				if (e.content != null) {
					ensureThink(true);
					cur.thinkBuf = e.content;
				}
				renderThink(true);
				finalizeThink();
			}
			// toolcall_start + toolcall_end are intentionally not handled: tool calls
			// render ONLY in their own box below (toolBlock via tool_execution_start,
			// toolResult in replay) — never inline in the assistant bubble.
			break;
		}

		case "tool_execution_start": {
			toolBlock(payload.toolCallId, payload.toolName, payload.args, true);
			// subagent: show the agent/mode + an empty live view immediately, so the
			// box reads as "running scout (lookup)" before the first update lands.
			if (payload.toolName === "subagent") {
				const w = toolBlocks.get(payload.toolCallId);
				if (w)
					renderSubagentView(
						w.out,
						{ mode: "single", results: [] },
						subagentDensity,
					);
			}
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
			if (payload.toolName === "todo") {
				// args carry an ACTION (plan/add/update/remove/clear); apply it to
				// our own todos state and re-render. execute() just acknowledges.
				applyTodoOp(payload.args);
			}
			setActivity(describeTool(payload.toolName, payload.args), true);
			break;
		}
		case "tool_execution_update": {
			const w = toolBlocks.get(payload.toolCallId);
			if (!w || !payload.partialResult) break;
			// subagent: render the live details (child tool calls, parallel/chain
			// progress, per-result status). The generic text path below still fills
			// in the final "(running…)" / partial text as a fallback.
			if (payload.toolName === "subagent" && payload.partialResult.details)
				renderSubagentView(
					w.out,
					payload.partialResult.details,
					subagentDensity,
				);
			const t = (payload.partialResult.content || [])
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
			if (payload.toolName !== "subagent") w.out.textContent = t;
			break;
		}
		case "tool_execution_end": {
			const w = toolBlocks.get(payload.toolCallId);
			// build the result text once; consumed inside the if(w) block below.
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
					// subagent: render the final details (per-task status + usage). The
					// text `t` is the parent-facing summary (already in details for
					// single/parallel); show it as a footnote below the live view.
					if (
						payload.toolName === "subagent" &&
						payload.result &&
						payload.result.details
					) {
						renderSubagentView(w.out, payload.result.details, subagentDensity);
						if (t) {
							const rt = document.createElement("div");
							rt.className = "sa-foot";
							rt.textContent = t;
							w.out.appendChild(rt);
						}
					} else {
						w.out.textContent = t;
						if (t.length > 500) w.el.open = false;
					}
				}
			}
			// clear the per-tool snapshot now that this tool is done — prevents a
			// stale edit/write diff leaking onto an unrelated later select/confirm
			curToolName = null;
			curToolArgs = null;
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

const sb = ["repo", "git", "model", "ctx", "cache", "tok", "cost"].reduce(
	(o, k) => ((o[k] = $("sb-" + k)), o),
	{},
);
function refreshSbModel() {
	sb.model.textContent = (modelSel.selectedOptions[0] || {}).textContent || "…";
}
// ponytail: header dropdowns for thinking level (set_thinking_level RPC) and
// ponytail mode (/ponytail extension command). Both sync from pi on load;
// the statusbar "think" readout is gone — the select is the single source.
["off", "minimal", "low", "medium", "high", "xhigh"].forEach((l) =>
	thinkSel.add(new Option("think: " + l, l)),
);
["off", "lite", "full", "ultra"].forEach((m) =>
	ponySel.add(new Option("pony: " + m, m)),
);
function setThinkSel(level) {
	if (level) thinkSel.value = level;
}
thinkSel.onchange = () =>
	api({ type: "set_thinking_level", level: thinkSel.value });
ponySel.onchange = () =>
	api({ type: "prompt", message: "/ponytail " + ponySel.value });
async function refreshPonytailMode(sessionFile) {
	try {
		const m = await fetch(
			"/api/ponytail-mode" +
				(sessionFile ? "?session=" + encodeURIComponent(sessionFile) : ""),
		).then((r) => r.json());
		if (m && m.ok && m.mode) ponySel.value = m.mode;
	} catch {}
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
			if (h.git) {
				const parts = [];
				if (h.git.staged) parts.push(`+${h.git.staged}`);
				if (h.git.unstaged) parts.push(`~${h.git.unstaged}`);
				if (h.git.untracked) parts.push(`?${h.git.untracked}`);
				sb.git.textContent = parts.length
					? `${h.git.branch} ${parts.join(" ")}`
					: h.git.branch;
				sb.git.title = "+ staged  ~ unstaged  ? untracked";
			} else {
				sb.git.textContent = "—";
			}
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
	refreshUsageBar();
	// restore the todo panel from the localStorage reload hint (mirrors pi:model).
	// If the list is stale vs the live session it self-corrects on the next todo
	// call, and a new session clears it (setTodos([]) persists).
	try {
		const saved = JSON.parse(localStorage.getItem(TODO_KEY) || "[]");
		if (Array.isArray(saved) && saved.length) setTodos(saved);
	} catch (e) {
		/* corrupt JSON — ignore, start empty */
	}
	api({ type: "get_state", id: "init-state" });
	api({ type: "get_messages", id: "init-msgs" });
	api({ type: "get_commands", id: "init-cmds" });
	api({ type: "get_available_models", id: "init-models" });
};
// ponytail: pause stat/health/usage polling while the tab is backgrounded — avoids
// burning requests every 3s/6s/60s on an unseen window. Re-sync on return.
let statsTimer = setInterval(refreshStats, 3000);
let healthTimer = setInterval(refreshHealth, 6000);
let usageTimer = setInterval(refreshUsageBar, 60000);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		clearInterval(statsTimer);
		clearInterval(healthTimer);
		clearInterval(usageTimer);
	} else {
		refreshStats();
		refreshHealth();
		refreshUsageBar();
		statsTimer = setInterval(refreshStats, 3000);
		healthTimer = setInterval(refreshHealth, 6000);
		usageTimer = setInterval(refreshUsageBar, 60000);
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
				if (p.data.thinkingLevel != null) setThinkSel(p.data.thinkingLevel);
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
				curSessionFile = p.data.sessionFile || null;
				refreshPonytailMode(p.data.sessionFile);
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
				// cache hit rate = cacheRead / total input. pi's `input` is the NON-cached
				// portion only (Anthropic convention), so total = input + cacheRead —
				// dividing by `input` alone yielded >100% values (saw 542%). Always ≤100%.
				const inp = t.input || 0;
				const total = inp + (t.cacheRead || 0);
				const hit = total
					? Math.round(((t.cacheRead || 0) / total) * 100)
					: null;
				sb.cache.textContent = `${fmt(t.cacheRead)}↓ ${fmt(t.cacheWrite)}↑${hit != null ? ` ${hit}%` : ""}`;
				sb.cache.title =
					"cache: read↓ (from cache) / write↑ (newly created); % = reads ÷ (reads + fresh input)";
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
			} else if (
				(p.command === "switch_session" || p.command === "new_session") &&
				(!p.data || !p.data.cancelled)
			) {
				// session replaced (resume / new) — re-render history + state for the now-active session
				api({ type: "get_state", id: "init-state" });
				api({ type: "get_messages", id: "init-msgs" });
				api({ type: "get_commands", id: "init-cmds" });
			}
		} else if (p.type === "extension_ui_request") {
			uiRequest(p);
		} else {
			if (p.type === "thinking_level_changed" && p.level != null)
				setThinkSel(p.level);
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
let curSessionFile = null; // active session file (get_state) — highlights the current row in the sessions list
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
	availableModels = Array.isArray(models) ? models : [];
	modelSel.innerHTML = "";
	if (!availableModels.length) {
		const o = document.createElement("option");
		o.textContent = "no models";
		modelSel.appendChild(o);
		return;
	}
	availableModels.forEach((m) => {
		const o = document.createElement("option");
		o.value = JSON.stringify({ provider: m.provider, modelId: m.id });
		o.textContent = (m.name || m.id) + " · " + m.provider;
		modelSel.appendChild(o);
	});
	applyCurrentModel();
	populateTierSelects();
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

// ---- settings sidebar ----
// ponytail: fixed right drawer + backdrop. Open via ⚙; close via ✕, backdrop
// click, or Esc. The relocated selects keep their IDs, so their onchange
// handlers (model/think/pony) work unchanged from the old header position.
const settingsEl = $("settings");
const settingsBack = $("settings-back");
function openSettings() {
	settingsEl.classList.add("open");
	settingsBack.classList.add("open");
	settingsEl.setAttribute("aria-hidden", "false");
}
function closeSettings() {
	settingsEl.classList.remove("open");
	settingsBack.classList.remove("open");
	settingsEl.setAttribute("aria-hidden", "true");
}
$("settings-btn").onclick = openSettings;
$("settings-close").onclick = closeSettings;
settingsBack.onclick = closeSettings;
// density toggle → drives renderSubagentView; persist as a hint.
const saDensitySel = $("sa-density");
if (subagentDensity) saDensitySel.value = subagentDensity;
saDensitySel.onchange = () => {
	subagentDensity = saDensitySel.value;
	localStorage.setItem("pi:sa-density", subagentDensity);
};

// ---- subagent tier-model selects ----
// Defaults mirror subagent.ts TIERS exactly. The server holds the truth
// (~/.pi/agent/subagent-tiers.json, re-read by the extension each call); we load
// it, preselect, and POST on change. localStorage is only a reload hint.
const TIER_DEFAULTS = {
	capable: "zai/glm-5.2",
	implement: "zai/glm-5-turbo",
	lookup: "zai/glm-4.5-air",
};
const tierSels = {
	capable: $("tier-capable"),
	implement: $("tier-implement"),
	lookup: $("tier-lookup"),
};
// build each select from availableModels once that list arrives; preselect the
// current config value (or the default). Called from populateModels().
function populateTierSelects() {
	for (const tier of Object.keys(tierSels)) {
		const sel = tierSels[tier];
		const cur = sel.dataset.model || TIER_DEFAULTS[tier];
		sel.innerHTML = "";
		for (const m of availableModels) {
			const id = m.provider + "/" + m.id;
			const o = document.createElement("option");
			o.value = id;
			o.textContent = (m.name || m.id) + " · " + m.provider;
			if (id === cur) o.selected = true;
			sel.appendChild(o);
		}
		if (!availableModels.length) {
			const o = document.createElement("option");
			o.textContent = TIER_DEFAULTS[tier];
			sel.appendChild(o);
		}
	}
}
async function loadTierConfig() {
	try {
		const r = await fetch("/api/subagent-tiers").then((r) => r.json());
		if (!r || !r.ok || !r.tiers) return;
		for (const tier of Object.keys(tierSels)) {
			const m = r.tiers[tier] || TIER_DEFAULTS[tier];
			tierSels[tier].dataset.model = m;
			localStorage.setItem("pi:tier-" + tier, m);
		}
		populateTierSelects();
	} catch {
		/* non-fatal — selects keep defaults */
	}
}
loadTierConfig();
function saveTierConfig() {
	const tiers = {};
	for (const tier of Object.keys(tierSels)) {
		const m = tierSels[tier].value;
		tiers[tier] = m;
		localStorage.setItem("pi:tier-" + tier, m);
	}
	fetch("/api/subagent-tiers", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(tiers),
	}).catch(() => {}); // fire-and-forget; the extension re-reads on next call
}
for (const tier of Object.keys(tierSels))
	tierSels[tier].onchange = saveTierConfig;

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
// ---- sessions: list + resume older sessions ----
// /api/sessions (server.js) enumerates this project's JSONL; switch_session
// (RPC) swaps the live pi session to the chosen file, then the response handler
// above re-fetches get_state/get_messages to repaint the transcript.
function pathEq(a, b) {
	// slash/case-agnostic: paths from the server and from pi may differ in form
	return (
		String(a).replace(/\\/g, "/").toLowerCase() ===
		String(b).replace(/\\/g, "/").toLowerCase()
	);
}
function fmtSessionDate(iso) {
	const d = new Date(iso);
	if (isNaN(d)) return "—";
	const now = new Date();
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();
	const yest = new Date(now);
	yest.setDate(now.getDate() - 1);
	const isYest =
		yest.getFullYear() === d.getFullYear() &&
		yest.getMonth() === d.getMonth() &&
		yest.getDate() === d.getDate();
	const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	if (sameDay) return "today " + hm;
	if (isYest) return "yesterday " + hm;
	return (
		d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + hm
	);
}
async function showSessions() {
	showModal(`<h3>Sessions</h3><p class="um-hint">loading…</p>`, true);
	let data;
	try {
		data = await (await fetch("/api/sessions")).json();
	} catch (e) {
		data = { ok: false, error: e.message };
	}
	const rows = (data.ok && data.sessions) || [];
	if (!data.ok) {
		card.innerHTML = `<h3>Sessions</h3><p class="um-hint">${esc(
			data.error || "failed to load",
		)}</p>`;
		return;
	}
	if (!rows.length) {
		card.innerHTML = `<h3>Sessions</h3><p class="um-hint">no sessions yet</p>`;
		return;
	}
	card.innerHTML = `<h3>Sessions</h3><div class="sessions"></div>`;
	const host = card.querySelector(".sessions");
	rows.forEach((s) => {
		const current = curSessionFile && pathEq(s.path, curSessionFile);
		const row = document.createElement("div");
		row.className = "srow" + (current ? " current" : "");
		row.innerHTML =
			`<div class="smeta"><span class="sdate">${esc(
				fmtSessionDate(s.when),
			)}</span><span class="scount">${s.messages || 0} msg${
				current ? " · current" : ""
			}</span></div>` + `<div class="sprev">${esc(s.preview)}</div>`;
		row.onclick = () => resumeSession(s.path, current);
		host.appendChild(row);
	});
}
function resumeSession(sessionPath, current) {
	hideModal();
	if (current) return; // already active — nothing to resume
	setTodos([]); // fresh todo panel for the resumed session
	transcript.innerHTML = "";
	toolBlocks.clear();
	api({ type: "switch_session", sessionPath, id: "resume" });
}

sendBtn.onclick = send;
stopBtn.onclick = () => api({ type: "abort" });
compactBtn.onclick = () => api({ type: "compact" });
$("new").onclick = () => {
	if (
		confirm("Start a new session? Current chat stays saved on the pi side.")
	) {
		setTodos([]); // clear the todo panel for the fresh session
		api({ type: "new_session" });
	}
};
$("sessions").onclick = showSessions;

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
