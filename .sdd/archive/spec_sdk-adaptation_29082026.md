# Specification: Complete the SDK adaptation

## Scope

This specification completes the primary pi-webui runtime migration from the Pi CLI/RPC subprocess boundary to the official Pi SDK's `AgentSessionRuntime`. It covers the runtime adapter, server lifecycle, browser protocol compatibility, extension UI bridge, security/trust boundary, isolated prompts, packaging, documentation, tests, and standalone/JetBrains operation.

The primary browser contract remains HTTP POST plus SSE. The SDK is an internal server implementation detail at that boundary: browser consumers must not need to know whether an event originated from an SDK session callback. The existing secondary runs, web research, Git, fleet, todo, SDD, usage, diff, and browser-tool systems are compatibility surfaces, not new feature scope.

## User Stories

- **US-1 — Start:** As a user, I want pi-webui to start a ready primary session through the official SDK so I can use the WebUI without a separately managed Pi CLI process.
- **US-2 — Converse:** As a user, I want prompts, steering, follow-ups, aborts, model controls, compaction, bash, and retries to behave as they did before the transport migration.
- **US-3 — Navigate sessions:** As a user, I want to create, switch, fork, clone, inspect, and rename sessions without losing the active workspace or transcript state.
- **US-4 — Observe:** As a browser client, I want ordered SSE events and a complete bootstrap snapshot so reloads and reconnects reconstruct the current session correctly.
- **US-5 — Approve safely:** As a user, I want extension dialogs and permission approvals to remain browser-backed, reconnectable, stale-request-safe, and isolated from unrelated tabs or workspaces.
- **US-6 — Trust the boundary:** As an operator, I want workspace code and project-local extensions unable to silently expand the runtime trust boundary.
- **US-7 — Integrate:** As a maintainer, I want the launcher, isolated prompts, package metadata, tests, documentation, and JetBrains host to describe and use the same SDK architecture.
- **US-8 — Recover:** As a user, I want SDK startup failures, workspace switches, runtime disposal, reconnects, and shutdowns to fail visibly and recover without duplicate runtimes or lost safety state.

## Functional Requirements

### Runtime ownership and startup

- **FR-1:** The primary session MUST be owned by one official SDK `AgentSessionRuntime` instance per active workspace. The primary session MUST NOT be started through a Pi CLI child process, stdin/stdout JSONL pipe, or equivalent RPC subprocess transport.
- **FR-2:** Startup MUST resolve the configured workspace, agent directory, session directory, and package-owned WebUI bridge extension before creating the runtime. Missing or invalid required configuration MUST produce a bounded startup failure and MUST NOT silently fall back to the old transport.
- **FR-3:** A successful startup MUST expose an observable ready state and MUST publish one readiness notification after the runtime and active session are bound. Repeated startup calls while the same runtime is ready MUST NOT create a second primary runtime.
- **FR-4:** SDK initialization failures MUST leave the HTTP/SSE surface available, publish a bounded failure state, and retry according to a bounded backoff policy. A failed initialization MUST NOT leave a partially active command target or stale approval broker.
- **FR-5:** Runtime disposal MUST unsubscribe session listeners, resolve or cancel pending browser UI requests safely, stop secondary work associated with the primary runtime, and release the active runtime reference.
- **FR-6:** The package MUST declare and install the SDK version range and Node engine required by the runtime. A package installation MUST NOT require a runtime build or dependency installation step beyond normal package installation.

### Browser command compatibility

