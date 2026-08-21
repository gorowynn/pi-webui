# Implementation plan and TiCoder tests: Browser tools

## Task list

### Chunk 1 — CDP WebSocket frame codec

- [x] Add the zero-dependency frame codec and bounded fragment assembler in `extensions/pi_minimal_webui/browser-cdp.js`.
  - Requirements: FR-6, FR-25, FR-26; plan goals: local-only, bounded transport.
  - Dependencies: none.
  - Tests: `test/browser-cdp.test.js` — PASS (14 tests)
    - encode 7-bit, 16-bit, and 64-bit payload lengths with masked client frames (# FR-6);
    - decode and unmask server frames without mutating the source buffer (# FR-6);
    - reassemble text and binary fragmented messages, including interleaved ping/pong (# FR-6);
    - reject invalid RSV bits, reserved opcodes, truncated extended lengths, oversized control frames, and payloads over the configured cap (# FR-6, FR-25);
    - encode close frames and preserve close code/reason bounds (# FR-6).
  - Compliance: satisfies the approved transport bounds and fail-closed framing requirements; the codec has no runtime dependency and leaves the existing RPC/HTTP paths untouched. ✓

### Chunk 2 — CDP discovery and correlated session

- [x] Build target discovery and the narrow CDP session command/event interface on top of the codec.
  - Requirements: FR-5, FR-6, FR-7, FR-26, FR-27; plan goals: one session, existing RPC boundary.
  - Dependencies: Chunk 1.
  - Tests: `test/browser-cdp.test.js` — PASS (17 tests)
    - resolve `/json/version` and `/json/list` to a page target while ignoring non-page targets (# FR-5);
    - complete out-of-order request responses by request id and deliver subscribed events separately (# FR-6);
    - reject protocol errors, peer close, malformed JSON, and unavailable targets with stable error codes (# FR-25);
    - time out concurrent commands and reject queued/in-flight aborts without leaving a permanently pending request (# FR-7, FR-26);
    - keep event subscriptions and close idempotent; high-level browser operation serialization is covered by Chunk 7 (# FR-7, FR-8).
  - Compliance: discovery is HTTP(S)-bounded, the WebSocket session correlates concurrent commands, handles events and ping/pong, and fails pending calls on protocol/timeout/abort paths; it adds no dependency or HTTP route. ✓

### Chunk 3 — Host policy and managed-browser lifecycle

- [x] Add configuration parsing, URL/host validation, managed launch/attach ownership, and cleanup primitives.
  - Requirements: FR-3, FR-4, FR-5, FR-9, FR-10, FR-14, FR-28; plan goals: isolated visible-by-default local browser.
  - Dependencies: Chunk 2.
  - Tests: `test/browser-tools.test.js` — PASS (21 tests)
    - allow the three loopback host forms and configured exact hosts; reject unsupported schemes, credentials, malformed URLs, wildcard entries, and disallowed hosts (# FR-9, FR-10);
    - reject non-loopback or malformed `PI_BROWSER_CDP_URL` and do not fall back to managed launch when explicit attachment is configured (# FR-5, FR-14);
    - build managed launch arguments with a temporary profile, loopback debugging, random port, and optional headless flag, without `--no-sandbox` or default-profile reuse (# FR-3, FR-4);
    - terminate and remove managed resources exactly once while leaving attached processes untouched (# FR-4, FR-8);
    - fail with bounded stable errors for missing binaries, failed discovery, dead targets, and navigation redirects outside the allowlist (# FR-14, FR-25).
  - Compliance: the runtime enforces loopback/exact-host policy, isolates managed profiles, keeps headless opt-in, distinguishes attached ownership, and cleans up idempotently. Navigation/redirect enforcement is completed by the facade chunk. ✓

### Chunk 4 — Bounded semantic snapshot and refs

- [x] Add the controlled page-inspection snapshot normalizer and generation/ref bookkeeping.
  - Requirements: FR-15, FR-16, FR-17, FR-18, FR-19; plan goals: useful bounded model-facing output.
  - Dependencies: Chunk 2.
  - Tests: `test/browser-tools.test.js` — PASS (26 total; snapshot assertions green)
    - normalize page metadata, viewport, visible text, and native/ARIA interactive controls into `pi-webui.browser-snapshot/v1` (# FR-15, FR-16, FR-18);
    - cap page text at 12 KiB and interactive elements at 200 with valid deterministic JSON (# FR-17);
    - bound individual fields, reject non-finite rectangles, omit raw HTML/selectors, and redact password values (# FR-16, FR-17);
    - create manager-owned refs and invalidate them after navigation or a changed snapshot generation (# FR-19);
    - return a valid empty snapshot for a page with no visible content (# FR-15, FR-18).
  - Compliance: the fixed DOM script collects only bounded interactive metadata, the normalizer strips unsafe/raw fields, caps output, redacts password values, and uses monotonic refs so stale handles cannot be silently reused. ✓

### Chunk 5 — Console event collector

- [x] Add bounded Log/Runtime warning and error collection for the active page.
  - Requirements: FR-23, FR-24, FR-25; plan goals: actionable debugging evidence without unbounded output.
  - Dependencies: Chunk 2.
  - Tests: `test/browser-tools.test.js` — PASS (28 total; console assertions green)
    - subscribe to console and exception events and normalize warning/error levels and source locations (# FR-23, FR-24);
    - retain only the newest 50 entries and bound text/source fields (# FR-23, FR-24);
    - ignore info/debug events and malformed event payloads without crashing the session (# FR-23, FR-25);
    - return a valid empty `pi-webui.browser-console/v1` result before any page event (# FR-24).
  - Compliance: the collector subscribes only to warning/error and exception events, retains a bounded newest-first window, strips protocol payloads to stable fields, and returns a valid empty schema. ✓

### Chunk 6 — Screenshot capture and capability fallback

- [x] Add bounded viewport JPEG capture and model-capability-aware tool results.
  - Requirements: FR-20, FR-21, FR-22, FR-25, FR-26; plan goals: optional visual evidence that cannot exhaust RPC/SSE budgets.
  - Dependencies: Chunk 2, Chunk 3.
  - Tests: `test/browser-tools.test.js` — PASS (32 total; screenshot assertions green)
    - request viewport JPEG capture with bounded quality and dimensions (# FR-20);
    - reduce quality or fail closed when decoded image bytes exceed approximately 300 KiB (# FR-20, FR-25);
    - emit one final text block plus one image block with correct MIME and byte metadata for image-capable models (# FR-21);
    - emit metadata and snapshot guidance without image bytes for text-only models (# FR-22);
    - never pass screenshot content through progress updates and honor timeout/abort (# FR-21, FR-26).
  - Compliance: screenshot capture clamps metadata, requests viewport JPEG only, retries within a quality floor, refuses oversized/invalid data, and returns no image bytes to text-only callers. ✓

### Chunk 7 — Extension facade and pi integration

- [x] Register the four tools, connect them to the session manager, enforce queue/lifecycle behavior, and add safeguard/prompt guidance.
  - Requirements: FR-1, FR-2, FR-7, FR-8, FR-11, FR-12, FR-13, FR-14, FR-27, FR-28; plan goals: usable pi-facing browser debugging slice with no new HTTP route.
  - Dependencies: Chunks 3–6.
  - Tests: `test/browser-tools.test.js` plus a source contract check in the same file
    - register exactly the four first-slice names and valid parameter schemas; do not register evaluate or mutation tools (# FR-1);
    - route all calls through the single manager, preserve FIFO ordering, and reuse one target across calls (# FR-2, FR-7);
    - open validates and navigates a local or configured host, returns bounded metadata, and rejects unsafe redirects (# FR-9, FR-10, FR-13, FR-14);
    - snapshot, screenshot, and console expose the specified schemas and stable errors through pi's existing tool-result contract (# FR-15, FR-21, FR-24, FR-25, FR-27);
    - register cleanup on `session_shutdown`, including repeated shutdown and failed-start paths (# FR-8);
    - include untrusted-page guidance and keep arbitrary evaluation absent (# FR-12);
    - preserve existing extension registration, JSONL/RPC behavior, and package-file coverage (# FR-27, FR-28).
  - Tests: `node test/browser-cdp.test.js` (17 passed), `node test/browser-tools.test.js` (33 passed), `node test/policy-engine.test.js` (56 assertions); live Edge facade smoke confirmed managed open/snapshot/screenshot at 1920×1080 with a 52,529-byte JPEG.
  - Compliance: the facade registers exactly the approved four tools, routes calls through one serialized manager, applies safeguard defaults, cleans up on `session_shutdown`, uses only fixed inspection scripts, preserves the existing RPC contract, and enforces the approved isolated/loopback/bounded design. ✓

## Dependencies

```text
Chunk 1 → Chunk 2 → Chunk 3 ─┐
                  ├→ Chunk 4 ├→ Chunk 7
                  ├→ Chunk 5 ┤
Chunk 2 + Chunk 3 → Chunk 6 ┘
```

## TiCoder validation suite

Normal unit tests must remain dependency-free and browser-binary-free:

```text
node test/browser-cdp.test.js
node test/browser-tools.test.js
```

The tests use fake loopback HTTP/WebSocket CDP endpoints and deterministic
fixtures. A live Chromium smoke test is optional and runs only when
`PI_BROWSER_E2E=1`; it is not part of the normal pass/fail gate.

These tests are expected to fail before their corresponding chunks are
implemented. Each chunk is implemented and made green independently before the
next chunk begins.

## Terminal checks

- Run all browser-tool tests and the existing Node test suite.
- Run `node --check` on new CommonJS files and the repository's existing JS
  syntax-check set.
- Run primary diagnostics on changed TypeScript/JavaScript files.
- Confirm no new HTTP route, required dependency, default-profile access,
  `--no-sandbox`, arbitrary evaluation, or unbounded model-facing payload was
  introduced.
