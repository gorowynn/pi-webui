const $ = (id) => document.getElementById(id);
function setSafeHtml(el, html) {
	// markdown output is sanitized by md.js; other dynamic fragments use esc().
	const range = document.createRange();
	range.selectNodeContents(el);
	el.replaceChildren(range.createContextualFragment(html));
}
const transcript = $("transcript");
const feedEl = $("tfeed"); // role="feed" wrapper — turns render as articles (FR-8)
const turnId = { n: 0 }; // incremented per turn — stable ids for role labels
const assistantTurnId = { n: 0 }; // visible assistant-turn sequence
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
// diff-view.js dual-mode module (window.diffView, loaded before app.js — plan
// A5): LCS row builder + gutter/mode helpers. Render layer stays here (the
// single escaper rule, GOTCHAS #12).
const dv = window.diffView;
// Usage telemetry stays browser-local and degrades to the existing inspector
// when the optional pure module or storage is unavailable.
const usageTelemetry = window.usageTelemetry;
const USAGE_SAMPLE_MS = 10000;
let usageSessionKey = "standalone";
function usageLedgerFor(history) {
	if (!usageTelemetry) return null;
	const last =
		history && history.samples && history.samples.length
			? history.samples[history.samples.length - 1]
			: null;
	return usageTelemetry.createEventLedger(
		last
			? {
					durations: last.durations,
					toolErrors: last.counters.toolErrors,
				}
			: null,
	);
}
let usageHistory = usageTelemetry
	? usageTelemetry.loadHistory(null, usageSessionKey, Date.now())
	: null;
let usageEvents = usageLedgerFor(usageHistory);
let usageLastSampleAt = 0;
let suppressUsageEnd = false;
function setUsageSession(sessionFile) {
	if (!usageTelemetry) return;
	const key =
		typeof sessionFile === "string" && sessionFile ? sessionFile : "standalone";
	if (key === usageSessionKey && usageHistory) return;
	usageSessionKey = key;
	usageHistory = usageTelemetry.loadHistory(null, key, Date.now());
	usageEvents = usageLedgerFor(usageHistory);
	usageLastSampleAt = 0;
}
function resetUsageSession() {
	if (!usageTelemetry) return;
	usageSessionKey = null;
	usageHistory = usageTelemetry.createHistory("standalone");
	usageEvents = usageTelemetry.createEventLedger();
	usageLastSampleAt = 0;
}

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
let curToolCallId = null; // last tool_execution_start id (U6 C8: approval identity)
// U6 C8 (FR-25): toolCallId → args map, fed at tool_execution_start. The
// permission paths (diff previews, ack marker) read args through the pending
// approval's toolCallId instead of the curToolArgs singleton.
const toolArgs = new Map();
// U6 C8: the broker-tracked approval currently on screen (set before a
// blocking select/confirm/input/editor renders, replayed from the snapshot on
// reload). {requestId, method, title, message, options, toolCallId, toolName,
// provenance} — provenance is the extension's safeguard context (tier, matched
// rule, layer, reason, mode).
let pendingApproval = null;
let lastSafeguardCtx = null; // parsed provenance from the safeguard setStatus
let pendingSending = false; // a decision POST is in flight — block dismissal

