# Implementation Plan & TiCoder Test Suite: Usage Telemetry and Rolling History

**Set:** `usage-telemetry_18082026`  
**Phase:** 3 — implementation plan and tests  
**Status:** awaiting user approval; no implementation code is authorized yet

## Implementation shape

- Add one dual-mode, zero-dependency pure module at
  `public/usage-telemetry.js`. It owns the bounded history, event-duration
  ledger, sample normalization, metric math, and sparkline geometry. The
  browser adapter stays in `public/app.js` so the module remains Node-testable.
- Keep samples cumulative and nullable. A missing provider field remains
  `null`; it is never converted to `0` for a dependent metric. Known empty
  counts may be `0`.
- Persistence contract: persist only the current session's bounded numeric
  history in one versioned `localStorage` record. Do not store prompts, tool
  arguments/results, active event identities, or transcript content. A reload or
  browser close/reopen hydrates a matching `sessionKey`; corrupt, unavailable,
  private-mode, or quota-failing storage falls back to memory without blocking
  the panel. The committed transcript/session data remains pi-owned.
- Restart contract: restarting only the pi child keeps the page's in-memory
  history. A reconnect reuses it when the session identity and cumulative
  counters continue, while replayed live events are deduplicated. A different
  session/workspace or a counter decrease clears/rebases the history; an
  interrupted turn/tool is not fabricated as a completed duration.
- Use the existing `sessionAnalysis.analyzeSession()` output as the authoritative
  message/stats adapter. The new module receives normalized analysis data and
  never reads DOM, fetches, writes session files, or adds a server endpoint.
- Use one `usageHistory` instance for both `analysisRender()` and
  `showAnalysisModal()`/`analysisBody()`. Sampling is driven by page visibility,
  not by whether the Usage rail is open.
- Preserve the existing session summary cards and `TURN HISTORY` behavior; add
  recent-window cards for throughput, reliability, context headroom, cost rate,
  and latency. Every rendered card gets the same readable value/state text and a
  decorative sparkline slot.

## Data contract to implement

The pure module will normalize records shaped as follows:

```text
sample = {
  timestamp: finite wall-clock milliseconds,
  counters: {
    inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens,
    cost, modelCalls, toolCalls, toolErrors   // finite number or null
  },
  context: { percent, tokens, window },          // each finite number or null
  live: { pendingTools },                        // finite number or null
  durations: {
    turnMs, timeToFirstTokenMs, toolMs,          // cumulative totals
    turnCount, firstTokenCount, toolCount        // cumulative completed counts
  },
  derived: { averageTurnCost, medianTurnCost }   // optional legacy card trend data
}

storage = {
  version: 1,
  sessionKey,
  samples,                                       // same 361/60-minute bounds
  savedAt
}                                           // localStorage only; no event ledger
}
```

`history` keeps `sessionKey`, oldest-to-newest `samples`, `baselineValid`,
`paused`, and an internal segment boundary for visibility/reset rebases.
`metricViews(history, current)` returns `{id, label, valueText, series,
available, reason, direction}`. Reasons are limited to the specification's
explicit states (`idle`, `missing-provider-data`, `no-completed-calls`,
`no-duration-data`, `not-initialized`) plus no reason when a value is valid.

## Ordered task list

### T1 — Add the bounded sample/history model

