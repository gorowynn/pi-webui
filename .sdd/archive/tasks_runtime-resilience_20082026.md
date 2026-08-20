# Phase 3 Implementation Plan & TiCoder Tests — Runtime Resilience

- **Slug:** `runtime-resilience`
- **Date:** 20 August 2026
- **Plan:** [`plan_runtime-resilience_20082026.md`](plan_runtime-resilience_20082026.md)
- **Specification:** [`spec_runtime-resilience_20082026.md`](spec_runtime-resilience_20082026.md)

## Execution Rules

- Execute one unchecked chunk at a time.
- Each chunk must pass its tagged tests and receive a compliance note before the next chunk starts.
- Keep the implementation CommonJS/Node-built-in only; do not change the RPC or SSE wire contract.
- Use the existing no-framework `node:assert/strict` test style.
- The proposed tests below target the current defects and should be red before implementation. They become the TiCoder gate for Phase 4.

## Ordered Task List

### [x] T1 — Define bounded SSE delivery state and its unit contract

- **Plan goals:** preserve live event fidelity; bound slow-client memory.
- **Requirements:** FR-6, FR-7, FR-8, FR-9, FR-10, FR-12.
- **Dependencies:** none.
- **Expected files:** new `sse-queue.js`; new `test/sse-queue.test.js`.
- **Work:** add the smallest dependency-free, testable delivery-state seam for one SSE response. It must represent pending frames, UTF-8 byte accounting, FIFO enqueue/drain transitions, inclusive 1 MiB capacity, overflow, and idempotent close. Keep the default stall limit at 20 seconds; allow the test harness to exercise timeout behavior without waiting 20 seconds.

**TiCoder tests — `test/sse-queue.test.js`**

