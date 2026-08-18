# Spec — Unified workspace-tools rail (W1)

Date: 17 Aug 2026 · Plan: `.sdd/plan_workspace-tools-rail_17082026.md`
Sources: docs/roadmap.md §5 W1, docs/plans.md §4 B1–B3 + exit gate.

## Current state (what migrates where)

| Widget | Today | Entry |
|---|---|---|
| SDD phases | `#sddbar` right rail (stepper + doc pane, resize, persist) | auto (30 s poll) |
| Git | `showGitModal()` modal | palette "git status" |
| Analysis | `showAnalysisModal()` modal | palette "session usage" |
| Quotas | `usageBar` compact chip + detail | chip click |
| Agent todos | `#todopanel` `<details>` in transcript flow | auto (todo tool) |
| Permissions | dedicated `#permissions` page | `#perm-page-btn` |

## User Stories

1. As a user, I want one persistent rail where Git, Analysis, Quotas, SDD and
   Todos live, so I don't hunt five entry points.
2. As a user, I want the rail to keep its widget, width and open/closed state
   across reloads, so it feels like part of the workspace.
3. As a user, I want badges that tell me what needs attention (pending
   approvals, git changes, quota state, SDD phase, open todos) without opening
   anything.
4. As a keyboard user, I want rail widgets reachable by Tab/Arrows, palette,
   and shortcuts, with focus returning to the trigger when I close the panel.
5. As a user on a narrow window, I want the active widget as a bottom sheet,
   not obscured chrome.
6. As a user, I want Permissions to stay a full page — the rail only shows its
   status and launches it.

## Functional Requirements

### Shell

- **FR-1 Fixed widget table.** One explicit registry; each entry:
  `{ id, label, icon, badge(), render(container), onOpen(), onClose(),
  commandId, refresh }` where `refresh ∈ {on-open, interval(ms), manual}`.
  No runtime registration. SDD, Analysis, Git, Quotas, Todos are the five
  entries; Permissions is NOT an entry (FR-7).
- **FR-2 Rail shell.** Generalize `#sddbar`: a 44–48 px icon rail
  (`#tools-rail`) + one active panel (`#tools-panel` with title/body/close).
  Reuse the Phase A splitter: `.rail-resize`, `--rail-width`, 240–720 px
  clamp, transcript-floor cap. Body classes rename `sdd-on/sdd-open` →
  `rail-on/rail-open`.
- **FR-3 One mounted panel.** Switching widgets unmounts the previous panel
  (calls its `onClose`). No widget has unsaved editor input today; if one
  gains it, that widget opts out explicitly in the table.
- **FR-4 Persistence.** `localStorage["pi:rail"] = {widget, open, width}`
  — three independent restores. Unknown/missing widget id → panel closed.
  One-time migration read of legacy `pi:sddbar` (open + width) when
  `pi:rail` is absent.

### Access & badges

- **FR-5 Keyboard + a11y.** Rail buttons form a tab list (`role="tablist"`,
  `role="tab"`, `aria-selected`, roving tabindex, Left/Right arrows); the
  panel is the labelled `tabpanel`. `Esc` closes the panel and returns focus
  to the active tab. Existing a11y-contract tests keep passing.
- **FR-6 Badges.** `badge()` returns `{ text, tone }` (tone ok|warn|err|none)
  rendered as icon/count + accessible text (`aria-label`), never color alone.
  Pure functions; fed by existing client state (git snapshot cache, quota
  tracker, SDD poll, todos mirror, pending approvals).
- **FR-7 Permissions launcher.** A dedicated rail button (outside the widget
  table) showing pending-approval count / config-error state; click routes to
  `#permissions` (hash) — the rule editor never renders in the rail panel.

### Data flow

- **FR-8 Lazy fetch + staleness.** `refresh: on-open` widgets fetch on open,
  not on app boot. Each open stamps a generation counter; a response whose
  generation ≠ current is ignored. `interval` widgets re-fetch only while
  open and visible.

### Responsive

- **FR-9 Narrow drawer.** When the content-width class requires it (same
  breakpoints the modal system uses), the active widget renders as a
  focus-trapped bottom sheet: Tab cycles inside, Esc closes, focus returns to
  the rail trigger. Composer is never permanently obscured (sheet closes).

### Migration & de-duplication

- **FR-10 Order + fallback.** Migrate in order SDD → Analysis → Git → Quotas
  → Todos. Each widget's modal/detail path stays until the rail version
  passes desktop, narrow-drawer, reconnect and keyboard smokes; the duplicate
  palette entry is removed only at parity (the palette name, e.g. "git
  status", switches to opening the rail widget).
- **FR-11 Behavior parity.** SDD: stepper semantics (reached/pending/current
  accent, archive-on-verify hides the rail entry), doc rendering, width.
  Git: list/diff/commit/push/discard with unchanged confirm gates and mutation
  semantics. Analysis: same math/modals-in-panel (bars clickable). Quotas:
  compact warning chip retained in status area; detail moves to the panel.
  Todos: tool-owned canonical state, discipline gate and hide-when-all-done
  behavior unchanged; the transcript `#todopanel` remains the in-flow surface,
  the rail widget is the same data rendered persistently.
- **FR-12 Chrome de-duplication.** After Git parity, `sb-git` leaves the
  statusbar; after Analysis parity, `sb-tok`/`sb-cost` leave (think/cache/
  repo/model/ide stay). Per-turn cost strips stay (turn-scoped, not
  statusbar). No detail in three surfaces at any time.

## Data Models

```js
// widget table entry (static, app.js)
{ id: "git", label: "Git", icon: "⑂", commandId: "git",
  refresh: "on-open",
  badge:  () => gitCache ? {text: `${gitCache.changed} changed`, tone: "warn"} : {text: "", tone: "none"},
  render: (el) => …, onOpen: () => …, onClose: () => … }

// persisted rail state
pi:rail = { widget: "git"|null, open: bool, width: number }
// generation counter: integer, ++ per open; responses carry the gen they
// were issued under; applied only if gen === current.
```

## Edge Cases

- **No SDD set active** → SDD tab hidden (rail entry appears with the first set).
- **Not a git repository** → Git panel shows "not a repository" empty state; badge none.
- **Quota provider without an API** (OpenCode) → panel shows the dashboard note, as today.
- **Todos all done** → `#todopanel` hides (current behavior); rail Todos badge shows none — state kept.
- **Reconnect (SSE drop)** → badges re-evaluate from snapshot; open panel re-renders from cache, refetches per refresh policy.
- **Workspace switch** → rail closes open panels (data is workspace-scoped), badges reset.
- **Two tabs** → width sync via storage event as today; active widget per-tab.
- **Legacy `pi:sddbar`** → migrated once (above), key left in place (harmless).

## Non-goals

Runtime plugin registration; permissions editor in the rail; new Git actions
(G1); JetBrains routing (J1); transcript search (C1).
