# pi-livecraft comparison — post-adoption audit

> **Role:** current comparison and residual adoption guidance for
> `D:\Repository\pi-livecraft`. This document replaces the four historical
> pre-adoption reports that previously split architecture, UI, rendering, and
> the implementation plan.
>
> **Baseline:** pi-livecraft `1.1.0` at `f18acb7` (2026-08-05); pi-webui `dev`
> at `ce1640f` (2026-08-07). Both worktrees were clean when reviewed.
>
> **Status:** evidence and design guidance, not an active implementation plan.
> [`roadmap.md`](roadmap.md) remains the source of truth for candidate product
> work; [`design.md`](design.md) remains normative for visual decisions.

## 1. Executive conclusion

The first adoption pass successfully mined most of pi-livecraft's valuable
backend algorithms and framework-independent rendering behavior. The remaining
value is concentrated in **workbench information architecture, interaction
safety, and workspace integrations**, not in replacing pi-webui's runtime.

The strongest remaining adaptation is a real **multi-widget workspace-tools
rail**. The most urgent correctness work is composer draft safety, fresh
session-analysis data, responsive CSS repair, and large-session JSONL handling.

Keep pi-webui's defining constraints and advantages:

- zero build and the SDK as the runtime dependency;
- one Node bridge and one active SDK runtime per workspace;
- native SSE + fetch and a stable browser command protocol;
- bounded SDK initialization recovery;
- editable standalone and native JetBrains diff review;
- safeguard, subagents, agent-owned todos/discipline, and SDD;
- compaction-aware history and current-turn reconnect replay.

Do not import React, Vite, Radix, the manager/supervisor split, or process pooling.

## 2. What has already been adapted

| Area | pi-webui implementation |
| --- | --- |
| SDK runtime + bootstrap snapshot | `pi-sdk-runtime.js`, `server.js` `/api/snapshot` |
| Strict JSONL framing | `jsonl.js` |
| Process-tree termination | centralized server/isolated runner helpers |
| Workspace path confinement | `safePath`, `WorkspaceFileError`, realpath gates |
| Reconnect replay | `livebuf.js` + `snapshot.liveEvents` |
| Compaction-aware history | `session-entries.js` parent-chain reconstruction |
| Large session-list discovery | `recent-sessions.js` head/tail reader |
| Tool protocol normalization | `public/tool-protocol.js` |
| Typed tool previews | `public/tool-presentation.js`, `public/csv-preview.js` |
| Deferred highlighting/offscreen previews | `public/app.js`, `public/tool-presentation.js` |
| Detail modes | simple / headers / detailed in `public/app.js` |
| Command palette and slash completion | `public/app.js` + composer palette markup |
| Sticky-error/routine toasts | `public/app.js` |
| Session analysis and per-turn usage | `public/session-analysis.js`, analysis modal, usage strips |
| Git review and mutations | `git.js`, `/api/git*`, Git modal |
| Isolated prompt rewrite | `isolated-prompt.js`, `/api/improve-prompt` |
| Image preparation/input | `public/composer-images.js` |
| Theme source tokens | `public/style.css` dark + paperlike palettes |
| Centered transcript and jump-to-bottom | `public/style.css`, `public/app.js` |

The old Phase 0–5 plan is therefore historical implementation evidence, not a
useful current backlog.

## 3. Fresh source findings

### 3.1 The workspace-tools rail is complete

The W1 migration now has the persistent multi-widget shape described by the
comparison:

- `public/index.html` exposes `#toolsbar` with a fixed five-widget tab rail;
- `public/rail.js` owns canonical state, legacy migration, generation stamps,
  badges, and SDD visibility;
- `public/app.js` mounts one active panel, lazy-refreshes Git/Quotas, and routes
  Analysis, Git, Quotas, and Todos commands to the rail;
- narrow `w-mid`/`w-narrow` layouts use a contained bottom sheet with focus
  trapping and trigger restoration; Permissions remains a dedicated page.

The remaining analysis-freshness concern in §3.2 is separate from rail shape:
its renderer still depends on the existing live-message model and should be
addressed with the U4/A1 work rather than by adding another widget state path.

### 3.2 Session analysis can be stale

`lastMessages` is assigned by `applyMessages()` during snapshot/bootstrap.
Live `message_end` and `tool_execution_end` events update the DOM but do not
update that message array. The Usage rail widget analyzes `lastMessages`, so a
turn completed after bootstrap can be absent until a reconnect, session switch,
or reload performs another snapshot.

Fix this as part of U4/A1: maintain one canonical client message model, or fetch
only current messages after `agent_end` without rerendering the transcript. The
rail migration deliberately leaves that data-freshness concern separate.

