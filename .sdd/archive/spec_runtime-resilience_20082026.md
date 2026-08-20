# Phase 2 Specification — Runtime Resilience

- **Slug:** `runtime-resilience`
- **Date:** 20 August 2026
- **Plan:** [`plan_runtime-resilience_20082026.md`](plan_runtime-resilience_20082026.md)
- **Roadmap anchor:** U7 — Security-review remediation and release unblocking

## User Stories

### US-1 — Pi outage is recoverable

As a WebUI operator, I want an operation attempted while the pi child is stopped to return a clear temporary failure, so that the bridge remains available and I can retry after pi recovers.

### US-2 — Slow clients do not lose the transcript

As a WebUI operator, I want a temporarily slow browser connection to receive queued events in order or reconnect and resynchronize, so that live assistant text and terminal events are not silently lost.

### US-3 — One bad client does not affect other tabs

As a multi-tab user, I want a stalled SSE client to be isolated from healthy clients, so that another tab continues receiving live events normally.

### US-4 — Runtime behavior is regression-proof

As a maintainer, I want deterministic tests for pi-unavailable requests and SSE backpressure, so that future bridge changes cannot reintroduce server crashes or silent event loss.

## Functional Requirements

### REL-06 — Pi-unavailable request handling

**FR-1 — Complete request boundary:** Every HTTP request path that directly or indirectly forwards a payload to pi must contain a request-level failure boundary. This includes `POST /api/cmd`, `DELETE /api/permissions/grants`, `DELETE /api/permissions/grants/:n`, and the awaitable RPC forwarding path. Existing validation, conflict, and success behavior remains unchanged.

**FR-2 — Temporary-unavailability response:** If pi is absent, its stdin is not writable, or the child becomes unavailable before the payload is accepted, the request must:

- keep the Node server running;
- return HTTP `503`;
- use `Content-Type: application/json`;
- return an object with `ok: false` and the stable error text `pi not running`;
- avoid returning a stack trace, child internals, or an unbounded error payload.

**FR-3 — Unexpected forwarding errors:** Errors that are not classified as pi unavailability must also be contained by the request boundary. They return the existing bounded JSON error shape with HTTP `500`; they must not terminate the process or leave the response open.

**FR-4 — No false success:** A forwarding request must never return `{ok:true}` after the write to pi failed. A permission-grant mirror mutation must not be committed when its corresponding forwarding attempt failed. This requirement covers local display state only; authoritative pi acknowledgement semantics remain outside this effort.

**FR-5 — Response completion:** Every handled failure path ends the HTTP response exactly once. A later pi restart must not retroactively change the failed response, and a failed request must remain retryable after pi becomes available.

### REL-09 — SSE backpressure and recovery

**FR-6 — Per-client isolation:** SSE delivery state is independent for each connected response. A paused or discarded client must not block, reorder, or drop events for any other client.

**FR-7 — FIFO delivery:** For a client whose queued data remains within limits, every frame accepted after backpressure is stored and delivered in original broadcast order. Frames already written before `write()` reported backpressure are not duplicated.

**FR-8 — Tail preservation during drain:** If a drain flush becomes saturated again before its queued tail is written, the unwritten suffix remains queued and is retried later in the same order. No queued frame may be discarded solely because a second backpressure transition occurred.

**FR-9 — Bounded queue:** A paused client's pending SSE frames have a fixed per-client ceiling of **1 MiB (1,048,576 UTF-8 bytes)**. The byte count includes the complete serialized SSE frame, including its `data:` prefix and terminator, and excludes frames already accepted by the socket.

**FR-10 — Overflow recovery:** If adding a frame would exceed the per-client ceiling, the server must stop retaining data for that client, remove/close that SSE response, and release its queued memory. The server must continue serving other clients. The existing browser reconnect path must then obtain `/api/snapshot` on `EventSource` open and rebuild committed plus live-turn state; no new client wire message is required.

**FR-11 — Stall recovery:** The existing stalled-client timeout remains bounded at 20 seconds. A client that does not drain within that window is closed and removed so that its queue cannot grow indefinitely. A healthy client and the Node process continue unaffected.

