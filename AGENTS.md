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
| `package.json` | `keywords:["pi-package"]` makes it `pi install`-able. `pi` manifest declares `extensions` + `skills` (both package-relative); `files:` whitelist ships both to npm. |
| `skills/` | Shipped skills. Currently `sdd/` — strict 4-phase Spec-Driven Development + TiCoder (Plan→Spec→Impl-Plan→Code+Test, explicit approval between phases). Discovered via the `pi.skills` package manifest (same path the extension uses), so it ships with the repo AND is auto-discovered — no settings entry beyond the existing local-path package. `/reload` picks up edits; invoke with `/skill:sdd`. Skill-only = advisory (no gate backs it); the size gate lives in the `description` (the one field always in context). |

### The extension (`extensions/pi_minimal_webui/`)

- `index.ts` — **Ask User Question RPC bridge.** Shadows the stock
  `ask_user_question` tool (tool name is a wire contract with the LLM — **never
  rename it**). The stock tool's `ctx.ui.custom()` is a no-op in RPC mode; this
  routes the answer through `ctx.ui.input` (a blocking latch) which RPC *does*
  bridge. Two-channel smuggle: tool→browser via `tool_execution_start` (full
  args verbatim), browser→tool via `extension_ui_response{value}`.
- `safeguard.ts` — **Per-tool allow/ask/deny gate** for *every* tool call.
  Config at `~/.pi/agent/safeguard.json` (re-read every call). First match wins.
