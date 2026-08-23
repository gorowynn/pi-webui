# Specification: Adapt selected rpiv-mono capabilities

## Scope

This specification covers compatible behavior inspired by `rpiv-btw`, `rpiv-advisor`, `rpiv-web-tools`, `rpiv-workflow`, `rpiv-args`, and the bounded telemetry dispatcher. It defines contracts, not implementation. The primary Pi session remains the only supported foreground chat, and existing pi-webui systems remain authoritative for questionnaires, todos, permissions, fleet state, SDD artifacts, usage, and browser CDP tools.

A **secondary run** is a disposable, no-tool model call that is visible to the user but is not part of the primary Pi session. A **workflow run** is a durable sequence of named stages, not a set of simultaneously supported chats.

## User Stories

- **US-1 — Side question:** As a user, I want to ask a quick contextual question without adding noise to the main transcript or stopping an active turn.
- **US-2 — Advisor:** As a user, I want a stronger or independent model to review a draft, turn, or proposed change and give me a correction or stop signal before I continue.
- **US-3 — Web research:** As an agent, I want bounded web search and fetch tools that return useful citations without exposing the host to SSRF or unbounded downloads.
- **US-4 — GitHub research:** As an agent, I want a GitHub URL to resolve to a safe tree, directory, or file view instead of unusable rendered HTML.
- **US-5 — Workflow visibility:** As a user, I want multi-stage work to show its current stage, outcome, and durable resume point without pretending pi-webui supports parallel primary chats.
- **US-6 — Skill arguments:** As a skill author, I want explicit arguments in a skill invocation without shell evaluation or ambiguous substitution.
- **US-7 — Optional telemetry:** As an operator, I want opt-in lifecycle metrics with bounded delivery and no accidental prompt or secret export.
- **US-8 — Compatibility:** As a current user, I want these additions without losing existing permission, todo, questionnaire, fleet, SDD, reconnect, compaction, session, or narrow-layout behavior.

## Functional Requirements

### Shared secondary-run contract

- **FR-1:** Every secondary run MUST have a unique opaque request ID and one of `queued`, `running`, `completed`, `failed`, `cancelled`, or `expired` states.
- **FR-2:** A secondary run MUST execute without tools, file writes, shell access, permission prompts, or changes to the primary Pi process.
- **FR-3:** A secondary run MUST NOT create a primary transcript message, session-file entry, todo operation, workflow stage, or agent tool call.
- **FR-4:** Each secondary run MUST have a bounded context size, wall-clock duration, and output size. The UI MUST disclose when input or output was truncated.
- **FR-5:** The user MUST be able to cancel a secondary run without cancelling, steering, or otherwise changing the primary turn.
- **FR-6:** Completion, failure, cancellation, and expiry MUST be idempotent. A late or duplicate response MUST NOT overwrite a terminal state.
- **FR-7:** Errors shown to the browser MUST be bounded and sanitized; provider keys, filesystem paths outside the workspace, subprocess arguments, and raw process dumps MUST NOT be exposed.
- **FR-8:** Secondary-run state MUST be cleared on workspace switch or primary Pi shutdown unless it has already been materialized by an explicit user action in the primary composer.

### Side questions (`/btw` behavior)

- **FR-9:** The WebUI MUST provide a discoverable side-question action from the command palette and a keyboard-accessible surface.
- **FR-10:** A side question MUST use a bounded snapshot of the currently visible primary conversation branch, plus the side-question thread, as read-only context.
- **FR-11:** A side-question answer MUST render in a separate panel, sheet, or dialog and MUST be visually labelled as non-transcript content.
- **FR-12:** Side-question follow-ups MUST remain in the side thread and MUST NOT enter the primary transcript unless the user explicitly copies or submits them.
- **FR-13:** Closing or cancelling the side-question surface MUST affect only the side run. It MUST NOT send Deny, Stop, Steer, Follow-up, or Compact to the primary session.
- **FR-14:** A side question MUST remain available while the primary session is running, subject to resource bounds and the single-primary-child constraint.
- **FR-15:** The user MUST have an explicit action to copy a side answer into the composer; copying MUST NOT send it automatically.

### Advisor/reviewer behavior

- **FR-16:** The WebUI MUST allow review of at least a draft, a selected assistant turn, or a selected request context.
- **FR-17:** An advisor request MUST identify its source context, selected model or configured reviewer default, request ID, and cancellation state.
- **FR-18:** Advisor execution MUST be no-tool and isolated from the primary Pi session, even when the reviewer model is stronger than the active model.
- **FR-19:** An advisor result MUST expose a structured verdict of `proceed`, `revise`, `stop`, or `unavailable`, together with bounded summary text and optional risks/actions.
- **FR-20:** The advisor MUST NOT apply edits, run commands, alter permissions, change todos, or send a primary-session message.
- **FR-21:** The user MUST be able to copy or place an advisor recommendation into the composer, with the action clearly distinguishable from automatic application.
- **FR-22:** Advisor model absence, credential failure, timeout, cancellation, empty output, and malformed output MUST produce a retryable user-facing state rather than a false successful verdict.
- **FR-23:** Advisor results MUST show enough provenance to identify the selected model, whether context was truncated, and when the review completed.

