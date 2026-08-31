# UI/UX Action Plan

> **Role:** execution sequence for the **Now** and **Next** horizons in
> [`roadmap.md`](roadmap.md). Last rebuilt **2026-08-07** from
> [`improvements.md`](improvements.md), [`pi-livecraft.md`](pi-livecraft.md),
> [`design.md`](design.md), current source, and the JetBrains plugin.
>
> **Status:** no phase is active yet. Start each phase through `/skill:sdd` and
> create a dated `.sdd` plan/spec/tasks/verify set. This document coordinates
> dependencies and exit gates; the SDD artifacts own implementation detail.

The historical O3, O5, and M1 sections were closed/reverted/shipped and removed.
Their record remains in `CHANGELOG.md` and Git.

## 1. Phase map

| Phase | Roadmap IDs | Outcome | Status |
| --- | --- | --- | --- |
| A | U1, U2, U3, U4, U5, U6 | Correct, adaptive, accessible foundation, diff editing, and permission safety | Not started |
| B | W1 | Unified workspace-tools rail and calmer chrome | Delivered 2026-08-20 |
| C | C1, G1, S1 | Conversation, change-review, and session workflow | Blocked by A; follows B shell |
| D | X1, J1 | Explicit context, templates, and native IDE integration | Blocked by A/C contracts |
| E | P1, O1 | Long-session performance and richer observability | Blocked by U4/C1 |
| F | N1, A1, R1, K1, D1, Q1 | Conditional follow-ons | Requires separate decision |

Run one phase at a time. Within a phase, keep slices independently reviewable
and avoid two simultaneous changes to `public/app.js` module-scope state.

## 2. Delivery rules

1. **Read the matching gotchas before implementation.** Common touchpoints:
   `GOTCHAS.md` #4/#10 for paths/security, #5 for `api()`, #6/#7 for diffs,
   #8 for `app.js` state, #11 for assets, #13 for streaming/finalization,
   #16/#17 for JetBrains, and #18 for Windows Git.
2. **Preserve zero-build operation.** New browser feature modules must be plain,
   dual-mode JS where pure logic needs Node tests; load order and `STATIC`
   whitelist changes are explicit.
3. **Keep server authority.** The browser may send IDs, names, and capabilities,
   never an unchecked cwd/path.
4. **Prefer native semantics over ARIA reconstruction.** Use `<button>`,
   `<details>`, headings, and labelled regions before role-heavy divs.
5. **No silent failure.** Network, oversize, extension, and permission failures
   remain visible and actionable.
6. **No speculative abstraction.** A fixed widget/action table is enough; do not
   build a plugin framework.
7. **Update the SSOTs at each exit gate.** Finished work goes to
   `CHANGELOG.md`; changed visual behavior updates `design.md`; the roadmap drops
   delivered items instead of preserving checked-off implementation prose.

## 3. Phase A — Correctness and accessibility foundation

**Security ordering:** after A0 fixtures, land A6 steps 1–6 (policy attack
fixes, storage, and gate coordination) as Phase A's first runtime slice. Then
complete A1–A5 and finish A6 steps 7–14 against their stable live-state/diff
contracts. The heading order preserves topical readability, not permission to
defer the verified auto-allow defects.

### A0. Establish repeatable baselines

Before changing behavior:

1. Capture standalone screenshots at 1440×1000, 1024×768, 720×900, and 480×900
   in both themes.
2. Capture a narrow and floating JetBrains tool window.
3. Prepare fixtures for:
   - a fresh empty session;
   - a streaming turn with thinking and tools;
   - editable approval and transcript diffs covering modification, unequal
     addition/deletion, tabs, long lines, Unicode, CRLF, and final newlines;
   - permission calls covering simple/compound Bash, substitutions/redirection,
     sensitive and symlinked paths, malformed policy, browser reload while
     waiting, two tabs racing, timeout/abort, and a failed response POST;
   - a compacted session;
   - a 500-message session;
   - an oversized-but-valid JSONL response near the intended cap.
4. Record keyboard order from header → navigation → transcript → composer →
   status/rail.
5. Record current paperlike contrast ratios in the planned token test.

Do not commit screenshot binaries unless a later decision establishes visual
regression fixtures. They are initially a manual comparison aid.

### A1. Large-record and live-state reliability — U4