// U6 C8 (FR-25): the args for the tool behind a pending approval, via the
// toolCallId map (fallback: the curToolArgs singleton for pre-pending paths).
function pendingToolArgs() {
	const p = pendingApproval;
	if (p && p.toolCallId && toolArgs.has(p.toolCallId))
		return toolArgs.get(p.toolCallId);
	return curToolArgs || {};
}
function clearPendingApproval() {
	pendingApproval = null;
	pendingSending = false;
	setActivity(streaming ? "working…" : "ready", streaming);
}
function pausePermissionTool(toolCallId) {
	if (usageEvents && toolCallId) usageEvents.pauseTool(toolCallId, Date.now());
}
function resumePermissionTool(toolCallId) {
	if (usageEvents && toolCallId) usageEvents.resumeTool(toolCallId, Date.now());
}
function hasPermissionProvenance(value) {
	return (
		value && typeof value.tier === "string" && typeof value.action === "string"
	);
}
// stable decision enums for the version-1 marker (FR-25)
function decisionForLabel(label) {
	if (label === "Allow once") return "allow-once";
	if (label === "Allow for this session") return "allow-session";
	if (label === "Allow always (save to config)") return "allow-always";
	if (label === "Deny") return "deny";
	return typeof label === "object" ? "edited" : "deny";
}
// U6 C8/FR-22/23/24: POST a decision; for the on-screen approval keep the UI
// open until the server broadcasts approval_resolved (ack-before-close). 410
// with "stale toolCallId" keeps the UI + offers retry; "resolved"/"unknown"
// closes (another tab or a reload already decided).
function sendApprovalDecision(id, value, decision) {
	const body = { type: "extension_ui_response", id, value };
	const p = pendingApproval;
	// pi's confirm response is top-level; keep value too for broker/audit parity.
	if (p && p.requestId === id && p.method === "confirm")
		body.confirmed = value != null && value.confirmed === true;
	if (p && p.requestId === id && p.toolCallId) {
		body.marker = { v: 1, toolCallId: p.toolCallId, decision };
	}
	const awaiting = p && p.requestId === id;
	if (awaiting) {
		pendingSending = true;
		pushReceipt({
			t: Date.now(),
			requestId: id,
			toolName: p ? p.toolName : null,
			decision,
		}); // FR-28 bounded decision receipts
	}
	let settled = false;
	fetch("/api/cmd", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
		.then((r) =>
			r.json().catch(() => ({ ok: false, error: "http " + r.status })),
		)
		.then((j) => {
			settled = true;
			if (j && j.ok) return; // resolved — the broadcast closes the UI
			const err = (j && j.error) || "decision rejected";
			pendingSending = false;
			if (err === "stale toolCallId") {
				toast("Decision too late — retry", "err"); // UI stays (FR-24)
				return;
			}
			if (err === "resolved" || err === "unknown") {
				hideModal();
				clearPendingApproval();
				toast("Decision already recorded elsewhere", "warn");
				return;
			}
			toast("Decision failed to send — retry", "err"); // UI stays (FR-22)
		})
		.catch(() => {
			settled = true;
			pendingSending = false;
			toast("Decision failed to send — retry", "err");
		});
	// 2s watchdog: the broadcast never arrived — keep the UI + prompt a retry
	setTimeout(() => {
		if (!settled && pendingSending && awaiting) {
			pendingSending = false;
			toast("Decision not acknowledged — retry", "warn");
		}
	}, 2000);
}
// U6 C9 (FR-28): bounded decision receipts (last 50) — the audit view's
// "recent decisions" + retry semantics. In-memory only.
const APPROVAL_RECEIPTS_MAX = 50;
const approvalReceipts = [];
function pushReceipt(rec) {
	approvalReceipts.push(rec);
	if (approvalReceipts.length > APPROVAL_RECEIPTS_MAX) approvalReceipts.shift();
}
// Decision labels available for this approval. Mandatory-ask keeps only
// Allow once / Deny even in the full-page modal.
function approvalOptionLabels() {
	const p = pendingApproval;
	if (!p || !Array.isArray(p.options)) return ["Allow once", "Deny"];
	const labels = p.options.map((o) => (typeof o === "string" ? o : o.label));
	if (p.provenance && p.provenance.tier === "mandatory-ask") {
		return labels.filter((l) => l === "Allow once" || l === "Deny");
	}
	return labels;
}
// turn-generation counter: bumped on EVERY agent_start (live and replay). The
// snapshot re-check (snap-recheck) compares it to distinguish "the turn the
// snapshot described has ended" from "a NEW turn started since" — so a stale
// snapshot can never clobber a live turn's status, nor leave a dead turn's
// activity bar stuck on "writing…".
let agentStarts = 0;
let snapRecheckStarts = -1;

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
// Awaitable RPC (plan 0.2 server side): POST /api/rpc resolves with pi's
// {type:"response"} payload. Used by actions that need to confirm success before
// proceeding (e.g. session rename, plan 4.9). 30s server-side timeout.
async function rpcAwait(obj) {
	try {
		const r = await fetch("/api/rpc", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(obj),
		});
		return await r.json();
	} catch (e) {
		return { ok: false, error: e.message };
	}
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

function addUser(text, images, recordHistory = true) {
	const m = document.createElement("article");
	m.className = "msg";
	m.classList.add("user-turn");
	const roleId = "turn-" + ++turnId.n + "-role";
	m.setAttribute("aria-labelledby", roleId);
	setSafeHtml(
		m,
		`<div class="bubble user"><div class="role you" id="${roleId}">you</div></div>`,
	);
	const b = m.querySelector(".user");
	const span = document.createElement("div");
	setSafeHtml(span, md(text));
	b.appendChild(span);
	if (Array.isArray(images) && images.length) {
		const grid = document.createElement("div");
		grid.className = "msg-imgs";
		for (const img of images) {
			const im = document.createElement("img");
			im.className = "msg-img";
			im.src = "data:" + (img.mimeType || "image/jpeg") + ";base64," + img.data;
			im.alt = "attached image";
			im.loading = "lazy";
			grid.appendChild(im);
		}
		b.appendChild(grid);
	}
	if (recordHistory) {
		const liveMessageIndex = lastMessages.length;
		lastMessages.push({
			role: "user",
			content: [{ type: "text", text }],
			timestamp: Date.now(),
		});
		m.setAttribute("data-mi", String(liveMessageIndex));
	}
	feedEl.appendChild(m);
	if (recordHistory) refreshOpenAnalysis();
	pinned = true;
	unread = 0;
	scrollDown();
	refreshJump();
	updateEmptyState(); // spec FR-8 — a live first message hides the empty state
}
function appendLiveAssistant(message) {
	if (!message || message.role !== "assistant") return -1;
	const existing = lastMessages.findIndex(
		(m) =>
			m === message ||
			(message.id != null && m.id === message.id) ||
			(message.timestamp != null && m.timestamp === message.timestamp),
	);
	if (existing >= 0) return existing;
	lastMessages.push(message);
	return lastMessages.length - 1;
}

// ponytail: render an extension `notify` payload as a real assistant
// message in the transcript (markdown-formatted). Used for substantial /
// multi-line notify content -- e.g. the ctx-stats skill dumps a full
// markdown table via notify, which a 4-second corner toast can't hold.
// Built standalone: it does NOT touch the global `cur`, so it's safe to
// call mid-stream without hijacking the in-progress assistant bubble.
function addAssistantText(text) {
	const m = document.createElement("article");
	m.className = "msg";
	m.classList.add("assistant-turn");
	const roleId = "turn-" + ++turnId.n + "-role";
	const turnNo = ++assistantTurnId.n;
	m.setAttribute("aria-labelledby", roleId);
	setSafeHtml(
		m,
		`<div class="bubble"><div class="role" id="${roleId}">assistant</div></div>`,
	);
	const p = document.createElement("div");
	setSafeHtml(p, md(text));
	const bubble = m.querySelector(".bubble");
	bubble.appendChild(p);
	renderUsageStrip(bubble, null, turnNo);
	feedEl.appendChild(m);
	scrollDown();
}

function newAssistantBubble() {
	const m = document.createElement("article");
	m.className = "msg";
	m.classList.add("assistant-turn");
	const roleId = "turn-" + ++turnId.n + "-role";
	const turnNo = ++assistantTurnId.n;
	m.setAttribute("aria-labelledby", roleId);
	setSafeHtml(
		m,
		`<div class="bubble"><div class="role" id="${roleId}">assistant</div></div>`,
	);
	feedEl.appendChild(m);
	cur = {
		bubble: m.querySelector(".bubble"),
		turnNo,
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
	// ponytail: highlight IN-VIEW blocks immediately (synchronous) so the active
	// message's code colors without waiting on the async observer (which could
	// leave a just-rendered reply looking un-rendered until a reload). Only
	// OFFSCREEN blocks (a long transcript) defer to the observer for perf.
	const vh = window.innerHeight || 0;
	const defer = [];
	blocks.forEach((b) => {
		const r = b.getBoundingClientRect();
		if (r.top <= vh + 800 && r.bottom >= -800) hlEl(b);
		else defer.push(b);
	});
	if (!defer.length) return;
	if (!("IntersectionObserver" in window)) {
		defer.forEach(hlEl);
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
	defer.forEach((b) => hlObserver.observe(b));
}
function hlEl(el) {
	// hljs sets data-highlighted itself after highlighting — the guard at the
	// top of highlightElement() SKIPS + warns if the flag is pre-set, so never
	// set it here (that silently unhighlighted every block).
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
// Per-turn usage strip (plan 4.4): a thin muted-mono line under each
// assistant turn — cache-miss · cache-read · output · $cost — so cost/cache is
// visible per-turn without a separate panel. The turn number remains visible
// even when token usage is unavailable. Uses sessionAnalysis.messageUsage/formatTokens.
function renderUsageStrip(bubble, message, turnNo) {
	if (!bubble || turnNo == null) return;
	const SA = window.sessionAnalysis;
	if (!SA) return;
	const u = message && SA.messageUsage ? SA.messageUsage(message) : null;
	const parts = ["turn " + turnNo];
	if (u && (u.cacheMiss || u.cacheRead || u.output || u.cost)) {
		parts.push(
			"cache-miss " + SA.formatTokens(u.cacheMiss),
			"cache-read " + SA.formatTokens(u.cacheRead),
			"output " + SA.formatTokens(u.output),
		);
		if (u.cost > 0) parts.push(SA.formatTurnCost(u.cost));
	}
	const strip = document.createElement("div");
	strip.className = "turn-usage";
	strip.textContent = parts.join(" · ");
	bubble.appendChild(strip);
}
function finalizeBubble(content, message) {
	if (!cur) return;
	const src = content != null ? content : cur.content;
	// nothing renderable (tool-only / truly-empty turn) — drop the whole message
	// so no stray "assistant" label is left. cur.bubble is .bubble; .msg wraps it.
	if (!nonEmptyContent(src).length) {
		const msg = cur.bubble.parentElement;
		if (msg) {
			msg.remove();
			assistantTurnId.n = Math.max(0, assistantTurnId.n - 1);
		}
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
	renderUsageStrip(cur.bubble, message, cur.turnNo);
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

// Consecutive tool calls belong to one compact turn-local disclosure. The DOM
// itself is the scope: a non-tool turn or agent boundary naturally starts fresh.
function sealLatestToolGroup() {
	const last = feedEl.lastElementChild;
	if (last && last.classList.contains("tool-group"))
		last.dataset.sealed = "true";
}
function ensureToolGroup() {
	const last = feedEl.lastElementChild;
	if (
		last &&
		last.classList.contains("tool-group") &&
		last.dataset.sealed !== "true" &&
		last.__toolGroup
	)
		return last.__toolGroup;
	const el = document.createElement("article");
	el.className = "tool-group";
	el.setAttribute("aria-label", "tool activity");
	const fold = document.createElement("details");
	fold.className = "tool-group-fold";
	fold.open = true;
	setSafeHtml(
		fold,
		'<summary class="tool-group-head"><span class="tool-group-caret">▸</span><span class="tool-group-label">tool activity</span><span class="tool-group-meta"></span></summary><div class="tool-group-list"></div>',
	);
	const group = {
		el,
		fold,
		meta: fold.querySelector(".tool-group-meta"),
		list: fold.querySelector(".tool-group-list"),
		count: 0,
		running: 0,
		errors: 0,
		startedAt: Date.now(),
	};
	el.__toolGroup = group;
	el.appendChild(fold);
	feedEl.appendChild(el);
	return group;
}
function refreshToolGroup(group) {
	if (!group) return;
	const duration = group.startedAt
		? fmtToolDur(Date.now() - group.startedAt)
		: "";
	group.el.classList.toggle("run", group.running > 0);
	group.el.classList.toggle("err", group.errors > 0);
	group.meta.textContent = toolPresent.toolGroupSummary(
		group.count,
		group.running,
		group.errors,
		duration,
	);
	if (group.errors) group.fold.open = true;
	else if (!group.running && transcript.dataset.view !== "detailed")
		group.fold.open = false;
}
function settleToolGroup(wrap, isError) {
	if (!wrap || !wrap.group || wrap.groupSettled) return;
	wrap.groupSettled = true;
	const group = wrap.group;
	if (wrap.groupRunning) group.running = Math.max(0, group.running - 1);
	if (isError) group.errors++;
	refreshToolGroup(group);
}

function toolBlock(id, name, args, running) {
	let wrap = toolBlocks.get(id);
	if (!wrap) {
		const el = document.createElement("article");
		el.className = "tool" + (running ? " run open" : "");
		// article carries the turn semantics (FR-8); no role="group" needed
		const detail = toolPresent.toolCallDetail(name, args);
		const cmdHtml = detail ? `<span class="cmd">${esc(detail)}</span>` : "";
		// card head: caret + tool name + readable command … duration (filled at
		// end). .out-wrap is the grid-rows animation target (0fr→1fr on .open).
		setSafeHtml(
			el,
			`<button type="button" class="head" aria-expanded="${running ? "true" : "false"}"><span class="trow"><span class="caret">▸</span><span class="name">${esc(name || "tool")}</span>${cmdHtml}</span><span class="dur"></span></button><div class="out-wrap"><div class="out"></div></div>`,
		);
		const head = el.querySelector(".head");
		const toggle = () => openTool(wrap, !el.classList.contains("open"));
		head.addEventListener("click", toggle); // Enter/Space are native on <button>
		const group = ensureToolGroup();
		group.list.appendChild(el);
		group.count++;
		if (running) {
			group.running++;
			group.fold.open = true;
		}
		wrap = {
			el,
			out: el.querySelector(".out"),
			head,
			dur: el.querySelector(".dur"),
			startedAt: running ? Date.now() : 0,
			group,
			groupRunning: !!running,
			groupSettled: false,
		};
		toolBlocks.set(id, wrap);
		refreshToolGroup(group);
	}
	if (args != null) wrap.args = args;
	autoscroll();
	return wrap;
}
// toggle a tool card open/closed (was native <details>.open; now a class + the
// grid-rows animation). aria-expanded stays in sync for screen readers.
function openTool(wrap, open) {
	if (!wrap || !wrap.el) return;
	wrap.el.classList.toggle("open", !!open);
	if (wrap.head)
		wrap.head.setAttribute("aria-expanded", open ? "true" : "false");
}
// format an elapsed tool-call duration for the card head
function fmtToolDur(ms) {
	if (!ms || ms < 0) return "";
	if (ms < 1000) return ms + "ms";
	return (ms / 1000).toFixed(1) + "s";
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
// diffLines/diffRows live in public/diff-view.js (dual-mode; window.diffView is
// loaded before app.js — plan A5). Ponytail: O(n*m) Uint32Array DP table — fine
// for typical edits; swap for Myers if huge files start lagging the UI.
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
// basename for the diff editor's aria-label (plan A5 / FR-8.4): bare file
// name, not the path. Null-safe.
function baseName(p) {
	const s = String(p || "");
	const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
	return i >= 0 ? s.slice(i + 1) : s;
}

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
	// paused state (plan A5 / FR-5.3): over the cell limit the Review pane
	// shows an explicit label instead of blocking — editing + Apply keep
	// working; the old column still renders plain so it stays scannable.
	const pausedSide = () =>
		`<div class="sx-line sx-paused"><span class="sx-ltxt">diff too large to preview — switch to Edit to continue</span></div>`;
	// monotonic gutter reserve (plan A5 / FR-2): (digits+1)ch of the max
	// line count seen — grows, never shrinks, so async line-number patches
	// can't shift the text origin. Seeded from the initial texts before
	// first focus. diff-view.js gutterReserveCh is the pure helper.
	let gutterReserve = 0;
	const takeReserve = (maxNum) => {
		gutterReserve = dv.gutterReserveCh(maxNum, gutterReserve);
		return gutterReserve;
	};
	const compute = (o, n) => {
		const on = o ? o.split("\n").length : 0;
		const nn = n ? n.split("\n").length : 0;
		if (dv.largeHunkExceeds(on, nn, DIFF_CELL_LIMIT)) {
			return {
				leftHtml: plainSide(o || ""),
				rightHtml: pausedSide(),
				gutter: takeReserve(Math.max(on, nn)),
			};
		}
		const lang = langOf(path);
		const sides = rowsToSides(
			dv.diffRows(o, n),
			highlightLines(o, lang),
			highlightLines(n, lang),
		);
		return {
			leftHtml: sideHtml(sides.left),
			rightHtml: sideHtml(sides.right),
			gutter: takeReserve(sides.maxNum),
		};
	};
	const init = compute(baseOld, baseNew);
	setSafeHtml(
		host,
		`<div class="dpath">${esc(path || "(no path)")}${isWrite ? ' <span class="sx-tag">write</span>' : ""}</div>` +
			`<div class="sxs" style="--sx-gutter:${init.gutter}ch">` +
			`<div class="sx-col sx-old"><div class="sx-hdr">\u2212 original</div><div class="sx-body sx-left">${init.leftHtml}</div></div>` +
			`<div class="sx-col sx-new"><div class="sx-hdr"><span>+ ${cap ? "proposal" : "edited"}<span class="sx-dirty" hidden> · modified</span></span>${ro ? "" : '<span class="sx-mode" role="group" aria-label="view mode"><button type="button" class="sx-mode-btn" data-mode="review" aria-pressed="true">Review</button><button type="button" class="sx-mode-btn" data-mode="edit" aria-pressed="false">Edit</button></span>'}<button class="sx-reset" type="button" style="display:${ro ? "" : "none"}" hidden>Reset</button><button class="sx-apply" type="button" style="display:${ro || cap ? "none" : ""}">Apply</button></div>` +
			(ro
				? `<div class="sx-body sx-right">${init.rightHtml}</div>`
				: `<div class="sx-edit"><div class="sx-body sx-review">${init.rightHtml}</div><div class="sx-eedit"><div class="sx-egutter" aria-hidden="true"><div class="sx-egutter-in"></div></div><textarea class="sx-ta" spellcheck="false" wrap="off" aria-label="${esc(baseName(path))}" title="${esc(path)}"></textarea></div></div>`) +
			`</div></div>`,
	);
	const leftBody = host.querySelector(".sx-left");
	const rightBody = host.querySelector(".sx-right, .sx-review");
	let ta = null; // set only in editable mode
	let gutterEl = null; // edit-mode gutter strip (scroll-synced to ta)
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
			.style.setProperty("--sx-gutter", takeReserve(maxNum) + "ch");
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
		if (gutterEl && ta) gutterEl.scrollTop = ta.scrollTop;
		syncing = false;
	};
	leftBody.addEventListener("scroll", () => syncFrom(leftBody));
	if (ro) {
		rightBody.addEventListener("scroll", () => syncFrom(rightBody));
		return;
	}
	// editable pane wiring: Review/Edit split (plan A5 / FR-3). Review shows
	// the aligned highlighted diff; Edit shows the REAL textarea (visible
	// text/caret/selection) + a debounced line-number gutter. The same
	// textarea element persists across switches (undo/selection/scroll
	// survive). NO LCS while typing in Edit mode (FR-5); the gutter is the
	// only per-keystroke work.
	ta = host.querySelector(".sx-ta");
	const applyBtn = host.querySelector(".sx-apply");
	gutterEl = host.querySelector(".sx-egutter");
	const gutterIn = host.querySelector(".sx-egutter-in");
	const modeBtns = host.querySelectorAll(".sx-mode-btn");
	let mode = "review";
	let composing = false;
	ta.value = baseNew;
	// fixed-px line grid for the gutter strip; read once at mount (FR-1:
	// --sx-lh is a fixed px var, so the gutter rows align with the textarea).
	const lhPx =
		parseFloat(getComputedStyle(host).getPropertyValue("--sx-lh")) || 17.4;
	const renderGutter = () => {
		if (!ta || !gutterIn) return;
		const n = dv.lineCountOf(ta.value);
		gutterIn.replaceChildren();
		const frag = document.createDocumentFragment();
		for (let i = 1; i <= n; i++) {
			const row = document.createElement("div");
			row.className = "sx-eg-row";
			const num = document.createElement("span");
			num.className = "sx-eg-num";
			num.textContent = String(i);
			row.appendChild(num);
			frag.appendChild(row);
		}
		gutterIn.appendChild(frag);
		gutterIn.style.height = Math.max(n, 1) * lhPx + "px";
	};
	let gTimer = 0;
	const queueGutter = () => {
		clearTimeout(gTimer);
		gTimer = setTimeout(renderGutter, 120);
	};
	ta.addEventListener("input", queueGutter);
	ta.addEventListener("scroll", () => syncFrom(ta));
	renderGutter();
	const repaint = () => {
		const c = compute(baseOld, ta.value);
		host
			.querySelector(".sxs")
			.style.setProperty("--sx-gutter", c.gutter + "ch");
		setSafeHtml(rightBody, c.rightHtml);
		setSafeHtml(leftBody, c.leftHtml);
		if (lineStart > 1) patchGutters(lineStart);
	};
	const setMode = (m) => {
		if (composing || m === mode || !ta) return;
		mode = m;
		host.dataset.mode = m;
		modeBtns.forEach((b) =>
			b.setAttribute("aria-pressed", String(b.dataset.mode === m)),
		);
		if (m === "review") scheduleRecompute(); // re-align after edits
	};
	// recompute policy (plan A5 / FR-5): the aligned diff runs ONLY on
	// entering Review, Apply, and blur-from-Edit — never per keystroke —
	// debounced 150ms and coalesced (last call wins).
	let recomputeTimer = 0;
	const scheduleRecompute = () => {
		clearTimeout(recomputeTimer);
		recomputeTimer = setTimeout(repaint, 150);
	};
	ta.addEventListener("blur", scheduleRecompute);
	modeBtns.forEach((b) =>
		b.addEventListener("click", () => setMode(b.dataset.mode)),
	);
	ta.addEventListener("compositionstart", () => {
		composing = true;
	});
	ta.addEventListener("compositionend", () => {
		composing = false;
	});
	rightBody.addEventListener("scroll", () => syncFrom(rightBody));
	let baselineNew = baseNew;
	// dirty indicator + Reset (plan A5 / FR-8): a dot in the header when the
	// proposal drifted from the baseline; Reset restores the baseline and
	// returns focus to the textarea.
	const dirtyEl = host.querySelector(".sx-dirty");
	const resetBtn = host.querySelector(".sx-reset");
	const updateDirty = () => {
		const d = dv.dirty(baselineNew, ta.value);
		if (dirtyEl) dirtyEl.hidden = !d;
		if (resetBtn) resetBtn.hidden = !d;
	};
	updateDirty();
	ta.addEventListener("input", updateDirty);
	if (resetBtn)
		resetBtn.addEventListener("click", () => {
			ta.value = baselineNew;
			updateDirty();
			queueGutter();
			scheduleRecompute();
			ta.focus();
		});
	// Ctrl/Cmd+Enter applies (transcript path only — capture mode has no
	// Apply; the approval buttons own the flow).
	if (applyBtn && !cap)
		ta.addEventListener("keydown", (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
				e.preventDefault();
				applyBtn.click();
			}
		});
	if (applyBtn)
		applyBtn.addEventListener("click", () =>
			applyEdit(path, baselineNew, ta.value, isWrite, applyBtn, () => {
				baselineNew = ta.value;
				updateDirty();
				scheduleRecompute();
			}),
		);
}
// applyEdit: read the current file, splice the edited hunk in (edit tool) or
// replace it wholesale (write tool), then POST to /api/write with the
// optimistic-concurrency version read at the same moment (plan A5 / FR-6/7).
// A 409 means the disk moved between read and write (TOCTOU) and opens the
// inline conflict banner. For edits we anchor on baselineNew (the agent's
// newText now sitting on disk) and replace its first occurrence; if it can't
// be found the file moved under us and we bail instead of clobbering.
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
	const host = btn.closest(".sx-host");
	removeConflict(host);
	try {
		const out = await doApply(path, baselineNew, edited, isWrite);
		if (!out.ok) {
			if (out.status === 409) {
				// conflict recovery (FR-7): Reload = single retry with the
				// fresh version; Compare = read-only disk-vs-proposal review;
				// Cancel = keep the dirty edit, dismiss.
				showConflict(host, path, edited, () =>
					applyEdit(path, baselineNew, edited, isWrite, btn, onOk),
				);
				toast("file changed on disk — resolve before applying", "warn");
			} else {
				throw new Error(out.error || "write failed");
			}
			btn.disabled = false;
			btn.textContent = prev;
			return;
		}
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

// doApply: one read+write round trip. The edit path splices baselineNew into
// the fresh disk content (0-hit / N-hit bails preserved); the write path
// replaces wholesale and derives its expectedVersion from an apply-time read
// (null when the file doesn't exist yet = create-only). The version read at
// that same moment is sent as expectedVersion — the server answers 409 if the
// disk moved in between (FR-6.5).
async function doApply(path, baselineNew, edited, isWrite) {
	let next;
	let expectedVersion;
	if (isWrite) {
		next = edited;
		try {
			const r = await fetch("/api/file?path=" + encodeURIComponent(path));
			const j = await r.json();
			expectedVersion = j && j.ok ? j.version : null;
		} catch {
			expectedVersion = null; // unreadable → attempt create-only; a 409 surfaces the truth
		}
	} else {
		const r = await fetch("/api/file?path=" + encodeURIComponent(path));
		const j = await r.json();
		if (!j.ok) throw new Error(j.error || "read failed");
		const hits = j.content.split(baselineNew).length - 1;
		if (hits === 0) throw new Error("original hunk no longer present in file");
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
		expectedVersion = j.version;
	}
	const w = await fetch("/api/write", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path, content: next, expectedVersion }),
	});
	const wj = await w.json();
	if (!wj.ok)
		return {
			ok: false,
			status: w.status,
			error: wj.error || "write failed",
			version: wj.version,
		};
	return { ok: true };
}

// conflict banner (plan A5 / FR-7.2): inline in the sx host, not toast-only.
// Reload retries once with the fresh version; Compare mounts a READ-ONLY
// Review of disk-current vs the current proposal above the live diff;
// Cancel dismisses banner + compare, keeping the dirty edit untouched.
function showConflict(host, path, edited, retry) {
	removeConflict(host);
	const b = document.createElement("div");
	b.className = "sx-conflict";
	b.setAttribute("role", "alert");
	const msg = document.createElement("span");
	msg.className = "sx-conflict-msg";
	msg.textContent = "File changed on disk";
	const rel = document.createElement("button");
	rel.type = "button";
	rel.className = "sx-conflict-btn";
	rel.textContent = "Reload";
	rel.title = "re-fetch the file and retry Apply once";
	rel.addEventListener("click", retry);
	const cmp = document.createElement("button");
	cmp.type = "button";
	cmp.className = "sx-conflict-btn";
	cmp.textContent = "Compare";
	cmp.title = "review the disk version against your edit";
	cmp.addEventListener("click", () => compareDisk(host, path, edited));
	const can = document.createElement("button");
	can.type = "button";
	can.className = "sx-conflict-btn";
	can.textContent = "Cancel";
	can.title = "keep your edit and dismiss";
	can.addEventListener("click", () => removeConflict(host));
	b.append(msg, rel, cmp, can);
	const dp = host.querySelector(".dpath");
	if (dp) dp.after(b);
	else host.prepend(b);
}
function removeConflict(host) {
	if (!host) return;
	const b = host.querySelector(".sx-conflict");
	if (b) b.remove();
	const c = host.querySelector(".sx-compare");
	if (c) c.remove();
}
// Compare: fetch the disk version and mount a read-only Review of disk-current
// vs the current proposal. The banner stays visible so Cancel can dismiss both.
function compareDisk(host, path, edited) {
	const prev = host.querySelector(".sx-compare");
	if (prev) prev.remove();
	fetch("/api/file?path=" + encodeURIComponent(path))
		.then((r) => r.json())
		.then((j) => {
			if (!j.ok) {
				toast("compare failed: " + (j.error || "read failed"), "err");
				return;
			}
			const cmp = document.createElement("div");
			cmp.className = "sx-compare";
			const sxs = host.querySelector(".sxs");
			if (sxs) sxs.before(cmp);
			else host.appendChild(cmp);
			mountSideBySide(cmp, path, j.content, edited, false, {
				readOnly: true,
			});
		})
		.catch((e) => toast("compare failed: " + e.message, "err"));
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
	// spec FR-6: the idle row is reserved for work / intervention / error
	// states — the pure-idle "ready" hides it (body.act-on); everything else
	// (working, waiting-for-input, reconnecting, stopped) keeps it visible.
	document.body.classList.toggle("act-on", working || label !== "ready");
}

// ---- stateful empty state (spec FR-8) ----
// Shows only while the transcript has no messages; its one primary action
// focuses the composer. Replaces the old #transcript:empty::before pseudo.
const emptyState = $("empty-state");
function updateEmptyState() {
	if (!emptyState) return;
	emptyState.hidden = transcript.querySelector(".msg") !== null;
}
const emptyStart = $("empty-start");
if (emptyStart) emptyStart.onclick = () => inputEl.focus();
updateEmptyState(); // initial paint: fresh session -> visible

function note(text, cls) {
	const m = document.createElement("article");
	m.className = "msg";
	m.classList.add("system-turn");
	const b = document.createElement("div");
	b.className = "bubble";
	if (cls) b.style.color = `var(--${cls})`;
	b.textContent = text;
	m.appendChild(b);
	feedEl.appendChild(m);
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
function focusModalControl() {
	requestAnimationFrame(() => {
		const f = card.querySelector(
			"button:not([disabled]), [href], input, select, textarea, [tabindex]",
		);
		if (f) f.focus();
	});
}
function openModal() {
	lastFocus = document.activeElement;
	modalFree = false; // default: assume a latch modal; free openers opt in below
	if (modalX) modalX.hidden = true;
	modal.style.display = "flex";
	modal.setAttribute("aria-modal", "true");
	modal.setAttribute(
		"aria-label",
		pendingApproval ? "Waiting for approval" : "pi dialog",
	);
	document.addEventListener("keydown", onModalKey, true);
	focusModalControl();
}
function showModal(html, free, fullPage) {
	// Reset per-modal modifiers so they cannot leak across opens. Blocking tool
	// interactions use the full-page surface rather than a tool-card control.
	card.className = fullPage ? "card wide" : "card";
	setSafeHtml(card, html);
	if (pendingApproval) {
		const wait = document.createElement("div");
		wait.className = "approval-wait";
		wait.setAttribute("role", "status");
		wait.textContent = "Waiting for approval";
		card.prepend(wait);
		setActivity("waiting for approval…", false);
	}
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
	// U6 C8 (FR-23): for a broker-tracked approval, Esc/backdrop = Deny routed
	// through the same ack path (never a silent close that strands pi). While a
	// decision POST is in flight the close is inert.
	if (pendingApproval && !pendingSending) {
		sendApprovalDecision(pendingApproval.requestId, "Deny", "deny");
		return;
	}
	if (modalFree) hideModal();
}
function hideModal() {
	modal.style.display = "none";
	modal.setAttribute("aria-modal", "false");
	document.removeEventListener("keydown", onModalKey, true);
	const target =
		lastFocus && lastFocus.isConnected && lastFocus !== document.body
			? lastFocus
			: inputEl;
	if (target && typeof target.focus === "function") {
		try {
			target.focus();
		} catch {}
	}
	lastFocus = null;
	modal.setAttribute("aria-label", "pi dialog");
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
// W1 chunk 7: rail panel render for the quotas widget — same inner HTML +
// form wiring as the modal, gen-stamped fetch (FR-8).
async function quotasRender(el, g) {
	const provider = currentProvider;
	setSafeHtml(el, '<p class="um-hint">loading…</p>');
	let inner;
	try {
		inner = await renderUsage(provider);
	} catch (e) {
		inner = `<p class="um-err">⚠ ${esc(e.message)}</p>`;
	}
	if (railGen.stale(g)) return;
	setSafeHtml(
		el,
		`<h3>${esc(usageProviderLabel(provider))} usage</h3>` + inner,
	);
	wireUsageForms(el);
}
function wireUsageForms(container) {
	const rb = container.querySelector("#um-refresh");
	if (rb) rb.onclick = refreshUsageBar;
	const form = container.querySelector("#um-key-form");
	if (form)
		form.onsubmit = (e) => {
			e.preventDefault();
			localStorage.setItem(ZAI_KEY, $("um-key").value.trim());
			refreshUsageBar();
		};
	const goForm = container.querySelector("#um-go-form");
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
		};
}

// ---- quota state (W1: header usage bar moved fully into the rail) ----
// refreshUsageBar is the single entry — model switches, the 60s poll and the
// quota-key forms all re-drive the rail: tab badge (pct of the tightest
// window) and, when the Quotas panel is open, its body. No header element.
async function refreshUsageBar() {
	const provider = currentProvider;
	if (!provider) {
		quotaBadgePct = null;
		renderRail(false);
		return;
	}
	if (usageViewKind(provider) === "session") {
		quotaBadgePct = null;
		renderRail(false);
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
		quotaBadgePct = null;
		renderRail(false);
		return;
	}
	const bars = quotaLimits(provider, u.data);
	const pcts = bars
		.map(pctOf)
		.filter((n) => typeof n === "number" && Number.isFinite(n));
	quotaBadgePct = pcts.length ? Math.max(...pcts) : null;
	renderRail(false);
	if (railWidget && railWidget.id === "quotas")
		quotasRender($("tools-body"), railGen.cur());
}

// ---- todo panel: incremental state from the `todo` tool ----
// The `todo` tool (extensions/pi_minimal_webui/todo.ts) sends one ACTION per
// call (plan/add/update/remove/clear); we apply it to our own `todos` state and
// re-render straight from tool_execution_start args. Tasks carry a stable `id`
// (agent-supplied) and a status: open | started | finished. The frontend owns
// the state — same proven OUT smuggling channel as ask_user_question, and
// nothing to lose across compaction / new sessions / pi restarts.
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
function todoRowHtml(t, i) {
	const cls =
		t.status === "finished" ? "done" : t.status === "started" ? "live" : "pend";
	const ck = t.status === "finished" ? "✓" : t.status === "started" ? "●" : "○";
	return `<span class="ck ${cls}">${ck}</span><span class="id">#${t.id != null ? esc(String(t.id)) : i + 1}</span><span class="sbj">${esc(t.subject)}</span>`;
}
// W1 chunk 7: rail panel render — same tool-owned mirror, same rows
function todosRender(el) {
	if (!todos.length) {
		setSafeHtml(el, '<p class="w-placeholder">no todo list yet</p>');
		return;
	}
	const done = todos.filter((t) => t.status === "finished").length;
	let h = `<div class="tp-count">${done}/${todos.length}</div>`;
	todos.forEach((t, i) => {
		h += `<div class="ti">${todoRowHtml(t, i)}</div>`;
	});
	setSafeHtml(el, h);
}
function renderTodos() {
	// W1: todos live only in the rail Todos widget — refresh the tab badge
	// and, when the widget is open, its body (immediate, not the ticker).
	renderRail(false);
	if (railWidget && railWidget.id === "todos") todosRender($("tools-body"));
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
// ---- W1 workspace-tools rail: fixed widget table + shell (spec FR-1..FR-4) ----
// Five entries, no runtime registration; permissions is a launcher (chunk 4),
// not a widget. Rail state {widget, open, width} persists via rail.js
// (pi:rail + one-time pi:sddbar/pi:rail-width migration).
// W1 parity is complete: all inspection commands open their mounted rail
// widgets; action-specific confirmation modals (for example Git commit) remain.
const railState = rail.createRailState();
const railGen = rail.createGen();
let railSt = railState.load();
let railWidget = null; // mounted widget entry (null = panel closed)
let sddRel = null; // SDD doc pointer (the open artifact)
let sddInit = false; // restore-once guard so the 30s poll can't reopen a user-closed pane
let gitBadgeSnap = null; // {changed} once the git widget caches a snapshot (chunk 6) — MUST be let (assigned on fetch)
let quotaBadgePct = null; // max window pct once the 60s poll resolves — MUST be let (assigned in refreshUsageBar)
let railReturnFocus = null;
let railReturnWidget = null;

function sddSummaryFor() {
	const set = activeSet();
	if (!set) return null;
	const sset = planSets().find(
		(x) => (x.slug || "") + "|" + (x.date || "") === set.slug + "|" + set.date,
	);
	const t = (sset && sset.arts.find((a) => a.phase === "tasks")) || null;
	return { ...set, done: t && t.done, total: t && t.total };
}
function widgetVisible(w) {
	return w.id === "sdd" ? rail.sddVisibility(sddSummaryFor()) : true;
}
function railNarrow() {
	return (
		document.body.classList.contains("w-mid") ||
		document.body.classList.contains("w-narrow")
	);
}
function railPanelFocusables() {
	const pane = document.querySelector("#toolsbar .tools-pane");
	if (!pane) return [];
	return Array.from(
		pane.querySelectorAll(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		),
	).filter((el) => !el.disabled && el.offsetParent !== null);
}
function setRailSheetSemantics(open) {
	const bar = $("toolsbar");
	if (!bar) return;
	if (open && railNarrow()) {
		bar.setAttribute("role", "dialog");
		bar.setAttribute("aria-modal", "true");
		bar.setAttribute("aria-labelledby", "tools-title");
	} else {
		bar.removeAttribute("role");
		bar.removeAttribute("aria-modal");
		bar.removeAttribute("aria-labelledby");
	}
}
function focusRailSheet() {
	if (!railWidget || !railNarrow()) return;
	requestAnimationFrame(() => {
		if (!railWidget || !railNarrow()) return;
		const first = railPanelFocusables()[0];
		if (first) first.focus();
	});
}
function restoreRailFocus(widgetId) {
	const direct = railReturnFocus;
	if (direct && direct.isConnected && typeof direct.focus === "function") {
		direct.focus();
		return;
	}
	const nav = $("tools-rail");
	if (!nav) return;
	const tabs = Array.from(nav.querySelectorAll('[role="tab"]'));
	const target =
		tabs.find((tab) => tab.getAttribute("data-widget") === widgetId) || tabs[0];
	if (target) target.focus();
}
function onRailSheetKey(e) {
	if (
		!railWidget ||
		!railSt.open ||
		!railNarrow() ||
		!document.body.classList.contains("rail-open") ||
		modal.style.display === "flex"
	)
		return;
	if (e.key === "Escape") {
		e.preventDefault();
		e.stopImmediatePropagation();
		closeRail();
		return;
	}
	if (e.key !== "Tab") return;
	const focusables = railPanelFocusables();
	if (!focusables.length) return;
	const first = focusables[0];
	const last = focusables[focusables.length - 1];
	if (!focusables.includes(document.activeElement)) {
		e.preventDefault();
		(e.shiftKey ? last : first).focus();
	} else if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	}
}

const WIDGETS = [
	{
		id: "sdd",
		label: "SDD",
		icon: "\u25c8",
		commandId: "sdd",
		refresh: "manual", // refreshPlanState's own 30s poll owns SDD (scroll-safe)
		badge: () => rail.sddBadge(sddSummaryFor()),
		render: sddRender,
		onOpen: sddTitle,
		onClose: () => {},
	},
	{
		id: "analysis",
		label: "Usage",
		icon: "\u25f7",
		commandId: "usage",
		refresh: "interval:10000",
		badge: () => ({ text: "", tone: "none" }),
		render: analysisRender,
		onOpen: () => {},
		onClose: () => {},
	},
	{
		id: "git",
		label: "Git",
		icon: "\u2442",
		commandId: "git",
		refresh: "interval:60000",
		badge: () => rail.gitBadge(gitBadgeSnap),
		render: (el) => setSafeHtml(el, '<p class="um-hint">loading…</p>'),
		onOpen: (g) => gitRenderRail($("tools-body"), g),
		onClose: () => {},
	},
	{
		id: "quotas",
		label: "Quotas",
		icon: "\u25d4",
		commandId: "quotas",
		refresh: "interval:60000",
		badge: () => rail.quotaBadge(quotaBadgePct),
		render: (el) => setSafeHtml(el, '<p class="um-hint">loading…</p>'),
		onOpen: (g) => quotasRender($("tools-body"), g),
		onClose: () => {},
	},
	{
		id: "todos",
		label: "Todos",
		icon: "\u2713",
		commandId: "todos",
		refresh: "interval:5000",
		badge: () => rail.todosBadge(todos),
		render: todosRender,
		onOpen: () => {},
		onClose: () => {},
	},
].map((w) => {
	if (!rail.validWidgetEntry(w))
		throw new Error("invalid widget table entry: " + w.id);
	return w;
});

function sddTitle() {
	const sum = sddSummaryFor();
	const prog = sum && sum.total ? " (" + sum.done + "/" + sum.total + ")" : "";
	$("tools-title").textContent =
		"SDD" + (sum && sum.phase ? " · " + sum.phase : "") + prog;
}

// the SDD panel: horizontal phase stepper + the doc of the open artifact
function sddRender(el) {
	const set = activeSet();
	const sset = planSets().find(
		(x) => (x.slug || "") + "|" + (x.date || "") === set.slug + "|" + set.date,
	);
	const arts = (sset && sset.arts) || [];
	const sum = setSummary(sset || { arts: [] });
	const curRank = PHASE_RANK[sum.phase];
	el.textContent = "";
	const steps = document.createElement("div");
	steps.className = "ss-steps";
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
		b.appendChild(dot);
		const lbl = document.createElement("span");
		lbl.className = "ss-lbl";
		lbl.textContent = ph;
		b.appendChild(lbl);
		if (ph === "tasks" && art && art.total) {
			const meta = document.createElement("span");
			meta.className = "ss-meta";
			meta.textContent = art.done + "/" + art.total;
			b.appendChild(meta);
		}
		const a = art;
		if (a) b.onclick = () => openSddPhase(a);
		steps.appendChild(b);
	}
	el.appendChild(steps);
	const doc = document.createElement("div");
	doc.className = "doc-body";
	el.appendChild(doc);
	// drop a vanished artifact (set archived mid-view); else render the doc —
	// sddRel when set, else the highest-reached phase with content
	let art = null;
	if (sddRel) art = arts.find((a) => a.rel === sddRel);
	if (!art)
		art =
			arts.find((a) => a.phase === sum.phase) || arts[arts.length - 1] || null;
	if (art) {
		sddRel = art.rel;
		renderPlanDoc(doc, art.rel);
	} else {
		setSafeHtml(doc, '<p class="um-hint">no artifacts in this set yet</p>');
	}
}

function renderRail(renderPanel = true) {
	const bar = $("toolsbar");
	if (!bar) return;
	const tabs = WIDGETS.filter(widgetVisible);
	if (!tabs.length) {
		bar.setAttribute("aria-hidden", "true");
		bar.classList.remove("open");
		document.body.classList.remove("rail-on", "rail-open");
		railWidget = null;
		setRailSheetSemantics(false);
		return;
	}
	bar.setAttribute("aria-hidden", "false");
	document.body.classList.add("rail-on");
	// active widget hidden (set archived mid-view) -> close silently
	if (railSt.widget && !tabs.some((w) => w.id === railSt.widget)) {
		railWidget = null;
		railSt.open = false;
	}
	const railNav = $("tools-rail");
	setSafeHtml(railNav, "");
	for (const w of tabs) {
		const sel = railSt.open && railSt.widget === w.id;
		const b = document.createElement("button");
		b.type = "button";
		b.className = "rail-tab" + (sel ? " sel" : "");
		b.setAttribute("role", "tab");
		b.setAttribute("aria-selected", sel ? "true" : "false");
		b.setAttribute("aria-controls", "tools-body");
		b.setAttribute("data-widget", w.id);
		b.tabIndex = sel ? 0 : -1;
		b.title = w.label;
		// selected tab click collapses (keeps the old stepper toggle)
		b.onclick = () => (sel ? closeRail() : openRailWidget(w.id));
		const ic = document.createElement("span");
		ic.className = "rt-ic";
		ic.textContent = w.icon;
		b.appendChild(ic);
		const lb = document.createElement("span");
		lb.className = "rt-lbl";
		lb.textContent = w.label;
		b.appendChild(lb);
		const bd = w.badge();
		if (bd && bd.text) {
			const bs = document.createElement("span");
			bs.className = "rt-badge b-" + (bd.tone || "none");
			bs.textContent = bd.text;
			bs.title = bd.text; // FR-6: badge text, never color alone
			b.appendChild(bs);
		}
		railNav.appendChild(b);
	}
	// FR-7: permissions launcher — NOT a widget; routes to the dedicated page.
	// Badge mirrors the on-screen approval (err tone + count) and config error.
	const perm = document.createElement("button");
	perm.type = "button";
	perm.className = "rail-tab rail-perm";
	perm.title = "permissions";
	perm.onclick = () => {
		location.hash = "#permissions";
	};
	const permIc = document.createElement("span");
	permIc.className = "rt-ic";
	permIc.textContent = "\u2691";
	perm.appendChild(permIc);
	const permLb = document.createElement("span");
	permLb.className = "rt-lbl";
	permLb.textContent = "Perms";
	perm.appendChild(permLb);
	const pb = rail.approvalsBadge(pendingApproval ? 1 : 0);
	if (pb.text) {
		const pbs = document.createElement("span");
		pbs.className = "rt-badge b-" + pb.tone;
		pbs.textContent = pb.text;
		pbs.title = pb.text;
		perm.appendChild(pbs);
	}
	railNav.appendChild(perm);
	const open = railSt.open && tabs.find((x) => x.id === railSt.widget);
	if (open && renderPanel) {
		railWidget = open;
		bar.classList.add("open");
		document.body.classList.add("rail-open");
		setRailSheetSemantics(true);
		$("tools-title").textContent = open.label;
		open.onOpen(railGen.cur());
		open.render($("tools-body"));
		return;
	}
	if (!open) {
		railWidget = null;
		bar.classList.remove("open");
		document.body.classList.remove("rail-open");
		setRailSheetSemantics(false);
	}
}

function openRailWidget(id) {
	const w = WIDGETS.find((x) => x.id === id);
	if (!w || !widgetVisible(w)) return;
	const active = document.activeElement;
	railReturnFocus =
		active &&
		typeof active.closest === "function" &&
		active.closest('#tools-rail [role="tab"]')
			? active
			: null;
	railReturnWidget = id;
	if (railWidget && railWidget !== w) railWidget.onClose();
	railWidget = w;
	railSt = { ...railSt, widget: id, open: true };
	railState.save(railSt);
	w.onOpen(railGen.open());
	renderRail();
	focusRailSheet();
}
function closeRail() {
	const returnWidget = railReturnWidget || (railWidget && railWidget.id);
	const shouldRestore = !!returnWidget || !!railReturnFocus;
	if (railWidget) railWidget.onClose();
	railWidget = null;
	railSt = { ...railSt, open: false };
	railState.save(railSt);
	renderRail();
	if (shouldRestore) restoreRailFocus(returnWidget);
	railReturnFocus = null;
	railReturnWidget = null;
}

// W1 auto-refresh (FR-8): the open widget's body re-renders on its declared
// interval:N cadence. Event-driven pushes (todo ops, quota poll, git
// mutations, plan-state poll) already render immediately — this ticker is the
// catch-all for steady-state drift (analysis, git status, quota windows).
// Scroll is preserved across re-renders so reading a long list isn't jarred.
const RAIL_TICK_MS = 5000;
const railLastRender = {}; // widget id -> last panel render ts
function railRenderDue(w) {
	const m = /^interval:(\d+)$/.exec(w.refresh);
	if (!m) return false; // manual / on-open: own refresh path
	return (railLastRender[w.id] || 0) + Number(m[1]) <= Date.now();
}
function refreshRailWidget(w) {
	railLastRender[w.id] = Date.now();
	const el = $("tools-body");
	const st = el.scrollTop;
	if (w.id === "git") {
		gitRenderRail(el, railGen.cur()).then(() => (el.scrollTop = st));
		return;
	}
	if (w.id === "quotas") {
		quotasRender(el, railGen.cur()).then(() => (el.scrollTop = st));
		return;
	}
	w.render(el); // sync renders (analysis / todos)
	el.scrollTop = st;
}
function refreshOpenAnalysis() {
	if (railWidget && railWidget.id === "analysis") refreshRailWidget(railWidget);
}
setInterval(() => {
	if (railWidget && railRenderDue(railWidget)) refreshRailWidget(railWidget);
}, RAIL_TICK_MS);
function openSddPhase(art) {
	sddRel = art.rel;
	try {
		localStorage["pi:rail:sdd"] = JSON.stringify({ rel: art.rel });
	} catch {}
	openRailWidget("sdd");
}
function closeRailPane() {
	closeRail();
}

// W1 FR-5: roving tabindex over the #tools-rail tabs (WAI tabs pattern).
// Delegated on the container so it works for whichever tab set is mounted.
// Arrows/Home/End move focus among enabled tabs; Esc closes the panel and
// returns focus to the selected tab (or the first enabled one).
function initRailTabs() {
	const railNav = $("tools-rail");
	if (!railNav) return;
	railNav.addEventListener("keydown", (e) => {
		const tabs = [...railNav.querySelectorAll('[role="tab"]:not([disabled])')];
		if (!tabs.length) return;
		const cur = tabs.indexOf(document.activeElement);
		const focus = (t) => {
			e.preventDefault();
			if (t) t.focus();
		};
		if (e.key === "ArrowRight" || e.key === "ArrowDown")
			focus(tabs[(cur + 1 + tabs.length) % tabs.length]);
		else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
			focus(tabs[(cur - 1 + tabs.length) % tabs.length]);
		else if (e.key === "Home") focus(tabs[0]);
		else if (e.key === "End") focus(tabs[tabs.length - 1]);
		else if (e.key === "Esc" || e.key === "Escape") {
			closeRailPane();
			const selected = railNav.querySelector('[aria-selected="true"]');
			focus(selected || tabs[0]);
		}
	});
	document.addEventListener("keydown", onRailSheetKey, true);
}
initRailTabs();
function refreshPlanState() {
	fetch("/api/plan-state")
		.then((r) => r.json())
		.then((j) => {
			planArtifacts = j && Array.isArray(j.artifacts) ? j.artifacts : [];
			// restore the last open rail widget once, after the first poll
			// resolves (legacy pi:sddbar rel migrates too)
			if (!sddInit) {
				sddInit = true;
				try {
					if (railSt.open && railSt.widget === "sdd") {
						let saved = JSON.parse(localStorage["pi:rail:sdd"] || "null");
						if (!saved || !saved.rel)
							saved = JSON.parse(localStorage["pi:sddbar"] || "null");
						if (saved && saved.rel) sddRel = saved.rel;
					}
				} catch {}
			}
			// SDD keeps its poll-sync (doc re-render while open); other widgets
			// own their refresh policy (chunks 5-7)
			renderRail(!railWidget || railWidget.id === "sdd");
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
(function initToolsBar() {
	const close = $("tools-close");
	if (close) close.addEventListener("click", closeRailPane);
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
	showModal("", false);
	toast("Your input is needed", "warn");

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
	// U6 C8 (FR-25): read the tool identity through the pending approval so the
	// preview always matches the request on screen (fallback: live tool state).
	const p = pendingApproval;
	const name = p && p.toolName ? p.toolName : curToolName;
	const inp = pendingToolArgs();
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
		// U6 C11 (FR-40): the plugin flags a mid-review file change when the user
		// edited the proposal — warn so the stale base can't pass silently.
		if (decision && typeof decision === "object" && decision.conflict) {
			toast("file changed during review — base may be stale", "warn");
		}
		// U6 C8 (FR-25): the IDE decision is an approval response — carry the
		// marker so the broker can validate identity (the payload forwarded to
		// the extension is unchanged; the server strips the marker).
		const body = { type: "extension_ui_response", id, value: decision };
		if (pendingApproval && pendingApproval.toolCallId)
			body.marker = {
				v: 1,
				toolCallId: pendingApproval.toolCallId,
				decision: decisionForLabel(decision),
			};
		// SEC-07: await the broker's verdict instead of firing and forgetting.
		// The server validates the label against the options the GATE offered —
		// a rejection means the IDE rendered buttons the gate never offered.
		// invalid-option → re-ask in the webui modal (record still pending);
		// unknown/resolved → answered elsewhere, only toast (a second modal
		// would double-answer).
		const r = await api(body);
		const j = await r.json().catch(() => null);
		if (j && j.ok === false) {
			if (j.error === "invalid-option") {
				toast("IDE decision rejected — pick from the offered options", "warn");
				openSelectModal(req);
			} else {
				toast("approval already answered elsewhere", "warn");
			}
		}
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
	const inp = pendingToolArgs();
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
	// U6 C11 (FR-39/41): broker identity + active mode ride the payload so the
	// native tab shows the gate's posture and keys decisions by request id.
	// SEC-07: the gate's OFFERED option labels ride too — the IDE button bar
	// renders only these (mandatory-ask = Allow once/Deny, never four buttons).
	const p = pendingApproval;
	const opts = (p && Array.isArray(p.options) ? p.options : [])
		.map((o) => (typeof o === "string" ? o : o && o.label))
		.filter((l) => typeof l === "string");
	return {
		filename,
		path,
		op,
		edits,
		content: inp.content || "",
		leftText,
		rightText,
		requestId: p ? p.requestId : "",
		toolCallId: p ? p.toolCallId : "",
		mode: p && p.provenance ? p.provenance.mode || "default" : "default",
		options: opts,
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
	// plan A5 / FR-8.5: rebuilding drops in-flight edits (documented existing
	// behavior) — when the proposal is dirty, surface that with a warning
	// label instead of silently losing work.
	const ta0 = card.querySelector(".sx-ta");
	const baseline = ta0 ? ta0.value : null;
	const warn = document.createElement("span");
	warn.className = "sx-ctx-warn";
	warn.textContent = "rebuild drops edits";
	warn.hidden = true;
	let warnTimer = 0;
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
		if (ta0 && dv.dirty(baseline, ta0.value)) {
			warn.hidden = false;
			clearTimeout(warnTimer);
			warnTimer = setTimeout(() => {
				warn.hidden = true;
			}, 2500);
		}
		rebuild();
	};
	dec.onclick = () => apply(getDiffCtx() - 1);
	inc.onclick = () => apply(getDiffCtx() + 1);
	wrap.append(dec, num, inc, warn);
	hdr.append(wrap);
}

// The webui permission modal, factored out so the IDE-diff path can fall back
// to it. For edit/write it renders an EDITABLE side-by-side so the user can
// tweak pi's proposal before approving; other tools get the read-only preview.
async function openSelectModal(req) {
	const { id } = req;
	const rawOpts = Array.isArray(req.options) ? req.options : [];
	const allowed =
		pendingApproval && pendingApproval.requestId === id
			? new Set(approvalOptionLabels())
			: null;
	const opts = rawOpts
		.filter((o) => !allowed || allowed.has(typeof o === "string" ? o : o.label))
		.map((o) => (typeof o === "string" ? { label: o } : o));
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
		false,
	);
	const isEditWrite =
		(pendingApproval && pendingApproval.toolName) === "edit" ||
		(pendingApproval && pendingApproval.toolName) === "write" ||
		curToolName === "edit" ||
		curToolName === "write";
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
			// U6 C8: ack-before-close — the modal stays up until the server
			// broadcasts approval_resolved (FR-22); the marker carries the
			// toolCallId + stable decision enum (FR-25).
			sendApprovalDecision(
				id,
				editedValue ? editedValue(val) : val,
				decisionForLabel(editedValue ? editedValue(val) : val),
			);
		};
		list.appendChild(b);
	});
	focusModalControl();
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
		// If the approval ack was lost during an SSE reconnect, this latch is the
		// next proof that the safeguard prompt resolved. Do not charge its wait.
		if (hasPermissionProvenance(lastSafeguardCtx)) {
			resumePermissionTool(curToolCallId);
			lastSafeguardCtx = null;
		}
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
		// U6 C8: the safeguard provenance context (emitted by the extension right
		// before every blocking select) is JSON — stash it for the pending
		// approval; it must NOT overwrite the statusbar text.
		if (req.statusKey === "safeguard") {
			try {
				lastSafeguardCtx = JSON.parse(req.statusText || "null");
			} catch {
				lastSafeguardCtx = null;
			}
			// the provenance broadcast carries the ACTIVE mode (incl. session-only
			// yolo, which no config read can see) — keep the composer chip truthful
			if (lastSafeguardCtx && lastSafeguardCtx.mode)
				setModeChip(lastSafeguardCtx.mode);
			return;
		}
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

	// dialog methods — register the broker-tracked approval BEFORE rendering so
	// the marker + ack flow (FR-25/22) and the diff previews (FR-25) can read
	// tool identity + provenance. The ask bridge (input+MARKER) is handled
	// above and keeps its own immediate-close flow.
	// Safeguard emits setStatus immediately before its blocking prompt, so pause
	// only that tool's clock. The context is cleared on approval_resolved; the
	// later ask_user_question input latch therefore remains a real tool wait.
	if (
		(method === "select" ||
			method === "confirm" ||
			method === "input" ||
			method === "editor") &&
		hasPermissionProvenance(lastSafeguardCtx) &&
		curToolCallId
	)
		pausePermissionTool(curToolCallId);
	if (method === "select") {
		pendingApproval = {
			requestId: id,
			method,
			title: req.title,
			message: req.message,
			options: req.options,
			toolCallId: curToolCallId,
			toolName: curToolName,
			provenance: lastSafeguardCtx,
		};
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
		pendingApproval = {
			requestId: id,
			method,
			title: req.title,
			message: req.message,
			options: null,
			toolCallId: curToolCallId,
			toolName: curToolName,
			provenance: lastSafeguardCtx,
		};
		const body = buildPermissionBody(req.title, req.message);
		showModal(`<h3>${esc(req.title || "Confirm")}</h3>${body.html}`, false);
		const stack = renderEditDiffPreviews(card);
		if (stack) card.classList.add("wide");
		const row = document.createElement("div");
		row.className = "row";
		const no = document.createElement("button");
		no.textContent = "No";
		no.dataset.dismiss = ""; // ponytail: Esc = decline
		no.onclick = () => sendApprovalDecision(id, { confirmed: false }, "deny");
		const yes = document.createElement("button");
		if (body.maxSev >= 3) {
			yes.className = "danger";
			yes.textContent = "Yes, allow";
		} else {
			yes.textContent = "Yes";
		}
		yes.onclick = () =>
			sendApprovalDecision(id, { confirmed: true }, "allow-once");
		row.append(no, yes);
		card.appendChild(row);
		focusModalControl();
	} else if (method === "input") {
		pendingApproval = {
			requestId: id,
			method,
			title: req.title,
			message: req.message,
			options: null,
			toolCallId: curToolCallId,
			toolName: curToolName,
			provenance: lastSafeguardCtx,
		};
		showModal(`<h3>${esc(req.title || "Input")}</h3>`, false);
		toast("Your input is needed", "warn");
		const inp = document.createElement("input");
		inp.type = "text";
		inp.placeholder = req.placeholder || "";
		card.appendChild(inp);
		const row = document.createElement("div");
		row.className = "row";
		const ok = document.createElement("button");
		ok.textContent = "OK";
		ok.onclick = () => sendApprovalDecision(id, inp.value, "allow-once");
		const cancel = document.createElement("button");
		cancel.textContent = "Cancel";
		cancel.dataset.dismiss = ""; // ponytail: Esc = cancel
		cancel.onclick = () =>
			sendApprovalDecision(id, { cancelled: true }, "deny");
		row.append(ok, cancel);
		card.append(inp, row);
		focusModalControl();
	} else if (method === "editor") {
		pendingApproval = {
			requestId: id,
			method,
			title: req.title,
			message: req.message,
			options: null,
			toolCallId: curToolCallId,
			toolName: curToolName,
			provenance: lastSafeguardCtx,
		};
		showModal(`<h3>${esc(req.title || "Edit")}</h3>`, false);
		toast("Your input is needed", "warn");
		const ta = document.createElement("textarea");
		ta.rows = 12;
		ta.value = req.prefill || "";
		card.appendChild(ta);
		const row = document.createElement("div");
		row.className = "row";
		const ok = document.createElement("button");
		ok.textContent = "OK";
		ok.onclick = () => sendApprovalDecision(id, ta.value, "allow-once");
		const cancel = document.createElement("button");
		cancel.textContent = "Cancel";
		cancel.dataset.dismiss = ""; // ponytail: Esc = cancel
		cancel.onclick = () =>
			sendApprovalDecision(id, { cancelled: true }, "deny");
		row.append(ok, cancel);
		card.append(ta, row);
		focusModalControl();
	}
}

// ---- history rendering (full messages from get_messages) ----
// pi-subagents custom-message notices (async completion / steer / control).
// Pure HTML from subagents-ux.js; appended as a muted turn (article, FR-8).
function renderNoticeMsg(msg) {
	const html = window.subagentsUx && subagentsUx.noticeHtml(msg);
	if (!html) return false;
	const art = document.createElement("article");
	art.className = "notice-turn";
	setSafeHtml(art, html);
	feedEl.appendChild(art);
	autoscroll();
	return true;
}

function renderMessage(msg) {
	if (msg.role === "user") {
		let txt = "";
		let imgs = null;
		const c = msg.content;
		if (typeof c === "string") txt = c;
		else if (Array.isArray(c)) {
			txt = c
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
			// image parts (plan 4.10): render alongside the text in the user bubble
			imgs = c.filter((b) => b.type === "image" && b.data);
			if (!imgs.length) imgs = null;
		}
		addUser(txt, imgs, false);
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
			renderUsageStrip(cur.bubble, msg, cur.turnNo);
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
		settleToolGroup(w, msg.isError);
	} else if (msg.role === "custom") {
		// pi-subagents notices (async completion / steering / control) get a
		// dedicated card BEFORE the generic compaction-style marker — both live
		// (message_end below) and reload route through here, so they can't diverge.
		if (renderNoticeMsg(msg)) {
			cur = null;
			return;
		}
		// compaction-aware history (plan F§5.3): a compaction entry from the entry
		// parent-chain renders as a muted, collapsible marker between the dropped
		// (pre-compact) span and the kept messages — so a compacted session never
		// looks abruptly truncated. Summary is pi-generated markdown; md() escapes
		// raw HTML (html:false), same path as assistant text. Collapsed by default
		// (it's metadata, not conversation). Generic custom messages render too.
		const wrap = document.createElement("article");
		wrap.className = "compact-turn"; // FR-8: the marker is a turn (article)
		const d = document.createElement("details");
		d.className = "compact-mark"; // CSS `> summary` selectors stay intact
		const isCompaction = msg.customType === "compaction";
		const meta =
			isCompaction && typeof msg.tokensBefore === "number"
				? `· ~${fmt(msg.tokensBefore)} tokens before`
				: msg.customType
					? `· ${msg.customType}`
					: "";
		const sum = document.createElement("summary");
		setSafeHtml(
			sum,
			`<span class="cm-glyph"></span>` +
				`<span class="cm-label">${esc(
					isCompaction ? "Context compacted" : msg.customType || "custom",
				)}</span>` +
				(meta ? `<span class="cm-meta">${esc(meta)}</span>` : ""),
		);
		d.appendChild(sum);
		if (msg.content != null) {
			const body = document.createElement("div");
			body.className = "cm-body";
			const src =
				typeof msg.content === "string"
					? msg.content
					: toolProtocol.toolContentText(msg.content);
			if (src) setSafeHtml(body, md(src));
			d.appendChild(body);
		}
		wrap.appendChild(d);
		feedEl.appendChild(wrap);
		cur = null;
	} else if (msg.role === "bashExecution") {
		const turn = document.createElement("article");
		turn.className = "msg"; // FR-8: a turn — article wrapper
		turn.classList.add("tool-turn");
		const el = document.createElement("details");
		el.className = "tool done";
		setSafeHtml(
			el,
			`<summary class="head"><span class="trow"><span class="caret">▸</span><span class="name">bash</span></span><code>${esc(msg.command || "")}</code></summary><div class="out">${esc(msg.output || "")}</div>`,
		);
		turn.appendChild(el);
		feedEl.appendChild(turn);
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
const a11yStatus = $("a11y-status");
function announceStatus(evt) {
	// coarse progress only — the pure mapping (a11y-contrast.statusTextForEvent)
	// returns null for every streaming event, so this never fires per token
	const a11y = window.a11yContrast;
	const txt =
		a11y && a11y.statusTextForEvent ? a11y.statusTextForEvent(evt) : null;
	if (txt && a11yStatus) a11yStatus.textContent = txt;
}
function handle(payload) {
	switch (payload.type) {
		case "agent_start":
			agentStarts++;
			if (usageEvents)
				usageEvents.startTurn(
					payload.turnId || payload.requestId || payload.id,
					Date.now(),
				);
			sealLatestToolGroup();
			announceStatus("agent_start");
			setStreaming(true);
			setActivity("thinking…", true);
			// reset per-tool tracking for a fresh turn
			curToolName = null;
			curToolArgs = null;
			curToolCallId = null;
			toolArgs.clear(); // per-turn args; the replay re-feeds them (FR-25)
			break;
		case "agent_end":
			if (usageEvents && !suppressUsageEnd)
				usageEvents.endTurn(
					payload.turnId || payload.requestId || payload.id,
					Date.now(),
				);
			// safety net: render if message_end never fired (broken stream).
			// finalizeBubble drops an empty bubble, so this can't leave a stray label.
			// setStreaming(false) below then nulls cur.
			announceStatus("agent_end");
			if (cur) finalizeBubble();
			sealLatestToolGroup();
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
			// custom messages (pi-subagents notices, compaction markers, …) never
			// build an assistant bubble — render them directly, then bail. Without
			// this the async-completion notice was invisible until reload.
			if (payload.message && payload.message.role === "custom") {
				if (!renderNoticeMsg(payload.message)) {
					// generic custom (incl. live compaction markers): reuse the reload
					// renderer so live and reload stay byte-identical.
					renderMessage(payload.message);
				}
				cur = null;
				break;
			}
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
					payload.message,
				);
				// ponytail: count toward the "↓ N new" pill if the user scrolled away.
				// cur only exists when text/thinking streamed, so tool-only turns whose
				// bubble was dropped aren't mis-counted.
				if (!pinned) {
					unread++;
					refreshJump();
				}
			}
			if (payload.message && payload.message.role === "assistant") {
				const mi = appendLiveAssistant(payload.message);
				if (cur && cur.bubble && cur.bubble.parentElement)
					cur.bubble.parentElement.setAttribute("data-mi", String(mi));
				refreshOpenAnalysis();
			}
			cur = null;
			break;

		case "message_update": {
			const e = payload.assistantMessageEvent;
			if (!e) break;
			if (
				usageEvents &&
				(e.type === "text_delta" || e.type === "thinking_delta")
			)
				usageEvents.markFirstToken(
					payload.turnId || payload.requestId || payload.id,
					Date.now(),
				);
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
			if (usageEvents)
				usageEvents.startTool(payload.toolCallId, payload.toolName, Date.now());
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
			curToolCallId = payload.toolCallId || null;
			if (payload.toolCallId) toolArgs.set(payload.toolCallId, payload.args);
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
			if (usageEvents)
				usageEvents.endTool(
					payload.toolCallId,
					Date.now(),
					payload.isError === true,
				);
			const w = toolBlocks.get(payload.toolCallId);
			// build the result text once; consumed inside the if(w) block below.
			let t = "";
			if (w) {
				w.el.classList.remove("run");
				w.el.classList.add(payload.isError ? "err" : "done");
				if (w.startedAt && w.dur)
					w.dur.textContent = fmtToolDur(Date.now() - w.startedAt);
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
					openTool(w, true);
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
						if (t.length > 500) openTool(w, false);
					}
				}
			}
			settleToolGroup(w, payload.isError);
			// clear the per-tool snapshot now that this tool is done — prevents a
			// stale edit/write diff leaking onto an unrelated later select/confirm
			curToolName = null;
			curToolArgs = null;
			// A delayed tool-end must not revive the activity bar after agent_end.
			setActivity(streaming ? "thinking…" : "ready", streaming);
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
			announceStatus("auto_retry_start");
			toast(
				`retry ${payload.attempt}/${payload.maxAttempts}: ${(payload.errorMessage || "").slice(0, 80)}`,
				"warn",
			);
			break;
		case "compaction_start":
			announceStatus("compaction_start");
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

const sb = ["repo", "git", "model", "think", "cache", "tok", "cost"].reduce(
	(o, k) => ((o[k] = $("sb-" + k)), o),
	{},
);
// The header spends its available width on live session telemetry first, then
// moves only trailing items into the native … popover. DOM moves keep the
// existing status-node references live; no duplicate values can drift.
const sbSec = $("sb-sec");
const sbInline = $("sb-inline");
const sbOverflow = $("sb-overflow");
const sbMeta = sbInline ? [...sbInline.querySelectorAll("[data-sb-meta]")] : [];
const sbBar = $("statusbar");
const barOvf = $("bar-ovf"); // composer overflow ⋯ (spec FR-4)
let sbNarrow = document.body.classList.contains("w-narrow");
let sbOverflowRaf = 0;
function syncHeaderStatusOverflow() {
	if (!sbSec || !sbInline || !sbOverflow || !sbMeta.length) return;
	const wasOpen = sbSec.open;
	for (const item of sbMeta) sbInline.appendChild(item);
	sbSec.hidden = true;
	const overflows = () => sbInline.scrollWidth > sbInline.clientWidth + 1;
	while (overflows() && sbInline.lastElementChild)
		sbOverflow.prepend(sbInline.lastElementChild);
	if (!sbOverflow.childElementCount) {
		sbSec.open = false;
		return;
	}
	// Showing … costs width too; move further items only if that makes them fit.
	sbSec.hidden = false;
	while (overflows() && sbInline.lastElementChild)
		sbOverflow.prepend(sbInline.lastElementChild);
	sbSec.open = wasOpen;
}
function queueSbOverflow() {
	if (sbOverflowRaf) return;
	sbOverflowRaf = requestAnimationFrame(() => {
		sbOverflowRaf = 0;
		syncHeaderStatusOverflow();
	});
}
if (sbSec) sbSec.open = false;
if (barOvf) barOvf.open = !sbNarrow; // wide: inline; narrow: starts closed
function syncSbOverflow() {
	if (!sbSec && !barOvf) return;
	const n = document.body.classList.contains("w-narrow");
	if (n !== sbNarrow) {
		// Only react to a real width-mode crossing, never a same-mode resize.
		sbNarrow = n;
		if (sbSec && n) sbSec.open = false;
		if (barOvf) barOvf.open = !n;
	}
	queueSbOverflow();
}
document.body.addEventListener("widthchange", syncSbOverflow);
if (sbBar && typeof ResizeObserver === "function") {
	const observer = new ResizeObserver(queueSbOverflow);
	observer.observe(sbBar);
} else window.addEventListener("resize", queueSbOverflow);
queueSbOverflow();
function refreshSbModel() {
	sb.model.textContent = (modelSel.selectedOptions[0] || {}).textContent || "…";
	queueSbOverflow();
}
function refreshSbThink() {
	sb.think.textContent = thinkSel.value || "—";
	queueSbOverflow();
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
			queueSbOverflow();
		})
		.catch(() => {});
}
function refreshStats() {
	api({ type: "get_session_stats", id: "sb-stats" });
	refreshModeChip(); // piggyback: keeps the composer mode chip fresh (15s/3s)
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
	queueSbOverflow();
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
// Last snapshot state, kept for the on-demand session-analysis modal (plan 4.3):
// the messages array (with per-message usage), aggregate stats, and whether a
// turn is live. Refreshed by every apply* call so the modal reflects the latest.
let lastMessages = [],
	lastStats = null,
	lastRunning = false;
// ---- context-pressure meter + Compact promotion (spec FR-10) ----
// Width % = contextUsage.percent; bands: neutral <50, --warning 50–70,
// --danger >=70 (body.ctx-hot also promotes #compact at narrow widths).
const CTX_HOT = 70;
const ctxMeter = $("ctx-meter");
const ctxLabel = $("ctx-label");
function updateCtxMeter(cu) {
	if (!ctxMeter) return;
	const p = cu && cu.percent != null ? cu.percent : null;
	document.body.classList.toggle("ctx-on", p != null);
	document.body.classList.toggle(
		"ctx-mid",
		p != null && p >= 50 && p < CTX_HOT,
	);
	document.body.classList.toggle("ctx-hot", p != null && p >= CTX_HOT);
	if (p != null) {
		document.documentElement.style.setProperty("--ctx-pct", p + "%");
		// the meter's label is now the single context readout (user decision
		// 2026-08-07 — the statusbar sb-ctx display was removed)
		if (ctxLabel)
			ctxLabel.textContent = `${p.toFixed(0)}% (${fmt(cu.tokens)}/${fmt(
				cu.contextWindow,
			)})`;
	} else {
		document.documentElement.style.setProperty("--ctx-pct", "0%");
		if (ctxLabel) ctxLabel.textContent = "context —";
	}
}
function applyState(data) {
	if (!data) return;
	if (data.thinkingLevel != null) setThinkSel(data.thinkingLevel);
	if (data.isStreaming != null) {
		// get_state is authoritative. Its explicit idle state must clear the
		// activity row too; otherwise a lost agent_end leaves "thinking…" pinned.
		const isStreaming = data.isStreaming === true;
		setStreaming(isStreaming);
		lastRunning = isStreaming;
	}
	if (data.isCompacting != null) setCompacting(data.isCompacting === true);
	if (data.isCompacting === true) {
		setActivity("compacting context…", true);
	} else if (data.isStreaming === true) {
		setActivity("working…", true);
	} else if (data.isStreaming === false) {
		setActivity("ready", false);
	}
	if (setCurrentModel(data.model)) {
		applyCurrentModel();
		refreshUsageBar();
		refreshStats();
	}
	curSessionFile = data.sessionFile || null;
	setUsageSession(data.sessionFile);
	refreshPonytailMode(data.sessionFile);
	refreshSessionsSidebar();
}
function applyMessages(messages) {
	if (!Array.isArray(messages)) return;
	lastMessages = messages;
	assistantTurnId.n = 0;
	// a11y FR-9: bracket the synchronous DOM mutation with aria-busy so
	// screen readers don't traverse a half-replaced conversation
	feedEl.setAttribute("aria-busy", "true");
	setSafeHtml(feedEl, ""); // clear the FEED, not <main> — the feed is a child of it
	toolBlocks.clear();
	replayArgs = {}; // rebuild the toolCall-id → args map for this replay
	messages.forEach((msg, idx) => {
		renderMessage(msg);
		const el = feedEl.lastChild;
		if (el && el.setAttribute) el.setAttribute("data-mi", String(idx));
	});
	feedEl.setAttribute("aria-busy", "false");
	scrollDown();
	updateEmptyState(); // spec FR-8 — bootstrap/replay may leave the transcript empty
	refreshOpenAnalysis();
}
function applyCommands(cmds) {
	if (Array.isArray(cmds)) commands = cmds;
}
function applyModels(models) {
	if (Array.isArray(models)) populateModels(models);
}
function applyStats(data) {
	if (!data) return;
	lastStats = data;
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
	updateCtxMeter(data.contextUsage); // spec FR-10 — same event that refreshes the readout
	queueSbOverflow();
	refreshOpenAnalysis();
	recordUsageSample(false);
}
function recordUsageSample(force) {
	if (!usageTelemetry || !usageHistory || document.hidden) return false;
	const now = Date.now();
	if (!force && usageLastSampleAt && now - usageLastSampleAt < USAGE_SAMPLE_MS)
		return false;
	let analysis = null;
	try {
		const sa = window.sessionAnalysis;
		if (sa && sa.analyzeSession)
			analysis = sa.analyzeSession(lastMessages, lastStats, lastRunning);
	} catch {
		analysis = null;
	}
	const sample = usageTelemetry.sampleFromAnalysis(
		now,
		analysis,
		lastStats,
		usageEvents ? usageEvents.snapshot() : null,
	);
	if (!sample || !usageTelemetry.appendSample(usageHistory, sample))
		return false;
	usageTelemetry.saveHistory(null, usageHistory, now);
	usageLastSampleAt = now;
	refreshOpenAnalysis();
	return true;
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
		// capture pi's streaming flag BEFORE applyState sets it (plan 5.1): if the
		// buffer replays a partial turn but pi is idle, that turn died in a crash
		// and must be finalized so the transcript isn't frozen mid-stream.
		const piStreaming = snap.state && snap.state.isStreaming;
		applyState(snap.state);
		applyMessages(snap.messages);
		applyCommands(snap.commands);
		applyModels(snap.models);
		applyStats(snap.stats);
		// replay the current-turn buffer on top of the rebuilt committed history so
		// in-flight tool cards / streaming text survive a reconnect. handle() is
		// safe to re-run here: applyMessages just cleared toolBlocks + nulled cur,
		// and agent_start (always first in the buffer) resets per-tool tracking —
		// nothing duplicates. For a live mid-turn SSE drop (pi still running), the
		// replayed turn then continues as pi streams more events.
		const replayed = replayLiveEvents(snap.liveEvents);
		if (replayed && !piStreaming) {
			// partial turn (the buffer holds no agent_end — turns clear on agent_end)
			// + pi idle → the turn is dead (pi crashed/was killed mid-turn). Finalize
			// the ghost bubble + stop streaming, and neutralize tool cards still
			// mid-run so their spinner doesn't imply still-active.
			finalizeDeadTurn();
		}
		// Race guard ("stuck writing…"): the snapshot is a point-in-time bundle —
		// get_state was read on the server BEFORE the possibly-multi-MB transcript
		// was serialized, so a turn can end while the snapshot is in flight. The
		// live stream already consumed that turn's agent_end (buffer cleared), and
		// replaying the stale buffer then re-arms "writing…" with nothing left to
		// reset it (the !piStreaming branch above is skipped because the STALE
		// flag said the turn was live). Re-verify against fresh pi state: if pi is
		// now idle and no NEW turn started meanwhile, synthesize the turn end.
		// The snap-recheck handler deliberately does NOT applyState() — a stale
		// isStreaming:true captured by the check itself must not re-arm the
		// spinner after the live stream already reset it.
		if ((snap.state && snap.state.isStreaming) || replayed) {
			snapRecheckStarts = agentStarts; // AFTER replay — replay bumps agent_start
			api({ type: "get_state", id: "snap-recheck" });
		}
		recordUsageSample(true);
		// U6 C8 (FR-21): a reload mid-approval must re-render the pending request
		// from the broker snapshot — the original requestId stays valid, so the
		// user's decision still resolves the latch. The tool identity comes from
		// the record (the live stream's tool_execution_start may predate us).
		if (snap.pendingApprovals && snap.pendingApprovals.length) {
			const rec = snap.pendingApprovals[0];
			pendingApproval = {
				requestId: rec.requestId,
				method: rec.method,
				title: rec.title,
				message: rec.message,
				options: rec.options,
				toolCallId: rec.toolCallId,
				toolName: rec.toolName,
				provenance: rec.provenance,
			};
			if (rec.toolCallId) {
				curToolCallId = rec.toolCallId;
				if (hasPermissionProvenance(rec.provenance))
					pausePermissionTool(rec.toolCallId);
			}
			if (rec.toolName) curToolName = rec.toolName;
			openSelectModal({
				id: rec.requestId,
				title: rec.title,
				message: rec.message,
				options: rec.options,
			});
		}
		return true;
	} catch {
		return false;
	}
}
// finalize a turn whose terminal event the page will never receive (pi died
// mid-turn, or a stale snapshot replay re-armed the status after the real
// agent_end was consumed): synthesize agent_end + neutralize still-"run" tool
// cards so no spinner implies an active turn. Idempotent — agent_end with a
// null cur only resets streaming/status, and a re-run after the real end is a
// no-op.
function finalizeDeadTurn() {
	suppressUsageEnd = true;
	try {
		handle({ type: "agent_end" });
	} finally {
		suppressUsageEnd = false;
	}
	// A crashed turn is not completed telemetry; cancel its active identities
	// while preserving the cumulative completed totals for the next turn.
	if (usageEvents) usageEvents.reset(usageEvents.snapshot());
	for (const b of toolBlocks.values())
		if (b.el.classList.contains("run")) {
			b.el.classList.remove("run");
			b.el.classList.add("done");
			settleToolGroup(b, false);
		}
}
// replay the current-turn buffer (plan F§5.2): re-apply each buffered event's
// payload through handle() — the same path live SSE events take — so tool cards
// + streaming text rebuild identically. Returns true if any event was replayed
// (fetchSnapshot uses this to decide whether to finalize a dead/partial turn on
// an idle pi). The sequence each event carries is currently unused (the whole
// buffer replays after a transcript clear); it's the foundation for future
// incremental gap-only replay.
function replayLiveEvents(events) {
	if (!Array.isArray(events) || !events.length) return false;
	for (let i = 0; i < events.length; i++) {
		const ev = events[i];
		if (ev && ev.payload) handle(ev.payload);
	}
	return true;
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
let usageSampleTimer = document.hidden
	? 0
	: setInterval(recordUsageSample, USAGE_SAMPLE_MS);
let planTimer = setInterval(refreshPlanState, 30000);
function rescheduleStats() {
	clearInterval(statsTimer);
	statsTimer = setInterval(refreshStats, streaming ? STATS_FAST : STATS_IDLE);
}
document.addEventListener("visibilitychange", () => {
	if (document.hidden) {
		if (usageTelemetry) usageTelemetry.pauseHistory(usageHistory);
		clearInterval(statsTimer);
		clearInterval(healthTimer);
		clearInterval(usageTimer);
		clearInterval(usageSampleTimer);
		clearInterval(planTimer);
	} else {
		if (usageTelemetry) usageTelemetry.resumeHistory(usageHistory);
		recordUsageSample(true);
		refreshStats();
		refreshHealth();
		refreshUsageBar();
		refreshPlanState();
		rescheduleStats();
		healthTimer = setInterval(refreshHealth, 6000);
		usageTimer = setInterval(refreshUsageBar, 60000);
		usageSampleTimer = setInterval(recordUsageSample, USAGE_SAMPLE_MS);
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
			if (p.id === "snap-recheck" && p.data) {
				// fetchSnapshot race guard (see there): the snapshot claimed a live
				// turn (or replayed a partial buffer), but this FRESH get_state proves
				// it ended — synthesize the end so the activity bar can't stick on
				// "writing…". Skipped when agent_start has fired since (a new turn
				// owns the status and will deliver its own agent_end).
				if (p.data.isStreaming === false && agentStarts === snapRecheckStarts) {
					finalizeDeadTurn();
				}
			} else if (p.id === "init-state" && p.data) applyState(p.data);
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
	} else if (env.source === "server" && env.type === "approval_resolved") {
		// U6 C8 (FR-22/24): the server acknowledged OUR decision — close the
		// approval UI. A mismatched requestId is someone else's broadcast and
		// must not close anything (FR-24).
		if (pendingApproval && pendingApproval.requestId === env.requestId) {
			resumePermissionTool(pendingApproval.toolCallId);
			lastSafeguardCtx = null;
			hideModal();
			clearPendingApproval();
		}
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
		setSafeHtml(feedEl, "");
		toolBlocks.clear();
		curSessionFile = null;
		resetUsageSession();
		setStreaming(false);
		// U6 C8: the old project's approvals/args must not leak into the new one
		clearPendingApproval();
		toolArgs.clear();
		curToolCallId = null;
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
	syncImageAttachmentUi();
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
		syncImageAttachmentUi();
		return;
	}
	availableModels.forEach((m) => {
		const o = document.createElement("option");
		o.value = JSON.stringify({ provider: m.provider, modelId: m.id });
		o.textContent = (m.name || m.id) + " · " + m.provider;
		modelSel.appendChild(o);
	});
	applyCurrentModel();
	syncImageAttachmentUi();
}
modelSel.onchange = () => {
	refreshSbModel();
	try {
		const v = JSON.parse(modelSel.value);
		currentModelId = v.provider + "/" + v.modelId;
		if (currentProvider !== v.provider) sessionUsage = null;
		currentProvider = v.provider;
		syncImageAttachmentUi();
		localStorage.setItem("pi:model", currentModelId);
		refreshUsageBar();
		refreshStats();
		api({ type: "set_model", provider: v.provider, modelId: v.modelId });
	} catch {}
};
$("models-btn").onclick = () =>
	api({ type: "get_available_models", id: "init-models" });

// ---- settings page ----
// ponytail: a real in-shell PAGE (design.md §4), same pattern as #permissions:
// hidden-attribute toggle + body.page-open (which hides the chat column). The
// relocated selects keep their IDs, so their onchange handlers (model/think/pony)
// work unchanged from the old drawer position.
const settingsEl = $("settings");
function openSettings() {
	closePermPage();
	closeFleetPage();
	settingsEl.hidden = false;
	settingsEl.classList.add("open");
	settingsEl.setAttribute("aria-hidden", "false");
	document.body.classList.add("page-open");
	settingsEl.focus();
}
function closeSettings() {
	settingsEl.hidden = true;
	settingsEl.classList.remove("open");
	settingsEl.setAttribute("aria-hidden", "true");
	document.body.classList.remove("page-open");
}
$("refresh-btn").onclick = () => location.reload();
$("settings-btn").onclick = openSettings;
$("settings-close").onclick = closeSettings;
settingsEl.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closeSettings();
});

// ---- #permissions page (U6 C10: FR-29..36, FR-17) ----
// Hash-routed full page: posture (mode selector + yolo confirm), explain,
// effective policy layers, diagnostics, session grants, decision audit.
// All reads/writes go through the fixed /api/permissions endpoints — the
// browser never touches policy files directly (FR-37).
const permPage = $("permissions");
const permPageEls = {
	mode: $("perm-mode"),
	modePage: $("perm-mode-page"),
	modeState: $("perm-mode-state"),
	confirm: $("perm-confirm"),
	layers: $("perm-layers"),
	diags: $("perm-diags"),
	grants: $("perm-grants"),
	audit: $("perm-audit"),
	explainTool: $("perm-explain-tool"),
	explainSel: $("perm-explain-sel"),
	explainOut: $("perm-explain-out"),
};
let permData = null; // last GET /api/permissions payload
const pu = window.permissionsUx; // pure helpers (dual-mode module)

// ---- composer mode chip (always-visible permission posture) ----
// Polled via refreshStats (persisted modes) + updated live from the
// extension's safeguard setStatus broadcast (yolo — session-only, FR-12).
const modeChip = $("mode-chip");
function setModeChip(mode) {
	const m = mode || "default";
	modeChip.textContent = m === "yolo" ? "\u26a0 yolo" : m;
	modeChip.dataset.mode = m;
	modeChip.title =
		m === "yolo"
			? "⚠ yolo — everything auto-allows this session. click to open permissions"
			: "permission mode — click to open permissions";
}
async function refreshModeChip() {
	try {
		const r = await fetch("/api/permissions/mode");
		const j = await r.json();
		if (j && j.ok) setModeChip(j.mode);
	} catch {
		/* best-effort */
	}
}
modeChip.onclick = () => {
	location.hash = "#permissions";
};
refreshModeChip();

function openPermPage() {
	closeSettings();
	closeFleetPage();
	permPage.hidden = false;
	permPage.classList.add("open");
	document.body.classList.add("page-open");
	permPage.focus();
	refreshPermPage();
}
function closePermPage() {
	permPage.hidden = true;
	permPage.classList.remove("open");
	document.body.classList.remove("page-open");
	// only clear OUR hash — another page may own the route right now (e.g.
	// #fleet navigation calling closePermPage mid-hashchange)
	if (location.hash === "#permissions")
		history.replaceState(null, "", location.pathname + location.search);
}
function permRoute() {
	if (location.hash === "#permissions") openPermPage();
}
window.addEventListener("hashchange", permRoute);
permRoute();
permPage.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closePermPage();
});
$("perm-close").onclick = closePermPage;
$("perm-page-btn").onclick = () => {
	location.hash = "#permissions";
};