- [x] **T1. History state, normalization, and rebasing**
  - **Files:** `public/usage-telemetry.js`, `test/usage-telemetry.test.js`
  - **Tests:** `node test/usage-telemetry.test.js` — PASS.
  - **Compliance:** Implements the bounded nullable sample model, session/reset
    rebasing, visibility baselines, and versioned browser-local persistence
    fallback required by FR-1–FR-4, FR-15, FR-17, and FR-19. ✓
  - **Delivers:** FR-1, FR-2, FR-3, FR-4, FR-15, FR-17, FR-19;
    bounded browser-local persistence plan constraint.
  - **How:** Implement the dual-mode module, immutable normalized samples,
    `createHistory(sessionKey)`, append/trim helpers, session-key reset, and
    cumulative-counter reset detection. Keep at most 361 samples and remove
    samples older than 60 minutes. Add versioned `localStorage` load/save helpers
    that accept an injected storage object for Node tests; hydrate only a
    matching session key and seed duration baselines from the newest saved
    sample. A counter that decreases rebases instead of producing negative
    deltas; a field that becomes unavailable is a gap, not a reset. Add an
    explicit segment boundary so the first sample after a hidden tab or reset
    establishes a fresh rate baseline while older samples can still support the
    visual window. Storage errors and malformed records fall back to memory.
  - **TiCoder tests (expected red before implementation):**
    - `createHistory` starts empty, `baselineValid:false`, `paused:false`, and
      uses the fallback session key — **FR-1/FR-4/FR-19**.
    - Appending 362 ten-second samples keeps the newest 361 and drops the
      oldest first; timestamps older than the 60-minute window are also trimmed
      — **FR-2**.
    - A changed `sessionKey` clears the previous samples; a decreasing numeric
      cumulative counter rebases without a negative sample — **FR-4**.
    - A missing cost/cache/context field does not clear unrelated counters and
      is preserved as `null` — **FR-3/FR-15/FR-19**.
    - A paused/resumed history marks the first resumed sample as a new baseline,
      so hidden elapsed time is never used in a rate — **FR-4**.
    - A matching versioned storage record round-trips only bounded numeric
      samples; a different key, corrupt JSON, unavailable storage, or quota
      failure returns a fresh usable history — **FR-17/FR-19**.

### T2 — Add completed-event telemetry and replay-safe identity handling

- [x] **T2. Track turn/tool lifecycle telemetry**
  - **Files:** `public/usage-telemetry.js`, `test/usage-telemetry.test.js`
  - **Tests:** `node test/usage-telemetry.test.js` — PASS.
  - **Compliance:** Adds bounded active turn/tool ledgers, first-token and
    completed-duration totals, pending state, error counts, seeded baselines,
    and identity-based replay de-duplication for FR-3, FR-14, FR-15, and FR-18.
    Identity-less tool terminals are ignored rather than paired by position. ✓
  - **Depends on:** T1
  - **Delivers:** FR-3, FR-14, FR-15, FR-18; incomplete-event edge cases.
  - **How:** Add a small event ledger with active turns/tools and cumulative
    completed duration totals/counts. A turn starts at `agent_start`, records
    its first text/thinking delta once, and completes at `agent_end`. A tool
    requires a stable `toolCallId` for start/end duration accounting; pending
    tools are exposed without contributing to completed averages. Duplicate
    starts/ends from live + snapshot replay are no-ops. Unknown or identity-less
    terminal events do not guess a duration or failure. Keep active state out of
    completed totals and expose a reset/snapshot operation.
  - **TiCoder tests (expected red before implementation):**
    - One completed turn produces one `turnMs` total/count and one first-token
      total/count; repeated first-token marks do not increase the count —
      **FR-14**.
    - A running turn/tool contributes to pending state but not duration averages;
      completion moves it into the cumulative totals — **FR-14**.
    - A tool start/end with the same ID records one duration, and replaying the
      terminal event cannot double the total/count or error state — **FR-18**.
    - Missing tool IDs and terminal events for unknown IDs are ignored for
      measured telemetry rather than paired by position — **FR-18/FR-19**.
    - Reset clears active and completed ledgers without changing the history
      module's nullable-provider semantics — **FR-15**.

### T3 — Implement sample mapping and rolling metric math

