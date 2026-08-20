# Verification — Correct and Resilient Editable Diff (U5 / Phase A5)

> SDD Phase 4 artifact. Maps every FR to its verification evidence.
> Slug: `editable-diff` · Date: `07082026` (7 Aug 2026).
> Artifacts: [`plan_`](./plan_editable-diff_07082026.md) ·
> [`spec_`](./spec_editable-diff_07082026.md) ·
> [`tasks_`](./tasks_editable-diff_07082026.md).

## Evidence

| ID | Result |
|----|--------|
| `node test/diff-view.test.js` | **47/47 passed** (T1.1–T1.8) |
| `node test/workspace-file.test.js` | **29/29 passed** (T2.1–T2.6) |
| `node test/diff-contract.test.js` | **12/12 passed** (C-3.1–C-3.8; written red, flipped per task) |
| Existing suite (12 files, excl. env-gated `rpc-sse`) | **all pass** |
| `node --check public/app.js` / `server.js` | clean |
| `git diff --check` | clean |
| HTTP wire smoke (server.js booted, port 4399) | see below |

## FR → verification map

- **FR-1 shared geometry** — contract C-3.3a/b/c (`.sx-host` declares
  `--sx-font/--sx-fs/--sx-lh` fixed-px 17.4/`--sx-tab/--sx-gutter/--sx-gutter-pad`;
  `.sx-body`/`.sx-line`/`.sx-gnum`/`.sx-ta` consume them; `.sx-ta` block
  padding 6px→0, left = gutter reserve, `+20px` fudge removed). Browser check
  (caret alignment at 100/125/150%, both themes) — **pending user spot-check**.
- **FR-2 gutter reserve** — `dv.gutterReserveCh` monotonic (T1.6: grows,
  never shrinks, digits+1, min 2ch); app.js `takeReserve` seeds it before
  first focus; every `--sx-gutter` setter routes through it. Browser check
  (no origin shift on async line-number patch) — **pending**.
- **FR-3 Review/Edit split** — contract C-3.1/3.2/3.6 (`.sx-hlbody` +
  `-webkit-text-fill-color` gone), C-3.5a/b (`aria-pressed` toggle,
  Review/Edit labels); same `.sx-ta` element persists (CSS-only
  `host[data-mode]` visibility); Edit mode hides the old column (single-
  column grid). Browser check (mode round-trips preserve undo/selection;
  toggle present in capture mode) — **pending**.
- **FR-4 edit-mode gutter** — `.sx-egutter` strip, 120ms debounced numbers
  from `ta.value` (T1 `lineCountOf`), scroll-synced via `syncFrom`,
  height = `lineCount × --sx-lh`. Browser check — **pending**.
- **FR-5 recompute policy** — `input` listener does NOT run LCS (gutter
  only); `scheduleRecompute` (150ms debounce, coalesced) on enter-Review /
  Apply / blur-from-Edit; `dv.largeHunkExceeds` gate (T1.8 at-cap/over-cap)
  → `.sx-paused` label, Apply unaffected. Browser check (large-fixture
  typing responsiveness; paused label over cap) — **pending**.
- **FR-6 version protocol** — T2.1–T2.6 (29 asserts); wire smoke:
  `/api/file` returns `version` (sha256) ✓; matching write → `{ok:true}` ✓;
  stale → **409 + fresh version** ✓; missing field → 400 ✓; create-only
  absent → ok ✓; create-only existing → 409 ✓; disk never clobbered ✓;
  safePath/CSRF intact (bad Host → 403 ✓).
- **FR-7 apply + conflict** — `doApply` sends `expectedVersion` (edit:
  apply-time read version; write: version or `null` create-only); 409 →
  `.sx-conflict` banner (role=alert) with Reload (single retry via
  re-invoked `applyEdit`), Compare (`mountSideBySide` read-only
  disk-vs-proposal), Cancel (keeps dirty edit); hunk 0-hit/N-hit bails
  preserved. Browser check (stale disk → banner → each recovery path;
  new-file write) — **pending**.
- **FR-8 controls** — dirty dot (`dv.dirty`, updated on input + apply),
  Reset (restores baseline, refocuses), Ctrl/Cmd+Enter (transcript only),
  `aria-label`=basename + `title`=path (contract C-3.7), stepper dirty
  warning label (FR-8.5), 24px targets (`.sx-mode-btn`/`.sx-ctx-btn`/
  `.sx-reset`/`.sx-conflict-btn` min-height 24). Browser check — **pending**.
- **FR-9 read-only paths** — transcript preview + permission-modal preview
  unchanged code path (`readOnly` branch), shared geometry via vars.
  Browser check (previews look unchanged) — **pending**.
