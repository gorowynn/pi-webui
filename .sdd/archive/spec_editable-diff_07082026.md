# Specification — Correct and Resilient Editable Diff (U5 / Phase A5)

> SDD Phase 2 artifact. Functional contract + edge cases. **No implementation
> code.** Approval gate at the end.
>
> Slug: `editable-diff` · Date: `07082026` (7 Aug 2026).
> Builds on [`plan_`](./plan_editable-diff_07082026.md). Followed by `tasks_`,
> `verify_`. Traces: every FR cites its plan SC; every SC is covered by ≥1 FR.

## 1. User Stories

- **US-1** As a user approving an edit, I want the caret and selection to sit
  exactly on the visible text, so I can fix the proposal precisely.
- **US-2** As a user reviewing a change, I want to switch between the aligned
  highlighted diff (Review) and a normal text editor (Edit) — never an overlay
  that drifts.
- **US-3** As a user with a large file, I want typing to stay responsive and a
  clear "diff too large" state instead of a frozen UI.
- **US-4** As a user whose file changed on disk since the proposal, I want a
  clear conflict path — my work is never silently overwritten.
- **US-5** As a keyboard user, I want labelled controls, a file-named editor,
  and `Ctrl/Cmd+Enter` to apply.

## 2. Current implementation (verified 2026-08-07)

- `mountSideBySide(host, path, oldText, newText, isWrite, {capture})` builds
  `.sx-host > .sxs` (grid old|new); each `.sx-col` = `.sx-hdr` + `.sx-body`
  (scroll) of `.sx-line` rows (`.sx-gnum` sticky gutter, `.sx-ltxt`);
  `ln-empty` rows are deletion placeholders, `ln-del`/`ln-add` tint rows.
- Editable pane: `.sx-edit` (flex column) wraps an absolute
  `.sx-hlbody` (highlight, `pointer-events:none`) + `.sx-ta`
  (`color:transparent; -webkit-text-fill-color:transparent; caret-color:ink`,
  `padding: 6px 12px 6px calc(var(--sx-gutter, 2.5ch) + 20px)`,
  `height:300px; resize:vertical`). `input` → rAF → `repaint()` = full LCS
  (`compute(baseOld, ta.value)`, 4M-cell guard) + re-render BOTH bodies every
  frame. Gutter `--sx-gutter` is recomputed per repaint (can shrink).
- Apply (`applyEdit`): edit path re-fetches the file, counts `baselineNew`
  occurrences (0 → bail "no longer present", >1 → bail "appears N times"),
  replaces the first, POSTs `/api/write {path, content}`. Write path POSTs the
  edited content directly. No version/conflict handling.
- Approval capture (`mountEditableDiff`): returns
  `(label) => label | {label, oldFull, newFull}` — sent over
  `extension_ui_response`; `narrowEditRegions` windows hunks ±`pi:diffCtx`
  (stepper rebuilds the diff, dropping in-flight edits — documented).