- [x] **T3. Derive metric views from cumulative samples**
  - **Files:** `public/usage-telemetry.js`, `test/usage-telemetry.test.js`
  - **Tests:** `node test/usage-telemetry.test.js` — PASS.
  - **Compliance:** Maps independent stats/message/telemetry fields and computes
    visible-window throughput, per-call, cost/cache, reliability, context,
    headroom, and duration views with explicit gaps/reasons and zero-denominator
    guards for FR-9–FR-15 and FR-19. ✓
  - **Depends on:** T1, T2
  - **Delivers:** FR-9 through FR-15, FR-19; throughput/cost/reliability goals.
  - **How:** Add a pure adapter from normalized `analyzeSession`/stats/telemetry
    values to a sample, then calculate metric views from deltas between the
    current sample and the newest comparable sample in the active segment.
    Keep provider counters, tool counters, context fields, and duration fields
    independent. Include the legacy optional average/median turn-cost values
    only as display-series data, never as replacements for cumulative counters.
    Use visible elapsed time only; never divide by zero or emit `NaN`/`Infinity`.
  - **TiCoder tests (expected red before implementation):**
    - Output delta over valid visible seconds gives `output tok/s`; unchanged
      output during a valid idle interval gives `0`; first/bad-timing samples
      give `—`/`not-initialized` — **FR-9**.
    - Output delta divided by completed model-call delta gives `avg output/call`;
      zero calls gives `—`/`no-completed-calls` — **FR-10**.
    - Cost delta per elapsed minute and cache-read divided by
      cache-read+fresh-input use only their own available fields; missing cost
      does not hide cache or token metrics — **FR-11/FR-15**.
    - Tool error and tool-call rates use their own deltas; no-call ratios show
      `—`, while a known empty pending count shows `0` — **FR-12**.
    - Context percentage yields both context and `100 - percent` headroom;
      missing percentage leaves raw token/window fields independent — **FR-13/FR-15**.
    - Turn, first-token, and tool latency are averages of completed duration
      deltas only; no completed durations show `—`/`no-duration-data` — **FR-14**.
    - Counter resets, zero denominators, missing stats, malformed provider
      values, and context-window changes never throw or create negative/raw
      capacity rates — **FR-4/FR-13/FR-19**.

### T4 — Add sparkline geometry and accessible metric-card primitives

- [x] **T4. Render trend geometry without falsifying gaps**
  - **Files:** `public/usage-telemetry.js`, `test/usage-telemetry.test.js`
  - **Tests:** `node test/usage-telemetry.test.js` — PASS.
  - **Compliance:** Adds per-series scaling, flat-line/gap-safe SVG geometry,
    explicit reason text, and decorative non-focusable trend markup for FR-6,
    FR-7, FR-8, and FR-19. ✓
  - **Depends on:** T3
  - **Delivers:** FR-6, FR-7, FR-8, FR-19; restrained trend/background goal.
  - **How:** Export a small sparkline point/path helper that uses each metric's
    own finite range, draws a flat line for equal values, leaves unavailable
    values as breaks, and returns no trend for fewer than two valid points.
    Provide a card fragment/helper contract with a readable label, value, and
    reason text plus a decorative `aria-hidden` SVG/container. The graph must
    not be an interactive target or the sole warning channel.
  - **TiCoder tests (expected red before implementation):**
    - Two finite points produce normalized geometry; equal points remain a
      visible flat line rather than a divide-by-zero result — **FR-6/FR-7**.
    - `null`/unavailable points create gaps and are not converted to zero; a
      series with fewer than two finite points has no sparkline path — **FR-7**.
    - A metric scales against its own min/max, and all generated coordinates are
      finite and bounded — **FR-7/FR-19**.
    - The card contract includes the exact label/value/reason text and marks
      the trend markup decorative with `aria-hidden`; status does not depend on
      a color token — **FR-8**.

### T5 — Wire visible 10-second sampling into the browser lifecycle

