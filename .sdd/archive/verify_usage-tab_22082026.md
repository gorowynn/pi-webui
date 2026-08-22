# Verify — Usage Tab Restructure (`usage-tab`)

Date: 22.08.2026 · terminal verification · all chunks `[x]`

## FR → evidence

| FR | Behavior | Evidence | Result |
|----|----------|----------|--------|
| FR-1 | Panel order: headline → notices → bars → tokens → lists → PERFORMANCE | `analysisBody` structure (app.js); layout-test literals | ✅ |
| FR-2 | Exactly 4 headline cards; failures rate at ≥ 5 calls | `stat("total"/"context"/"cache-hit"/"failures")`; `stat("turns")` absence asserted | ✅ |
| FR-3 | 12 telemetry cards in collapsed `<details>`; open state survives re-render | `anTelOpen` + toggle listener in `analysisRender` (E7) | ✅ |
| FR-4 | Metric selector, `pi:an-metric` persistence, fallback chain, disabled+reason | METRICS table + guarded read/write; 9 layout assertions | ✅ |
| FR-5 | Bars normalized to shown max; overlay suppressed on metric=context | `showOverlay` gate; `peak` any metric | ✅ |
| FR-6 | Rail default 20 bars, show-all toggle (module-scope), cap 100 kept | `capped` → `slice(-20)`; `anShownAll` | ✅ |
| FR-7 | Legend under bars; context entry conditional | `an-legend` + swatches; sub-header hint removed | ✅ |
| FR-8 | Bar click/Enter → persistent readout + Jump; click-again deselects; E5 auto-clear | `.an-bar` wiring; `anSelected`; readout row | ✅ |
| FR-10 | `sessionNotices` thresholds/ordering/tones pure + rendered tone-mapped | 15 unit tests + render assertions | ✅ |
| FR-11 | No clickable-but-inert rows | static `.an-row` divs; `jump(-1` paths gone (asserted) | ✅ (naming deviation noted below) |
| FR-12 | Honest units for tool output size | `formatChars` unit tests + `SA.formatChars` render path | ✅ |
| FR-13 | Dead `an-card` CSS removed; contract literals updated | `doesNotMatch /an-card/`; sidebar-layout + usage-telemetry-layout updated | ✅ |

## Plan goals → result

- **BG1/SC1** answer-first: 4 cards + chart lead ✅
- **BG2/SC3** explainability: readout + legend ✅
- **BG3/SC2** metric control persisted ✅
- **BG4/SC4** proactive notices ✅
- **BG5/SC5/SC6** correctness + density ✅
- **BG6/SC7** zero-build intact; 53/53 test files green ✅

## Deviations (accepted)

1. **`.an-row` instead of `.an-item-static`** — the a11y hover-twin contract
   flags any `:hover` rule on a non-focusable class; static rows got their own
   class with no hover rule. Semantics unchanged.
2. **Turns headline card dropped** — within FR-2's "exactly 4"; turn count
   remains visible in the TURN HISTORY sub-header.

## Test totals

`node test/session-analysis.test.js` 69 passed (15 new) ·
`node test/usage-telemetry-layout.test.js` pass (38 new/updated literals) ·
full suite **53/53 files**.

## Residual (manual)

SC8 visual pass across dark/paperlike + narrow sheet left to the user's smoke;
page load verified console-clean on the live server.
