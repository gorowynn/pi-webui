# Implementation Plan and TiCoder Tests: Contextual Git Review Workspace

## Execution Rules

- Implement exactly one chunk at a time.
- Create or extend that chunk's tests before implementation; the new assertions
  should initially fail because the behavior is not yet present.
- Run the chunk's tests, fix until green, then re-check the tagged FRs against
  `.sdd/spec_git-review-workspace_21082026.md` before marking the chunk complete.
- Preserve the existing zero-build asset order, `#toolsbar`/`rail.js` persistence
  contract, Git confirmation flows, path containment, and permission posture.
- Do not add cloud PR integration, voice input, or a browser code editor.

## Ordered Chunks

### C1 — Establish the pure review-state contract

- [x] Define the pure review helpers and their dual-mode test surface for snapshot
      normalization, status labels, summary counts, empty/loading/error states,
      selected-file reconciliation, and safe tool-to-file targets.
- **FR/goal:** FR-1–FR-3, FR-6, FR-8, FR-11–FR-13, FR-17, FR-19–FR-21, FR-32;
  PG-1 and PG-3.
- **Change surface:** a small `public/git-review.js` seam plus
  `test/git-review.test.js`, only if the existing Git rail helpers cannot be
  tested without extracting pure logic. If created, it MUST use the project's
  IIFE + guarded CommonJS export pattern, be added to the server static allowlist,
  and load before `app.js`.
- **TiCoder tests:** `node test/git-review.test.js`
  - normalizes all supported file statuses and counts;
  - emits clean/no-Git/loading/error states;
  - preserves a selected path only when it remains in the active snapshot;
  - rejects absolute, parent-traversal, and cross-workspace tool targets;
  - returns an actionable target only for a reliable workspace-relative path.
- **Depends on:** none.

### C2 — Verify and harden the existing Git data boundary

- [x] Extend only the existing Git snapshot/diff parsers or fixtures needed to
      represent branch, staged/unstaged/untracked counts, renames, deleted files,
      binary/unavailable diffs, and bounded diff failures. Do not invent a second
      Git API or change mutation semantics.
- **FR/goal:** FR-2, FR-3, FR-6, FR-10–FR-13, FR-33; PG-1.
- **Change surface:** `git.js`, existing `/api/git` and `/api/git/diff` contract
  only where required, `test/git.test.js`, and possibly
  `test/trust-boundary.test.js`.
- **TiCoder tests:** `node test/git.test.js`
  - parses staged, unstaged, untracked, renamed, and deleted status records;
  - keeps numeric additions/deletions nullable for binary/unavailable files;
  - represents detached/missing branch and non-repository results safely;
  - rejects a diff path outside the validated snapshot/workspace;
  - leaves commit/push/reset/revert/discard confirmation contracts unchanged.
- **Depends on:** C1.

### C3 — Build the contextual Changes surface

- [x] Extend the existing Git rail widget into a review surface with a summary
      header, `Changes`/`Files` navigation, changed-file rows, branch/status
      context, clean and no-selection states, and bounded loading/error states.
      Reuse the existing rail widget and generation-stamp lifecycle.
- **FR/goal:** FR-4, FR-5, FR-6, FR-7, FR-8, FR-11, FR-14, FR-31, FR-32; PG-1 and PG-2.
- **Change surface:** `public/index.html` only for required semantic hooks,
  `public/app.js` Git rail rendering/wiring, `public/style.css`, and
  `test/git-review-contract.test.js` plus `test/rail.test.js` updates.
- **TiCoder tests:** `node test/git-review-contract.test.js` and
  `node test/rail.test.js`
  - exposes the Changes trigger and selected tab state;
  - renders file status/count metadata and clean/no-Git states;
  - keeps one active review widget and does not create a second rail persistence
    key;
  - drops stale asynchronous renders after a widget/workspace change;
  - gives every trigger, tab, file row, and empty state an accessible name.
- **Depends on:** C1 and C2.

### C4 — Add selected read-only diff review and reconciliation

- [x] Make file selection render a bounded read-only diff with path/status header,
      back/close, refresh/reconcile, binary/deleted/oversized/error states, and
      safe selection clearing when the snapshot changes. Keep existing editable
      permission diffs separate.
- **FR/goal:** FR-7–FR-13, FR-20–FR-21, FR-26, FR-31–FR-34; PG-1 and PG-6.
- **Change surface:** existing `showGitDiff`/Git rail flow in `public/app.js`,
  diff/review styles, `test/git-review.test.js`, `test/diff-contract.test.js`,
  and `test/trust-boundary.test.js` where relevant.
