# Specification — Finish the workspace-tools rail

Date: 20 August 2026
Plan: `.sdd/plan_workspace-tools-rail-finish_20082026.md`

## User Stories

1. As a narrow-window user, I want the selected workspace tool to behave as a
   contained sheet so it never traps or permanently covers the composer.
2. As a keyboard or assistive-technology user, I want predictable entry, tab
   navigation, Escape, and focus restoration for every rail widget.
3. As a returning user, I want the selected widget, open state, and width to
   restore from one stable preference without legacy or corrupt storage breaking
   the page.
4. As a user, I want the command palette and visible rail to agree about where
   Analysis, Git, Quotas, and Todos open, with no stale duplicate status chrome.
5. As a maintainer, I want the final behavior and verification evidence reflected
   in the project guidance and archived SDD record.

## Functional Requirements

### Narrow presentation and focus

- **FR-1 — Contained narrow sheet.** In the existing narrow content-width modes,
  opening a widget must present its panel as a contained, dismissible sheet while
  retaining an accessible rail trigger strip. The sheet must not permanently
  obscure or disable the composer after dismissal.
- **FR-2 — Focus lifecycle.** Opening a widget stores the originating rail tab,
  moves focus into the sheet at a deterministic heading or first actionable
  control, keeps Tab/Shift+Tab within the active sheet while it is open, and
  restores focus to the originating tab on close, Escape, and supported error
  completion. If the originating tab disappeared, focus falls back to the first
  visible rail tab. Existing desktop tablist behavior remains unchanged.
- **FR-3 — Responsive semantics.** The sheet exposes an appropriate labelled
  dialog-like boundary without invalid nested interactive roles; the close action
  remains keyboard and touch reachable; the behavior respects reduced motion and
  the existing width-mode breakpoints.

### State and data safety

- **FR-4 — Canonical persistence.** The canonical `pi:rail` preference contains
  `{ widget, open, width }`. Widget IDs are limited to `sdd`, `analysis`, `git`,
  `quotas`, and `todos`; unknown IDs, invalid booleans, invalid widths, corrupt
  JSON, unavailable storage, and out-of-range values fail closed or clamp without
  throwing. Existing `pi:sddbar` and `pi:rail-width` data migrate compatibly
  when `pi:rail` is absent, with no loss of a valid saved width.
- **FR-5 — Stale-response safety.** Every widget open has a generation identity.
  Async responses from an earlier open, a close, or a workspace switch must not
  mutate the currently mounted panel, badges, or focus state.
- **FR-6 — Workspace/reconnect behavior.** SSE reconnect, snapshot refresh, and
  workspace switch preserve the existing server/browser contracts. Open widgets
  re-render from current client state, workspace-scoped badges reset when the
  workspace changes, and no widget introduces a new API or RPC wire field.

### Parity and chrome

- **FR-7 — Rail parity gate.** Analysis, Git, Quotas, and Todos each retain their
  current behavior, confirmation gates, empty states, and canonical client state
  when rendered in the rail. A command route switches to the rail only after its
  desktop, narrow-sheet, reconnect, and keyboard smoke evidence passes. Until
  then, an explicitly documented legacy fallback may remain; no route may
  silently bypass its declared parity state.
- **FR-8 — Widget-specific behavior.** Analysis keeps its existing cost/token/
  tool math and clickable transcript jumps; Git keeps diff, commit, push, and
  discard confirmation semantics; Quotas keeps its no-API dashboard note and
  compact warning signal; Todos keeps tool-owned state and its all-finished
  visibility semantics. The current project contract keeps Todos and quota
  detail in their rail widgets rather than reintroducing the removed in-flow
  todo panel or header usage bar.
- **FR-9 — Chrome de-duplication.** Once the corresponding parity route is
  switched, Git change detail and Analysis token/cost detail no longer render in
  the header statusbar. Repository, model, thinking, cache, and IDE context may
  remain; per-turn usage strips remain. No stale placeholder value or duplicate
  detail remains in a retired slot.
- **FR-10 — Permissions separation.** Permissions remains a dedicated page and
  rail launcher, not a widget entry. Its pending/config-health indicator and
  existing broker behavior remain unchanged.

### Documentation and verification

- **FR-11 — Source-of-truth alignment.** Update the project file map, rail
  gotchas, design notes, and changelog so they describe `#toolsbar`, `rail.js`,
  the canonical persistence key, narrow-sheet behavior, parity gates, and the
  rail-only Todos/Quotas contract. Remove stale SDD-only references.
- **FR-12 — Evidence gate.** Add or update dependency-free tests for persistence,
  focus lifecycle, parity routing, and static accessibility contracts. Run the
  focused rail suite, all repository tests, diff hygiene, and documented manual
  smokes for desktop, narrow, reconnect, and keyboard behavior before writing
  the terminal verification artifact.

## Data Models

### Rail preference

```text
pi:rail → {
  widget: "sdd" | "analysis" | "git" | "quotas" | "todos" | null,
  open: boolean,
  width: number
}
```

`pi:sddbar` and `pi:rail-width` are legacy inputs only; successful loads write
one canonical `pi:rail` record. Width remains clamped to the existing rail and
transcript-floor limits.

### Focus session

```text
activeRailFocus → {
  widgetId: known widget ID,
  trigger: current rail button or null,
  closeReason: open | escape | button | error | workspace-change
}
```

This is transient browser state and is never persisted or sent to the server.

### Parity state

```text
parity → {
  analysis: pending | verified,
  git: pending | verified,
  quotas: pending | verified,
  todos: pending | verified
}
```

The implementation may keep this as source-level migration flags; it must not
claim verified parity without the required smoke evidence.

## Edge Cases

- A narrow sheet opens while its originating tab is removed by SDD archival or
  a permissions route; close and focus fall back to the first visible tab.
- A user reloads with a corrupt `pi:rail`, an unknown widget, a legacy-only
  preference, or a width above the current transcript-floor cap.
- Storage is unavailable in private browsing; the rail remains usable in-memory.
- An async Git or quota response arrives after switching widgets, closing the
  rail, reconnecting, or changing workspaces.
- A widget contains a long scrollable analysis, diff, or todo list; re-rendering
  must preserve scroll where safe and must not move focus unexpectedly.
- Reduced-motion users must not receive a required animation for access or
  dismissal.
- A user invokes a legacy palette command during migration; the documented
  fallback must be deterministic and must not open two surfaces.

## Non-goals

- New Git operations, permissions editing, JetBrains routing, transcript search,
  composer redesign, or a framework/runtime widget registry.
- Cross-tab synchronization of the active widget; only the persisted preference
  shape is shared.
