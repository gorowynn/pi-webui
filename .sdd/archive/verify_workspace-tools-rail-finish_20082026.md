# Verification Report — Finish the Workspace-Tools Rail

- **Date:** 20 August 2026
- **Plan:** [`plan_workspace-tools-rail-finish_20082026.md`](plan_workspace-tools-rail-finish_20082026.md)
- **Specification:** [`spec_workspace-tools-rail-finish_20082026.md`](spec_workspace-tools-rail-finish_20082026.md)
- **Tasks:** [`tasks_workspace-tools-rail-finish_20082026.md`](tasks_workspace-tools-rail-finish_20082026.md)
- **Status:** verified complete and archived; all 44 repository test files pass and the live Edge smoke passes.

## Chunk Evidence

### Chunk 1 — Canonical rail preference and migration

- `public/rail.js` normalizes and migrates `{widget,open,width}` through the
  single `pi:rail` record. `pi:sddbar` and `pi:rail-width` remain read-only
  migration inputs; invalid storage and widths fail safely.
- `public/app.js` persists resize changes through the same rail-state seam.
- `node test/rail.test.js` — **pass** (70 checks).
- `node test/rail-resize.test.js` — **pass**.

### Chunk 2 — Narrow sheet focus lifecycle

- `public/app.js` adds deterministic focus entry, document-level Tab/
  Shift+Tab containment, Escape handling, dialog semantics, and trigger
  restoration only for the existing `w-mid`/`w-narrow` modes.
- `node test/a11y-contract.test.js` — **pass**.
- Edge CDP smoke at 480×900 — **pass**: the active rail has `role="dialog"`,
  focus enters `#tools-close`, Tab remains inside the sheet, Escape closes it,
  and focus returns to a rail button.

### Chunk 3 — Parity-gated command routing

- Analysis, Git, Quotas, and Todos command entries now route through
  `openRailWidget`; Permissions remains a dedicated-page launcher.
- Analysis/Git shared renderers, clickable jumps, Git confirmation handlers,
  quota no-API state, and tool-owned Todo state remain in place.
- `node test/rail.test.js`, `test/git.test.js`, `test/session-analysis.test.js`,
  `test/permission-ux.test.js`, `test/permissions-ux.test.js`, and
  `test/safeguard-contract.test.js` — **pass**.

### Chunk 4 — Parity completion and chrome/documentation cleanup

- Removed the retired Analysis/Git modal/detail routes and stale parity flags.
- Removed `sb-git`, `sb-tok`, and `sb-cost`; repository, model, thinking, cache,
  IDE, and per-turn usage context remain.
- Reconciled `AGENTS.md`, `GOTCHAS.md`, `docs/design.md`, `docs/plans.md`,
  `docs/roadmap.md`, `docs/improvements.md`, `docs/pi-livecraft.md`, and
  `CHANGELOG.md` with `#toolsbar`, `rail.js`, `pi:rail`, the narrow sheet, and
  rail-only Quotas/Todos.
- `node test/usage-telemetry-layout.test.js` — **pass** after replacing its
  retired modal assertion with the final Analysis rail contract.
- Edge CDP smoke at 1440×1000 — **pass**: desktop rail renders in tablist mode
  and a screenshot was captured.

### Chunk 5 — Terminal verification and archive

- This report maps FR-1..FR-12 below.
- Complete suite, syntax checks, LSP diagnostics, server health/static/SSE
  smoke, and `git diff --check` all pass.
- The plan, specification, tasks, and this report are archived together in
  `.sdd/archive/`.

## Requirement Traceability

