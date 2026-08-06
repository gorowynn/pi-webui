const $ = (id) => document.getElementById(id);
function setSafeHtml(el, html) {
	// markdown output is sanitized by md.js; other dynamic fragments use esc().
	const range = document.createRange();
	range.selectNodeContents(el);
	el.replaceChildren(range.createContextualFragment(html));
}
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
let replayArgs = {}; // toolCallId -> args, rebuilt per replay (renderMessage)
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
const stripAnsi = (s) =>
	String(s).replace(/(?:\u001b\[|\u009b)[0-9;]*[A-Za-z]/g, "");

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
	if (nearBottom()) {
		pinned = true;
		unread = 0;
	} else if (top + 4 < lastScrollTop) {
		pinned = false;
	}
	lastScrollTop = top;
	refreshJump();
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
// ponytail: keep pinned users glued to the bottom when transcript layout
// changes for ANY reason, not just streaming renders. <details> expanders
// (tool blocks auto-opening for diffs / auto-closing on long results, thinking
// traces the user opens) and async diff content (mountSideBySide fetches
// /api/file, then lays out AFTER the trailing autoscroll already ran) all
// change scrollHeight outside the render cycle and used to drift the viewport
// off the bottom ("autoscroll doesn't behave correctly"). One observer catches
// them; autoscroll() is rAF-coalesced + pinned-gated, so this is cheap and
// self-suppresses when the user scrolled up to read.
new MutationObserver(() => autoscroll()).observe(transcript, {
	childList: true,
	subtree: true,
	attributes: true,
	attributeFilter: ["open"],
});
// ponytail: chat-app scroll affordance. Sticky-bottom while near the bottom
// (autoscroll follows); scroll up to read and a floating "↓ N new" pill surfaces
// so new output isn't silently missed. Click it (or scroll back, or send) →
// re-pin + snap. unread = assistant turns that landed while scrolled away.
let unread = 0;
const jumpBottom = document.getElementById("jump-bottom");
function refreshJump() {
	if (!jumpBottom) return;
	const show = !pinned;
	if (jumpBottom.classList.contains("show") !== show)
		jumpBottom.classList.toggle("show", show);
	const lbl = unread > 0 ? `↓ ${unread} new` : "↓";
	if (jumpBottom.textContent !== lbl) jumpBottom.textContent = lbl;
}
if (jumpBottom)
	jumpBottom.addEventListener("click", () => {
		pinned = true;
		unread = 0;
		refreshJump();
		transcript.scrollTo({
			top: transcript.scrollHeight,
			behavior: "smooth",
		});
	});

function addUser(text) {
	const m = document.createElement("div");
	m.className = "msg";
	setSafeHtml(
		m,
		`<div class="bubble user"><div class="role you">you</div></div>`,
	);
	const b = m.querySelector(".user");
	const span = document.createElement("div");
	setSafeHtml(span, md(text));
	b.appendChild(span);
	transcript.appendChild(m);
	pinned = true;
	unread = 0;
	scrollDown();
	refreshJump();
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
	setSafeHtml(m, `<div class="bubble"><div class="role">assistant</div></div>`);
	const p = document.createElement("div");
	setSafeHtml(p, md(text));
	m.querySelector(".bubble").appendChild(p);
	transcript.appendChild(m);
	scrollDown();
}

function newAssistantBubble() {
	const m = document.createElement("div");
	m.className = "msg";
	setSafeHtml(m, `<div class="bubble"><div class="role">assistant</div></div>`);
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
		content: [], // raw {type:"text"|"thinking"} blocks; streamed live + finalized at message_end
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
// ponytail: throttle text paints to ~8/s while streaming (renderThink is
// 300ms for the same reason) — re-parsing the WHOLE growing buffer through
// markdown-it every rAF saturates the main thread on long messages: scroll
// freezes and renders stall (looks like "messages don't update"). force=true
// bypasses for the authoritative final render (renderAssistantContent).
let lastTextPaint = 0;
function renderText(force) {
	if (cur && cur.textPar) {
		const now = performance.now();
		if (!force && now - lastTextPaint < 120) return;
		lastTextPaint = now;
		setSafeHtml(cur.textPar, md(cur.textBuf));
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
			(b.type === "text" && b.text) ||
			(b.type === "thinking" && b.thinking) ||
			(b.type === "image" && b.data),
	);
}
// ponytail: syntax-highlight code blocks via the vendored highlight.js
// (vendor/highlight.min.js, loaded before app.js). Pure post-process over the
// DOM renderAssistantContent just built — md.js already emits
// <pre><code class="language-xxx">. Gated so a missing/removed asset degrades
// silently to uncolored output. Deferred: an IntersectionObserver highlights a
// block only once it's within ~800px of the viewport (plan 1.1 / R§1.2), so a
// long message with many blocks doesn't jank the frame highlighting them all at
// once. One reused module-level observer (no per-render leak); highlighting is
// sticky (the dataset flag keeps it colored after one pass). Re-render builds
// fresh nodes (finalizeBubble resets cursors, gotcha #13) so no stale-highlight
// guarding is needed; the :not([data-highlighted]) selector skips done nodes.
let hlObserver = null;
function highlightCode(root) {
	if (!window.hljs || !root) return;
	const blocks = root.querySelectorAll("pre code:not([data-highlighted])");
	if (!blocks.length) return;
	if (!("IntersectionObserver" in window)) {
		blocks.forEach(hlEl);
		return;
	}
	if (!hlObserver)
		hlObserver = new IntersectionObserver(
			(entries, obs) => {
				for (const e of entries) {
					if (e.isIntersecting) {
						hlEl(e.target);
						obs.unobserve(e.target);
					}
				}
			},
			{ rootMargin: "800px" },
		);
	blocks.forEach((b) => hlObserver.observe(b));
}
function hlEl(el) {
	el.dataset.highlighted = "1";
	try {
		hljs.highlightElement(el);
	} catch (e) {}
}
// ponytail: the AUTHORITATIVE render path for assistant text + thinking blocks,
// shared by message_end (finalizeBubble) and reload (renderMessage). Text ALSO
// streams live now (scheduleRender→renderText, re-enabled with markdown-it), but
// this is the definitive render from pi's payload.message.content — so live and
// reload read byte-identical input and can't diverge. Thinking streams live via
// renderThink (now md()); this re-renders its finalized form.
function renderAssistantContent(content) {
	for (const b of nonEmptyContent(content)) {
		if (b.type === "text") {
			cur.textBuf = b.text || "";
			ensureTextPar();
			renderText(true);
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
		} else if (b.type === "image" && b.data) {
			// ponytail: render an image content part as a data-URL <img> (plan 1.5 /
			// R§3.2). mimeType allowlist is enforced at the sender (image input, plan
			// 4.10); here we just render whatever the model/pi emitted. <img> from a
			// data URL has no script surface.
			const img = document.createElement("img");
			img.className = "message-image";
			img.alt = "";
			img.src = `data:${b.mimeType || "image/png"};base64,${b.data}`;
			cur.bubble.appendChild(img);
		}
	}
	highlightCode(cur.bubble);
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
	setSafeHtml(cur.bubble, "");
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
	setSafeHtml(
		d,
		`<summary><span class="tspin"></span><span class="tcaret">▸</span>` +
			`<span class="tlabel">${active ? "thinking" : "thoughts"}</span>` +
			`<span class="tcount"></span></summary><div class="tbody"></div>`,
	);
	const body = d.querySelector(".tbody");
	cur.bubble.appendChild(d);
	cur.thinkEl = body;
	cur.thinkDetails = d;
	cur.thinkLabel = d.querySelector(".tlabel");
	cur.thinkCount = d.querySelector(".tcount");
	// opened a collapsed trace — paint whatever we have right now (the
	// streaming path skips body paints while closed).
	d.addEventListener("toggle", () => {
		// ponytail: thinking is markdown now (renderThink uses md()). Paint the
		// parsed buffer on open so a collapsed trace shows formatted, not raw.
		if (d.open) setSafeHtml(body, md(d.__buf || ""));
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
		setSafeHtml(cur.thinkEl, md(buf));
		autoscroll();
	}
}
// ponytail: coalesce live paints to one rAF. BOTH text and thinking stream
// live now (re-enabled with markdown-it — partial input renders its literal/
// partial form, and message_end finalize corrects to the authoritative text;
// see gotcha #13). renderText/renderThink each guard on their own cursor, so a
// rAF for one no-ops the other. thinking_end/finalize paint directly for an
// immediate final paint.
let renderRaf = 0;
function scheduleRender() {
	if (renderRaf) return;
	renderRaf = requestAnimationFrame(() => {
		renderRaf = 0;
		renderText();
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
		setSafeHtml(
			el,
			`<summary class="head"><span class="trow"><span class="caret">▸</span><span class="name">${esc(name || "tool")}</span></span>${argsHtml}</summary><div class="out"></div>`,
		);
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
	setSafeHtml(host, html);
}
// ---- edit diff: syntax highlight via vendored highlight.js ----
// ponytail: highlight the WHOLE file once (so multi-line tokens like block
// comments / strings stay correct), then split the HTML on newlines while
// rebalancing open <span>s so each diff row is standalone valid HTML.
function splitHtmlLines(html) {
	const lines = [];
	let cur = "";
	const stack = []; // open span class strings
	const tokRe = /<[^>]*>|[^<]+/g;
	let m;
	while ((m = tokRe.exec(html))) {
		const tok = m[0];
		if (tok[0] === "<") {
			if (tok[1] === "/") {
				if (stack.length) stack.pop();
				cur += tok;
			} else if (tok.endsWith("/>")) {
				cur += tok;
			} else {
				stack.push((tok.match(/class="([^"]*)"/) || [, ""])[1]);
				cur += tok;
			}
		} else {
			const parts = tok.split("\n");
			for (let i = 0; i < parts.length; i++) {
				if (i > 0) {
					for (let k = stack.length - 1; k >= 0; k--) cur += "</span>";
					lines.push(cur);
					cur = stack.map((c) => `<span class="${c}">`).join("");
				}
				cur += parts[i];
			}
		}
	}
	lines.push(cur);
	return lines;
}
function highlightLines(text, lang) {
	if (!window.hljs || !text) return null;
	try {
		const res =
			lang && hljs.getLanguage(lang)
				? hljs.highlight(text, { language: lang })
				: hljs.highlightAuto(text);
		return splitHtmlLines(res.value);
	} catch (_e) {
		return null;
	}
}
// map a file path to an hljs language id; unknowns fall through to getLanguage.
function langOf(path) {
	const e = (path || "").match(/\.([a-z0-9]+)$/i);
	if (!e) return null;
	const map = {
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		ts: "typescript",
		tsx: "typescript",
		py: "python",
		rb: "ruby",
		go: "go",
		rs: "rust",
		java: "java",
		kt: "kotlin",
		kts: "kotlin",
		scala: "scala",
		css: "css",
		less: "less",
		scss: "scss",
		html: "xml",
		htm: "xml",
		xml: "xml",
		md: "markdown",
		markdown: "markdown",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		yml: "yaml",
		yaml: "yaml",
		toml: "ini",
		json: "json",
		jsonc: "json",
		c: "c",
		h: "c",
		cpp: "cpp",
		cc: "cpp",
		cxx: "cpp",
		hpp: "cpp",
		cs: "csharp",
		php: "php",
		swift: "swift",
		sql: "sql",
		dockerfile: "dockerfile",
		makefile: "makefile",
		vue: "xml",
		svelte: "xml",
	};
	return map[e[1].toLowerCase()] || e[1].toLowerCase();
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
function rowsToSides(rows, hlOld, hlNew) {
	const left = [],
		right = [];
	let on = 0, // old file line counter
		nn = 0; // new file line counter
	const hl = (arr, i) => (arr && arr[i] != null ? arr[i] : null);
	rows.forEach((r) => {
		if (r.kind === "ctx") {
			left.push({
				s: r.left,
				cls: "ln-ctx",
				num: ++on,
				html: hl(hlOld, on - 1),
			});
			right.push({
				s: r.right,
				cls: "ln-ctx",
				num: ++nn,
				html: hl(hlNew, nn - 1),
			});
		} else if (r.kind === "del") {
			left.push({
				s: r.left,
				cls: "ln-del",
				num: ++on,
				html: hl(hlOld, on - 1),
			});
			right.push({ s: null, cls: "ln-empty", num: null });
		} else if (r.kind === "add") {
			left.push({ s: null, cls: "ln-empty", num: null });
			right.push({
				s: r.right,
				cls: "ln-add",
				num: ++nn,
				html: hl(hlNew, nn - 1),
			});
		} else {
			left.push({
				s: r.left,
				cls: "ln-del",
				num: ++on,
				html: hl(hlOld, on - 1),
			});
			right.push({
				s: r.right,
				cls: "ln-add",
				num: ++nn,
				html: hl(hlNew, nn - 1),
			});
		}
	});
	return { left, right, maxNum: Math.max(on, nn) };
}
function sideHtml(lines) {
	return lines
		.map((l) => {
			const num = l.num == null ? "\u00a0" : String(l.num);
			const txt =
				l.html != null
					? l.html
					: l.s == null || l.s === ""
						? "\u00a0"
						: esc(l.s);
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
	const cap = !!(opt && opt.capture);
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
		const lang = langOf(path);
		const sides = rowsToSides(
			diffRows(o, n),
			highlightLines(o, lang),
			highlightLines(n, lang),
		);
		return {
			leftHtml: sideHtml(sides.left),
			rightHtml: sideHtml(sides.right),
			gutter: gutterCh(sides.maxNum),
		};
	};
	const init = compute(baseOld, baseNew);
	setSafeHtml(
		host,
		`<div class="dpath">${esc(path || "(no path)")}${isWrite ? ' <span class="sx-tag">write</span>' : ""}</div>` +
			`<div class="sxs" style="--sx-gutter:${init.gutter}">` +
			`<div class="sx-col sx-old"><div class="sx-hdr">\u2212 original</div><div class="sx-body sx-left">${init.leftHtml}</div></div>` +
			`<div class="sx-col sx-new"><div class="sx-hdr">+ ${cap ? "proposal" : "edited"}${ro || cap ? "" : ' <button class="sx-apply" type="button">Apply</button>'}</div>` +
			(ro
				? `<div class="sx-body sx-right">${init.rightHtml}</div>`
				: `<div class="sx-edit"><div class="sx-body sx-hlbody" aria-hidden="true">${init.rightHtml}</div><textarea class="sx-ta" spellcheck="false" wrap="off"></textarea></div>`) +
			`</div></div>`,
	);
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
					if (gnum) setSafeHtml(gnum, "\u00a0");
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
		// ponytail: caller may pass a precomputed start line (a multi-hunk
		// edit that already fetched the file once to badge its hunks) - use
		// it directly instead of a second /api/file hit.
		const applyStart = (start) => {
			if (start) {
				lineStart = start;
				patchGutters(start);
			}
		};
		if (opt && opt.startLine != null) applyStart(opt.startLine);
		else findStartLine(path, baseOld, baseNew).then(applyStart);
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
		setSafeHtml(rightBody, c.rightHtml);
		setSafeHtml(leftBody, c.leftHtml);
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
	if (applyBtn)
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
// describeTool (the tool-call header label) moved to tool-presentation.js as
// toolPresent.describeToolCall (plan 2.1 / F§4.4). Thin alias keeps the existing
// call site readable.
function describeTool(name, args) {
	return toolPresent.describeToolCall(name, args);
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

// ponytail: two-tier toasts (plan 3.3 / U§2.5). Errors are sticky — they stay
// until dismissed (a failed send no longer vanishes); info/ok auto-dismiss and
// warn lingers longer. Stacked bottom-right in a #toast-stack container; click
// anywhere or the × to dismiss. CSS slide respects prefers-reduced-motion.
let toastStack = null;
function toast(msg, kind) {
	if (!toastStack) {
		toastStack = document.createElement("div");
		toastStack.id = "toast-stack";
		toastStack.setAttribute("aria-live", "polite");
		document.body.appendChild(toastStack);
	}
	const sticky = kind === "err" || kind === "error";
	const t = document.createElement("div");
	t.className = "toast" + (kind ? " " + kind : "") + (sticky ? " sticky" : "");
	t.setAttribute("role", sticky ? "alert" : "status");
	const span = document.createElement("span");
	span.className = "toast-msg";
	span.textContent = msg;
	t.appendChild(span);
	if (sticky) {
		const x = document.createElement("button");
		x.type = "button";
		x.className = "toast-x";
		x.setAttribute("aria-label", "dismiss");
		x.textContent = "×";
		x.onclick = (e) => {
			e.stopPropagation();
			dismissToast(t);
		};
		t.appendChild(x);
	}
	t.onclick = () => dismissToast(t);
	toastStack.appendChild(t);
	requestAnimationFrame(() => t.classList.add("in"));
	if (!sticky) {
		const ms = kind === "warn" ? 6000 : kind === "ok" ? 3000 : 4000;
		setTimeout(() => dismissToast(t), ms);
	}
}
function dismissToast(t) {
	if (!t || !t.parentNode) return;
	t.classList.remove("in");
	t.classList.add("out");
	setTimeout(() => t.remove(), 200);
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
	setSafeHtml(card, html);
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
// OpenCode Go has no public usage API: quota comes from the dashboard page, so
// creds are the workspace id + browser-session cookie (like opencode-bar), not
// the API key. Sent as headers to the server, which falls back to env vars /
// ~/.config/opencode-bar/opencode-go.json when the browser has nothing stored.
const GO_CREDS = "pi:opencode-go-creds";
const getGoCreds = () => {
	try {
		const g = JSON.parse(localStorage.getItem(GO_CREDS) || "{}");
		return g.w && g.c ? g : null;
	} catch {
		return null;
	}
};
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
function codexLimits(data) {
	const rate = data && data.rate_limit;
	if (!rate || typeof rate !== "object") return [];
	return [
		["primary_window", "Short"],
		["secondary_window", "Long"],
	]
		.map(([key, fallback]) => {
			const w = rate[key];
			if (!w || typeof w.used_percent !== "number") return null;
			const seconds = Number(w.limit_window_seconds || 0);
			const resetAfter = Number(w.reset_after_seconds);
			const resetAt = w.reset_at;
			const resetMs = Number.isFinite(resetAfter)
				? Date.now() + resetAfter * 1000
				: typeof resetAt === "number"
					? resetAt * 1000
					: typeof resetAt === "string"
						? Date.parse(resetAt)
						: NaN;
			const label =
				seconds > 0 && seconds % 86400 === 0
					? `${seconds / 86400}d`
					: seconds > 0 && seconds % 3600 === 0
						? `${seconds / 3600}h`
						: fallback;
			return {
				label,
				pct: w.used_percent,
				windowMs: seconds * 1000,
				reset: Number.isFinite(resetMs) ? new Date(resetMs) : null,
			};
		})
		.filter(Boolean);
}
// OpenCode Go subscription windows arrive server-side-parsed from the dashboard
// HTML: rollingUsage (5h) / weeklyUsage / monthlyUsage, each
// {usagePercent, resetInSec} (seconds until reset). Percent-only bars, like
// Codex. The label IS the window, so no windowMs/window text is needed.
function opencodeGoLimits(data) {
	if (!data || typeof data !== "object") return [];
	return [
		["rollingUsage", "5h"],
		["weeklyUsage", "7d"],
		["monthlyUsage", "30d"],
	]
		.map(([key, label]) => {
			const w = data[key];
			if (!w || typeof w.usagePercent !== "number") return null;
			const resetMs =
				typeof w.resetInSec === "number"
					? Date.now() + w.resetInSec * 1000
					: NaN;
			return {
				label,
				pct: w.usagePercent,
				reset: Number.isFinite(resetMs) ? new Date(resetMs) : null,
			};
		})
		.filter(Boolean);
}
function pctOf(b) {
	if (typeof b.pct === "number") return Math.max(0, Math.min(100, b.pct));
	return b.total > 0 ? Math.min(100, (b.used / b.total) * 100) : 0;
}
function quotaValue(b) {
	const left = Math.max(0, 100 - pctOf(b));
	if (typeof b.used === "number")
		return `${fmtTokens(Math.max(0, b.total - b.used))} left / ${fmtTokens(b.total)} · ${left.toFixed(1)}%`;
	return `${left.toFixed(1)}% left`;
}
function quotaEndpoint(provider) {
	const k = usageViewKind(provider);
	if (k === "codex-quota") return "/api/codex-usage";
	if (k === "opencode-go-quota") return "/api/opencode-usage";
	return "/api/zai-usage";
}
function quotaLimits(provider, data) {
	const k = usageViewKind(provider);
	if (k === "codex-quota") return codexLimits(data);
	if (k === "opencode-go-quota") return opencodeGoLimits(data);
	return zaiLimits(data);
}
async function fetchQuotaUsage(provider) {
	const k = usageViewKind(provider);
	let opt;
	if (k === "zai-quota") opt = { headers: { "X-ZAI-Key": getZaiKey() } };
	else if (k === "opencode-go-quota") {
		let go = { w: "", c: "" };
		try {
			go = JSON.parse(localStorage.getItem(GO_CREDS) || "{}");
		} catch {}
		opt = {
			headers: {
				"X-OpenCode-Go-Workspace": go.w || "",
				"X-OpenCode-Go-Cookie": go.c || "",
			},
		};
	}
	return fetch(quotaEndpoint(provider), opt).then((r) => r.json());
}
function zaiBarHtml(b) {
	const pct = pctOf(b);
	const cls = pct >= 90 ? "hi" : pct >= 70 ? "mid" : "lo";
	const val = quotaValue(b);
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
// Compact cards keep all three windows visible in the narrow header (Codex has
// two, OpenCode Go has three). Each quota bar owns the reset text directly
// beneath it, so their values can't mix.
function renderUsageInline(bars) {
	return bars
		.slice(0, 3)
		.map((bar) => {
			const pct = pctOf(bar);
			const cls = pct >= 90 ? "hi" : pct >= 70 ? "mid" : "lo";
			const val = quotaValue(bar);
			const remain = bar.reset ? bar.reset - Date.now() : null;
			const reset = remain != null ? `reset in ${fmtDur(remain)}` : "";
			return (
				`<div class="ub-window" title="${esc(bar.label)}: ${esc(val)}${reset ? `; ${reset}` : ""}">` +
				`<div class="ub-head"><span class="ub-lbl">${esc(bar.label)}</span><span class="ub-val">${esc(val)}</span></div>` +
				`<span class="ub-track"><span class="ub-fill ${cls}" style="width:${pct}%"></span></span>` +
				`<span class="ub-reset">${esc(reset)}</span></div>`
			);
		})
		.join("");
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
function opencodeGoCredsForm() {
	return (
		`<p class="um-hint">OpenCode Go has no public usage API — the quota windows ` +
		`live in the dashboard, so it needs your dashboard login, not the API key. ` +
		`Stored only in this browser; the server also reads ` +
		`<code>OPENCODE_GO_WORKSPACE_ID</code> + ` +
		`<code>OPENCODE_GO_AUTH_COOKIE</code> env or ` +
		`<code>~/.config/opencode-bar/opencode-go.json</code>.</p>` +
		`<details class="um-raw"><summary>how to get these</summary>` +
		`<ol class="um-hint">` +
		`<li>Log in at <code>opencode.ai</code> (the console).</li>` +
		`<li>Open the <b>Go</b> dashboard — either from the sidebar or by navigating ` +
		`to <code>opencode.ai/workspace/…/go</code>.</li>` +
		`<li>In the address bar, copy the <code>wrk_…</code> part of the URL — ` +
		`that's the workspace ID. Paste it into the first field.</li>` +
		`<li>Press <code>F12</code> → <b>Application</b> tab → <b>Cookies</b> → ` +
		`<code>https://opencode.ai</code> (in Chrome/Edge; <code>Storage</code> → ` +
		`<b>Cookies</b> in Firefox).</li>` +
		`<li>Find the <b><code>auth</code></b> cookie and copy its value (the long ` +
		`token — or the whole <code>auth=…</code> string, both work). Paste it into ` +
		`the second field.</li>` +
		`<li>Save — the bar then shows the 5h / 7d / 30d quota windows. If you ` +
		`have several workspaces, pick the one whose dashboard URL ends in /go.</li>` +
		`</ol></details>` +
		`<form id="um-go-form"><input id="um-go-w" class="um-key" placeholder="workspace id (wrk_…)" autocomplete="off" />` +
		`<input type="password" id="um-go-c" class="um-key" placeholder="opencode.ai auth cookie" autocomplete="off" />` +
		`<div class="row"><button>Save &amp; load</button></div></form>`
	);
}
function usageProviderLabel(provider) {
	if (/opencode/i.test(provider || "")) return "OpenCode Go";
	return /codex/i.test(provider || "") ? "ChatGPT/Codex" : provider || "model";
}
let sessionUsage = null;
function renderSessionUsage(provider) {
	const t = sessionUsage;
	if (!t)
		return `<p class="um-hint">${esc(usageProviderLabel(provider))} session usage is loading…</p>`;
	const rows = [
		["input", t.input],
		["output", t.output],
		["cache read", t.cacheRead],
		["cache write", t.cacheWrite],
		["total", t.total],
	]
		.map(
			([label, value]) =>
				`<div class="um-bar"><div class="um-head"><span class="um-lbl">${label}</span><span class="um-val">${typeof value === "number" ? fmtTokens(value) : "—"} tokens</span></div></div>`,
		)
		.join("");
	return (
		`<div class="um-meta"><span>${esc(usageProviderLabel(provider))} · pi session</span></div>` +
		rows +
		`<p class="um-hint">Subscription allowance is available in your provider account; pi RPC reports session tokens only.</p>`
	);
}
async function renderUsage(provider) {
	if (usageViewKind(provider) === "session")
		return renderSessionUsage(provider);
	const u = await fetchQuotaUsage(provider);
	if (provider !== currentProvider) return null;
	if (!u.ok && usageViewKind(provider) === "zai-quota") {
		if (u.error === "no API key" && !getZaiKey()) return usageKeyForm();
	}
	if (!u.ok && usageViewKind(provider) === "opencode-go-quota") {
		if (u.error === "no workspace credentials" && !getGoCreds())
			return opencodeGoCredsForm();
	}
	if (!u.ok)
		return (
			`<p class="um-err">\u26a0 ${esc(u.error || "request failed")}` +
			`${u.status ? ` (HTTP ${u.status})` : ""}</p>` +
			(u.raw
				? `<details class="um-raw"><summary>response</summary><pre>${esc(u.raw)}</pre></details>`
				: "")
		);
	const bars = quotaLimits(provider, u.data);
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
	const provider = currentProvider;
	const title = `${usageProviderLabel(provider)} usage`;
	showModal(`<h3>${esc(title)}</h3><p class="um-hint">loading\u2026</p>`, true);
	let inner;
	try {
		inner = await renderUsage(provider);
	} catch (e) {
		inner = `<p class="um-err">\u26a0 ${esc(e.message)}</p>`;
	}
	if (provider !== currentProvider) return showUsage();
	setSafeHtml(card, `<h3>${esc(title)}</h3>` + inner);
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
	const goForm = card.querySelector("#um-go-form");
	if (goForm)
		goForm.onsubmit = (e) => {
			e.preventDefault();
			localStorage.setItem(
				GO_CREDS,
				JSON.stringify({
					w: $("um-go-w").value.trim(),
					c: $("um-go-c").value.trim(),
				}),
			);
			refreshUsageBar();
			showUsage();
		};
}

// ---- usage bar: matches the active model provider ----
const usageBar = $("usagebar");
function renderSessionUsageInline(provider) {
	const total = sessionUsage && sessionUsage.total;
	return `<div class="ub-row"><span class="ub-lbl">${esc(usageProviderLabel(provider))}</span><span class="ub-val">${typeof total === "number" ? `${fmtTokens(total)} tokens` : "loading…"}</span></div>`;
}
async function refreshUsageBar() {
	const provider = currentProvider;
	if (!provider) {
		usageBar.style.display = "none";
		return;
	}
	if (usageViewKind(provider) === "session") {
		setSafeHtml(usageBar, renderSessionUsageInline(provider));
		usageBar.style.display = "flex";
		usageBar.classList.remove("peak");
		usageBar.title = `${usageProviderLabel(provider)} session usage — click for details`;
		return;
	}
	let u;
	try {
		u = await fetchQuotaUsage(provider);
	} catch {
		return;
	}
	if (provider !== currentProvider) return;
	if (!u.ok) {
		// ponytail: a missing-key/missing-creds failure is actionable — show a
		// placeholder bar (click → setup form) instead of hiding silently. Other
		// errors (network, stale cookie) stay hidden; they'd just re-fail every
		// 60s poll.
		const missing =
			(usageViewKind(provider) === "zai-quota" && u.error === "no API key") ||
			(usageViewKind(provider) === "opencode-go-quota" &&
				u.error === "no workspace credentials");
		if (missing) {
			setSafeHtml(
				usageBar,
				`<div class="ub-row"><span class="ub-lbl">${esc(usageProviderLabel(provider))}</span><span class="ub-val">no quota creds</span></div>`,
			);
			usageBar.style.display = "flex";
			usageBar.title = `${usageProviderLabel(provider)} — click to set up quota tracking`;
			return;
		}
		usageBar.style.display = "none";
		return;
	}
	const bars = quotaLimits(provider, u.data);
	if (!bars.length) {
		usageBar.style.display = "none";
		return;
	}
	setSafeHtml(usageBar, renderUsageInline(bars));
	usageBar.style.display = "flex";
	// ponytail: the peak-hours badge is z.ai tokencost-specific — don't show it
	// for Codex or OpenCode Go quota bars.
	usageBar.classList.toggle(
		"peak",
		usageViewKind(provider) === "zai-quota" && inPeakHours(),
	);
	usageBar.title = `${usageProviderLabel(provider)} quota — click for details`;
}
usageBar.onclick = showUsage;

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
	setSafeHtml(tpBody, "");
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
		setSafeHtml(
			row,
			`<span class="ck ${cls}">${ck}</span><span class="id">#${t.id != null ? esc(String(t.id)) : i + 1}</span><span class="sbj">${esc(t.subject)}</span>`,
		);
		tpBody.appendChild(row);
	});
}

// ---- plan/spec sidebar: left rail shows the active SDD set's phase stepper;
// click a reached phase to expand the pane and read its doc as markdown. ----
// ponytail: skills/sdd writes .sdd/{type}_{slug}_{DDMMYYYY}.md (plan/spec/tasks/
// verify); the server (/api/plan-state) globs .sdd and returns them newest-first
// as {phase,slug,date,rel,mtime}. The rail shows only while an active
// (non-verify) set exists; todos live in their own panel, never here.
let planArtifacts = [];
const PHASE_RANK = { plan: 0, spec: 1, tasks: 2, verify: 3 };
// group artifacts into SDD runs by slug+date (legacy fixed-name files share one set)
function planSets() {
	const map = new Map();
	for (const a of planArtifacts) {
		const key = (a.slug || "") + "|" + (a.date || "");
		let s = map.get(key);
		if (!s) {
			s = { slug: a.slug || "", date: a.date || "", arts: [], mtime: 0 };
			map.set(key, s);
		}
		s.arts.push(a);
		if ((a.mtime || 0) > s.mtime) s.mtime = a.mtime;
	}
	return [...map.values()];
}
// highest phase reached in a set + whether the run is complete (verify = terminal)
function setSummary(s) {
	let rank = -1,
		phase = null;
	for (const a of s.arts) {
		const r = PHASE_RANK[a.phase];
		if (r != null && r > rank) {
			rank = r;
			phase = a.phase;
		}
	}
	return {
		slug: s.slug,
		date: s.date,
		mtime: s.mtime,
		phase,
		finished: phase === "verify",
	};
}
// the most-recent set that hasn't reached verify — what the badge signals
function activeSet() {
	let best = null;
	for (const s of planSets()) {
		const sum = setSummary(s);
		if (sum.finished) continue;
		if (!best || sum.mtime > best.mtime) best = sum;
	}
	return best;
}
// ponytail: left SDD rail. Narrow by default (vertical stepper for the active
// set); clicking a reached phase widens the pane and renders that doc. Hidden
// entirely while no active set exists. Replaces the old header badge + modal.
let sddCurArt = null; // artifact shown in the expanded pane (null = collapsed)
let sddInit = false; // restore-once guard so the 30s poll can't reopen a user-closed pane
function updateSddBar() {
	const bar = $("sddbar");
	if (!bar) return;
	const set = activeSet();
	if (!set) {
		bar.setAttribute("aria-hidden", "true");
		bar.classList.remove("open");
		document.body.classList.remove("sdd-on", "sdd-open");
		return;
	}
	bar.setAttribute("aria-hidden", "false");
	document.body.classList.add("sdd-on");
	const sset = planSets().find(
		(x) => (x.slug || "") + "|" + (x.date || "") === set.slug + "|" + set.date,
	);
	const arts = (sset && sset.arts) || [];
	const sum = setSummary(sset || { arts: [] });
	const curRank = PHASE_RANK[sum.phase];
	const rail = $("sdd-rail");
	if (!rail) return;
	setSafeHtml(rail, "");
	for (const ph of ["plan", "spec", "tasks", "verify"]) {
		const art = arts.find((a) => a.phase === ph);
		const reached = PHASE_RANK[ph] <= curRank;
		const isCur = ph === sum.phase && !sum.finished;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "ss-step" + (reached ? " done" : "") + (isCur ? " cur" : "");
		b.disabled = !art;
		b.title = ph + (art ? " — view" : " — not created yet");
		const dot = document.createElement("span");
		dot.className = "ss-dot";
		dot.textContent = reached ? "●" : "○";
		const txt = document.createElement("span");
		txt.className = "ss-txt";
		const lbl = document.createElement("span");
		lbl.className = "ss-lbl";
		lbl.textContent = ph;
		txt.appendChild(lbl);
		// chunk progress: skills/sdd Phase 4 marks each chunk [x] + compliance note
		if (ph === "tasks" && art && art.total) {
			const meta = document.createElement("span");
			meta.className = "ss-meta";
			meta.textContent = art.done + "/" + art.total;
			txt.appendChild(meta);
		}
		b.appendChild(dot);
		b.appendChild(txt);
		const a = art;
		if (a) b.onclick = () => openSddPhase(a);
		rail.appendChild(b);
	}
	// keep an open pane in sync across polls; drop it if its artifact vanished
	if (sddCurArt && bar.classList.contains("open")) {
		const still = arts.find((a) => a.rel === sddCurArt.rel);
		if (still) renderPlanDoc($("sdd-body"), still.rel);
		else closeSddPane();
	}
	// restore the last expanded doc once, after the first poll resolves
	if (!sddInit) {
		sddInit = true;
		try {
			const saved = JSON.parse(localStorage["pi:sddbar"] || "{}");
			if (saved.open && saved.rel) {
				const a = arts.find((x) => x.rel === saved.rel);
				if (a) openSddPhase(a);
			}
		} catch {}
	}
}
function openSddPhase(art) {
	const bar = $("sddbar");
	if (!bar) return;
	// toggle: clicking the phase already shown collapses back to the rail
	if (sddCurArt && sddCurArt.rel === art.rel) {
		closeSddPane();
		return;
	}
	sddCurArt = art;
	bar.classList.add("open");
	document.body.classList.add("sdd-open");
	const prog =
		art.phase === "tasks" && art.total
			? " (" + art.done + "/" + art.total + ")"
			: "";
	$("sdd-title").textContent =
		art.phase + (art.slug ? " · " + art.slug : "") + prog;
	renderPlanDoc($("sdd-body"), art.rel);
	localStorage["pi:sddbar"] = JSON.stringify({ open: true, rel: art.rel });
}
function closeSddPane() {
	sddCurArt = null;
	const bar = $("sddbar");
	if (bar) bar.classList.remove("open");
	document.body.classList.remove("sdd-open");
	localStorage["pi:sddbar"] = JSON.stringify({ open: false });
}
function refreshPlanState() {
	fetch("/api/plan-state")
		.then((r) => r.json())
		.then((j) => {
			planArtifacts = j && Array.isArray(j.artifacts) ? j.artifacts : [];
			updateSddBar();
		})
		.catch(() => {});
}
async function renderPlanDoc(container, rel) {
	setSafeHtml(container, '<p class="um-hint">loading\u2026</p>');
	const r = await fetch("/api/file?path=" + encodeURIComponent(rel));
	const j = await r.json();
	if (!j || !j.ok) {
		setSafeHtml(
			container,
			'<p class="um-err">\u26a0 ' +
				esc((j && j.error) || "read failed") +
				"</p>",
		);
		return;
	}
	setSafeHtml(container, md(j.content || "_(empty)_"));
	highlightCode(container);
}
(function initSddBar() {
	const close = $("sdd-close");
	if (close) close.addEventListener("click", closeSddPane);
	refreshPlanState();
	// ponytail: the 30s poll is declared with the other timers below so it joins
	// the visibilitychange pause/resume (idle-waste fix, c34fb6f family).
})();

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

		setSafeHtml(card, "");
		const form = document.createElement("div");
		form.className = "qform";

		// step indicator + progress bar (only meaningful with >1 question)
		if (total > 1) {
			const prog = document.createElement("div");
			prog.className = "qprog";
			setSafeHtml(
				prog,
				`<div class="qsteps">Step ${qi + 1} of ${total}</div>` +
					`<div class="qbar"><i style="width:${((qi + 1) / total) * 100}%"></i></div>`,
			);
			form.appendChild(prog);
		}

		const blk = document.createElement("div");
		blk.className = "qblk";
		setSafeHtml(
			blk,
			(q.header ? `<span class="qchip">${esc(q.header)}</span>` : "") +
				`<p class="qq">${esc(q.question)}</p>`,
		);

		const body = document.createElement("div");
		body.className = "qbody" + (hasPreview ? " split" : "");
		const list = document.createElement("div");
		list.className = "qopts";

		const optBtn = (o, lbl) => {
			const b = document.createElement("button");
			b.className = "qopt";
			setSafeHtml(
				b,
				`<span class="qlbl">${esc(lbl)}</span>` +
					(o.description
						? `<span class="qdesc">${esc(o.description)}</span>`
						: ""),
			);
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
			setSafeHtml(
				submit,
				`<span class="qlbl">Submit${chosen.size ? " (" + chosen.size + ")" : ""}</span>`,
			);
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
				setSafeHtml(
					pane,
					`<div class="qprev-h">preview</div>` +
						`<pre class="qprev-b">${esc((o && o.preview) || "")}</pre>`,
				);
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
	const tabs = [];
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
		tabs.push(tab);
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
	// ponytail: badge each tab with the hunk's real file line so far-apart
	// edits are obvious at a glance. One fetch; per-panel gutters already
	// show line numbers via mountSideBySide. Best-effort, never blocks.
	if (isEdit && inp.path) {
		fetch("/api/file?path=" + encodeURIComponent(inp.path))
			.then((r) => r.json())
			.then((j) => (j && j.ok && j.content != null ? j.content : null))
			.then((content) => {
				if (!content) return;
				tabs.forEach((tab, i) => {
					const e = inp.edits[i];
					if (!e) return;
					for (const needle of [e.oldText, e.newText]) {
						if (!needle) continue;
						const at = content.indexOf(needle);
						if (at >= 0) {
							const start = content.slice(0, at).split("\n").length;
							tab.textContent += " \u00b7 L" + start;
							tab.title = tab.textContent;
							break;
						}
					}
				});
			})
			.catch(() => {});
	}
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
	const op = curToolName;
	const edits = Array.isArray(inp.edits) ? inp.edits : [];
	if (op === "edit")
		for (const e of edits)
			rightText = rightText.replace(e.oldText || "", e.newText || "");
	else if (op === "write") rightText = inp.content || "";
	// leftText/rightText are the fallback for paths not under the IDE project; the
	// plugin prefers path+op+edits/content for a real, syntax-highlighted diff.
	return {
		filename,
		path,
		op,
		edits,
		content: inp.content || "",
		leftText,
		rightText,
	};
}

// ponytail: the editable approval modal shows the WHOLE file otherwise. Window
// to the hunks + context lines so you approve the actual change, not 500 lines.
// Handles N hunks: one contiguous span from first-hunk-start to last-hunk-end
// (forward-search each so non-unique oldTexts resolve in file order, matching
// buildDiffPayload's sequential replace). old/new stay a matched old→new pair
// that's an exact substring of the file (pi replaces it), so the safeguard
// contract holds. Returns null (→ whole-file) when any oldText isn't found or
// the span already covers the whole file. Write is never narrowed: safeguard
// sets content=newFull, so newFull must be the entire file.
const DIFF_CONTEXT_DEFAULT = 4;
// read fresh each call (no mutable module state — GOTCHAS #8); the stepper
// just writes localStorage then rebuild() re-reads it.
function getDiffCtx() {
	const n = parseInt(localStorage.getItem("pi:diffCtx"), 10);
	return Number.isFinite(n)
		? Math.max(0, Math.min(80, n))
		: DIFF_CONTEXT_DEFAULT;
}
function narrowEditRegions(fileText, edits, ctx) {
	if (!fileText || !edits || !edits.length) return null;
	const fileLines = fileText.split("\n");
	let cursor = 0;
	const spans = [];
	for (const e of edits) {
		const oldT = e.oldText || "";
		if (!oldT) return null;
		const idx = fileText.indexOf(oldT, cursor); // forward search → file order
		if (idx < 0) return null;
		const startLine = fileText.slice(0, idx).split("\n").length - 1;
		spans.push([startLine, startLine + oldT.split("\n").length]);
		cursor = idx + oldT.length;
	}
	const a = Math.max(0, Math.min(...spans.map((s) => s[0])) - ctx);
	const b = Math.min(
		fileLines.length,
		Math.max(...spans.map((s) => s[1])) + ctx,
	);
	if (b - a >= fileLines.length) return null; // span already covers whole file
	const oldWin = fileLines.slice(a, b).join("\n");
	let newWin = oldWin;
	for (const e of edits) {
		if (!newWin.includes(e.oldText)) return null;
		newWin = newWin.replace(e.oldText, e.newText || "");
	}
	return { old: oldWin, new: newWin };
}

// Editable side-by-side for the standalone approval modal: left = current file
// (read-only), right = pi's proposal (editable <textarea>). Returns a getter
// (label) => label | {label, oldFull, newFull} so the button handler ships the
// edit back over the SAME extension_ui_response channel safeguard reads —
// safeguard mutates pi's event.input from oldFull/newFull, so pi applies the
// user's edited version (context stays consistent).
function mountEditableDiff(container, oldText, newText, path) {
	// reuse the highlighted, diff-colored side-by-side (left read-only, right
	// editable); capture mode drops the Apply button + disk write so the
	// approval buttons below capture the edited text instead.
	const host = document.createElement("div");
	host.className = "sx-host";
	container.classList.add("wide");
	container.querySelector(".opts").before(host);
	mountSideBySide(host, path || "", oldText, newText, false, {
		capture: true,
	});
	const ta = host.querySelector(".sx-ta");
	return (label) => {
		const edited = ta.value;
		return edited === newText
			? label
			: { label, oldFull: oldText, newFull: edited };
	};
}

// ponytail: −/N/+ stepper in the new-column header to tune context lines
// around the hunks. Persisted (pi:diffCtx). Only mounted for edits (write
// can't narrow — its newFull must be the whole content). rebuild re-mounts the
// textarea, so set context BEFORE tweaking the proposal (a change drops
// in-flight edits).
function installCtxStepper(card, enabled, rebuild) {
	const hdr = card.querySelector(".sx-new .sx-hdr");
	if (!hdr || !enabled || hdr.querySelector(".sx-ctx")) return;
	const wrap = document.createElement("span");
	wrap.className = "sx-ctx";
	wrap.title = "context lines around the change";
	const dec = document.createElement("button");
	dec.type = "button";
	dec.className = "sx-ctx-btn";
	dec.textContent = "\u2212";
	const num = document.createElement("span");
	num.className = "sx-ctx-n";
	num.textContent = String(getDiffCtx());
	const inc = document.createElement("button");
	inc.type = "button";
	inc.className = "sx-ctx-btn";
	inc.textContent = "+";
	const apply = (v) => {
		localStorage.setItem("pi:diffCtx", String(Math.max(0, Math.min(80, v))));
		rebuild();
	};
	dec.onclick = () => apply(getDiffCtx() - 1);
	inc.onclick = () => apply(getDiffCtx() + 1);
	wrap.append(dec, num, inc);
	hdr.append(wrap);
}

// The webui permission modal, factored out so the IDE-diff path can fall back
// to it. For edit/write it renders an EDITABLE side-by-side so the user can
// tweak pi's proposal before approving; other tools get the read-only preview.
async function openSelectModal(req) {
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
	const isEditWrite = curToolName === "edit" || curToolName === "write";
	let editedValue = null; // (label) => label | {label, oldFull, newFull}
	if (isEditWrite) {
		const payload = await buildDiffPayload();
		// ponytail: build (and rebuild, on context-stepper change) the narrowed
		// editable diff. Reuses the one fetched payload (file unchanged) — just
		// re-windows. Re-mounting recreates the textarea, so set context BEFORE
		// tweaking the proposal (a change drops in-flight edits). Write is never
		// narrowed (newFull must be the whole content).
		const buildDiff = () => {
			let oldT = payload.leftText;
			let newT = payload.rightText;
			if (
				payload.op === "edit" &&
				Array.isArray(payload.edits) &&
				payload.edits.length
			) {
				const nr = narrowEditRegions(
					payload.leftText,
					payload.edits,
					getDiffCtx(),
				);
				if (nr) {
					oldT = nr.old;
					newT = nr.new;
				}
			}
			const prev = card.querySelector(".sx-host");
			if (prev) prev.remove();
			editedValue = mountEditableDiff(card, oldT, newT, payload.path);
			installCtxStepper(card, payload.op === "edit", buildDiff);
		};
		buildDiff();
	} else {
		const stack = renderEditDiffPreviews(card);
		if (stack) {
			card.classList.add("wide");
			card.querySelector(".opts").before(stack);
		}
	}
	const list = card.querySelector(".opts");
	opts.forEach((o) => {
		const b = document.createElement("button");
		const val = o.label;
		const desc = o.description;
		setSafeHtml(
			b,
			esc(val) + (desc ? `<span class='desc'>${esc(desc)}</span>` : ""),
		);
		if (
			maxSev >= 3 &&
			/\b(allow|permit|approve|yes|run|execute|continue)\b/.test(
				(val || "").toLowerCase(),
			)
		)
			b.className = "danger";
		b.onclick = () => {
			hideModal();
			api({
				type: "extension_ui_response",
				id,
				value: editedValue ? editedValue(val) : val,
			});
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
			setSafeHtml(
				widget,
				`<div class="whead">${esc(req.widgetKey || "widget")}</div>${esc(lines.join("\n"))}`,
			);
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
		// stash tool-call args so the matching toolResult below can do typed
		// rendering (read → code/csv/…) on replay too (plan 2.1 / R§2.1).
		for (const c of toolProtocol.toolCallsInMessage(msg))
			replayArgs[c.id] = c.args;
		// suppress empty assistant messages (tool-only / blank) — parity with the
		// live path's finalizeBubble, which also drops them. No bubble = no label.
		if (nonEmptyContent(msg.content).length) {
			newAssistantBubble();
			renderAssistantContent(msg.content);
		}
		cur = null;
	} else if (msg.role === "toolResult") {
		const t = toolProtocol.toolContentText(msg.content);
		const rargs = (msg.toolCallId && replayArgs[msg.toolCallId]) || null;
		const w = toolBlock(
			msg.toolCallId || "r" + Math.random(),
			msg.toolName || "result",
			rargs,
			false,
		);
		w.el.classList.remove("run");
		w.el.classList.add(msg.isError ? "err" : "done");
		w.out.replaceChildren();
		toolPresent.mountToolPreview(w.out, {
			name: msg.toolName,
			args: rargs,
			text: t,
			isError: msg.isError,
		});
	} else if (msg.role === "bashExecution") {
		const el = document.createElement("details");
		el.className = "tool done";
		setSafeHtml(
			el,
			`<summary class="head"><span class="trow"><span class="caret">▸</span><span class="name">bash</span></span><code>${esc(msg.command || "")}</code></summary><div class="out">${esc(msg.output || "")}</div>`,
		);
		transcript.appendChild(el);
	}
}

// ---- streaming state ----
function setStreaming(on) {
	streaming = on;
	stopBtn.disabled = !on;
	if (!on) cur = null;
	rescheduleStats(); // ponytail: poll stats fast while producing, slow while idle
	renderStatusDot();
}
// ponytail: connection-health state for the header dot, so a dead/restarting
// backend stays visible instead of being signalled only by a short-lived toast
// (review: distinct disconnected/restarting/loading/failed states). The dot's
// colour + animation is the single source of truth; setStreaming layers "working"
// (green pulse) on top of the ready state. Bad states also pin the status text.
let connState = "connecting"; // connecting | ready | reconnecting | stopped
function renderStatusDot() {
	// priority: stopped > reconnecting > connecting > working(ready+streaming) > ready
	let cls;
	if (connState === "stopped") cls = "dead";
	else if (connState === "reconnecting") cls = "bad";
	else if (connState === "connecting") cls = "conn";
	else if (streaming) cls = "live";
	else cls = "ready";
	dot.className = cls;
	if (connState === "connecting") statusText.textContent = "connecting…";
	else if (connState === "reconnecting")
		statusText.textContent = "reconnecting…";
	else if (connState === "stopped") statusText.textContent = "webui stopped";
}
function setConnState(s) {
	if (connState === s) return;
	connState = s;
	renderStatusDot();
}
renderStatusDot(); // amber "connecting" dot before the SSE stream opens
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
			if (cur) {
				finalizeBubble(
					payload.message && Array.isArray(payload.message.content)
						? payload.message.content
						: null,
				);
				// ponytail: count toward the "↓ N new" pill if the user scrolled away.
				// cur only exists when text/thinking streamed, so tool-only turns whose
				// bubble was dropped aren't mis-counted.
				if (!pinned) {
					unread++;
					refreshJump();
				}
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
					e.type === "thinking_delta")
			)
				cur = newAssistantBubble();
			if (e.type === "text_start") {
				// ponytail: text streams live again (markdown-it tolerates partial
				// input; message_end does the AUTHORITATIVE render from
				// payload.message.content via finalizeBubble, so a transiently-wrong
				// live token self-corrects — see gotcha #13). cur._blk survives a
				// missing text_end.
				cur._blk = { type: "text", text: "" };
				cur.content.push(cur._blk);
				setActivity("writing…", true);
			} else if (e.type === "text_delta") {
				if (!cur._blk || cur._blk.type !== "text") {
					cur._blk = { type: "text", text: "" };
					cur.content.push(cur._blk);
				}
				cur._blk.text += e.delta || "";
				// mirror to cur.textBuf + paint per rAF (scheduleRender→renderText).
				cur.textBuf = cur._blk.text;
				ensureTextPar();
				scheduleRender();
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
				var w = toolBlocks.get(payload.toolCallId);
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
			const t = toolProtocol.toolContentText(payload.partialResult.content);
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
				t = toolProtocol.toolContentText(
					payload.result && payload.result.content,
				);
				if (
					(payload.toolName === "edit" || payload.toolName === "write") &&
					w.args &&
					!payload.isError
				) {
					// rich side-by-side diff; the new pane is editable + applyable
					w.el.classList.add("hasdiff");
					w.el.open = true;
					setSafeHtml(w.out, "");
					var ea = w.args;
					if (
						payload.toolName === "edit" &&
						Array.isArray(ea.edits) &&
						ea.edits.length
					) {
						// ponytail: one /api/file fetch for the whole edit call, reused
						// to badge each hunk with its real file line (far-apart edits
						// become obvious) and seed the diff gutters without a per-hunk
						// refetch. Misses fall back to the 1-based default.
						const ePath = ea.path || "";
						const fileP = ePath
							? fetch("/api/file?path=" + encodeURIComponent(ePath))
									.then((r) => r.json())
									.then((j) =>
										j && j.ok && j.content != null ? j.content : null,
									)
									.catch(() => null)
							: Promise.resolve(null);
						ea.edits.forEach((e, idx) => {
							const multi = ea.edits.length > 1;
							var dh = null;
							if (multi) {
								dh = document.createElement("div");
								dh.className = "dhunk";
								dh.textContent = `edit ${idx + 1}/${ea.edits.length}`;
								w.out.appendChild(dh);
							}
							var host = document.createElement("div");
							host.className = "sx-host";
							w.out.appendChild(host);
							fileP.then((content) => {
								let start = null;
								if (content) {
									for (const needle of [e.oldText, e.newText]) {
										if (!needle) continue;
										const at = content.indexOf(needle);
										if (at >= 0) {
											start = content.slice(0, at).split("\n").length;
											break;
										}
									}
								}
								if (dh && start)
									dh.textContent = `edit ${idx + 1}/${ea.edits.length} \u00b7 L${start}`;
								mountSideBySide(
									host,
									ePath,
									e.oldText || "",
									e.newText || "",
									false,
									{
										startLine: start,
									},
								);
							});
						});
					} else if (payload.toolName === "write") {
						var host = document.createElement("div");
						host.className = "sx-host";
						w.out.appendChild(host);
						mountSideBySide(host, ea.path || "", null, ea.content || "", true);
					}
					if (t) {
						var rt = document.createElement("div");
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
							var rt = document.createElement("div");
							rt.className = "sa-foot";
							rt.textContent = t;
							w.out.appendChild(rt);
						}
					} else {
						// ponytail: typed tool-output rendering (plan 2.1 / R§2.1).
						// read → numbered highlighted code (2.2) / csv table (2.3) /
						// html iframe (2.4) / svg <img> (2.5); everything else →
						// bounded text preview (2.6). edit/write (diff) + subagent
						// (live view) are handled in their own branches above.
						w.out.replaceChildren();
						toolPresent.mountToolPreview(w.out, {
							name: payload.toolName,
							args: w.args,
							text: t,
							isError: payload.isError,
						});
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
				var pct = Math.round(
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
// ponytail: statusbar secondary group (git/think/cache/tok/$cost/ide) collapses
// to a ⋯ popover under 720px (style.css @media). <details> is default-open so the
// wide layout is inline without fighting the UA's closed-details hiding; we just
// close it on narrow viewports and when the user shrinks into one.
const sbSec = $("sb-sec");
let sbNarrow = window.matchMedia("(max-width: 720px)").matches;
if (sbSec) sbSec.open = !sbNarrow; // wide: inline (open); narrow: popover starts closed
function syncSbOverflow() {
	if (!sbSec) return;
	const n = window.matchMedia("(max-width: 720px)").matches;
	if (n !== sbNarrow) {
		// only react to actual wide<->narrow crossings, not every resize tick, so
		// a user-opened popover isn't snapped shut by a same-mode window nudge.
		sbNarrow = n;
		sbSec.open = !n; // wide -> open (inline); narrow -> closed
	}
}
window.addEventListener("resize", syncSbOverflow);
function refreshSbModel() {
	sb.model.textContent = (modelSel.selectedOptions[0] || {}).textContent || "…";
}
function refreshSbThink() {
	sb.think.textContent = thinkSel.value || "—";
}
// ponytail: header dropdowns for thinking level (set_thinking_level RPC) and
// ponytail mode (/ponytail extension command). Both sync from pi on load;
// the statusbar think readout mirrors the select (refreshSbThink).
["off", "minimal", "low", "medium", "high", "xhigh", "max"].forEach((l) =>
	thinkSel.add(new Option("think: " + l, l)),
);
["off", "lite", "full", "ultra"].forEach((m) =>
	ponySel.add(new Option("pony: " + m, m)),
);
function setThinkSel(level) {
	if (level) thinkSel.value = level;
	refreshSbThink();
}
thinkSel.onchange = () => {
	api({ type: "set_thinking_level", level: thinkSel.value });
	refreshSbThink();
};
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
			noSwitch = !!h.noSwitch;
			document.body.classList.toggle("no-switch", noSwitch);
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
// IDE-connection badge: the JetBrains plugin injects window.piWebuiIdeInfo on
// load and calls window.piWebuiIdeStatus(info) once we register it. Falls to
// "none" when the page isn't IDE-hosted (standalone browser tab).
function updateIdeBadge(info) {
	const el = document.getElementById("sb-ide");
	if (!el) return;
	if (info && info.name) {
		el.textContent = info.name;
		el.title = info.version ? info.name + " " + info.version : info.name;
		el.classList.add("on");
		el.classList.remove("off");
	} else {
		el.textContent = "none";
		el.title = "no IDE hosting this panel (standalone)";
		el.classList.add("off");
		el.classList.remove("on");
	}
}
window.piWebuiIdeStatus = updateIdeBadge;
updateIdeBadge(window.piWebuiIdeInfo || null);
// ---- snapshot bootstrap (plan 0.2 / F§5.1) ----
// One GET /api/snapshot replaces the 4 fire-and-forget init RPCs the client used
// to send (one HTTP round-trip instead of five SSE-matched responses). The
// apply* helpers are the exact logic the SSE init-* handlers used inline —
// factored out so both paths share them (the SSE branches stay as back-compat
// for any future fire-and-forget init id, and sb-stats still serves periodic
// refreshStats polling).
function applyState(data) {
	if (!data) return;
	if (data.thinkingLevel != null) setThinkSel(data.thinkingLevel);
	if (data.isStreaming != null && data.isStreaming) {
		setStreaming(true);
		setActivity("working…", true);
	}
	if (data.isCompacting) {
		setCompacting(true);
		setActivity("compacting context…", true);
	}
	if (setCurrentModel(data.model)) {
		applyCurrentModel();
		refreshUsageBar();
		refreshStats();
	}
	curSessionFile = data.sessionFile || null;
	refreshPonytailMode(data.sessionFile);
	refreshSessionsSidebar();
}
function applyMessages(messages) {
	if (!Array.isArray(messages)) return;
	setSafeHtml(transcript, "");
	toolBlocks.clear();
	replayArgs = {}; // rebuild the toolCall-id → args map for this replay
	messages.forEach(renderMessage);
	scrollDown();
}
function applyCommands(cmds) {
	if (Array.isArray(cmds)) commands = cmds;
}
function applyModels(models) {
	if (Array.isArray(models)) populateModels(models);
}
function applyStats(data) {
	if (!data) return;
	const t = data.tokens || {};
	if (usageViewKind(currentProvider) === "session") {
		sessionUsage = t;
		refreshUsageBar();
	}
	sb.tok.textContent = `${fmt(t.input)}↓ ${fmt(t.output)}↑`;
	// cache hit rate = cacheRead / total input. pi's `input` is the NON-cached
	// portion only (Anthropic convention), so total = input + cacheRead —
	// dividing by `input` alone yielded >100% values (saw 542%). Always ≤100%.
	const inp = t.input || 0;
	const total = inp + (t.cacheRead || 0);
	const hit = total ? Math.round(((t.cacheRead || 0) / total) * 100) : null;
	sb.cache.textContent = `${fmt(t.cacheRead)}↓ ${fmt(t.cacheWrite)}↑${hit != null ? ` ${hit}%` : ""}`;
	sb.cache.title =
		"cache: read↓ (from cache) / write↑ (newly created); % = reads ÷ (reads + fresh input)";
	sb.cost.textContent = data.cost != null ? data.cost.toFixed(3) : "…";
	const cu = data.contextUsage;
	sb.ctx.textContent =
		cu && cu.percent != null
			? `${cu.percent.toFixed(0)}% (${fmt(cu.tokens)}/${fmt(cu.contextWindow)})`
			: "—";
}
// fetch the bundled bootstrap object (state+messages+commands+models+stats) in
// one round-trip and apply it. Fire-and-forget at every call site (like the old
// api() RPCs were) — resolves false on failure; the pi_ready/workspace_changed
// re-sync paths re-call it.
async function fetchSnapshot() {
	try {
		const r = await fetch("/api/snapshot");
		const snap = await r.json();
		if (!snap || !snap.ok) return false;
		applyState(snap.state);
		applyMessages(snap.messages);
		applyCommands(snap.commands);
		applyModels(snap.models);
		applyStats(snap.stats);
		return true;
	} catch {
		return false;
	}
}
// ---- SSE ----
const es = new EventSource("/api/events");
es.onopen = () => {
	setConnState("ready");
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
	fetchSnapshot(); // one GET /api/snapshot instead of 4 fire-and-forget RPCs (plan 0.2)
	refreshWorkspaces(); // populate the left workspace sidebar on (re)connect
};
// ponytail: pause stat/health/usage polling while the tab is backgrounded — avoids
// burning requests every 3s/6s/60s on an unseen window. Re-sync on return.
// stats cadence is streaming-aware: 3s while an agent turn is active (the token/
// cost bar tracks live), 15s idle (cheap drift correction instead of ~20 idle
// RPC round-trips/min pinging pi for get_session_stats). rescheduleStats() flips
// the cadence on each setStreaming.
const STATS_FAST = 3000,
	STATS_IDLE = 15000;
let statsTimer = setInterval(refreshStats, STATS_IDLE);
let healthTimer = setInterval(refreshHealth, 6000);
let usageTimer = setInterval(refreshUsageBar, 60000);
let planTimer = setInterval(refreshPlanState, 30000);
function rescheduleStats() {
	clearInterval(statsTimer);
	statsTimer = setInterval(refreshStats, streaming ? STATS_FAST : STATS_IDLE);
}
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		clearInterval(statsTimer);
		clearInterval(healthTimer);
		clearInterval(usageTimer);
		clearInterval(planTimer);
	} else {
		refreshStats();
		refreshHealth();
		refreshUsageBar();
		refreshPlanState();
		rescheduleStats();
		healthTimer = setInterval(refreshHealth, 6000);
		usageTimer = setInterval(refreshUsageBar, 60000);
		planTimer = setInterval(refreshPlanState, 30000);
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
			if (p.id === "init-state" && p.data) applyState(p.data);
			else if (p.id === "init-msgs" && p.data) applyMessages(p.data.messages);
			else if (p.id === "init-cmds" && p.data) applyCommands(p.data.commands);
			else if (p.id === "init-models" && p.data) applyModels(p.data.models);
			else if (p.id === "sb-stats" && p.data) applyStats(p.data);
			else if (p.command === "set_model" && p.data) {
				if (setCurrentModel(p.data)) {
					localStorage.setItem("pi:model", currentModelId);
					refreshUsageBar();
					refreshStats();
				}
			} else if (
				(p.command === "switch_session" || p.command === "new_session") &&
				(!p.data || !p.data.cancelled)
			) {
				// session replaced (resume / new) — re-render history + state for the now-active session
				fetchSnapshot();
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
		setConnState("reconnecting"); // persist the disconnect — a toast alone is easy to miss
		toast("pi subprocess exited — reconnecting…", "err");
	} else if (env.source === "server" && env.type === "pi_ready") {
		// pi (re)spawned after a crash/exit (server.js startPi). Re-sync state +
		// transcript and flip out of "reconnecting". wasDown gates the toast so a
		// workspace switch — which also respawns pi and emits workspace_changed —
		// doesn't double-toast (the switch keeps connState at "ready").
		const wasDown = connState === "reconnecting";
		setConnState("ready");
		statusText.textContent = "ready";
		setActivity("ready", false);
		fetchSnapshot();
		if (wasDown) toast("pi reconnected", "ok");
	} else if (env.source === "server" && env.type === "workspace_changed") {
		// another tab (or this one) switched project: pi already respawned in the
		// new cwd. Clear the old run's view, re-init from the respawned pi, and
		// refresh the sidebar + SDD rail for the new project. Idempotent — the
		// initiating tab receives its own broadcast too (EC-6).
		setTodos([]);
		setSafeHtml(transcript, "");
		toolBlocks.clear();
		curSessionFile = null;
		setStreaming(false);
		toast(
			`switched to ${env.workspace ? env.workspace.split(/[\\/]/).pop() : "workspace"}`,
			"ok",
		);
		fetchSnapshot();
		refreshWorkspaces();
		refreshSessionsSidebar();
		refreshPlanState();
	} else if (env.source === "server" && env.type === "stopping") {
		showStopped();
	}
};
es.onerror = () => {
	setConnState("reconnecting");
	setActivity("reconnecting…", false);
};

// ponytail: get_available_models returns no current id, so reconcile from
// get_state.model (truth) + a localStorage hint for the very first load.
let currentModelId = null;
let currentProvider = null;
let curSessionFile = null; // active session file (get_state) — highlights the current row in the sessions list
const savedModelId = localStorage.getItem("pi:model");
function modelIdOf(m) {
	return m && m.provider && m.id ? m.provider + "/" + m.id : null;
}
function setCurrentModel(m) {
	const id = modelIdOf(m);
	if (!id) return false;
	if (currentProvider !== m.provider) sessionUsage = null;
	currentModelId = id;
	currentProvider = m.provider;
	return true;
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
	setSafeHtml(modelSel, "");
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
		if (currentProvider !== v.provider) sessionUsage = null;
		currentProvider = v.provider;
		localStorage.setItem("pi:model", currentModelId);
		refreshUsageBar();
		refreshStats();
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
$("refresh-btn").onclick = () => location.reload();
$("settings-btn").onclick = openSettings;
$("settings-close").onclick = closeSettings;
settingsBack.onclick = closeSettings;

// ponytail: in-UI stop. The button POSTs /api/stop; the server kills its pi
// child + exits. We close the SSE stream (no reconnect loop) and mark a static
// "stopped" state — reload the page to start the webui again. Idempotent: the
// initiating tab reaches it via the fetch AND via the "stopping" broadcast.
let stopped = false;
function showStopped() {
	if (stopped) return;
	stopped = true;
	try {
		es.close();
	} catch {}
	setConnState("stopped"); // red steady dot + pinned text (setStreaming renders via connState)
	setStreaming(false);
	setActivity("stopped", false);
	toast("webui stopped — relaunch to restart", "ok");
}
async function stopWebui() {
	try {
		await fetch("/api/stop", { method: "POST" });
	} catch {
		/* server died mid-flight — the "stopping" broadcast / dropped SSE covers it */
	}
	showStopped();
}
$("stop-btn").onclick = stopWebui;
// density toggle → drives renderSubagentView; persist as a hint.
const saDensitySel = $("sa-density");
if (subagentDensity) saDensitySel.value = subagentDensity;
saDensitySel.onchange = () => {
	subagentDensity = saDensitySel.value;
	localStorage.setItem("pi:sa-density", subagentDensity);
};
// theme switch (color + shape + type) → <html data-theme>. The inline head
// script applies the saved value before first paint; here we keep the select
// in sync and persist changes. Anything but "paperlike" (incl. stale "ayu",
// the renamed "obsidian", or null) reads as the "dark" default. localStorage
// hint mirrors pi:sa-density.
const themeSel = $("theme-sel");
themeSel.value =
	localStorage.getItem("pi:theme") === "paperlike" ? "paperlike" : "dark";
themeSel.onchange = () => {
	const t = themeSel.value;
	document.documentElement.setAttribute("data-theme", t);
	localStorage.setItem("pi:theme", t);
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
		setSafeHtml(sel, "");
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
		setSafeHtml(
			card,
			`<h3>Sessions</h3><p class="um-hint">${esc(
				data.error || "failed to load",
			)}</p>`,
		);
		return;
	}
	if (!rows.length) {
		setSafeHtml(
			card,
			`<h3>Sessions</h3><p class="um-hint">no sessions yet</p>`,
		);
		return;
	}
	setSafeHtml(card, `<h3>Sessions</h3><div class="sessions"></div>`);
	const host = card.querySelector(".sessions");
	rows.forEach((s) => {
		const current = curSessionFile && pathEq(s.path, curSessionFile);
		const row = document.createElement("button");
		row.type = "button";
		row.className = "srow" + (current ? " current" : "");
		if (current) row.setAttribute("aria-current", "true");
		setSafeHtml(
			row,
			`<span class="smeta"><span class="sdate">${esc(
				fmtSessionDate(s.when),
			)}</span><span class="scount">${s.messages || 0} msg</span></span>` +
				`<span class="sprev">${esc(s.preview)}</span>`,
		);
		if (current)
			row.disabled = true; // already active
		else row.onclick = () => resumeSession(s.path, false);
		host.appendChild(row);
	});
}
function resumeSession(sessionPath, current) {
	hideModal();
	if (current) return; // already active — nothing to resume
	setTodos([]); // fresh todo panel for the resumed session
	setSafeHtml(transcript, "");
	toolBlocks.clear();
	api({ type: "switch_session", sessionPath, id: "resume" });
}

sendBtn.onclick = send;
stopBtn.onclick = () => api({ type: "abort" });
compactBtn.onclick = () => api({ type: "compact" });
// ponytail: in-DOM confirm — JCEF (the IDE panel) no-ops window.confirm(), and
// the webui uses in-DOM modals everywhere else; this was the lone native dialog.
function confirmModal(msg, onYes) {
	showModal(`<h3>${esc(msg)}</h3><div class="opts"></div>`, true);
	const list = card.querySelector(".opts");
	const no = document.createElement("button");
	no.textContent = "Cancel";
	no.onclick = hideModal;
	const yes = document.createElement("button");
	yes.textContent = "Confirm";
	yes.onclick = () => {
		hideModal();
		onYes();
	};
	list.append(no, yes);
}
$("new").onclick = () =>
	confirmModal(
		"Start a new session? Current chat stays saved on the pi side.",
		() => {
			setTodos([]); // clear the todo panel for the fresh session
			api({ type: "new_session" });
		},
	);
$("sessions").onclick = showSessions;

// ---- left sidebar: workspaces + sessions (FR-6/FR-7/FR-9/FR-10) ----
// workspaces come from /api/workspaces (auto-discovered project roots); the
// sessions section reuses /api/sessions + fmtSessionDate + resumeSession. A
// switch POSTs to /api/workspace; the server's workspace_changed SSE (handled in
// es.onmessage) drives the cross-tab resync — the click just kicks off the
// switch and toasts on failure. Collapse persists in localStorage["pi:wsbar"].
const WS_KEY = "pi:wsbar";
let noSwitch = false; // PI_WEBUI_NO_SWITCH — hide the workspace list (IDE mode)
async function refreshWorkspaces() {
	if (noSwitch) return; // IDE mode: workspace list is hidden — skip fetch/render
	const host = $("ws-workspaces");
	if (!host) return;
	let data;
	try {
		data = await (await fetch("/api/workspaces")).json();
	} catch {
		return;
	}
	const ws = (data.ok && data.workspaces) || [];
	setSafeHtml(host, "");
	if (!ws.length) {
		setSafeHtml(host, '<div class="ws-empty">no workspaces</div>');
		return;
	}
	for (const w of ws) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "ws-row" + (w.active ? " active" : "");
		row.title = w.path;
		if (w.active) row.setAttribute("aria-current", "true");
		setSafeHtml(
			row,
			`<span class="ws-name">${esc(w.name)}</span>` +
				`<span class="ws-meta">${w.sessions || 0} session${
					w.sessions === 1 ? "" : "s"
				}</span>`,
		);
		if (w.active)
			row.disabled = true; // current workspace — can't switch to self
		else row.onclick = () => switchWorkspace(w.path);
		host.appendChild(row);
	}
}
async function switchWorkspace(path) {
	// POST; the workspace_changed SSE resyncs every tab (incl. this one).
	try {
		const r = await (
			await fetch("/api/workspace", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ path }),
			})
		).json();
		if (!r.ok) toast("switch failed: " + (r.error || ""), "err");
	} catch (e) {
		toast("switch failed: " + e.message, "err");
	}
}
async function refreshSessionsSidebar() {
	const host = $("ws-sessions");
	if (!host) return;
	let data;
	try {
		data = await (await fetch("/api/sessions")).json();
	} catch {
		return;
	}
	const rows = (data.ok && data.sessions) || [];
	setSafeHtml(host, "");
	if (!rows.length) {
		setSafeHtml(host, '<div class="ws-empty">no sessions yet</div>');
		return;
	}
	for (const s of rows) {
		const current = curSessionFile && pathEq(s.path, curSessionFile);
		const row = document.createElement("button");
		row.type = "button";
		row.className = "ws-row" + (current ? " active" : "");
		if (current) row.setAttribute("aria-current", "true");
		setSafeHtml(
			row,
			`<span class="ws-name">${esc(s.preview)}</span>` +
				`<span class="ws-meta">${esc(fmtSessionDate(s.when))} · ${
					s.messages || 0
				} msg</span>`,
		);
		if (current)
			row.disabled = true; // already active
		else row.onclick = () => resumeSession(s.path, false);
		host.appendChild(row);
	}
}
function collapseWsbar() {
	document.body.classList.remove("ws-on");
	localStorage.setItem(WS_KEY, "off");
	const open = $("ws-open");
	if (open) open.hidden = false;
}
function expandWsbar() {
	document.body.classList.add("ws-on");
	localStorage.setItem(WS_KEY, "on");
	const open = $("ws-open");
	if (open) open.hidden = true;
	refreshWorkspaces();
	refreshSessionsSidebar();
}
(function initWsbar() {
	// default on (first run); honor an explicit "off".
	if (localStorage.getItem(WS_KEY) === "off") {
		const open = $("ws-open");
		if (open) open.hidden = false;
	} else {
		document.body.classList.add("ws-on");
	}
	const collapse = $("ws-collapse");
	if (collapse) collapse.onclick = collapseWsbar;
	const open = $("ws-open");
	if (open) open.onclick = expandWsbar;
	const neu = $("ws-new");
	if (neu)
		neu.onclick = () =>
			confirmModal(
				"Start a new session? Current chat stays saved on the pi side.",
				() => {
					setTodos([]);
					api({ type: "new_session" });
				},
			);
})();

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
			inputEl.setAttribute("aria-expanded", "true");
			return;
		}
	}
	hidePalette();
}
function renderPalette() {
	setSafeHtml(palette, "");
	palItems.forEach((c, i) => {
		const d = document.createElement("div");
		d.className = "item" + (i === palSel ? " sel" : "");
		d.id = "pal-opt-" + i;
		d.setAttribute("role", "option");
		d.setAttribute("aria-selected", i === palSel ? "true" : "false");
		setSafeHtml(
			d,
			`<span class="nm">/${esc(c.name)}</span> <span class="ds">${esc(c.description || c.source || "")}</span>`,
		);
		d.onclick = () => {
			inputEl.value = "/" + c.name + " ";
			autosize();
			inputEl.focus();
			hidePalette();
		};
		// mouse hover tracks the keyboard highlight (palSel) so hover and
		// selected stay in sync — consistent affordance, per the review.
		d.onmouseenter = () => {
			palSel = i;
			renderPalette();
		};
		palette.appendChild(d);
	});
	inputEl.setAttribute("aria-activedescendant", "pal-opt-" + palSel);
}
function hidePalette() {
	palette.style.display = "none";
	palItems = [];
	palSel = 0;
	inputEl.removeAttribute("aria-activedescendant");
	inputEl.setAttribute("aria-expanded", "false");
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

// ---- command palette (Alt+K / Ctrl+K) (plan 3.4 / U§2.4) ----
// A centered modal launcher over a UNIFIED registry: UI actions (registered
// below) + pi's slash commands (the `commands` array from get_commands). The
// inline "/" palette above is unchanged; this is the global keyboard launcher.
// One registry; future sidebar widgets register their commands via
// registerCommand() so they show up here automatically.
const uiCommands = []; // {id, label, hint, run}
function registerCommand(id, label, hint, run) {
	uiCommands.push({ id, label, hint, run });
}
let cmdkEl = null,
	cmdkInput = null,
	cmdkList = null,
	cmdkSel = 0,
	cmdkItems = [];
function buildCmdK() {
	cmdkEl = document.createElement("div");
	cmdkEl.id = "cmdk";
	cmdkEl.setAttribute("role", "dialog");
	cmdkEl.setAttribute("aria-modal", "true");
	cmdkEl.setAttribute("aria-label", "command palette");
	setSafeHtml(
		cmdkEl,
		'<div class="cmdk-card">' +
			'<input class="cmdk-input" placeholder="type a command or /slash…" autocomplete="off" spellcheck="false">' +
			'<div class="cmdk-list" role="listbox"></div>' +
			"</div>",
	);
	document.body.appendChild(cmdkEl);
	cmdkInput = cmdkEl.querySelector(".cmdk-input");
	cmdkList = cmdkEl.querySelector(".cmdk-list");
	cmdkInput.addEventListener("input", () => {
		cmdkSel = 0;
		refreshCmdK();
	});
	cmdkInput.addEventListener("keydown", onCmdKKey);
	cmdkEl.addEventListener("mousedown", (e) => {
		if (e.target === cmdkEl) closeCmdK();
	});
}
function openCmdK() {
	if (!cmdkEl) buildCmdK();
	cmdkInput.value = "";
	cmdkSel = 0;
	refreshCmdK();
	cmdkEl.style.display = "flex";
	cmdkInput.focus();
}
function closeCmdK() {
	if (cmdkEl) cmdkEl.style.display = "none";
}
function refreshCmdK() {
	const q = cmdkInput.value.trim().toLowerCase();
	const slash = commands.map((c) => ({
		kind: "slash",
		id: c.name,
		label: "/" + c.name,
		hint: c.description || c.source || "",
	}));
	const ui = uiCommands.map((c) => ({
		kind: "ui",
		id: c.id,
		label: c.label,
		hint: c.hint,
		run: c.run,
	}));
	let all = ui.concat(slash);
	if (q)
		all = all.filter(
			(c) =>
				c.label.toLowerCase().includes(q) ||
				(c.hint || "").toLowerCase().includes(q),
		);
	cmdkItems = all.slice(0, 12);
	renderCmdK();
}
function renderCmdK() {
	setSafeHtml(cmdkList, "");
	if (!cmdkItems.length) {
		const e = document.createElement("div");
		e.className = "cmdk-empty";
		e.textContent = "no matches";
		cmdkList.appendChild(e);
		return;
	}
	cmdkItems.forEach((c, i) => {
		const d = document.createElement("div");
		d.className = "cmdk-item" + (i === cmdkSel ? " sel" : "");
		d.id = "cmdk-opt-" + i;
		d.setAttribute("role", "option");
		d.setAttribute("aria-selected", i === cmdkSel ? "true" : "false");
		setSafeHtml(
			d,
			'<span class="cmdk-label">' +
				esc(c.label) +
				'</span><span class="cmdk-hint">' +
				esc(c.hint || "") +
				"</span>",
		);
		d.onclick = () => runCmdK(c);
		d.onmouseenter = () => {
			cmdkSel = i;
			renderCmdK();
		};
		cmdkList.appendChild(d);
	});
	cmdkInput.setAttribute("aria-activedescendant", "cmdk-opt-" + cmdkSel);
}
function runCmdK(c) {
	closeCmdK();
	if (c.kind === "slash") {
		inputEl.value = c.label + " ";
		autosize();
		inputEl.focus();
	} else if (typeof c.run === "function") {
		c.run();
	}
}
function onCmdKKey(e) {
	const n = Math.max(cmdkItems.length, 1);
	if (e.key === "ArrowDown") {
		e.preventDefault();
		cmdkSel = (cmdkSel + 1) % n;
		renderCmdK();
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		cmdkSel = (cmdkSel - 1 + n) % n;
		renderCmdK();
	} else if (e.key === "Enter") {
		e.preventDefault();
		if (cmdkItems[cmdkSel]) runCmdK(cmdkItems[cmdkSel]);
	} else if (e.key === "Escape") {
		e.preventDefault();
		closeCmdK();
	}
}
// Alt+K or Ctrl+K opens the palette — but never over a pi latch modal.
document.addEventListener("keydown", (e) => {
	if (modal.style.display === "flex") return;
	if ((e.altKey || e.ctrlKey) && !e.shiftKey && (e.key === "k" || e.key === "K")) {
		e.preventDefault();
		openCmdK();
	}
});

// ---- register built-in UI commands ----
registerCommand("new-session", "new session", "start a fresh session", () =>
	api({ type: "new_session" }),
);
registerCommand("compact", "compact context", "summarize the conversation", () =>
	api({ type: "compact" }),
);
registerCommand("stop", "stop generation", "abort the current turn", () =>
	api({ type: "abort" }),
);
registerCommand("settings", "settings", "open the settings panel", openSettings);
registerCommand(
	"scroll-bottom",
	"scroll to bottom",
	"jump to the latest message",
	scrollDown,
);
registerCommand("focus-input", "focus input", "put the cursor in the composer", () =>
	inputEl.focus(),
);
registerCommand("theme-dark", "theme: dark", "switch to the dark theme", () => {
	themeSel.value = "dark";
	themeSel.onchange();
});
registerCommand(
	"theme-paperlike",
	"theme: paperlike",
	"switch to the paperlike theme",
	() => {
		themeSel.value = "paperlike";
		themeSel.onchange();
	},
);

autosize();
