# UI Improvement Research

> **Role:** current source-backed UI/UX, accessibility, and perceived-performance
> audit for pi-webui. Last reviewed **2026-08-07** against the live standalone
> UI, the JetBrains plugin, and primary design/accessibility sources.
>
> This replaces the 2026-07-21 cross-cutting snapshot. Previously resolved
> package/safeguard/reconnect work was removed rather than retained as a second
> changelog; §4.8 records newly verified permission-policy and delivery defects.
> [`roadmap.md`](roadmap.md) remains the source of truth for accepted
> product candidates; [`design.md`](design.md) remains normative for visual
> decisions. The pi-livecraft-specific comparison lives in
> [`pi-livecraft.md`](pi-livecraft.md).

## 1. Executive summary

The current UI is functionally strong but visually split between a capable
coding-agent transcript and dense utility chrome. The next improvement pass
should not add more controls to the footer. It should establish a clearer
workbench hierarchy:

1. **Conversation is primary.** Keep the transcript and composer visually
   dominant.
2. **Navigation belongs left.** Workspaces and sessions form one searchable,
   action-capable navigation surface.
3. **Inspection belongs right.** Git, analysis, quotas, SDD, and agent todos
   share one compact workspace-tools rail.
4. **Only immediate actions remain in the composer.** Send/Stop, attachment,
   and active delivery behavior stay visible; session, compact, and infrequent
   actions move to contextual or overflow surfaces.
5. **State is announced once.** Connection, activity, context pressure, and
   failures must not compete across header, activity row, toast, and statusbar.

Highest-priority fixes:

- repair the narrow-screen cascade and composer/statusbar overflow;
- persist drafts and make Improve non-destructive;
- correct paperlike small-text contrast;
- add transcript/status semantics and keyboard-operable splitters;
- harden permission policy/delivery and provide a structured WebUI editor;
- replace the CSS-only empty state with useful, accessible actions;
- keep analysis/session UI synchronized with live events.

Highest-value structural feature: generalize the SDD bar into a multi-widget
right rail.

## 2. Research method

### Current-product inspection

The audit covered:

- `public/index.html`, `public/style.css`, and the rendering/composer/session
  paths in `public/app.js`;
- `public/{tool-presentation,session-analysis,composer-images}.js`;
- `server.js` routes that constrain workspace, Git, session, and extension-UI UX;
- `livebuf.js` plus `extensions/pi_minimal_webui/{safeguard,discipline,index}.ts`;
- `PiWebuiToolWindowFactory.kt` and `DiffReviewEditor.kt`;
- headless Edge captures at **1440×1000** and **480×900** against the running
  application;
- a WCAG contrast calculation over current dark and paperlike source tokens.

### External primary sources

The comparison used current documentation from:

- VS Code Copilot Chat, Agent Sessions, and approval/permission controls;
- Cline checkpoints and Auto Approve;
- Claude Code permission rules, command parsing, and path/scope behavior;
- Pi SDK extension-UI protocol documentation and permission examples;
- WAI-ARIA Authoring Practices for feeds, toolbars, and window splitters;
- WCAG 2.2 guidance for contrast, target size, status messages, and unobscured
  focus;
- GitHub Primer ActionList;
- web.dev `content-visibility` guidance;
- IntelliJ Platform tool-window documentation.

Framework code and aesthetics were not treated as transferable. Only behavior
that maps cleanly to zero-build vanilla JS and JCEF was considered.

## 3. What already works well

Preserve these foundations:

- centered, bounded transcript width on large screens;
- clear dark-theme hierarchy and high dark-theme contrast;
- safe Markdown, syntax highlighting, typed tool previews, and bounded output;
- editable web diffs and native JetBrains diff approval;
- simple / headers / detailed transcript modes;
- jump-to-latest with unread count;
- semantic workspace/session row buttons and visible `:focus-visible` rings;
- keyboard-trapped approval/selection modals;
- reduced-motion overrides;
- offscreen tool-preview virtualization through `IntersectionObserver`;
- command palette and slash completion with listbox/option semantics;
- current-turn reconnect replay and compaction markers;
- explicit permission-risk presentation;
- persisted theme, view, sidebar, and rail preferences.

The goal is to simplify and connect these pieces, not redesign the product from
scratch.

## 4. Verified current issues

