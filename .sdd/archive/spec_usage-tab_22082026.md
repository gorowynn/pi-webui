# Spec — Usage Tab Restructure (`usage-tab`)

Date: 22.08.2026 · Phase 2 (Detailed Specification) · follows
`plan_usage-tab_22082026.md` (approved)

Surface note (verified in code): `analysisBody()` has exactly **one** caller —
the rail panel (`analysisRender`); the "session usage" command opens
`openRailWidget("analysis")` (app.js:8076). The old `an-card` modal is gone;
only its CSS remains. This effort targets the **rail panel only**.

## User Stories

- **U1** — As a user glancing at the Usage panel, I want cost, context,
  cache hit, and failures as the first thing I see, so the session state is
  legible without scrolling past diagnostics.
- **U2** — As a user investigating a spike, I want to switch the bar metric
  between cost / output / context so the chart answers *my* question.
- **U3** — As a keyboard or touch user, I want click/Enter on a bar to
  produce a persistent readout with a Jump action, so I don't depend on
  hover tooltips.
- **U4** — As a user approaching limits, I want deterministic notices
  (context high, tool errors, stuck tools) so I act before compaction or
  quota surprises.
- **U5** — As a user on the ~300px rail, I want readable bars (fewer by
  default) so each bar carries information.
- **U6** — As a user reading the tools list, I want honest units and no
  dead controls, so the panel doesn't mislead me.

## Functional Requirements

### Layout & hierarchy

- **FR-1 Panel order** (top → bottom): headline stats (FR-2) → notices
  (FR-10) → TURN HISTORY (selector FR-4, bars, legend FR-7, readout FR-8) →
  token breakdown → ranked lists (tools / costliest turns / failed calls) →
  PERFORMANCE collapsed section (FR-3).
- **FR-2 Headline** — exactly 4 cards: **total cost** (primary styling),
  **context %**, **cache hit %**, **failures** (`failed/total` count; rate %
  appended when `totalToolCalls ≥ 5`). Each degrades to `—` + state text
  when its input is unavailable (existing `metricCardParts` pattern).
- **FR-3 PERFORMANCE section** — the 10 telemetry cards plus avg/turn and
  median/turn move into a `<details>` (default closed, summary
  `PERFORMANCE`). Open state survives re-renders via module-scope var;
  deliberately **not** persisted to localStorage.

### Bars & metric selection

- **FR-4 Metric selector** — segmented control `Cost | Output | Context`
  beside the TURN HISTORY header. Persisted under `pi:an-metric` ∈
  `{cost, output, context}`. Resolution order: persisted value if currently
  available → `cost` (when `attributedCost > 0`) → `output`. Options whose
  data is unavailable render disabled (visible, with `title` reason).
- **FR-5 Bar heights** — normalized to the max of the *shown* turns for the
  selected metric; min height 3px; the max bar keeps the `peak` class when
  max > 0. When metric = `context`, the amber context overlay is hidden
  (bars already show it).
- **FR-6 Bar count (rail)** — last **20** turns by default; a `show all`
  toggle expands to the existing cap of 100 (label reflects
  `last 20 of N` / `last N`). Toggle state is module-scope only, resets on
  reload.
- **FR-7 Legend** — swatch row under the bars: accent swatch + active
  metric label; amber swatch + `context` when the overlay is visible.

### Selected-turn readout

- **FR-8 Selection & readout** — clicking a bar (or Enter on focused bar)
  selects that turn and renders a readout row under the bars:
  `turn N · $cost · X output tok · Y% context · Z tools` plus a **Jump**
  button that scrolls to the message (existing flash behavior). Clicking
  the selected bar again deselects. Selection = `{messageIndex}` in a
  module-scope var; survives re-renders while the turn remains in the shown
  set, auto-clears otherwise. Failed-call list rows keep their existing
  jump behavior (`data-mi ≥ 0`).

### Notices (pure helper in `session-analysis.js`)