**Primary files:** `pi-sdk-runtime.js`, `server.js`, `public/app.js`,
`public/session-analysis.js`, `test/sdk-events.test.js`, `test/rpc-sse.test.js`, and
possibly one new pure session-state test module.

Steps:

1. Normalize SDK session events with an explicit oversize disposition that can
   be observed by the server; do not throw uncaught from event handling.
2. Keep primary SDK event and isolated prompt output limits independently
   bounded.
3. Reject matching pending SDK requests immediately and broadcast a useful
   error when an event is dropped.
4. Add boundary tests: exactly-at-cap, over-cap, split UTF-8, recovery on the
   following valid line, and pending-request rejection.
5. Make analysis read current messages:
   - preferred: one canonical client session model updated by snapshot and live
     events;
   - acceptable first slice: a messages-only refresh on analysis open and
     `agent_end` that does not rebuild the transcript.
6. Refresh the active session row after `agent_end`, rename, and session switch.
7. Handle `auto_retry_end` and `extension_error` with deduplicated persistent
   state/toasts appropriate to severity.
8. Verify reconnect/live-buffer ordering is unchanged.

**Exit evidence:** cap/recovery unit tests, SDK rejection test, and a live turn
that appears immediately in Analysis without reload.

### A2. Draft-safe composer and Improve review — U3

**Primary files:** `public/app.js`, `public/index.html`, `public/style.css`,
`isolated-prompt.js`; preferably a small pure `public/composer-drafts.js` with a
Node unit test.

Steps:

1. Define the draft key from workspace + Pi session identity, with a separate
   new-session fallback.
2. Restore on snapshot/session switch; debounce writes; flush on switch and
   page hide/unload.
3. Keep text and pending images until `/api/cmd` accepts the send.
4. On failure, preserve/restore the complete composer state and focus it.
5. Prevent duplicate sends while the acceptance request is pending.
6. Replace immediate Improve overwrite with a review surface:
   - Original and Suggestion;
   - Use / Ignore;
   - model, duration, and cost when available;
   - request generation/token so stale results cannot replace newer input.
7. Preserve undo behavior by setting the textarea through one controlled path
   and dispatching any required input/autosize update.
8. Keep image-only send and running steer/follow-up behavior covered.

**Exit evidence:** failed-send restoration, per-session isolation, reload
restoration, stale-Improve race test, and image-only manual smoke.

### A3. Adaptive shell and chrome — U1

**Primary files:** `public/style.css`, `public/index.html`, `public/app.js`.

Steps:

1. Move all responsive overrides into one final cascade section or layer.
2. Replace `min(240px, 26vw)` with a usable desktop clamp; switch the left
   sidebar to an overlay/drawer before it can squeeze the transcript.
3. Compact footer/status behavior from available width:
   - prefer CSS container queries if supported by the minimum JCEF version;
   - otherwise one bounded `ResizeObserver` that toggles named width classes.
4. Split composer actions into primary and overflow groups. Keep Send/Stop and
   attachment reachable without horizontal scrolling.
5. Add a thin context-pressure meter; keep Compact in overflow while usage is
   low and promote it with a clear nudge near the agreed threshold.
6. Remove Sessions/New duplication while the left navigation is visible.
7. Hide the idle activity row; reserve it for work/intervention/error states.
8. Keep repository/model/context as the compact status set; move secondary
   metadata behind a labelled disclosure and later W1.
9. Replace the pseudo-element empty state with stateful DOM and one primary
   action.
10. Add dynamic viewport and safe-area handling.
11. Exercise modals, image strip, todos, SDD rail, Git diff, and permission UI
    at every baseline width.

**Exit evidence:** no page-level horizontal scrollbar or clipped action at any
baseline width/theme; JCEF remains usable with `PI_WEBUI_NO_SWITCH`.

### A4. Contrast, semantics, keyboard, and focus — U2

**Primary files:** `public/style.css`, `public/index.html`, `public/app.js`,
`docs/design.md`, new `test/theme-contrast.test.js`, and optionally a small
static HTML-contract test.

Steps:

1. Darken paperlike muted/semantic foregrounds against every surface where they
   render small text; override `--on-accent` for paperlike.
2. Parse source tokens in a zero-dependency test and assert documented pairs:
   4.5:1 normal text, 3:1 large text/non-text boundaries where applicable.
3. Replace `.tool .head` role-buttons with native buttons while preserving card
   animation and `aria-expanded`.