**FR-12 — Write failures are isolated:** A synchronous write or close error for one SSE response removes only that response and its pending queue. It must not escape the broadcast loop or terminate the Node process.

**FR-13 — Wire compatibility:** Normal SSE framing, event ordering, `/api/events`, `/api/snapshot`, live-event replay, and browser `EventSource` reconnect behavior remain compatible with the current implementation. No new endpoint or required client field is introduced.

## Data Models

### API error response

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `ok` | boolean | yes | Always `false` for a handled failure. |
| `error` | string | yes | Stable, bounded human-readable failure text. `pi not running` is used for FR-2. |

### SSE frame

| Field | Type | Meaning |
| --- | --- | --- |
| `wireText` | UTF-8 string | One complete `data: <JSON>\\n\\n` frame delivered to an SSE response. |
| `byteLength` | non-negative integer | UTF-8 byte length of `wireText`, used for the per-client queue ceiling. |
| `payload` | JSON object | The broadcast event encoded inside the frame; its existing shape is unchanged. |

### Per-client SSE delivery state

| Field | Type | Meaning |
| --- | --- | --- |
| `response` | HTTP response handle | The one connected SSE client represented by the state. |
| `paused` | boolean | Whether the response is waiting for a drain event. |
| `pendingFrames` | ordered list of SSE frames | Frames not yet accepted by the socket. |
| `pendingBytes` | non-negative integer | Sum of `byteLength` for `pendingFrames`. |
| `stallDeadline` | timestamp or absent | Bounded deadline after which the stalled response is closed. |

### Recovery outcome

| Outcome | Required behavior |
| --- | --- |
| `delivered` | Pending frames are accepted in FIFO order; client remains connected. |
| `repaused` | The unwritten tail remains pending; delivery resumes on a later drain. |
| `overflow` | Client response is closed and removed; browser reconnect/snapshot recovery is relied upon. |
| `write-error` | Client response is closed/removed; other clients continue. |

## Edge Cases

| Case | Required behavior |
| --- | --- |
| Pi is already stopped before a grant request | Return `503` JSON; keep the server alive; do not mutate the grant mirror or claim success. |
| Pi stops between availability check and stdin write | Treat the write failure as pi unavailability; return the same bounded `503` contract. |
| An unexpected exception occurs while forwarding | Return bounded `500` JSON and finish the response; do not expose a stack or crash the process. |
| A grant revoke/clear send succeeds | Preserve the existing successful `200` response and mirror behavior. Later pi-side acknowledgement is out of scope. |
| First SSE write returns `false` | Retain subsequent frames for that client and enter the existing bounded drain cycle. |
| Drain flush returns `false` part-way through the pending list | Preserve the not-yet-written suffix, including the frame that triggered the second pause, and resume FIFO. |
| A frame brings the queue exactly to 1 MiB | Retain it; the ceiling is inclusive. |
| A frame would take the queue above 1 MiB | Close/remove only that client and rely on reconnect plus snapshot recovery. |
| A single frame is larger than 1 MiB | Do not retain it; close/remove that client using the same overflow recovery. |
| Client closes while paused or while a drain callback is pending | Remove the client and release pending frames; a late callback must be harmless. |
| Two clients have different write states | Deliver independently; a slow client must not change the ordering or availability of a healthy client. |
| Queue contains multibyte text | Count UTF-8 bytes, not JavaScript UTF-16 code units, and preserve the original text when delivered. |
| Browser reconnects after overflow or stall timeout | Preserve current browser behavior: mark reconnecting, open `/api/events`, then fetch `/api/snapshot` and replay any current live events. |

## Scope Boundaries

### In scope

- REL-06 request-level containment for pi-forwarding API paths.
- REL-09 FIFO SSE tail preservation, per-client byte bounding, and reconnect recovery.
- Regression tests and project-history/verification updates for these requirements.

### Explicitly out of scope

- REL-07, REL-08, and REL-14 implementation work; the roadmap records these as fixed and they require verification only.
- Broker tombstones, acknowledgement-until-terminal semantics, snapshot generations, live-buffer coalescing, process readiness/termination, Git safety, authentication, and package-release remediation; these are later U7 items.
- Changes to the RPC/SSE wire protocol, pi acknowledgement semantics, or browser UI design.