- **FR-10 `sessionNotices(input)`** — pure, dual-mode exported function:
  `sessionNotices({contextPercent, failedToolCalls, totalToolCalls, pendingTools, running})`
  → ordered `[{id, tone, text}]`:
  - `context-high`: `contextPercent ≥ 80` → attention ·
    `Context at N% — compaction soon`
  - `tool-errors`: `failedToolCalls ≥ 1 && totalToolCalls ≥ 5 &&
    failed/total ≥ 0.2` → danger · `Tool errors F/T (P%)`
  - `pending-idle`: `pendingTools ≥ 1 && !running` → attention ·
    `N tool calls pending while idle`
  A notice is absent when its condition is false. Rendered between headline
  and TURN HISTORY, tone-mapped to existing semantic classes.

### Bug fixes

- **FR-11 Tools rows** — top-tools ranked rows become static list items
  (no `<button>`, no `data-mi="-1"`). No clickable-but-inert elements
  remain in the panel.
- **FR-12 Honest units** — tools sub-label shows `F failed` when failures
  exist, else the output size as characters with an explicit unit
  (`12.3k chars` via a formatter; never `formatTokens` on a char count).

### Housekeeping

- **FR-13 Dead surface cleanup + test contract** — remove the modal-only
  CSS (`#modal-wrap:has(.card.an-card)` block); update the source-contract
  assertions in `test/usage-telemetry-layout.test.js` to the new literals
  (`PERFORMANCE`, selector markup, readout row) — assertions are updated,
  not deleted.

## Data Models

- localStorage: `pi:an-metric` → `"cost" | "output" | "context"` (new key,
  follows the `pi:*` convention; no collision with existing keys).
- Module-scope UI state (app.js): `anMetric` (resolved value), `anShownAll`
  (bool), `anSelected` (`messageIndex | null`), `anTelOpen` (bool).
- Notice: `{id: string, tone: "attention"|"danger", text: string}`.
- Reuses unchanged: analysis turn `{messageIndex, number, cost, usage{cacheMiss, cacheRead, cacheWrite, output, cost}, toolCallCount}`, `contextForTurn` derivation, telemetry `metricViews`.

## Edge Cases

- **E1 No turns** (fresh session): headline degrades, bars section shows
  the existing "No completed model turns yet…" hint, selector hidden.
- **E2 Cost unavailable**: cost option disabled (title = reason); FR-4
  fallback applies; persisted `cost` re-falls-back each render until cost
  data exists.
- **E3 `contextWindow` unknown**: context option disabled, overlay + its
  legend entry hidden, context card `—`, `context-high` notice suppressed.
- **E4 Single turn**: bar = 100% height, polyline renders its single dot
  (existing), readout works.
- **E5 Selected turn leaves the shown window** (newer turns push it out,
  or window shrinks back to 20): selection auto-clears.
- **E6 > 100 turns**: existing `slice(-100)` cap retained, then rail
  default `slice(-20)` on top of it.
- **E7 Re-render cadence** (stats refresh ≈ every 10s, message events):
  selection, expanded bar count, and PERFORMANCE open state survive via
  module vars; bar heights update in place.
- **E8 Escaping**: every interpolated dynamic string passes `esc()`
  (GOTCHAS #12).
- **E9 Motion**: no new transitions beyond the existing `.an-bar` hover;
  `prefers-reduced-motion` respected.
- **E10 Theming**: new markup uses existing CSS tokens only (`--accent`,
  `--warning`, `--surface-inset`, `--line`, `--muted`) — no new hex; works
  unchanged in `paperlike`.
- **E11 Idle telemetry**: PERFORMANCE cards may show `—` + reason text
  (existing behavior) — not a regression.

## Non-Goals

Chart libraries, cross-session history views, Quotas widget changes, new
server endpoints, changes to `analyzeSession` cost/token math beyond the
units fix surface.

## Traceability (FR → plan goals)

| FR | Plan goal |
|----|-----------|
| FR-1, FR-2, FR-3 | BG1 (answer-first), SC1 |
| FR-4, FR-5, FR-6 | BG3 (metric control), BG5 (density), SC2/SC6 |
| FR-7, FR-8 | BG2 (explainability), SC3 |
| FR-10 | BG4 (proactive signals), SC4 |
| FR-11, FR-12 | BG5 (correctness), SC5 |
| FR-13 | BG6 (zero-build intact, contract tests), SC7 |

---

*Phase 2 artifact. No implementation code until
`tasks_usage-tab_22082026.md` is approved (Phase 3 gate).*
