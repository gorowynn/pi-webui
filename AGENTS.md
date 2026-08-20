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
pi-webui                       # global bin (npm i -g) — detached server.js + auto-open browser (survives closing the console)
# inside pi: /webui [port],  /webui-stop
```

Env: `PORT` (4317), `PI_BIN` (pi), `PI_ARGS` (extra pi args), `PI_CWD` (spawned
pi working dir → session location + tool roots), `PI_WEBUI_NO_SWITCH` (disable
workspace switching + hide the list — set by `/webui` for IDE use),
`PI_WEBUI_NO_OPEN` (skip the launcher's browser auto-open).

**Zero-build is a hard constraint** — no bundler/transpile/`npm install` at
runtime. Edit `public/app.js`/`public/style.css`/`public/index.html` + refresh = the dev loop.

## File map

| File | Role |
|------|------|
| `server.js` | Bridge. CommonJS, ~no deps. Serves assets, frames JSONL (split on `\n` only), spawns/respawns `pi --mode rpc` (live `let PI_CWD`; `POST /api/workspace` tree-kills + respawns in a new project and broadcasts `workspace_changed` to all tabs), CSRF + DNS-rebinding gate, `safePath`, 1MB body cap. `PI_WEBUI_NO_SWITCH` gates switching. `/api/snapshot` returns `{state, messages, commands, models, stats, liveEvents}` — messages derived from `get_entries` (parent-chain, compaction-aware), liveEvents = current-turn buffer. |
| `public/index.html` | Markup only. Load order: `vendor/markdown-it.min.js` → `md.js` → `vendor/highlight.min.js` → feature modules → `rail.js` → `app.js`. |
| `public/style.css` | All styling. **dark** theme (black + anthracite, GitHub-dark neutrals/blue accent) by default + switchable `paperlike` (`[data-theme]`) — see [`docs/design.md`](docs/design.md). |
| `public/md.js` | Thin shim over vendored markdown-it 14.x: `md(markdown)` (`html:false`/`breaks:true`/`linkify:true`, links `target=_blank`) + `esc()` (project-wide HTML-escaper source of truth, null-safe→`""`). Loads AFTER `markdown-it.min.js`; `require`-able in Node (self-test: `node -e "console.log(require('./public/md.js').md('**x**'))"`). |
| `public/app.js` | Entire frontend (vanilla JS): SSE, rendering, rail widgets, modals, diffs, commands palette, left workspace/session sidebar (`#wsbar`). Uses `md()`/`esc()` globals from md.js. |
| `public/rail.js` | Zero-dep dual-mode workspace-tools rail state seam: fixed five-widget table contract, canonical `pi:rail` persistence with legacy migration, generation stamps, SDD visibility, and text badges. Loaded before `app.js`; covered by `test/rail.test.js`. |
| `public/usage-telemetry.js` | Dual-mode, zero-dep Usage sampler and metric renderer: normalized numeric samples (60 minutes/361 samples), event durations, rolling views, timestamp-aware sparklines capped at 100 rendered points, and browser-local v2 persistence for the 12 most recently saved session histories. Legacy v1 single-record storage migrates on the next save; safeguard permission-prompt waits are excluded from tool runtime; see [`docs/usage-telemetry.md`](docs/usage-telemetry.md). |
| `workspaces.js` | Pure workspace discovery + switch validation (CommonJS, fs-only). `discoverWorkspaces` scans `~/.pi/agent/sessions/--<cwd>--/` and recovers each root from the newest `.jsonl`'s `{type:"session"}.cwd` (NOT the encoded folder name); `isKnownWorkspacePath` is the `POST /api/workspace` security gate (realpath must match a discovered workspace). Unit-tested (`test/workspaces.test.js`). |
| `jsonl.js` | Strict JSONL codec (plan F§4.5): `encodeJsonLine(obj)` + `JsonLineDecoder` (split on `\n`, strip `\r`, buffer incomplete UTF-8 via StringDecoder, per-record cap). Zero-dep CommonJS. |
| `livebuf.js` | Current-turn event buffer for reconnect replay (plan 5.1): `createLiveBuffer().push(obj)` assigns a monotonic `sequence` (attached to the broadcast wrapper) + buffers turn-content events (agent_start seeds, agent_end clears, only message_*/tool_execution_*). `snapshot()` for `/api/snapshot`'s `liveEvents`; `clear()` on workspace switch. Survives a pi CRASH (lives in Node, not the child). Zero-dep, 10 unit tests. |
| `sse-queue.js` | Per-client SSE delivery seam: FIFO backpressure tail retention, UTF-8 byte accounting, inclusive 1 MiB queue cap, bounded stall cleanup, and isolated close/write outcomes. Zero-dep CommonJS, covered by `test/sse-queue.test.js` and `test/sse-transport.test.js`. |
| `session-entries.js` | Compaction-aware history reconstruction (plan 5.2): `activeSessionMessages(entries, leafId)` walks the entry parent-chain from leafId→root, reverses, maps message/compaction/custom_message entries, filters visible. Compaction entries → synthetic `role:"custom"` markers. Used by `/api/snapshot` instead of flat `get_messages` (a superset — no regression). Zero-dep, 10 unit tests. |
| `subagents.js` | pi-subagents async fleet file bridge: discovers `<tmp>/pi-subagents-*/async-subagent-runs/`, projects each run's `status.json` (bounded, malformed skipped), tails `output-<i>.log`/`subagent-log-*.md`, and delivers stop/steer via the plugin's portable control inbox (atomic temp+rename). Ids validated + dir-resolved — no traversal. Backs `GET /api/subagents`, `/api/subagents/log`, `POST /api/subagents/control`. 24 unit tests. |
| `recent-sessions.js` | Head/tail session-list reader (plan 4.1): reads only the first 64 KB + a backward-scanned tail (≤2 MB) of each `.jsonl` to recover `{id,cwd,name,updatedAt,firstPrompt}` without parsing multi-MB middles. Exact message count only when the whole file fits; otherwise `messages:null` + `size` (bytes). `listRecentSessions(dir)` backs `/api/sessions`. 35 unit tests. |
| `git.js` | Read-only git porcelain + mutations (plan 4.5/4.6), ported from pi-livecraft. `getGitSnapshot` (status `--porcelain -z` + numstat merge + unpushed commits), `getGitFileDiff`, `commitChanges`/`pushCommits`/`resetGitCommit`/`revertGitCommit`/`discardFileChanges`/`discardChanges`. Scoped to `realpath(PI_CWD)`; the diff path is validated against the snapshot. Pure parsers exported, 32 unit tests. |
| `isolated-prompt.js` | Disposable isolated pi runner (plan 4.7/4.8): spawns a separate `pi --mode rpc --no-tools --no-extensions …` in `~/.pi/pi-webui-isolated` (copies auth.json/models.json once — the §6.4 security boundary), auto-selects the cheapest model, runs one prompt, extracts the text, terminates. `improvePrompt(cwd,draft,direction)` backs the composer's Improve dropdown. `cheapestAvailableModel`/`assistantText` pure, 17 unit tests. |
| `broker.js` | Server-owned pending-approval broker (U6): registers every blocking extension-UI request (tool identity from the preceding `tool_execution_start`), first-response-wins, stale-id rejection (410), `approval_resolved` broadcast, cleared on pi exit/workspace switch, replayed via `/api/snapshot` `pendingApprovals`. Zero-dep, 6 unit tests. |
| `public/permissions-ux.js` | Dual-mode pure helpers for the `#permissions` page: layer-tree builder, editor validation rows, audit redaction, explain view, yolo mode state machine. 5 unit tests. |
| `bin.js` | `pi-webui` global launcher. Spawns `server.js` **detached** (own process group → closing the console won't kill it), polls a temp log to report early death, opens the browser (`PI_WEBUI_NO_OPEN` skips), then exits. |
| `test/` | `node:assert/strict` unit tests, no framework (`node test/<x>.test.js`). |
| `public/vendor/` | Vendored runtimes, served via `server.js` `STATIC` whitelist (no npm/build): **markdown-it** v14.1.0 UMD (`window.markdownit`), **highlight.js** v11.11.1 common + `highlight.css` github-dark. `app.js` `highlightCode()` post-processes `pre code`. Both degrade silently if missing (md.js→escaped text; hljs→uncolored). |
| `public/{tool-presentation,csv-preview,tool-protocol,session-analysis,composer-images}.js` | Zero-dep vanilla feature modules (Phase 2–4), all dual-mode (`module.exports` + `window.*`, require-able in Node for tests), loaded after md.js/highlight, before app.js: **tool-presentation** (typed tool-output previews + offscreen virtualizer), **csv-preview** (bounded CSV→table), **tool-protocol** (tool-call/result extraction + `toolContentText` flatten), **session-analysis** (`analyzeSession` cost/tool/token math, plan 4.2), **composer-images** (canvas downscale + JPEG quality loop, plan 4.10). |
| `public/subagents-ux.js` | Zero-dep dual-mode pure helpers for the `#fleet` page (run/step rows, state chips) + the plugin's custom-message notices (`subagent-notify`, steering/control). 27 unit tests. |
| `docs/` | Specs: [`design.md`](docs/design.md) (UI/UX, visual source of truth), [`README.md`](docs/README.md) (index + SSOT). |
| `package.json` | `keywords:["pi-package"]` → `pi install`-able. `pi` manifest declares `extensions`+`skills` (package-relative); `files:` whitelist ships both. |
| `skills/sdd/` | 4-phase Spec-Driven Dev + TiCoder (Plan→Spec→Impl-Plan→Code+Test, approval between phases). Artifacts use **`.sdd/{type}_{slug}_{DDMMYYYY}.md`** (plan/spec/tasks/verify) so multiple runs coexist as history; `server.js /api/plan-state` globs `.sdd` and returns `{phase,slug,date,rel,mtime}` newest-first (legacy fixed names like `plan.md`/`verify-report.md` still match for back-compat). Discovered via `pi.skills` manifest (ships + auto-discovered); `/skill:sdd`. A **right workspace-tools rail** (`#toolsbar`) shows the **latest active** set's **phase stepper** (`● reached / ○ pending`, current in accent; the rail hides once a set reaches `verify`, at which point the skill archives the set's files into `.sdd/archive/`) — compact by default, click a reached phase to expand its doc as rendered markdown (state persists in `localStorage`); todos + quota usage live **only** in their own rail widgets (the in-flow todo panel and header usage bar were removed — W1 moved them fully into the rail). Advisory only (size gate lives in the `description`). |
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
- `policy-engine.js` + `bash-classifier.js` — **THE policy engine** (zero-dep
  CommonJS, shared with `server.js` — the page/Explain can never diverge from the
  gate): verdict `{action,tier,matchedRule,layer,reason}` with provenance;
  precedence hard-deny → mandatory-ask → remembered-grant → ordinary-ask → allow;
  layered config (floor → user → workspace, tighten-only; **object tool
  tables union per key floor⊕user** — a user's existing table must not
  wholesale-shadow floor allows/denies); v2 schema with
  `revision`/`mode`/`sensitivePaths`/`grants`; canonical paths + sensitive-path
  mandatory-ask/deny on every path tool **and every bash selector's path tokens**
  (GOTCHAS #23 — `bashSensitiveFor` + `partCanonTokens`: `cat .env` can't ride
  the verb allowlists); outside-workspace access capped at
  ask in every non-yolo mode (path tools + bash parts, FR-6); `applyMode`
  (default/auto-approve/read-only/session-yolo); compound-bash classification
  - FR-9 per-subcommand gating; read-only recon verbs allow-ruled by VERB in
  the floor (safe: the argument-aware classifier still gates every mutation —
  `sed -i`/`find -delete`/`awk 'system()'`/`env rm`/`sort -o` never ride the
  rules). 56 + 18 unit tests.