- **TiCoder tests:** extend `node test/git-review.test.js` and
  `node test/diff-contract.test.js`
  - selected files render read-only review output without editable controls;
  - stale, deleted, binary, oversized, and failed diffs produce bounded states;
  - refresh preserves a still-valid selection and clears a removed one;
  - mutation buttons remain confirmation-gated and never appear as implicit diff
    application;
  - long paths/diff lines cannot create an unbounded horizontal layout.
- **Depends on:** C3.

### C5 — Add shell repository/branch/change context

- [x] Add compact active repository, branch, and change-summary context to the
      existing shell without duplicating the full Usage/Git rail content. Provide
      loading, clean, unavailable, detached, and error states and make the summary
      activate/focus the Changes surface.
- **FR/goal:** FR-1–FR-4, FR-22, FR-27, FR-30–FR-33; PG-1.
- **Change surface:** existing header markup/rendering, `public/app.js`,
  `public/style.css`, `test/shell-layout.test.js`, and
  `test/git-review-contract.test.js`.
- **TiCoder tests:** `node test/shell-layout.test.js` and the review contract test
  - header contains one canonical repository/branch context surface;
  - full paths have a bounded accessible representation;
  - clean/loading/unavailable states do not retain stale branch/count text;
  - activating the summary targets the existing Changes widget;
  - narrow header metadata remains usable and does not force page overflow.
- **Depends on:** C1 and C2.

### C6 — Improve workspace and session orientation

- [x] Add bounded branch/change/state metadata to workspace/session rows where the
      existing endpoints provide it, preserving current switching, no-switch IDE
      mode, active-row semantics, previews, recency, and truncation behavior.
      Reconcile or clear review state during workspace/session changes.
- **FR/goal:** FR-14, FR-15, FR-16, FR-17, FR-32, FR-33; PG-2.
- **Change surface:** `public/app.js`, `public/style.css`, existing session/workspace
  data only unless the approved spec is amended, `test/sidebar-layout.test.js`,
  `test/recent-sessions.test.js`, and `test/git-review.test.js`.
- **TiCoder tests:** `node test/sidebar-layout.test.js`,
  `node test/recent-sessions.test.js`, and review-state tests
  - active workspace/session rows retain current keyboard/switch behavior;
  - metadata truncates with a full accessible label/title;
  - no-switch mode hides switching controls without breaking active context;
  - workspace/session changes clear or reconcile selected review files and branch
    metadata;
  - long names/previews do not expand the sidebar or create horizontal scroll.
- **Depends on:** C1, C2, and C5.

### C7 — Link compact tool activity to review targets

- [x] Add low-noise, accessible actions to tool activity only when a reliable
      workspace-relative file target is present. The action SHALL open/focus the
      existing Changes surface and select the target; ordinary grouped tool rows
      remain compact and unchanged.
- **FR/goal:** FR-18–FR-21, FR-31–FR-32; PG-3.
- **Change surface:** pure target helper from C1, tool-group rendering in
  `public/app.js`, small styles, `test/git-review.test.js`,
  `test/transcript-layout.test.js`, and possibly `test/tool-protocol.test.js`.
- **TiCoder tests:** `node test/git-review.test.js` and
  `node test/transcript-layout.test.js`
  - safe file-bearing tool events receive one correctly named review action;
  - ambiguous, outside-workspace, or pathless events receive no misleading action;
  - grouped tool activity remains collapsed/compact by default;
  - action activation preserves tool expansion/error/duration state and targets
    the selected review file.
- **Depends on:** C1, C3, and C4.

### C8 — Implement responsive active-pane and composer behavior

- [x] Extend the existing rail/drawer/sheet semantics so narrow screens expose one
      active surface at a time, desktop review panels remain readable, and composer
      actions wrap or use the existing overflow affordance. Preserve current focus
      restoration and persisted `pi:rail` behavior.
- **FR/goal:** FR-22, FR-23, FR-24, FR-25, FR-26, FR-27, FR-28, FR-29, FR-30, FR-31; PG-4 and PG-5.
- **Change surface:** `public/app.js`, `public/style.css`, any required semantic
  hooks, `test/composer-layout.test.js`, `test/sidebar-layout.test.js`,
  `test/rail-resize.test.js`, `test/shell-layout.test.js`, and
  `test/a11y-contract.test.js`.
- **TiCoder tests:** run the four layout/a11y tests above
  - wide transcript/composer/review widths remain bounded and readable;
  - mid/narrow panes transform into the existing drawer/bottom-sheet model;
  - entering drawer mode closes an obstructive persisted desktop sidebar;
  - frequent composer actions remain reachable and lower-frequency actions do not
    clip;
  - opening/closing/switching a pane restores focus and Escape behavior.
