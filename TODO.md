# TODO — follow-up from code review

Remaining tasks after the hardening pass (commit `046bb1a`, merged to `dev`).
Priority ordered: P1 high-leverage, P2 worth doing, P3 nice-to-have.

## P1 — Maintainability / UX gaps

- [x] **split `index.html` (3617 lines) into `index.html` + `style.css` + `app.js`**
      Done. `index.html` is now 78 lines (markup only); `style.css` 1262 lines;
      `app.js` 2310 lines. `server.js` gained a 2-entry `STATIC` whitelist map
      serving `/style.css` + `/app.js`. Zero-build preserved, all three assets
      smoke-tested (200 + correct MIME). (Review item A1)

- [x] **modal dialog accessibility** — `#modal` now carries `role="dialog"`/
      `aria-modal` (toggled on open/close); focus moves into the modal on open
      and back to the trigger on close; Tab is trapped within the card; Esc
      resolves the modal safely by firing its `[data-dismiss]` button (so pi's
      latch is never stranded — ask→"chat", confirm→No, input/editor→Cancel).
      `app.js` openModal/showModal/hideModal + `index.html`. (Review item A11y)

- [x] **responsive layout** — added `@media (max-width:720px)`: status chips
      wrap instead of horizontal-scrolling; the side-by-side edit diff stacks
      old-above-new; header reflows; modal card widens. `style.css`. (Review item A11y)

## P2 — Correctness / robustness

- [x] **`safePath` symlink escape** — switched from `path.resolve` (which does
      NOT follow symlinks) to `fs.realpathSync` on both the base and the target
      (resolving the existing parent for not-yet-existing write targets). A
      symlink inside `PI_CWD` aimed at `~/.ssh` is now rejected. Verified live
      (symlink-escape → rejected, parent-escape → rejected, legit file → OK).
      `server.js:safePath`. (Review item S3)

- [x] **request body size limit** — added `readBody(req)` with a 1MB cap
      (enforced both up-front via `Content-Length` and on the wire by accumulated
      bytes, destroying the socket on overflow). `/api/cmd` and `/api/write`
      both use it. Verified: 1.1MB POST → HTTP 500 "body too large". (C4)

- [x] **unhandled rejection in `refreshStats`** — fixed at the source: `api()`
      now attaches a no-op `.catch` to the fetch promise, so every
      fire-and-forget caller (refreshStats, init, UI buttons) is covered while
      awaited callers (send) still receive rejections. `app.js:api`. (C5)

- [x] **dedupe `ASK_MARKER` across trust boundary** — `server.js` is now the
      single source: it defines the literal, sets `process.env.PI_WEBUI_ASK_MARKER`
      before spawning pi (the `pi_minimal_webui` extension reads it), and injects
      `window.__PI_ASK_MARKER` into the served HTML (app.js reads it). Round-trip
      self-check passes; both sides retain a fallback for standalone use. (C6)

- [x] **confirm `followUp` wire key** — confirmed a real bug: the dedicated RPC
      command type is `"follow_up"` (snake-case), not `"followUp"`
      (`dist/modes/rpc/rpc-types.d.ts`; `streamingBehavior` is the separate
      camel-case field). app.js was sending `{type:"followUp"}` mid-stream, so
      follow-up delivery silently failed. Mapped `followUp`→`follow_up` in
      `send()`. (C7)

## P2 — Accessibility polish

- [x] **focus indicators audit** — added a global `:focus-visible` rule
      (2px accent outline) covering button/select/a/summary/input/textarea/
      `[tabindex]`. Keyboard users get a ring on every control; mouse clicks
      stay clean. Specificity beats the two pre-existing bare `outline:none`
      rules. `style.css`. (Review item A11y)

- [x] **pause polling when tab hidden** — stat/health intervals (3s/6s) are now
      cleared on `visibilitychange`→hidden and restarted (with an immediate
      refresh) on return. `app.js`. (Review item A11y)

## P3 — Naming / hygiene

- [ ] **rename `pi_minimal_webui` folder** — it only contains the
      `ask_user_question` shadow tool, not a whole alternate webui. A name like
      `pi-webui-ask-bridge` makes the purpose obvious. Browser side needs no
      change. (Review item A2)

- [ ] **monitor mutable top-level closure state** — ~11 shared pieces (`cur`,
      `pinned`, `askId`, `pendingAsk`, `pendingEditCalls`, `compacting`,
      `todos`, `commands`, `currentModelId`, `lastThinkPaint`, `renderRaf`).
      Fine at current size; the thing that makes the `index.html` split (P1
      above) worth doing before it grows. (Review item A4 — note only)

## Bonus hygiene (not on the original list)

- [x] two pre-existing unused-var blockers flagged by the linter — `_m` for the
      markdown link-replace full-match param (`app.js:71`), and dropped the
      unused `const w =` around `toolBlock(...)` (`app.js:1827`).

## Done

- [x] CSRF + DNS-rebinding gate on POSTs (S1)
- [x] SSE backpressure — drop stalled clients (C2)
- [x] Crash-loop guard with exponential backoff (C3)
- [x] `md()` link scheme allowlist — block `javascript:`/`data:` (S2)
- [x] Manual Apply uniqueness guard — bail on non-unique hunk (C1)
- [x] Diff size guard — skip O(n·m) LCS above 4M cells (Perf)