- **FR-10 capture + JetBrains parity** — `mountEditableDiff` getter shape
  unchanged (`label | {label, oldFull, newFull}`; `newFull = ta.value`);
  capture mode has the Review/Edit toggle (gate fixed from `ro || cap` to
  `ro`); JetBrains `DocumentContent` untouched (no server/extension change).
  Browser check (approval modal capture values) — **pending**.
- **FR-11 native behavior** — composition guard disables mode switch
  (`compositionstart/end`); same-element persistence; syncFrom covers
  left/review/ta/gutter. Browser check (IME, undo, zoom) — **pending**.
- **FR-12 testable extraction** — `public/diff-view.js` dual-mode
  (47 unit tests + C-3.8 load order); `workspace-file.js` fs-injected
  (29 tests); all suites green; red-first process followed per task.

## Manual smoke matrix (pending user browser spot-check)

Run `node server.js` → <http://127.0.0.1:4317>, then:

1. Trigger an edit/write permission modal and a transcript diff card:
   - caret/selection sits on visible text; delete a line in Edit → caret
     does not drift; 100/125/150% zoom + dark/paperlike themes (FR-1/3).
2. Review ↔ Edit round-trips preserve undo/selection/scroll; Edit shows
   real text; gutter numbers align + track scrolling (FR-4/11).
3. Type in a large file diff: responsive, no per-frame freeze; switch to
   Review with a >4M-cell hunk → "diff too large" paused label; Apply still
   works (FR-5).
4. Stale-disk conflict: edit the file outside the webui, then Apply →
   amber banner → Reload (retries once), Compare (read-only disk vs
   proposal), Cancel (dirty edit kept); write-to-new-file works (FR-6/7).
5. Dirty dot + Reset appear when the proposal drifts; Ctrl/Cmd+Enter
   applies; textarea has the file name as its accessible name; stepper −/+
   while dirty shows "rebuild drops edits"; stepper buttons ≥24px (FR-8).
6. Approval modal: toggle present; edited proposal ships as
   `{label, oldFull, newFull}` identical to before; permission-modal +
   transcript previews unchanged; JetBrains native diff unchanged (FR-9/10).

## Browser spot-check log

- **Round 4 (2026-08-07):** user confirmed in-browser after the un-cap fix:
  editor == pane height (`.sx-ta` ≈ 590px == `.sx-eedit` in the modal;
  300px in the transcript), matrix accepted ("looking good"). **Slice
  closed** — set archived to `.sdd/archive/`.
- **Round 3 (2026-08-07):** DevTools geometry (`.sx-eedit` 1463×589.94 vs
  `textarea.sx-ta` 1463×200) pinned the real root cause: the composer's
  global `textarea { min-height: 48px; max-height: 200px }` rule capped
  `.sx-ta` at exactly 200px — no rule overrode `max-height`. Fixed by
  narrowing the selector to `textarea:not(.sx-ta)` (same idiom as the
  existing `#modal textarea:not(.sx-ta)` rule). The pre-A5 transparent
  overlay had masked the cap. Re-check pending: editor == pane height in
  modal + transcript, caret alignment at zoom/themes, Review↔Edit
  round-trips, tall-diff modal, 409 recovery paths, controls, capture
  parity.
- **Round 2 (2026-08-07):** permission modal Edit tab still collapsed to ~2
  rows after the round-1 fixes. Root cause: `.card.wide`'s height is
  content-driven (the 92vh clamp only resolves when content overflows), so
  for short diffs the whole flex chain resolves to content and the textarea's
  `height:auto` intrinsic size (~2 rows) wins. Fixed with
  `#modal .sx-eedit { min-height: 45vh }` (edit mode only; Review stays
  content-sized). Re-check pending: tall-diff modal, gutter strip,
  caret alignment at 100/125/150% + both themes, Review↔Edit round-trips,
  large-fixture responsiveness, 409 recovery paths, controls, capture parity.
- **Round 1 (2026-08-07):** approval modal + transcript checked. Two layout
  defects found + fixed in `public/style.css` (see CHANGELOG
  `diff(editable)` entry): unequal header heights (`.sx-hdr` now
  `min-height: 36px`) and the edit pane collapsing in the modal
  (`.sx-eedit` now column flex, textarea fills the modal height).
  Re-check pending: caret alignment at 100/125/150% + both themes,
  Review↔Edit undo/selection round-trips, large-fixture responsiveness,
  409 recovery paths, controls, capture parity.

## Non-goals re-confirmed

- JetBrains hardening (U6/D3), G1/C2 toggles, U6 policy engine, A1/A2/A4 —
  out of scope; A4 later owns keyboard/contrast passes over the new
  controls. `@media (max-width: 620px)` (session-analysis internals)
  untouched.
- `test/rpc-sse.test.js` remains environment-gated (needs real `pi` on
  PATH; unchanged this slice).
