# Specification: Usage Telemetry and Rolling History

## User Stories

- As an engineer, I want to see the last hour's usage trend behind each Usage
  statistic so that bursts and slowdowns are visible without opening a chart.
- As an engineer, I want output throughput and average tokens per model call so
  that I can distinguish a busy session from an inefficient one.
- As an engineer, I want cost/cache, tool reliability, context, and latency
  signals so that I can spot provider cost, cache, failure, and saturation
  problems early.
- As an accessibility user, I want the exact current values and their state text
  to remain available independently of a decorative trend graph or color.

## Functional Requirements

### Rolling history

- **FR-1** The browser keeps a per-session Usage history with samples taken at a
  10-second cadence while the page is visible. Sampling does not require the
  Usage rail to be open.
- **FR-2** The history covers a maximum of 60 minutes. It retains the current
  sample plus at most 360 prior 10-second intervals (maximum 361 samples) and
  drops older samples first.
- **FR-3** Sampling uses the latest authoritative stats/messages and client-side
  completed-event telemetry available at sample time. A sample records its wall
  clock timestamp and cumulative counters, allowing rates to be calculated from
  deltas rather than duplicated totals.
- **FR-4** Switching session/workspace, receiving a snapshot for a different
  session identity, or detecting a cumulative-counter reset clears the rolling
  buffer. A hidden-tab gap is not treated as active elapsed time; the first
  resumed sample establishes a new rate baseline.
- **FR-5** The open Usage rail and Usage modal refresh from the same history state.
  New samples also update the current values without requiring a manual reload.

### Statistic cards and sparklines

- **FR-6** Every headline statistic card, including newly added metric cards,
  displays a restrained 60-minute background sparkline when at least two valid
  samples exist. The graph is decorative; the current value and state text are
  the source of truth.
- **FR-7** A sparkline scales against its own series, preserves a flat line for
  unchanged values, and renders gaps for unavailable values rather than treating
  missing data as zero. It must not obscure the card value or actionable states.
- **FR-8** The graph uses accessible neutral markup (`aria-hidden` or equivalent)
  and never communicates a warning by color alone. Cards expose text labels,
  current values, and an unavailable/idle reason.

### Metric definitions

- **FR-9 — Throughput:** `output tok/s` is output-token delta divided by active
  elapsed seconds between valid samples. The card may show zero during a valid
  idle interval; before a baseline or with invalid timing it shows `—`.
- **FR-10 — Average output:** `avg output/call` is output-token delta divided by
  completed billed model-call delta in the rolling window. With no completed
  calls it shows `—`.
- **FR-11 — Cost and cache:** `cost/min` is provider-reported cost delta divided
  by elapsed rolling minutes. `cache hit` is cache-read delta divided by
  cache-read plus fresh-input delta. Missing provider cost stays `—`; no dollar
  cache savings are invented without provider pricing metadata.
- **FR-12 — Reliability:** `tool error` is failed-tool delta divided by tool-call
  delta; `tool calls/min` is tool-call delta divided by elapsed rolling minutes;
  `pending tools` is the current pending count. No-call states show `—` for
  ratios and `0` for a known empty pending count.
- **FR-13 — Context:** `headroom` is `100 - current context percentage` when the
  provider reports a valid percentage. The existing context percentage remains
  available, and the sparkline follows the same percentage series.
- **FR-14 — Latency:** `turn duration` and `time to first token` use completed
  client-measured turn events; `tool latency` uses completed tool start/end
  events. Each average is over completed events in the rolling window. If no
  duration telemetry exists, the card explicitly shows `—`.
- **FR-15** Provider/model-call counters, output tokens, cache counters, cost,
  context data, tool results, and measured durations remain distinguishable in
  the data model so a missing one cannot silently invalidate unrelated metrics.

### Integration and compatibility

- **FR-16** Existing `TURN HISTORY`, last-100 billed model-turn chart, per-turn
  context overlay, visible-transcript numbering distinction, density modes, and
  approval/error emphasis remain unchanged.
- **FR-17** The implementation stays zero-build and dependency-free. It adds no
  server endpoint or session-file field. The bounded numeric history may be
  persisted in browser-local storage only; storage failure falls back to memory
  without affecting the Usage panel.
- **FR-18** Event replay/reconnect is idempotent: a replayed completion or tool
  event cannot count twice in duration, failure, call, or pending metrics.
- **FR-19** A sample or metric calculation must never throw on malformed,
  partial, stale, or provider-specific stats. It falls back to an explicit
  unavailable state and keeps the rest of the Usage panel usable.

## Data Models

### Usage sample

A sample is an immutable record with:

- `timestamp`: wall-clock milliseconds.
- `counters`: cumulative `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`,
  `outputTokens`, `cost`, `modelCalls`, `toolCalls`, `toolErrors`.
- `context`: `percent`, `tokens`, and `window`, each nullable independently.
- `live`: current `pendingTools` count.
- `durations`: cumulative completed `turnMs`, `timeToFirstTokenMs`, and
  `toolMs` totals plus completed-event counts.

### Usage history

- `sessionKey`: current session identity (or a standalone fallback key).
- `samples`: oldest-to-newest samples, bounded to 361 records and 60 minutes.
- `baselineValid`: whether the newest sample can be compared to its predecessor.
- `paused`: whether sampling is waiting for the first post-visibility sample.
- `storage`: optional versioned browser-local snapshot for the current
  `sessionKey`; it contains bounded samples only, never transcript/tool text.
  A reload/reopen hydrates only a matching identity; malformed, stale, or
  unavailable storage is ignored and sampling continues in memory.

### Metric view

Each metric view contains:

- `id`, `label`, and `valueText`.
- `series`: timestamp/value pairs or unavailable gaps.
- `available`: boolean.
- `reason`: optional `idle`, `missing-provider-data`, `no-completed-calls`,
  `no-duration-data`, or `not-initialized` state.
- `direction`: optional `higher-is-better`, `lower-is-better`, or `neutral`
  metadata for text/title treatment; color is never the only status channel.

## Edge Cases

- An empty session renders cards with `—` and no misleading flat zero graph.
- The first sample establishes a baseline; no rate is emitted until a valid
  second sample exists.
- A provider omitting cost, cache, context, or token fields affects only the
  dependent metric; other cards continue to render.
- A zero elapsed interval, zero model-call denominator, or zero tool-call
  denominator yields `—`, not `Infinity`, `NaN`, or a fabricated percentage.
- Cumulative counters that move backwards are treated as a reset/rebase and do
  not create negative rates.
- A model switch or context-window change preserves percentage trends but never
  compares incompatible raw token capacities as if they were one series.
- A turn/tool that is still running contributes to pending/current state but not
  to completed-duration averages until its terminal event arrives.
- A terminal event arriving after a reconnect replay is deduplicated by its
  stable request/tool identity; missing identities make the event unavailable
  rather than guessable.
- The final card layout remains usable in a narrow rail and with keyboard or
  screen-reader access; sparklines cannot become the only click target.
- Reloading or reopening the browser restores the matching bounded numeric
  history when local storage is available; it does not restore active event
  identities or fabricate an interrupted duration. A different session key
  starts a fresh history.
- Private browsing, disabled storage, corrupt JSON, quota errors, and schema
  mismatches degrade to memory-only sampling without throwing or leaking
  transcript content.
