# Plan — Finish the workspace-tools rail

Date: 20 August 2026

## Problem Statement

W1 has a working rail shell, persisted widget selection, five widget renderers,
badges, permissions launching, and keyboard-resizable layout. The migration was
archived before its narrow-window accessibility and final parity/cleanup gates
were completed. Users can still encounter an obstructive narrow rail, mixed
modal/rail command behavior, stale duplicate status chrome, and documentation
that describes the former SDD-only rail.

## Business Goals

- Make the existing workspace-tools rail a complete, predictable inspection
  surface without rebuilding its working widgets.
- Keep conversation space primary while making the rail usable at narrow widths
  and with keyboard or assistive technology.
- Finish the migration only after each widget's behavior has a smoke-tested rail
  path, then remove misleading duplicate UI and stale documentation.
- Preserve the current project contract that todos and quota detail live in rail
  widgets, while retaining the compact status information that remains useful.

## Constraints

- Preserve Node 18+, Windows/POSIX support, zero-build vanilla browser code,
  zero runtime dependencies, and existing RPC/SSE/API contracts.
- Reuse the current `#toolsbar`, `public/rail.js`, widget renderers, confirmation
  gates, and client-owned state; do not introduce a framework or runtime widget
  registry.
- No new Git actions, permissions editor in the rail, JetBrains routing, or
  unrelated responsive/composer redesign.
- Follow the SDD gates: no implementation before the approved specification and
  task/test plan; implement one approved chunk at a time.

## Success Criteria

- The active rail widget becomes a focus-contained narrow drawer/sheet when the
  content-width mode requires it; Escape, close, and completion restore focus to
  the originating rail tab and the composer is not permanently obscured.
- Rail state, including selected widget, open state, and width, has one documented
  persistence contract and survives reload/migration without corrupt-state
  crashes.
- Analysis, Git, Quotas, and Todos have verified rail behavior and their command
  routes no longer silently disagree with the parity gate; legacy modal/detail
  paths are removed only after the smoke evidence is recorded.
- Stale Git/token/cost status markup and SDD-only documentation are removed or
  reconciled with the final rail behavior; current todo/quota semantics remain
  documented consistently.
- Focused rail/a11y tests, the full repository suite, `git diff --check`, and the
  required desktop/narrow/reconnect/keyboard smoke evidence pass. A terminal SDD
  verification artifact maps the requirements before archival.