4. Make rail/sidebar resizers focusable and implement Arrow, Home, End, and
   Enter behavior plus value/control metadata.
5. Label the composer, transcript, navigation, tools rail, dialogs, and command
   inputs.
6. Group turns as labelled articles/feed entries with stable IDs.
7. Add one coarse `role="status"`; explicitly keep token deltas outside live
   regions.
8. Set/clear `aria-busy` during snapshot render and later history prepend.
9. Audit 24×24px pointer targets and spacing, especially header/sidebar mini
   buttons and image remove controls.
10. Add `scroll-padding-block` and verify focused controls are not hidden by
    sticky header/footer/drawers.
11. Complete combobox/listbox state and replace slash-palette rebuild-on-hover
    with delegated in-place selection.
12. Run keyboard-only and NVDA + Edge smoke tests.

### A5. Editable diff correctness — U5

**Primary files:** `public/app.js`, `public/style.css`, `server.js`; preferably
extract pure line/diff/serialization behavior to `public/diff-view.js` with new
`test/diff-view.test.js`, plus conflict tests in
`test/workspace-file.test.js`.

Steps:

1. Inventory all three paths before changing the shared renderer:
   - read-only transcript/permission preview;
   - editable standalone approval capture;
   - editable post-apply transcript view.
   Keep the native JetBrains `DocumentContent` path behaviorally unchanged.
2. Fix the immediate geometry defect with shared CSS variables for font family,
   exact pixel line height, block padding, tab size, letter/word spacing, and
   gutter width. Apply the same block padding to `.sx-body` and `.sx-ta`; the
   current 0px-versus-6px mismatch is the constant low-caret offset.
3. Give the gutter an explicit `digits + inline padding` flex basis so async
   real-line-number updates cannot create a different text origin from the
   textarea. Reserve sufficient digits before focus where possible.
4. Remove transparent-overlay text as the editing plane:
   - **Review** renders the aligned, syntax-highlighted old/new rows;
   - **Edit** renders normal visible textarea text, caret, and selection;
   - returning to Review recomputes the aligned diff;
   - raw editor lines are never overlaid on blank deletion placeholders.
5. Preserve native textarea undo/redo, selection, scroll, IME/composition,
   clipboard, tabs, and focus while switching/repainting. Verify 100%, 125%,
   and 150% zoom and both themes.
6. Replace per-animation-frame full LCS/highlighting with a 120–200ms debounced
   or idle recompute. For large hunks, show an explicit paused/fallback state and
   update on Review/blur instead of blocking typing.
7. Add conflict-safe Apply:
   - `/api/file` returns a whole-content hash/version;
   - Apply sends the expected version;
   - `/api/write` rechecks immediately before writing and returns `409` on
     mismatch;
   - the diff shows Reload / Compare / Cancel inline and never overwrites the
     newer disk content.
   Preserve the existing missing/duplicate-hunk checks.
8. Add dirty state, Reset Proposal, `Ctrl/Cmd+Enter` Apply, an explicit textarea
   label containing the file name, visible inline success/error state, and
   controls meeting the 24px target rule.
9. Test pure diff alignment for equal and unequal change runs, empty/final lines,
   tabs, Unicode, and gutter-width transitions. Manually smoke caret/selection,
   scrolling, resize, capture return values, Apply, and conflict recovery in
   both modal and transcript forms.

**Exit evidence:** the caret and selected text coincide with visible editor text
before and after deletions at all tested zoom levels; typing remains responsive
on the agreed large fixture; stale disk content produces a recoverable 409; the
native IDE approval contract and standalone capture result remain unchanged.

### A6. Permission policy, broker, and editor — U6

**Primary files:** `extensions/pi_minimal_webui/{safeguard,discipline,index}.ts`,
`server.js`, `public/app.js`, `public/style.css`, `public/index.html`,
`jetbrains/src/main/kotlin/com/gorowynn/piwebui/{PiWebuiToolWindowFactory,DiffReviewEditor}.kt`;
prefer new pure `safeguard-policy.js`, `permission-broker.js`, and
`public/permission-protocol.js` modules plus
`test/{safeguard-policy,permission-broker,permission-protocol}.test.js`.

Steps:

1. Lock the current attack cases into failing tests before changing defaults:
   compound/chained commands, substitutions, redirects, mutating Git subcommands,
   unsafe path spellings/symlinks, corrupt config, and the ineffective
   “Allow always” rule appended behind `.env* → ask`.
