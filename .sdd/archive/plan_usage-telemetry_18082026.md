# Plan: Usage Telemetry and Rolling History

## Problem Statement

The Usage inspector exposes current totals and per-turn history, but it does not
show short-term trends or enough throughput, latency, cache, cost, and reliability
signals to explain how a session is behaving now. Static values make bursts,
slowdowns, and context pressure difficult to spot.

## Business Goals

- Make recent session behavior legible at a glance without opening another view.
- Surface useful throughput and per-call averages alongside existing usage totals.
- Show cost, cache, context, latency, and tool reliability trends while preserving
  the engineering-first, progressive-disclosure UI.
- Keep the feature bounded, dependency-free, and cheap enough for long sessions.

## Constraints

- Keep only a 60-minute rolling history in bounded browser-local storage; do not
  add server-side persistence or alter session files. If browser storage is
  unavailable, degrade to the same in-memory buffer without blocking the UI.
- Sample at a 10-second cadence and cap all buffers to the visible window.
- Preserve the zero-build, vanilla browser architecture and existing density modes.
- Treat provider-reported values and measured durations as optional: missing data
  must remain explicit rather than being inferred as zero.
- Preserve accessibility, responsive layout, prominent errors/approvals, and the
  existing `TURN HISTORY` / visible-transcript distinction.

## Success Criteria

- Each Usage statistic card can show a restrained 60-minute trend background with
  a readable current value and non-color-only fallback.
- Usage automatically records bounded samples while the page is active and
  updates an open inspector without manual refresh.
- Throughput includes tokens per second and average output tokens per billed model
  call; additional selected cards cover cost/cache, reliability, context, and
  latency where data is available.
- Idle, incomplete, missing-provider-data, and zero-denominator states render
  clearly and do not produce misleading rates.
- Focused unit/layout tests cover rolling-window trimming, metric calculations,
  missing data, and card accessibility; the full existing suite remains green.