- [x] **T5. Collect authoritative samples independently of the rail**
  - **Files:** `public/app.js`, `public/index.html`, `server.js`,
    `test/usage-telemetry-layout.test.js`
  - **Tests:** `node --check public/app.js`; `node --check server.js`;
    `node test/usage-telemetry.test.js`; `node test/usage-telemetry-layout.test.js` —
    PASS.
  - **Compliance:** Whitelists/loads the pure module before `app.js`, hydrates
    bounded local history by session identity, samples visible state on a
    10-second cadence independent of the rail, pauses/rebases across hidden
    gaps, and feeds stats/messages/event telemetry through one shared history
    for FR-1, FR-3, FR-4, FR-5, FR-15, FR-17, FR-18, and FR-19. ✓
  - **Depends on:** T2, T3
  - **Delivers:** FR-1, FR-3, FR-4, FR-5, FR-15, FR-17, FR-18, FR-19.
  - **How:** Load and whitelist `usage-telemetry.js` before `app.js`; create one
    browser history and event ledger. Build each sample from the latest
    `lastStats`, `lastMessages`, `lastRunning`, `sessionAnalysis` result, and
    completed-event snapshot. Run a 10-second visible-page sampler regardless
    of `railWidget`; pause it on `document.hidden`, mark the resume boundary,
    and take the first post-resume sample as a baseline. Reset on workspace
    changes, new/resumed session identity, different snapshot identity, and
    module-detected counter rebases. Keep this entirely in memory and use the
    existing stats/messages RPCs only.
  - **TiCoder tests (expected red before implementation):**
    - Static layout test verifies the new asset is in the server allowlist and
      loaded before `app.js`, with no new `/api/usage` endpoint or server/session
      persistence; the sole browser-local key is bounded and versioned —
      **FR-17**.
    - Static app test finds the 10,000-ms sampler, visibility pause/resume, and
      sampling path outside the Usage widget-open condition — **FR-1/FR-5**.
    - Static app test verifies workspace/session/snapshot reset hooks and that
      the sample adapter receives stats, messages, and telemetry separately —
      **FR-3/FR-4/FR-15**.
    - Re-running the pure sample adapter with the same snapshot/event ledger
      yields unchanged cumulative values — **FR-18/FR-19**.
    - A reload or browser reopen hydrates the matching bounded local history but
      not active event identities; a pi-child reconnect on the same page
      preserves history until a session/counter reset is observed —
      **FR-1/FR-4/FR-17/FR-18**.

### T6 — Replace the Usage body with shared trend-aware cards

- [x] **T6. Add recent metrics while preserving the existing inspector**
  - **Files:** `public/app.js`, `test/usage-telemetry-layout.test.js`
  - **Tests:** `node --check public/app.js`; `node test/usage-telemetry.test.js`;
    `node test/usage-telemetry-layout.test.js`; `node test/sidebar-layout.test.js`;
    `node test/transcript-layout.test.js` — PASS.
  - **Compliance:** `analysisBody()` now consumes the shared history for the
    existing summary cards plus all specified recent throughput, cost,
    reliability, context, and latency cards, while preserving TURN HISTORY,
    context overlay, transcript jumps, and approval/error paths for FR-5–FR-16.
    ✓
  - **Depends on:** T3, T4, T5
  - **Delivers:** FR-5 through FR-16; all Usage inspector business goals.
  - **How:** Have `analysisBody()` render from the shared history and current
    analysis. Keep the current total/turn/average/median/context/cache summary,
    the last-100 billed `TURN HISTORY` bars, context overlay, ranked tools,
    costliest turns, failed calls, and jump-to-transcript wiring unchanged.
    Add cards for `output tok/s`, `avg output/call`, `cost/min`, `tool error`,
    `tool calls/min`, `pending tools`, `headroom`, `turn duration`, `time to
    first token`, and `tool latency`. Every card uses the metric view's
    value/reason text and sparkline helper; unavailable, idle, and incomplete
    states remain explicit. `analysisRender()` and the free modal must call the
    same body builder/history and refresh after new samples without a reload.
  - **TiCoder tests (expected red before implementation):**
    - Static app test finds all required metric IDs/labels and the shared
      `analysisBody` path used by both rail and modal — **FR-5/FR-9–FR-14**.
    - Every generated statistic card includes a value, label/state text, and a
      decorative trend slot; no card makes the sparkline the only control —
      **FR-6/FR-8**.
    - Existing `TURN HISTORY`, `last 100`, context-line, `[data-mi]` jump, tool
      failure, and visible transcript numbering markers remain present —
      **FR-16**.
    - Static refresh test verifies samples refresh an open rail/modal and that
      approval/error rendering paths are not removed — **FR-5/FR-16**.

### T7 — Finish narrow-rail, density, and accessibility styling

