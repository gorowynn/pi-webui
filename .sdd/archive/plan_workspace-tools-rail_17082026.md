# Plan — Unified workspace-tools rail (W1)

Date: 17 Aug 2026 · Source: docs/roadmap.md §5 W1, docs/plans.md §4 Phase B

## Problem Statement

Inspection surfaces compete for space and attention. Git status, session
analysis, quotas, SDD phase state, and agent todos each live in a separate
modal (or in footer/statusbar detail), while the SDD stepper already owns a
dedicated right rail (`#sddbar`). Users must remember five entry points;
modal state is lost on close; statusbar duplicates detail that belongs in a
persistent surface; and there is no single place that answers "what needs my
attention?" (pending approvals, config errors, SDD phase).

## Business Goals

1. **One persistent inspection surface** — all five widgets (SDD, Git,
   Analysis, Quotas, Agent Todos) share one resizable rail + panel instead of
   competing modals.
2. **Attention routing** — badges (pending approvals, config errors, widget
   state) visible without opening anything; Permissions gets a badge +
   launcher to its dedicated page (never squeezed into the rail).
3. **Discoverability** — every widget reachable via rail click, command
   palette, and keyboard.
4. **Responsiveness without loss** — narrow viewports get a focus-trapped
   drawer/bottom sheet, not obscured content.
5. **Calmer chrome** — remove migrated detail from statusbar/header once the
   rail covers it (no triple duplication).

## Constraints

- **Zero-build invariant** — vanilla JS/CSS edits only; a small pure rail-state
  module is allowed only if it materially reduces app.js state risk.
- **Fixed widget table** — explicit registry (ID, label, icon, badge provider,
  render/open, refresh policy, command ID); no runtime plugin marketplace.
- **Migration order is risk-ordered** (B2): SDD → Analysis → Git → Quotas →
  Agent Todos; each widget keeps its modal path until the rail version passes
  desktop, narrow-drawer, reconnect, and keyboard smokes.
- **Modal fallback retained** per widget until parity; duplicate modal entry
  removed only after parity.
- **Mutation semantics unchanged** — Git commit/push/discard keep current
  confirm gates; Todos keep tool-owned canonical state (todo.ts mirror).
- Phase A splitter contract reused for resize; width/persist behavior must not
  regress existing a11y tests.

## Success Criteria (Phase B exit gate)

- All five widgets reachable by rail, command palette, and keyboard.
- Permissions launcher reaches the full `#permissions` page and announces
  pending/config-error state.
- Active widget, width, and collapse state persist across reloads (separately).
- Narrow content renders as a focus-trapped drawer; focus returns to the rail
  trigger on close; badges are icon + text, never color-only.
- Old SDD/Todo/Git behavior unchanged (smoke-verified per migration).
- No status detail remains duplicated in three surfaces.
- Lazy-fetch for Git/quota/analysis data; stale responses ignored.

## Out of scope

- Runtime plugin marketplace / dynamic widget registration.
- Squeezing the structured permissions rule editor into the rail panel.
- New Git mutations (that is G1/C2), transcript search, JetBrains routing (J1).
