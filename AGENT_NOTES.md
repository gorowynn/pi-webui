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
| `index.html` | Markup only (~81 lines). Inline refs to `style.css` + `app.js`. |
| `style.css` | All styling (~1282 lines). Ayu-Dark palette — see [docs/design.md](docs/design.md). |
| `app.js` | The entire frontend (~2300 lines, vanilla JS). SSE handling, rendering, modals, diffs, commands palette. |
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
