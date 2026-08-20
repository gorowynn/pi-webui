# Implementation Plan & Tests — Correct and Resilient Editable Diff (U5 / Phase A5)

> SDD Phase 3 artifact. Task ordering + TiCoder test suite. **No implementation
> code yet** — written in Phase 4 after this is approved. Approval gate at the end.
>
> Slug: `editable-diff` · Date: `07082026` (7 Aug 2026).
> Builds on [`plan_`](./plan_editable-diff_07082026.md) +
> [`spec_`](./spec_editable-diff_07082026.md).

## Design for testability (the "How", decided here)

This slice has **real pure logic** (unlike adaptive-shell): the LCS row
builder, the monotonic gutter reserve, the dirty/mode helpers, and the
server's hash/version write check. They go into two zero-dep modules:

- **`public/diff-view.js`** (dual-mode like `session-analysis.js`: `window`
  export for the browser + `module.exports` for Node): ports the existing
  `diffLines`/`diffRows` algorithms verbatim, plus `gutterReserveFor`,
  `dirty`, and `largeHunkExceeds`. Registered in the `server.js` `STATIC`
  whitelist + `index.html` load order (before `app.js`).
- **`workspace-file.js`** (server-side, CommonJS like `jsonl.js`):
  `versionOf(content)` (sha256 hex, `node:crypto`) +
  `writeWorkspaceFileIfVersion(full, content, expectedVersion, fsImpl)` —
  fs-injected so tests run against a temp fixture; `server.js` stays a thin
  caller that maps outcomes to HTTP codes.

Three test files, all **written red first** (TiCoder):
`test/diff-view.test.js`, `test/workspace-file.test.js`,
`test/diff-contract.test.js` (static contract over the three public files,
mirroring the adaptive-shell pattern). Guardrails on every task:
`node --check public/app.js` (+ `server.js`), existing suite green,
`git diff --check`.

## Task List

### Task 1 — Pure diff-view module + unit tests  `[FR-12]`  **[x]**

- Create `public/diff-view.js` (dual-mode): `diffLines`/`diffRows` ported
  verbatim from app.js (same output shape — the contract tests pin it),
  `gutterReserveFor(lineCount, currentReserve)` (monotonic `(digits+1)ch`),
  `dirty(base, current)`, `largeHunkExceeds(cells)` (4M decision), and a
  `lineCountOf(text)` helper.
- `app.js`: switch its call sites to `diffView.*` (thin aliases; behavior
  identical). `server.js` STATIC gains `"/diff-view.js"`; `index.html` script
  order gains it (before `app.js`, after `tool-presentation.js`).
- **Tests (`test/diff-view.test.js`, red→green):** T1.1 equal-run alignment
  `#FR-12`; T1.2 unequal add/delete runs `#FR-12`; T1.3 empty/final lines
  `#FR-12`; T1.4 tabs preserved `#FR-12`; T1.5 Unicode rows `#FR-12`;
  T1.6 `gutterReserveFor` monotonic — grows, never shrinks, `digits+1`ch
  `#FR-2`; T1.7 `dirty` true/false `#FR-8`; T1.8 `largeHunkExceeds`
  at-cap/over-cap/under `#FR-5`. **Validation: unit.**

### Task 2 — Server version protocol  `[FR-6]`  **[x]**

- Create `workspace-file.js`: `versionOf(content)` (sha256 hex) +
  `writeWorkspaceFileIfVersion(full, content, expectedVersion, fsImpl)`
  returning `{ok:true}` | `{ok:false, status:409, error, version}` |
  `{ok:false, status:400, error}` (missing field) — fs-injected (read current,
  hash-compare or require-absent, write on match).