### 4.1 Responsive behavior is visibly broken — P0

At 480px wide, the workspace sidebar remains visible at roughly 127px and the
composer clips after the Improve select. The intended `max-width: 720px` rule
is declared before the later base workspace-sidebar rules, so the base rules
win the cascade.

At 1440px, opening the 240px workspace sidebar leaves too little content width
for the statusbar, which falls back to a visible horizontal scrollbar even
though the viewport itself is wide. Viewport breakpoints cannot account for
space consumed by fixed sidebars.

Required direction:

- move responsive overrides to the final cascade layer;
- compact based on **available component width**, using container queries or a
  small `ResizeObserver`, not viewport width alone;
- make left/right sidebars overlays or bottom sheets when the transcript would
  become narrower than its usable minimum;
- never require horizontal scrolling for composer actions or status metadata;
- use `100dvh` and safe-area padding for installed/mobile use.

### 4.2 Paperlike contrast is insufficient for its actual text sizes — P0

Current source-token ratios, calculated using the WCAG relative-luminance
formula:

| Foreground / background | Ratio |
| --- | ---: |
| paperlike `muted` / `surface-raised` | 3.04:1 |
| paperlike `accent` / `surface` | 4.15:1 |
| paperlike `secondary` / `surface` | 4.04:1 |
| paperlike `success` / `surface` | 4.13:1 |
| paperlike `warning` / `surface` | 4.07:1 |
| paperlike `cyan` / `surface` | 4.43:1 |
| inherited `on-accent` / paperlike `accent` | 3.85:1 |

These colors are used at 10–13px, so the normal-text requirement is 4.5:1, not
the 3:1 large-text threshold. Dark-theme common text pairs pass.

Required direction:

- darken paperlike muted and semantic foreground tokens against the lightest
  surface on which each is used;
- define a paperlike-specific `--on-accent` rather than inheriting dark text;
- reserve non-passing semantic colors for borders/icons only until fixed;
- add a tiny zero-dependency contrast test for every documented foreground /
  background pair so tokens cannot regress.

### 4.3 Composer actions do not reflect frequency or state — P0/P1

The action row always exposes Send, Stop, delivery mode, Improve, Compact,
Sessions, and New. On desktop, Sessions/New duplicate the visible left sidebar;
on narrow surfaces, lower-frequency actions crowd out the primary task.

The current `send()` also clears the draft and optimistic user bubble before
`api()` succeeds. Improve can overwrite text entered after its request began.

Required direction:

- primary row: **Send/Stop** and attachment;
- show steer/follow-up control only while a request is running;
- show Compact prominently only under meaningful context pressure;
- move Sessions/New to navigation and infrequent actions to an overflow menu;
- persist drafts per Pi session, clear only after accepted send, and restore on
  failure;
- show Original/Suggestion for Improve with explicit Use/Ignore and a stale
  request guard.

### 4.4 Status is duplicated and overly technical — P1

An idle capture displays `ready` in the header and again in the activity row.
The footer then exposes repository, model, context, Git, thinking, cache,
tokens, cost, and IDE status in one 11px line.

Required direction:

- header: active workspace/session identity plus one connection indicator;
- activity row: appear only for work, retry, approval, question, compact, or
  failure states; hide while idle;
- composer edge: thin context-pressure meter;
- workspace-tools rail: detailed quota, cost, Git, and analysis state;
- statusbar: retain only repository, model, and context at ordinary widths,
  with a labelled overflow disclosure for the rest.

### 4.5 Empty state is decorative instead of useful — P1

`#transcript:empty::before` renders one italic CSS-generated sentence. It is not
a stable semantic element, provides no action, and leaves most of the screen
blank.

Replace it with real DOM that varies by state:

- **fresh session:** “What do you want to change?” plus focus-composer action;
- **known project:** recent prompt templates and resume-last-session;
- **disconnected/restarting:** persistent state and retry/open-log action;
- **no workspace in standalone mode:** choose/open workspace where policy allows.

Keep it restrained: one primary action, at most two secondary actions, and a
short `/` / command-palette hint.

### 4.6 Transcript and progress semantics are incomplete — P0/P1

