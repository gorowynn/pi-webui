# Product Roadmap

> **Role:** source of truth for what pi-webui should build next, in priority and
> dependency order. Last reviewed **2026-08-07** against the live source,
> [`improvements.md`](improvements.md), [`pi-livecraft.md`](pi-livecraft.md),
> [`design.md`](design.md), and the JetBrains plugin.
>
> [`plans.md`](plans.md) is the execution plan for the **Now** and **Next**
> horizons. Starting a tranche still requires a focused SDD run; this roadmap is
> not a substitute for implementation-level specification. Completed work moves
> to [`../CHANGELOG.md`](../CHANGELOG.md) instead of accumulating here.

## 1. Product direction

pi-webui remains a zero-build, low-dependency coding-agent workbench. The next
roadmap is not a framework migration or a collection of new footer buttons. It
has four outcomes:

1. **A reliable adaptive shell** that works in desktop, PWA, and narrow JCEF
   surfaces.
2. **A calmer workbench** with navigation left, conversation center, and
   inspection tools right.
3. **Safer, faster conversation workflows** for drafts, context, change review,
   sessions, and copying/branching.
4. **Bounded long-session behavior** without sacrificing browser search,
   accessibility, or the zero-build constraint.

Keep these constraints:

- Node 18+, browser SSE/fetch, Pi RPC subprocess;
- no React/Vite/bundler or runtime `npm install`;
- one active Pi child per workspace;
- server-authoritative cwd/path validation;
- editable standalone and native JetBrains diff review;
- current safeguard, subagent, todo-discipline, SDD, reconnect, and compaction
  behavior.

## 2. Horizon definitions

- **Now:** correctness and usability work that should precede new surface area.
- **Next:** accepted workflow improvements built after the Now exit gate.
- **Later:** valuable candidates that need usage evidence, a security contract,
  or lower-level prerequisites.
- **Not planned:** ideas that violate product constraints or duplicate a
  stronger existing mechanism.

No item is “in progress” until it has an active `.sdd` artifact and is linked
from the current work context.

## 3. Roadmap at a glance

| ID | Outcome | Horizon | Value | Effort | Primary dependency |
| --- | --- | --- | :---: | :---: | --- |
| U1 | Adaptive shell and chrome | Now | 5 | M | none |
| U2 | Accessibility and paperlike contrast | Now | 5 | M | U1 coordination |
| U3 | Resilient, simplified composer | Now | 5 | M | none |
| U4 | Live-state and large-session correctness | Now | 5 | M | none |
| U5 | Correct and resilient editable diff | Now | 5 | M | none |
| U6 | Trustworthy permission policy and approval broker | Now | 5 | L | none; UI reuses U4/U5 |
| W1 | Unified workspace-tools rail | Next | 5 | L | U1, U2 |
| C1 | Conversation actions and navigation | Next | 5 | M | U2 |
| G1 | Request-scoped change review and complete Git UI | Next | 5 | M–L | C1, U5 |
| S1 | Rich session navigation and branch workflow | Next | 4 | M–L | C1, U4 |
| X1 | Explicit context and prompt templates | Next | 5 | M | U3 |
| J1 | Native JetBrains context and action bridge | Next | 5 | M | C1, X1, U6 |
| P1 | Incremental long-history rendering | Next | 5 | L | U4, C1 semantics |
| O1 | Duration-aware analysis and observability | Later | 3 | M | W1, U4 |
| N1 | Opt-in completion/approval notifications | Later | 3 | S | U4, U6 state model |
| A1 | Shortcut and prose-font personalization | Later | 2 | M | U1, W1 |
| R1 | Authenticated LAN/remote mode | Later | 3 | L | U1, security spec |
| K1 | Request checkpoints and selective restore | Later | 4 | L | G1, S1, recovery spec |
| D1 | Capability-gated directory picker | Later | 3 | M | workspace security spec |
| Q1 | Compaction-safe pins and context pruning | Later | 4 | L | Pi/RPC feasibility |

