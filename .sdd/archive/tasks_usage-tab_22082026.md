# Tasks — Usage Tab Restructure (`usage-tab`)

Date: 22.08.2026 · Phase 3 (Implementation Plan & TiCoder Tests) · follows
`spec_usage-tab_22082026.md` (approved). Execute strictly in order; every
chunk is an independently verifiable checkpoint.

File anchors (current): `analysisBody` app.js:6823–7144 · `wireAnalysis`
app.js:7147 · `analysisRender` app.js:7156 · CSS `public/style.css` §
"session-analysis modal" ~3846–4160 · pure module
`public/session-analysis.js` · contract tests
`test/usage-telemetry-layout.test.js`, unit tests `test/session-analysis.test.js`.

## Chunks

### C1 — Pure helpers in session-analysis.js

`sessionNotices(input)` + `formatChars(value)` exported next to the existing
formatters. No DOM, no app.js changes.
Delivers: FR-10 (logic), FR-12 (units), plan BG4/BG5.
Depends on: nothing.

- [x] C1 done
  - Tests: `test/session-analysis.test.js` — 15 new assertions, 69 passed (FR-10, FR-12)
  - Compliance: helper shape/thresholds/ordering/tones match spec FR-10; formatChars
    explicit `chars` unit per FR-12; pure, module-scope only, no DOM. ✓

### C2 — Tools-list correctness in analysisBody

Top-tools rows become static items (no `<button>`, no `data-mi="-1"`); sub-label
uses `formatChars` (or `N failed` when failures exist). Failed-calls rows keep
jump behavior.
Delivers: FR-11, FR-12 (render), plan BG5/SC5.
Depends on: C1 (`formatChars`).

- [x] C2 done
  - Tests: layout test — 7 new assertions, pass; session-analysis 69 pass (FR-11, FR-12)
  - Compliance: tools + indexless failed rows are static divs (`an-item-static`),
    no `jump(-1` path remains; sub-label = `SA.formatChars`. ✓

### C3 — Headline + PERFORMANCE restructure in analysisBody

Replace the 6-card `an-head` + 10-card RECENT TELEMETRY block with: 4 headline
cards (FR-2) → notices slot (empty for now) → existing sections → collapsed
`<details>` PERFORMANCE holding the 12 telemetry cards (10 + avg/median).
`anTelOpen` module var preserves open state across `setSafeHtml` re-renders.
Delivers: FR-1, FR-2, FR-3, plan BG1/SC1.
Depends on: nothing (render order independent of C1/C2).

- [x] C3 done
  - Tests: layout test — 8 new/updated assertions, pass; both suites green
  - Compliance: headline = 4 cards (total primary · context · cache-hit · failures+rate);
    turns card dropped (count lives in TURN HISTORY sub-header per FR-2); 12 telemetry
    cards in collapsed `<details class=an-perf>`; `anTelOpen` toggle wiring in
    analysisRender keeps E7 state. ✓

### C4 — Metric selector + bar heights

`anMetric` module var + `pi:an-metric` persistence; segmented
`Cost | Output | Context` control; FR-4 resolution/fallback order; disabled
options with `title` reason; bars normalized to shown max (FR-5); context
overlay + legend entry hidden when metric = context.
Delivers: FR-4, FR-5, plan BG3/SC2.
Depends on: C3 (selector mounts in the new TURN HISTORY header row).

- [x] C4 done
  - Tests: layout test — 9 new assertions, pass; both suites green
  - Compliance: METRICS {cost,output,context} w/ avail+reason; resolution =
    persisted(available) → cost → output; `pi:an-metric` written on click, guarded
    read; bars = metric.read/maxV (3px min, peak any metric); overlay gated by
    showOverlay (FR-5); cost-missing hint only when output chosen by fallback. ✓

### C5 — Bar window, legend, selected-turn readout

Default `slice(-20)` + `show all` toggle (`anShownAll`, module var); legend row
(FR-7); `anSelected` module var; click/Enter → readout row
`turn N · $cost · out tok · %ctx · tools` + Jump button (reuses
`scrollToMessage`); click-again deselects; auto-clear when the turn leaves the
shown window (E5). Bars stay real `<button>`s (keyboard-native).
Delivers: FR-6, FR-7, FR-8, plan BG2/BG5/SC3/SC6.
Depends on: C4 (metric + normalized bars exist).

- [x] C5 done
  - Tests: layout test — 14 new assertions, pass; both suites green
  - Compliance: capped(100)→slice(-20) with anShownAll toggle; legend (metric +
    conditional context); readout `turn N · $cost · out tok · %ctx · tools` + Jump;
    bar click toggles selection (Enter native), click-again deselects; E5 auto-clear
    at render; wireAnalysis skips .an-bar (bars never double-fire jump+select). ✓