- `safeguard.ts` — **Per-tool allow/ask/deny gate** on every tool call, now a thin
  shell over the engine + classifier. Config `~/.pi/agent/safeguard.json` +
  workspace layer `<cwd>/.pi/safeguard.json` (re-read each call). Modes: default /
  auto-approve / read-only (persisted) + **yolo** (session-only, confirm-gated,
  never persisted). "Allow always" writes an exact-selector `grants` entry
  (rule-based allows are bound by the compound gate). Emits a `safeguard`
  `setStatus` provenance context before every blocking select. Commands:
  `/safeguard` · `reset` · `mode yolo` · `revoke <n>`.
- `webui.ts` — `/webui` + `/webui-stop`. Spawns `server.js` detached with
  `PI_WEBUI_NO_SWITCH=1` (the IDE owns the cwd → switching + the workspace list
  are off in the panel); kills the whole tree (POSIX process group / Windows
  `taskkill /T`).
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
| app.js module-scope state, the ~26 closure `let`s; **top-level eval order (TDZ abort kills the script)** | 8, 19 |
| sessions, `switch_session`, crash restart, multi-tab | 9 |
| Windows Git subprocesses, `PATHEXT`, local `git.js` collision, `gitExecutableForPlatform` | 18 |
| workspace switch (`/api/workspace`, `workspace_changed`, `#wsbar`), `PI_WEBUI_NO_SWITCH` | 4, 9 |
| security: CSRF, DNS-rebinding, `validateLink`, body cap | 10 |
| asset load order, markdown-it / md.js / highlight, vendor whitelist; **new `public/*.js` module: STATIC entry + IIFE + guarded exports** | 11, 20 |
| workspace-tools rail, `#toolsbar`, `rail.js`, `pi:rail`, narrow sheet, parity cleanup | 24 |
| `esc()` HTML escaper, shadowing/drift | 12 |
| assistant text/thinking streaming, `finalizeBubble`, `message_end`, render bugs | 13 |
| subagent live view, `partialResult.details`, density toggle | 14 |
| settings + permissions in-shell pages, mode chip, model/thinking/pony + tier selects | 15 |
| outside-workspace containment cap (path tools + bash), `outside-workspace` tier | 21 |
| pi-subagents async fleet: file bridge (`subagents.js`, control inbox), `#fleet` page, subagent notices | 22 |
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
- **Awaitable RPC is additive to fire-and-forget.** `POST /api/cmd` + the SSE
  `response` stream (what the smuggle channels depend on) are unchanged. Added
  `rpcRequest()` + `POST /api/rpc` (awaits pi's `{type:"response"}` keyed by id,
  30s timeout) and `GET /api/snapshot` (the bootstrap RPCs fanned out in
  parallel — one round-trip; returns `{state, messages, commands, models, stats,
  liveEvents}`). The JSONL reader broadcasts every payload to SSE **and then**
  resolves any pending awaitable (`resolveRpc`) — so smuggle ordering
  (tool_execution_start before its sibling response) is structurally preserved.
  `rejectAllRpc` on pi exit fails pending fast (plan 0.2 / F§5.1). Also:
  `jsonl.js` codec (F§4.5), centralized `killPiTree` (F§4.7),
  `WorkspaceFileError`/`readWorkspaceFile` off `safePath` (F§4.8).
