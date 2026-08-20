# Verification: Usage Telemetry and Rolling History

**Set:** `usage-telemetry_18082026`  
**Outcome:** PASS

Post-verification hardening cancels active telemetry identities when a dead
turn is finalized while preserving completed cumulative totals; the full
40-test suite was rerun and remains green.

## Validation commands

- `node test/usage-telemetry.test.js` — PASS.
- `node test/usage-telemetry-layout.test.js` — PASS.
- `node test/sidebar-layout.test.js` — PASS.
- `node test/transcript-layout.test.js` — PASS.
- `node test/shell-layout.test.js` — PASS.
- Every `test/*.test.js` file — **40/40 PASS**.
- `node --check public/app.js` and `node --check server.js` — PASS.
- `git diff --check` — PASS.
- `lens_diagnostics(mode=full)` on the edited source/test files — no blocking
  findings; the legacy `app.js` scan still reports non-blocking style warnings.
- Primary LSP diagnostics — no errors; remaining CommonJS/legacy browser hints
  are non-blocking and pre-existing to the touched paths.

## Functional-requirement matrix

| Requirement | Passing evidence |
|---|---|
| FR-1 | `usage-telemetry.test.js` history lifecycle; `usage-telemetry-layout.test.js` visible 10-second sampler independent of the rail |
| FR-2 | 361-sample and 60-minute trimming assertions in `usage-telemetry.test.js` |
| FR-3 | `sampleFromAnalysis` field-mapping assertions plus browser sampling wiring |
| FR-4 | session-key/counter-reset and pause/resume baseline assertions; workspace/snapshot hooks in layout test |
| FR-5 | shared `analysisBody`/rail/modal path and refresh hooks in `app.js` layout assertions |
| FR-6 | metric-card trend slots, sparkline geometry, and recent-card IDs |
| FR-7 | flat-line, per-series scaling, gap, finite-coordinate, and no-single-point tests |
| FR-8 | `aria-hidden`/`focusable=false`, readable reason text, pointer-transparent CSS, and responsive layout assertions |
| FR-9 | output-token delta/second and valid idle-zero assertions |
| FR-10 | output delta/model-call delta and no-completed-call assertions |
| FR-11 | cost/min, cache-hit, missing-cost independence, and zero-cache-denominator assertions |
| FR-12 | tool error/call rates, no-call states, pending count, and replay-safe tool ledger assertions |
| FR-13 | context/headroom values and missing-percentage independence assertions |
| FR-14 | turn, first-token, and tool duration/count averages plus incomplete/no-duration assertions |
| FR-15 | nullable independent sample fields and authoritative source mapping assertions |
| FR-16 | `sidebar-layout`, `transcript-layout`, `shell-layout`, and full-suite regression tests |
| FR-17 | static allowlist/load-order/no-endpoint checks and storage failure fallback tests |
| FR-18 | duplicate turn/tool lifecycle event tests and status-race regression test |
| FR-19 | malformed sample/provider/storage tests, finite-coordinate checks, full suite, and diagnostics |

## Plan-goal check

- Bounded browser-local history: satisfied; no server endpoint or session-file
  change was added.
- Active 10-second sampling and shared Usage refresh: satisfied.
- Throughput, cost/cache, reliability, context, and latency cards: satisfied.
- Explicit idle/missing/incomplete states and non-color fallback: satisfied.
- Zero-build vanilla implementation with focused and full regression coverage:
  satisfied.

## Residual risk

The verification is source/unit/layout based; no live provider session or visual
browser smoke run was available in this pass. The existing transcript and rail
layout contracts remain green, and the trend layer is decorative/non-interactive
by construction.