// ---- #fleet page (pi-subagents async background runs) ----
// In-shell page like settings/permissions: hash-routed (#fleet), 2s poll while
// open, stop/steer via the server's file-inbox bridge (/api/subagents/*).
// Logs are cached per run id so the 2s re-render never clobbers an open log.
const fleetEl = $("fleet");
const fleetListEl = $("fleet-list");
const sau = window.subagentsUx; // pure helpers (dual-mode module)
let fleetTimer = null;
let fleetSteerTarget = null; // run id selected for steering (click a row)
const fleetLogs = new Map(); // runId → log text (survives re-renders)

function openFleetPage() {
	closeSettings();
	closePermPage();
	fleetEl.hidden = false;
	fleetEl.classList.add("open");
	document.body.classList.add("page-open");
	fleetEl.focus();
	refreshFleet();
	if (!fleetTimer) fleetTimer = setInterval(refreshFleet, 2000);
}
function closeFleetPage() {
	fleetEl.hidden = true;
	fleetEl.classList.remove("open");
	document.body.classList.remove("page-open");
	if (fleetTimer) {
		clearInterval(fleetTimer);
		fleetTimer = null;
	}
	if (location.hash === "#fleet")
		history.replaceState(null, "", location.pathname + location.search);
}
function fleetRoute() {
	if (location.hash === "#fleet") openFleetPage();
}
window.addEventListener("hashchange", fleetRoute);
fleetRoute();
fleetEl.addEventListener("keydown", (e) => {
	if (e.key === "Escape") closeFleetPage();
});
$("fleet-close").onclick = closeFleetPage;