Value uses 1–5; effort is relative and includes tests/documentation.

## 4. Now — correctness before expansion

### U1 — Adaptive shell and chrome

**Outcome:** no sidebar, composer, header, modal, or status control clips or
requires horizontal scrolling at supported widths.

Scope:

- fix the `max-width: 720px` cascade regression;
- compact by available content width, not viewport width alone;
- use a desktop sidebar width with a real lower bound;
- convert left/right panels to drawers or bottom sheets when content becomes
  too narrow;
- reduce duplicate idle status and move secondary metadata behind disclosure;
- replace the CSS-only empty state with a real accessible state surface;
- support `100dvh` and safe-area insets for installed/mobile use;
- verify 1440, 1024, 720, and 480px standalone plus narrow/floating JCEF.

**Non-goal:** remote/LAN access. Installability is already shipped; this item
makes the installed UI usable.

### U2 — Accessibility and paperlike contrast

> **Status:** delivered 2026-08-07 (SDD run `a11y-contrast_07082026`,
> archived). See CHANGELOG. Browser spot-checks of the token darkenings
> and focus rings pending.

**Outcome:** keyboard, screen-reader, touch, and contrast behavior has an
explicit tested contract.

Scope:

- adjust paperlike text/semantic tokens to at least 4.5:1 for their 10–13px
  uses and add a zero-dependency contrast test;
- use native buttons for tool disclosures;
- implement focusable, keyboard-operable splitters with WAI value metadata;
- label the composer, conversation, session navigation, and tools rail;
- expose conversation turns as semantic articles/feed entries;
- announce coarse progress through `role="status"` without announcing every
  streamed token;
- set busy state during history replacement/prepend;
- keep focused controls visible around sticky chrome;
- make touch targets at least 24×24px or satisfy the WCAG spacing exception;
- ensure hover-only actions also appear on focus and touch.

### U3 — Resilient, simplified composer

**Outcome:** typed work is never lost by a failed send, slow rewrite, reload, or
session switch, and primary actions remain usable at every width.

Scope:

- persist drafts per session with debounced writes and unload/session-switch
  flushes;
- clear only after an accepted command and restore after failure;
- make Improve an Original/Suggestion review with Use/Ignore, stale-request
  protection, model, and cost;
- keep Send/Stop and attachment primary;
- show steer/follow-up behavior only while a turn is running;
- show Compact prominently only at meaningful context pressure;
- move Sessions/New to navigation and lower-frequency commands to overflow;
- retain image-only sends and current model capability checks.

### U4 — Live-state and large-session correctness

**Outcome:** every visible dashboard and session state reflects the current
turn, and large valid Pi responses fail explicitly or render successfully.

Scope:

- give the main Pi JSONL decoder a deliberate 64 MiB session-record cap while
  keeping isolated-runner caps smaller;
- report oversized records immediately instead of silently dropping them;
- make session analysis consume current live messages;
- refresh current session metadata after `agent_end` and rename events;
- surface `auto_retry_end` and `extension_error` without toast spam;
- preserve reconnect replay, compaction markers, and multi-tab ordering;
- define one authoritative client state path before W1/O1 depend on it.

### U5 — Correct and resilient editable diff

> **Status:** delivered 2026-08-07 (SDD run `editable-diff_07082026`,
> archived; browser spot-checks passed). See CHANGELOG.

**Outcome:** caret, selection, visible text, line backgrounds, gutters, and the
content eventually applied remain aligned and conflict-safe while editing.

The current web diff puts a transparent textarea over independently rendered
highlighted HTML. The highlighted body starts at zero vertical padding while
the textarea starts at 6px—about one-third of its 17.4px line height—and the
aligned diff inserts deletion placeholders that do not exist in the textarea's
raw value. The reported low cursor and later whole-line drift are therefore
structural, not cosmetic.

Scope:

- centralize exact font, line-height, padding, tab, and gutter geometry and use
  it consistently across old, highlighted, and editable panes;
- replace transparent-overlay editing with explicit **Review** and **Edit**
  rendering: aligned syntax-highlighted diff for review, normal visible textarea
  text/caret/selection for editing;
- never map raw textarea lines onto diff-only deletion placeholders;
- preserve selection, undo, IME input, zoom, and forced-color behavior;
- debounce/idle live diff recomputation and pause it explicitly for large hunks
  instead of running full LCS + highlighting every animation frame;
- add dirty/reset state, labelled controls, Apply shortcut, and minimum target
  sizes;
- make `/api/file` return a content version/hash and require it on `/api/write`,
  returning an inline `409 Conflict` recovery path when disk content changed;
- test modifications, unequal additions/deletions, tabs, long lines, Unicode,
  CRLF/final-newline cases, gutter digit changes, both themes, browser zoom,
  selection, and modal/transcript variants.

The native JetBrains diff remains preferred in IDE mode and must retain its
existing editable-document wire contract.

### U6 — Trustworthy permission policy and approval broker

> **Status:** delivered 2026-08-10 (SDD run `permission-policy_08082026`,
> archived). See CHANGELOG. Includes the four permission modes (default /
> auto-approve / read-only / yolo) added at the user's request. Manual smoke
> matrix in the verify report; browser spot-checks of the in-card approval
> surface + `#permissions` page pending.

**Outcome:** no dangerous compound command is mistaken for safe, every blocking
approval survives reconnect and multi-tab use, and users can inspect and edit
the effective policy without opening a configuration file manually.

Verified defects make this a correctness/security item rather than optional
polish: current prefix regexes auto-allow examples such as
`git status && rm -rf ./src`, `echo $(cat ~/.ssh/id_rsa)`, and
`git remote remove origin`; blocking extension-UI requests are not replayed
after reload; and the browser closes a permission modal before its response is
acknowledged. Persistent grants are global, insertion-order-sensitive, and
poorly described.

Scope:

- extract a zero-dependency policy engine with explicit rule provenance and
  tests before changing behavior;
- classify compound shell commands conservatively, require every subcommand to
  be allowed, and ask on substitutions, redirects, separators, or ambiguity;
- remove unsafe default auto-allows (`echo`, mutating `git branch`/`git remote`)
  and make headless ask-class actions block unless a caller such as a constrained
  subagent opts in explicitly;
- canonicalize paths/symlink hops and apply sensitive-path policy to every
  path-capable tool, including grep/find/list operations;
- replace property-order resolution with documented hard-deny, mandatory-ask,
  remembered-grant, ordinary-ask, and allow precedence;
- migrate to versioned, atomically written global + canonical-workspace policy
  layers; project content may tighten policy but never grant authority;
- introduce a versioned WebUI permission marker keyed by `toolCallId` and stable
  decision enums instead of label heuristics and global `curToolArgs` state;
- add a server-owned pending-request broker: snapshot/reconnect replay, first
  response wins, resolved broadcasts, stale-ID rejection, timeout/abort, and
  cleanup on Pi exit/workspace switch;
- await response acknowledgement before closing approval UI; Escape/backdrop
  means Deny and failures retain a retryable decision;
- render pending approval in its tool card with deterministic risk reasons,
  matched rule, exact grant scope, and U5's Review/Edit diff for file changes;
- add a dedicated same-shell **Permissions page** at `#permissions`, reachable
  from Settings, command palette, and a rail badge/launcher. Its structured rule
  editor shows effective/default/user/workspace layers, pending approvals,
  active grants with revoke/clear, config diagnostics, and a redacted decision
  audit. An advanced raw view validates before saving; an Explain form shows
  which rule a sample call matches;
- expose only fixed `/api/permissions` endpoints with schema validation,
  revision-conflict checks, and atomic writes—never a browser-supplied config
  path or unrestricted filesystem API;
