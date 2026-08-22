# Specification: Browser context efficiency

## User Stories

- As a debugging agent, I want a compact page summary by default so that a
  normal inspection does not consume the context window with repeated detail.
- As a debugging agent, I want to request a complete bounded snapshot when the
  compact view is insufficient.
- As a debugging agent, I want console results to identify only new entries so
  that repeated polling does not resend the same errors.
- As a vision-capable model, I want a context-sized screenshot without changing
  the browser's 1920×1080 debugging viewport.
- As a debugging agent, I want unchanged-page responses to be explicit so that
  I can avoid asking for evidence I already have.
- As a user, I want same-document and slow navigation outcomes to be bounded,
  recoverable, and safe.

## Functional Requirements

### Contract and compatibility

- **FR-1 — Same first-slice surface:** Keep exactly `browser_open`,
  `browser_snapshot`, `browser_screenshot`, and `browser_console`. Do not add
  interaction, tab, network, or arbitrary-evaluation tools in this follow-up.
- **FR-2 — Additive compatibility:** Existing calls with `{}` or the current
  `browser_open` URL request remain valid. Existing schema names, required
  fields, security rules, image fallback, and stable error codes remain
  compatible; new request and response fields are additive.
- **FR-3 — Existing safety and bounds:** Preserve local/exact-host policy,
  isolated managed profiles, safeguard routing, untrusted-page guidance,
  password redaction, stale refs, abort handling, and the 300 KiB decoded
  screenshot ceiling.

### Context-sized snapshots

- **FR-4 — Compact default:** `browser_snapshot` accepts an optional `mode` of
  `compact` or `full`; omitted mode means `compact`. Compact output contains at
  most 4 KiB of visible page text and 80 interactive elements. Full output keeps
  the first-slice limits of 12 KiB and 200 elements. Both modes retain the
  existing per-field bounds and safe element contract.
- **FR-5 — Deterministic selection:** Compact and full element lists use stable
  document order and deterministic truncation. Neither mode may return raw
  HTML, CSS selectors, arbitrary accessibility nodes, password values, or
  unsafe hrefs.
- **FR-6 — Revision token:** Every successful snapshot returns an opaque,
  bounded `revision` representing the current URL, title, visible text, and
  normalized element state. A revision changes when any model-visible snapshot
  content changes.
- **FR-7 — Unchanged response:** `browser_snapshot` accepts an optional
  `since` revision. When it matches the current revision, the result returns
  `unchanged: true`, the current metadata and revision, and empty `pageText` and
  `elements` fields. It must not invalidate valid refs merely because the
  caller requested a repeated snapshot.
- **FR-8 — Full recovery:** Omitting `since` always returns a complete snapshot
  for the requested mode. A caller can recover after an old, malformed, or
  unknown revision without relying on an implicit cache.
- **FR-9 — Ref semantics:** Snapshot refs remain manager-owned and stale-safe.
  Structural changes invalidate refs as before; an unchanged response does not
  create guessed selectors or expose interaction capabilities.

### Delta console evidence

- **FR-10 — Bounded console cursor:** `browser_console` returns a bounded
  integer `cursor` and each returned entry carries a monotonically increasing
  sequence. The retained session buffer remains capped at 50 warning/error
  entries.
- **FR-11 — Delta default:** The request accepts optional `since` and `mode`
  values (`delta` or `full`); omitted mode means `delta`. A delta call returns
  only entries after the requested/manager cursor, capped at 20 entries per
  response. A full call returns the newest retained entries, capped at 50.
- **FR-12 — Cursor recovery:** If a requested cursor predates retained entries,
  the result sets `dropped: true` and returns the available bounded window
  rather than claiming that no entries changed. A clean page remains a valid
  empty result.
- **FR-13 — Stable entry data:** Console entries retain only the existing
  warning/error level, bounded text, optional source location, and timestamp.
  Protocol payloads, stacks, and arbitrary page data are not returned.

### Context-sized screenshots

- **FR-14 — Independent output size:** `browser_screenshot` accepts an optional
  `size` of `context` or `viewport`; omitted size means `context`. `context`
  output is no larger than 1280×720, while `viewport` may represent the current
  managed 1920×1080 viewport. The browser viewport itself is never changed by
  choosing the output size.
- **FR-15 — Bounded quality:** The request accepts an optional bounded JPEG
  quality. The default favors context efficiency, values outside the allowed
  range are rejected or clamped deterministically, and quality reduction may
  retry down to the existing floor before returning `output-limit`.
- **FR-16 — Screenshot metadata:** Successful results retain the existing text
  and optional image content contract. Details report URL, output width/height,
  source viewport, encoded byte count, image inclusion, and the applied scale.
  Text-only models receive metadata/guidance only and never image bytes.