2. Extract and compile policy separately from Pi/UI adapters. Return a typed
   decision containing effect, risk, matched rule ID/source, canonical selector,
   remember eligibility/scopes, and a redacted display descriptor.
3. Make Bash auto-allow conservative:
   - tokenize/split recognized shell separators without executing a shell;
   - reject auto-allow on substitution, backticks, process substitution,
     redirection, multiline ambiguity, or an unparsed construct;
   - require every simple subcommand to match a complete safe rule;
   - remove `echo` and unrestricted `git branch`/`git remote` defaults.
4. Normalize path selectors relative to `ctx.cwd`, inspect existing realpath and
   symlink hops, retain a safe spelling for not-yet-existing writes, and apply
   sensitive/outside-workspace policy to read, edit, write, grep, find, list,
   and registered path-capable tools.
5. Introduce versioned policy storage and migration:
   - hard deny → mandatory ask → remembered exact grant → ordinary ask → allow;
   - user-global and canonical-workspace layers in the fixed user config;
   - project policy may add deny/mandatory-ask constraints but cannot grant;
   - schema diagnostics, atomic mode-0600 writes where supported, revision/hash
     conflict handling, and locked-down fallback on parse failure;
   - `nonInteractive` defaults to block; constrained subagent children opt in
     explicitly while retaining their `--tools` capability wall.
6. Coordinate package gates so cheap todo-discipline blocking runs before any
   human prompt and safeguard sees the final known normalized input. Document
   Pi's remaining limitation that later external `tool_call` handlers can mutate
   input without revalidation; pursue an upstream priority/final-hook API rather
   than claiming an absolute boundary.
7. Replace label inference with a versioned WebUI-only permission latch:
   `server.js` owns `PI_WEBUI_PERMISSION_MARKER`; the payload carries
   `toolCallId`, protocol version, policy descriptor, and eligible decision
   enums. The browser keys tool arguments by `toolCallId`; TUI keeps native
   `ctx.ui.select()`. Parse and validate edited diff responses before mutating
   `event.input`, while accepting legacy labels only during migration.
8. Add a server-owned blocking-UI broker:
   - store dialog requests before SSE broadcast;
   - include them in `/api/snapshot` after live tool-event replay;
   - accept responses only for pending IDs and make the first response win;
   - broadcast resolved/expired state to every tab;
   - clear on response, timeout, abort, Pi exit, or workspace switch;
   - never replay fire-and-forget extension UI as a blocking request.
9. Add an acknowledged `/api/ui-response` client path. Disable controls while
   sending, close only after success, retain Retry after failure, and make
   Escape/backdrop an explicit Deny. Pass `ctx.signal` plus a configurable
   fail-closed timeout so a missing browser cannot strand Pi indefinitely.
10. Render the pending decision inside its tool card, with a sticky action row,
    deterministic risk reasons, matched rule, exact scope language, and U5's
    Review/Edit surface for edit/write. The initial focus is the heading or
    Deny—never an allow action—and Enter alone cannot approve.
11. Build the dedicated **Permissions page** in the existing shell:
    - addressable `#permissions` route with Back, Settings, command-palette, and
      rail badge/launcher entry points;
    - overview cards for policy mode/config health, pending count, headless
      posture, and workspace scope;
    - structured Rules view grouped by built-in floor, user-global, and current
      workspace, with effect/tool/matcher/scope/provenance and add/edit/delete;
    - Active Grants view with exact scope, expiry/source, revoke, and clear-all;
    - Pending and redacted Audit views without raw secret-bearing commands;
    - Explain form that evaluates a sample tool/input and shows precedence;
    - advanced raw JSON view with validation, normalized preview/diff, unsaved
      navigation guard, and no save until valid.
12. Back the page with fixed, purpose-specific APIs—`GET/PUT /api/permissions`,
    an Explain endpoint, and bounded grant revoke/clear operations. Use expected
    revisions and `409` recovery, schema-validate every write, and keep config
    location/canonical workspace resolution server-owned. The extension remains
    the decision authority and publishes redacted grant-state revisions through
    one typed control channel; do not create a second browser policy engine.
13. Apply minimum JetBrains hardening now: canonical project containment before
    reading a `VirtualFile`, request-ID-keyed promise resolution, fail-closed
    reload/disposal, policy metadata in the native header, and detection of
    unsaved/conflicting documents. D3 later generalizes the rest of the bridge.