- **FR-7:** `POST /api/cmd` MUST continue accepting the existing command envelope and MUST return bounded success/error responses with the request ID where applicable. The route MUST dispatch through the SDK adapter rather than forwarding a browser request to a child process.
- **FR-8:** The adapter MUST support the existing primary command behaviors for prompt, steer, follow-up, abort, queue clearing, new session, model selection/cycling, thinking-level selection/cycling, steering mode, follow-up mode, compaction, auto-compaction, auto-retry, retry abort, bash, bash abort, session statistics, session switching, fork, clone, entries, tree, last assistant text, session naming, messages, commands, and available models/thinking levels.
- **FR-9:** Unsupported or malformed command types, missing required values, unavailable models, invalid session paths, and SDK method failures MUST return explicit bounded errors. They MUST NOT crash the HTTP server or mutate unrelated runtime state.
- **FR-10:** Prompt acknowledgement MUST preserve the existing accepted/preflight behavior: a browser request MAY receive acknowledgement once the SDK accepts the prompt, and MUST NOT receive duplicate success responses when the SDK later settles the prompt.
- **FR-11:** Commands that require an acknowledgement MUST remain awaitable until the SDK operation has returned or failed. Fire-and-forget event publication MUST NOT be mistaken for command completion.
- **FR-12:** SDK calls that expose mutable runtime/session state MUST be serialized or guarded sufficiently that overlapping browser requests cannot switch/dispose the session underneath an operation without a defined error or cancellation result.

### Event and snapshot compatibility

- **FR-13:** `GET /api/events` MUST continue delivering ordered SSE envelopes with the existing source/payload shape. SDK events MUST be normalized at the adapter boundary when their shape differs from the browser contract.
- **FR-14:** Assistant streaming, tool execution start/update/end, agent start/end, retry, compaction, extension error, and server lifecycle events required by the current browser renderer MUST remain observable. Normalization MUST preserve usage, tool identity, text deltas, terminal status, and error information needed by the UI.
- **FR-15:** Event publication MUST assign the existing live-buffer sequence metadata and retain only the documented current-turn replay events. SDK event subscription cleanup MUST prevent duplicate delivery after session rebinding.
- **FR-16:** `GET /api/snapshot` MUST return the current state, visible compaction-aware messages, commands, models, aggregate statistics, current-turn replay events, pending approvals, and secondary-run state using the existing response envelope.
- **FR-17:** A snapshot taken during SDK startup, disposal, workspace replacement, or a failed session read MUST return a safe explicit unavailable/null state rather than stale data from a prior workspace or a server exception.
- **FR-18:** Snapshot history MUST use the active session entry tree and leaf selection so compaction boundaries and branch navigation are represented consistently with the SDK session. Flat current-message state MUST NOT silently replace the required compaction-aware view.

### Session and workspace lifecycle

- **FR-19:** A workspace switch MUST dispose the old SDK runtime before binding a new workspace runtime, clear workspace-scoped live events and pending approvals, and publish one workspace-change event after the new runtime boundary is established.
- **FR-20:** A session switch, fork, clone, new-session operation, or session reload MUST rebind event and extension listeners exactly once and update browser-visible state to the newly selected session.
- **FR-21:** An old runtime, old session, or old workspace MUST NOT publish events, resolve approvals, write session state, or complete commands after it has been replaced. Late operations MUST be ignored or return a bounded stale-runtime error.
- **FR-22:** Workspace switching MUST continue to use server-side workspace discovery, realpath containment, no-switch IDE mode, and existing path validation. The SDK migration MUST NOT allow a browser-provided cwd or session path to bypass those checks.
- **FR-23:** A primary runtime shutdown MUST clear or terminally cancel primary-scoped secondary runs, approvals, and live replay state without deleting persisted session history or unrelated user configuration.
- **FR-24:** Reconnect and multi-tab clients MUST converge on the same server-owned runtime state. Duplicate clients MUST not create separate primary SDK sessions or race approval resolution beyond the existing first-response-wins contract.

### Extension bridge and permissions