async function refreshFleet() {
	try {
		const r = await fetch("/api/subagents");
		const j = await r.json();
		if (!j || !j.ok) return;
		setSafeHtml(
			fleetListEl,
			sau.fleetHtml(
				j.runs,
				"no background subagent runs — spawn one via the subagent tool (async)",
			),
		);
		// restore open logs + selection across the re-render
		for (const row of fleetListEl.querySelectorAll(".fl-row")) {
			const id = row.dataset.id;
			row.classList.toggle("sel", id === fleetSteerTarget);
			const log = fleetLogs.get(id);
			if (log != null) {
				const pre = row.querySelector("pre.fl-log");
				pre.textContent = log;
				pre.hidden = false;
			}
		}
	} catch {
		/* transient — next tick retries */
	}
}

async function fleetControl(body) {
	try {
		const r = await fetch("/api/subagents/control", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const j = await r.json();
		if (!j || !j.ok) toast((j && j.error) || "control failed", "err");
		return j;
	} catch {
		toast("control request failed", "err");
		return null;
	}
}

// one delegated handler: stop / step-log / run-log / row-select (steer target)
fleetListEl.addEventListener("click", async (e) => {
	const row = e.target.closest(".fl-row");
	if (!row) return;
	const id = row.dataset.id;
	if (e.target.classList.contains("fl-stop")) {
		// graceful stop first; a second click (button relabeled "force stop" once
		// stop.json is pending) escalates to the timeout path, which kills the
		// children instead of waiting for a hung LLM call to reach a boundary.
		const force = e.target.dataset.force === "1";
		if (
			!confirm(
				force
					? "Force stop? Kills the child processes immediately (unsaved work is lost)."
					: "Stop this background run?",
			)
		)
			return;
		const j = await fleetControl({ id, action: force ? "force" : "stop" });
		if (j && j.ok) {
			toast(force ? "force stop sent" : "stop requested", "ok");
			refreshFleet();
		}
		return;
	}
	if (e.target.classList.contains("fl-log-btn")) {
		const pre = row.querySelector("pre.fl-log");
		if (
			!pre.hidden &&
			pre.dataset.kind === (e.target.dataset.kind || "output")
		) {
			pre.hidden = true;
			fleetLogs.delete(id);
			return;
		}
		const kind = e.target.dataset.kind === "run" ? "run" : "output";
		const step = e.target.dataset.step;
		pre.textContent = "loading…";
		pre.hidden = false;
		pre.dataset.kind = kind;
		try {
			const q =
				"/api/subagents/log?id=" +
				encodeURIComponent(id) +
				"&kind=" +
				kind +
				(step != null ? "&step=" + encodeURIComponent(step) : "");
			const r = await fetch(q);
			const j = await r.json();
			const text = j.ok
				? (j.truncated ? "…(tail)\n" : "") + j.text
				: j.error || "no log";
			pre.textContent = text;
			fleetLogs.set(id, text);
		} catch {
			pre.textContent = "failed to load log";
		}
		return;
	}
	// clicking anywhere else on the row selects it as the steer target
	fleetSteerTarget = fleetSteerTarget === id ? null : id;
	for (const r2 of fleetListEl.querySelectorAll(".fl-row"))
		r2.classList.toggle("sel", r2.dataset.id === fleetSteerTarget);
});

// steer bar: sends to the selected row (or the only active run)
async function sendFleetSteer() {
	const input = $("fl-steer-input");
	const message = input.value.trim();
	if (!message) return;
	let id = fleetSteerTarget;
	if (!id) {
		const stops = fleetListEl.querySelectorAll(".fl-row .fl-stop");
		if (stops.length === 1) id = stops[0].dataset.id;
	}
	if (!id) {
		toast("select a run first (click its row)", "warn");
		return;
	}
	const j = await fleetControl({ id, action: "steer", message });
	if (j && j.ok) {
		toast("steered", "ok");
		input.value = "";
	}
}
$("fl-steer-send").onclick = sendFleetSteer;
$("fl-steer-input").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		sendFleetSteer();
	}
});
async function refreshPermPage() {
	try {
		const r = await fetch("/api/permissions");
		const j = await r.json();
		if (!j || !j.ok) {
			toast("permissions fetch failed", "err");
			return;
		}
		permData = j;
		const mode = j.mode || "default";
		permPageEls.mode.value = mode === "yolo" ? "default" : mode; // settings select: persisted modes only
		permPageEls.modePage.value = mode;
		permPageEls.modeState.textContent =
			mode === "yolo"
				? "⚠ YOLO active — everything auto-allows this session"
				: mode === "read-only"
					? "read-only — mutations denied silently"
					: mode === "auto-approve"
						? "auto-approve — ordinary asks skipped (sensitive still prompts)"
						: "";
		// effective policy layers (FR-30) + diagnostics (FR-33)
		const tree = pu.buildLayerTree(
			j.layers.default,
			j.layers.user,
			j.layers.workspace,
			j.diagnostics,
		);
		setSafeHtml(permPageEls.layers, renderLayerTree(tree.tools, j.layers.user));
		wireRuleRemove();
		fillPermTools(j);
		if (tree.diagnostics.length) {
			permPageEls.diags.hidden = false;
			setSafeHtml(
				permPageEls.diags,
				"<h4>diagnostics</h4>" +
					tree.diagnostics
						.map(
							(d) =>
								`<div class="perm-diag"><span class="perm-layer">${esc(d.layer)}</span><code>${esc(d.path)}</code><span>${esc(d.message)}</span></div>`,
						)
						.join(""),
			);
		} else permPageEls.diags.hidden = true;
		// session grants (FR-32)
		renderPermGrants(j.grants);
		// decision audit (FR-34)
		fetchPermAudit();
	} catch (e) {
		toast("permissions fetch failed: " + e.message, "err");
	}
}
function renderLayerTree(tools, userCfg) {
	if (!tools || !tools.length)
		return "<p class='perm-empty'>no per-tool rules</p>";
	let h = "";
	for (const t of tools) {
		h += `<div class="perm-tool"><div class="perm-tool-head"><span class="perm-tool-name">${esc(t.tool)}</span><span class="perm-fallback">fallback ${esc(t.fallback)}</span></div>`;
		for (const r of t.rules) {
			h += `<div class="perm-rule"><code>${esc(r.pattern)}</code><span class="perm-action ${esc(r.action)}">${esc(r.action)}</span>`;
			h += r.layers
				.map((l) => `<span class="perm-layer">${esc(l)}</span>`)
				.join("");
			// user-layer rules are the editable layer (floor locked, workspace
			// tighten-only via its own file) — offer remove for those
			if (r.layers.includes("user"))
				h += `<button type="button" class="perm-rule-rm" data-rm="${esc(t.tool)}" data-pat="${esc(r.pattern)}" title="remove rule">×</button>`;
			h += `</div>`;
		}
		h += `</div>`;
	}
	return h;
}
// remove buttons on user-layer rules → mutate the user cfg + revision-checked PUT
function wireRuleRemove() {
	permPageEls.layers.querySelectorAll("[data-rm]").forEach((b) => {
		b.onclick = () => {
			const cur = (permData && permData.layers && permData.layers.user) || {};
			const res = pu.removeRule(cur, b.dataset.rm, b.dataset.pat);
			if (!res.ok) {
				toast(res.error, "err");
				return;
			}
			saveUserRule(res.config);
		};
	});
}
// shared revision-checked config write for mode + rule edits (FR-37)
async function saveUserRule(cfg, okMsg) {
	const cur = (permData && permData.layers && permData.layers.user) || {};
	try {
		const r = await fetch("/api/permissions/config", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ revision: cur.revision, config: cfg }),
		});
		const j = await r.json();
		if (j && j.ok) {
			toast(okMsg || "rule updated", "ok");
			refreshPermPage();
			return true;
		}
		toast("rule save failed: " + (j.error || "validation"), "err");
		refreshPermPage(); // re-sync with the server truth
	} catch (e) {
		toast("rule save failed: " + e.message, "err");
	}
	return false;
}
// datalist of known tool names for the rule + explain inputs
const PERM_TOOL_EXTRAS = [
	"bash",
	"edit",
	"write",
	"read",
	"grep",
	"find",
	"ls",
	"glob",
	"subagent",
	"ask_user_question",
	"todo",
];
function fillPermTools(j) {
	const el = $("perm-tools");
	if (!el) return;
	const meta = new Set([
		"version",
		"revision",
		"mode",
		"nonInteractive",
		"sensitivePaths",
		"grants",
		"*",
	]);
	const names = new Set(PERM_TOOL_EXTRAS);
	for (const L of [j.layers.default, j.layers.user, j.layers.workspace])
		for (const k of Object.keys(L || {})) if (!meta.has(k)) names.add(k);
	setSafeHtml(
		el,
		[...names]
			.sort()
			.map((n) => `<option value="${esc(n)}">`)
			.join(""),
	);
}
function renderPermGrants(grants) {
	if (!Array.isArray(grants) || !grants.length) {
		setSafeHtml(
			permPageEls.grants,
			"<p class='perm-empty'>no session grants</p>",
		);
		return;
	}
	let h = "";
	grants.forEach((g, i) => {
		h += `<div class="perm-grant"><span class="perm-grant-n">${i + 1}.</span><code>${esc(g.toolName || "?")}</code><span class="perm-muted">${new Date(g.at).toLocaleTimeString()}</span><button type="button" data-revoke="${i + 1}">revoke</button></div>`;
	});
	setSafeHtml(permPageEls.grants, h);
	permPageEls.grants.querySelectorAll("[data-revoke]").forEach((b) => {
		b.onclick = () => {
			fetch("/api/permissions/grants/" + b.dataset.revoke, {
				method: "DELETE",
			})
				.then((r) => r.json())
				.then((j) => {
					toast(
						j && j.ok ? "revoke sent" : "revoke failed",
						j && j.ok ? "ok" : "err",
					);
					refreshPermPage();
				});
		};
	});
}
$("perm-grants-clear").onclick = () => {
	fetch("/api/permissions/grants", { method: "DELETE" })
		.then((r) => r.json())
		.then((j) => {
			toast(
				j && j.ok ? "grants cleared" : "clear failed",
				j && j.ok ? "ok" : "err",
			);
			refreshPermPage();
		});
};
async function fetchPermAudit() {
	try {
		const r = await fetch("/api/permissions/audit");
		const j = await r.json();
		const entries = (j && j.entries) || [];
		if (!entries.length) {
			setSafeHtml(
				permPageEls.audit,
				"<p class='perm-empty'>no decisions yet</p>",
			);
			return;
		}
		let h = "";
		for (const e of entries.slice(-30).reverse()) {
			const denied = e.decision === "Deny" || e.decision === "deny";
			h += `<div class="perm-audit-row"><span class="perm-muted">${new Date(e.t).toLocaleTimeString()}</span><code>${esc(e.toolName || "")}</code><span class="perm-action ${denied ? "deny" : "allow"}">${denied ? "deny" : "allow"}</span>${e.matchedRule ? `<code>${esc(e.matchedRule)}</code>` : ""}<span class="perm-layer">${esc(e.mode || "")}</span></div>`;
		}
		setSafeHtml(permPageEls.audit, h);
	} catch {
		/* best-effort */
	}
}