- [x] **T7. Style the trend cards without obscuring content**
  - **Files:** `public/style.css`, `test/usage-telemetry-layout.test.js`
  - **Tests:** `node test/usage-telemetry.test.js`;
    `node test/usage-telemetry-layout.test.js`; `node test/sidebar-layout.test.js`;
    `node test/shell-layout.test.js` — PASS.
  - **Compliance:** Adds neutral pointer-transparent sparkline layers, readable
    stacked card content/state text, modal/rail grids, narrow-rail rules, and
    reduced-motion handling without changing approval/error emphasis for
    FR-6–FR-8, FR-16, and FR-17. ✓
  - **Depends on:** T6
  - **Delivers:** FR-6, FR-7, FR-8, FR-16, FR-17; responsive/progressive-disclosure
    plan goals.
  - **How:** Add a neutral, absolute/background sparkline layer with readable
    card content above it, preserve the existing dark/paperlike variables,
    support the narrow rail and density modes, keep controls keyboard-sized,
    disable pointer interception by the decorative layer, and add reduced-motion
    handling. Use text/state styling in addition to any direction tint; do not
    encode warning or availability only with color.
  - **TiCoder tests (expected red before implementation):**
    - CSS assertions cover the sparkline layer, content stacking, neutral theme
      variables, `pointer-events:none`, and narrow `#toolsbar` card layout —
      **FR-6/FR-7/FR-16**.
    - CSS assertions cover reduced-motion behavior and readable labels/values
      at rail width without removing the existing density rules — **FR-8/FR-16**.
    - Layout assertions confirm no sparkline rule hides or changes the existing
      error/approval emphasis and that the trend is not a click target —
      **FR-8/FR-16**.

### T8 — Run regression suite and write terminal compliance evidence

- [x] **T8. Validate the complete feature and close the SDD set**
  - **Files:** `.sdd/tasks_usage-telemetry_18082026.md`,
    `.sdd/verify_usage-telemetry_18082026.md`
  - **Tests:** 40/40 `test/*.test.js` files PASS; syntax checks PASS;
    `git diff --check` PASS; final LSP/lens diagnostics have no blocking
    findings; `.sdd/verify_usage-telemetry_18082026.md` written.
  - **Compliance:** The verify artifact maps FR-1–FR-19 to focused/full-suite
    evidence and confirms the plan goals. All implementation chunks are
    checkpointed; the four SDD artifacts are ready to archive. ✓
  - **Depends on:** T1 through T7
  - **Delivers:** all plan success criteria and FR-1 through FR-19.
  - **How:** Run the focused telemetry/history/layout tests and every existing
    `test/*.test.js` file. Run diagnostics on edited files, inspect the final
    diff for accidental persistence/endpoints/dependency additions, map every
    FR to passing evidence, then write the terminal verify artifact. Mark each
    prior chunk `[x]` with its test result and a one- or two-line compliance
    note before archiving the four SDD artifacts.
  - **TiCoder tests/commands:**
    - `node test/usage-telemetry.test.js` — **FR-1 through FR-15, FR-18,
      FR-19**.
    - `node test/usage-telemetry-layout.test.js` — **FR-5 through FR-8,
      FR-16, FR-17**.
    - `for f in test/*.test.js; do node "$f"; done` — existing regression
      suite and **FR-16/FR-17**.
    - `git diff --check` plus `lens_diagnostics(mode=all)` on edited files —
      implementation hygiene, storage-fallback safety, and **FR-19**.

## Dependency graph

```text
T1 history model
├── T2 event ledger
│   ├── T3 metric math + sample adapter
│   │   └── T5 browser sampling
│   └── T5 browser sampling
├── T3 metric math
└── T4 sparkline primitives
    └── T6 shared Usage cards
T5 browser sampling ───────────────┘
T6 Usage cards → T7 CSS/accessibility → T8 full verification
```

## Phase 4 checkpoint rule

Only after approval, implement exactly one unchecked task at a time. At each
checkpoint, replace its `[ ]` with `[x]`, record the focused command and result,
and add a compliance note that re-checks the tagged FRs against both the plan and
spec. Do not start the next task while its focused tests or compliance note is
missing.

## Approval gate

The proposed tests are intentionally expected to be red/missing before Phase 4;
they express the requirements rather than retrofitting to an implementation.
Approve this implementation plan and test suite before any source/test code is
written.