- **Live-event buffer + compaction-aware history (plan 5).** `livebuf.js`
  (`createLiveBuffer()`) keeps the CURRENT agent turn's events (agent_start→…,
  cleared on agent_end) tagged with a monotonic `sequence` attached to every
  broadcast wrapper; `/api/snapshot` includes them as `liveEvents` so a
  reconnecting tab replays them through `handle()` (after `applyMessages`
  clears) and rebuilds in-flight tool cards instead of losing them. Survives a pi
  CRASH (buffer lives in Node); cleared on workspace switch (`lb.clear()` in both
  deliberateRestart paths). `session-entries.js` (`activeSessionMessages`):
  `/api/snapshot` derives `messages` from `get_entries` (parent-chain walk from
  `leafId`), not flat `get_messages` — compaction entries render as a synthetic
  `role:"custom"` marker so a compacted session never looks truncated. A
  SUPERSET of `get_messages` (no regression for non-compacted sessions). Client
  finalizes dead turns (idle pi + partial buffer → synthesized `agent_end` +
  run-state tool cards neutralized) and renders compaction markers as a muted
  collapsible `<details>`.

## Manual smoke tests (quick sanity)

- **Editable transcript diff** — ask for a small edit; edit the right pane →
  Apply → file updates, button reads `Applied ✓`.