- **Depends on:** C3, C5, and C6.

### C9 — End-to-end compatibility and browser verification

- [x] Run the complete existing test suite, add focused contract checks for the
      final selectors/API assumptions, and perform live browser verification at
      wide and narrow viewport sizes. Resolve console, overflow, stale-state,
      focus, and permission regressions before final verification.
- **FR/goal:** FR-9–FR-13, FR-20–FR-21, FR-26, FR-29–FR-34; all plan goals.
- **Change surface:** `test/a11y-contract.test.js`, `test/contrast.test.js`,
  `test/trust-boundary.test.js`, relevant existing tests, and the Phase 4 browser
  smoke checklist. No new product behavior should be added in this chunk.
- **TiCoder tests/commands:**
  - `node --check public/app.js`;
  - all `node test/*.test.js` files;
  - focused Git/review/layout/permission tests;
  - actual browser open/snapshot/screenshot at desktop and narrow sizes;
  - browser console check with no new errors;
  - manual keyboard pass for rail trigger, file row, diff, refresh, close, and
    mutation confirmation.
- **Depends on:** C1–C8.

## Chunk Checkpoints

### C1 — completed

- Added `public/git-review.js` with guarded dual-mode exports for snapshot/file
  normalization, review states, selection reconciliation, and conservative
  workspace-relative tool targets.
- Added `test/git-review.test.js`; it failed before the module existed and now
  passes with 4 assertions groups.
- Added the asset to `server.js`'s static whitelist and loaded it before `app.js`.
- Verification: `node --check public/git-review.js`,
  `node test/git-review.test.js`, and targeted diagnostics are clean.

### C2 — completed

- `git.js` now preserves rename source paths and staged/unstaged/untracked
  porcelain flags, returns additive snapshot summary/file metadata, and exposes
  bounded diff results as `unavailable: "oversized"` without changing mutation
  commands or path validation.
- Extended `test/git.test.js`; the new assertions failed before the exports were
  added and now pass with 43 total checks.
- Verification: `node test/git.test.js`, `node --check git.js`,
  `node --check server.js`, a live `getGitSnapshot(process.cwd())` smoke check,
  LSP diagnostics, and targeted lens diagnostics are clean.

### C3 — completed

- Extended the existing Git rail only: it now renders a summary header,
  staged/unstaged/untracked counts, internal Changes/Files tabs, branch and
  clean/unavailable/error states, and bounded file rows without adding a second
  persisted navigation system.
- Added `test/git-review-contract.test.js`; it was red before the tab/state
  hooks existed and now passes with 8 checks. Existing `test/rail.test.js`
  passes with 70 checks.
- Verification: `node --check public/app.js`, focused contract/rail tests,
  LSP diagnostics, and targeted lens diagnostics are clean.

### C4 — completed

- Added pure `reviewDiffState` classification for ready, stale, binary,
  oversized, deleted, unavailable, and failed responses. The Git rail now keeps
  selected path/commit state, invalidates stale diff requests, shows read-only
  path/status metadata, and provides back plus refresh/reconcile controls.
- Extended `git.js`/`/api/git/diff` additively for deleted/renamed/untracked
  review, binary/deleted/unavailable outcomes, and bounded output; mutation and
  path-validation flows remain unchanged.
- Extended `test/git-review.test.js` and `test/diff-contract.test.js`; the new
  assertions were red before the C4 hooks and now pass (5 helper groups, 16
  contract checks).
- Verification: `node --check public/app.js`, `node --check git.js`, focused
  review/diff tests, LSP diagnostics, and targeted lens diagnostics are clean.

### C5 — completed

- Added a compact clickable `#sb-git` header context using the existing health
  endpoint: repository path is title-accessible, branch and staged/unstaged/
  untracked counts are shown, detached/clean/unavailable states are explicit,
  and activation opens the existing Git rail.
- Extended `test/shell-layout.test.js`; the new shell assertions now pass with
  34 checks. Focused review and rail contracts remain green.
- Verification: `node --check public/app.js`, shell/review/rail tests, LSP
  diagnostics, and targeted lens diagnostics are clean.

### C6 — completed

- Workspace/session rows now expose bounded full-path/session metadata through
  titles, accessible labels, and data attributes while preserving active,
  disabled, switching, no-switch, recency, and preview behavior.
- Added explicit unavailable metadata states and `resetGitReviewState()` on
  workspace/session transitions so old branch/file selections cannot leak.
- Extended `test/sidebar-layout.test.js`; it now passes with 29 checks, and the
  existing session reader remains green with 35 checks.