- harden the JetBrains approval bridge with canonical project containment,
  request-ID-keyed resolvers, unsaved-document/conflict handling, and the same
  policy/scope metadata.

**Non-goals:** an LLM permission judge, a one-click global bypass mode, or using
frontend risk heuristics as the security boundary. A future OS sandbox may
reduce prompts but complements rather than replaces policy.

## 5. Next — workbench and workflow

### W1 — Unified workspace-tools rail

**Outcome:** Git, Analysis, Quotas, SDD, and agent Todos share one persistent,
resizable inspection surface instead of competing modals/footer space.

Scope:

- generalize `#sddbar` into a 44–48px rail plus one active panel;
- persist active widget, width, and collapse state;
- add meaningful badges without color-only state;
- lazy-fetch expensive widget data when opened;
- migrate SDD first, then Git, Analysis, Quotas, and agent Todos;
- register each widget with the command palette;
- show U6 pending/config-error badges and a launcher to the dedicated
  `#permissions` page; do not squeeze the rule editor into the rail panel;
- use a focus-trapped drawer/bottom sheet at narrow widths;
- retain modal fallback until each migration passes its smoke tests.

**Non-goal:** a runtime plugin marketplace. Use an explicit fixed widget table.

### C1 — Conversation actions and navigation

**Outcome:** long conversations are reusable and keyboard-navigable without
adding permanent toolbar clutter.

Scope:

- Copy Message, Copy Final Response, Copy Turn, and Copy All as Markdown;
- copy code blocks and tool input/output;
- previous/next prompt and previous/next code-block commands;
- shared turn-action placement visible on hover, focus, and touch;
- consistent semantic turn boundaries and stable message IDs;
- safe “open referenced file” action, routed natively in JetBrains;
- reuse the command registry for discoverability and shortcut labels.

Browser find remains the first transcript-search mechanism. Add custom indexed
search only if navigation/copy usage proves it is needed.

### G1 — Request-scoped change review and complete Git UI

**Outcome:** users can understand and undo the effect of a request without
leaving the conversation.

Scope:

- show touched files and +/- statistics after a completed request;
- open an individual or multi-file diff from that summary;
- after U5 correctness, add side-by-side/unified and wrap/whitespace toggles,
  previous/next change, bounded intraline emphasis, and copy old/new/hunk;
- expose already-implemented reset, revert, and per-file discard operations;
- retain confirmation and workspace realpath gates;
- distinguish request-local touched files from the repository's complete dirty
  state;
- keep JetBrains native diff as the preferred IDE review surface.

This is the prerequisite safety layer for K1 checkpoints.

### S1 — Rich session navigation and branch workflow

**Outcome:** sessions are easy to identify, organize, resume, and branch without
pretending they run concurrently.

Scope:

- active session title in header/navigation;
- reliable rename plus pin and non-destructive archive/done filtering;
- action menu with clear disabled reasons;
- current/unread state only where the client has authoritative evidence;
- keyboard navigation through session rows;
- branch/fork from a request after RPC capability detection or a separately
  specified atomic server-side fork;
- preserve one active Pi child: branch opens by switching, not parallel tabs.

Delete remains a separate destructive proposal, not part of the first pass.

### X1 — Explicit context and prompt templates

**Outcome:** users can attach intended project context without unsafe paths or
large accidental prompts.

Scope:

- removable chips for image, file, selected text, and bounded symbol/folder
  context;
- project-confined `@file`/`#file` completion and drag/drop;
- preview source and approximate size before send;
- large-input warning and explicit confirmation/summarize-first path;
- preview/insert existing Pi prompt templates;
- save project/global templates by validated name with no-overwrite writes;
- server resolves allowed paths/scopes; browser never supplies an arbitrary
  destination.

### J1 — Native JetBrains context and action bridge

**Outcome:** the JCEF panel cooperates with the IDE instead of recreating IDE
features in squeezed HTML.

Scope:

