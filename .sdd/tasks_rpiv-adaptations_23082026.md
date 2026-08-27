# Implementation Plan & TiCoder Test Suite: rpiv adaptations

**Status:** Phase 4 — W04 complete; paused before W05 pending the next approval.

Each chunk is one independently verifiable change. Execute chunks in order, one at a time, and record the test result plus a plan/spec compliance note beneath the checklist item during Phase 4.

## Dependency graph

- `C01 → C02 → C03 → C04`
- `C03 → C05 → C06 → C07`
- `W01 → W02`, `W01 → W03 → W03b`, `W01 → W04`, then `W02/W03b/W04 → W05`
- `F01 → F02 → F03`
- `A01 → A02`
- `T01 → T02`
- `C04`, `C07`, `W05`, `F03`, `A02`, and `T02` → `V01`

## Secondary runs and side questions

- [x] **C01 — Add the secondary-run contract and state machine**
  - **Delivers:** FR-1, FR-4, FR-6, FR-7, FR-8; plan goals for bounded, isolated, transcript-free runs.
  - **Change:** Define the shared request identity, lifecycle states, terminal-state idempotency, size/time limits, safe error envelope, and workspace/session invalidation rules as a pure zero-dependency seam.
  - **TiCoder tests:** `test/secondary-runs.test.js`
    - unique IDs and allowed lifecycle transitions (# FR-1);
    - input/output/time limit validation and truncation provenance (# FR-4);
    - duplicate/late terminal responses are ignored (# FR-6);
    - errors redact paths, arguments, keys, and process dumps (# FR-7);
    - workspace switch and Pi shutdown clear active state (# FR-8).
  - **Depends on:** none.
  - **Phase 4 result:** PASS — `node test/secondary-runs.test.js` (9 passed). FR-1/4/6/7 are covered by the pure lifecycle, bounds, terminal-idempotency, and public-error tests; workspace/Pi invalidation is exercised through the server batch.

- [x] **C02 — Generalize the disposable no-tool runner**
  - **Delivers:** FR-2, FR-4, FR-5, FR-7; plan goal for isolated side/advisor execution.
  - **Change:** Extend the existing isolated prompt seam to accept bounded read-only context, explicit cancellation, timeout, and no-tool execution while preserving the existing auth/profile boundary and model selection behavior.
  - **TiCoder tests:** `test/isolated-prompt.test.js`
    - runner invocation contains no-tools/no-extension restrictions (# FR-2);
    - context and output caps produce explicit truncation flags (# FR-4);
    - cancellation terminates the child and returns `cancelled`, not success (# FR-5);
    - timeout, malformed JSONL, and child failure return bounded errors (# FR-7).
  - **Depends on:** C01.
  - **Phase 4 result:** PASS — `node test/isolated-prompt.test.js` (21 passed) and `node --check isolated-prompt.js`. The runner keeps no-tools/no-extensions/no-skills, bounds input/output, supports cancellation, and uses coded bounded failures.

- [x] **C03 — Add server-owned secondary-run lifecycle plumbing**
  - **Delivers:** FR-1, FR-3, FR-5, FR-6, FR-7, FR-8; plan goal for no primary-session mutation.
  - **Change:** Add server-side creation, status, cancellation, and terminal delivery for secondary runs. Keep them out of Pi RPC/session JSONL, guard requests with existing host/CSRF/body limits, and invalidate them on workspace/Pi lifecycle changes.
  - **TiCoder tests:** `test/secondary-api.test.js` and focused additions to `test/rpc-sse.test.js`/`test/runtime-resilience.test.js`
    - create/status/cancel request IDs are validated and isolated (# FR-1, FR-5);
    - no secondary operation forwards a primary RPC command or writes session history (# FR-3);
    - stale/duplicate responses are ignored and active runs are cleared on restart/switch (# FR-6, FR-8);
    - unauthorized, oversized, and malformed requests fail safely (# FR-7).
  - **Depends on:** C02.
  - **Phase 4 result:** PASS — `node test/secondary-api.test.js` plus `node --check server.js`. HTTP/SSE completion, context truncation, cancellation, malformed requests, stale IDs, and primary-child isolation are covered with a fake Pi.

- [x] **C04 — Add the transcript-free side-question surface**
  - **Delivers:** FR-9 through FR-15, FR-58, FR-59; plan goals for side questions and compatibility with the existing composer.
  - **Change:** Add a command-palette/keyboard entry point, separate side panel, bounded primary-context snapshot, follow-up thread, cancel action, copy-to-composer action, and explicit non-transcript labelling. Do not alter the existing primary send/stop/steer paths.
  - **TiCoder tests:** `test/side-question-ux.test.js`
    - projection renders queued/running/completed/failed/cancelled states (# FR-9, FR-11);
    - follow-ups remain side-only and copy is explicit (# FR-12, FR-15);
    - close/cancel emits only secondary actions, never primary stop/deny/steer (# FR-13);
    - context snapshot is bounded and marks truncation (# FR-10);
    - controls expose labels, focus order, and coarse status text (# FR-58, FR-59).
    - Manual smoke: primary turn continues while side question runs; reload/workspace switch leaves no transcript entry; verify desktop, 720px, and 480px layouts.
  - **Depends on:** C03.
  - **Phase 4 result:** PASS — `node test/secondary-ux.test.js` (5 passed), `node --check public/app.js`, and desktop browser load verified. The separate panel, command-palette entry, bounded context/thread projection, cancel, and copy-to-composer paths are implemented; direct interactive/narrow-device smoke remains for the next verification pass.

## Advisor/reviewer

- [x] **C05 — Define advisor request and result normalization**
  - **Delivers:** FR-16 through FR-19, FR-22, FR-23; plan goal for structured reviewer output.
  - **Change:** Define source-context selection, reviewer model provenance, verdict normalization (`proceed`, `revise`, `stop`, `unavailable`), bounded summary/risks/actions, truncation metadata, and retryable failure states.
  - **TiCoder tests:** `test/advisor-contract.test.js`
    - draft, assistant-turn, and request-context inputs normalize correctly (# FR-16, FR-17);
    - valid and malformed reviewer output maps to the four verdicts without false success (# FR-19, FR-22);
    - model, completion time, and truncation provenance are retained (# FR-23);
    - empty, unavailable, aborted, and timed-out results are retryable (# FR-22).
  - **Depends on:** C01.
  - **Phase 4 result:** PASS — `node test/advisor-contract.test.js` (10 passed), `node --check advisor-contract.js`, `node test/package.test.js`, and all 57 `test/*.test.js` files passed.
  - **Compliance:** `advisor-contract.js` normalizes all three source kinds, selected/default model provenance, bounded structured verdicts, completion/context/output truncation metadata, and retryable unavailable failures; `package.json` ships the contract.

- [x] **C06 — Add isolated advisor execution**
  - **Delivers:** FR-18, FR-20, FR-21, FR-22; plan goal for stronger-model review without mutation.
  - **Change:** Connect advisor requests to the secondary-run runner and server lifecycle. Ensure the reviewer cannot edit, execute, change policy/todos, or send a primary message; expose only a copy/materialize result operation.
  - **TiCoder tests:** `test/advisor-api.test.js`
    - advisor execution uses the no-tool secondary path (# FR-18);
    - no edit/bash/todo/permission/primary-RPC side effects are emitted (# FR-20);
    - copy/materialize is explicit and does not auto-send (# FR-21);
    - model/credential/timeout/cancel failures preserve retryable state (# FR-22).
  - **Depends on:** C02, C03, C05.
  - **Phase 4 result:** PASS — `node test/advisor-api.test.js`, `node --check` on advisor/isolated/secondary/server files, and all 58 `test/*.test.js` files passed.
  - **Compliance:** advisor runs use the existing no-tools/no-extensions isolated child, publish bounded structured results with copyable `text`, and never forward primary RPC or tool commands; failure/cancel paths remain retryable. Browser review controls remain deferred to C07.

- [x] **C07 — Add advisor controls and result presentation**
  - **Delivers:** FR-16, FR-21, FR-23, FR-58, FR-59, FR-61; plan goal for review assistance without duplicate systems.
  - **Change:** Add review actions to eligible draft/turn surfaces, reviewer model selection/provenance, verdict cards, risks/actions, retry/cancel, and copy-to-composer behavior. Keep current approval, diff, todo, and fleet surfaces unchanged.
  - **TiCoder tests:** `test/advisor-ux.test.js`
    - review actions appear only for valid source context and retain source labels (# FR-16);
    - verdict/status/error/provenance cards render deterministically (# FR-19, FR-23);
    - copy/materialize never invokes send or apply (# FR-21);
    - keyboard/focus/narrow-width projections remain valid (# FR-58, FR-59);
    - existing permission/todo/fleet render contracts still pass (# FR-61).
  - **Depends on:** C04, C06.
  - **Phase 4 result:** PASS — `node test/advisor-ux.test.js`, `node --check public/app.js`, static server smoke (`/`, `/advisor-ux.js`, `/app.js`, `/style.css` all 200 with correct script order), and all 59 `test/*.test.js` files passed.
  - **Compliance:** `advisor-ux.js`, the advisor pane, composer/assistant-turn review actions, provenance/verdict/risk/action cards, retry/cancel, and explicit copy-to-composer satisfy FR-16/21/23/58/59 while preserving existing secondary, permission, todo, fleet, and diff surfaces. Live Chromium smoke was deferred because no browser binary is installed.

## Web and GitHub research

- [x] **W01 — Add the network target safety policy**
  - **Delivers:** FR-25, FR-26, FR-35; plan goal for security-reviewed web access.
  - **Change:** Create a pure validator for URL schemes, credentials, hostname/IP classes, DNS answers, redirects, and final targets. Keep the policy separate from browser heuristics and reusable by search/fetch/GitHub paths.
  - **TiCoder tests:** `test/web-url-policy.test.js`
    - rejects unsupported schemes, embedded credentials, loopback, private, link-local, multicast, and metadata targets (# FR-25);
    - validates IPv4, IPv6, hostname resolution, redirect chains, and final targets (# FR-26);
    - treats remote page text as untrusted data and exposes policy reasons without secrets (# FR-35).
  - **Depends on:** none.
  - **Phase 4 result:** PASS — `node test/web-url-policy.test.js` (6 passed), `node --check web-url-policy.js`, `node test/package.test.js`, `npm pack --dry-run`, and all 60 `test/*.test.js` files passed.
  - **Compliance:** `web-url-policy.js` accepts only HTTP(S), rejects credentials/local/private/link-local/multicast/metadata targets, validates supplied DNS connection addresses and every redirect hop with bounded limits, and labels remote text as untrusted data without echoing unsafe input in policy errors. The module is included in the published package.

- [x] **W02 — Add bounded web-fetch and content extraction**
  - **Delivers:** FR-27, FR-28, FR-29; plan goal for predictable, bounded page retrieval.
  - **Change:** Implement HTTP(S) fetch limits, redirect handling through W01, content-type handling, text extraction, truncation metadata, and safe server-owned continuation artifacts.
  - **TiCoder tests:** `test/web-fetch.test.js`
    - enforces response-byte, redirect, timeout, and extracted-text limits (# FR-27);
    - rejects or reports binary, invalid-encoding, compressed, and unsupported content safely (# FR-27);
    - returns truncation metadata and opaque continuation references without browser filesystem paths (# FR-28);
    - preserves requested/final canonical URLs and bounded retrieval metadata (# FR-29).
  - **Depends on:** W01.
  - **Phase 4 result:** PASS — `node test/web-fetch.test.js` (6 passed), `node --check web-fetch.js`, `node test/package.test.js`, `npm pack --dry-run`, and all 61 `test/*.test.js` files passed.
  - **Compliance:** `web-fetch.js` manually follows only bounded HTTP(S) redirects, resolves and validates every hostname's connection targets through W01, caps response bytes/text/redirects/time, rejects compressed/binary/unsupported/invalid-encoding bodies, preserves requested/final canonical URLs, and emits only validated opaque continuation references for bounded safe text retention. It is included in the published package.

- [x] **W03 — Add minimal configurable web search**
  - **Delivers:** FR-24, FR-29, FR-30, FR-31; plan goal for useful research without provider sprawl.
  - **Change:** Add a small provider adapter/configuration seam, explicit provider selection, server-only key resolution, bounded result normalization, and no silent fallback.
  - **TiCoder tests:** `test/web-search.test.js`
    - normalizes bounded titles, snippets, URLs, provider, and retrieval metadata (# FR-24, FR-29);
    - keeps keys out of browser payloads and tool results (# FR-30);
    - explicit unavailable/uncredentialed providers fail rather than fallback (# FR-30);
    - result and query limits are enforced and provider count remains intentionally bounded (# FR-31).
  - **Depends on:** W01.
  - **Phase 4 result:** PASS — `node test/web-search.test.js` (6 passed), `node --check web-search.js`, `node --check test/web-search.test.js`, `node test/package.test.js`, and `npm pack --dry-run` with `web-search.js` present.
  - **Compliance:** `web-search.js` provides one explicitly selected Brave adapter, server-side environment/key resolution, no-fallback unavailable/credential errors, canonical safe source URLs, untrusted-data labeling, bounded query/result/field normalization, and secret redaction; the adapter is included in the published package.

- [x] **W03b — Wire web search settings and the agent tool**
  - **Delivers:** FR-24, FR-30, FR-35, FR-58, FR-60; plan goals for server-owned credentials and useful research without provider sprawl.
  - **Change:** Add a fixed-path server settings API and accessible Settings controls for the provider/API key, then register `web_search` in the extension with the existing safeguard default and W03's settings-backed result contract.
  - **TiCoder tests:** `test/web-search-wiring.test.js`
    - validates and atomically persists settings without returning or browser-persisting the key (# FR-30, FR-60);
    - exposes labelled password input, save/clear/status controls, and no secret in the GET payload (# FR-30, FR-58);
    - registers only the bounded `web_search` tool, reads the server-owned config per call, labels remote data untrusted, and keeps provider selection explicit (# FR-24, FR-35);
    - preserves the existing safeguard gate and extension registration surface (# FR-60).
  - **Depends on:** W03.
  - **Phase 4 result:** PASS — `node test/web-search-wiring.test.js` (5 passed), focused W03/policy/permissions/shell tests (all 5 files passed), and `node --check` for `server.js`, `web-search.js`, `public/app.js`, and the wiring test.
  - **Compliance:** `server.js` persists the key only at the fixed user-agent path and exposes configured/provider metadata without the secret; Settings keeps the input transient; `web.ts` registers only `web_search`, reloads the server-owned config per call, labels remote data untrusted, and inherits the explicit `web_search: "ask"` safeguard rule.

- [x] **W04 — Add the GitHub URL target adapter**
  - **Delivers:** FR-32, FR-33, FR-34; plan goal for direct repository research.
  - **Change:** Parse supported GitHub repository/tree/blob/raw forms into validated owner/repository/ref/path targets and resolve bounded listings/files through safe server-side requests.
  - **TiCoder tests:** `test/github-interceptor.test.js`
    - parses canonical repository, tree, directory, blob, and raw URLs (# FR-32);
    - rejects encoded traversal, ambiguous refs, unsupported hosts, and unsafe paths (# FR-33);
    - handles missing paths, oversized files, rate limits, private auth failure, and API errors with bounded diagnostics (# FR-34);
    - never executes a browser-provided command or writes to the workspace (# FR-33).
  - **Depends on:** W01.
  - **Phase 4 result:** PASS — `node test/github-interceptor.test.js` (10 passed), focused W01–W03 regression tests, `node test/package.test.js`, JavaScript syntax checks, `npm pack --dry-run`, and a live public GitHub tree smoke test.
  - **Compliance:** `github-interceptor.js` validates GitHub repository/tree/blob/raw targets, rejects traversal and ambiguous refs, calls only the bounded GitHub Contents API through `web-fetch.js`, keeps optional `GH_TOKEN`/`GITHUB_TOKEN` server-side, maps bounded auth/rate/path/API failures, labels returned content untrusted, and performs no shell or workspace writes.

- [ ] **W05 — Register web tools and permission/audit integration**
  - **Delivers:** FR-24, FR-30, FR-35, FR-60, FR-61; plan goal for safe agent-facing research.
  - **Change:** Extend the W03b `web_search` wiring with `web_fetch` and the GitHub adapter, then complete shared network-risk permission/audit metadata without changing browser-CDP tools.
  - **TiCoder tests:** `test/web-tools.test.js`, `test/policy-engine.test.js`, and `test/trust-boundary.test.js`
    - tool schemas distinguish search and fetch and preserve bounded result envelopes (# FR-24);
    - network-risk metadata is visible to safeguard/audit without exposing keys (# FR-30, FR-35);
    - remote content is labelled untrusted and cannot alter tool policy (# FR-35);
    - existing browser tool registration and trust-boundary contracts remain green (# FR-61).
  - **Depends on:** W02, W03, W04.

## Workflow and stage visibility

- [ ] **F01 — Define workflow contracts and append-only state**
  - **Delivers:** FR-36 through FR-38, FR-45; plan goal for durable, inspectable stage state.
  - **Change:** Define workflow/stage schemas, allowed statuses, run IDs, stage events, checkpoint records, validation errors, and append-only persistence with duplicate/conflict detection.
  - **TiCoder tests:** `test/workflow-state.test.js`
    - validates names, ordered stages, inputs/outputs, and terminal outcomes (# FR-36);
    - accepts only the documented stage statuses (# FR-37);
    - appends events with timestamps/checkpoints and rejects duplicate/conflicting events (# FR-38, FR-45);
    - preserves the last valid state when data is malformed or partial (# FR-45).
  - **Depends on:** none.

- [ ] **F02 — Add declarative routing, verification, and resume behavior**
  - **Delivers:** FR-39 through FR-43; plan goal for bounded workflow execution.
  - **Change:** Implement stage progression, validated declarative routes, stop-on-failure, waiting-for-approval, resume-from-checkpoint, and explicit single-primary-child enforcement. Do not add a process pool or parallel primary-chat runner.
  - **TiCoder tests:** `test/workflow-runner.test.js`
    - resumes at the first valid unfinished stage without rerunning passed stages (# FR-39);
    - routes only on allowed statuses/enumerated outputs and rejects executable predicates (# FR-40);
    - blocks dependent stages after failure and exposes retry boundary (# FR-41);
    - retains waiting approval state across reconnect and never auto-applies (# FR-42);
    - rejects concurrent-primary execution requests (# FR-43).
  - **Depends on:** F01.

- [ ] **F03 — Project workflow state into the existing rail**
  - **Delivers:** FR-44, FR-58 through FR-61; plan goal for workflow visibility without duplicate UI systems.
  - **Change:** Add pure workflow badge/list/document projections and integrate them with the existing workspace-tools rail/SDD surfaces. Preserve current widget contracts and compact/narrow behavior.
  - **TiCoder tests:** `test/workflow-ux.test.js`, `test/rail.test.js`, `test/rail-resize.test.js`
    - renders current stage, waiting/failure/resume indicators, and last checkpoint (# FR-44);
    - keeps rail widget identity, generation, persistence, and narrow-sheet contracts (# FR-44, FR-61);
    - exposes labelled, keyboard-operable status and approval controls (# FR-58);
    - does not create a second todo/fleet or parallel-chat surface (# FR-44, FR-61).
  - **Depends on:** F02.

## Skill arguments

- [ ] **A01 — Implement the pure skill-argument expander**
  - **Delivers:** FR-46 through FR-50; plan goal for deterministic safe skill parameters.
  - **Change:** Define tokenized positional arguments, raw `$ARGUMENTS`, bounded non-recursive placeholder expansion, missing-argument behavior, malformed-placeholder errors, and the explicit prohibition on command/environment substitution.
  - **TiCoder tests:** `test/skill-args.test.js`
    - expands raw remainder and decoded `$1..$N` deterministically (# FR-46, FR-47);
    - handles missing values, empty input, Unicode, quotes, newlines, `$`, backticks, and shell metacharacters as data (# FR-48, FR-49);
    - rejects malformed placeholders, recursive expansion, and size overflow (# FR-47, FR-50).
  - **Depends on:** none.

- [ ] **A02 — Connect arguments to skill dispatch**
  - **Delivers:** FR-51, FR-60; plan goal for safe reusable skill invocation.
  - **Change:** Apply the approved expansion seam to skill invocation before model delivery, preserve original argument provenance, and ensure it cannot bypass safeguard or create a command path.
  - **TiCoder tests:** `test/skill-args-integration.test.js`, `test/shell-contract.test.js`
    - expanded arguments reach the skill prompt as data with no shell execution (# FR-51);
    - safeguard still receives and evaluates actual tool calls independently (# FR-51, FR-60);
    - existing skill/SDD invocation behavior remains unchanged when no placeholders are present (# FR-61).
  - **Depends on:** A01.

## Optional telemetry

- [ ] **T01 — Add telemetry privacy filtering and bounded dispatcher**
  - **Delivers:** FR-52 through FR-55; plan goal for opt-in non-blocking observability.
  - **Change:** Define opt-in configuration, allowlisted event projection, bounded queue/drop policy, provider isolation, and failure/recovery transition reporting without coupling telemetry to primary results.
  - **TiCoder tests:** `test/telemetry-dispatcher.test.js`
    - disabled/default configuration emits no external event (# FR-52);
    - prompt text, assistant text, tool args/results, credentials, raw paths, and file contents are removed from events (# FR-53);
    - queue bounds and drop policy never block the primary operation (# FR-54);
    - provider failure/recovery warnings are transition-limited (# FR-55).
  - **Depends on:** none.

- [ ] **T02 — Connect lifecycle metrics without changing local usage**
  - **Delivers:** FR-56, FR-57, FR-60, FR-61; plan goal for optional telemetry with no regression.
  - **Change:** Emit allowlisted lifecycle/duration/status/aggregate events, implement bounded shutdown flush, and keep local usage/session analysis authoritative during disabled, failed, or partial telemetry delivery.
  - **TiCoder tests:** `test/telemetry-integration.test.js`, `test/usage-telemetry.test.js`, `test/session-analysis.test.js`
    - shutdown flush is bounded and leftover events are discarded safely (# FR-56);
    - telemetry failure does not change primary result or local usage data (# FR-56, FR-57);
    - existing usage/session-analysis behavior remains green (# FR-57, FR-61);
    - all lifecycle hooks preserve current SSE/RPC ordering and security boundaries (# FR-60).
  - **Depends on:** T01.

## Compatibility and release gate

- [ ] **V01 — Run the cross-feature security, accessibility, packaging, and regression gate**
  - **Delivers:** FR-58 through FR-61 and all plan success criteria.
  - **Change:** Add only the final contract fixtures and release/package coverage needed to prove new files are shipped, new controls are accessible, and existing behavior has not regressed. Update durable docs/changelog only after the implementation is verified.
  - **TiCoder tests:**
    - `node test/a11y-contract.test.js`, `node test/contrast.test.js`, `node test/header-overflow.test.js`, `node test/shell-layout.test.js`, and relevant new UX tests (# FR-58, FR-59);
    - `node test/trust-boundary.test.js`, `node test/runtime-resilience.test.js`, `node test/rpc-sse.test.js`, `node test/safeguard-contract.test.js`, and relevant web/secondary API tests (# FR-60);
    - `node test/package.test.js` plus the complete focused adaptation test set confirms package completeness and no missing static/module files (# FR-61);
    - existing todo, questionnaire, rail, fleet, reconnect, compaction, session, and usage suites remain green (# FR-61).
  - **Depends on:** C04, C07, W05, F03, A02, T02.

## Required Phase 4 checkpoint format

Each completed chunk MUST record:

- the exact test command(s) and PASS output;
- a compliance note mapping the chunk's FRs and plan goals to the implementation;
- any approved deviation or deferred scope before the next chunk begins.

The proposed TiCoder tests are expected to fail before implementation. They express the approved behavior and must be reviewed before coding starts.
