# Implementation Tasks — Finish the workspace-tools rail

Date: 20 August 2026
Plan: `.sdd/plan_workspace-tools-rail-finish_20082026.md`
Spec: `.sdd/spec_workspace-tools-rail-finish_20082026.md`

Chunks are ordered and independently verifiable. No implementation chunk starts
until this task/test plan is approved.

## [x] Chunk 1 — Canonical rail preference and migration

**Requirements:** FR-4, FR-5, FR-6

- Extend the existing `public/rail.js` state seam so `pi:rail` is the sole
  persisted `{widget, open, width}` record while accepting legacy
  `pi:sddbar`/`pi:rail-width` inputs once.
- Keep unknown widgets, corrupt JSON, unavailable storage, invalid widths, and
  transcript-floor clamps fail-safe and preserve the current widget/generation
  behavior.
- Make `app.js` resize persistence use the same state seam rather than silently
  maintaining a second canonical width key.

**TiCoder tests:**

- `test/rail.test.js` — round-trip includes width; legacy width migrates; invalid
  width/widget/open values fail safely; saves normalize to one `pi:rail` record;
  generation invalidates old opens (# FR-4, FR-5).
- Existing `test/rail-resize.test.js` and full shell/a11y contracts remain green
  (# FR-4).

**Chunk 1 compliance:** `public/rail.js` now normalizes and migrates the
canonical `{widget, open, width}` preference, while `app.js` writes resize width
through the same seam. `rail.test.js` passes 70 final checks; resize and a11y
regressions pass. ✓

## [x] Chunk 2 — Narrow sheet focus lifecycle

**Requirements:** FR-1, FR-2, FR-3

- Add the smallest browser-side focus lifecycle needed by the existing
  `#toolsbar`: remember the originating tab, focus the sheet heading/first
  action, cycle Tab/Shift+Tab within the active narrow sheet, and restore focus
  on close/Escape/fallback.
- Apply the behavior only in the current narrow content-width modes; preserve
  desktop rail/tablist behavior, reduced-motion behavior, scroll preservation,
  and the existing close button.
- Expose the sheet's label and dialog-like semantics without nesting invalid
  interactive roles or changing server/API contracts.

**TiCoder tests:**

- `test/a11y-contract.test.js` — narrow sheet boundary, labelled title, focus
  entry/restore, Tab and Shift+Tab cycle, Escape close, fallback trigger, and
  no-permanent-obscuring contract (# FR-1, FR-2, FR-3).
- Add a focused pure/source contract only if the existing a11y seam cannot cover
  the focus-cycle edge cases; do not add a DOM framework (# FR-2).

**Chunk 2 compliance:** Narrow modes now use a bottom-sheet layout with dialog
semantics, deterministic focus entry, Tab/Shift+Tab trapping, Escape handling,
and trigger fallback restoration; desktop tablist behavior remains intact. The
rail/a11y/resize contracts and `node --check public/app.js` pass. ✓

## [x] Chunk 3 — Parity-gated command routing

**Requirements:** FR-7, FR-8, FR-10

- Make all four migrated commands use one explicit parity gate: Analysis, Git,
  Quotas, and Todos must not silently disagree with their declared migration
  state.
- Preserve the existing rail renderers, Git confirmation handlers, analysis
  jump wiring, quota no-API state, todo-owned state, and permissions launcher.
- Record the desktop/narrow/reconnect/keyboard smoke checklist for each widget;
  keep a legacy fallback only where smoke evidence is not yet complete.

**TiCoder tests:**

- `test/rail.test.js` — every migrated command uses the parity router; verified
  and pending paths are deterministic; permissions remains outside the table;
  widget-specific shared renderer/confirmation contracts remain intact
  (# FR-7, FR-8, FR-10).
- Existing `test/git.test.js`, `test/session-analysis.test.js`, and permission/
  todo contract tests remain green (# FR-8).

**Chunk 3 compliance:** All four migrated commands now pass through the explicit
parity router. The verified paths now open the rail for Analysis, Git, Quotas,
and Todos; Permissions remains the dedicated-page launcher. Shared renderers,
Git confirmation handlers, analysis jumps, quota no-API state, and todo-owned
state remain intact. ✓

## [x] Chunk 4 — Parity completion and chrome/documentation cleanup

**Requirements:** FR-7, FR-9, FR-10, FR-11

- After the required widget smokes pass, switch each widget to its rail command
  path and remove dead legacy modal/detail paths and stale migration flags.
- Remove Git/token/cost duplicate status slots while retaining repository, model,
  thinking, cache, IDE, and per-turn usage information.
- Update `AGENTS.md`, `GOTCHAS.md`, `docs/design.md`, and `CHANGELOG.md` for the
  final `#toolsbar`/`rail.js` shape, canonical `pi:rail` state, narrow sheet,
  parity completion, and rail-only Todos/Quotas contract.

**TiCoder tests:**

- `test/rail.test.js` and `test/a11y-contract.test.js` — no stale parity flags,
  all command routes open the rail, no retired status slots, and final shell
  names/ARIA contracts remain present (# FR-7, FR-9, FR-10, FR-11).
- Existing full suite plus `git diff --check` (# FR-12).
- Manual smoke evidence: desktop, narrow sheet, reconnect/SSE drop, keyboard
  navigation, each migrated widget, and permissions launcher (# FR-7, FR-12).

**Chunk 4 compliance:** Parity flags and legacy Analysis/Git detail paths are
removed; command routes open the five-widget `#toolsbar` rail, Quotas/Todos
remain rail-only, and retired Git/token/cost status slots are gone. The
canonical `pi:rail` migration, narrow-sheet focus lifecycle, and accessibility
contracts pass. The full 44-file suite, syntax checks, `git diff --check`,
standalone health/static/SSE smoke, Edge CDP desktop/narrow screenshots with
focus-trap/Escape assertions, and LSP diagnostics are green. Documentation now names `#toolsbar`, `rail.js`, `pi:rail`, the narrow sheet, and the final
Permissions/Todos/Quotas split. ✓

## [x] Chunk 5 — Terminal verification and archive

**Requirements:** FR-11, FR-12

- Re-open the plan/spec, check every chunk's compliance, write
  `.sdd/verify_workspace-tools-rail-finish_20082026.md`, and map FR-1..FR-12 to
  tests and smoke evidence.
- Archive the plan/spec/tasks/verify set only after every chunk is checked and
  the repository is green.

**TiCoder checks:**

- `node test/rail.test.js`
- `node test/rail-resize.test.js`
- `node test/a11y-contract.test.js`
- `node test/*.test.js` (all files)
- `git diff --check`

**Chunk 5 compliance:** Re-opened the approved plan and specification; this
verification report maps FR-1..FR-12 to the final implementation, focused
contracts, complete suite, server/SSE smoke, and live Edge CDP smoke. All five
chunks are checked and the SDD set is archived together. ✓

## Dependencies

```text
Chunk 1 ──▶ Chunk 2 ──▶ Chunk 3 ──▶ Chunk 4 ──▶ Chunk 5
```

## Phase 3 Gate

The task list deliberately separates the persistence contract, narrow focus
behavior, parity routing, and post-smoke cleanup. Approval is required before
source implementation begins.