| Requirement | Evidence |
| --- | --- |
| FR-1 | `test/a11y-contract.test.js`, `test/shell-layout.test.js`, and Edge CDP 480×900 bottom-sheet smoke. |
| FR-2 | `test/a11y-contract.test.js` focus-entry/restore and Tab/Escape source contracts; live Edge focus entry, Tab containment, Escape close, and rail-button restoration. |
| FR-3 | `test/a11y-contract.test.js` dialog labels and responsive CSS; Edge CDP narrow viewport. |
| FR-4 | `test/rail.test.js` persistence round-trip, legacy migration, corrupt/invalid values, width clamping, and canonical-save assertions. |
| FR-5 | `test/rail.test.js` generation-staleness checks plus the generation guards in Git/Quota widget contracts. |
| FR-6 | `test/rpc-sse.test.js`, `test/sse-transport.test.js`, `test/status-race.test.js`, and live `/api/events` connection smoke; no new wire fields. |
| FR-7 | `test/rail.test.js` final command-routing and widget-table checks; `test/git.test.js`, `test/session-analysis.test.js`, and Edge desktop/narrow rail smoke. |
| FR-8 | Git, session-analysis, quota, Todo, permission, and safeguard contract tests; shared renderer and confirmation-gate assertions in `test/rail.test.js`. |
| FR-9 | `test/a11y-contract.test.js` asserts retired status IDs are absent; `test/rail.test.js` asserts no modal/detail fallback and the remaining per-turn usage path. |
| FR-10 | `test/rail.test.js` keeps Permissions outside `WIDGET_IDS` and checks the `#permissions` launcher; live shell smoke confirms the rail remains separate. |
| FR-11 | `AGENTS.md`, `GOTCHAS.md`, `docs/design.md`, `docs/plans.md`, `docs/roadmap.md`, `docs/improvements.md`, `docs/pi-livecraft.md`, and `CHANGELOG.md` now describe the final rail contract. |
| FR-12 | 44/44 `test/*.test.js` files pass; `node --check public/app.js`, `node --check public/rail.js`, LSP diagnostics, `git diff --check`, server health/static/SSE smoke, and Edge CDP desktop/narrow smoke pass. |

## Smoke Evidence

| Surface | Result |
| --- | --- |
| Standalone server | `GET /api/health` → 200; `GET /` → 200 with the missing-pi smoke child; `/api/events` → 200, `text/event-stream`, initial `: connected` frame. |
| Desktop browser | Edge CDP at 1440×1000; rail opened in desktop tablist mode; screenshot capture returned 72,504 base64 characters. |
| Narrow browser | Edge CDP at 480×900; `role="dialog"`, focus entered `#tools-close`, Tab remained inside, screenshot capture returned 64,152 base64 characters, Escape closed the sheet and restored a button focus. |
| Keyboard and resize | `test/a11y-contract.test.js` and `test/rail-resize.test.js` pass; WAI separator metadata and keyboard resize behavior remain covered. |
| Reconnect/SSE | `test/sse-queue.test.js`, `test/sse-transport.test.js`, `test/rpc-sse.test.js`, and `test/livebuf.test.js` pass; live SSE initial-frame smoke passes. |
| Widget parity | `test/rail.test.js` (70), Git (37), session analysis (54), permission/todo/safeguard contracts, and the complete suite pass. |

## Verification Commands

- `node test/*.test.js` (executed sequentially) — **44/44 files passed**.
- `node --check public/app.js` — **pass**.
- `node --check public/rail.js` — **pass**.
- `git diff --check` — **pass**.
- Primary LSP diagnostics for edited JS/test files — **0 findings**.
- Standalone server health, static shell, and SSE connection smoke — **pass**.
- Edge CDP desktop/narrow rail smoke — **pass**.

## Changed Files

- `public/app.js`
- `public/index.html`
- `public/rail.js`
- `public/style.css`
- `test/rail.test.js`
- `test/a11y-contract.test.js`
- `test/usage-telemetry-layout.test.js`
- `AGENTS.md`
- `GOTCHAS.md`
- `CHANGELOG.md`
- `docs/design.md`
- `docs/plans.md`
- `docs/roadmap.md`
- `docs/improvements.md`
- `docs/pi-livecraft.md`
- SDD plan/spec/tasks/verification artifacts

## Residual Risks / Follow-up

- No known runtime, accessibility-contract, parity, or documentation blocker
  remains for W1. The report records screenshot byte counts rather than keeping
  generated browser images in the repository; the focused source contracts and
  live Edge interactions provide the repeatable evidence.