### 3.3 Runtime transport

The former JSONL subprocess transport is no longer used by the webui. The main
bridge now reads the SDK session and entry tree directly, so large snapshot
records do not pass through a webui-owned JSONL decoder. `jsonl.js` remains for
legacy helper/test coverage and is not part of the primary runtime path.

pi-livecraft now distinguishes ordinary records from session records and allows
64 MiB for the latter (`server/jsonl.ts`, `server/pi-process.ts`, and
`server/manager-client.ts`).

**Adaptation:** use an explicit 64 MiB cap for the main Pi decoder, retain a
smaller cap for isolated processes, and surface an oversize-record error rather
than dropping it. Pair this with incremental history rendering so accepting a
larger response does not create a long main-thread stall.

### 3.4 Narrow-screen workspace rules lose the CSS cascade

The `max-width: 720px` block tries to remove the workspace margin and hide the
sidebar, but the base `body.ws-on` and `body.ws-on #wsbar` rules are declared
later and therefore win. The composer action row also has neither wrapping nor
horizontal overflow behavior.

pi-livecraft avoids this class of error by loading responsive rules after
feature styles and uses explicit 1200/900/480 breakpoints.

**Adaptation:** put final responsive overrides at the end of the stylesheet (or
load a dedicated `responsive.css` last), make sidebars drawers/bottom panels on
narrow layouts, and split the composer into primary actions plus a scrollable
or wrapping tool group. This matters for the narrow JetBrains JCEF panel even
without remote/mobile access.

### 3.5 Improve can overwrite a newer draft

The current Improve handler sends the trimmed textarea value and replaces the
textarea as soon as the isolated result returns. A user can continue editing
during that request, after which the older request overwrites the newer draft.

pi-livecraft presents Original and Suggestion with explicit Ignore/Use actions
and displays the isolated-run cost. That interaction is safer and more
informative.

### 3.6 The slash palette retains the old node-replacement interaction

The global Alt+K palette now delegates click/hover events and mutates selection
in place. The slash palette still rebuilds its item DOM from each
`mouseenter`, retaining the same class of mouse-click/flicker failure that was
fixed in the global palette. Reuse the delegated interaction model.

### 3.7 Pending extension dialogs survive refresh in Livecraft

Livecraft's manager stores each blocking `extension_ui_request` in a per-session
`pendingUi` map, returns that state in session listings, and refuses to reuse a
process while a request is pending. `App.tsx` restores the first visible request
after refresh; `Dialogs.tsx` awaits `sendPiCommand()` before closing and keeps the
request open on failure.

pi-webui should adapt this narrow pattern to its single Pi process: a server
pending-request map included in `/api/snapshot`, acknowledged first-response
handling, and a resolved broadcast for every tab. Do **not** adopt Livecraft's
multi-process manager/supervisor merely to obtain dialog recovery. Its generic
dialog still lacks pi-webui's policy/diff semantics; U6 owns those.

## 4. Recommended adaptations

### P0 — correctness and small high-value UX

| Candidate | Value | Effort | Notes |
| --- | --- | ---: | --- |
| Session-specific composer drafts | High | S | Debounced persistence; flush on switch/unload; clear only after accepted send; restore after failure. |
| Non-destructive Improve review | High | S | Original/Suggestion, Ignore/Use, loading state, request-version guard, model and cost. |
| Fresh analysis data | High | S–M | Update a canonical message model or refresh messages after `agent_end`. |
| 64 MiB main-session JSONL cap | High | S | Explicit main decoder cap and explicit oversize error; keep isolated caps smaller. |
| Pending permission broker | High | M | Adapt Livecraft's `pendingUi` recovery and acknowledged response; add pi-webui policy IDs, timeout, first-response, and multi-tab convergence. |
| Repair responsive cascade/composer | High | S–M | Final responsive layer, usable sidebar drawer, wrapping/scrolling composer tools. |
| Copy actions | High | S | User/assistant messages, tool input/output, then code blocks. |
| Complete Git controls | Medium–high | S | Backend already supports reset, revert, and per-file discard; expose them safely. |
| Keyboard-operable rail resizer | Medium | S | Arrow keys, Home/End, `tabindex`, and ARIA value metadata. |
| Delegate slash-palette interaction | Medium | S | Reuse the current Cmd+K event strategy. |
| Clean Bash tool headings | Medium | XS | Show `npm`, `git`, `python`, etc.; remove redundant `bash:` text. |

### P1 — workbench structure and productivity

#### 4.1 Unified workspace-tools rail — delivered 2026-08-20

