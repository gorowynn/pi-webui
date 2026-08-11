# Plan — Correct and Resilient Editable Diff (U5 / Phase A5)

> SDD Phase 1 artifact. Defines the **What** and **Why** only — no
> implementation, no tasks. Approval gate at the end.
>
> Slug: `editable-diff` · Date: `07082026` (7 Aug 2026).
> Followed by `spec_`, `tasks_`, `verify_` artifacts sharing this slug+date.
> Sources: [`docs/roadmap.md`](../docs/roadmap.md) U5 +
> [`docs/plans.md`](../docs/plans.md) Phase A5.
> Ordering: user-selected next UI slice after A3 (adaptive shell); A4/A2/A1
> follow later; U6/safeguard remains deferred after the UI changes.

## Problem Statement

The web diff puts a **transparent textarea over independently rendered
highlighted HTML** (`style.css` "editable new pane: transparent textarea layered
over a colored body"). The structural mismatches are documented in
`plans.md` U5 and verified against the live source (2026-08-07):

- the highlighted body starts at **zero vertical padding** while the textarea
  starts at **6px** — about one-third of its 17.4px line height — so the caret
  sits permanently low;
- the aligned diff inserts **deletion placeholders** (`ln-empty` rows) that do
  not exist in the textarea's raw value, so editing drifts from the visible
  highlight as lines are added/removed;
- gutter line numbers update async without a reserved width basis, so the text
  origin can shift mid-edit;
- the diff is recomputed on a per-animation-frame cadence (only a 4M-cell LCS
  guard exists, GOTCHAS #6), which can stall typing on large files;
- Apply has **no conflict protection**: `POST /api/write` (server.js) takes
  `{path, content}` and overwrites unconditionally — if the file changed on
  disk since the diff was captured, the newer content is silently clobbered;
- four render paths share the same broken renderer: the read-only transcript
  preview, the read-only permission-modal preview (`renderEditDiffPreviews`,
  GOTCHAS #7), the editable approval capture (`mountEditableDiff` → returns
  `{label, oldFull, newFull}`), and the editable post-apply transcript view.

We need the diff to be **correct by construction**: exact shared geometry,
a Review/Edit separation instead of overlay text, and conflict-safe Apply.

## Business Goals

1. **Caret and selection coincide with visible text.** The caret, selection
   rectangle, line backgrounds, and gutters align with the text the user sees
   and edits — before and after deletion rows, at 100/125/150% zoom, in both
   themes, in both modal and transcript forms.
2. **Review and Edit are explicit modes.** Review renders the aligned,
   syntax-highlighted diff; Edit renders a normal visible textarea with real
   text/caret/selection; returning to Review recomputes the aligned diff.
   Raw editor lines are never overlaid on blank deletion placeholders.
3. **Conflict-safe Apply.** `/api/file` returns a content version/hash; Apply
   sends the expected version; `/api/write` rechecks immediately before
   writing and returns `409` on mismatch; the diff shows an inline
   Reload/Compare/Cancel recovery path. Stale disk content is never
   overwritten silently.
4. **Typing stays responsive.** Diff recomputation is debounced/idle
   (120–200ms) instead of per-animation-frame; large hunks show an explicit
   paused/fallback state rather than blocking input.
5. **No behavior loss.** Native textarea undo/redo, selection, scroll, IME/
   composition, clipboard, tabs, and focus survive mode switches and
   repaints; the permission-modal capture return values and the native
   JetBrains `DocumentContent` wire contract stay unchanged (GOTCHAS #17).

## Constraints

- **Hard: zero-build / minimal-dep.** Pure diff/version logic extracted to a
  dual-mode module (`public/diff-view.js`, require-able in Node) with plain
  `node:assert` tests; no framework, no runtime install.
- **Server changes ARE in scope** (unlike the adaptive-shell slice): extend
  `GET /api/file` (add `version`) and `POST /api/write` (add
  `expectedVersion` → `409`). The CSRF + DNS-rebinding gate, `safePath`
  realpath semantics (GOTCHAS #4), and the 1MB body cap (GOTCHAS #10) must not
  regress; errors stay JSON with stable shapes.
- **Load-bearing invariants:** the 4M-cell LCS guard stays (GOTCHAS #6);
  missing/duplicate-hunk Apply checks stay; `curToolName`/`curToolArgs`
  snapshot contract for the permission preview stays (GOTCHAS #7); `esc()`
  stays the single escaper (GOTCHAS #12).
- **JetBrains unchanged.** The native editable diff (`DocumentContent`,
  `{label, oldFull, newFull}` bridge values) keeps its exact wire contract and
  behavior — this slice is standalone-web only.
- **Both themes, zoom 100/125/150%**, and the geometry must be shared CSS
  variables (font family, exact pixel line height, block padding, tab size,
  letter/word spacing, gutter basis) applied identically to old, highlighted,
  and editable panes.
- **Existing suite stays green** (all current unit tests; `node --check`;
  `git diff --check`).

## Success Criteria

- [ ] **SC-1 — Alignment.** The caret and the selected text coincide with the
      visible editor text before and after deletion rows at 100/125/150% zoom
      in both themes, in both the modal and transcript forms.
- [ ] **SC-2 — Review/Edit split.** Review shows the aligned highlighted diff;
      Edit shows normal visible textarea text/caret/selection; returning to
      Review recomputes the aligned diff; raw lines are never drawn over
      deletion placeholders.
- [ ] **SC-3 — Shared geometry.** One set of CSS variables drives font, exact
      line height, block padding, tab size, letter/word spacing, and the
      gutter's `digits + padding` flex basis for all three panes (old,
      highlighted, editable); the 0px-vs-6px padding mismatch is gone.
- [ ] **SC-4 — Responsive editing.** Typing remains responsive on the agreed
      large fixture (no per-frame full LCS/highlighting); large hunks show an
      explicit paused/fallback state and update on Review/blur.
- [ ] **SC-5 — Conflict-safe Apply.** Stale disk content produces a
      recoverable `409` with inline Reload/Compare/Cancel and never
      overwrites; a fresh file applies cleanly; missing/duplicate-hunk checks
      still bail; the version comes from `/api/file` and is checked by
      `/api/write`.
- [ ] **SC-6 — Editing UX.** Dirty state, Reset Proposal, `Ctrl/Cmd+Enter`
      Apply, a labelled textarea containing the file name, inline success/
      error state, and controls meeting the 24px target rule.
- [ ] **SC-7 — No regression.** Native undo/redo, selection, scroll, resize,
      IME, clipboard, and focus survive mode switches; capture return values
      (approval flow) unchanged; the JetBrains contract unchanged; the full
      existing unit suite + `git diff --check` green; zero new deps.

## Out of Scope (this effort)

- **JetBrains plugin changes** — containment hardening, request-keyed
  resolvers, and lifecycle work belong to A6/D3 (U6 deferred); the native
  diff surface itself is only *kept unchanged* here.
- **G1/C2** (request-scoped change summary, side-by-side/unified toggles,
  previous/next change, intraline emphasis, copy hunk) — the Next horizon;
  this slice builds the Review/Edit base they sit on.
- **U6** (permission policy engine, broker, `#permissions` page) — deferred
  after the UI changes per user decision.
- **A1/A2/A4** — separate slices; A4 will later own the keyboard/contrast
  contract for the new diff controls (native buttons + labels land here per
  A5 step 8, semantics deepen there).

---

**Phase 1 gate:** Does this plan align with your goals? Reply **Yes** to proceed
to the detailed specification (Phase 2), or **No** with corrections.
