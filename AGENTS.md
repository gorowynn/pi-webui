<!-- markdownlint-disable MD013 MD060 -->

# AGENTS.md — pi-webui

> **Auto-loaded by pi at startup** — this file is named `AGENTS.md`, pi's
> context-file convention (pi README → "Context Files"; `~/.pi/agent/AGENTS.md`
> is global, repo-root is project-local). You don't need to be told to read it:
> it's already in context every session. It captures non-obvious project
> knowledge, conventions, gotchas, and open work so a fresh session picks up
> cleanly. Update it whenever you learn something worth keeping.
>
> Keep entries **factual and dense**. Prefer "why" + file:line over prose.
> When you finish a chunk of work, add a dated entry to [`CHANGELOG.md`](CHANGELOG.md).

---

## 🚧 In progress

- **Usage bar redesign (uncommitted):** the inline `#usagebar` next to the
  **Usage** button is now full-width — two rows: token usage (bar +
  `used / total · %`) and a reset countdown (bar + "in 46m"). `app.js`
  (`renderUsageInline`, `fmtTokens`, `fmtDur`, `windowMs`, carried through
  `zaiLimits`) + `style.css` (`.ub-row`, `.ub-fill.time`). Polls every 60s via
  the existing `refreshUsageBar`; click either bar → usage modal. Not yet logged
  in `CHANGELOG.md` — add an entry when you commit.
- **Process-discipline nudges (uncommitted):** new `extensions/pi_minimal_webui/discipline.ts`
  injects a per-turn `before_agent_start` nudge — keeps the todo list current
  (names started tasks, prompts `clear` when all finished) and reminds about
  `ask_user_question` on fresh ambiguous requests. Wired in `index.ts`. Soft
  enforcement (system-prompt append), verified against 11 scenarios. Not yet in
  `CHANGELOG.md`.

---

## Single source of truth

Project knowledge lives in three places, and **only** these three:

- **`AGENTS.md`** (this file, **auto-loaded by pi**) — orientation, conventions,
  gotchas, open work. Read first.
- **`CHANGELOG.md`** — running history (newest first), moved out of this file.
- **`docs/`** — durable specs: [`docs/design.md`](docs/design.md) (UI/UX) and
  [`docs/README.md`](docs/README.md) (index + the full SSOT charter).

Code comments, commit messages, and chat are subordinate. When you learn
something durable, put it in the right place (gotcha/convention → here; spec
change → `docs/`; finished work → `CHANGELOG.md`). Full policy:
[`docs/README.md`](docs/README.md).

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
| `index.html` | Markup only. Inline refs to `style.css` + `md.js` + `app.js` (load order matters: md.js before app.js). |
| `style.css` | All styling. Ayu-Dark palette — see [docs/design.md](docs/design.md). |
| `md.js` | **Markdown → HTML parser + `esc()` HTML escaper**. Zero-dep, pure `string→string`, browser-loaded via `<script>` BEFORE app.js, also `require`-able in Node. Exports two globals: `md(markdown)` and `esc(text)`. The single source of truth for both — app.js dropped its duplicate copies. |
| `app.js` | The entire frontend (vanilla JS). SSE handling, rendering, modals, diffs, commands palette. Uses `md()` + `esc()` globals from md.js. |
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
  finished. The browser owns the rendered list (applies each action from
  `tool_execution_start` args, same smuggle channel as ask_user_question);
  `execute()` mirrors the same op into module state and **returns the live
  list + flags** (unknown id → `#N not found`; a `started` task this update
  didn't touch → `still started — finish before it stalls`) so the agent gets
  feedback every call and can't silently drift. It owns the canonical
  extension-side mirror (`getTodos()`, reset on `session_start`) that
  `discipline.ts` reads. Reload-safe via a `pi:todos` localStorage hint
  (mirrors the `pi:model` idiom); a new session clears it through
  `setTodos([])`. Tool name matches the webui's UI hooks — don't rename.
- `discipline.ts` — **Process-discipline nudges** (soft enforcement). Reads
  the live todo mirror from `todo.ts` via `getTodos()` (single source of
  truth — it keeps NO mirror of its own), then at `before_agent_start`
  appends a one-line nudge to the system prompt: todos active → "keep it
  current" (names started tasks); all finished → "`clear` it"; no todos +
  fresh prompt → "consider `ask_user_question` if ambiguous, or plan a todo
  list if 3+ steps". Composes with `ponytail.ts` (both append to
  `event.systemPrompt`, pi chains them). Soft by design — hard `tool_call`
  blocking stays in `safeguard.ts`; there's no reliable signal for "3+ steps" or
  "ambiguous", so gating work tools would just annoy. Wired from `index.ts`.

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
8. **Mutable top-level closure state in app.js** (~12 pieces: `cur`, `pinned`,
   `askId`, `pendingAsk`, `pendingEditCalls`, `compacting`, `todos`, `commands`,
   `currentModelId`, `curSessionFile`, `lastThinkPaint`, `renderRaf`). Fine at
   current size; flag if it grows.