// mode setting (FR-17/32b): persisted modes PUT the user config; yolo is a
// session-scoped command (never persisted) with a confirm step on the page.
// yolo engagement arrives via the extension's safeguard setStatus broadcast
// and flips the composer chip without a round-trip.
function applyModeSetting(mode) {
	if (mode === "yolo") {
		api({ type: "prompt", message: "/safeguard mode yolo" });
		permPageEls.modeState.textContent =
			"yolo engage requested — confirm in the prompt…";
		toast("yolo engage command sent", "warn");
		return;
	}
	const cur = (permData && permData.layers && permData.layers.user) || {};
	const cfg = { ...cur, mode };
	saveUserRule(cfg, "mode → " + mode).then((ok) => {
		if (ok) setModeChip(mode);
	});
}
permPageEls.mode.onchange = () => applyModeSetting(permPageEls.mode.value);
permPageEls.modePage.onchange = () => {
	const next = permPageEls.modePage.value;
	const st = pu.modeState(permData ? permData.mode : "default", next, false);
	if (st.confirm) {
		permPageEls.confirm.hidden = false; // yolo needs the confirm step (FR-32b)
		permPageEls.modePage.value = st.value; // revert until confirmed
		return;
	}
	applyModeSetting(st.value);
};

// ---- quick rule editor (add): tool + pattern + effect → user config ----
const permRuleTool = $("perm-rule-tool");
const permRulePat = $("perm-rule-pat");
const permRuleEff = $("perm-rule-eff");
$("perm-rule-add").onclick = () => {
	const cur = (permData && permData.layers && permData.layers.user) || {};
	const res = pu.applyRule(
		cur,
		permRuleTool.value,
		permRulePat.value,
		permRuleEff.value,
	);
	if (!res.ok) {
		toast(res.error, "err");
		return;
	}
	saveUserRule(res.config);
};
$("perm-confirm-yes").onclick = () => {
	permPageEls.confirm.hidden = true;
	applyModeSetting("yolo");
};
$("perm-confirm-no").onclick = () => {
	permPageEls.confirm.hidden = true;
};