The comparison's rail recommendation is now implemented as `#toolsbar` with
one active panel and fixed SDD, Git, Session analysis, provider-quota, and
agent-todo widgets. Badges cover Git changes, analysis failures, quota pressure,
todo count, and SDD phase/chunk state; Permissions remains a launcher to its
full page.

`public/rail.js` persists `{widget,open,width}` under `pi:rail` and registers
all widget routes through the existing command registry. On narrow screens and
slim JCEF tool windows, the active panel is a focus-contained bottom sheet
rather than a squeezed three-column layout. Detailed Git, quota, cost, and todo
information has left the always-visible statusbar; only action confirmations
remain modal.

#### 4.2 Composer productivity

Add the remaining useful Livecraft composer behavior without cloning its full
control density:

1. Persist text drafts per Pi session.
2. Review prompt improvements before replacing text.
3. Add a thin context-usage meter and a high-pressure Compact action.
4. Show steer/follow-up behavior only while Pi is running.
5. Add prompt-template preview, insertion, and authoring.

Model/thinking controls can remain in settings unless usage evidence justifies
always-visible composer chips.

#### 4.3 Prompt templates

The current slash palette can invoke templates Pi already exposes, but it cannot
preview or author them. Adapt:

- project save: `.pi/prompts/<name>.md`;
- global save: `~/.pi/agent/prompts/<name>.md`;
- no-overwrite writes (`flag: "wx"`);
- strict template-name validation;
- preview/insert from paths reported by Pi, never an arbitrary client path.

A client should send a template name/scope, not a filesystem destination. The
server must resolve the allowed location.

#### 4.4 Contextual conversation actions

Use explicit composition at the renderer that owns the data, as Livecraft does;
do not build a global action plugin system for a fixed set of controls.

Recommended order:

1. copy message;
2. copy tool input/output;
3. copy code block;
4. open referenced file;
5. branch/fork from a message, advancing the existing roadmap item.

Every icon action must be a native button, keyboard-operable, labelled, visible
on touch, and exposed on `focus-within`, not only pointer hover.

For file actions, standalone mode must pass through `safePath`. JetBrains should
prefer a native bridge to `FileEditorManager`, preserving IDE file type and
unsaved-editor context.

#### 4.5 Terminal, Explorer, and native IDE actions

`pi-livecraft/server/features/terminal/launcher.ts` and
`server/system-integration.ts` are mostly framework-independent Node logic:

- Windows Terminal, Alacritty, WezTerm, PowerShell, and cmd;
- Linux `x-terminal-emulator`;
- WSL to Windows Terminal;
- detached spawn;
- optional `{cwd}` command template parsed without a shell.

For pi-webui, routes must use authoritative `PI_CWD`; never accept a client cwd.
Standalone mode can launch native applications. The JetBrains plugin should
prefer IDE-native file and terminal APIs.

### P2 — useful but secondary

#### 4.6 Richer session analysis

`public/session-analysis.js` already models optional request/tool durations, but
the client does not supply telemetry. Add duration maps and then expose:

- ranking by input, output, failure, and observed duration;
- cumulative usage by tool;
- token-series toggles;
- click-to-tool navigation;
- costliest user turns.

An isolated-model "Interpretation" action is optional. It should never run
automatically or obscure that it incurs model cost.

#### 4.7 Directory picker for unseen workspaces

Current switching intentionally accepts only previously discovered workspace
roots. A directory picker would make a new repository openable without first
creating a Pi session elsewhere, but it changes the security boundary.

Use an explicit user gesture, validate and realpath the selected directory, and
issue a one-time capability before adding it to the workspace allowlist. Do not
copy an unrestricted directory-listing/cwd API. Keep switching disabled under
`PI_WEBUI_NO_SWITCH`.

#### 4.8 Editable keyboard shortcuts

Extend the existing `uiCommands` registry with default shortcut metadata,
persistent overrides, conflict detection, capture fields, and shortcut labels
in the palette. This is especially useful where JetBrains keymaps intercept
browser defaults.

Do not copy Livecraft's default table verbatim: it currently assigns `Alt+2` to
two commands. Validate uniqueness in tests.

#### 4.9 Visual personalization

Low-risk options:

- prose font choice independent of theme: mono, system sans, or serif;
- neutral right-aligned user bubbles, potentially only in simple mode;
- a real action-oriented empty state.

Defer the full editable theme engine. Dark and paperlike include tuned literal
neutral and syntax overrides; a correct custom-theme editor requires a palette
refactor, not just eight color inputs.

## 5. Long-session performance