The transcript is a `<main>` containing anonymous `.msg` divs. Tool headers use
`div role="button"`; the right-rail separator has a role but no keyboard focus,
value metadata, or key handling. Activity changes are visual only. Toasts have
a polite live region, but routine agent progress does not have a dedicated
status channel.

Required direction:

- expose the conversation as a labelled feed and each user/assistant turn as an
  `article` with a concise accessible label;
- use native `<button>` for tool disclosures;
- use a dedicated `role="status"` for coarse changes such as “assistant
  responding”, “waiting for approval”, and “response complete”;
- do **not** make token-by-token streaming a live region;
- set `aria-busy` while loading/prepending history;
- implement the WAI splitter contract: focusable separator, arrows, Home/End,
  Enter collapse/restore, `aria-controls`, and current/min/max values;
- label the composer independently of its placeholder;
- make command inputs true comboboxes with expanded state and active descendant;
- use `scroll-padding-block` so sticky header/footer cannot hide focused items.

### 4.7 Live analysis data can lag behind the transcript — P0

`lastMessages` is replaced only by snapshot `applyMessages()`. Live completed
turns render directly into the DOM, while the analysis modal reads the older
array. A session analysis opened after a new turn can therefore omit it.

Maintain one canonical live message model or refresh message data after
`agent_end` without rebuilding the transcript.

### 4.8 Permission policy and delivery are not yet a reliable boundary — P0

The current safeguard's “safe” Bash expressions match only a command prefix.
Against the shipped rules, all of these resolve as auto-allowed:

```text
git status && rm -rf ./src
echo $(cat ~/.ssh/id_rsa)
git remote remove origin
git branch -D main
git status > status.txt
node --version && npm publish
```

The security issue is deterministic, not an AI-risk-classification gap:
`safeguard.ts` needs conservative shell segmentation and complete-subcommand
matching. `echo` and unrestricted mutating Git subcommands cannot remain in the
default allow set. The same policy pass must cover canonical/symlinked paths and
all path-capable tools; grep/find/list currently bypass read's sensitive-path
rules. Headless ask-class behavior currently defaults to allow.

The approval transport also has correctness gaps:

- `extension_ui_request` is not in `livebuf.js`, so a reload after Pi starts
  waiting loses the only visible request;
- every SSE tab receives the dialog, while `/api/cmd` has no pending-ID/
  first-response arbitration or resolved broadcast;
- option handlers hide the modal before the fire-and-forget response succeeds;
- Escape/backdrop intentionally cannot deny the four-choice prompt;
- there is no timeout/abort lifecycle;
- `curToolName`/`curToolArgs` and human-readable option labels are implicit wire
  state rather than `toolCallId`-keyed protocol data.

Policy persistence is similarly unclear: “Allow always” writes to one global
file, often using a workspace-relative path; exact rules are appended behind
first-match patterns, so allowing `src/.env.local` can still hit the earlier
`.env* → ask` forever. Parse/save failures are silent and can replace a stricter
user policy with looser defaults.

The target is a pure versioned policy engine plus a server pending-request
broker and stable decision protocol. Permission risk shown in the browser stays
advisory; the extension validates the final decision and remains authoritative.
Use once/session/current-workspace scopes by default, with global grants only in
an advanced management flow. Pi's timeout/signal APIs should fail closed.

The WebUI also needs a dedicated `#permissions` page, not merely a larger modal:
structured effective rules, active grants/revoke, pending requests, redacted
audit, rule Explain, config diagnostics, and a validated advanced JSON view.
Fixed revision-checked endpoints own the config path and canonical workspace.

Comparable products support the direction without dictating the implementation:
VS Code exposes once/session/workspace/future scopes; Claude Code evaluates
compound subcommands independently, uses deny→ask→allow policy precedence, and
persists command grants per repository; Cline separates project/outside-project
capabilities. Do not adopt an LLM permission judge or one-click global bypass.

## 5. Target information architecture

### Header

Keep it compact:

- active workspace / session title;
- one connection/activity indicator;
- theme/settings and detail-mode entry points;
- narrow mode collapses secondary controls into one menu.

Do not repeat model/context/cost if they are already visible near the composer
or in the tools rail.

### Left navigation

Use a consistent action-list pattern:

- leading state icon;
- session/workspace name;
- one muted metadata line;
- trailing unread/running/change badge;
- trailing overflow action on hover, focus, and touch;
- active and selected are distinct states;
- unavailable actions include a reason rather than silently disappearing.