- open referenced files with `FileEditorManager`;
- attach active file/selection through an explicit editor-context action;
- open the native terminal where the platform supports it;
- expose New, Stop, Open in Browser, and Settings through a native tool-window
  toolbar at narrow widths;
- set preferred focus and restore it after native diff review;
- inject initial IDE light/dark preference while keeping a web override;
- dispose JS queries/load handlers with the content lifecycle;
- use tool-window-aware EDT scheduling.

### P1 — Incremental long-history rendering

**Outcome:** a large resumed session becomes interactive quickly and remains
searchable/accessibly navigable.

Scope:

- render the newest 50-message, user-turn-aligned batch first;
- prepend older batches while preserving scroll position;
- suppress replay autoscroll/layout reads;
- bounded immutable-Markdown cache;
- lazy closed-reasoning render;
- `content-visibility`/intrinsic-size hints for immutable historical turns;
- materialize older batches on navigation demand;
- measure a 500-message fixture before and after.

Do not introduce a framework or generic virtual-list dependency.

## 6. Later — conditional candidates

### O1 — Duration-aware analysis and observability

Wire request/tool durations into the existing analysis math, add input/output /
failure/duration ranking, cumulative tool usage, and click-to-tool navigation.
Keep isolated-model interpretation opt-in and cost-labelled.

### N1 — Completion and approval notifications

Use the Notification API only after an explicit opt-in, only while hidden, and
only for long-run completion or required intervention. No sound by default.

### A1 — Shortcut and prose-font personalization

Add shortcut metadata, conflict detection, capture UI, and command-palette
chips. Add prose font choice independently of the dark/paperlike theme. Avoid a
full editable color theme until semantic tokens and contrast tests are stable.

### R1 — Authenticated LAN/remote mode

Only after a threat model: env-configured token/passphrase, rate limiting,
secure browser storage, retained CSRF/DNS-rebinding defenses, and no weakening
of path gates. Responsive/PWA work alone does not authorize remote exposure.

### K1 — Request checkpoints and selective restore

Specify Compare, Restore Files, Restore Conversation, and Restore Both as
separate operations. Git remains durable history. Do not adopt per-tool shadow
Git until recovery, storage, external-edit conflict, and untracked-file behavior
are explicitly tested.

### D1 — Capability-gated directory picker

Allow opening an unseen workspace only after explicit user intent, realpath
validation, and a one-time capability that extends the allowlist. Disabled under
`PI_WEBUI_NO_SWITCH`.

### Q1 — Compaction-safe pins and context pruning

Investigate pinned notes, compaction preview/preserve, and replacing oversized
historical tool output with an explicit summary. Requires proof that Pi's
session/RPC model can preserve displayed and model-visible history without
silently diverging.

## 7. Not planned

- React, Vite, Radix, a bundler, or runtime package installation;
- manager/supervisor/process-pool architecture;
- multiple simultaneously running chats presented as supported;
- unrestricted browser cwd/path APIs;
- a second browser-owned todo system mixed with agent discipline;
- hover-only controls;
- permanent dense header/footer expansion;
- automatic shadow-Git checkpoints without a recovery specification;
- wholesale visual imitation of VS Code, Primer, or pi-livecraft;
- always-on AI session interpretation;
- math/diagram runtimes until real usage demonstrates demand.

## 8. Delivered items removed from the backlog

The previous roadmap retained several completed plans. Their history now lives
only in `CHANGELOG.md` and Git:

- PWA manifest/service worker/installability;
- syntax highlighting and safe Markdown pipeline;
- dark/paperlike switching;
- session usage analysis and per-turn usage strips;
- Git snapshot/diff/commit/push/discard backend and modal;
- image paste/drop/compression;
- isolated Improve backend;
- provider quota bars;
- subagent tier routing;
- reconnect replay and compaction-aware history;
- semantic workspace/session row buttons and command palette.

Keeping shipped work out of this file makes the **Now** horizon the actual next
work rather than a historical status report.
