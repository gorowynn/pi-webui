# Phase 1 Plan — Runtime Resilience

- **Slug:** `runtime-resilience`
- **Date:** 20 August 2026
- **Roadmap anchor:** U7 — Security-review remediation and release unblocking

## Problem Statement

The security review identifies immediate runtime failure modes that can make the WebUI unreliable: operations attempted while pi is unavailable can escape safely handled request flow, and live SSE delivery must remain lossless under client backpressure. These failures undermine trust in the bridge and can leave the browser transcript out of sync with the agent.

This focused effort covers the documented REL-06 and REL-09 scope. REL-07, REL-08, and REL-14 are treated as verification-only items because the roadmap records them as fixed; later runtime findings (REL-10 onward) remain separate work.

## Business Goals

- Keep the Node bridge alive when pi is unavailable and report a bounded, actionable failure to the caller.
- Preserve live event fidelity for slow or temporarily saturated SSE clients, with recovery rather than silent loss.
- Establish regression coverage that supports release confidence without changing the existing RPC/SSE contract.

## Constraints

- Preserve the zero-build, zero-runtime-dependency architecture and existing RPC/SSE wire contracts.
- Support the current Node 18+ and Windows/POSIX runtime targets.
- Keep the effort limited to the REL-06/REL-09 runtime-resilience boundary and its tests; do not fold in Git safety or later broker/process-lifecycle findings.
- Follow the SDD gates: specification and approved TiCoder tests precede source changes, and each implementation chunk is verified independently.

## Success Criteria

- Every affected API path handles a stopped or unavailable pi child without terminating the server and returns a bounded failure response.
- SSE backpressure does not silently discard queued events; the documented recovery behavior is deterministic when a client cannot keep up.
- Regression tests reproduce the two failure classes and pass alongside the existing test suite.
- The implementation can be mapped directly to the approved specification, with a completed verification artifact and updated project history when the run finishes.