- **T1.1 — UTF-8 accounting (# FR-9):** multibyte frame sizes use UTF-8 bytes rather than UTF-16 code units; a queue exactly at 1,048,576 bytes is accepted and the next exceeding frame returns overflow.
- **T1.2 — FIFO enqueue/drain (# FR-7):** frames queued after backpressure are emitted once and in original order.
- **T1.3 — Re-pause tail preservation (# FR-8):** if a drain write saturates midway, the unwritten suffix remains pending and the next drain emits only that suffix, without duplication.
- **T1.4 — Oversized frame (# FR-9, FR-10):** a single frame larger than the ceiling produces overflow and is not retained.
- **T1.5 — Close safety (# FR-10, FR-12):** close clears pending state, is idempotent, and late drain/write callbacks cannot throw or resurrect the queue.
- **T1.6 — Stall deadline (# FR-11):** a stalled state reaches the close outcome at the bounded deadline and does not retain data afterward.

**T1 compliance:** Implemented `sse-queue.js` and `test/sse-queue.test.js`. All six focused tests pass with `node test/sse-queue.test.js` (exit 0), covering UTF-8/inclusive-capacity accounting, FIFO drain, re-pause tail retention, overflow, idempotent close, and stall cleanup.

### [x] T2 — Integrate bounded delivery into the SSE server path

- **Plan goals:** preserve live event fidelity; isolate unhealthy tabs; keep the existing reconnect/snapshot behavior.
- **Requirements:** FR-6 through FR-13.
- **Dependencies:** T1.
- **Expected files:** `server.js`; new or extended `test/sse-transport.test.js`.
- **Work:** replace the current ad-hoc per-response queue transitions with the approved delivery seam, preserving `/api/events`, heartbeats, normal frame text, per-client isolation, and the existing browser reconnect path. On overflow/stall/write failure, remove only the affected response and release its queue.

**TiCoder tests — `test/sse-transport.test.js`**

- **T2.1 — Healthy-client isolation (# FR-6):** a paused fake response accumulates its own frames while a healthy fake response receives every broadcast in order.
- **T2.2 — Drain re-pause integration (# FR-7, FR-8):** a fake response returning `false` during a mid-tail flush retains the suffix and later delivers it exactly once.
- **T2.3 — Overflow isolation (# FR-9, FR-10):** exceeding the cap closes/removes only the slow response; another response remains writable and receives later events.
- **T2.4 — Write/close failures (# FR-12):** a thrown write or late close/drain callback does not escape the broadcast path or remove healthy clients.
- **T2.5 — Stall cleanup (# FR-11):** the bounded timeout removes a non-draining client and releases its pending frames.
- **T2.6 — Wire/reconnect contract (# FR-13):** normal frames remain `data: <JSON>\\n\\n`, `/api/events` remains an SSE endpoint, and the existing `EventSource.onopen` path still calls `fetchSnapshot()`.

**T2 compliance:** Wired `server.js` to `createSseDelivery`, including connected/heartbeat frames, per-client cleanup, bounded overflow, stall handling, and FIFO drain recovery. All six transport tests pass with `node test/sse-transport.test.js` (exit 0). Primary diagnostics are clean apart from the existing CommonJS-module conversion hint.

### [x] T3 — Contain pi-forwarding failures and protect grant mirrors

- **Plan goals:** keep the bridge alive during pi outages; provide bounded retryable failures.
- **Requirements:** FR-1, FR-2, FR-3, FR-4, FR-5.
- **Dependencies:** T2 (single-writer sequencing in `server.js`).
- **Expected files:** `server.js`; new or extended `test/runtime-resilience.test.js`.
- **Work:** put every pi-forwarding HTTP path behind one consistent failure boundary, including `/api/cmd`, `/api/rpc`, and both permission-grant mutation endpoints. Map child-unavailable writes to the specified `503` response, retain bounded `500` handling for unexpected errors, finish each response once, and commit the grant display mirror only after its forward write succeeds. Do not alter broker acknowledgement semantics beyond preventing a false HTTP success.

**TiCoder tests — `test/runtime-resilience.test.js`**

- **T3.1 — Pi unavailable contract (# FR-1, FR-2, FR-5):** with a child-unavailable test server, `POST /api/cmd`, `POST /api/rpc`, `DELETE /api/permissions/grants`, and `DELETE /api/permissions/grants/:n` each return HTTP `503`, JSON `ok:false`, exact `error:"pi not running"`, and a bounded body.
- **T3.2 — Server remains alive (# FR-2, FR-5):** after each failed request, `GET /api/health` still returns successfully and a later retry is possible.
- **T3.3 — Unexpected error boundary (# FR-1, FR-3):** an injected non-unavailability forwarding failure returns bounded HTTP `500` JSON without a stack trace, leaves no hanging response, and keeps the process alive.
- **T3.4 — No false success (# FR-4):** a failed grant clear/revoke does not return `{ok:true}` and does not change the grant mirror; a successful forwarding attempt preserves the existing `200` response and mirror behavior.
- **T3.5 — Existing validation compatibility (# FR-1, FR-3):** malformed bodies and existing validation/conflict responses remain unchanged rather than being misclassified as pi outages.

**T3 compliance:** Added `PiUnavailableError` classification and a bounded shared `503`/`500` response boundary; grant mirror commits now follow successful forwarding. `test/runtime-resilience.test.js` passes (exit 0), covering four unavailable-pi routes, server liveness, malformed RPC body compatibility, injected unexpected errors, and commit-order source contracts. The guarded `require.main` startup also provides a non-listening test seam without changing `node server.js` behavior.

### [x] T4 — Run the compatibility gate and record completion evidence

- **Plan goals:** release confidence and durable resumption/verification evidence.
- **Requirements:** FR-1 through FR-13.
- **Dependencies:** T1, T2, and T3.
- **Expected files:** `CHANGELOG.md`; `.sdd/tasks_runtime-resilience_20082026.md` compliance notes; terminal `.sdd/verify_runtime-resilience_20082026.md`.
- **Work:** run the three focused tests and the existing test suite, run the documented live RPC/SSE smoke test when a pi binary is available, inspect the final diff for wire-contract drift, and record the completed runtime-resilience chunk in the changelog. Do not archive the SDD set until every prior chunk is checked and the verification artifact maps every FR to evidence.

**TiCoder tests/checks — T4**

- **T4.1 — Focused suite (# FR-1 through FR-13):** `node test/sse-queue.test.js`, `node test/sse-transport.test.js`, and `node test/runtime-resilience.test.js` all pass.
- **T4.2 — Existing suite (# FR-13):** every existing `test/*.test.js` remains green.
- **T4.3 — Live compatibility (# FR-13):** `node test/rpc-sse.test.js` passes when run with a booted pi process, or the verification artifact records why the live smoke test was unavailable.
- **T4.4 — Diff hygiene (# FR-13):** `git diff --check` passes and no new runtime dependency, endpoint, or required browser field is introduced.

**T4 compliance:** Focused runtime tests, package whitelist, live RPC/SSE smoke, primary diagnostics, `git diff --check`, and all 44 repository test files pass. The user-requested `ARG_SENSITIVE` object-dispatch fix also unblocked `bash-classifier.test.js`, `policy-engine.test.js`, and `safeguard-contract.test.js`. Verification details are in `.sdd/verify_runtime-resilience_20082026.md`; all four SDD artifacts are ready for archival.

## Dependencies

```text
T1 ──▶ T2 ──▶ T3 ──▶ T4
```

T1 is a standalone queue contract. T2 wires that contract into the server. T3 then changes the remaining `server.js` request paths in the same controlled lane. T4 is the terminal compatibility and evidence gate.

## Phase 4 Gate

All implementation chunks, TiCoder checks, requirement traceability, and the full repository test gate are complete. The four SDD artifacts may be archived.
