# CHANGELOG — pi-webui

> Running history, newest first. Moved out of [`AGENTS.md`](AGENTS.md) so the
> orientation doc stays lean. One entry per meaningful chunk of work:
> `### YYYY-MM-DD — <area>: <one-line summary>` then bullet detail (what + why + file).

## Changelog

> Newest first. Format: `### YYYY-MM-DD — <area>: <one-line summary>` then
> bullet detail (what + why + file). One entry per meaningful chunk of work.

### 2026-06-24 — feat(webui): hard tool_call gate forces intermediate todo updates

- **Symptom:** the todo panel showed `plan` (task 1 started) and then `all
  finished` — nothing in between. The intermediate `update` calls never happened.
- **Root cause** (`extensions/pi_minimal_webui/discipline.ts`): the existing
  enforcement was a *soft* `before_agent_start` system-prompt nudge. That fires
  **once per turn**, but the drift happens **mid-turn** — the agent plans, marks
  task 1 `started`, then runs a burst of work for tasks 2..N and only marks
  everything `finished` at the end. The per-turn nudge can't re-fire during that
  burst, so it never caught the drift. (Browser-side `applyTodoOp("update")` in
  `app.js` was correct — the agent simply wasn't emitting updates.)
- **Fix:** added a **hard `tool_call` gate** in `discipline.ts` (alongside the
  soft nudge, which still handles no-list / all-finished-clear cases the gate
  can't see). Rule: block any *work* tool (everything except `todo` +
  `ask_user_question`) when the list is active with unfinished work but **zero**
  tasks `started`. This enforces the "one started at a time" contract the
  `todo` tool already documents, forcing the rhythm `plan → update(1:started) →
  work → update(1:finished) → update(2:started) → work → … → update(last:finished)
  → clear` — so every transition is now visible in the panel. Reads the live
  mirror via `getTodos()`. Composes with `safeguard.ts` (both hook `tool_call`,
  both must allow; this gate only ever blocks on the stale-list invariant,
  never on the tool's own merits).
- **Ceiling** (documented in-file): a correctly-batched
  `[update(1:started), read(...)]` right after `plan` preflights the `read`
  before the sibling `update` executes (parallel tool mode), so it false-
  positives once — self-correcting on retry. Upgrade path if it bites: inspect
  `ctx.sessionManager` for in-flight sibling `todo` updates.
- **Verified:** 12-case exhaustive simulation of the gate's decision logic
  (forces started-before-work; never blocks `todo`/`ask_user_question`, an empty
  list, or an all-finished list) — 12/12 pass. `tsc`/LSP clean.

### 2026-06-24 — fix(webui): recover assistant text blocks whose text_end was dropped

- **Symptom:** assistant markdown rendered broken/garbled *sometimes* during a
  live stream, but a page reload always fixed it.
- **Root cause** (`app.js` `handle()` → `message_update` → `text_start`): the
  deferred render parks each text block's content in `cur.textBuf` and only
  commits on `text_end` (with a `message_end` safety net). `text_start` did
  `cur.textBuf = ""` *unconditionally*, so when a text block never received a
  `text_end` (some providers drop it between consecutive `text → … → text`
  blocks), its still-uncommitted text was silently wiped. `message_end`'s
  safety net only rescues the *last* dangling block; any block wiped by an
  intervening `text_start` was gone for the turn.
- **Why reload fixed it:** `renderMessage` iterates stored `msg.content` and
  renders **every** text block unconditionally — so the missing block shows up.
  Live render was conditional on `text_end`; reload wasn't. That asymmetry *is*
  the bug.
- **Fix:** flush any pending uncommitted buffer *before* the reset at
  `text_start` (`if (cur.textBuf) commitText();`), mirroring `renderMessage`'s
  per-block guarantee. No-op for an already-committed prior block (overwrites
  the same node — no extra DOM node); skipped for the first block (empty buf).
- **Verified** with a DOM-free state-machine simulation of the event sequence:
  OLD lost block A when its `text_end` was dropped (`"B"` vs truth `"A | B"`);
  NEW keeps it. Zero regression on single-block and normal two-block paths.
  (Simulation kept inline in the session, not committed — `app.js` needs a DOM.)

### 2026-06-23 — feat(webui): process-discipline nudges (backfilled entry)

> Backfilled: shipped in commit `ba3c6c5` but never logged at the time (the
> old AGENTS.md "In progress" note tracked it as uncommitted/undocumented).

- New `extensions/pi_minimal_webui/discipline.ts` injects a per-turn
  `before_agent_start` nudge appended to `event.systemPrompt`: todos active →
  "keep the list current" (names the started task); all finished → "`clear` it";
  no todos + fresh prompt → "consider `ask_user_question` if ambiguous, or plan
  a todo list if 3+ steps". Reads the live todo mirror from `todo.ts`
  `getTodos()` (single owner — keeps no mirror of its own). Composes with
  `ponytail.ts` (both append to `event.systemPrompt`; pi chains them). Wired in
  `index.ts` (`import discipline` + `discipline(pi)`). Soft by design — hard
  `tool_call` blocking stays in `safeguard.ts`; there's no reliable signal for
  "3+ steps" or "ambiguous", so gating work tools would just annoy.

### 2026-06-23 — docs: verify RPC/SDK coverage + tidy design spec

Audited the implementation against the official pi docs and recorded the
result so a future session doesn't re-audit.

- **`AGENTS.md`** — new "RPC coverage (verified 2026-06-23)" section: RPC is
  the correct surface (not the in-process SDK — would break zero-dep + process
  isolation); all wire keys verified correct (`follow_up` snake_case,
  full Extension-UI protocol handled, `contextUsage:null` handled); two events
  deliberately unhandled (`auto_retry_end`, `extension_error`); nothing custom
  is replaceable by a native command (`/api/sessions` dir-scan is forced — RPC
  has no `list_sessions`).
- **`docs/design.md`** — restructured: added an H1 + blockquote, promoted
  sections from ordered-list items to real `##` headings, turned the run-on
  Color Palette paragraph into a proper bullet list with inline-code hex
  values. Content unchanged.

### 2026-06-23 — feat(webui): session list — resume an older session

Browse and resume past sessions for the current project. Previously the webui
pinned one live session with no way back to history (gotcha #9).

- **Server** (`server.js` `GET /api/sessions` + `listSessions`/`sessionDirFor`/
  `firstUserText`): enumerates this project's session JSONL newest-first. The
  per-cwd dir name is derived from `PI_CWD` with pi's **exact** encoding
  (mirrored verbatim from `session-manager.getSessionDir`: realpath → strip one
  leading sep → replace `/ \ :` with `-` → wrap `--…--`), so the lookup can't
  drift. One pass per file (lines capped at 60k): line 1 `{type:"session"}` →
  id/timestamp/cwd; first `{type:"message",role:"user"}` → 160-char preview;
  `message`-line count → rough size; sorted by mtime desc. GET-only, **no client
  path accepted** → no traversal surface; localhost-gated like every route.
- **RPC resume** (`app.js`): a row click sends `switch_session{sessionPath}`
  (the RPC resume command); its success response re-fires `get_state`/
  `get_messages`/`get_commands` with the same `init-*` ids the load path uses,
  so the transcript + state repaint for the now-active session. `new_session`
  responses do the same — so **＋New now actually clears the screen** (it
  previously left the old transcript until the next event). Cancelled switches
  (`session_before_switch`) are skipped (`data.cancelled`).
- **UI** (`index.html` `⏱ Sessions` button in the footer bar; `app.js`
  `showSessions`/`resumeSession`/`fmtSessionDate`/`pathEq` + `curSessionFile`;
  `style.css` `#modal .sessions`/`.srow[.current]`/`.smeta`/`.sprev`): a free
  modal lists sessions (relative date — today/yesterday/Mon DD + HH:MM — message
  count, first prompt). The active session — tracked from `get_state.sessionFile`
  — is highlighted and clicking it no-ops. All interpolated data is
  `esc()`-wrapped (same model as the rest of the UI).
- Self-checked: `node --check` server.js/app.js/md.js; `md.js` esc round-trip;
  live `GET /api/sessions` → 31 sessions, correct previews/counts/paths, all
  cwd-matched, newest-first.

### 2026-06-23 — fix(webui): inline usage bar never showed — server-resolved key hidden by a client-side gate

The inline `#usagebar` (next to the **Usage** button) stayed invisible even
with a valid key, while the **Usage** button modal worked fine.

- **Root cause** (`app.js` `refreshUsageBar`): the 60s poll pre-bailed on
  `if (!getZaiKey())`, and `getZaiKey()` reads **only** browser `localStorage`
  (`pi:zai-key`). But pi's documented key location is `~/.pi/agent/auth.json`
  (`zai.key`), which the **server** resolves via `zaiKeyFromAuth()` (env →
  auth.json → `X-ZAI-Key` header). So with the key only in auth.json (the
  normal case), the modal fetched and rendered while the bar never even tried
  — its own comment falsely claimed it was "the same gate as the modal."
- **Fix** (`app.js`): dropped the `if (!getZaiKey())` pre-bail. The bar now
  always fetches `/api/zai-usage`; the server's `{ok:false,error:"no API key"}`
  response is the single gate — genuinely the same shape the modal uses.
  `if (!u.ok)` / `if (!bars.length)` still hide the bar when there's genuinely
  no key or no quota data.
- Why the modal masked it: `showUsage()`/`renderUsage()` fetch first and let
  the server decide; only the proactive poll had the client-side pre-gate.

### 2026-06-23 — feat(webui): inline usage bar redesign — full-width two-row (tokens + reset countdown)

The inline `#usagebar` moved from a bare body row into the header and became a
full-width glance of the same z.ai data the modal shows.

- **Markup** (`index.html`): `#usagebar` moved from below the header **into**
  the header (after `#usage-btn`), so it shares the header flex row.
- **Render** (`app.js` `renderUsageInline`, `fmtTokens`, `fmtDur`, `windowMs`):
  two rows — **Tokens** (bar + `used / total · %`, colored <70/70–90/≥90) and
  **Reset** (bar + `in <dur>`). Picks the `Tokens` limit for the usage row
  (falls back to first count-pair), and the soonest `nextResetTime` for the
  reset row. Reset fill = elapsed/window, clamped to [0,100] (windowMs is
  nominal 30d/365d, so clamp guards calendar drift). Reuses `zaiLimits`/
  `pctOf` from the modal path — one decode of z.ai's `/quota/limit` shape.
- **Polling** (`app.js`): `setInterval(refreshUsageBar, 60000)` + an immediate
  call on load; paused while the tab is backgrounded (same visibility hook as
  stat/health polling). Click either row → usage modal.
- **Style** (`style.css` `#usagebar`, `.ub-row`, `.ub-track`, `.ub-fill[.lo|.mid|.hi|.time]`):
  `flex-direction:column`, `flex:1 1 auto` + `min-width:240px` so it grows
  into the header space; `.ub-fill.time` uses `--accent` to distinguish the
  countdown from the usage bars.

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