- **FR-17 — No duplicate transport:** Screenshots are sent only in the final
  image content block, never in progress updates, logs, console results, or
  duplicate model-facing fields. The decoded payload remains at or below 300
  KiB.

### Navigation reliability

- **FR-18 — Same-document navigation:** `browser_open` treats same-document
  history/hash navigation as a valid bounded navigation outcome when the final
  URL passes the existing host policy.
- **FR-19 — Bounded readiness:** Cross-document navigation waits only within a
  finite readiness deadline and distinguishes CDP rejection, disallowed
  redirect, abort, and timeout with stable errors. It must not wait for an
  unbounded network-idle condition.
- **FR-20 — Recovery after timeout:** A navigation timeout removes listeners and
  leaves the manager reattachable on the next call. Managed processes and
  attached browsers follow their existing ownership cleanup rules.
- **FR-21 — Redirect safety:** A redirect outside the configured host allowlist
  remains a fail-closed error and is never returned as a successful open.

### Guidance, testing, and runtime

- **FR-22 — Context guidance:** Tool descriptions or prompt guidance instruct
  agents to prefer a compact snapshot, use full snapshots only when needed,
  request console deltas for polling, and request screenshots for visual/layout
  questions rather than routine text inspection.
- **FR-23 — No new protocol:** The change uses the existing pi tool-result/RPC
  contract and adds no server HTTP route or browser-to-server protocol.
- **FR-24 — Zero-dependency validation:** Normal tests remain Node 18-compatible,
  dependency-free, and browser-binary-free. Deterministic fake-CDP tests cover
  new contracts; a local live smoke check covers the managed browser path.

## Data Models

### Snapshot request

```text
BrowserSnapshotRequest {
  mode?: "compact" | "full",   // default: compact
  since?: string                // opaque revision from an earlier response
}
```

### Snapshot response additions

```text
BrowserSnapshot {
  schema: "pi-webui.browser-snapshot/v1",
  url: string,
  title: string,
  viewport: { width: number, height: number },
  pageText: string,             // empty when unchanged=true
  elements: SnapshotElement[],  // empty when unchanged=true
  revision: string,
  unchanged?: boolean,
  mode: "compact" | "full"
}
```

### Console request and response additions

```text
BrowserConsoleRequest {
  mode?: "delta" | "full",     // default: delta
  since?: number                // default: manager's last delivered cursor
}

BrowserConsoleResult {
  schema: "pi-webui.browser-console/v1",
  url: string,
  entries: ConsoleEntry[],
  cursor: number,
  dropped: boolean,
  mode: "delta" | "full"
}

ConsoleEntry {
  sequence: number,
  level: "warning" | "error",
  text: string,
  source?: string,
  line?: number,
  column?: number,
  timestamp?: number
}
```

### Screenshot request and response additions

```text
BrowserScreenshotRequest {
  size?: "context" | "viewport", // default: context
  quality?: integer              // bounded JPEG quality
}

BrowserScreenshotDetails {
  url: string,
  width: number,
  height: number,
  viewport: { width: number, height: number },
  bytes: number,
  imageIncluded: boolean,
  scale: number
}
```

## Edge Cases

- The first snapshot has no `since` value and returns a complete compact view.
- A changed body text with identical controls changes `revision` and returns
  the updated bounded text; refs remain valid unless structural state changed.
- An unknown or malformed revision never produces `unchanged: true`.
- A console cursor older than the retained 50-entry window sets `dropped: true`.
- Events arriving while a console result is assembled are assigned after the
  returned cursor and appear on the next delta call.
- A context screenshot preserves aspect ratio, never upscales, and falls back
  through bounded JPEG quality before returning `output-limit`.
- A screenshot request from a text-only model never includes image data,
  regardless of requested size or quality.
- An attached browser is not forcibly resized by context screenshot settings or
  managed 1920×1080 defaults.
- Hash/history navigation, an already-current URL, and SPA routes may complete
  without a full document navigation event but must still return a validated
  final URL within the deadline.
- A target that never commits, a closed transport, an abort, or a disallowed
  redirect returns a stable bounded error and leaves the next call recoverable.
- Prompt injection, secrets, password values, raw protocol payloads, and
  unbounded page text remain excluded from model-facing results.
- Older callers that omit all new fields continue to receive valid first-slice
  result shapes; additive fields must not require a new HTTP endpoint.

## Non-goals for this follow-up

- Browser click, type, reload, wait, tabs, network, or arbitrary evaluation.
- Changing the managed browser's default 1920×1080 viewport.
- Replacing JPEG with a new required image dependency or introducing a vision
  token accounting service.
- Persisting browser content outside the current extension session.