14. Test SDK runtime, browser, and JetBrains behavior; simple/parallel
    calls; one/two tabs; reload/reconnect; no-tab timeout; abort; Pi crash;
    workspace switch; policy edit conflicts; legacy migration; and revoke.

**Exit evidence:** attack fixtures never auto-allow; a pending approval can be
answered after reload without duplicating execution; failed delivery never loses
the decision; stale/second-tab responses are rejected and all clients converge;
invalid policy cannot save or weaken the active floor; the Permissions page can
explain, edit, conflict-recover, and revoke without receiving an arbitrary path;
and TUI/native IDE fallbacks remain fail-closed.

### Phase A exit gate

All of the following must be true before Phase B:

- no draft loss or stale Improve overwrite;
- no silent oversized-record timeout;
- analysis contains the just-finished turn;
- no horizontal page/composer/status overflow at baseline widths;
- paperlike tested text pairs pass;
- tool disclosures and splitters work with keyboard only;
- editable diff caret/selection alignment survives deletion rows and zoom;
- stale-file Apply returns a recoverable conflict instead of overwriting;
- compound Bash/substitution/redirection attacks do not pass safe auto-allow;
- pending approvals survive reload, failed POST, timeout, and multi-tab races;
- the Permissions page validates, revision-checks, explains, and revokes policy;
- empty/disconnected/loading/error states are persistent and labelled;
- existing reconnect, approval, editable diff, image, and session smokes pass.

## 4. Phase B — Unified workspace-tools rail

### B1. Define the shell — W1 (delivered 2026-08-20)

**Primary files:** `public/index.html`, `public/style.css`, `public/app.js`; add a
small pure rail-state module only if it materially reduces `app.js` state risk.

1. Rename/generalize SDD-specific outer DOM to a workspace-tools rail.
2. Define a fixed widget table: ID, label, icon, badge provider, render/open,
   refresh policy, and command ID.
3. Persist active widget, expanded state, and width in one canonical rail preference.
4. Keep only one mounted active panel unless preserving a widget DOM is required
   for unsaved input.
5. Add accessible tab/rail selection and command-palette registration.
6. Add a pending/config-error badge and launcher for U6's dedicated
   `#permissions` page; keep the structured editor out of the narrow rail.
7. Use the Phase A splitter contract.

### B2. Migrate widgets one at a time

Order minimizes risk:

1. SDD — proves current behavior survives the shell.
2. Analysis — fix freshness already landed in A1.
3. Git — migrate the current list/diff plus Commit, Push, and Discard-all
   behavior without changing mutation semantics; C2 adds the missing scoped
   actions and request summary.
4. Quotas — move detail out of header/footer while retaining compact warning.
5. Agent Todos — preserve canonical tool-owned state and discipline behavior.

Permissions remains a dedicated page rather than a sixth squeezed widget. The
rail owns only its status badge/launcher and pending-attention indication.

**Status:** delivered 2026-08-20; all five widget routes now use the rail, with
action-specific confirmation modals retained where needed.

The desktop, narrow-drawer, reconnect, and keyboard smoke gate has passed for
each widget. Detail routes now open the rail; only action-specific confirmation
modals remain.

### B3. Narrow behavior and status consolidation (delivered 2026-08-20)

1. Render the active widget as a focus-trapped drawer/bottom sheet when the
   content-width class requires it.
2. Restore focus to the rail trigger on close.
3. Show badges as icon + accessible text, never color alone.
4. Remove migrated detail from the statusbar/header.
5. Lazy-fetch Git/quota/analysis data and cancel or ignore stale responses.

### Phase B exit gate

All five widgets are reachable by rail, command palette, and keyboard; the
Permissions launcher reaches its full page and announces pending attention;
narrow content is not permanently obscured; existing SDD/Git/analysis/quota/
todo behavior and confirmation semantics remain intact; no retired status
detail remains duplicated in three surfaces.

## 5. Phase C — Conversation, changes, and sessions

### C1. Turn actions and navigation — C1

**Primary files:** `public/app.js`, `public/style.css`; preferably a pure
`public/conversation-actions.js` serializer with unit tests.

1. Define stable turn IDs shared by history and live rendering.
2. Implement clipboard fallback once, then add:
   - Copy Message;
   - Copy Final Response;
   - Copy Turn as Markdown;
   - Copy All as Markdown;
   - Copy Code;
   - Copy Tool Input/Output.
