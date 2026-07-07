<!-- markdownlint-disable MD013 MD060 -->

# AGENTS.md — pi-webui

Auto-loaded by pi every session. Dense orientation: project shape, run/dev,
conventions, gotchas, open work. SSOT policy lives in
[`docs/README.md`](docs/README.md) — four sources: **here** (agent orientation, auto-loaded),
[`GOTCHAS.md`](GOTCHAS.md) (full gotchas, linked from here by keyword),
[`CHANGELOG.md`](CHANGELOG.md) (history, newest first), `docs/` (specs). Route new knowledge: gotcha/convention → here or [`GOTCHAS.md`](GOTCHAS.md); spec change → `docs/`;
finished work → CHANGELOG. Keep entries factual — "why" + file:line over prose.

## What this project is

**pi-webui** — minimal-dependency web UI for
[pi](https://github.com/earendil-works/pi-coding-agent). No build step, no
React/Express/`ws`. Node built-ins (`http`+`child_process`), native browser
SSE + `fetch`, pi **RPC mode** (`pi --mode rpc`) over stdin/stdout JSON.
Published as `npm:pi-webui`.

```text
browser ──SSE──▶ Node (server.js) ──stdin──▶ pi --mode rpc
        ◀─POST─                  ◀─stdout─
```

Repo: <https://github.com/gorowynn/pi-webui.git> · branch `dev` · version
`package.json` (0.2.0) · Node 18+, `pi` on PATH.

## Run / dev

```bash
node server.js                 # standalone — http://127.0.0.1:4317
# inside pi: /webui [port],  /webui-stop
```

Env: `PORT` (4317), `PI_BIN` (pi), `PI_ARGS` (extra pi args), `PI_CWD` (spawned
pi working dir → session location + tool roots).

**Zero-build is a hard constraint** — no bundler/transpile/`npm install` at
runtime. Edit `app.js`/`style.css`/`index.html` + refresh = the dev loop.

## File map

| File | Role |
|------|------|
| `server.js` | Bridge. CommonJS, ~no deps. Serves assets, frames JSONL (split on `\n` only), spawns/respawns `pi --mode rpc`, CSRF + DNS-rebinding gate, `safePath`, 1MB body cap. |
| `index.html` | Markup only. Load order: `vendor/markdown-it.min.js` → `md.js` → `vendor/highlight.min.js` → `app.js`. |
| `style.css` | All styling. Ayu-Dark — see [`docs/design.md`](docs/design.md). |
| `md.js` | Thin shim over vendored markdown-it 14.x: `md(markdown)` (`html:false`/`breaks:true`/`linkify:true`, links `target=_blank`) + `esc()` (project-wide HTML-escaper source of truth, null-safe→`""`). Loads AFTER `markdown-it.min.js`; `require`-able in Node (self-test: `node -e "console.log(require('./md.js').md('**x**'))"`). |
| `app.js` | Entire frontend (vanilla JS): SSE, rendering, modals, diffs, commands palette. Uses `md()`/`esc()` globals from md.js. |
| `vendor/` | Vendored runtimes, served via `server.js` `STATIC` whitelist (no npm/build): **markdown-it** v14.1.0 UMD (`window.markdownit`), **highlight.js** v11.11.1 common + `highlight.css` github-dark. `app.js` `highlightCode()` post-processes `pre code`. Both degrade silently if missing (md.js→escaped text; hljs→uncolored). |
| `docs/` | Specs: [`design.md`](docs/design.md) (UI/UX, visual source of truth), [`README.md`](docs/README.md) (index + SSOT). |
| `package.json` | `keywords:["pi-package"]` → `pi install`-able. `pi` manifest declares `extensions`+`skills` (package-relative); `files:` whitelist ships both. |
| `skills/sdd/` | 4-phase Spec-Driven Dev + TiCoder (Plan→Spec→Impl-Plan→Code+Test, approval between phases). Discovered via `pi.skills` manifest (ships + auto-discovered); `/skill:sdd`; advisory only (size gate lives in the `description`). |
| `extensions/pi_minimal_webui/` | pi extension — see below. |
| `jetbrains/` | Standalone Gradle plugin (separate project; zero-build invariant preserved). See [`jetbrains/README.md`](jetbrains/README.md). |

### Extension (`extensions/pi_minimal_webui/`)

Folder name is a legacy TODO — no second webui here, only the ask-bridge tool
(rename P3).

- `index.ts` — **Ask User Question RPC bridge.** Shadows stock
  `ask_user_question` (tool name = wire contract with the LLM, **never
  rename**): stock `ctx.ui.custom()` is a no-op in RPC, so routes the answer
  via `ctx.ui.input` (blocking latch, which RPC *does* bridge). Smuggle:
  tool→browser via `tool_execution_start` (args verbatim), browser→tool via
  `extension_ui_response{value}`.
- `safeguard.ts` — **Per-tool allow/ask/deny gate** on every tool call.
  Config `~/.pi/agent/safeguard.json` (re-read each call). First match wins.
- `subagent.ts` — **Tier-based `subagent` tool.** Spawns isolated
  `pi --mode json -p --no-session --model <tier>`. Modes: single/parallel/chain
  (`{previous}`). Parent never ingests child tool I/O — only capped ≤50KB final
  text (context savings). Tiers re-read
  `~/.pi/agent/subagent-tiers.json` `{capable,implement,lookup}` each call;
  sidebar `GET/POST /api/subagent-tiers` edits it (no restart). Defaults:
  capable `zai/glm-5.2`, implement `zai/glm-5-turbo`, lookup `zai/glm-4.5-air`.
  Edit the `TIERS` table in-file for agents/tools/prompts.
- `webui.ts` — `/webui` + `/webui-stop`. Spawns `server.js` detached; kills the
  whole tree (POSIX process group / Windows `taskkill /T`).
- `todo.ts` — **`todo` tool**, action-based: `plan` once (stable per-task ids)
  → `update` by id (`open`|`started`|`finished`) → `add`/`remove`/`clear`. The
  browser owns the rendered list (same smuggle channel as ask). `execute()`
  mirrors the op into module state and **returns live list + flags** (unknown
  id → `#N not found`; a `started` task this update didn't touch → `still
  started`) so the agent can't silently drift. Owns the canonical mirror
  `getTodos()` (reset `session_start`) that `discipline.ts` reads. Reload-safe
  via `pi:todos` localStorage.
- `discipline.ts` — **Todo process-discipline gate**, two layers:
  - *Hard `tool_call` gate*: blocks any **work** tool (all except
    `todo`+`ask_user_question`) when the list is active + unfinished + **zero**
    tasks `started`. Forces the `plan` → `update(1:started)` → work →
    `update(1:finished)` → … → `clear` rhythm. Composes with `safeguard.ts`
    (both hook `tool_call`; both must allow). Ceiling: a batched
    `[update(1:started), read(...)]` right after `plan` preflights `read`
    before the sibling `update` runs (parallel mode) → one false retry,
    self-correcting.
  - *Soft `before_agent_start` nudge*: no list yet → "plan if 3+ steps /
    `ask_user_question` if ambiguous"; all-finished-but-not-cleared → "`clear`
    it". Composes with `ponytail.ts` (both append `event.systemPrompt`).
  Only ever blocks on the stale-list invariant; safety (deny/ask) stays in
  `safeguard.ts`.

## Conventions & gotchas

The full gotchas live in **[`GOTCHAS.md`](GOTCHAS.md)** (moved out of the
auto-load to save context). **Before editing** `server.js` / `app.js` / `md.js`
/ the extension / `jetbrains/`, scan the keyword index and read the matching
entry — these are load-bearing invariants. Numbers match `GOTCHAS.md #N`.

| When touching… | # |
|---|---|
| RPC wire keys: `follow_up`/`followUp`, `streamingBehavior`, JSONL framing, `readline`, newline splitting | 1, 2 |
| `ASK_MARKER`, standalone↔RPC marker sync | 3 |
| `safePath`, symlinks, path traversal, `fs.realpathSync` | 4 |
| `api()` fetch helper, unhandled promise rejections | 5 |
| diff LCS / large diffs; permission-modal diff preview, `curToolArgs`, `tool_execution_*` | 6, 7 |
| app.js module-scope state, the ~26 closure `let`s | 8 |
| sessions, `switch_session`, crash restart, multi-tab | 9 |
| security: CSRF, DNS-rebinding, `validateLink`, body cap | 10 |
| asset load order, markdown-it / md.js / highlight, vendor whitelist | 11 |
| `esc()` HTML escaper, shadowing/drift | 12 |
| assistant text/thinking streaming, `finalizeBubble`, `message_end`, render bugs | 13 |
| subagent live view, `partialResult.details`, density toggle | 14 |
| settings sidebar, model/thinking/pony + tier selects | 15 |
| `jetbrains/` build: gradle pins, Kotlin, `gradlew` in git-bash, `javap`, diff-gate wire contract | 16, 17 |

## RPC coverage (verified 2026-06-23 — don't re-audit without a pi version bump)

- **Use RPC, not the SDK.** Deliberately `pi --mode rpc` (subprocess) over the
  SDK's `createAgentSession()`/in-process `AgentSession` — it keeps
  min-dependency + process isolation + the crash-restart backoff. Migrating
  breaks both.
- **Wire keys are correct.** `follow_up` snake_case (GOTCHAS.md #1); composer maps
  mode→`steer`/`follow_up`/`prompt`; `contextUsage:null` already degrades to
  `—`; all Extension-UI protocol methods (4 dialog + 5 fire-and-forget) handled
  in `uiRequest()`.
- **Two events deliberately unhandled:** `auto_retry_end` (only
  `auto_retry_start` is toasted) and `extension_error`. Add if you want
  retry-recovery / extension-throw surfacing.
- **No custom piece is replaceable by a native command.** `/api/sessions` +
  `sessionDirFor` (`server.js`) looks reimplementable, but RPC has **no
  `list_sessions`** (only `new_session`/`switch_session`/`set_session_name`) →
  the JSONL dir-scan is forced. `ask_user_question` stays shadowed (stock
  renders via `ctx.ui.custom()`, a no-op in RPC).

## Manual smoke tests (quick sanity)

- **Editable transcript diff** — ask for a small edit; edit the right pane →
  Apply → file updates, button reads `Applied ✓`.
- **Permission-modal preview** — trigger an edit/write needing approval; modal
  shows a read-only old|new hunk diff. No diff = `tool_execution_start` didn't
  carry `args` (or the tool isn't `edit`/`write`) → `curToolArgs` empty (GOTCHAS.md #7).
- **Health** — `GET /api/health`; SSE at `GET /api/events`; commands via
  `POST /api/cmd`.

## Open work

- [ ] Rename `pi_minimal_webui` folder → e.g. `pi-webui-ask-bridge` (browser
      side needs no change).
- [ ] Watch the mutable top-level closure state in app.js as it grows (GOTCHAS.md #8).
- [x] **Subagent per-command safeguard (Option A, IPC) — CLOSED 2026-06-25.**
      The spawned `pi --mode json` subprocess DOES load safeguard + fire its
      `tool_call` hook, but headless (`hasUI=false`) → `nonInteractive` →
      default `allow` (stdin ignored, can't prompt). The real capability wall
      is the tier `--tools` allowlist; dropped `bash` from the debugger tier →
      5/6 tiers read-only, only `implementer` keeps bash (bounded by the
      parent's delegation gate). Full IPC deferred — ~150-250 lines
      interleaving a non-pi protocol into pi's NDJSON stdout, risking the
      `\n`-only framing invariant (GOTCHAS.md #2) for marginal benefit. (Detail in
      CHANGELOG.)

Tick an item here **and** add a changelog entry when you close it.