Recommended session actions:

- rename;
- pin;
- archive/done without deleting the JSONL;
- copy path;
- fork/branch where SDK support exists;
- delete only as an explicitly destructive action.

Refresh the current row on `agent_end` and session-name changes. Because
pi-webui has one active SDK runtime, do not imply that inactive sessions are still
running. “Unread” and “in progress” apply only where the browser actually knows
that state.

### Conversation

Each request/response boundary should read as a coherent turn rather than a
sequence of disconnected boxes:

- user request;
- assistant text/reasoning;
- compact tool trajectory;
- changed-files summary;
- usage strip;
- turn actions.

Useful turn actions, in order:

1. copy message;
2. copy final response;
3. copy complete turn as Markdown, including tool summaries;
4. previous/next prompt and previous/next code-block navigation;
5. branch from this request;
6. inspect changed files;
7. restore checkpoint only after safe checkpoint semantics exist.

Actions must be visible on `focus-within` and touch, not hover alone.

### Composer

Use two levels without creating a permanent toolbar wall:

- content row: attachments/context chips + textarea;
- action row: Send/Stop, attachment, and state-dependent delivery control;
- overflow: Improve, template save, Compact, and settings-like commands.

Explicit context should render as removable chips with source and approximate
size:

- file;
- folder/symbol where bounded;
- selected editor text from JetBrains;
- terminal selection where the IDE bridge can provide it;
- image.

The server remains authoritative for path resolution. Never accept an arbitrary
filesystem path from a browser chip.

### Right workspace-tools rail

W1 now provides the unified `#toolsbar` surface with one active panel:

- Git;
- session analysis;
- provider quotas;
- SDD;
- agent todos;
- Permissions status only: pending/config-error badge + launcher to the full
  page, not a rule-editor widget.

The 44–48px collapsed rail persists `{widget,open,width}` under `pi:rail` and
keeps each widget's command-palette route aligned with the visible tab. At
narrow widths the active panel is a focus-contained bottom sheet; detailed Git,
quota, cost, and todo data stays out of the always-visible statusbar.

### Permissions page

`#permissions` is an addressable center utility page in the existing shell,
opened from Settings, Alt+K, and the rail shield badge. It contains Overview,
Rules, Active Grants, Pending, Audit, Explain, and Advanced Source sections.
Structured rule editing is primary; raw JSON is expert-only, schema-validated,
revision-checked, and previewed as a normalized diff. The page never accepts a
browser-provided config path and never becomes a second policy evaluator.

Pending decisions still live on their originating tool cards so review context
is not lost. The page links to those cards and manages policy/grants; it does
not create an independent approval that can race the inline one. On narrow
screens the page becomes a one-column view with full-screen edit sheets.

## 6. High-value patterns from comparable agent UIs

### Session hub — adapt selectively from VS Code

VS Code's session list surfaces status, type, file-change statistics, unread
state, pinning, and non-destructive archive/done filtering.

Adapt:

- pinning, rename, archive filtering;
- unread/current indicators;
- changed-file count for the active completed request;
- title/header orientation;
- previous/next prompt and code-block shortcuts.

Do not adapt multi-host/multi-running semantics without a process-model change.

### Context picker — adapt from VS Code

VS Code combines implicit editor context, explicit `#` mentions, drag/drop, and
an Add Context picker. For pi-webui:

- retain image paste/drop;
- implement project-confined `@file` or `#file` completion;
- let JetBrains add the active file or selected text natively;
- show exactly what will be sent and allow removal;
- avoid silently including whole folders or the whole codebase.

### Request change summaries and checkpoints — stage the adoption

VS Code shows files and +/- statistics per completed request before offering a
checkpoint restore or fork. Cline distinguishes:

- restore files;
- restore task/conversation;
- restore both;
- compare before restore.

First adaptation:

1. collect edited paths during a request;
2. show a collapsible changed-files summary after the turn;
3. open the existing web or native JetBrains diff;
4. expose existing per-file discard/reset/revert operations with confirmation.

Only then evaluate checkpoints. A shadow Git repository after every tool call
is substantial state machinery and should not be introduced merely to copy a
competitor. If checkpoints ship, files and conversation must be independently
restorable and Git remains the durable history.