// explain (FR-35): same engine as the gate — verdict + per-part breakdown
$("perm-explain-go").onclick = async () => {
	const tool = permPageEls.explainTool.value.trim() || "bash";
	const selector = permPageEls.explainSel.value;
	permPageEls.explainOut.textContent = "…";
	try {
		const r = await fetch("/api/permissions/explain", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tool, selector }),
		});
		const j = await r.json();
		if (!j || !j.ok) {
			permPageEls.explainOut.textContent = "explain failed: " + (j && j.error);
			return;
		}
		const v = pu.explainView(j.verdict, j.bash, j.gateVerdict);
		let h = `<div class="perm-ev"><span class="perm-action ${esc(v.action)}">${esc(v.action)}</span><span class="perm-tier">${esc(v.tier)}</span><code>${esc(v.matchedRule)}</code><span class="perm-layer">${esc(v.layer || "")}</span>${v.autoAllowable ? "<span class='perm-auto'>auto-allow</span>" : ""}</div><div class="perm-reason">${esc(v.reason)}</div>`;
		if (v.parts) {
			h +=
				`<div class="perm-parts">` +
				v.parts
					.map(
						(p) =>
							`<div class="perm-part"><code>${esc(p.command)}</code><span class="perm-action ${p.readonly ? "allow" : "ask"}">${p.readonly ? "readonly" : "mutate"}</span></div>`,
					)
					.join("") +
				`</div>`;
		}
		setSafeHtml(permPageEls.explainOut, h);
	} catch (e) {
		permPageEls.explainOut.textContent = "explain failed: " + e.message;
	}
};

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

// Conversation density is progressive disclosure, not a loss of information:
// focus hides successful tool work, balanced summarizes it, trace exposes it.
// Keep the persisted values for existing sessions; only their names/default move.
const viewBtn = $("view-btn");
const VIEW_MODES = ["semi", "detailed", "simple"];
const VIEW_MODE_LABELS = {
	simple: "focus",
	semi: "balanced",
	detailed: "trace",
};
let viewMode = localStorage.getItem("pi:view-mode");
if (!VIEW_MODES.includes(viewMode)) viewMode = "semi";
function applyViewMode(m) {
	if (!VIEW_MODES.includes(m)) m = "semi";
	viewMode = m;
	localStorage.setItem("pi:view-mode", m);
	transcript.setAttribute("data-view", m);
	const label = VIEW_MODE_LABELS[m];
	if (viewBtn) {
		viewBtn.textContent = label;
		viewBtn.title = `conversation density: ${label} (click to cycle)`;
		viewBtn.setAttribute("aria-label", `conversation density: ${label}`);
	}
	for (const fold of transcript.querySelectorAll(".tool-group-fold")) {
		const group = fold.parentElement;
		if (m === "detailed") fold.open = true;
		else if (m === "semi" && group && !group.classList.contains("err"))
			fold.open = false;
	}
}
if (viewBtn)
	viewBtn.onclick = () => {
		const i = VIEW_MODES.indexOf(viewMode);
		applyViewMode(VIEW_MODES[(i + 1) % VIEW_MODES.length]);
	};
applyViewMode(viewMode);

// ---- composer ----
function autosize() {
	inputEl.style.height = "auto";
	inputEl.style.height = Math.min(200, inputEl.scrollHeight) + "px";
}
inputEl.oninput = () => {
	autosize();
	updatePalette();
};

// ---- image input (plan 4.10) ----
// pendingImages: prepared {type:"image",data,mimeType} awaiting send (max 4).
// imgStripEl shows them as thumbnails with remove buttons. Images are prepped
// client-side by composer-images.js (canvas downscale + JPEG quality loop), so
// they bound both the HTTP body and model context before they ever leave the tab.
let pendingImages = [];
const imgStripEl = $("imgstrip");
function currentModelAcceptsImages() {
	const id = currentModelId || savedModelId;
	if (!id || !availableModels) return false;
	const m = availableModels.find((x) => x.provider + "/" + x.id === id);
	return !!(m && Array.isArray(m.input) && m.input.indexOf("image") >= 0);
}
function syncImageAttachmentUi() {
	const button = $("attach-images");
	if (!button) return;
	const supported = currentModelAcceptsImages();
	const label = supported
		? "Attach images"
		: "Selected model does not accept images";
	button.disabled = !supported;
	button.title = label;
	button.setAttribute("aria-label", label);
}
function renderImgStrip() {
	if (!imgStripEl) return;
	setSafeHtml(imgStripEl, "");
	pendingImages.forEach((img, idx) => {
		const wrap = document.createElement("div");
		wrap.className = "imgthumb";
		const im = document.createElement("img");
		im.src = "data:" + (img.mimeType || "image/jpeg") + ";base64," + img.data;
		im.alt = "attached image " + (idx + 1);
		wrap.appendChild(im);
		const rm = document.createElement("button");
		rm.type = "button";
		rm.className = "imgthumb-x";
		rm.setAttribute("aria-label", "remove image " + (idx + 1));
		rm.textContent = "×";
		rm.onclick = () => {
			pendingImages.splice(idx, 1);
			renderImgStrip();
		};
		wrap.appendChild(rm);
		imgStripEl.appendChild(wrap);
	});
	imgStripEl.style.display = pendingImages.length ? "flex" : "none";
}
// Prepare + queue image files (paste / drop / picker). Skips non-images, caps at
// 4, toasts on failure (decode error, over-limit, model doesn't accept images).
async function attachImages(files) {
	if (!files || !files.length) return;
	const CI = window.composerImages;
	if (!CI || !CI.prepareImage) return;
	if (!currentModelAcceptsImages()) {
		toast("the selected model does not accept images", "warn");
		return;
	}
	const room = CI.MAX_IMAGES - pendingImages.length;
	if (room <= 0) {
		toast("max " + CI.MAX_IMAGES + " images per message", "warn");
		return;
	}
	const list = Array.from(files).filter(
		(f) => f.type && f.type.indexOf("image/") === 0,
	);
	let added = 0;
	for (
		let i = 0;
		i < list.length && pendingImages.length < CI.MAX_IMAGES;
		i++
	) {
		const prepared = await CI.prepareImage(list[i]);
		if (prepared) {
			pendingImages.push(prepared);
			added++;
		} else {
			toast("could not prepare an image (too large?)", "warn");
		}
	}
	if (added) renderImgStrip();
}
const imagePicker = $("image-picker");
const attachImagesButton = $("attach-images");
if (imagePicker && attachImagesButton) {
	attachImagesButton.onclick = () => imagePicker.click();
	imagePicker.onchange = () => {
		const files = Array.from(imagePicker.files || []);
		imagePicker.value = "";
		void attachImages(files);
	};
}
// paste: grab image files from the clipboard
inputEl.addEventListener("paste", (e) => {
	const items = e.clipboardData && e.clipboardData.items;
	if (!items) return;
	const files = [];
	for (let i = 0; i < items.length; i++) {
		const f = items[i].getAsFile && items[i].getAsFile();
		if (f) files.push(f);
	}
	if (files.length) {
		e.preventDefault(); // don't paste the image as text/filename
		attachImages(files);
	}
});
// drag-drop onto the composer
const composerEl = document.querySelector(".composer");
if (composerEl) {
	const draggingFiles = (e) =>
		e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
	composerEl.addEventListener("dragenter", (e) => {
		if (draggingFiles(e)) composerEl.classList.add("dragging");
	});
	composerEl.addEventListener("dragover", (e) => {
		e.preventDefault();
		if (draggingFiles(e)) composerEl.classList.add("dragging");
	});
	composerEl.addEventListener("dragleave", (e) => {
		if (!e.relatedTarget || !composerEl.contains(e.relatedTarget))
			composerEl.classList.remove("dragging");
	});
	composerEl.addEventListener("drop", (e) => {
		composerEl.classList.remove("dragging");
		const dt = e.dataTransfer;
		if (dt && dt.files && dt.files.length) {
			e.preventDefault();
			attachImages(dt.files);
		}
	});
}

