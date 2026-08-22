# Implementation plan and TiCoder tests: Browser context efficiency

## Task list

### Chunk 1 — Compact snapshots and revisions

- [x] Add compact/full snapshot requests, bounded revision tokens, unchanged
  responses, and full-view recovery without weakening refs or redaction.
  - Tests: `test/browser-tools.test.js` (37 passed) — PASS.
  - Compliance: satisfies FR-1–FR-9 with compact defaults, full recovery,
    revision-based unchanged responses, and preserved ref/redaction bounds. ✓
  - Requirements: FR-1–FR-9; plan goals: smaller repeated model evidence.
  - Dependencies: existing `browser-snapshot.js` and facade schemas.
  - TiCoder tests in `test/browser-tools.test.js`:
    - omitted mode uses compact limits of 4 KiB page text and 80 elements;
    - `mode:"full"` retains 12 KiB/200 limits and deterministic order;
    - revisions change for URL/title/body/element-state changes and remain
      stable for identical normalized content (# FR-5, FR-6);
    - matching `since` returns `unchanged:true`, metadata/revision, and empty
      text/elements; missing/unknown `since` returns a complete view (# FR-7,
      FR-8);
    - password values, unsafe hrefs, fields, and stale-ref behavior remain
      covered (# FR-3, FR-9).

### Chunk 2 — Cursor-based console deltas

- [x] Add bounded console sequences, delta/full request modes, cursor recovery,
  and dropped-entry signaling while retaining the warning/error-only contract.
  - Tests: `test/browser-tools.test.js` (37 passed) — PASS.
  - Compliance: satisfies FR-10–FR-13 with monotonic cursors, 20-entry deltas,
    50-entry recovery, dropped signaling, and warning/error filtering. ✓
  - Requirements: FR-1–FR-3, FR-10–FR-13; plan goals: no repeated console
    evidence during polling.
  - Dependencies: existing `browser-console.js` and manager session state.
  - TiCoder tests in `test/browser-tools.test.js`:
    - entries receive monotonic sequences and results return a cursor;
    - default delta calls return at most 20 new entries, full calls at most 50;
    - explicit and manager cursors do not repeat entries;
    - an expired cursor returns the retained bounded window with `dropped:true`;
    - empty, malformed, info, debug, and oversized events remain safe and
      bounded (# FR-10–FR-13).

### Chunk 3 — Context-sized screenshot output

- [x] Add bounded context/viewport screenshot modes, quality input validation,
  scale-aware metadata, and output-size enforcement independent of the browser
  viewport.
  - Tests: `test/browser-tools.test.js` (37 passed) — PASS.
  - Compliance: satisfies FR-14–FR-17; context output is capped at 1280×720,
    viewport sizing is preserved, JPEG quality is bounded, and image output is
    final-result-only and byte-capped. ✓
  - Requirements: FR-1–FR-3, FR-14–FR-17; plan goals: visual evidence sized
    for the model rather than the browser window.
  - Dependencies: existing `browser-screenshot.js` and 1920×1080 managed
    viewport.
  - TiCoder tests in `test/browser-tools.test.js`:
    - default context output never exceeds 1280×720 and never upscales;
    - viewport mode preserves the current viewport dimensions;
    - quality is bounded, retries remain within the floor, and oversized data
      returns `output-limit`;
    - details report output dimensions, source viewport, bytes, inclusion, and
      scale (# FR-14–FR-16);
    - text-only models receive no image bytes and screenshots are final-result
      only (# FR-3, FR-17).

### Chunk 4 — Navigation readiness and recovery

- [x] Make open completion robust for same-document routes and bounded for slow
  or failed targets; remove listeners and recover the manager after timeout.
  - Tests: `test/browser-tools.test.js` (37 passed) plus local managed-browser
    hash/open smoke — PASS.
  - Compliance: satisfies FR-18–FR-21 with same-document events, bounded
    timeout/abort cleanup, recoverable sessions, and fail-closed redirects. ✓
  - Requirements: FR-18–FR-21; plan goals: predictable local SPA debugging.
  - Dependencies: existing CDP event/session layer and `browser.ts` manager.
  - TiCoder tests in `test/browser-tools.test.js` and deterministic fake-CDP
    fixtures:
    - `Page.frameNavigated` and `Page.navigatedWithinDocument` both complete a
      validated open (# FR-18);
    - navigation timeout, abort, CDP rejection, and disallowed redirect return
      distinct bounded errors (# FR-19, FR-21);
    - timeout removes listeners and the next open starts/reuses a safe session
      rather than inheriting a stuck navigation (# FR-20);
    - repeated local opens and hash/SPA opens pass in the optional live smoke
      check.

### Chunk 5 — Facade guidance, compatibility, and verification

- [x] Connect the new request/response contracts through the facade, add
  context-first prompt guidance, update the browser documentation, and prove
  the first-slice surface remains unchanged.
  - Tests: 48 test files / 631 assertions, Node syntax checks, diagnostics, and
    local managed-browser smoke — PASS.
  - Compliance: satisfies FR-1–FR-3 and FR-22–FR-24 without new tools, routes,
    dependencies, or arbitrary evaluation; docs and changelog are updated. ✓
  - Requirements: FR-1–FR-3, FR-22–FR-24; plan goals: useful low-context
    browser debugging without protocol or dependency drift.
  - Dependencies: Chunks 1–4.
  - TiCoder tests and checks:
    - source contract registers exactly the four tools with additive schemas;
    - guidance prefers compact snapshots, console deltas, and screenshots only
      for visual questions (# FR-22);
    - safeguard defaults, untrusted-page guidance, package-file coverage, and
      no arbitrary evaluation/new route remain green (# FR-1–FR-3, FR-23);
    - Node 18 syntax/diagnostics checks pass on changed files;
    - full `test/*.test.js` suite and the local managed-browser smoke pass
      (# FR-24).

## Dependencies

```text
Chunk 1 ─┐
Chunk 2 ─┼→ Chunk 5
Chunk 3 ─┤
Chunk 4 ─┘
```

## TiCoder validation suite

Normal tests remain dependency-free and browser-binary-free:

```text
node test/browser-tools.test.js
node test/browser-cdp.test.js
```

The tests use deterministic fake CDP sessions for bounds, cursors, revisions,
scaling, and navigation events. An optional `PI_BROWSER_E2E=1` smoke check uses
the local app and an installed Chromium/Edge binary; it is not required for the
normal unit gate.

These tests should expose the missing follow-up behavior before each chunk is
implemented. Each chunk must pass its focused tests and a spec/plan compliance
check before the next chunk begins.

## Terminal checks

- Run the focused browser and policy tests after each relevant chunk.
- Run the complete `test/*.test.js` suite before terminal verification.
- Run primary LSP diagnostics and Node 18-compatible syntax checks on changed
  JavaScript/TypeScript files.
- Confirm the managed viewport remains 1920×1080, attached browsers are not
  resized, no new HTTP route/dependency/arbitrary evaluation is introduced,
  and all model-facing outputs remain bounded.