- Verification: `node --check public/app.js`, sidebar/session tests, LSP
  diagnostics, and targeted lens diagnostics are clean.

### C7 — completed

- Added a conservative `Open in Changes` action to tool cards only when
  `reviewTargetFromTool` accepts a reliable workspace-relative path. The action
  keeps grouped tool cards compact, opens the existing Git rail, and selects the
  target after the generation-stamped snapshot arrives.
- Extended `test/transcript-layout.test.js`; it now passes with 17 checks. Pure
  target/review tests and rail contracts remain green.
- Verification: `node --check public/app.js`, focused transcript/review/rail tests,
  LSP diagnostics, and targeted lens diagnostics are clean.

### C8 — completed

- Narrow rail/workspace surfaces are now mutually exclusive: opening one closes
  the other, while existing bottom-sheet/drawer focus and Escape semantics stay
  intact. Primary composer buttons are non-shrinking and lower-frequency actions
  keep the existing narrow overflow popover.
- Extended composer, shell, rail-resize, and a11y contracts; they pass with
  18, 37, all rail-resize assertions, and the existing a11y contract green.
- Verification: `node --check public/app.js`, focused layout/a11y tests, LSP
  diagnostics, and targeted lens diagnostics are clean.

## Dependency Graph

```text
C1 ──▶ C2 ──▶ C3 ──▶ C4 ──▶ C7 ──▶ C9
│       │       │       └────▶ C8 ───┘
│       └────▶ C5 ──▶ C6 ─────┘
└──────────────────────▶ C5
```

## TiCoder Test Suite Summary

| Test surface | Requirements covered |
| --- | --- |
| `test/git-review.test.js` (new) | FR-1–FR-3, FR-6, FR-8, FR-11–FR-13, FR-17, FR-19–FR-21, FR-32 |
| `test/git-review-contract.test.js` (new) | FR-1, FR-4–FR-8, FR-20, FR-31–FR-33 |
| `test/git.test.js` | FR-2, FR-3, FR-6, FR-10–FR-13, FR-33 |
| `test/diff-contract.test.js` | FR-7, FR-9–FR-12, FR-21, FR-34 |
| `test/shell-layout.test.js` | FR-1–FR-4, FR-22, FR-27, FR-30–FR-31 |
| `test/sidebar-layout.test.js` / `test/recent-sessions.test.js` | FR-14–FR-17, FR-24, FR-32 |
| `test/transcript-layout.test.js` / `test/tool-protocol.test.js` | FR-18–FR-21 |
| `test/composer-layout.test.js` / `test/rail-resize.test.js` | FR-22–FR-30 |
| `test/a11y-contract.test.js` / `test/contrast.test.js` | FR-20, FR-26, FR-30–FR-31, FR-34 |
| `test/trust-boundary.test.js` | FR-10, FR-13, FR-21, FR-33 |
| Live browser smoke + console check | FR-22–FR-34 and visual success criteria |

### C9 — completed

- Ran the complete suite (`npm test`): all 65 test files exited 0. The focused
  Git/review/layout/a11y/permission checks and `node --check public/app.js` also
  pass; `git diff --check` is clean.
  - **Tests:** `node test/git-review.test.js`, `node test/git-review-contract.test.js`, `node test/git.test.js`, `node test/diff-contract.test.js`, `node test/shell-layout.test.js`, `node test/sidebar-layout.test.js`, `node test/composer-layout.test.js`, `node test/rail-resize.test.js`, `node test/a11y-contract.test.js`, `node test/contrast.test.js`, `node test/trust-boundary.test.js`, `node test/transcript-layout.test.js`, and `npm test` — PASS.
  - **Compliance:** C9 satisfies the plan's final compatibility, responsive, accessibility, safety, and regression gates; all C1–C8 dependencies are checked off. ✓
- Live smoke on a fresh temporary server confirmed `/api/health`, the `dev ~16 ?8`
  Changes review control, Git rail tab, empty-state composer, and zero browser
  console entries. The existing server on port 4317 was preserved and still
  returns the expected health payload.
- Edited-file LSP/blocking diagnostics are clean. The project-wide scan still
  reports pre-existing extension/type and service-worker findings outside this
  feature; they are not introduced by the Git review workspace.

## Proposed Initial-Failure Check

Before Phase 4 implementation, the new `git-review` and contract assertions should
fail because the review-state seam, contextual controls, and new interactions do
not yet exist. Existing tests should continue to pass until their new assertions
are added. A test that passes without exercising the intended new behavior must be
revised before coding begins.

## Approval Gate

Approve this implementation plan and TiCoder test suite before any source-file
implementation begins. After approval, execute C1 through C9 one chunk at a time.