- **FR-25:** The package-owned WebUI extension MUST bind through the SDK extension runner in JSON/browser mode and MUST receive a browser-backed UI context for select, confirm, input, editor, and status requests.
- **FR-26:** Every blocking extension UI request MUST have an opaque request ID, bounded payload, active tool identity where applicable, and cancellation/timeout behavior. A request MUST be resolvable only while it belongs to the active runtime.
- **FR-27:** Approval responses MUST preserve existing broker rules: first response wins, stale or mismatched tool identity is rejected, the response is forwarded to the matching SDK UI promise only after validation, and resolution is broadcast after acknowledgement.
- **FR-28:** Pending approvals MUST be included in snapshots for reconnecting clients and MUST be cleared on runtime replacement, workspace switch, and shutdown. Approval state MUST never be attached to a newly selected workspace or session.
- **FR-29:** The SDK trust configuration MUST disable project trust and load only the package-owned bridge extension for the primary runtime. Project-local extensions MUST NOT execute as a side effect of opening a workspace.
- **FR-30:** Existing safeguard, permission policy, audit, todo-discipline, questionnaire, and browser-tool behavior MUST remain authoritative. The SDK adapter MUST not create a bypass path around tool approval, command classification, path containment, or policy provenance.

### Isolated prompts and existing feature surfaces

- **FR-31:** Isolated prompt/advisor execution MUST remain separate from the primary runtime and MUST not add messages, entries, tools, approvals, todos, or commands to the primary session.
- **FR-32:** Isolated execution MUST preserve its no-tool/no-extension security posture, bounded input/output/time behavior, cancellation, safe error redaction, and independent profile/auth boundary while using the supported SDK-compatible path.
- **FR-33:** Existing Git, web research, GitHub, fleet, usage, diff, image, SDD, and browser-CDP surfaces MUST continue to use their current server-side boundaries and MUST not assume that the primary agent is a child process.
- **FR-34:** JetBrains-hosted WebUI MUST continue to operate with the host-owned cwd and no-switch mode. The SDK runtime MUST not expose workspace switching or project extension loading through the IDE panel.

### Packaging, documentation, and verification

- **FR-35:** Published files MUST include every SDK runtime, adapter dependency, bundled bridge extension, and test/documentation entry required by supported startup paths. Package file-list and lockfile checks MUST pass.
- **FR-36:** Launcher and environment documentation MUST describe SDK startup and remove or clearly mark obsolete primary-runtime settings such as CLI binary/argument configuration. The documented Node engine and dependency installation path MUST match package metadata.
- **FR-37:** Source comments, README/AGENTS guidance, roadmap, changelog, tests, and JetBrains documentation MUST not claim that the primary runtime is a Pi RPC subprocess. Historical migration notes MAY retain that wording when clearly labelled as history.
- **FR-38:** The focused SDK adapter tests MUST cover startup configuration, command mapping, event normalization, UI bridging, disposal, rebind, and failure behavior using an SDK-shaped test double rather than a live CLI process.
- **FR-39:** The complete existing test suite MUST remain green, including trust-boundary, runtime-resilience, SSE/transport, session/compaction, approval, secondary-run, UI, package, and JetBrains contract tests.
- **FR-40:** Manual verification MUST cover fresh start/readiness, prompt streaming, tool approval, session switch, workspace switch, reconnect during a turn, compaction snapshot, isolated prompt, standalone narrow layout, and JetBrains no-switch operation. No new browser console, focus, overflow, or security regression may be accepted.

## Data Models

### SdkRuntimeConfig

- `cwd`: server-resolved active workspace path
- `agentDir`: server-resolved Pi agent configuration root
- `sessionDir`: server-resolved workspace session root
- `bundledExtension`: package-owned absolute bridge-extension path
- `projectTrusted`: always false for the primary WebUI runtime
- `runtimeKind`: fixed value identifying the official Pi SDK runtime

### PrimaryRuntimeState

- `status`: `starting`, `ready`, `failed`, `disposing`, or `stopped`
- `workspace`: server-resolved workspace identity
- `sessionId`, `sessionFile`, `sessionName`
- `model`, `thinkingLevel`
- `isStreaming`, `isCompacting`
- `steeringMode`, `followUpMode`
- `autoCompactionEnabled`, `pendingMessageCount`
- `generation`: monotonic runtime/session generation used to reject stale work
- `error`: bounded startup/runtime error when applicable

### BrowserCommand