async function send() {
	const text = inputEl.value.trim();
	if (!text && !pendingImages.length) return; // allow image-only sends
	inputEl.value = "";
	autosize();
	hidePalette();
	const sendImages = pendingImages.length ? pendingImages.slice() : null;
	addUser(text, sendImages);
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
	if (sendImages && !text.startsWith("/")) cmd.images = sendImages;
	pendingImages = [];
	renderImgStrip();
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
// Humanize a byte count for the session-list size indicator.
function fmtBytes(n) {
	if (typeof n !== "number" || !isFinite(n) || n < 0) return "—";
	if (n < 1024) return n + " B";
	const u = ["KB", "MB", "GB"];
	let v = n / 1024,
		i = 0;
	while (v >= 1024 && i < u.length - 1) {
		v /= 1024;
		i++;
	}
	return (v < 10 ? v.toFixed(1) : Math.round(v)) + " " + u[i];
}
// A session's size indicator: exact message count when the whole file was read,
// otherwise a humanized byte size (the head/tail reader hides the count for large
// files to avoid a misleading undercount — plan 4.1).
function sessionSizeLabel(s) {
	if (s && s.messages != null) return s.messages + " msg";
	if (s && typeof s.size === "number") return fmtBytes(s.size);
	return "—";
}
// Rename the CURRENT session (plan 4.9) via the running pi's set_session_name.
// pi writes {type:"session_info",name} to the JSONL, which the recent-sessions
// reader (plan 4.1) picks up — so the name persists and shows in every list.
// Renaming an arbitrary non-active session would need a disposable pi (pi-livecraft's
// approach); the single-pi webui model renames the session you're in (resume first
// for others). 1–120 chars, no line breaks.
async function renameCurrentSession() {
	if (!curSessionFile) {
		toast("no active session to rename", "warn");
		return;
	}
	let curName = "";
	try {
		const d = await (await fetch("/api/sessions")).json();
		const cur = (d.sessions || []).find((s) => pathEq(s.path, curSessionFile));
		if (cur) curName = cur.name || cur.preview || "";
	} catch {}
	const input = window.prompt("Rename this session", curName);
	if (input == null) return; // cancelled
	const name = input.trim();
	if (!name) {
		toast("name cannot be empty", "warn");
		return;
	}
	if (name.length > 120) {
		toast("name too long (max 120 chars)", "warn");
		return;
	}
	const r = await rpcAwait({ type: "set_session_name", name });
	if (r && r.ok) {
		toast("session renamed", "ok");
		refreshSessionsSidebar();
		// if the sessions modal is open, re-render with the new name
		if (modal.style.display === "flex" && card.querySelector(".sessions"))
			showSessions();
	} else {
		toast("rename failed: " + ((r && r.error) || "unknown"), "err");
	}
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
			)}</span><span class="scount">${esc(sessionSizeLabel(s))}</span></span>` +
				`<span class="sprev">${esc(s.name || s.preview)}</span>`,
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
	setSafeHtml(feedEl, "");
	toolBlocks.clear();
	api({ type: "switch_session", sessionPath, id: "resume" });
}

sendBtn.onclick = send;
stopBtn.onclick = () => api({ type: "abort" });
compactBtn.onclick = () => api({ type: "compact" });
// Improve prompt (plan 4.8): rewrite the current draft via a disposable isolated pi
// (cheapest model, --no-tools). Takes a few seconds; the result replaces the draft.
const improveSel = $("improve");
if (improveSel)
	improveSel.onchange = async () => {
		const direction = improveSel.value;
		improveSel.value = ""; // reset to placeholder immediately
		if (!direction) return;
		const draft = inputEl.value.trim();
		if (!draft) {
			toast("write a draft to improve first", "warn");
			return;
		}
		toast("improving draft…");
		try {
			const r = await (
				await fetch("/api/improve-prompt", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text: draft, direction: direction }),
				})
			).json();
			if (r.ok && r.text) {
				inputEl.value = r.text;
				autosize();
				inputEl.focus();
				toast("draft improved", "ok");
			} else {
				toast("improve failed: " + (r.error || "unknown"), "err");
			}
		} catch (e) {
			toast("improve failed: " + e.message, "err");
		}
	};
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
// composer overflow ⋯ (spec FR-4): selecting an action closes the popover;
// Escape closes it too — stopPropagation so the wsbar drawer listener can't
// also fire. Open state is transient, never persisted.
if (barOvf) {
	barOvf.addEventListener("click", (e) => {
		if (sbNarrow && e.target.closest("select, button")) barOvf.open = false;
	});
	barOvf.addEventListener("keydown", (e) => {
		if (e.key === "Escape") {
			barOvf.open = false;
			e.stopPropagation();
		}
	});
}

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
			`<span class="ws-name">${esc(s.name || s.preview)}</span>` +
				`<span class="ws-meta">${esc(fmtSessionDate(s.when))} · ${esc(
					sessionSizeLabel(s),
				)}</span>`,
		);
		if (current)
			row.disabled = true; // already active
		else row.onclick = () => resumeSession(s.path, false);
		host.appendChild(row);
	}
}
// ponytail: drawer mode = w-mid/w-narrow (spec FR-2). Push-vs-drawer is pure
// CSS off body.w-* — a widthchange conversion (FR-2.3) needs no JS here.
function drawerMode() {
	return !document.body.classList.contains("w-wide");
}
function collapseWsbar() {
	document.body.classList.remove("ws-on");
	localStorage.setItem(WS_KEY, "off");
	const open = $("ws-open");
	if (open) {
		open.hidden = false;
		open.setAttribute("aria-expanded", "false");
		open.focus(); // return focus to the launcher (spec FR-2.4)
	}
}
function expandWsbar() {
	document.body.classList.add("ws-on");
	localStorage.setItem(WS_KEY, "on");
	const open = $("ws-open");
	if (open) {
		open.hidden = true;
		open.setAttribute("aria-expanded", "true");
	}
	const bar = $("wsbar");
	if (bar) bar.focus(); // drawer gets initial focus (spec FR-2.4)
	refreshWorkspaces();
	refreshSessionsSidebar();
}
(function initWsbar() {
	// default on (first run); honor an explicit "off".
	const open = $("ws-open");
	if (localStorage.getItem(WS_KEY) === "off") {
		if (open) open.hidden = false;
	} else {
		document.body.classList.add("ws-on");
	}
	if (open) {
		open.setAttribute(
			"aria-expanded",
			document.body.classList.contains("ws-on") ? "true" : "false",
		);
	}
	const collapse = $("ws-collapse");
	if (collapse) collapse.onclick = collapseWsbar;
	if (open) open.onclick = expandWsbar;
	const scrim = $("ws-scrim");
	if (scrim) scrim.onclick = collapseWsbar;
	// Escape closes the drawer — but never while the modal is open (the
	// capture-phase onModalKey owns Escape then) or the settings drawer.
	document.addEventListener("keydown", (e) => {
		if (e.key !== "Escape") return;
		if (modal.style.display === "flex") return;
		if (settingsEl.classList.contains("open")) return;
		if (!document.body.classList.contains("ws-on")) return;
		if (!drawerMode()) return;
		e.preventDefault();
		collapseWsbar();
	});
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
	// Interaction is DELEGATED on the container, not per item: the old
	// per-item onclick/onmouseenter rebuilt the whole list on every hover, so a
	// node swap between mousedown and mouseup (hover drift, or a slow webview
	// mid-rebuild) retargeted the click to the container and swallowed it —
	// mouse clicks appeared dead while keyboard still worked.
	cmdkList.addEventListener("click", (e) => {
		const it = e.target.closest(".cmdk-item");
		if (it && cmdkItems[+it.dataset.i]) runCmdK(cmdkItems[+it.dataset.i]);
	});
	cmdkList.addEventListener("mouseover", (e) => {
		const it = e.target.closest(".cmdk-item");
		if (it) setCmdKSel(+it.dataset.i);
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
		d.dataset.i = String(i); // resolved by the delegated click/mouseover handlers
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
		cmdkList.appendChild(d);
	});
	cmdkInput.setAttribute("aria-activedescendant", "cmdk-opt-" + cmdkSel);
}
// Hover selection toggles the .sel class in place instead of rebuilding the
// list (the old rebuild-per-hover flickered and raced clicks). cmdkSel stays
// authoritative for the keyboard path, which still rebuilds via renderCmdK.
function setCmdKSel(i) {
	if (i === cmdkSel) return;
	const old = cmdkList.querySelector(".cmdk-item.sel");
	cmdkSel = i;
	if (old) {
		old.classList.remove("sel");
		old.setAttribute("aria-selected", "false");
	}
	const fresh = cmdkList.children[i];
	if (fresh) {
		fresh.classList.add("sel");
		fresh.setAttribute("aria-selected", "true");
		cmdkInput.setAttribute("aria-activedescendant", fresh.id);
	}
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
	if (
		(e.altKey || e.ctrlKey) &&
		!e.shiftKey &&
		(e.key === "k" || e.key === "K")
	) {
		e.preventDefault();
		openCmdK();
	}
});

// ---- session-analysis modal (plan 4.3) ----
// An on-demand cost/tools dashboard: HTML/CSS bars + ranked lists, click→scroll.
// §6.2 recommends a Usage panel over graphs first; this is that panel as a free
// modal. Runs analyzeSession (plan 4.2) on the last snapshot's messages+stats.
function scrollToMessage(mi) {
	const el = transcript.querySelector('[data-mi="' + mi + '"]');
	if (!el) return;
	el.scrollIntoView({ block: "center", behavior: "smooth" });
	el.classList.add("mi-flash");
	setTimeout(() => el.classList.remove("mi-flash"), 1400);
}
function anPct(part, whole) {
	return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
// W1 chunk 5: body builder shared by the modal AND the rail panel widget
function analysisBody() {
	const SA = window.sessionAnalysis;
	if (!SA || !SA.analyzeSession) return "";
	const a = SA.analyzeSession(lastMessages, lastStats, lastRunning);
	const turns = a.turns;
	// bar metric: cost if any attributed, else output tokens (still useful signal)
	const useCost = a.attributedCost > 0;
	const metric = useCost ? (t) => t.cost : (t) => t.usage.output;
	const shown = turns.slice(-Math.min(100, turns.length));
	const contextWindow =
		lastStats &&
		lastStats.contextUsage &&
		Number.isFinite(lastStats.contextUsage.contextWindow) &&
		lastStats.contextUsage.contextWindow > 0
			? lastStats.contextUsage.contextWindow
			: null;
	const contextForTurn = (t) => {
		if (!contextWindow) return null;
		const u = t.usage || {};
		const tokens = [u.cacheMiss, u.cacheRead, u.cacheWrite, u.output].reduce(
			(sum, value) => sum + (Number.isFinite(value) ? value : 0),
			0,
		);
		return Math.max(0, Math.min(100, (tokens / contextWindow) * 100));
	};
	const maxV = shown.reduce((m, t) => Math.max(m, metric(t)), 0);
	const bars = shown
		.map((t) => {
			const v = metric(t);
			const h = maxV > 0 ? Math.max(3, Math.round((v / maxV) * 100)) : 3;
			const context = contextForTurn(t);
			const lbl =
				"turn " +
				t.number +
				(useCost
					? " · " + SA.formatTurnCost(v)
					: " · " + SA.formatTokens(v) + " out tok") +
				(context != null ? " · " + Math.round(context) + "% context" : "");
			return (
				'<button type="button" class="an-bar' +
				(useCost && v === maxV && maxV > 0 ? " peak" : "") +
				'" data-mi="' +
				t.messageIndex +
				'" title="' +
				esc(lbl) +
				'" style="height:' +
				h +
				'%"></button>'
			);
		})
		.join("");
	const cacheHit = anPct(
		a.tokens.cacheRead,
		a.tokens.cacheMiss + a.tokens.cacheRead,
	);
	const contextPoints = contextWindow
		? shown.map((t, i) => {
				const pct = contextForTurn(t);
				return {
					x: shown.length > 1 ? (i / (shown.length - 1)) * 100 : 50,
					y: 100 - pct,
					pct,
					turn: t.number,
				};
			})
		: [];
	const contextLine = contextPoints.length
		? '<svg class="an-context-line" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="context usage by turn"><title>Context usage by turn</title><polyline points="' +
			contextPoints
				.map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2))
				.join(" ") +
			'" />' +
			contextPoints
				.map(
					(p) =>
						'<circle cx="' +
						p.x.toFixed(2) +
						'" cy="' +
						p.y.toFixed(2) +
						'" r="1.1"><title>turn ' +
						p.turn +
						" · " +
						Math.round(p.pct) +
						"% context</title></circle>",
				)
				.join("") +
			"</svg>"
		: "";
	const costliest = turns
		.slice()
		.sort((x, y) => y.cost - x.cost)
		.slice(0, 5)
		.filter((t) => t.cost > 0);
	const failed = a.toolCalls.filter((c) => c.isError);
	const topTools = a.tools.slice(0, 6);
	let usageById = new Map();
	if (usageTelemetry && usageHistory && usageTelemetry.metricViews) {
		try {
			usageById = new Map(
				usageTelemetry.metricViews(usageHistory).map((view) => [view.id, view]),
			);
		} catch {
			usageById = new Map();
		}
	}
	const usageView = (id, label) =>
		usageById.get(id) || {
			id,
			label,
			valueText: "—",
			available: false,
			reason: "not-initialized",
			series: [],
		};
	const stat = (id, val, lbl, cls) => {
		const view = usageView(id, lbl);
		const card =
			usageTelemetry && usageTelemetry.metricCardParts
				? usageTelemetry.metricCardParts({
						...view,
						label: lbl,
						valueText: val,
						available: val !== "—" && val !== "not reported",
						reason: view.reason || "not-initialized",
					})
				: {
						id,
						label: lbl,
						valueText: val,
						stateText: "",
						trendHtml: "",
					};
		return (
			'<div class="an-stat' +
			(cls ? " " + cls : "") +
			'" data-metric="' +
			esc(id) +
			'"><span class="an-spark-bg" aria-hidden="true">' +
			(card.trendHtml || "") +
			'</span><span class="an-stat-main"><span class="an-val">' +
			esc(card.valueText) +
			'</span><span class="an-lbl">' +
			esc(card.label) +
			"</span>" +
			(card.stateText
				? '<span class="an-state">' + esc(card.stateText) + "</span>"
				: "") +
			"</span></div>"
		);
	};
	const tok = (lbl, v) =>
		'<div class="an-tok"><span class="an-tok-v">' +
		esc(SA.formatTokens(v)) +
		'</span><span class="an-tok-l">' +
		esc(lbl) +
		"</span></div>";
	// ranked list item that jumps to a message
	const jump = (mi, main, sub) =>
		'<button type="button" class="an-item" data-mi="' +
		mi +
		'"><span class="an-item-main">' +
		esc(main) +
		'</span><span class="an-item-sub">' +
		esc(sub || "") +
		"</span></button>";
	const parts = [];
	parts.push('<div class="analysis">');
	// stat row
	parts.push('<div class="an-head">');
	parts.push(
		stat(
			"total",
			a.costAvailable ? SA.formatTurnCost(a.totalCost) : "not reported",
			"total",
			"primary",
		),
	);
	parts.push(stat("turns", String(a.turnCount), "turns"));
	parts.push(
		stat(
			"avg-turn",
			a.attributedCost > 0 && a.turnCount
				? SA.formatTurnCost(a.averageTurnCost)
				: "not reported",
			"avg/turn",
		),
	);
	parts.push(
		stat(
			"median-turn",
			a.attributedCost > 0 && a.turnCount
				? SA.formatTurnCost(a.medianTurnCost)
				: "not reported",
			"median",
		),
	);
	parts.push(
		stat(
			"context",
			a.contextPercent != null ? Math.round(a.contextPercent) + "%" : "—",
			"context",
		),
	);
	parts.push(
		stat("cache-hit", a.tokensAvailable ? cacheHit + "%" : "—", "cache hit"),
	);
	parts.push("</div>");
	parts.push('<div class="an-section an-recent">');
	parts.push('<div class="an-sec-h">RECENT TELEMETRY</div>');
	parts.push(
		'<div class="an-metrics">' +
			[
				"output-tps",
				"avg-output-call",
				"cost-minute",
				"tool-error",
				"tool-calls-minute",
				"pending-tools",
				"headroom",
				"turn-duration",
				"first-token",
				"tool-latency",
			]
				.map((id) => {
					const view = usageView(id, id);
					return stat(id, view.valueText, view.label);
				})
				.join("") +
			"</div></div>",
	);
	// per-turn bars
	if (turns.length) {
		parts.push('<div class="an-section">');
		parts.push('<div class="an-sec-h">TURN HISTORY</div>');
		parts.push(
			'<div class="an-sec-sub">last ' +
				shown.length +
				(turns.length > shown.length ? " of " + turns.length : "") +
				" billed model turns" +
				(contextLine ? " · line = context" : "") +
				" · click to jump</div>",
		);
		parts.push('<div class="an-bars">' + bars + contextLine + "</div>");
		if (!useCost) {
			parts.push(
				'<p class="um-hint">Provider cost is not available; showing output tokens per turn.</p>',
			);
		}
		parts.push("</div>");
	} else {
		parts.push(
			'<div class="an-section"><div class="an-sec-h">TURN HISTORY</div>' +
				'<p class="um-hint">No completed model turns yet; cost appears after pi reports usage.</p></div>',
		);
	}
	// token breakdown
	if (a.tokensAvailable) {
		parts.push('<div class="an-section">');
		parts.push('<div class="an-sec-h">tokens</div>');
		parts.push('<div class="an-toks">');
		parts.push(tok("cache-miss", a.tokens.cacheMiss));
		parts.push(tok("cache-read", a.tokens.cacheRead));
		parts.push(tok("cache-write", a.tokens.cacheWrite));
		parts.push(tok("output", a.tokens.output));
		parts.push("</div></div>");
	}
	// ranked lists
	parts.push('<div class="an-cols">');
	if (topTools.length) {
		parts.push('<div class="an-section"><div class="an-sec-h">tools</div>');
		parts.push(
			topTools
				.map((t) =>
					jump(
						-1,
						t.name + " ×" + t.count,
						t.failed
							? t.failed + " failed"
							: SA.formatTokens(t.outputLength) + " out",
					),
				)
				.join(""),
		);
		parts.push("</div>");
	}
	if (costliest.length) {
		parts.push(
			'<div class="an-section"><div class="an-sec-h">costliest turns</div>',
		);
		parts.push(
			costliest
				.map((t) =>
					jump(t.messageIndex, "turn " + t.number, SA.formatTurnCost(t.cost)),
				)
				.join(""),
		);
		parts.push("</div>");
	}
	if (failed.length) {
		parts.push(
			'<div class="an-section"><div class="an-sec-h">failed calls (' +
				failed.length +
				")</div>",
		);
		parts.push(
			failed
				.slice(0, 12)
				.map((c) =>
					jump(
						c.turnMessageIndex != null ? c.turnMessageIndex : -1,
						c.name,
						c.turnMessageIndex != null ? "turn near call" : "",
					),
				)
				.join(""),
		);
		parts.push("</div>");
	}
	parts.push("</div></div>");
	return parts.join("");
}
// wire click→scroll on every [data-mi] inside a container (skip -1
// placeholders); the rail stays open while a jump targets the transcript
function wireAnalysis(container, onJump) {
	container.querySelectorAll('[data-mi]:not([data-mi="-1"])').forEach((el) => {
		el.addEventListener("click", () => {
			const mi = el.getAttribute("data-mi");
			if (onJump) onJump();
			setTimeout(() => scrollToMessage(mi), 60);
		});
	});
}
function analysisRender(el) {
	if (!el) return;
	setSafeHtml(
		el,
		analysisBody() || '<p class="w-placeholder">no session data yet</p>',
	);
	wireAnalysis(el, null); // rail: keep the panel open, just scroll
}

// ---- git rail ---------------------------------------------------------------
// The detail, diff, and mutation renderers all target the mounted rail panel.
let gitEl = null;
function gEl() {
	return gitEl;
}
let gitLastSnap = null; // last list snapshot (back-button re-render)
function gitBack() {
	if (gitLastSnap) renderGitList(gitLastSnap);
}
function renderGitList(s) {
	gitLastSnap = s;
	if (!s.repository) {
		setSafeHtml(
			gEl(),
			'<div class="git"><h3>Git</h3><p class="um-hint">not a git repository</p></div>',
		);
		return;
	}
	const parts = [];
	parts.push('<div class="git">');
	parts.push('<div class="git-head">');
	parts.push('<span class="git-branch">⎇ ' + esc(s.branch) + "</span>");
	if (s.ahead > 0)
		parts.push('<span class="git-ahead">▲ ' + s.ahead + " unpushed</span>");
	parts.push('<span class="git-count">' + s.files.length + " changed</span>");
	parts.push("</div>");
	parts.push(gitActionButtons(s));
	if (s.files.length) {
		parts.push('<div class="git-sec-h">changes</div>');
		parts.push('<div class="git-files">');
		s.files.forEach((f) => parts.push(gitFileBtn(f)));
		parts.push("</div>");
	} else {
		parts.push('<p class="um-hint">clean working tree</p>');
	}
	if (s.commits.length) {
		parts.push(
			'<div class="git-sec-h">unpushed commits (' +
				s.commits.length +
				")</div>",
		);
		parts.push('<div class="git-files">');
		s.commits.forEach((c) => {
			parts.push(
				'<div class="git-commit"><span class="git-csubj">' +
					esc(c.subject) +
					'</span> <span class="git-cfiles">' +
					c.files.length +
					" files</span></div>",
			);
			c.files.forEach((f) => parts.push(gitFileBtn(f, c.hash)));
		});
		parts.push("</div>");
	}
	parts.push("</div>");
	setSafeHtml(gEl(), parts.join(""));
	const commitBtn = gEl().querySelector(".git-act.primary");
	if (commitBtn) commitBtn.addEventListener("click", gitCommitModal);
	const pushBtn = gEl().querySelector(".git-push");
	if (pushBtn)
		pushBtn.addEventListener("click", () =>
			gitConfirm(
				"push",
				"Push " + s.ahead + " commit(s) to the remote?",
				"/api/git/push",
			),
		);
	const discBtn = gEl().querySelector(".git-discard-all");
	if (discBtn)
		discBtn.addEventListener("click", () =>
			gitConfirm(
				"discard all",
				"Discard ALL uncommitted changes (including untracked files)? This cannot be undone.",
				"/api/git/discard",
			),
		);
	gEl()
		.querySelectorAll(".git-file[data-path]")
		.forEach((btn) => {
			btn.addEventListener("click", () =>
				showGitDiff(
					btn.getAttribute("data-path"),
					btn.getAttribute("data-commit") || null,
				),
			);
		});
}

function gitFileBtn(f, commit) {
	const initial = f.status.charAt(0).toUpperCase();
	const delta =
		f.additions != null || f.deletions != null
			? '<span class="git-delta">+' +
				(f.additions || 0) +
				" -" +
				(f.deletions || 0) +
				"</span>"
			: "";
	return (
		'<button type="button" class="git-file" data-path="' +
		esc(f.path) +
		'"' +
		(commit ? ' data-commit="' + esc(commit) + '"' : "") +
		'><span class="git-stat ' +
		esc(f.status) +
		'">' +
		esc(initial) +
		'</span><span class="git-fname">' +
		esc(f.path) +
		"</span>" +
		delta +
		"</button>"
	);
}

async function showGitDiff(p, commit) {
	const back = '<button type="button" class="git-back">← back</button>';
	setSafeHtml(
		gEl(),
		'<div class="git">' +
			back +
			'<div class="git-sec-h git-diffpath">' +
			esc(p) +
			'</div><p class="um-hint">loading diff…</p></div>',
	);
	const backBtn = gEl().querySelector(".git-back");
	if (backBtn) backBtn.addEventListener("click", gitBack);
	let data;
	try {
		const q =
			"path=" +
			encodeURIComponent(p) +
			(commit ? "&commit=" + encodeURIComponent(commit) : "");
		data = await (await fetch("/api/git/diff?" + q)).json();
	} catch (e) {
		data = { ok: false, error: e.message };
	}
	if (!data.ok) {
		setSafeHtml(
			gEl(),
			'<div class="git">' +
				back +
				'<div class="git-sec-h git-diffpath">' +
				esc(p) +
				'</div><p class="um-hint">' +
				esc(data.error || "failed") +
				"</p></div>",
		);
		const b2 = gEl().querySelector(".git-back");
		if (b2) b2.addEventListener("click", gitBack);
		return;
	}
	// render the unified diff with +/− line coloring (content escaped per line)
	const lines = String(data.diff || "").split("\n");
	const body = lines
		.map((l) => {
			let cls = "";
			if (l.charAt(0) === "+" && l.indexOf("+++") !== 0) cls = "diff-add";
			else if (l.charAt(0) === "-" && l.indexOf("---") !== 0) cls = "diff-del";
			else if (l.charAt(0) === "@") cls = "diff-hunk";
			return '<span class="' + cls + '">' + esc(l || " ") + "</span>";
		})
		.join("\n");
	setSafeHtml(
		gEl(),
		'<div class="git">' +
			back +
			'<div class="git-sec-h git-diffpath">' +
			esc(p) +
			'</div><pre class="git-diff">' +
			body +
			"</pre></div>",
	);
	const b3 = gEl().querySelector(".git-back");
	if (b3) b3.addEventListener("click", gitBack);
}

// W1 chunk 6: rail widget body — lazy fetch on open, gen-stamped (FR-8):
// a response landing after the user switched widgets is dropped.
async function gitRenderRail(el, g) {
	gitEl = el;
	setSafeHtml(gEl(), '<div class="git"><p class="um-hint">loading…</p></div>');
	let data;
	try {
		data = await (await fetch("/api/git")).json();
	} catch (e) {
		data = { ok: false, error: e.message };
	}
	if (railGen.stale(g)) return; // user moved on — drop
	if (!data.ok) {
		setSafeHtml(
			gEl(),
			'<div class="git"><p class="um-hint">' +
				esc(data.error || "failed to load") +
				"</p></div>",
		);
		return;
	}
	gitBadgeSnap = { changed: (data.snapshot.files || []).length }; // API field is files
	renderGitList(data.snapshot);
	renderRail(false); // refresh the badge only
}

// ---- git mutations (plan 4.6): all gated behind a confirm ----
// After each mutation, re-fetch the snapshot so the modal reflects the new state.
async function gitRefresh() {
	try {
		const data = await (await fetch("/api/git")).json();
		if (data.ok) {
			gitBadgeSnap = { changed: (data.snapshot.files || []).length }; // API field is files
			renderGitList(data.snapshot);
		}
	} catch {}
}
async function gitPost(path, body) {
	try {
		const r = await fetch(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body || {}),
		});
		return await r.json();
	} catch (e) {
		return { ok: false, error: e.message };
	}
}
// Binary-confirm a destructive action (push/reset/revert/discard) via the native
// dialog, then POST + toast + refresh. commit uses its own message modal below.
async function gitConfirm(action, question, path, body) {
	if (!window.confirm(question)) return;
	const r = await gitPost(path, body);
	if (r.ok) {
		toast(action + " done", "ok");
		await gitRefresh();
	} else {
		toast(action + " failed: " + (r.error || "unknown"), "err");
	}
}
// Commit: a modal with a message textarea (message is required).
function gitCommitModal() {
	showModal(
		'<div class="git"><h3>Commit</h3>' +
			'<textarea class="git-msg" placeholder="commit message…" rows="3"></textarea>' +
			'<div class="git-actions"><button type="button" class="git-commit-go primary">Commit</button>' +
			'<button type="button" data-dismiss class="git-cancel">Cancel</button></div></div>',
		true,
	);
	card.classList.add("git-card");
	const ta = card.querySelector(".git-msg");
	const go = card.querySelector(".git-commit-go");
	if (ta) ta.focus();
	if (go)
		go.onclick = async () => {
			const message = ta.value.trim();
			if (!message) {
				toast("a commit message is required", "warn");
				return;
			}
			go.disabled = true;
			const r = await gitPost("/api/git/commit", { message: message });
			if (r.ok) {
				toast("committed", "ok");
				hideModal();
				await gitRefresh();
			} else {
				go.disabled = false;
				toast("commit failed: " + (r.error || "unknown"), "err");
			}
		};
}
function gitActionButtons(s) {
	const parts = ['<div class="git-actions">'];
	if (s.files.length)
		parts.push('<button type="button" class="git-act primary">Commit</button>');
	if (s.ahead > 0)
		parts.push(
			'<button type="button" class="git-act git-push">Push (' +
				s.ahead +
				")</button>",
		);
	if (s.files.length)
		parts.push(
			'<button type="button" class="git-act git-discard-all">Discard all</button>',
		);
	parts.push("</div>");
	return parts.join("");
}

// ---- register built-in UI commands ----
// FR-29: permissions page is reachable from the command palette (rail launcher
// arrives with W1). Registered here, after the uiCommands registry exists.
registerCommand(
	"permissions",
	"Permissions (policy & approvals)",
	"open the permissions page",
	() => {
		location.hash = "#permissions";
	},
);
registerCommand(
	"fleet",
	"subagent fleet",
	"background subagent runs — status, logs, stop, steer",
	() => {
		location.hash = "#fleet";
	},
);
registerCommand("new-session", "new session", "start a fresh session", () =>
	api({ type: "new_session" }),
);
registerCommand(
	"compact",
	"compact context",
	"summarize the conversation",
	() => api({ type: "compact" }),
);
registerCommand("stop", "stop generation", "abort the current turn", () =>
	api({ type: "abort" }),
);
registerCommand(
	"settings",
	"settings",
	"open the settings panel",
	openSettings,
);
registerCommand(
	"sdd",
	"sdd phases",
	"open the spec-driven development rail widget",
	() => openRailWidget("sdd"),
);
registerCommand("git", "git status", "review changes & unpushed commits", () =>
	openRailWidget("git"),
);
registerCommand(
	"rename-session",
	"rename session",
	"name the current session",
	renameCurrentSession,
);
registerCommand(
	"usage",
	"session usage",
	"cost/tool/cache breakdown for this session",
	() => openRailWidget("analysis"),
);
registerCommand("quotas", "quota usage", "provider quotas and limits", () =>
	openRailWidget("quotas"),
);
registerCommand("todos", "agent todos", "the agent's todo list", () =>
	openRailWidget("todos"),
);
registerCommand(
	"scroll-bottom",
	"scroll to bottom",
	"jump to the latest message",
	scrollDown,
);
registerCommand(
	"focus-input",
	"focus input",
	"put the cursor in the composer",
	() => inputEl.focus(),
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
registerCommand(
	"view-cycle",
	"cycle detail mode",
	"focus / balanced / trace",
	() => (viewBtn ? viewBtn.click() : null),
);

// ---- right-rail drag-resize (plan 3.5 / U§2.6) ----
// The #toolsbar (and future widget rail) is drag-resizable via a .rail-resize
// handle on its left edge; the width persists as the --rail-width CSS var (read
// by the body.rail-on.rail-open rules). Clamped 240–720px; when the transcript
// floor cap binds (narrow w-wide viewports, spec FR-3.3) the upper bound
// shrinks below 240 rather than violate it. Only active when the pane is open.
// Mouse + touch.
const CONTENT_FLOOR = 560; // spec FR-3 — the transcript never falls below this
function wsbarPushWidth() {
	// JS mirror of --wsbar-w (min(240px, 26vw)); 0 unless the sidebar actually
	// pushes (drawer modes don't reserve body margin).
	if (!document.body.classList.contains("ws-on")) return 0;
	if (!document.body.classList.contains("w-wide")) return 0;
	return Math.min(240, Math.round(document.documentElement.clientWidth * 0.26));
}
function railMaxWidth() {
	// Overlay modes (w-mid/w-narrow) don't push — only the 720 hard cap applies;
	// push mode (w-wide) keeps the transcript >= CONTENT_FLOOR.
	if (!document.body.classList.contains("w-wide")) return 720;
	return Math.max(
		88,
		document.documentElement.clientWidth - wsbarPushWidth() - CONTENT_FLOOR,
	);
}
function clampRailWidth() {
	const cur = parseFloat(
		document.documentElement.style.getPropertyValue("--rail-width"),
	);
	if (!(cur > 0)) return;
	const max = railMaxWidth();
	if (cur > max) {
		document.documentElement.style.setProperty("--rail-width", max + "px");
		persistRailWidth(max);
	}
}
function persistRailWidth(width) {
	const value = Number(width);
	if (!Number.isFinite(value)) return;
	railSt = { ...railSt, width: value };
	railState.save(railSt);
}
function initRailResize() {
	const bar = $("toolsbar");
	if (!bar || bar.querySelector(".rail-resize")) return;
	const handle = document.createElement("div");
	handle.className = "rail-resize";
	handle.setAttribute("role", "separator");
	handle.setAttribute("aria-orientation", "vertical");
	handle.setAttribute("aria-label", "resize sidebar");
	handle.setAttribute("aria-valuemin", "0");
	handle.setAttribute("aria-valuemax", "100");
	handle.setAttribute("aria-valuenow", "50");
	handle.tabIndex = 0; // focusable separator — keyboard-resizable (a11y FR-6)
	handle.title = "drag to resize";
	bar.appendChild(handle);
	const saved = railSt.width;
	if (typeof saved === "number")
		document.documentElement.style.setProperty("--rail-width", saved + "px");
	clampRailWidth(); // a stale wide save must not exceed the current floor cap
	let dragging = false,
		startX = 0,
		startW = 0;
	const down = (clientX) => {
		if (!document.body.classList.contains("rail-open")) return false;
		dragging = true;
		startX = clientX;
		startW = bar.offsetWidth;
		handle.classList.add("active");
		document.body.style.userSelect = "none";
		document.body.style.cursor = "col-resize";
		return true;
	};
	const move = (clientX) => {
		if (!dragging) return;
		const delta = startX - clientX; // left drag = wider (right-anchored)
		const w = Math.max(88, Math.min(720, railMaxWidth(), startW + delta));
		applyWidth(w);
	};
	// a11y FR-6: live WAI value metadata + one shared apply path for pointer
	// and keyboard (aria-valuenow is percent of the current 88..max range)
	const applyWidth = (w) => {
		document.documentElement.style.setProperty("--rail-width", w + "px");
		const mx = railMaxWidth();
		handle.setAttribute(
			"aria-valuenow",
			String(Math.round(((w - 88) / Math.max(1, mx - 88)) * 100)),
		);
	};
	// keyboard: ArrowLeft widens (mirrors pointer), ArrowRight narrows,
	// Home/End jump — step math in a11y-contrast.resizeStep (unit-tested)
	handle.addEventListener("keydown", (e) => {
		if (!document.body.classList.contains("rail-open")) return;
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
		e.preventDefault();
		const mx = railMaxWidth();
		const cur = Math.max(88, Math.min(mx, bar.offsetWidth));
		const a11y = window.a11yContrast;
		const step = a11y && a11y.resizeStep ? a11y.resizeStep : null;
		const pct = step
			? step(((cur - 88) / Math.max(1, mx - 88)) * 100, e.key, 0, 100)
			: ((cur - 88) / Math.max(1, mx - 88)) * 100;
		const w = 88 + (pct / 100) * (mx - 88);
		applyWidth(w);
		clampRailWidth();
		persistRailWidth(bar.offsetWidth);
	});
	const up = () => {
		if (!dragging) return;
		dragging = false;
		handle.classList.remove("active");
		document.body.style.userSelect = "";
		document.body.style.cursor = "";
		clampRailWidth(); // final safety pass
		persistRailWidth(bar.offsetWidth);
	};
	handle.addEventListener("mousedown", (e) => {
		if (down(e.clientX)) e.preventDefault();
	});
	document.addEventListener("mousemove", (e) => move(e.clientX));
	document.addEventListener("mouseup", up);
	handle.addEventListener(
		"touchstart",
		(e) => {
			if (down(e.touches[0].clientX)) e.preventDefault();
		},
		{ passive: false },
	);
	document.addEventListener(
		"touchmove",
		(e) => {
			if (dragging) {
				move(e.touches[0].clientX);
				e.preventDefault();
			}
		},
		{ passive: false },
	);
	document.addEventListener("touchend", up);
	// Re-clamp width and update dialog semantics when the viewport crosses modes.
	document.body.addEventListener("widthchange", () => {
		clampRailWidth();
		setRailSheetSemantics(!!railWidget && railSt.open);
	});
}
initRailResize();

autosize();