- **Permission-modal preview** — trigger an edit/write needing approval; modal
  shows a read-only old|new hunk diff. No diff = `tool_execution_start` didn't
  carry `args` (or the tool isn't `edit`/`write`) → `curToolArgs` empty (GOTCHAS.md #7).
- **Health** — `GET /api/health`; SSE at `GET /api/events`; commands via
  `POST /api/cmd`; awaitable RPC at `POST /api/rpc`; one-shot bootstrap at
  `GET /api/snapshot` (`node test/rpc-sse.test.js` covers the additivity).
  `node test/jsonl.test.js` covers the JSONL codec; `test/livebuf.test.js` the
  reconnect buffer; `test/session-entries.test.js` the compaction walk.
- **Live reconnect replay (5.1)** — mid-turn, kill the pi child (not Node): the
  tab rebuilds the in-flight tool card from `liveEvents` (no full reload). A pure
  SSE drop (tab sleep) with pi still running continues the turn seamlessly.
- **Compaction (5.2)** — resume a compacted session: the transcript shows muted
  collapsible "Context compacted" markers between turns (not a silent gap); the
  pre-compact messages pi dropped from `get_messages` are gone but the marker
  records the boundary.
- **Session analysis (4.2–4.4)** — open the workspace-tools rail's Usage
  widget (or the "session usage" command): cost-per-turn bars, token/cache
  breakdown, tool + failed-call ranked lists (click a bar/turn → scroll to it).
  Each assistant turn shows a muted mono
  `cache-miss · cache-read · output · $cost` strip beneath it. `node
  test/session-analysis.test.js` covers the math.
- **Git rail (4.5/4.6)** — open the workspace-tools rail's Git widget (or
  the "git status" command): branch, changed files (+/− counts, status badges),
  unpushed commits; click a file → colored diff. Commit (message modal) /
  Push / Discard-all are confirm-gated. Scoped to
  `PI_CWD`; `node test/git.test.js` covers the porcelain parsers.
- **Image input (4.10)** — paste or drag-drop an image into the composer;
  thumbnail strip with remove buttons; sends as compressed JPEG base64 (max 4).
  Blocked with a warning if the selected model's `input` lacks "image".
- **Improve prompt (4.7/4.8)** — write a draft, pick Clarify/Ideate/Precise from
  the "✎ Improve…" dropdown → the draft is rewritten by a disposable cheapest-model
  pi (~seconds) and replaced. Spawns a separate `~/.pi/pi-webui-isolated` profile.
- **Rename session (4.9)** — Alt+K → "rename session" → `set_session_name`; the
  name persists (4.1 reader picks up `session_info`) and shows in both lists.
- **Subagent fleet (pi-subagents plugin)** — Alt+K → "subagent fleet" (or
  `#fleet`): background runs with state chips, current tool/turns, per-step +
  run log tails; click a row → the steer bar targets it (Enter sends); stop is
  confirm-gated. Async completions arrive LIVE as notice cards
  (`✓ worker · completed · 1m 5s`) instead of being invisible until reload.
  `node test/subagents.test.js` + `test/subagents-ux.test.js` cover the file
  bridge + renderers.