### Web and GitHub research

- **FR-24:** The agent-facing surface MUST distinguish `web_search` from `web_fetch`; search returns bounded result records and fetch returns bounded page content.
- **FR-25:** Web requests MUST accept only `http` and `https` URLs. Credentials in URLs, unsupported schemes, localhost, loopback, link-local, private, multicast, and cloud metadata destinations MUST be rejected.
- **FR-26:** DNS resolution, connection target, redirects, and final target MUST be checked against the same network-safety policy. A safe initial URL MUST NOT authorize an unsafe redirect.
- **FR-27:** Fetches MUST have bounded duration, response bytes, redirects, and extracted text. Binary or unsupported content MUST return a clear bounded error or metadata-only result.
- **FR-28:** Truncated fetch results MUST identify the truncation and provide a server-owned continuation reference only when the content is safe to retain. The browser MUST NOT receive an arbitrary filesystem path.
- **FR-29:** Search and fetch results MUST preserve canonical source URLs. Search results SHOULD include title, snippet, provider, and retrieval timestamp where available.
- **FR-30:** Provider configuration MUST be server-side. API keys MUST never be sent to the browser or embedded in tool output. A requested provider that is unavailable or uncredentialed MUST fail explicitly rather than silently falling back.
- **FR-31:** The initial provider surface MUST remain small and optional; adopting a ten-provider ecosystem is not required for acceptance.
- **FR-32:** GitHub URLs in supported repository, tree, directory, blob, or raw-file forms MUST resolve to a bounded tree listing, directory listing, or file content response.
- **FR-33:** GitHub owner, repository, ref, and path components MUST be validated as data. The feature MUST NOT execute browser-provided shell commands or use an unrestricted clone destination.
- **FR-34:** GitHub rate limits, private-repository authorization, missing refs/files, oversized files, and API failures MUST return actionable bounded errors.
- **FR-35:** Web and GitHub tool calls MUST be visible to the existing permission/audit model where they can incur network or provider risk. Remote page content MUST be labelled untrusted data and MUST NOT override agent or system instructions.

### Workflow and stage visibility

- **FR-36:** A workflow definition MUST have a name, ordered named stages, explicit stage inputs/outputs, and a terminal outcome.
- **FR-37:** Each stage MUST report `pending`, `running`, `waiting`, `passed`, `failed`, `skipped`, or `cancelled`.
- **FR-38:** Workflow state MUST be durable and append-oriented, with a run ID, stage events, timestamps, and the last completed or resumable stage.
- **FR-39:** A workflow MUST support resuming from a valid unfinished stage without silently rerunning completed stages.
- **FR-40:** Stage routing MUST be declarative and bounded. A route MAY depend on validated prior-stage status or enumerated output, but MUST NOT evaluate arbitrary model-provided code.
- **FR-41:** A failed or invalid stage MUST stop dependent stages and expose the failure reason and retry/resume boundary.
- **FR-42:** A stage marked for verification or user approval MUST remain waiting until the required decision is received; it MUST NOT auto-apply changes.
- **FR-43:** Workflow execution MUST preserve the one-active-primary-child rule. It MUST NOT present parallel workflow workers as simultaneous primary chats or introduce a new process-pool contract.
- **FR-44:** Workflow status MUST reuse the existing workspace-tools rail and SDD/session surfaces where applicable rather than adding a second persistent todo or fleet system.
- **FR-45:** Malformed, partial, stale, or conflicting workflow state MUST fail visibly and conservatively; it MUST not advance the run or discard the last valid checkpoint.

### Skill arguments

- **FR-46:** A skill invocation MUST expose the original argument remainder as `$ARGUMENTS` and decoded positional values as `$1`, `$2`, and so on.
- **FR-47:** Argument expansion MUST be deterministic, non-recursive, bounded in input and expanded output size, and performed before the skill is delivered to the model.
- **FR-48:** Missing positional arguments MUST resolve to an explicit empty value or a documented validation error; they MUST never inherit unrelated environment or session values.
- **FR-49:** The first version MUST NOT perform command substitution, environment expansion, globbing, arbitrary file reads, or shell evaluation.
- **FR-50:** Malformed placeholders or expansion overflow MUST produce a clear invocation error before the skill is executed.
- **FR-51:** Arguments MUST remain data when passed into prompts; they MUST NOT bypass safeguard checks or create an alternate command-execution path.

### Optional telemetry

- **FR-52:** Telemetry MUST be disabled unless the user/operator explicitly enables it and configures a destination or local sink.
- **FR-53:** The default event allowlist MAY include lifecycle, duration, status, model identifier, token/cost aggregates, and counts, but MUST exclude prompt text, assistant text, tool arguments/results, credentials, raw paths, and source file contents.
- **FR-54:** Telemetry delivery MUST be asynchronous, bounded, and non-blocking to the primary session. Queue overflow MUST use a documented drop policy and MUST NOT block tool execution.
- **FR-55:** Provider failures MUST be isolated from Pi/WebUI behavior and MUST emit at most transition-level diagnostics (failure and recovery), not one warning per event.
- **FR-56:** Shutdown MUST attempt a bounded flush and then discard remaining telemetry safely. A telemetry outage MUST NOT change the primary result.
- **FR-57:** The existing local usage/session-analysis views MUST remain authoritative when telemetry is disabled or unavailable.