### Copy/export — adapt from VS Code

Provide distinct commands:

- Copy message;
- Copy final response;
- Copy turn;
- Copy all as Markdown.

“Copy final response” is especially valuable because tool trajectories can be
large while the reusable answer is usually the last assistant text block.

### Action lists — adapt from Primer

Primer's useful transferable pattern is not React; it is a row contract:
leading visual, primary label, optional description, trailing metadata/action,
and explicit active/selected/disabled semantics. Apply it consistently to
workspaces, sessions, command results, Git files, and tool rankings.

## 7. Accessibility acceptance criteria

The next UI tranche should meet these conditions before visual sign-off:

### Keyboard and focus

- Every operation is reachable without pointer input.
- Rail/sidebar splitters support the WAI keyboard contract.
- Opening a modal/drawer moves focus inside; closing restores the trigger.
- Sticky UI never fully obscures focus.
- Tool cards use native disclosure buttons.
- A visual toolbar uses `role="toolbar"` only if it also implements arrow-key /
  roving-tabindex behavior; otherwise ordinary buttons remain preferable.
- Command/slash lists expose selected option and active descendant correctly.

### Screen-reader status

- Composer, transcript, session navigation, and workspace-tools rail have
  explicit accessible names.
- Coarse progress is announced without moving focus.
- Streaming tokens are not repeatedly announced.
- Dynamic history loading sets `aria-busy`; turns have position/labels where
  incremental loading is used.
- Error and approval messages remain visible and are not toast-only.

### Visual and touch

- Normal text reaches 4.5:1; large text reaches 3:1.
- Pointer targets are at least 24×24 CSS px or satisfy the WCAG spacing
  exception.
- Hover actions are also available on focus and touch.
- Status is never color-only: icon/text accompanies red/amber/green.
- Reduced-motion behavior remains intact.

Validate with keyboard-only navigation and at least one NVDA + Edge smoke pass,
not only static ARIA inspection.

## 8. Long-conversation performance

Current `applyMessages()` clears the transcript, synchronously renders every
message, and scrolls once at the end. Tool-preview virtualization helps only
after Markdown parsing and initial DOM construction.

Recommended sequence:

1. render the newest 50-message batch, aligned to a user turn;
2. mount older batches in later animation/idle frames;
3. preserve scroll position when prepending;
4. avoid per-message layout reads/autoscroll during replay;
5. cache rendered immutable Markdown with a bounded LRU;
6. lazy-render closed reasoning;
7. add `content-visibility: auto` and
   `contain-intrinsic-size: auto <estimate>` to immutable historical turns;
8. materialize an older batch on search/navigation demand.

`content-visibility` is an optimization, not virtualization: it skips offscreen
style/layout/paint but does not avoid parsing or DOM creation. It also leaves
offscreen content in the accessibility tree. Hidden controls/landmarks inside
an offscreen turn must therefore have correct `aria-hidden` state.

Do not introduce a framework or a general virtual-list dependency. Measure a
500-message session before and after each stage and keep browser find, copying,
keyboard navigation, and screen-reader reading intact.

## 9. JetBrains-specific improvements

The plugin currently embeds one JCEF page and bridges native diff approval. The
next bridge should improve IDE integration rather than reproduce IDE chrome in
HTML.

### High value

- **Open file bridge:** route transcript/file actions to
  `FileEditorManager.openFile()`.
- **Editor context bridge:** add active file and selected text to the composer as
  removable context, with an explicit user gesture.
- **Native terminal action:** open the project terminal through the IDE where
  supported.
- **Native tool-window toolbar:** expose New, Stop, Open in Browser, and Settings
  through `SimpleToolWindowPanel` / the IntelliJ action system at narrow widths.
- **Preferred focus:** set the content's preferred focus component to JCEF and
  return focus predictably after native diff review.
- **Theme signal:** inject the current IDE light/dark state as the initial theme
  preference while retaining an explicit web override.
- **Permission bridge hardening:** key native decisions by request ID, enforce
  canonical project containment before reading a file, show matched policy/risk/
  scope, detect unsaved/conflicting documents, and fail closed across JCEF
  reload or tab disposal.

### Lifecycle and polish