9. **One live pi session at a time, but you can resume history.** There's one
   shared pi process for all tabs; the **⏱ Sessions** button (`GET /api/sessions`
   on the server, `switch_session` RPC to resume) swaps that single process to a
   past session file and repaints via `get_messages`/`get_state`. Multi-tab /
   concurrent sessions are still a later concern. If the pi subprocess crashes,
   the bridge restarts it after 1s (crash-loop guard = exponential backoff).
10. **Security baseline already in place:** CSRF + DNS-rebinding gate on POSTs,
    SSE backpressure (drops stalled clients), `md()` link-scheme allowlist
    (blocks `javascript:`/`data:`), 1MB body cap. Don't regress these.

11. **`md.js` must load before `app.js`.** Both `index.html` (`<script src="md.js">` then `app.js`) and `server.js` (`STATIC` whitelist) must list `md.js`. app.js calls `md()`/`esc()` at runtime with no local definitions — they're globals set by md.js's IIFE. md.js is `require`-able in Node (exports `{md, esc}`); exercise it with `node -e "const{md}=require('./md.js');console.log(md('**x**'))"` after touching the parser.
12. **`esc()` is shared, not duplicated.** It lives ONLY in `md.js` (static entity map, null-safe). app.js has ~22 call sites that use the global. Don't re-add a local `esc` to app.js — it would silently shadow and drift (the old copy returned `"null"` for null input; the shared one returns `""`).

## RPC coverage (verified 2026-06-23)

Checked `app.js`/`server.js`/extensions against
<https://pi.dev/docs/latest/sdk> + <https://pi.dev/docs/latest/rpc>. Nothing
to change — don't re-audit without a pi version bump.

- **Use RPC, not the SDK.** The SDK docs cover `createAgentSession()` /
  in-process `AgentSession`; we deliberately use `pi --mode rpc` (subprocess)
  instead — it keeps the zero-dependency constraint, the process isolation,
  and the crash-restart backoff in `server.js`. Migrating would break both.
- **Wire keys are correct.** `follow_up` is snake_case (gotcha #1); the
  composer maps mode→`steer`/`follow_up`/`prompt`; `contextUsage:null` after
  compaction already degrades to `—`; all Extension-UI protocol methods
  (4 dialog + 5 fire-and-forget) are handled in `uiRequest()`.
- **Two events deliberately unhandled:** `auto_retry_end` (only
  `auto_retry_start` is toasted) and `extension_error`. Add if you want
  retry-recovery / extension-throw surfacing.
- **No custom piece is replaceable by a native command.** `/api/sessions` +
  `sessionDirFor` (`server.js`) looks reimplementable, but RPC has **no
  `list_sessions`** — only `new_session`/`switch_session`/`set_session_name`,
  so the JSONL dir-scan is forced. `ask_user_question` stays shadowed: the
  stock tool renders via `ctx.ui.custom()`, a no-op in RPC.

---

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

## History

The running changelog lives in [`CHANGELOG.md`](CHANGELOG.md) (newest first),
moved out of this file so it stays a lean orientation doc.