### C6 — Notices render + dead-CSS cleanup + contract pass

Render `sessionNotices(...)` output between headline and TURN HISTORY (tone →
existing semantic classes); delete the `#modal-wrap:has(.card.an-card)` modal
CSS block; final sweep of `test/usage-telemetry-layout.test.js` literals for
everything C2–C6 changed.
Delivers: FR-10 (render), FR-13, plan BG4/BG6/SC4/SC7.
Depends on: C1 (helper), C3 (slot), C5 (final layout frozen).

- [x] C6 done
  - Tests: full suite — 53/53 files pass (incl. updated a11y-contract + sidebar-layout)
  - Compliance: sessionNotices rendered between headline and bars (tone classes,
    guarded for a stale dual-mode module); an-card modal CSS removed; stale literals
    updated. DEVIATION: static rows use class `an-row` (not `an-item-static`) — the
    a11y hover-twin contract forbids a `:hover` rule on a non-focusable class;
    `.an-row` carries the same layout with no hover rule. Semantics unchanged. ✓

## Dependencies

```text
C1 ─▶ C2 ──────────────┐
C1 ─▶ C6 ◀─ C3 ─▶ C4 ─▶ C5
```

(C3 needs no C1/C2 inputs; C6 runs last over the frozen layout.)

## TiCoder Test Suite

All tests assertable via `node <file>`; layout tests are source-contract
assertions (the established pattern for the non-require-able app.js).

### C1 tests — append to `test/session-analysis.test.js` (# FR-10)

- `sessionNotices` returns `context-high` (attention) when `contextPercent = 80` and `= 95` — and NOT at `79` # FR-10
- `context-high` absent when `contextPercent` is `null`/missing # E3
- `tool-errors` (danger) at `failed=1, total=5` (=20%); absent at `failed=1, total=6`; absent at `total=4, failed=4` (min-call gate) # FR-10
- `pending-idle` (attention) at `pendingTools=2, running=false`; absent at `running=true`; absent at `pendingTools=0` # FR-10
- ordering: context-high → tool-errors → pending-idle when all fire # FR-10
- pure: same input → structurally equal output, no mutation of input # FR-10
- `formatChars(8400)` → `"8.4k chars"`; `formatChars(410)` → `"410 chars"`; `formatChars(1200000)` → `"1.2M chars"` # FR-12

### C2 tests — `test/usage-telemetry-layout.test.js` (# FR-11, FR-12)

- app.js top-tools section contains a static row class (e.g. `an-item-static`) and no `jump(-1,` call in the tools block # FR-11
- app.js contains `formatChars(` in the tools sub-label path and NOT `formatTokens(t.outputLength)` # FR-12

### C3 tests — layout test updates (# FR-1, FR-2, FR-3)

- `analysisBody` emits `PERFORMANCE` and a `<details` wrapper; `RECENT TELEMETRY` literal gone # FR-3
- all 12 metric ids still present in source (they moved, not deleted) # FR-3
- headline: exactly 4 `stat(` calls before the bars section (`total`,`context`,`cache-hit`,`failures`) # FR-2
- `anTelOpen` module var read+written (open state survives re-render) # E7

### C4 tests — layout test additions (# FR-4, FR-5)

- `pi:an-metric` read/write present; `anMetric` var; segmented control markup (`an-seg` class) # FR-4
- fallback order literal: persisted→cost→output resolution code present # FR-4 / E2
- disabled-option path (available check + `title`) present # FR-4
- overlay suppression when metric = context (class/conditional on `an-context-line`) # FR-5

### C5 tests — layout test additions (# FR-6, FR-7, FR-8)

- `slice(-20)` default + `show all` toggle var `anShownAll` # FR-6
- legend row markup (`an-legend`) with metric label + conditional context entry # FR-7
- `anSelected` var; readout row (`an-readout`) with Jump button; deselect + auto-clear (E5) branches present # FR-8

### C6 tests — final contract pass (# FR-10, FR-13)

- app.js calls `sessionNotices(` and renders notice tone classes between headline and bars # FR-10
- style.css no longer contains `an-card` # FR-13
- full suite: `node test/session-analysis.test.js` + `node test/usage-telemetry-layout.test.js` green; then `ls test/*.test.js | xargs -n1 node` all green # SC7

## TiCoder Validation Statement

The C1 unit tests express FR-10/FR-12 and currently FAIL (`sessionNotices` /
`formatChars` don't exist). C2–C6 layout assertions currently FAIL (markup
not written). They should fail until each chunk lands. Do they capture the
intended behavior?

---

*Phase 3 artifact. No implementation code until this file is approved.*