- `id`: opaque client request ID when acknowledgement is needed
- `type`: enumerated supported command name
- command-specific data, validated as data before dispatch
- no browser field may directly select an executable, cwd, extension path, or agent directory

### CommandResponse

- `id`: matching request ID where provided
- `type`: response marker
- `success`: boolean
- `data`: bounded command result when successful
- `error`: bounded safe message when unsuccessful

### SseEventEnvelope

- `source`: `pi`, `server`, or `stderr` where retained for compatibility
- `payload`: normalized event data
- `sequence`: monotonic live-buffer sequence when the event is retained for replay
- server lifecycle events may carry a server `type` and bounded metadata

### ExtensionUiRequest

- `id`: opaque request ID
- `method`: `select`, `confirm`, `input`, `editor`, or non-blocking status method
- bounded display data such as title, message, options, status key, and status text
- active `toolCallId` and `toolName` provenance when associated with a tool
- cancellation/expiry metadata owned by the server broker

### Snapshot

- `state`: `PrimaryRuntimeState` or null when unavailable
- `messages`: compaction-aware visible transcript records
- `commands`: registered extension commands, prompt templates, and skills
- `models`: available model records without credentials
- `stats`: aggregate session statistics
- `liveEvents`: bounded current-turn replay records
- `pendingApprovals`: active broker records without secrets
- `secondaryRuns`: public bounded secondary-run projections

## Edge Cases and Failure Behavior

- If the SDK package cannot be dynamically loaded, startup reports a bounded SDK-unavailable failure and retries; it MUST NOT invoke the old CLI path.
- If the bundled bridge extension is missing, startup remains fail-closed for project trust and reports degraded extension functionality rather than loading workspace-local code.
- If runtime creation succeeds but session binding fails, the partial runtime is disposed, its listeners are removed, approvals are cleared, and the browser sees a failed/not-ready state.
- If two startup or workspace-switch operations overlap, only the newest active runtime may publish readiness or events; the displaced operation is disposed or rejected as stale.
- If an SDK event has an unknown type or an incomplete partial assistant/tool payload, it is either passed through safely or dropped from only the incompatible rendering path; it must not crash event delivery or corrupt the live buffer.
- If a command arrives while the runtime is starting, disposing, or failed, it receives a bounded not-ready error and is not queued implicitly unless the SDK command contract explicitly supports queuing.
- If prompt preflight accepts and the later SDK prompt fails, the browser receives one accepted acknowledgement followed by the normal error/session events; it must not receive a second contradictory command success response.
- If a command completes after a workspace/session replacement, its result must not be applied to the new runtime. The client receives a stale/cancelled result where a response is required.
- If a session switch or fork is cancelled by the SDK, the current valid session remains authoritative and the browser receives the documented cancellation result rather than an empty or foreign session.
- If a pending approval response arrives from a stale tab, with a wrong tool marker, or after runtime replacement, the broker rejects it without resolving the SDK UI promise.
- If a browser reload happens while an approval or turn is active, the next snapshot and SSE stream restore only active server-owned state; completed terminal requests are not replayed as pending.
- If a workspace path is deleted, symlinked, or no longer passes discovery/realpath validation during a switch, the switch fails without disposing the currently valid workspace until the replacement boundary is safe.
- If a primary SDK runtime shuts down while a secondary run is active, that secondary run becomes cancelled or expired and cannot be materialized into a replacement workspace/session automatically.
- If the SDK returns credentials, raw filesystem paths, subprocess diagnostics, or extension internals in an error, the browser receives only the existing bounded redacted error envelope.
- If the package file whitelist omits the adapter or bridge extension, packaging verification fails before release; startup must not silently claim a complete install.
- If documentation still contains an old RPC statement, it must be corrected or explicitly marked as historical before the release gate passes.
- If a live browser or JetBrains check reveals console errors, focus loss, horizontal overflow, duplicate SSE events, lost transcript state, or a permission bypass, the adaptation is not complete even when unit tests pass.