- Read-only paths: transcript diff preview + permission-modal preview
  (`renderEditDiffPreviews`, GOTCHAS #7) — two scroll bodies, `syncFrom` sync.
- Server: `GET /api/file` → `{ok, content}` (no version); `POST /api/write`
  → `{ok:true}` / 500; `safePath` realpath (GOTCHAS #4); CSRF + 1MB-body
  variants apply (GOTCHAS #10). Only caller of `/api/write`: app.js applyEdit.

## 3. Functional Requirements

### 3.1 Shared geometry — `FR-1` [SC-3]

1. One set of CSS variables on `.sx-host` drives every pane:
   `--sx-font` (mono stack), `--sx-fs: 12px`, `--sx-lh: 17.4px` (**fixed px** —
   the exact 12×1.45 line height, no relative values), `--sx-tab: 2`,
   `--sx-gutter` (ch), `--sx-gutter-pad: 10px`, and explicit
   `letter-spacing: 0; word-spacing: 0`.
2. `.sx-body` rows, `.sx-hlbody`, and `.sx-ta` all consume the same
   font/size/line-height/tab variables — the current 0px-vs-6px block-padding
   mismatch is removed (the 6px `padding-top/bottom` on `.sx-ta` is deleted
   with the overlay, §3.3).
3. Both themes keep working; the diff colors (`ln-add`/`ln-del`/`ln-empty`)
   are unchanged.

### 3.2 Gutter reserve — `FR-2` [SC-1, SC-3]

1. `--sx-gutter` is computed as `(digits of the max line count seen + 1)ch`
   and is **monotonic** — it grows when line counts grow, never shrinks, so the
   text origin can't shift when async line numbers update.
2. The reserve is set before first focus; a "digits + inline padding" flex
   basis (`min-width: calc(var(--sx-gutter) + var(--sx-gutter-pad))`) replaces
   today's shrinkable per-repaint value.
3. Gutter updates after edits must never reflow the text column.

### 3.3 Review/Edit modes — `FR-3` [SC-2, SC-7]

1. Every **editable** pane (approval capture + post-apply transcript view) has
   two explicit modes on a labelled toggle (`aria-pressed`, default **Review**):
   - **Review**: the aligned, syntax-highlighted diff (old read-only | new
     highlighted) — today's renderer minus the overlay;
   - **Edit**: a normal visible `<textarea>` — real `color`, real background,
     real caret/selection/scroll; the `color:transparent` /
     `-webkit-text-fill-color:transparent` / transparent-background overlay
     styling and `.sx-hlbody` overlay plane are **deleted**.
2. The **same `.sx-ta` element** persists across mode switches (CSS-only
   visibility toggles) — native undo/redo, selection, and scroll survive.
3. Returning to Review recomputes the aligned diff from `ta.value` (§3.5).
4. Raw editor lines are never drawn over deletion placeholders (they cannot
   exist in Edit mode by construction).
5. Read-only panes (transcript preview, permission-modal preview) get no
   toggle — they always render Review style (§3.9).

### 3.4 Edit-mode gutter — `FR-4` [SC-1, SC-2]

1. In Edit mode a left gutter strip shows line numbers derived from
   `ta.value` (cheap text split — **no LCS during typing**), updated on input
   debounced 120ms and on scroll (same `syncFrom`-style sync as today's two
   bodies).
2. The gutter uses the §3.1/§3.2 variables so its rows align with the
   textarea's line grid exactly; the textarea's left padding equals the
   gutter reserve.

### 3.5 Recompute policy — `FR-5` [SC-4]

1. The full LCS + highlight render runs **only** on: entering Review, Apply
   (success or conflict), and blur-from-Edit — never per keystroke.
2. Recomputes are debounced 120–200ms (or `requestIdleCallback` with rAF
   fallback); a pending recompute is coalesced (single render per batch).
3. The 4M-cell guard (GOTCHAS #6) stays; when `compute` would exceed it, the
   Review pane shows an explicit **paused state** ("diff too large to
   preview") instead of blocking — editing and Apply keep working.
4. `--sx-gutter` monotonic growth still applies after recomputes (§3.2).

### 3.6 Version protocol (server) — `FR-6` [SC-5]

1. `GET /api/file?path=` additionally returns **`version`** =
   `sha256(content)` hex (node:crypto; server-computed only, never in the
   browser). `{ok:false}` responses unchanged.
2. `POST /api/write` accepts **`expectedVersion`**:
   - hash string → the file must currently have exactly that hash;
   - `null` → the file must **not** exist (create-only);
   - missing field → `400 {ok:false, error}` (no unversioned writes).
3. On mismatch/missing-file: **`409 {ok:false, error, version}`** where
   `version` = the current hash (or `null` if absent) — the client recovers
   without a second fetch. Unexpected errors stay `500`.
4. `safePath`, the CSRF/DNS-rebinding gate, and the body cap are untouched
   (GOTCHAS #4/#10). The hash/check logic lives in a small pure server module
   (`writeWorkspaceFileIfVersion`-style helper, fs-injected) so it is
   unit-testable with a temp fixture.
5. The edit path's hunk splice keeps its read-time version: the apply-time
   `/api/file` read provides both the content to splice and the
   `expectedVersion` for the write (TOCTOU guard).

### 3.7 Apply flow + conflict recovery — `FR-7` [SC-5]

1. Apply reads the file fresh (edit path), splices `baselineNew` (existing
   0-hits / N-hits bails preserved), and POSTs `{path, content: next,
   expectedVersion}`. The write path POSTs `{path, content: edited,
   expectedVersion}` where `expectedVersion` comes from an apply-time
   `/api/file` read (`null` when the file doesn't exist yet).
2. **409** → inline recovery banner in the `.sx-host` (not toast-only):
   - **Reload** — refetch disk, re-attempt the Apply once with the new
     version (single retry; the hunk bails still guard the edit path);
   - **Compare** — render a read-only Review of disk-current vs the current
     proposal (`ta.value`), so the user sees exactly what changed;
   - **Cancel** — dismiss the banner, keep the current state (dirty flag
     intact, no data loss).
3. Success keeps today's "Applied ✓" morph; conflicts and errors render
   inline text next to the Apply button (toast remains as secondary signal).
4. Approval-capture mode has **no** Apply/disk-write path (the extension owns
   the write) — §3.6/§3.7 do not apply there.

### 3.8 Editing controls — `FR-8` [SC-6]

1. **Dirty state**: the new-column header shows a `•`/label when
   `ta.value !== baselineNew` (approval) or `!== baseNew` (transcript).
2. **Reset Proposal** button — visible only when dirty; restores the baseline
   text (undo-stack-friendly: a single value assignment, keyboard focus
   returns to the textarea).
3. **`Ctrl/Cmd+Enter`** applies (transcript path only, when the Apply button
   is present); the existing click path is unchanged.
4. The textarea carries `aria-label` = the file name (basename, path in
   title); the mode toggle, stepper (−/N/+), and reset buttons meet the 24px
   target rule.
5. The context stepper (`pi:diffCtx`) keeps its documented behavior; changing
   it while dirty shows a confirm-free warning label that edits will be
   dropped on rebuild (existing semantics, surfaced).

### 3.9 Read-only paths — `FR-9` [SC-7]

The transcript diff preview and the permission-modal preview
(`renderEditDiffPreviews`) keep rendering the aligned highlighted diff
read-only; they adopt the §3.1/§3.2 geometry and gutter reserve so they look
identical to Review mode. No toggle, no textarea.

### 3.10 Capture + JetBrains contract — `FR-10` [SC-7]

1. `mountEditableDiff` still returns `(label) => label | {label, oldFull,
   newFull}` with `oldFull` = the windowed old text and `newFull` =
   `ta.value` at click time — byte-identical semantics to today
   (GOTCHAS #17 parity for the `{label, oldFull, newFull}` bridge value).
2. The native JetBrains `DocumentContent` diff is **untouched** this slice.
3. The mode toggle works in capture mode (Review shows the proposal
   highlighted; Edit edits it).

### 3.11 Native behavior preservation — `FR-11` [SC-7]

1. Textarea undo/redo, selection, scroll position, clipboard, tabs, and focus
   survive Review↔Edit switches and recovery-banner open/close (same element,
   §3.3.2).
2. Mode switching is disabled during IME composition (compositionstart/end
   flag); composition completes before Review recomputes.
3. Verified at 100/125/150% zoom and both themes in the smoke matrix.

### 3.12 Testable extraction — `FR-12` [all SCs]

Pure logic moves to a dual-mode module **`public/diff-view.js`** (require-able
in Node): the LCS row builder (existing `diffLines`/`diffRows` algorithms),
`gutterReserveFor(lineCount, current)` (monotonic ch), mode-state helpers
(`dirty(base, current)`, mode toggle transitions), and the large-hunk guard
decision. Server hash/version logic in a tested helper (§3.6.4). New tests:
`test/diff-view.test.js`, `test/workspace-file.test.js`, and a small static
contract test `test/diff-contract.test.js` (overlay CSS gone, toggle + labels
present, `/api/write` version fields present — written red first).

## 4. Data Models

- **`version`**: `sha256(content)` hex — opaque to the client; computed
  server-side only.
- **`GET /api/file`**: `{ok:true, content, version}` | `{ok:false, error}`.
- **`POST /api/write`**: in `{path, content, expectedVersion}`; out
  `{ok:true}` | `400`/`409 {ok:false, error, version?}` | `500 {ok:false,
  error}`.
- **CSS vars** (on `.sx-host`): `--sx-font`, `--sx-fs`, `--sx-lh`,
  `--sx-tab`, `--sx-gutter`, `--sx-gutter-pad`, explicit letter/word spacing.
- **Per-host state** (module-scope per mount, GOTCHAS #8 style):
  `{mode:'review'|'edit', dirty, baseline, version, conflict:null|{version},
  composing:bool}`.
- Existing keys unchanged: `pi:diffCtx`; capture getter shape
  `label | {label, oldFull, newFull}`.

## 5. Edge Cases

1. **TOCTOU window** — Apply's read→write race is closed by
   `expectedVersion`; 409 gives `version` for one-shot recovery (FR-6/FR-7).
2. **Write to a new file** — `expectedVersion:null` (create-only); a file
   created after mount → 409 (FR-6.2/3).
3. **File deleted before Apply** — edit path: read fails (existing bail);
   write path: 409 with `version:null` (FR-7).
4. **Non-unique hunk** — existing N-hits bail unchanged (FR-7.1).
5. **Huge file** — 4M-cell paused state in Review; Edit/Apply unaffected
   (FR-5.3); gutter reserve handles 5+ digit line counts (FR-2).
6. **IME mid-switch** — toggle disabled during composition (FR-11.2).
7. **Zoom** — fixed-px `--sx-lh` keeps rows aligned at 125/150% (FR-1.1,
   smoke).
8. **Stepper rebuild while dirty** — documented drop with warning label
   (FR-8.5); version state resets with the rebuild.
9. **Read-only paths** — no textarea, no toggle, no version interaction
   (FR-9).
10. **Conflict + Edit mode** — the banner overlays without touching the
     textarea (element persists, undo intact); Compare renders read-only
     (FR-7.2, FR-11.1).
11. **Overlay removal regressions** — the static contract test asserts the
     transparent-text styling and `.sx-hlbody` overlay are gone (FR-3.1,
     FR-12).

## 6. Verification Approach

- **Automated**: `test/diff-view.test.js` (alignment: equal/unequal change
  runs, empty/final lines, tabs, Unicode, gutter-width transition, monotonic
  reserve; mode/dirty helpers; large-hunk decision), `test/workspace-file.test.js`
  (hash + versioned write against a temp fixture: match, mismatch→409,
  create-only, deleted-file, missing-field→400), `test/diff-contract.test.js`
  (static: overlay CSS absent, toggle/aria/labels present, `/api/write`
  expectedVersion in server.js, `/api/file` version) — all written **red
  first**. Guardrails: `node --check public/app.js`, existing suite green,
  `git diff --check`.
- **Manual smoke**: caret/selection at 100/125/150% in both themes
  (modal + transcript forms); Review↔Edit round-trips preserving undo;
  edit-add/delete-modify flows; large-fixture typing responsiveness; stale-
  disk 409 → Reload/Compare/Cancel; new-file write; approval capture values
  unchanged; permission-modal + transcript previews unchanged; stepper;
  Ctrl/Cmd+Enter; reset; JetBrains native diff unchanged.

---

**Phase 2 gate:** Is this specification complete and accurate? Reply **Yes** to
proceed to the implementation plan + TiCoder tests (Phase 3), or **No** with
corrections.