Raising the session record cap must be paired with bounded rendering:

1. Render the most recent 50-message batch first, aligned to a user turn.
2. Mount older batches during later animation/idle frames.
3. Preserve scroll position when prepending older history.
4. Suppress per-message autoscroll/layout reads during replay.
5. Scroll once after the initial recent batch.
6. Keep navigation capable of materializing an older target on demand.
7. Add a bounded Markdown result cache for immutable historical messages.
8. Lazy-render closed reasoning on first expansion.

pi-livecraft's `conversation-scroll.ts` provides the useful batch-boundary
algorithm. React's `startTransition` is not portable; the behavior maps to
`requestAnimationFrame`/`requestIdleCallback` with a fallback.

## 6. What not to adapt

| Item | Reason |
| --- | --- |
| React/Vite/Radix/TypeScript runtime | Breaks the zero-build and minimal-dependency contract. |
| Backend/manager/supervisor split | Solves HMR-safe process survival that pi-webui does not need enough to justify the complexity. |
| Three-process-per-workspace pool | Large product/architecture shift; subagents already provide isolated parallel work. |
| Browser todo model | Conflicts with the canonical agent-owned todo list and `discipline.ts`. A future human inbox must be clearly separate. |
| Livecraft `ask_user_question` replacement | The existing smuggle contract is load-bearing; retain it. |
| Read-only edit workflow | pi-webui's editable standalone and native IDE diffs are stronger. |
| Wholesale violet/pink aesthetic | Conflicts with the normative dark/paperlike identity in `design.md`. |
| Unrestricted client cwd/path APIs | Would weaken `safePath`, known-workspace, CSRF, and DNS-rebinding boundaries. |
| Full quota migration to extension internals | Current provider coverage is broader; private credential APIs are a fragile dependency. |
| Always-on AI session interpretation | Additional latency/cost for optional explanatory value. |

## 7. Recommended sequence

1. **Correctness:** harden permission policy and pending-dialog delivery, then
   session-record cap, fresh analysis state, draft persistence, safe Improve
   review, and responsive cascade.
2. **Small interaction pass:** copy actions, Git control completion, keyboard
   resizers, delegated slash palette, cleaner tool headings.
3. **Workbench:** generic right rail; migrate SDD, Analysis, Git, Quotas, and
   agent Todos.
4. **Productivity:** prompt templates, context meter, terminal/explorer/open-file
   integrations.
5. **Performance/observability:** incremental history, duration telemetry, richer
   analysis views.
6. **Optional personalization:** shortcut editor, directory picker, prose font,
   and restrained conversation-shape options.

Before implementation, move accepted candidates into `roadmap.md` or a focused
SDD artifact. This audit itself is not permission to start all listed work.

## 8. Source map

| Candidate | pi-livecraft reference | pi-webui target |
| --- | --- | --- |
| Workspace-tools rail | `src/features/right-sidebar/{RightSidebar,WidgetLayout}.tsx` | `public/index.html`, `public/app.js`, `public/style.css` |
| Pending approval recovery | `server/manager.ts` `pendingUi`; `App.tsx` `handleSessionsRefreshed`; `features/dialogs/Dialogs.tsx` acknowledged `respond()` | `server.js` pending broker, `/api/snapshot`, `public/app.js`, U6 permission protocol/page |
| Drafts and Improve review | `src/features/composer/Composer.tsx` | composer section of `public/app.js` |
| Prompt templates | `src/features/composer/selects/PromptSelect.tsx`, `server/prompt-templates.ts` | `public/app.js`, new server module/routes |
| Copy/open actions | `CopyButton.tsx`, `OpenFileButton.tsx`, `conversation-actions.css` | message/tool render paths in `public/app.js` |
| Responsive layout | `src/styles/responsive.css` | final responsive layer in `public/style.css` or new late-loaded CSS |
| Incremental history | `conversation-scroll.ts`, `Conversation.tsx` | `applyMessages()` and transcript navigation |
| Rich analysis | `SessionAnalysisWidget.tsx` | `public/session-analysis.js`, analysis renderer/rail |
| Terminal/open path | `server/features/terminal/launcher.ts`, `server/system-integration.ts` | new CommonJS module, `server.js`, JetBrains bridge |
| Directory picker | `DirectoryPicker.tsx`, `directory-completion.ts` | workspace sidebar + capability-gated server route |
| Shortcut editing | `command-registry.ts`, `SettingsPanel.tsx` | `uiCommands`, settings drawer, global key handler |
| Session record cap | `server/jsonl.ts`, `server/pi-process.ts` | `jsonl.js`, main decoder construction in `server.js` |