### UI, accessibility, and compatibility

- **FR-58:** All new controls, status changes, cancellations, and error states MUST be keyboard-operable, focus-visible, labelled, and usable at supported narrow widths.
- **FR-59:** Secondary panels MUST expose status changes through the existing coarse live-status/accessibility channel without announcing every streamed token.
- **FR-60:** New features MUST preserve CSRF/DNS-rebinding checks, workspace containment, request-size limits, SSE ordering, reconnect replay, compaction markers, and approval broker semantics.
- **FR-61:** Existing questionnaire previews, todo discipline, SDD rail, fleet controls, browser CDP tools, usage analysis, and permission pages MUST remain behaviorally unchanged unless a separate requirement explicitly extends them.

## Data Models

### SecondaryRun

- `id`: opaque unique identifier
- `kind`: `side-question` or `advisor`
- `workspace`: server-resolved workspace identity
- `source`: bounded context reference and source type
- `model`: selected or resolved model identifier
- `status`: shared secondary-run state
- `createdAt`, `startedAt`, `finishedAt`
- `inputTruncated`, `outputTruncated`: boolean provenance flags
- `cancelRequested`: boolean
- `error`: bounded typed error, present only for non-success terminal states

### SideQuestionThread

- `threadId`: opaque server-memory identifier
- `primarySessionId`: identity of the source primary session
- `turns`: bounded ordered side-only question/answer records
- `lastRunId`
- `expiresAt`

### AdvisorResult

- `requestId`
- `sourceKind`: draft, assistant-turn, or request-context
- `verdict`: proceed, revise, stop, or unavailable
- `summary`
- `risks`: bounded list of strings
- `actions`: bounded list of strings
- `model`
- `contextTruncated`
- `usage`: optional aggregate-only usage
- `createdAt`

### WebSearchResult / WebFetchResult

- Search: provider, query, bounded result list, canonical URLs, snippets, retrieval metadata.
- Fetch: requested URL, final canonical URL, status/content type, bounded text, truncation flag, optional safe continuation reference, retrieval metadata.
- Both include a typed error envelope when unsuccessful and never include provider secrets.

### GithubTarget

- `owner`, `repository`, `ref`, `path`, `targetKind` (repository/tree/directory/file/raw)
- `canonicalUrl`
- `authScope`: public or configured private access

### WorkflowDefinition / WorkflowRun / StageEvent

- Definition: name, version, ordered stages, validated input/output descriptors, declarative routes, verification policy.
- Run: run ID, definition identity, workspace/session identity, overall status, current stage, terminal outcome, last checkpoint.
- Stage event: stage name, status, input/output summaries, validation result, timestamps, error code, retry/resume metadata.

### SkillInvocation

- `skillName`
- `rawArguments`
- `positionalArguments`
- `expandedLength`
- `validationState`
- `error` if expansion is rejected

### TelemetryEvent

- `eventName`, `eventVersion`, `timestamp`
- opaque session/run correlation ID
- allowlisted lifecycle/status/model/aggregate fields only
- exporter status is separate from primary operation status

## Edge Cases and Failure Behavior

- A side question or advisor request submitted during a primary turn MUST remain independent if the primary turn ends, retries, compacts, crashes, or reconnects.
- A browser reload, duplicate tab, stale request ID, or late subprocess response MUST not duplicate or replace a terminal secondary result.
- If the primary session changes workspace/session while a secondary run is active, the run is cancelled or expired and its result is not attached to the new session.
- Empty, whitespace-only, overlong, or context-free side/advisor input MUST receive a clear validation response.
- If the selected model is unavailable, lacks credentials, or returns no usable text, the UI MUST offer retry/cancel rather than showing an empty success card.
- A web URL that resolves safely on the first lookup but changes during redirect or DNS resolution MUST be rejected if the final target violates policy.
- Web fetches that time out, exceed limits, return compressed/binary content, or contain invalid encoding MUST return bounded diagnostics and preserve no unsafe browser path.
- GitHub URLs with encoded traversal, ambiguous refs, missing paths, API rate limits, private access failure, or oversized files MUST fail without shelling out or writing into the workspace.
- A workflow with a missing stage, invalid route, malformed event, duplicate event ID, or incomplete checkpoint MUST stop at the last valid state and explain how to recover.
- A workflow stage that waits for approval MUST remain waiting across reconnect and must not be mistaken for completion.
- Skill arguments containing quotes, Unicode, newlines, `$`, backticks, or shell metacharacters MUST remain data and must not trigger execution or recursive expansion.
- Telemetry destination outages, queue overflow, process shutdown, malformed exporter responses, and partial flushes MUST never fail or alter the primary user operation.
- Existing permission prompts, approval replay, todo gating, fleet controls, compaction reconstruction, and single-child restart behavior remain regression-sensitive acceptance areas.