3. Add previous/next prompt and code-block navigation commands.
4. Mount actions at the renderer that owns the data; avoid a global plugin
   registry.
5. Show actions on hover, focus-within, and touch; preserve a clean reading
   surface otherwise.
6. Add safe open-file action with standalone `safePath` validation and a J1
   bridge hook.

### C2. Request change summary and Git completion — G1

**Primary files:** `git.js`, `server.js`, `public/app.js`, `public/style.css`,
rail widget/diff-view code, `test/git.test.js`, and `test/diff-view.test.js`.

1. Specify what counts as request-local:
   - record a pre-turn Git snapshot and compare post-turn; or
   - explicitly label a tool-event-derived list as “files touched by tools”.
2. Do not present repository-wide pre-existing changes as caused by the request.
3. Render changed paths and +/- counts after the assistant turn.
4. Open per-file or all-file diffs in web; prefer native diff in JetBrains.
5. Build on U5's correct Review/Edit split with secondary review controls:
   - side-by-side / unified;
   - previous / next change;
   - wrap long lines;
   - show/hide whitespace;
   - Copy Old / New / Hunk and Open File.
6. Add bounded intraline emphasis for paired modified lines. Fall back to
   line-level coloring above a per-line character cap.
7. Expose existing reset/revert/per-file-discard server operations in the rail.
8. Confirm destructive operations, refresh both rail and turn summary, and
   preserve Windows `git.exe` selection.
9. Test spaces, rename/delete/untracked/binary files, empty repos, detached HEAD,
   and Windows spawn behavior.

### C3. Session navigation and branch specification — S1

**Primary files:** `recent-sessions.js`, `server.js`, `public/app.js`,
`public/style.css`, session tests.

1. Show current session name in header and current row.
2. Refresh row title/date/size on authoritative events.
3. Add rename, pin, and non-destructive archive/done filtering.
4. Use a consistent action menu with disabled reasons and touch access.
5. Add keyboard row navigation only after listbox/menu semantics are specified.
6. Feature-detect a native Pi fork command. If absent, write a separate spec for
   atomic JSONL fork/truncate using temp file + rename and parent-chain-safe IDs.
7. Never market a branch as parallel execution; switching remains shared across
   tabs.

### Phase C exit gate

Conversation content can be copied/navigated without pointer input; request
changes are not confused with pre-existing dirt; every exposed Git action has
tests/confirmation; session organization does not mutate or delete underlying
history unexpectedly.

## 6. Phase D — Context, templates, and JetBrains

### D1. Prompt templates — X1

**Primary files:** new `prompt-templates.js`, `server.js`, `public/app.js`,
`public/index.html`, tests.

1. Discover and preview project/global templates through server-resolved paths.
2. Save by validated name and scope only.
3. Use no-overwrite creation and report collision explicitly.
4. Insert without sending so the user can edit.
5. Integrate with slash palette and command palette without duplicate command
   names.

### D2. Explicit context chips — X1

1. Define a bounded context object: type, display label, server token/capability,
   byte estimate, and removable state.
2. Add safe file completion and drag/drop; reuse current image handling.
3. Read/resolve content only on the server under `PI_CWD`.
4. Enforce per-item and total byte limits before send.
5. Warn on large context and offer remove/summarize-first rather than silently
   truncating.
6. Represent selected JetBrains text as explicit text context, not a fake path.

### D3. Native JetBrains bridge — J1

**Primary files:** `PiWebuiToolWindowFactory.kt`, potentially a new bridge data
model/action file, `public/app.js`, `jetbrains/README.md`, plugin tests/smokes.

1. Replace the single-purpose global callback shape with named, versioned bridge
   capabilities while preserving U6 decision-enum/diff compatibility.
2. Complete U6 native approval integration: request-keyed resolvers, canonical
   project containment, policy/risk/scope header, unsaved-document handling,
   invalid-hunk conflict state, safe initial focus, and fail-closed reload/close.
3. Add Open File, Attach Active File/Selection, and Open Terminal handlers.
4. Add native tool-window toolbar actions for narrow-mode essentials.
5. Set preferred focus component and restore focus after diff decisions.
6. Inject IDE identity, theme family, and bridge capabilities on every load.
7. Dispose each `JBCefJSQuery` and load handler with content.
8. Use `ToolWindowManager.invokeLater()` where tool-window state is involved.
9. Test JCEF unsupported fallback, project disposal, reload, diff denial on
   close, path escape, unsaved editor conflict, and shortcut collisions.