- dispose `JBCefJSQuery` and remove its load handler with the content disposer;
- use `ToolWindowManager.invokeLater()` for tool-window-related EDT work;
- show a purposeful non-JCEF fallback with an Open in Browser button;
- test a narrow docked window, a floating window, editor zoom/font scaling, and
  IDE shortcut conflicts;
- keep `PI_WEBUI_NO_SWITCH`: project navigation remains IDE-owned.

Do not create multiple native tabs merely to imitate multi-agent sessions. One
conversation content plus native diff editor tabs matches the current process
model.

## 10. Prioritized delivery plan

### Tranche A — correctness and accessibility

1. Fix safeguard shell/path/precedence/headless policy and add attack fixtures.
2. Buffer/replay pending approvals; acknowledge responses; add timeout and
   multi-tab first-response convergence.
3. Add the structured permission protocol, inline tool-card approval, and
   dedicated revision-safe `#permissions` editor.
4. Fix responsive cascade; use available-width compaction.
5. Remove composer/statusbar horizontal overflow.
6. Correct paperlike contrast and add token tests.
7. Persist/restore drafts; make Improve reviewable and race-safe.
8. Add real empty/disconnected states.
9. Make tool disclosures and rail resizers keyboard-native.
10. Add feed/status/busy semantics without token-stream announcements.
11. Fix live analysis synchronization.

### Tranche B — simplify the workbench

1. Generalize the right rail.
2. Reduce duplicate ready/status presentation.
3. Reduce composer primary actions.
4. Add message/tool/code copy actions and turn navigation.
5. Complete existing Git reset/revert/per-file-discard UI.
6. Refresh and enrich the current session row.

### Tranche C — context and change review

1. Add safe file/context chips and prompt-template authoring.
2. Add per-request changed-file summaries.
3. Add open-file/terminal/editor-context JetBrains bridges.
4. Add Copy Final/Turn/All as Markdown.
5. Implement branch from request.

### Tranche D — long sessions and personalization

1. Incremental history rendering and immutable-turn rendering optimizations.
2. Duration-aware session analysis.
3. Pin/archive session metadata and shortcut customization.
4. Optional prose font and restrained conversation-shape settings.
5. Evaluate checkpoints only after change summaries and restore semantics are
   specified.

## 11. Deliberate exclusions

Do not use this research to justify:

- React, Vite, a component framework, or a virtual-list dependency;
- permanent expansion of the header/footer toolbar;
- hover-only controls;
- token-by-token live-region announcements;
- arbitrary browser-provided cwd/file/config APIs;
- frontend risk heuristics or an LLM judge as the permission authority;
- one-click global bypass/“YOLO” controls in the primary approval UI;
- false multi-session running indicators;
- automatic shadow-Git checkpoints without a recovery/security specification;
- a full theme editor before semantic tokens and contrast tests are reliable;
- copying VS Code/Primer aesthetics rather than their interaction contracts.

## 12. Primary references

- [VS Code — Use chat](https://code.visualstudio.com/docs/copilot/chat/copilot-chat)
- [VS Code — Manage agent sessions](https://code.visualstudio.com/docs/copilot/chat/chat-sessions)
- [VS Code — Review and revert agent changes](https://code.visualstudio.com/docs/agents/run/review-code-edits)
- [VS Code — Manage approvals and permissions](https://code.visualstudio.com/docs/agents/run/approvals)
- [VS Code — Add context to chat](https://code.visualstudio.com/docs/copilot/chat/copilot-chat-context)
- [Cline — Checkpoints](https://docs.cline.bot/features/checkpoints)
- [Cline — Auto Approve](https://docs.cline.bot/features/auto-approve)
- [Claude Code — Configure permissions](https://docs.anthropic.com/en/docs/claude-code/permissions)
- [Pi — Extensions](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi SDK documentation](https://github.com/earendil-works/pi-coding-agent)
- [WAI-ARIA APG — Feed](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)
- [WAI-ARIA APG — Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
- [WAI-ARIA APG — Window splitter](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/)
- [WCAG 2.2 — Contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2 — Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WCAG 2.2 — Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [WCAG 2.2 — Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- [GitHub Primer — ActionList](https://primer.style/product/components/action-list/)
- [web.dev — `content-visibility`](https://web.dev/articles/content-visibility)
- [IntelliJ Platform — Tool windows](https://plugins.jetbrains.com/docs/intellij/tool-windows.html)
