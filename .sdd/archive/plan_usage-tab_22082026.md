# Plan — Usage Tab Restructure (`usage-tab`)

Date: 22.08.2026 · Phase 1 (High-Level Plan) · Status: awaiting approval

## Problem Statement

The Usage rail widget buries its answers. Before the turn-history chart — the
panel's most useful element — it renders **16 stat cards** (6 KPI + 10
"recent telemetry"), most of them diagnostics ("pending tools", "headroom")
or blank ("—") early in a session. Hierarchy is inverted: the everyday
questions (*What did this session cost? How much context is left? Did
something fail? Why was that turn expensive?*) get equal or less visual
weight than rate metrics nobody reads at a glance.

Four concrete gaps compound this:

1. **No metric control** — bar height is hardcoded (cost if available, else
   output tokens); context is the only overlay. Users cannot view
   tokens/output per turn when cost exists, or vice versa.
2. **Hover-only detail** — per-turn metadata lives in `title` tooltips and
   the amber context line has no legend; click = jump-to-message and nothing
   else. Keyboard/touch users get nothing.
3. **No derived warnings** — all cards are plain values. Nothing says
   "context ≥ 80%", "tool errors rising", "pending tools stuck" even though
   every input for such notices is already computed.
4. **Two latent bugs** — (a) top-tools rows render as buttons with
   `data-mi="-1"` which `wireAnalysis` deliberately skips: clickable
   elements that do nothing; (b) the tools list labels a **character** count
   (`outputLength` = `contentText(...).length`) with token units
   (`formatTokens`) — the number shown is wrong by roughly 4×.

Rail-specific density: the ~300px panel shows up to 100 one-pixel bars, the
same count as the wide session-usage modal.

## Business Goals

- **BG1 — Answer-first panel:** cost, context, cache hit, and failures
  readable in the first glance (≤ 4 headline items), chart immediately after.
- **BG2 — Explainability:** a selected turn yields a persistent details
  readout (cost, tokens, context %, tool count) plus jump — not tooltip-only.
- **BG3 — User-controlled metric:** bars switchable between cost / output /
  context without code changes at runtime.
- **BG4 — Proactive signals:** deterministic threshold notices derived from
  data already present (context, tool errors, pending tools).
- **BG5 — Correctness:** kill the dead-button rows and the chars-as-tokens
  mislabel; rail vs modal density handled deliberately.
- **BG6 — Zero-build intact:** vanilla JS + CSS only, no dependencies, no
  build step, dual-mode module pattern respected (GOTCHAS #20).

## Constraints

- **Hard:** zero-build constraint (no bundler/transpile/npm-at-runtime);
  `esc()` for all interpolated HTML; fixed six-widget rail contract
  (`rail.js` — the analysis widget absorbs all changes, no new widget);
  panel re-renders wholesale via `setSafeHtml`, so any interactive state
  (selected bar, chosen metric) must live outside the panel DOM
  (module-scope vars / localStorage), not in the DOM.
- **Soft:** keep `analysisBody()` shared by rail panel AND modal; prefer
  reductions/moves over new code; keep the existing telemetry views
  (usage-telemetry.js) reachable (collapsed, not deleted) — they back the
  sparklines and the Quotas/telemetry story.
- **Scope boundary:** no changes to `session-analysis.js` math beyond the
  units fix surface; no new server endpoints; no changes to other widgets.

## Success Criteria

- SC1: First screen of the rail panel shows ≤ 4 headline stats then TURN
  HISTORY; telemetry metrics available but collapsed behind a toggle.
- SC2: A metric selector switches bar heights (cost / output / context);
  selection survives panel re-render and page reload (localStorage).
- SC3: Clicking (or keyboard-selecting) a bar shows a persistent selected-
  turn readout with a Jump action; the context overlay has a visible legend.
- SC4: Threshold notices render when their condition holds (context ≥ 80%,
  tool-error rate ≥ 20% with ≥ 5 calls, pending tools > 0 while idle) and
  are absent otherwise; each names its current value.
- SC5: No clickable-but-inert elements remain in the panel; the tools list
  shows an honest unit (chars or a neutral label) for output size.
- SC6: Rail shows a reduced bar count (default 20, expandable); modal keeps
  the full 100.
- SC7: `node test/*.test.js` passes, including new tests covering selector
  persistence, threshold notice logic, and readout state handling.
- SC8: Manual smoke: dark + paperlike themes, narrow rail sheet, and the
  session-usage modal all render the new layout without overflow.

---

*Phase 1 artifact of the SDD workflow. No implementation code until
`tasks_usage-tab_22082026.md` is approved.*