- `subagent.ts` — **Tier-based subagent tool** (`subagent`). Ports pi's
  `examples/extensions/subagent` core, stripped to what `--mode rpc` uses: no
  TUI rendering (the webui renders the live `details` itself — see gotcha #14),
  no filesystem agent discovery (tiers are in-code config). Registers a
  `subagent` tool the parent LLM calls to delegate; each call spawns an isolated
  `pi --mode json -p --no-session --model <tier>` subprocess. Two wins at once:
  cost routing (tier→model) + context savings (the parent never ingests the
  subagent's tool I/O — only its capped ≤50KB final text = roadmap O2,
  structurally). Modes: single / parallel / chain (`{previous}`). **Tier models
  are user-tunable from the sidebar**: `execute()` re-reads
  `~/.pi/agent/subagent-tiers.json` (`{capable,implement,lookup}`) each call
  (safeguard pattern) and overrides the `TIERS` defaults — no restart needed.
  Server endpoint `GET/POST /api/subagent-tiers` reads/writes that file. Default
  tiers: capable `zai/glm-5.2` (planner/reviewer/debugger), implement
  `zai/glm-5-turbo` (implementer), lookup `zai/glm-4.5-air` (scout/summarizer).
  Edit the `TIERS` table in-file to change agents/tools/prompts; use the
  sidebar to change models. Wired from `index.ts`.
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
- `discipline.ts` — **Process-discipline enforcement** for the todo list —
  TWO layers (a soft nudge alone couldn't stop mid-turn drift):
  - *Hard `tool_call` gate* (the strict one): blocks any **work** tool
    (everything except `todo` + `ask_user_question`) when the list is active
    with unfinished work but **zero** tasks `started`. Forces the documented
    "one started at a time" rhythm so every `started`/`finished` transition
    shows in the panel: `plan` → `update(1:started)` before any work → work →
    `update(1:finished)` → `update(2:started)` before more work → … →
    `update(last:finished)` (all-done, allowed) → `clear`. Reads `getTodos()`.
    Composes with `safeguard.ts` (both hook `tool_call`; both must allow).
    Ceiling: a correctly-batched `[update(1:started), read(...)]` right after
    `plan` preflights `read` before the sibling `update` executes (parallel
    mode) → one false-positive retry, self-correcting.
  - *Soft `before_agent_start` nudge*: handles the cases the gate can't see —
    no list yet ("plan one if 3+ steps / `ask_user_question` if ambiguous"),
    and all-finished-but-not-cleared ("`clear` it"). Composes with `ponytail.ts`
    (both append to `event.systemPrompt`).
  Safety (deny/ask) stays in `safeguard.ts`; this gate only ever blocks on the
  stale-list invariant. Wired from `index.ts`.

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
7. **The permission-modal diff preview reads `curToolName`/`curToolArgs`**
   (`app.js` `renderEditDiffPreviews`) — the snapshot set at `tool_execution_start`
   and cleared at `tool_execution_end`. If `tool_execution_start` doesn't carry
   `args`, or the tool isn't `edit`/`write`, the preview bails. (Earlier docs
   blamed `toolcall_end`/`pendingEditCalls` — that mechanism is gone: `toolcall_start`/`toolcall_end`
   are intentionally not handled now; tool boxes + diff previews render from
   `tool_execution_*` only.)
8. **Mutable top-level closure state in app.js** (~26 module-scope `let`s:
   `cur`, `curToolName`/`curToolArgs`, `streaming`, `pinned`, `lastScrollTop`,
   `todos`, `askId`, `pendingAskArgs`, `compacting`, `commands`, `currentModelId`,
   `curSessionFile`, `modalFree`, `palSel`/`palItems`, `lastThinkPaint`,
   `renderRaf`, `lastActivity`, `lastFocus`, `availableModels`, `subagentDensity`,
   the three interval handles (`statsTimer`/`healthTimer`/`usageTimer`), …). Grew
   from ~12 — fine at this size, but it's the one to watch before adding more
   (see open work #2). (2026-06-25: O3 close-out shaved `awaitingTurnStats`.)
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
12. **`esc()` is shared, not duplicated.** It lives ONLY in `md.js` (static entity map, null-safe). app.js has ~40 call sites that use the global. Don't re-add a local `esc` to app.js — it would silently shadow and drift (the old copy returned `"null"` for null input; the shared one returns `""`).
13. **Assistant text renders from pi's AUTHORITATIVE message, not re-accumulated
    deltas.** (`app.js`: `finalizeBubble(payload.message.content)` at `message_end`;
    `renderAssistantContent` shared with `renderMessage`/reload.) History: md used
    to render broken *sometimes* live but always fine after reload. Two layers of
    cause, fixed in two steps:
    - **Render path (2026-06-24, first fix):** text stopped streaming live; it
      accumulates raw blocks into `cur.content` and renders once at `message_end`
      via `renderAssistantContent` — the same function reload uses. Killed the
      live-vs-reload *path* divergence (missing `text_end`, whole-message
      `text_end.content`, stray `text_delta` after `cur` nulled, …).
    - **Data source (2026-06-24, decisive fix):** the live path still read
      browser-re-accumulated `text_delta`s, which are LOSSY/CORRUPTIBLE in the
      SSE transport (dropped/merged deltas → missing words; stripped spaces/
      parens/digits → words jammed). Reload reads pi's stored message via
      `get_messages`, so it was always clean. Root fix: `message_end` carries
      the full final `message` (`agent-session.js` L390-410 relays it; every
      `AssistantMessageEvent` also carries `partial` — pi-ai `types.d.ts`
      L330-374), the SAME object pi persists. `finalizeBubble(payload.message.content)`
      renders from THAT, so live and reload read byte-identical input and can no
      longer diverge regardless of transport hiccups. The hand-accumulated
      `cur.content` survives only as the `agent_end` safety-net fallback (when
      `message_end` never fired).
    Design notes: `finalizeBubble(content)` clears the bubble, RESETS the
    per-block cursors (`textPar`/`thinkEl`/…) so re-render creates fresh nodes
    instead of painting into the detached live-streamed ones, then calls
    `renderAssistantContent`. Thinking STILL streams live (`renderThink` via the
    rAF-coalesced `scheduleRender`) and is just re-rendered finalized at
    `message_end` (collapsed `<details>` → invisible swap). `md.js` itself is
    deterministic and innocent — verified by feeding it the full reload text
    (zero words lost). **If md ever renders broken again**, it must now ALSO be
    broken after reload (same input); if not, suspect `payload.message` being
    absent/empty at `message_end` (check the raw event) — the `cur.content`
    fallback would then kick in and reintroduce the old symptom.
14. **Subagent live view reads `partialResult.details`, not `.content`.** When
    the `subagent` tool runs it streams its whole live state
    (`{mode, results:[{agent, model, turns, exitCode, messages:[…child tool
    calls + partial output…], usage}]}`) via `onUpdate` → `partialResult.details`.
    `agent-session.js` forwards `partialResult` whole, so it arrives on every
    `tool_execution_update` — but the generic update handler used to read only
    `.content` (the `"(running…)"` string) and discard `.details`. `app.js`
    `renderSubagentView` now renders details at start/update/end instead.
    **Density** is a sidebar toggle (`pi:sa-density`): `full` shows child tool
    calls + text, `compact` trims to status + calls. If a subagent box shows only
    text, `details` was absent (the tool isn't `subagent`, or a pi build that
    doesn't relay `partialResult.details`).
15. **Settings sidebar holds model/behavior + subagent tiers + a dev toggle.**
    `<aside id="settings">` (fixed right drawer; ⚙ opens, ✕/backdrop/Esc
    closes). The model/thinking/pony selects were MOVED here from the header —
    they keep their IDs so the existing `onchange` handlers work unchanged. The
    3 tier selects POST to `/api/subagent-tiers` → `~/.pi/agent/subagent-tiers.json`,
    which `subagent.ts` re-reads each call (no restart). `subagentDensity` is a
    module-scope `let` set from its select. (The `cache logger` toggle +
    `o3LogEnabled` were removed in the 2026-06-25 O3 close-out — the permanent
    statusbar cache-hit readout replaced it.)

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
  shows a read-only old|new hunk diff. No diff = `tool_execution_start` didn't
  carry `args` (or the tool isn't `edit`/`write`) so `curToolArgs` was empty
  (see gotcha #7).
- **Health** — `GET /api/health`; SSE at `GET /api/events`; commands via
  `POST /api/cmd`.

## Open work

Open items (P3 hygiene):

- [ ] Rename `pi_minimal_webui` folder → e.g. `pi-webui-ask-bridge` (browser
      side needs no change).
- [ ] Watch the mutable top-level closure state in app.js as it grows.
- [x] **Subagent per-command safeguard (Option A, IPC) — CLOSED 2026-06-25,
      "B suffices + cheap harden."** De-risked the linchpin: the spawned
      `pi --mode json` subprocess DOES load safeguard and its `tool_call` hook
      fires, but headless (`hasUI=false`) → `nonInteractive` policy → default
      `allow` → it auto-allows every command (stdin is `ignore` anyway, so it
      can't prompt). The real capability wall is the tier `--tools` allowlist.
      Resolved by dropping `bash` from the debugger tier (its comment already
      endorsed this) → 5/6 tiers are now provably read-only; only `implementer`
      keeps bash (needs it for builds/tests), bounded by the parent's Option B
      delegation gate (shows agent+task before spawning). Full IPC deferred —
      ~150-250 lines that interleave a non-pi protocol into pi's NDJSON stdout,
      risking the `\n`-only framing invariant (gotcha #2) for marginal benefit.

When you close an item, tick it here **and** add a changelog entry.

---

## History

The running changelog lives in [`CHANGELOG.md`](CHANGELOG.md) (newest first),
moved out of this file so it stays a lean orientation doc.
