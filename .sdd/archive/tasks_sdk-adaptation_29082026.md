# Implementation Plan & TiCoder Test Suite: SDK adaptation

## Execution Rules

- Implement exactly one chunk at a time.
- Add or extend that chunk's tests before implementation; new assertions should fail against a baseline that lacks the behavior. The current working tree already contains part of the migration, so any pre-existing green adapter tests must be treated as baseline coverage and extended with regression assertions.
- Run the chunk's focused tests, fix until green, then re-open the approved plan and specification and record a compliance note beneath the completed checklist item.
- Do not restore the Pi CLI/RPC subprocess for the primary session. Keep the browser protocol stable and keep SDK-specific behavior inside the adapter/server boundary.
- Preserve project trust disabled, package-owned extension loading, workspace containment, approval broker semantics, live-buffer replay, compaction-aware snapshots, secondary-run isolation, JetBrains no-switch mode, and the zero-build asset contract.
- No new product features are part of this run; only migration completion, compatibility, hardening, packaging, documentation, and verification.

## Dependency Graph

- `C1 → C2 → C3 → C4 → C5`
- `C1 → C6`
- `C1 → C7`
- `C5`, `C6`, and `C7` → `C8`

## Runtime ownership and startup

- [x] **C1 — Establish the SDK runtime contract and startup boundary**
  - **Delivers:** FR-1 through FR-6, FR-38; US-1, US-7, US-8.
  - **Change:** Make the official SDK runtime, resolved configuration, package-owned extension boundary, readiness state, initialization failure behavior, disposal contract, and package engine/dependency expectations explicit and testable. Remove any remaining primary-session process fallback.
  - **TiCoder tests:** `test/pi-sdk-runtime.test.js`, `test/runtime-resilience.test.js`, and `test/package.test.js`
    - SDK-shaped startup receives cwd, agent directory, session directory, and bundled extension configuration, with project trust disabled (# FR-1, FR-2, FR-29);
    - repeated start while ready does not create a second runtime and publishes one readiness event (# FR-3);
    - startup failure leaves the HTTP surface usable, emits a bounded failure, retries with a capped delay, and clears broker/secondary state (# FR-4, FR-5);
    - disposal unsubscribes events, cancels pending UI, and releases the runtime (# FR-5);
    - package metadata has the SDK dependency, supported Node engine, adapter, and bundled extension in the published file set (# FR-6, FR-35);
    - source-level contract rejects a primary `spawn`/stdin/stdout JSONL transport and does not fall back when the SDK is unavailable (# FR-1, FR-2).
  - **Depends on:** none.
  - **Phase 4 result:** PASS — `node test/pi-sdk-runtime.test.js`, `node test/runtime-resilience.test.js`, `node test/package.test.js`, and `node --check pi-sdk-runtime.js` all pass.
  - **Compliance:** the adapter now validates required runtime configuration, is idempotent while ready, filters missing bridge extensions without loading workspace-local extensions, cleans up partial startup failures, and releases listeners/runtime references during disposal. The package whitelist and SDK-shaped startup/trust tests remain green. ✓

## Browser command compatibility

- [x] **C2 — Complete and validate the SDK command adapter**
  - **Delivers:** FR-7 through FR-12, FR-38; US-2, US-3, US-8.
  - **Change:** Verify the browser command envelope and map every existing primary command to the corresponding SDK session/runtime behavior. Define malformed, unavailable, not-ready, cancelled, overlapping, and SDK-error results without changing the browser-facing response shape.
  - **TiCoder tests:** new `test/sdk-command-contract.test.js`, `test/pi-sdk-runtime.test.js`, and `test/rpc-sse.test.js`
    - prompt, steer, follow-up, abort, queue clearing, model/thinking controls, compaction/retry, bash, stats, session navigation, entries/tree, rename, messages, commands, and available-model queries reach the SDK-shaped session (# FR-8);
    - unknown commands, missing values, unavailable models, invalid paths, and thrown SDK methods produce bounded failure responses without unrelated state mutation (# FR-9);
    - prompt preflight acknowledgement occurs once and later settlement does not duplicate the command response (# FR-10);
    - awaitable commands resolve only after their SDK operation completes, while event publication remains separate from command completion (# FR-11);
    - concurrent switch/dispose/command operations return a defined stale/not-ready/cancelled result and cannot mutate the replacement session (# FR-12, FR-21);
    - browser requests never select executables, cwd, agent directories, or extension paths (# FR-7, FR-22).
  - **Depends on:** C1.
  - **Phase 4 result:** PASS — `node --check pi-sdk-runtime.js`, `node test/sdk-command-contract.test.js`, `node test/pi-sdk-runtime.test.js`, and `PORT=4317 node test/rpc-sse.test.js` all pass.
  - **Compliance:** the SDK adapter now validates required command data, maps the existing prompt/session/model/thinking/compaction/bash command surface, preserves prompt preflight acknowledgement, returns bounded unknown/not-ready/model/argument errors, and rejects stale responses after disposal through the runtime generation guard. Browser commands remain inside the SDK adapter with no executable or path selection fields. ✓

## Events and snapshots

- [x] **C3 — Preserve event normalization, ordering, and snapshot reconstruction**
  - **Delivers:** FR-13 through FR-18, FR-38; US-4, US-8.
  - **Change:** Make the SDK event-to-SSE normalization contract explicit, preserve assistant/tool/retry/compaction/extension events, and ensure `/api/snapshot` combines SDK state with compaction-aware entries, live replay, approvals, and secondary runs without stale or duplicate data.
  - **TiCoder tests:** new `test/sdk-events.test.js`, `test/pi-sdk-runtime.test.js`, `test/livebuf.test.js`, `test/session-entries.test.js`, and `test/rpc-sse.test.js`
    - assistant text/usage deltas, tool identity, tool lifecycle, agent lifecycle, retry, compaction, extension error, and server events retain the fields required by the browser (# FR-13, FR-14);
    - partial SDK assistant/tool payloads normalize safely, unknown events do not crash publication, and UTF/event ordering remains stable (# FR-13, FR-14);
    - rebinding removes the previous subscription so one SDK event produces one SSE delivery and one live-buffer sequence (# FR-15);
    - snapshot includes runtime state, visible parent-chain messages, commands, models, stats, current-turn replay, pending approvals, and secondary projections (# FR-16, FR-18);
    - startup/disposal/replacement/read failure returns explicit unavailable/null state rather than prior-workspace data or a server exception (# FR-17);
    - reconnect during a turn restores only bounded current-turn events and preserves compaction markers (# FR-15, FR-18).
  - **Depends on:** C2.
  - **Phase 4 result:** PASS — `node --check pi-sdk-runtime.js`, `node test/sdk-events.test.js`, `node test/pi-sdk-runtime.test.js`, `node test/livebuf.test.js`, `node test/session-entries.test.js`, and `PORT=4317 node test/rpc-sse.test.js` all pass.
  - **Compliance:** SDK assistant/tool partial events now normalize without leaking incomplete `partial` payloads; session rebinding removes the old subscription and advances the generation; snapshot state remains current-session based, while the server preserves live-buffer, compaction-aware history, approvals, and secondary projections. ✓

## Session and workspace lifecycle

- [x] **C4 — Harden runtime replacement, stale work, and multi-client lifecycle**
  - **Delivers:** FR-19 through FR-24, FR-38; US-3, US-4, US-5, US-8.
  - **Change:** Make workspace/session replacement an explicit SDK lifecycle boundary. Ensure old runtimes cannot publish, resolve, or complete work after replacement, and preserve server-authoritative workspace discovery, no-switch IDE mode, secondary cancellation, and multi-tab convergence.
  - **TiCoder tests:** `test/runtime-resilience.test.js`, `test/status-race.test.js`, `test/permissions-api.test.js`, `test/workspaces.test.js`, and `test/rpc-sse.test.js`; secondary-run cancellation/completion remains covered by C6 after its legacy PI_BIN fixture is migrated.
    - workspace switch disposes the old runtime before readiness for the new workspace, clears live events and approvals, and emits one ordered workspace-change event (# FR-19);
    - session switch, new session, fork, clone, and reload rebind listeners once and update state without duplicate events (# FR-20);
    - late old-runtime events, command responses, and approval resolutions are ignored or bounded as stale (# FR-21);
    - workspace discovery, realpath containment, deleted-project removal, and IDE no-switch mode remain enforced (# FR-22, FR-34);
    - shutdown clears primary-scoped secondary runs, approvals, and replay state without deleting persisted sessions/configuration (# FR-23);
    - two SSE clients observe one server-owned runtime and first-response-wins approval behavior without duplicate primary sessions (# FR-24).
  - **Depends on:** C3.
  - **Phase 4 result:** PASS — `node --check server.js`, `node test/runtime-resilience.test.js`, `node test/status-race.test.js`, `node test/permissions-api.test.js`, `node test/workspaces.test.js`, and `PORT=4317 node test/rpc-sse.test.js` all pass.
  - **Compliance:** SDK startup is serialized, workspace switches are queued, old runtime callbacks are ignored, in-flight commands return a bounded `runtime changed` response, stale forwarding maps to HTTP 409, and workspace/path/IDE/approval boundaries remain intact. The old `secondary-api.test.js` fixture still targets the removed PI_BIN path and is explicitly deferred to C6 rather than treated as lifecycle evidence. ✓

## Extension bridge and permissions

- [x] **C5 — Verify browser UI, approval broker, and trust-boundary compatibility**
  - **Delivers:** FR-25 through FR-30, FR-38; US-5, US-6, US-8.
  - **Change:** Complete the SDK binding contract for the package-owned extension and make every browser-backed dialog/approval path preserve existing broker, safeguard, provenance, and trust behavior.
  - **TiCoder tests:** `test/pi-sdk-runtime.test.js`, `test/broker.test.js`, `test/permissions-api.test.js`, `test/permission-ux.test.js`, `test/trust-boundary.test.js`, and `test/safeguard-contract.test.js`
    - select/confirm/input/editor/status requests are emitted with opaque IDs and bounded browser payloads through SDK JSON/browser mode (# FR-25, FR-26);
    - dialog timeout, abort, runtime replacement, and malformed response resolve safely and never hang the SDK session (# FR-26);
    - first response wins, stale IDs/tool markers are rejected, validated responses resolve the matching UI promise, and acknowledgement is broadcast after resolution (# FR-27);
    - reconnect snapshots replay only active approvals and replacement/shutdown clears them (# FR-28);
    - project trust remains false and only the package-owned bridge extension is loaded; project-local extensions cannot run by opening a workspace (# FR-29);
    - safeguard policy, bash classification, path containment, audit provenance, todo discipline, questionnaire, and browser tools remain authoritative with no SDK bypass (# FR-30).
  - **Depends on:** C4.
  - **Phase 4 result:** PASS — `node test/pi-sdk-runtime.test.js`, `node test/broker.test.js`, `node test/permissions-api.test.js`, `node test/permission-ux.test.js`, `node test/trust-boundary.test.js`, and `node test/safeguard-contract.test.js` all pass.
  - **Compliance:** the SDK bridge covers select/confirm/input/editor/status requests with timeout/abort handling and bounded payloads; broker first-response/stale-marker rules, approval acknowledgement, reconnect clearing, project trust disabling, bundled-extension-only loading, and safeguard authority remain intact. ✓

## Isolated prompts and existing integrations

- [x] **C6 — Keep isolated prompts and existing surfaces independent of the primary SDK runtime**
  - **Delivers:** FR-31 through FR-34, FR-38; US-7, US-8.
  - **Change:** Verify the isolated prompt/advisor path uses its own bounded no-tool execution boundary, and audit Git, research, fleet, usage, diff, image, SDD, browser-CDP, launcher, and JetBrains integrations for assumptions that the primary agent is a child process.
  - **TiCoder tests:** `test/isolated-prompt.test.js`, `test/secondary-api.test.js`, `test/advisor-api.test.js`, `test/web-search-wiring.test.js`, `test/github-interceptor.test.js`, `test/browser-tools.test.js`, plus the existing JetBrains Kotlin contract tests via `jetbrains/gradlew test`
    - isolated prompt/advisor calls do not add primary entries/messages/tools/approvals/todos or alter primary state (# FR-31);
    - isolated runs retain no-tool/no-extension, bounded input/output/time, cancellation, redaction, and independent auth/profile behavior (# FR-32);
    - existing server-side Git/research/fleet/usage/diff/image/SDD/browser tools do not call removed primary-process hooks (# FR-33);
    - standalone launcher starts the SDK server and IDE launcher preserves host cwd/no-switch behavior without project extension loading (# FR-34);
    - primary and isolated failures remain independently reportable and cannot cancel or steer the other run (# FR-31, FR-32).
  - **Depends on:** C1.
  - **Phase 4 result:** PASS — `node test/isolated-prompt.test.js`, `node test/secondary-api.test.js`, `node test/advisor-api.test.js`, `node test/web-search-wiring.test.js`, `node test/github-interceptor.test.js`, and `node test/browser-tools.test.js` all pass; the two provider-backed HTTP fixtures safely skip unless `PI_WEBUI_LIVE_INTEGRATION=1`.
  - **Compliance:** isolated runs now accept an SDK-shaped test double, retain separate no-tool/no-extension resources, bounded prompt/output behavior, cancellation, and disposal, while existing server-side integrations remain separate from the primary runtime. JetBrains Gradle verification was attempted but is environment-blocked because no Java/JAVA_HOME is installed; it remains in the final release gate. ✓

## Packaging and documentation

- [x] **C7 — Align release metadata and architecture documentation**
  - **Delivers:** FR-35 through FR-37, FR-38; US-7.
  - **Change:** Remove stale primary-RPC/process claims from source guidance, launcher/environment docs, roadmap, tests, and JetBrains notes; retain historical migration wording only where labelled. Align package metadata, lockfile, engine, dependency, file list, start instructions, and changelog.
  - **TiCoder tests:** `test/package.test.js`, `test/shell-contract.test.js`, `test/runtime-resilience.test.js`, and a new `test/sdk-docs-contract.test.js`
    - package dry-run includes the SDK adapter, required extension, public assets, and supported startup files (# FR-35);
    - lockfile resolves the declared SDK dependency and metadata agrees on Node support and installation/startup behavior (# FR-35, FR-36);
    - launcher and environment references do not advertise obsolete primary `PI_BIN`/`PI_ARGS` configuration, while historical notes are explicitly labelled (# FR-36, FR-37);
    - docs, comments, roadmap, tests, and JetBrains documentation consistently describe SDK ownership and preserved browser protocol (# FR-37);
    - the documented zero-build install path works from a packed artifact rather than only the repository working tree (# FR-35, FR-36).
  - **Depends on:** C1.
  - **Phase 4 result:** PASS — `node test/sdk-docs-contract.test.js`, `node test/package.test.js`, `node test/shell-contract.test.js`, and `npm pack --dry-run` all pass.
  - **Compliance:** current architecture docs, launcher comments, roadmap, browser-tool design, tests, JSONL helper wording, and guidance now identify the SDK runtime and no longer advertise the primary CLI/RPC transport. The package includes the adapter and bundled bridge, and metadata/file-list checks pass. The dated security review is explicitly labelled historical. ✓

## Final verification

- [x] **C8 — Run the complete SDK adaptation release gate**
  - **Delivers:** FR-38 through FR-40 and all plan success criteria.
  - **Change:** Add only final contract fixtures or corrections required by verification. Run focused and complete tests, package checks, live standalone smoke checks, narrow browser checks, and JetBrains verification. No new product behavior belongs in this chunk.
  - **TiCoder tests/commands:**
    - `node --check pi-sdk-runtime.js server.js isolated-prompt.js` and all changed JavaScript files (# FR-38);
    - `node test/pi-sdk-runtime.test.js`, SDK command/event tests, runtime/transport, session/compaction, broker/permissions, secondary/advisor, package, and integration tests (# FR-38, FR-39);
    - `npm test` / complete `node test/*.test.js` suite with no regressions in trust boundary, safeguard, todo, questionnaire, fleet, rail, Git, web, browser, reconnect, or usage contracts (# FR-39);
    - `npm pack --dry-run` plus install/start from the packed artifact verifies published-file completeness (# FR-35, FR-39);
    - live `/api/health`, prompt streaming, tool approval, session switch, workspace switch, reconnect during a turn, compaction snapshot, isolated prompt, and shutdown checks (# FR-40);
    - standalone desktop and narrow viewport browser checks plus JetBrains no-switch/focus/overflow checks show no new console errors or security regressions (# FR-34, FR-40);
    - source scan confirms no primary child-process/RPC forwarding path remains and no stale runtime is still able to publish after replacement (# FR-1, FR-19, FR-21).
  - **Depends on:** C5, C6, and C7.
  - **Phase 4 result:** PASS — automated gate PASS (`npm test`: 65/65; focused SDK, package, shell, docs, artifact, health/snapshot, SSE, source-scan, and shutdown checks pass). The unavailable Chromium/Edge, Java/JAVA_HOME, and live-provider checks are accepted environmental deferrals per release decision. See `.sdd/verify_sdk-adaptation_29082026.md`.
  - **Compliance:** FR-1–FR-40 are covered by passing automated contracts and the available runtime subset of FR-40; no code defect was found in this gate. Desktop/narrow browser, reconnect/approval visual, and JetBrains checks remain documented as post-release environment checks. ✓

## Required Phase 4 checkpoint format

Each completed chunk MUST record:

- the exact test command(s) and PASS output;
- a compliance note mapping its FRs and plan goals to the implementation;
- any approved deviation or deferred scope before the next chunk begins.

These tests express the approved requirements. They should fail for behavior not yet implemented; existing green migration tests are not evidence that the full adaptation is complete.
