<!-- markdownlint-disable MD013 MD060 -->

# AGENT_NOTES — pi-webui

> **Read this first at the start of every session.** This file is the persistent
> memory for the pi agent working on this repo. It captures non-obvious project
> knowledge, conventions, gotchas, and a running changelog so work continues
> cleanly across sessions. Update it whenever you learn something worth keeping.
>
> Keep entries **factual and dense**. Prefer "why" + file:line over prose.
> When you finish a chunk of work, add a dated entry under [Changelog](#changelog).

---

## Single source of truth

Project knowledge lives in two places, and **only** these two:

- **`AGENT_NOTES.md`** (this file) — agent memory, conventions, gotchas,
  changelog. Read first.
- **`docs/`** — durable specs: [`docs/design.md`](docs/design.md) (UI/UX) and
  [`docs/README.md`](docs/README.md) (index + the full SSOT charter).

Code comments, commit messages, and chat are subordinate. When you learn
something durable, put it in the right place (gotcha/convention → here; spec
change → `docs/`). Full policy: [`docs/README.md`](docs/README.md).

---

## What this project is

**pi-webui** — a minimal, **zero-dependency** web UI for
[pi](https://github.com/earendil-works/pi-coding-agent). No build step, no
React/Express/`ws`. Just Node built-ins (`http` + `child_process`), native
browser SSE + `fetch`, and pi's **RPC mode** (`pi --mode rpc`) over stdin/stdout
JSON. Published as an installable pi package (`npm:pi-webui`).

```text
browser ──SSE──▶ Node (server.js) ──stdin──▶ pi --mode rpc
        ◀─POST─                  ◀─stdout─
```

- Repo: <https://github.com/gorowynn/pi-webui.git>
- Default branch work happens on: `dev`
- Version: see `package.json` (currently `0.2.0`)
- Node 18+. Requires `pi` on PATH.

## How to run / dev

```bash
node server.js                 # standalone dev — http://127.0.0.1:4317
# or, inside pi: /webui  (optional port: /webui 8080),  /webui-stop to stop
```

Env vars: `PORT` (4317), `PI_BIN` (pi), `PI_ARGS` (extra pi args), `PI_CWD`
(working dir for the spawned pi — drives session location + tool roots).

**Zero-build is a hard constraint.** No bundler, no transpile, no `npm install`
at runtime. Editing `app.js`/`style.css`/`index.html` and refreshing the browser
is the dev loop. Don't introduce a build step without strong reason.

## File map

| File | Role |
|------|------|
| `server.js` | The bridge. CommonJS, ~no deps. Serves assets, frames JSONL (splits on `\n` only), spawns/respawns `pi --mode rpc`, CSRF + DNS-rebinding gate, `safePath`, 1MB body cap. |
| `index.html` | Markup only (~81 lines). Inline refs to `style.css` + `md.js` + `app.js` (load order matters: md.js before app.js). |
| `style.css` | All styling (~1282 lines). Ayu-Dark palette — see [docs/design.md](docs/design.md). |
| `md.js` | **Markdown → HTML parser + `esc()` HTML escaper** (~670 lines). Zero-dep, pure `string→string`, browser-loaded via `<script>` BEFORE app.js, also `require`-able in Node. Exports two globals: `md(markdown)` and `esc(text)`. The single source of truth for both — app.js dropped its duplicate copies. |
| `app.js` | The entire frontend (~2140 lines, vanilla JS). SSE handling, rendering, modals, diffs, commands palette. Uses `md()` + `esc()` globals from md.js. |
| `docs/` | Durable specs: [`design.md`](docs/design.md) (UI/UX, visual source of truth) and [`README.md`](docs/README.md) (index + SSOT charter). |
| `extensions/pi_minimal_webui/` | The pi extension shipped with the package. See below. |
| `package.json` | `keywords:["pi-package"]` makes it `pi install`-able. `files:` whitelist = `server.js`, `index.html`, `extensions`. |

### The extension (`extensions/pi_minimal_webui/`)

- `index.ts` — **Ask User Question RPC bridge.** Shadows the stock
  `ask_user_question` tool (tool name is a wire contract with the LLM — **never
  rename it**). The stock tool's `ctx.ui.custom()` is a no-op in RPC mode; this
  routes the answer through `ctx.ui.input` (a blocking latch) which RPC *does*
  bridge. Two-channel smuggle: tool→browser via `tool_execution_start` (full
  args verbatim), browser→tool via `extension_ui_response{value}`.
- `safeguard.ts` — **Per-tool allow/ask/deny gate** for *every* tool call.
  Config at `~/.pi/agent/safeguard.json` (re-read every call). First match wins.
- `webui.ts` — The `/webui` + `/webui-stop` launcher commands. Spawns
  `server.js` detached; kills the whole tree (POSIX process group / Windows
  `taskkill /T`). `session_shutdown` tears it down.
- `todo.ts` — **Todo-list tool** (`todo`). Incremental, action-based: the
  agent plans the list ONCE (`plan`) with stable per-task ids, then flips
  statuses cheaply by id (`update`) — no whole-list resend on every status
  change. Also `add` / `remove` / `clear`. Statuses are open | started |
  finished. The browser owns the live list (applies each action from
  `tool_execution_start` args, same smuggle channel as ask_user_question);
  execute() just acknowledges. Reload-safe via a `pi:todos` localStorage hint
  (mirrors the `pi:model` idiom); a new session clears it through
  `setTodos([])`. Tool name matches the webui's UI hooks — don't rename.

> **Naming:** the folder is still called `pi_minimal_webui` (open TODO P3 to
> rename to something like `pi-webui-ask-bridge`). It does NOT contain a second
> webui — only the ask-bridge tool.

## Conventions & gotchas (read these — they cost real time)

1. **`follow_up` is snake_case on the wire.** The RPC command type is
   `"follow_up"`, not `"followUp"`. `streamingBehavior` is the *separate*
   camelCase field. app.js maps `followUp`→`follow_up` in `send()`.
   (`dist/modes/rpc/rpc-types.d.ts` is the source of truth.)
2. **Never use `readline` for framing.** It splits on Unicode line separators
   that are valid inside JSON strings. The bridge splits on `\n` only, per the
   RPC spec.
3. **`ASK_MARKER` has one source of truth: `server.js`.** It defines the
   literal, exports it via `process.env.PI_WEBUI_ASK_MARKER` (read by the
   extension) and injects `window.__PI_ASK_MARKER` (read by app.js). Both sides
   keep a fallback for standalone use. If you change it, change all three + run
   the round-trip self-check.
4. **`safePath` must use `fs.realpathSync`**, not `path.resolve` (resolve does
  *not* follow symlinks). Resolve both the base and the target (resolving the
  existing parent for not-yet-existing write targets) or a symlink inside
  `PI_CWD` aimed at `~/.ssh` slips through.
5. **`api()` attaches a no-op `.catch`** so fire-and-forget callers
   (refreshStats, init, UI buttons) never throw unhandled rejections, while
   awaited callers (send) still receive rejections. Keep that pattern for new
   fire-and-forget fetches.
6. **Diff LCS has a guard at 4M cells** — skip the O(n·m) path above that to
   avoid locking the UI. Manual Apply bails on non-unique hunks.
7. **`toolcall_end` must carry `toolCall.arguments`** or the permission-modal
   diff preview breaks (`pendingEditCalls` won't populate).
8. **Mutable top-level closure state in app.js** (~11 pieces: `cur`, `pinned`,
   `askId`, `pendingAsk`, `pendingEditCalls`, `compacting`, `todos`, `commands`,
   `currentModelId`, `lastThinkPaint`, `renderRaf`). Fine at current size; flag
   if it grows.
9. **One shared pi session for all browser tabs.** Multi-session is a later
   concern. If the pi subprocess crashes, the bridge restarts it after 1s
   (crash-loop guard = exponential backoff).
10. **Security baseline already in place:** CSRF + DNS-rebinding gate on POSTs,
    SSE backpressure (drops stalled clients), `md()` link-scheme allowlist
    (blocks `javascript:`/`data:`), 1MB body cap. Don't regress these.

11. **`md.js` must load before `app.js`.** Both `index.html` (`<script src="md.js">` then `app.js`) and `server.js` (`STATIC` whitelist) must list `md.js`. app.js calls `md()`/`esc()` at runtime with no local definitions — they're globals set by md.js's IIFE. md.js is `require`-able in Node (exports `{md, esc}`); exercise it with `node -e "const{md}=require('./md.js');console.log(md('**x**'))"` after touching the parser.
12. **`esc()` is shared, not duplicated.** It lives ONLY in `md.js` (static entity map, null-safe). app.js has ~22 call sites that use the global. Don't re-add a local `esc` to app.js — it would silently shadow and drift (the old copy returned `"null"` for null input; the shared one returns `""`).

## Manual smoke tests (quick sanity)

- **Editable transcript diff** — ask for a small edit; edit the right pane →
  Apply → file updates, button reads `Applied ✓`.
- **Permission-modal preview** — trigger an edit/write needing approval; modal
  shows a read-only old|new hunk diff. No diff = `pendingEditCalls` not
  populated (see gotcha #7).
- **Health** — `GET /api/health`; SSE at `GET /api/events`; commands via
  `POST /api/cmd`.

## Open work

Open items (P3 hygiene):

- [ ] Rename `pi_minimal_webui` folder → e.g. `pi-webui-ask-bridge` (browser
      side needs no change).
- [ ] Watch the mutable top-level closure state in app.js as it grows.

When you close an item, tick it here **and** add a changelog entry.

---

## Changelog

> Newest first. Format: `### YYYY-MM-DD — <area>: <one-line summary>` then
> bullet detail (what + why + file). One entry per meaningful chunk of work.

### 2026-06-23 — feat(webui): z.ai usage tracker — modal + always-on top bar (60s poll)

z.ai quota/usage viewer. Two surfaces over one proxied endpoint:

- **Server proxy** (`server.js`): new `GET /api/zai-usage` + `zaiUsage(key)`
  helper (`require("https")`, 8s timeout). Proxies
  `api.z.ai/api/monitor/usage/quota/limit` so the key never reaches the browser
  and CORS is dodged (provider APIs set no permissive CORS). Key source:
  `ZAI_API_KEY` env var first, else the `X-ZAI-Key` request header (UI-pasted,
  stays out of access logs — never a query param). Read-only GET, gated by the
  existing localhost + CSRF check like every other route.
- **Body-level error fix** (`server.js`): z.ai returns **HTTP 200 even for
  auth/rate failures**, burying the real status in the JSON body
  (`{code:401,success:false,msg:"token expired or incorrect"}`). The `ok`
  flag now honors both the HTTP status AND a body-level error
  (`data.code>=400 || data.success===false`), surfacing `data.msg` as
  `error` — so a bad key reads as a clear error, not the confusing
  "no quota fields found" (which is what a bare HTTP-2xx check produces).
  Verified live: bogus key → `{ok:false,error:"token expired or incorrect"}`.
- **Usage button + modal** (`index.html` header `#usage-btn`; `app.js`
  `showUsage`/`renderUsage`/`zaiBars`/`usageKeyForm`; `style.css` `.um-*`):
  clicking **Usage** opens a modal. First open with no key shows a password
  field (stored in `localStorage` `pi:zai-key`). With a key it renders a
  progress bar per `{used,total}`-shaped object found recursively — z.ai's
  exact `/quota/limit` shape isn't documented, so `zaiBars` scans generically
  (denominator names: total/totalQuota/total_quota/limit/max/quota/…; numerator:
  used/usedQuota/consumed/spent/usage/…) and labels from
  name/model/modelName/plan. Bars color by fill: <70% `--ok`, 70–90% `--warn`,
  ≥90% `--err`. A collapsible **raw response** `<details>` is always shown as a
  fallback (no quota fields → still inspectable). Refresh button re-fetches.
- **Always-on top bar** (`index.html` `#usagebar`; `app.js`
  `refreshUsageBar`/`usageBarCompact` + `usageTimer`; `style.css` `#usagebar`/
  `.ub-*`): a thin bar below the header rendering up to 6 compact quota bars,
  **polled every 60s**. Same pause-while-tab-hidden cadence as the 3s/6s
  stats/health timers (added `usageTimer` to the `visibilitychange`
  handler + an immediate `refreshUsageBar()` in `es.onopen`). Stays hidden until
  a key is set (no clutter); clicking it opens the detail modal; the Usage
  button remains as the entry point to set/change the key when the bar is
  hidden. Saving a key in the modal also refreshes the bar immediately.

Self-checked: `node --check` on app.js/server.js; `md.js` esc round-trip
(null→`""`); `zaiBars` against 5 plausible shapes (snake/camel/per-model/
  nested/no-fields) + cap-at-6 + XSS-in-label → escaped; live `/api/zai-usage`
no-key + bogus-key probes.

### 2026-06-23 — fix(webui): missing/cutoff assistant text, mid-stream scroll drift, ugly scrollbars, todo auto-clear, startup logging

Five reported bugs:

- **Missing words / cutoff assistant text (reload fixed it)** (`app.js` `message_update`):
  root cause was MULTI-BLOCK messages. Providers (verified in `pi-ai`'s
  google/anthropic sources) emit a separate `text_start`/`text_end` (and
  `thinking_start`/`thinking_end`) per content block, each `text_end` carrying
  the block's full `content`. But the streaming path used ONE `cur.textPar`
  for the whole message — so a 2nd text block's `commitText` overwrote the
  1st block's committed node in place (its words vanished). Reload "fixed" it
  because `renderMessage` already reset `cur.textPar` per block. Fix: reset
  `cur.textPar` at `text_start` (and the think-node set at `thinking_start`)
  when a prior block was committed, so each block gets its own DOM node —
  mirroring `renderMessage`. Order is preserved (append order = content order).
- **Message log jumped back to the middle of the scrollbar** (`app.js` scroll
  listener): `pinned` was set to `nearBottom()` on EVERY scroll event. A
  programmatic `scrollDown()` fires a scroll event that can land AFTER a big
  streamed chunk grew `scrollHeight`; `nearBottom()` then read false and
  wrongly un-pinned, so the log stopped following and drifted to the middle.
  Fix: un-pin ONLY on a genuine UPWARD scroll (`top + 4 < lastScrollTop`);
  `scrollDown()` and content growth never move the viewport up, so they can't
  un-pin. Re-pin whenever back near the bottom.
- **Ugly plain-white scrollbars** (`style.css`): the UA default scrollbar
  clashed with Ayu-Dark. Added global themed scrollbars — webkit
  pseudo-elements (`var(--muted)` thumb, `var(--bg)`-inset, hover boost) +
  Firefox `scrollbar-width: thin` / `scrollbar-color`. The hidden-on-purpose
  bar on `.sx-hlbody` keeps its own `none`/`display:none` rules (specificity).
- **Todo panel didn't clear after all tasks finished** (`app.js` `renderTodos`):
  it only hid when `todos.length === 0`. Now also hides when every task is
  `finished` (`allDone`) — a fully-done list is clutter. State is kept (a
  later `plan`/`add` re-opens the panel); `persistTodos` still saved it.
- **Occasional "webui exited unexpectedly" on start + add logging**
  (`extensions/pi_minimal_webui/webui.ts`, `server.js`): server.js was spawned
  with `stdio:"ignore"`, so an early death left only a bare exit code.
  server.js stdout+stderr are now redirected (inherited fd, not a pipe, so
  `detached`+`unref` still hold) to `~/.pi/webui.log`; the exit notify tails
  the last 12 lines so the user sees WHY (port in use, pi spawn error, …).
  Added a `server.on("error")` listen-failure handler (clear `EADDRINUSE`/
  `EACCES` log line + `exit(1)`) instead of an unhandled-error stack.

### 2026-06-23 — feat(webui): extract md.js (hardened parser + shared esc), drop inline tool display

- **New `md.js`** (~670 lines): zero-dependency Markdown→HTML parser extracted from
  app.js's inline cluster. Pure `string→string`, browser-loaded via `<script>`
  BEFORE app.js, also `require`-able in Node — the whole point of the extraction
  was testability (app.js can't be `require`d, its top level touches `document`).
  Rewritten from sequential-regex-replace to a **recursive-descent inline
  scanner** (proper code spans incl. multi-backtick, backslash escapes, nested
  emphasis, depth-bounded recursion), **streaming-safe** fences/code-spans/links
  (unclosed → graceful partial render), GFM tables w/ alignment, nested/task
  lists, setext headings, link scheme allowlist + esc'd attributes (XSS-safe).
  **Advance guarantee**: every loop branch advances the cursor — no input can
  stall or throw. (No committed test file — exercise via `node -e` after edits.)
- **`esc()` consolidated:** md.js is now the SINGLE source of truth for HTML
  escaping (static entity map, null-safe — the old app.js copy returned literal
  `"null"` for null and allocated an object per matched char). Exports `esc` as
  a global alongside `md`; app.js dropped its ~215-line parser cluster AND its
  `esc` definition (~22 call sites now use the global).
- **Wiring:** `index.html` loads `md.js` before `app.js`; `server.js` `STATIC`
  whitelist adds `/md.js`. The ask-marker injection (targets `<script
  src="app.js">`) still injects between md.js and app.js — correct order.
- **Inline tool display removed:** dropped `addToolCall()` (stamped `▸ name
  <args>` inside the assistant bubble) + its 3 call sites (live `toolcall_start`,
  bubble-creation guard, replay). Tool calls now render ONLY in their own box
  below (`toolBlock` via `tool_execution_start`, `toolResult` in replay) — the
  inline stamp was redundant. Removed `toolcall_start` from the bubble-creation
  guard so a tool-only turn leaves no empty "assistant" bubble.
- Two bugs the test caught + fixed: `***both***` (bold-italic) now peels spare
  delimiters → `<strong><em>`; setext headings (`Title\n=====`) now recognized
  (paragraph gather stops at the underline).

### 2026-06-23 — feat(webui): two-line tool boxes + deferred assistant-text render

- **Tool display box** (`app.js` `toolBlock` + `bashExecution` replay, `style.css`):
  the `<summary class="head">` is now two lines — line 1 = caret + tool name,
  line 2 = the call args (the JSON). Wraps caret+name in a `.trow`; summary is now
  `flex-direction: column`; `.tool .head code` is a muted, indented (`padding-left:
  16px`, aligned under the name) `pre-wrap` second line. Empty-args tool boxes (e.g.
  `toolResult` replay) omit the code line. The inline `addToolCall` one-liner in
  the assistant bubble is unchanged (it's a marker, not the box).
- **Deferred assistant text** (`app.js`): assistant message text no longer paints
  incrementally on every `text_delta` — it accumulates in `cur.textBuf` and
  commits once via the new `commitText()` at `text_end` (with a safety net at
  `message_end`). The thinking block above it STILL streams live (unchanged:
  `thinking_delta` → `scheduleRender` → `renderThink`). The rAF `renderText()` is
  a safe no-op during accumulation because `cur.textPar` isn't created until the
  commit. Activity bar still shows "writing…" for feedback. Historical replay
  (`renderMessage`) still renders full text immediately (it's already complete).

### 2026-06-23 — feat(todo): incremental action-based todo tool + reload-safe state

- `extensions/pi_minimal_webui/todo.ts` rewritten from full-state-replace to
  INCREMENTAL: one `action` per call — `plan` (set the whole list once, with
  stable per-task `id`s), `update` (flip one-or-more statuses by `id`, the
  frequent cheap call that does NOT resend the list), `add`, `remove`, `clear`.
  Statuses renamed to open | started | finished (was pending/in_progress/
  completed). `execute()` only acknowledges; the browser applies each action.
- `app.js`: replaced `setTodos(args.todos)` with `applyTodoOp(args)` (plan/add/
  update/remove/clear against a local `todos` array); `renderTodos` maps the new
  statuses to the existing pend/live/done styles (○/●/✓) and shows the task id;
  `describeTool` summarizes the action; `tool_execution_start` routes `todo` to
  `applyTodoOp`.
- **Reload safety:** added a `pi:todos` localStorage hint (mirrors the existing
  `pi:model` idiom) — `persistTodos()` writes on every state change, `es.onopen`
  restores it on load so a page reload no longer empties the panel until the
  next `todo` call. The new-session reset (`setTodos([])`) flows through
  `persistTodos()`, so a fresh session clears stale entries. (Note: this reload
  gap predated this change — the old full-replace design also rendered only from
  tool_execution_start — but it's fixed now.)
- `details`/status/description/snippet/guidelines updated to the new model.

### 2026-06-23 — feat(todo): declarative todo-list tool + panel above activity bar

- New `extensions/pi_minimal_webui/todo.ts` registers a `todo` tool: the agent
  sends the FULL list each call (subject + pending/in_progress/completed). Ships
  promptSnippet/guidelines so the agent creates it for 3+ step tasks and updates
  on every status change. Renders instantly from `tool_execution_start` args.
- Replaced the fragile rpiv-todo result-text parsing (`parseTodo`) with
  declarative `setTodos`; fixed the in_progress row-class bug. Moved
  `#todopanel` from `<footer>` to directly above `#activity` (collapsible,
  default open); styled as edge-to-edge chrome with content aligned to the
  activity bar. Cleared on new session.

### 2026-06-23 — docs: drop stale docs/todo.md; track open work in AGENT_NOTES.md

- `docs/todo.md` was stale (line-count claims and the "~11 pieces" mutable-state
  count had drifted; all P1/P2 items were long done) and redundant — its two open
  P3 items were already listed in [Open work](#open-work). Removed it; `docs/`
  now holds durable specs only (`design.md`, `README.md`). Open work is tracked
  solely here. Also refreshed stale line-counts in the file map.

### 2026-06-23 — docs: establish AGENT_NOTES.md + docs/ as single source of truth

- Defined `AGENT_NOTES.md` (agent memory/changelog) + `docs/` (durable specs) as
  the project's single source of truth; added an SSOT section here and the
  canonical charter + index in `docs/README.md`.
- Recovered the deleted `design.md` → `docs/design.md` and `TODO.md` →
  `docs/todo.md`; fixed all cross-references. Code comments/chat are now
  subordinate to these two locations.

### 2026-06-22 — webui: streaming markdown, real diff line numbers, drop command summary

- Streaming markdown rendering; diff line numbers now reflect real file lines;
  removed the command summary block. (commit `c928440`)

### 2026-06-22 — webui: Ayu-Dark rework

- Flat corners, accent stripes, darker palette per [docs/design.md](docs/design.md).
  (commit `2e11f66`)

### 2026-06-22 — refactor: split into pi_minimal_webui subdir extension

- Reorganized the extension into its own subdir. (commit `fcea666`)

### 2026-06-22 — feat(safeguard): per-tool allow/ask/deny gate

- New `safeguard.ts` gating every tool call with session/always allow rules.
  (commit `7c07f45`)

### 2026-06-22 — hardening pass: CSRF, SSE backpressure, crash-loop guard, diff guards

- CSRF + DNS-rebinding gate, SSE backpressure (drop stalled clients), crash-loop
  guard w/ exponential backoff, diff uniqueness + size guards. (commit `046bb1a`)

### 2026-06-22 — docs + feat: editable side-by-side diffs

- Editable diffs for edit/write tool calls; manual test section added.
  (commits `7c3c86f`, `b230044`)

### 2026-06-22 — fix: notify payloads render as assistant messages

- Substantial `notify` payloads now render as assistant messages, not toasts.
  (commit `b0b76e4`)

### 2026-06-22 — feat: manual context compaction from the webui

- (commit `ad2f8ee`)

### Earlier milestones (from git history)

- `23430d9` style: formatter on permission-prompt analyzer
- `91b4737` fix: analyze destructive commands buried in bash blocks/scripts
- `e48c101` feat: readable permission prompts w/ heuristic summary + risk warnings
- `3062911` feat: repack as installable pi package + `/webui` launcher
- `4a6669d` feat: always-on activity bar + smarter thinking block
- `d419883` fix: stabilize ask_user_question, throttle streaming renders, trust extensions
- `499b42c` feat: rich content rendering + working ask_user_question in RPC mode
- `4e25c26` feat: status dashboard, ask_user_question modal, todo panel, full-width tool UX
- `7e5b206` feat: pi-webui global launcher (npm bin shim, no runtime deps)
- `55aa269` feat: initial commit — zero-dependency pi web UI

### 2026-06-23 — chore: created AGENT_NOTES.md

- Added this file as the agent's persistent project memory + changelog. Seed
  content captured from README (absorbed here), design.md + TODO.md (since
  relocated to `docs/`), and git log. No code changes.