### Phase D exit gate

Browser context cannot escape the workspace; templates cannot overwrite
silently; IDE file/selection/terminal actions are explicit and native;
standalone behavior degrades cleanly when no bridge is present.

## 7. Phase E — Long sessions and observability

### E1. Incremental history — P1

**Primary files:** `public/app.js`, `public/style.css`, optional pure
`conversation-scroll.js`, session fixtures/tests.

1. Extract a pure user-turn-aligned batch-boundary function.
2. Render newest 50 messages first with replay autoscroll disabled.
3. Prepend older batches while preserving the visible anchor.
4. Materialize target batches for turn/code navigation.
5. Add bounded Markdown cache keyed by immutable source + renderer version.
6. Lazy-render closed historical thinking.
7. Add `content-visibility` only to immutable turns and provide intrinsic-size
   estimates; verify hidden controls remain correct in the accessibility tree.
8. Keep browser find/copy semantics; do not unmount the currently searched or
   focused turn.

### E2. Duration-aware analysis — O1

1. Capture request/tool start/end timing without modifying stored Pi messages.
2. Feed optional durations into the existing pure analysis module.
3. Add metric selection for calls/input/output/failures/duration.
4. Link rankings back to materialized transcript turns/tools.
5. Keep data bounded per current session and avoid chart dependencies.

### Phase E exit gate

A 500-message session shows recent content promptly, older navigation preserves
position, browser find/copy and NVDA reading remain usable, and analysis matches
the current turn without unbounded telemetry.

## 8. Phase F — Separate decision gates

Do not batch these into the main UI program:

- **N1 notifications:** proceed only with opt-in/hidden-tab policy.
- **A1 shortcuts/fonts:** proceed after command/rail contracts stabilize.
- **R1 remote auth:** requires a security/threat-model SDD, not a UI-only patch.
- **K1 checkpoints:** requires restore/conflict/storage semantics after G1.
- **D1 directory picker:** requires a one-time capability and allowlist spec.
- **Q1 context pruning/pins:** requires verified Pi SDK session feasibility.

Each gets its own plan/spec if promoted.

## 9. Validation matrix

Run affected unit tests before broader checks. The project has no framework or
build step; keep validation zero-dependency.

| Surface | Automated checks | Manual smoke |
| --- | --- | --- |
| SDK/SSE | `test/pi-sdk-runtime.test.js`, `test/rpc-sse.test.js`, live-buffer/session-entry tests | runtime replacement mid-turn; oversize response |
| Composer | pure draft/serialization tests, `node --check public/app.js` | failure restore, session switch, image-only, stale Improve |
| Responsive | static contract/token tests | 1440/1024/720/480, both themes, PWA |
| Accessibility | contrast and markup-contract tests | keyboard-only, NVDA + Edge, touch emulation |
| Diff editing | `test/diff-view.test.js`, workspace-file hash/conflict tests | add/delete/modify, selection/IME, 100/125/150% zoom, modal/transcript/IDE |
| Permissions | policy/protocol/broker/config endpoint tests | compound commands, sensitive paths, SDK/IDE, reload, failure, timeout, two tabs, edit/revoke |
| Rail/widgets | pure state tests where extracted | desktop, drawer, reconnect, stale request |
| Git/changes | `test/git.test.js` plus endpoint tests | edit/apply/discard/reset/revert/push, Windows |
| Sessions | `test/recent-sessions.test.js`, session-entry tests | rename/pin/archive/switch/compaction |
| Context/templates | path/name/size/security tests | drag/drop, collision, large input, traversal denial |
| JetBrains | Gradle tests/build and bridge-contract fixtures | docked/floating/narrow, reload, native diff/file/terminal |
| Long history | batch-boundary/cache tests with 500-message fixture | anchor preservation, find, copy, navigation, NVDA |

Before each phase is declared complete:

1. run LSP/lens diagnostics on edited files;
2. run affected tests, then every zero-dependency test script;
3. run `git diff --check`;
4. perform the phase's smoke matrix;
5. update `design.md`, `AGENTS.md`/`GOTCHAS.md` only where their SSOT roles
   require it;
6. add one dated `CHANGELOG.md` entry;
7. remove delivered items from the roadmap/action plan rather than leaving a
   growing checked-off archive.