- `server.js`: `GET /api/file` → `{ok, content, version}`;
  `POST /api/write` requires `expectedVersion` (missing → 400), maps the
  helper's outcome to HTTP codes (409 carries the current `version`); CSRF/
  safePath/body-cap untouched (GOTCHAS #4/#10).
- **Tests (`test/workspace-file.test.js`, red→green):** T2.1 `versionOf`
  stable + content-sensitive `#FR-6`; T2.2 matching version writes `#FR-6`;
  T2.3 mismatch → 409 with current version `#FR-6`; T2.4 `expectedVersion:
  null` = create-only (exists → 409) `#FR-6`; T2.5 deleted file → 409
  version:null `#FR-6`; T2.6 missing `expectedVersion` → 400 `#FR-6`.
  **Validation: unit + `node --check server.js`.**

### Task 3 — Static contract test (red first)  `[FR-3, FR-6, FR-8, FR-12]`  **[x]**

- Create `test/diff-contract.test.js` (all assertions FAIL today):
  C-3.1 style.css has no `-webkit-text-fill-color` `#FR-3`; C-3.2 style.css
  has no `.sx-hlbody` rule `#FR-3`; C-3.3 style.css defines `--sx-lh` and
  `--sx-gutter-pad` `#FR-1`; C-3.4 server.js contains `expectedVersion` in
  `/api/write` and `version` in `/api/file` `#FR-6`; C-3.5 app.js contains
  `aria-pressed` + the Review/Edit toggle labels `#FR-3`; C-3.6 app.js has no
  `-webkit-text-fill-color` usage `#FR-3`; C-3.7 app.js sets a file-name
  `aria-label` on `.sx-ta` `#FR-8`; C-3.8 index.html loads `diff-view.js`
  before `app.js` `#FR-12`.
- **Tests:** run `node test/diff-contract.test.js` — red; flips green across
  T4 (C-3.3), T5 (C-3.1/2/5/6/7), T2 (C-3.4), T1 (C-3.8). **Validation: unit
  (static).**

### Task 4 — Geometry variables + monotonic gutter  `[FR-1, FR-2]`  **[x]**

- `style.css`: `.sx-host` declares `--sx-font`, `--sx-fs: 12px`,
  `--sx-lh: 17.4px` (fixed px), `--sx-tab: 2`, `--sx-gutter`,
  `--sx-gutter-pad: 10px`, explicit `letter-spacing:0; word-spacing:0`;
  `.sx-body`/`.sx-line`/`.sx-gnum`/`.sx-ta` consume them; `.sx-gnum`
  `min-width: calc(var(--sx-gutter) + var(--sx-gutter-pad))`; `.sx-ta` block
  padding 6px→0 (top/bottom), left padding = gutter reserve (no `+20px`
  fudge).
- `app.js`: gutter set once via `diffView.gutterReserveFor` (monotonic —
  grow-only), before first focus; never recomputed downward.
- **Tests:** C-3.3 green; T1.6 stays green; `node --check`. **Validation:
  unit + contract.**

### Task 5 — Review/Edit split  `[FR-3, FR-4, FR-11]`  **[x]**

- `app.js` editable branch of `mountSideBySide`: per-host mode state
  `{mode:'review'|'edit', composing:false, baseline, version, conflict}`;
  Review renders the aligned highlighted diff into the right body (existing
  compute/render path, read-only); Edit shows the **same `.sx-ta`** with real
  text/caret/selection (CSS-only visibility toggle) + a debounced gutter
  strip (numbers from `ta.value`, scroll-synced like today's two bodies);
  `input` in Edit mode updates only the gutter — **no LCS**; mode toggle
  button in the new-column header (labelled "Review"/"Edit", `aria-pressed`,
  ≥24px); toggle disabled during composition (compositionstart/end);
  returning to Review recomputes per FR-5.
- `style.css`: delete `.sx-hlbody` + the transparent-text styling
  (`color:transparent`, `-webkit-text-fill-color:transparent`,
  transparent background); `.sx-ta` gets real ink/background/border;
  toggle + gutter-strip styles.
- **Tests:** C-3.1/2/5/6/7 green; `node --check`. **Validation: contract +
  smoke (caret visible, toggle switches modes, undo survives round-trip).**

### Task 6 — Recompute policy + paused state  `[FR-5]`  **[x]**

- `app.js`: one `scheduleDiffRecompute` (120–200ms debounce, coalesced, or
  `requestIdleCallback` with rAF fallback) called on enter-Review, Apply, and
  blur-from-Edit; the editable `input` handler no longer schedules LCS;
  `diffView.largeHunkExceeds` gates the render — over cap → explicit
  paused label in the Review pane ("diff too large to preview — editing
  continues"), Apply unaffected.
- **Tests:** T1.8 stays green; C-suite green; smoke (large fixture typing
  stays responsive; paused label appears over cap). **Validation: unit +
  smoke.**

### Task 7 — Apply flow + conflict recovery  `[FR-7]`  **[x]**

- `app.js` `applyEdit`: apply-time `/api/file` read provides `content` +
  `version` (edit path splices `baselineNew` with the existing 0-hit/N-hit
  bails, then POSTs `{path, content: next, expectedVersion: version}`; write
  path fetches the version first — `null` when 404 — and POSTs it); 409 →
  inline recovery banner in `.sx-host` — **Reload** (refetch + single retry),
  **Compare** (read-only Review of disk-current vs `ta.value`),
  **Cancel** (dismiss, dirty state intact); inline error/success text beside
  the Apply button (toast secondary); success morph unchanged.
- **Tests:** T2.2–T2.6 stay green; C-3.4 green; smoke (stale disk → 409 →
  each recovery path; new-file create-only; hunk bails still toast).
  **Validation: unit + contract + smoke.**

### Task 8 — Controls + capture parity  `[FR-8, FR-10]`  **[x]**

- Dirty dot in the new-column header (`ta.value !== baseline`); **Reset
  Proposal** (visible when dirty, restores baseline, focus returns to
  textarea); **`Ctrl/Cmd+Enter`** applies (transcript path only);
  `.sx-ta` `aria-label` = basename, `title` = path; stepper shows a warning
  label when dirty (rebuild drops edits — documented behavior surfaced);
  24px targets on toggle/stepper/reset.
- Capture mode (`mountEditableDiff`): gains the Review/Edit toggle; the
  getter still returns `label | {label, oldFull, newFull}` with `oldFull` =
  windowed old and `newFull` = `ta.value` — byte-identical semantics;
  no Apply/version interaction (extension owns the write).
- **Tests:** C-3.7 green; smoke (capture values unchanged — approval modal
  ships the edited proposal exactly as today; JetBrains native diff
  untouched). **Validation: contract + smoke.**

### Task 9 — E2E smoke + verify report  `[all FRs / SC-1…SC-7]`  **[x]**

Run the full matrix (below), then write
`verify_editable-diff_07082026.md` mapping every FR → passing test/smoke
step. **Validation: all suites + matrix green.**

## Dependencies

```
T1 ──▶ T4 ──▶ T5 ──▶ T6 ──┐
T2 ──────────────────▶ T7 ─┼──▶ T8 ──▶ T9
T3 (red contract, gates T4/T5/T7; written with T1)
```

T1 (module + tests) gates T4–T6; T2 (server) gates T7; T3 is the red
contract that flips green chunk by chunk; T5 gates T8 (toggle is a control);
T9 is last.

## TiCoder Test Suite (summary)

- `test/diff-view.test.js` — T1.1…T1.8 (alignment, gutter monotonic, dirty,
  large-hunk), each tagged `#FR-x`.
- `test/workspace-file.test.js` — T2.1…T2.6 (hash, versioned write,
  create-only, deleted, missing field), tagged `#FR-6`.
- `test/diff-contract.test.js` — C-3.1…C-3.8 static asserts, tagged `#FR-x`.
All written red; **none of the artifacts exist yet**. Guardrails: `node
--check public/app.js` + `server.js`, full existing suite green, `git diff
--check`.

## Manual smoke matrix (Task 9; one check per FR/SC)

- caret + selection coincide with visible text before/after deletion rows at
  100/125/150% zoom, both themes, modal + transcript forms `#FR-1,FR-3`
  (`SC-1`);
- Review↔Edit round-trips preserve undo/selection/scroll; Edit shows real
  text with working IME; gutter numbers align and track scrolling `#FR-4,
  FR-11` (`SC-2`);
- typing stays responsive on a large fixture; "diff too large" paused label
  appears over the 4M-cell cap; Apply still works there `#FR-5` (`SC-4`);
- stale disk → 409 banner → Reload retries once, Compare shows
  disk-vs-proposal, Cancel keeps the dirty edit; new-file write (create-only)
  works; hunk-missing/duplicate bails still toast `#FR-6,FR-7` (`SC-5`);
- dirty dot, Reset Proposal, Ctrl/Cmd+Enter apply, file-named aria-label,
  24px targets, stepper dirty warning `#FR-8` (`SC-6`);
- approval capture returns identical `{label, oldFull, newFull}` values;
  permission-modal + transcript read-only previews look unchanged; JetBrains
  native diff unchanged `#FR-9,FR-10` (`SC-7`);
- `node test/diff-view.test.js`, `node test/workspace-file.test.js`, `node
  test/diff-contract.test.js`, full existing suite, `git diff --check`.

---

**Phase 3 gate — TiCoder validation loop:** the tests above express the
requirements and **should currently FAIL** (none of the artifacts exist).
Do they capture the intended behavior? And do you **approve this
implementation plan and test suite to begin coding**? Reply **Yes** to start
Phase 4 (Task 1 first), or **No** with corrections.
