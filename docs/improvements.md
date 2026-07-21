# Improvement Audit

> Cross-cutting improvement snapshot for pi-webui, grouped by visuals,
> performance, and features. Last reviewed **2026-07-21** against the live
> source. Revalidate an item before implementation; [`roadmap.md`](roadmap.md)
> remains the source of truth for detailed feature proposals.

The foundation is strong: two distinct themes, editable and approval diff
views, throttled streaming, keyboard focus rings, and permission-risk styling
are already implemented. The items below target the clearest remaining gaps.

## Visuals

### 1. Reduce status-bar density — High

Keep activity, model, and context visible. Move git, cache, token, and cost
details into an overflow surface on narrow windows so the footer remains
scannable instead of wrapping or competing for attention.

### 2. Improve interactive affordances — High

Session rows and command-palette entries are clickable `div` elements. Replace
them with semantic buttons or listbox options and give interactive rows
consistent hover, selected, pressed, and disabled states.

### 3. Clarify application states — High

Show distinct disconnected, restarting, loading, empty, and failed states.
Important state should remain visible in the relevant surface instead of being
communicated only through a short-lived toast.

### 4. Strengthen accessibility styling — Medium

Add `prefers-reduced-motion`, improve contrast for risk banners and subtle
active states, and give the settings drawer explicit focus handling plus a
visible `aria-expanded` state. The existing modal focus trap and global
`:focus-visible` treatment should remain.

### 5. Polish long-content navigation — Medium

Add lightweight copy actions for assistant messages and code blocks, and make
collapsible tool blocks visibly interactive without adding another toolbar or
UI framework.

## Performance

These are source-backed risks from a static audit, not runtime measurements.
Apply the smallest fixes first, then profile before attempting larger
architecture changes.

### 1. Render history without repeated layout — High

`addUser()` reads `scrollHeight` for every historical user message. Suppress
scrolling while replaying history and scroll once after the complete history
has been rendered.

### 2. Remove multi-tab amplification — High

RPC responses are broadcast to every tab while ordinary request IDs are shared.
Use per-tab request IDs so one tab's initialization or session refresh does not
cause every tab to process and render the same full response repeatedly.

### 3. Lazy-render closed reasoning — High

Historical thinking content is parsed, highlighted, and retained even while its
`details` element is closed. Keep the raw buffer and render it on first open;
only rerender when that buffer changes.

### 4. Bound large diff previews — High

Add independent byte and line limits before syntax highlighting or per-line DOM
creation. Use a plain textarea or truncated preview for oversized files, and
debounce editable diff recomputation by roughly 150–250 ms.

### 5. Cap subagent live payloads — High

Send a bounded projection—status plus the latest few actions—instead of
repeatedly serializing and scanning complete child histories. Apply the final
output cap consistently to single, parallel, and chain modes.

### 6. Keep hidden tabs idle — Medium

Prevent streaming state changes from restarting statistics polling while
`document.hidden` is true.

### Deliberately defer

Do not add bundling, minification, a frontend framework, or transcript
virtualization before measuring a remaining problem. For this localhost,
zero-build application, the targeted fixes above offer better value and less
complexity.

## Features and reliability

### 1. Fix published package contents — Critical

`package.json` currently omits `app.js`, `style.css`, and `vendor/**` from its
`files` list even though `index.html` loads them. Include the runtime assets and
add one package-content smoke check before publishing again.

### 2. Make safeguard denies authoritative — Critical

A broad shell `allow` rule can match before a later destructive-command `deny`.
Evaluate all matching denies first; compound commands should fall back to
`ask` rather than inherit a read-only prefix's allow decision.

### 3. Persist composer drafts — High

Store drafts per session in `sessionStorage`. Clear a draft only after the
command POST succeeds, and restore and focus it after a failed send.

### 4. Recover cleanly after reconnects — High

Restore authoritative streaming and compaction state after reconnect, disable
sending while pi is unavailable, signal subprocess readiness, and replay
unresolved approval or question dialogs without duplicating them.

### 5. Expand session controls — High

Feature-detect and expose RPC-supported clone, fork-from-message, rename, and
HTML export actions. Preserve the current one-process model: switching or
forking a session remains shared across tabs rather than pretending tabs are
independent agents.

### 6. Make manual Apply conflict-safe — High

Return a content hash from `/api/file`, require it when calling `/api/write`,
and return `409 Conflict` when another editor or tool changed the file in the
meantime.

### 7. Add opt-in notifications — Medium

Use the native Notification API only when the tab is hidden and either a
long-running response completes or approval is required. Keep notifications
opt-in and omit sounds initially.

### 8. Surface missing operational events — Medium

Handle `auto_retry_end` and `extension_error`, and add throttled context-pressure
warnings near meaningful thresholds. Avoid turning routine retries into noisy
persistent alerts.

## Recommended order

1. Fix package contents and safeguard precedence.
2. Add draft persistence and reconnect recovery.
3. Address history replay and multi-tab performance.
4. Improve responsive density and non-modal accessibility.
5. Add conflict-safe Apply and expanded session controls.
6. Add notifications and remaining operational feedback.
