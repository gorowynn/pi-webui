# Adopting from pi-livecraft into pi-webui

> Source audited: `D:\Repository\pi-livecraft` (v1.1.0, commit as of 2025-08-06).
> Target: this repo (`pi-webui`, zero-build, minimal-dependency, vanilla JS).
> Status: **analysis only** — no code changed.

---

## 0. TL;DR

pi-livecraft is a **different species of project**: React 19 + Vite + TypeScript + npm, ~35
dependencies, an "app you fork and modify while you use it." pi-webui is a **zero-build,
single-file-server, vanilla-JS** harness whose hard constraint is *no bundler / no
`npm install` at runtime*.

So we do **not** adopt its stack, its framework, or its three-process Vite architecture.
What we *can* adopt falls into three tiers:

| Tier | Meaning | Candidates |
|---|---|---|
| 🟢 **Direct port** | Pure algorithm/logic in a single file, no deps, maps onto vanilla JS. Ship as-is (ported). | Session-snapshot bundling · `pi-session-store` head/tail reader · session-analysis math · git porcelain parser · tool-call presentations · run-isolated-prompt · JSONL decoder/encoder · cross-platform process-tree kill · path-traversal guard |
| 🟡 **Concept + design** | The idea is great; port the *contract*, reimplement the surface. | Guarded/restartable process model · per-turn usage attribution · tool-presentation registry · composer slash-command + image + improve-prompt UX · prompt-template save · session rename · recent-session recovery · directory picker · quotas-via-extension |
| 🔴 **Do not adopt** | Fights a hard constraint, or duplicates something we already do differently/better. | React/Vite/TS stack · 3-process manager/supervisor/backend split · `ws`/npm runtime deps · its `ask_user_question` shadowing (we already shadow it) · its todo extension (we have one) · dprint/husky/oxlint toolchain |

The single highest-leverage adoption is **porting the RPC-await model + session-snapshot
endpoint** (🟢). It is the foundation that makes 4 other green-tier items cheap. Read §5
first if you only read one section.

---

## 1. What pi-livecraft is

| | |
|---|---|
| **Shape** | React 19 SPA (Vite) + a Node **backend** (HTTP+SSE) + a **separate manager** process that owns every `pi --mode rpc` child, supervised by a third process. |
| **Stack** | TypeScript ESM, ~10 runtime deps (react, react-dom, react-markdown, remark-gfm, react-syntax-highlighter, @radix-ui/react-select, `diff`, `yaml`), ~12 dev deps (vite, tsc 6, oxlint, dprint, husky). **Node ≥24.** |
| **Philosophy** | Explicitly a *fork-and-drift* starter ("forks are expected to drift away from upstream"). Docs are written for agents to consume. |
| **Pi integration** | Same as ours: `pi --mode rpc` over stdin/stdout JSON Lines, public RPC only. Two pi extensions ship in-repo. |
| **Ports** | manager `43120`, backend `43121`, frontend `5173` (Vite). |

### Process model (the headline architectural idea)

```
Browser (React) ──HTTP+SSE──▶ backend.ts ──JSON Lines/TCP──▶ manager.ts ──public RPC──▶ pi
                                  ▲                              ▲
                                  │                              │ guarded restart only (exit code 75)
                                  │                          supervisor.ts
                          manager-runtime-monitor.ts (watches file SHA)
```

The **manager is the sole owner of `pi` children** and lives **outside** the backend's
restart domain. The supervisor computes a SHA-256 of the manager's runtime files; when they
change, the backend reports `stale` but does **not** restart. Restart happens only when (a)
the user requests it and (b) the manager confirms no work is active. It then closes its Pi
children and exits `75`, which the supervisor treats as "spawn a replacement."

**Why it matters to us:** pi-webui currently spawns `pi` *inside* `server.js` and respawns
on crash with a backoff. A workspace switch tree-kills `pi` and respawns in a new cwd
(`server.js:247`). There is **no** isolation between "backend restart" and "Pi process
death" — they are the same event. See §6.1.

---

## 2. Side-by-side: capabilities today

| Capability | pi-webui (current) | pi-livecraft |
|---|---|---|
| **RPC dispatch model** | Fire-and-forget: `POST /api/cmd` writes to pi's stdin, returns `ok:1` **immediately** — caller never sees the RPC response (`server.js:812`). Response data only arrives via later SSE `response` events (`app.js:3478`). | **Awaitable**: manager forwards the RPC command and resolves the HTTP response with Pi's `{type:"response"}` payload. `POST /api/sessions/:id/commands` returns Pi's data directly. |
| **Session bootstrap** | 5 separate fire-and-forget RPCs on connect (`get_state`, `get_messages`, `get_commands`, `get_available_models`, `get_session_stats`) — each answered later by a `response` event matched by `id` (`app.js:3429-3432`). | **One** `GET /api/sessions/:id/snapshot` returns `{state, messages, models, commands, promptTemplates, stats, liveEvents}` in a single round trip. |
| **Live event replay** | On `pi_ready`/reload, client re-asks `get_messages` and rebuilds; live-only state (in-flight tool timings) is lost across reconnect. | Backend keeps a per-session `LiveSessionEvents` buffer (current-turn only) tagged with a monotonic `sequence`. Snapshot includes `liveEvents`; client replays only events newer than its last-applied sequence. |
| **Compaction** | Not handled — a compacted session loses earlier messages from `get_messages`. | `activeSessionMessages()` walks `entries` parent-chain from `leafId`; compaction entries render as a synthetic `custom` message so the transcript never appears truncated. |
| **Parallel sessions** | One active session per workspace; sidebar lists *history* sessions but only one is "live." Switching = `switch_session` RPC. | Manager pools **up to 3 live Pi processes per workspace**, reusing an idle (>3 min) process via `switch_session`/`new_session`. Sessions survive browser refresh. |
| **Usage / cost** | `get_session_stats` → cost + tokens + contextUsage, shown in status bar. Per-turn attribution: none. | Same stats, **plus** per-message usage parsing (`message-usage.ts`), per-turn cost, per-tool-call duration measured client-side, full `analyzeSession()` reconstruction → interactive graphs. |
| **Quotas** | Client-side fetch to z.ai / codex / opencode usage endpoints with user-supplied keys (`/api/zai-usage`, etc.). | Server-side via a pi **extension** that uses Pi's stored OAuth (`ctx.modelRegistry.getProviderAuth` + credential read) for OpenAI Codex + GitHub Copilot. Cached, refresh-on-demand through an idle session. |
| **Git** | None. | Full: status, per-file + per-commit diffs, commit, push, reset (latest), revert, discard (file or all). Pure `git` porcelain parsing. |
| **Terminal launch** | None. | Cross-platform: WT/Alacritty/WezTerm/Powerhell/cmd on Windows; `x-terminal-emulator` on Linux; `wt.exe`/`explorer.exe` via wslpath on WSL. |
| **Todos** | **Extension-side** `todo` tool + `discipline.ts` gate (the agent owns/updates the list). | **Browser-side** workspace todos (`/api/todos`), persisted per cwd, can morph into a real session. |
| **Ask-user-question** | Shadowed extension routing via `ctx.ui.input` (blocking latch) + `tool_execution_start` smuggle. | Shadowed extension with a **versioned JSON protocol**, TUI variant (select/input loops) **and** a Livecraft editor-bridge variant; structured `questions[]` with `multiSelect`. |
| **Subagent** | Tiered `subagent` tool (single/parallel/chain), live view in tool box, sidebar tier editor. | Not present. |
| **SDD skill** | 4-phase skill + right-rail stepper, archived on verify. | Not present. |
| **Editable transcript diff** | Editable right-pane diff with LCS, Apply writes the file. | Edit-diff is read-only presentation only (no Apply). |
| **Permission modal** | Read-only old|new diff preview before approving a tool. | Generic dialog protocol (select/confirm/input/editor). |
| **Prompt improvement** | None. | "Improve" dropdown (Clarify/Ideate/Precise) → runs the draft through a **disposable, tool-free Pi process** with a shallow `<project_map>`, returns a rewritten draft + cost. |
| **Run isolated prompt** | None. | `runIsolatedPrompt()` — disposable `pi --mode rpc --no-tools --no-extensions --no-session` with its own `~/.pi/livecraft-isolated` profile (copies `auth.json`/`models.json`), auto-picks cheapest model. |
| **Tool presentations** | Inline render in tool box (subagent view, edit diff). One-off per tool. | **Registry**: `bash`/`read`/`edit`/`write`/`find`/`grep` each get a `ToolCallPresenter` (header detail, pending detail, output rendering). HTML/SVG/Markdown/CSV render inline with source toggle. |
| **Composer** | Textarea + mode/model/thinking/pony selects + send/stop/compact. | + slash-command autocomplete, image paste (model capability-aware), prompt-template insert/preview/save, steer-vs-followUp behavior toggle, context%-with-threshold coloring, session stats bar. |
| **Session rename** | None. | `set_session_name` via a disposable process; validated 1–120 chars. |
| **Recent sessions** | Workspace discovery from folder names + newest jsonl `{type:"session"}.cwd`. | Scans Pi session dir, reads **only head+tail** of each jsonl (never the multi-GB middle), filters by cwd, sorts by activity. |
| **Themes** | dark + paperlike, switchable. | Editable 8-color base (light/dark), agent-craftable. |
| **Tests** | `node:assert` unit, no framework. | `node --test`, ~40 files incl. a real-Pi RPC integration test + an LLM eval for doc-routing. |

---

## 3. Architectural comparison & invariants

### pi-webui invariants (must preserve)
- **Zero build step** — no bundler/transpile/`npm install` at runtime. `public/*` edit + refresh.
- **CommonJS `server.js`**, Node 18+, `http` + `child_process` only.
- **Fire-and-forget RPC** with SSE `response` echo (load-bearing for the current smuggle channels — GOTCHAS #1,#2,#6).
- **Single process** owns `pi` (server.js `startPi`), crash-backoff respawn, deliberate-restart on workspace switch.
- Stock `ask_user_question` is **already shadowed** (tool name = wire contract, GOTCHAS #3).

### pi-livecraft invariants (its own; informative)
- Manager is sole Pi owner; backend never spawns Pi.
- Frontend talks to backend **only** via `src/api.ts`.
- App listens only on `127.0.0.1`.
- SHA-tagged runtime → stale-then-guarded-restart.
- Versioned payloads cross the extension↔browser boundary (`shared/`).

### Where the two designs genuinely diverge (can't be "ported")
1. **Stack.** React/Vite/TS vs vanilla JS. Cannot adopt without breaking the zero-build invariant.
2. **Process split.** Their manager-is-separate design is *why* HMR works. We have no HMR and no build, so the split buys us nothing except complexity. **Do not split.**
3. **Awaitable RPC.** This *can* be added to our single-process server (§5) — and it's the keystone — but it coexists with the existing fire-and-forget path (used by the smuggle channels), it does not replace it.

---

## 4. Adoption candidates, ranked

### 🟢 Tier 1 — Direct ports (pure logic, single-file, no new deps)

#### 4.1 `pi-session-store.ts` → head/tail session reader *(HIGH VALUE, LOW EFFORT)*
`server/pi-session-store.ts` (≈230 lines). Reads **only the first 64 KB and a backward-scanned
tail** of each `.jsonl` to recover `{id, cwd, name, updatedAt, firstPrompt}` — never parsing
multi-GB middles. Respects `PI_CODING_AGENT_SESSION_DIR`/`PI_CODING_AGENT_DIR` before the default.

- **Why adopt:** Our `workspaces.js` `discoverWorkspaces` reads the newest jsonl's header to
  recover `cwd`. The livecraft reader is strictly more capable (name, prompt, activity time,
  any-count recent) and already handles the realpath/path-escape guard. It would let us list
  *recent sessions per workspace* (which we currently can't) cheaply.
- **Port effort:** ~1 day. Pure `node:fs/promises`, CommonJS-friendly. Drop the
  `loadPiSession` realpath-vs-sessionDirectory guard into our existing `safePath`.
- **Risk:** None. Additive endpoint `GET /api/sessions/recent?cwd=...`.
- **Files to touch:** new `recent-sessions.js`; `server.js` route; `workspaces.js` can defer.

#### 4.2 Session-analysis math *(HIGH VALUE, MED EFFORT)*
`src/features/session-analysis/session-analysis.ts` (≈300 lines) + `message-usage.ts`. Pure
functions: given `messages[]` + `stats`, reconstruct **requests** (user→assistant turns),
**turns**, **tool calls** (with input/output char lengths, error/pending flags, durations),
and roll up totals: `totalCost`, `averageTurnCost`, `medianTurnCost`,
`averageToolCallsPerTurn`, per-tool summaries, token/cache breakdown, context%.

- **Why adopt:** This is livecraft's flagship. We already capture per-tool start/end times
  in `app.js` (`toolStartedAtRef` equivalent is ad-hoc) and call `get_session_stats`, but we
  do nothing with per-message usage. Porting the math gives us a usage/cost **panel** with
  clickable "jump to turn" — in vanilla JS via a small `<canvas>` or even HTML bars.
- **Port effort:** ~2 days (math is straightforward; the UI is the work).
- **Risk:** Low. The parser keys off the public message contract (`role`, `content[].type`,
  `toolCallId`, `usage`). Verify our message shapes match (they should — same RPC).
- **Bonus:** `buildSessionAnalysisPrompt()` produces a bounded JSON snapshot + French prompt
  for an LLM "analyze my session" action — reusable as a one-shot via §4.6.

#### 4.3 Git porcelain parser *(HIGH VALUE, MED EFFORT)*
`server/features/git/git.ts` (≈300 lines). `getGitSnapshot` (status porcelain -z + numstat
merge + unpushed-commits with per-file changes), per-file/per-commit diff, commit, push,
reset (latest only), revert (--no-edit), discard-file / discard-all. Excellent edge-case
handling (unborn branch, renames, untracked-vs-ignored).

- **Why adopt:** Zero-dep, pure `git` CLI spawning, exactly our style. A Git sidebar is the
  most commonly-requested missing feature.
- **Port effort:** ~2 days (parser port + sidebar UI). `runGit` is a 15-line spawn helper.
- **Risk:** Medium — mutating actions (commit/push/reset/revert/discard) need the same
  confirm-modal discipline our permission modal uses. Guard all behind `PI_CWD` realpath.
- **Scope cut:** Ship **read-only** first (snapshot + diffs), add mutations behind a confirm.

#### 4.4 Tool-call presentation registry *(MED VALUE, LOW EFFORT)*
`src/features/conversation/tool-call-presentations/` — `index.ts` is a `Record<toolName,
ToolCallPresenter>`; each presenter returns `{headerDetail, pendingDetail, outputRender}`.
Examples: `bash` puts the command in the header + timeout in status; `read` appends a line
range; `file` (edit/write) shows the path; `search` (find/grep) shows the pattern.

- **Why adopt:** Our tool-box rendering is a long `describeTool(name,args)` switch
  (`app.js:992`). A registry is cleaner and makes "render HTML/SVG/Markdown/CSV inline with
  source toggle" (their `file-preview.ts`/`csv-preview.ts`) a per-tool concern, not global.
- **Port effort:** ~0.5 day refactor. Vanilla JS: a plain object of functions.
- **Risk:** Low. Pure refactor of existing behavior; add the registry, migrate cases.

#### 4.5 `jsonl.ts` — strict JSON Lines codec *(LOW EFFORT, worth it)*
`server/jsonl.ts`: `encodeJsonLine(obj)` (JSON.stringify + `\n`) and `JsonLineDecoder`
(splits on `\n`, strips `\r`, enforces a max-record size, handles partial chunks). This is
**exactly** what our `server.js:170` inline buffer+StringDecoder loop does, but factored and
capped. We already got the StringDecoder-for-UTF8 fix (GOTCHAS #1/#2); this just formalizes
it with a record-size guard (protects against a runaway line).

- **Port effort:** ~2 hours.
- **Risk:** None; behavior-preserving. Add the size cap as a defense-in-depth.

#### 4.6 `runIsolatedPrompt` + `prompt-improvement` *(MED VALUE, MED EFFORT)*
`server/run-isolated-prompt.ts` + `server/prompt-improvement.ts` + `pi-process.ts`. Spawns a
**disposable** `pi --mode rpc --no-tools --no-extensions --no-session --thinking off
--system-prompt …` in a dedicated `~/.pi/<name>-isolated` profile dir (copies `auth.json`/
`models.json` once), auto-selects the cheapest model by sorting on `{cost.output,
cost.input, reasoning}`, runs one prompt, extracts final assistant text + cost, terminates.

- **Why adopt:** Powers "Improve prompt" and could power "Summarize/analyze session" and a
  generic "ask the cheap model" action — without polluting the active session's context.
  Reuses the cross-platform kill from §4.7.
- **Port effort:** ~1.5 days. Needs the awaitable-RPC primitive (§5) to be clean, or a
  dedicated mini-RPC loop on the disposable child.
- **Risk:** Medium. New process type in `server.js`; must terminate reliably on all paths.
  The `cheapestAvailableModel` sort and `assistantText` extractor are pure and safe.
- **Isolation:** Keep the separate profile dir idea — prevents isolated `--system-prompt ""`
  from leaking into the user's main `~/.pi/agent`.

#### 4.7 Cross-platform process-tree termination *(LOW EFFORT, HIGH VALUE)*
`server/pi-process.ts` `terminateChild`/`forceKillChild`/`taskkillProcessTree`: graceful
`SIGTERM` (POSIX) or stdin-EOF (Windows) → bounded grace → `SIGKILL` (POSIX) or
`taskkill.exe /pid <pid> /t /f` (Windows, kills the whole tree) → final settle. Plus a module
`Set` of active children + `terminateAllPiProcesses()`.

- **Why adopt:** Our workspace-switch (`server.js:247`) and `/webui-stop` already tree-kill;
  this is the canonical, well-tested version with the Windows `taskkill /T` fallback our
  `webui.ts` extension reinvents. Unifying avoids drift.
- **Port effort:** ~0.5 day.
- **Risk:** Low; behavior we already need, just centralized and bounded.

#### 4.8 `workspace-file.ts` + path-traversal guard *(LOW EFFORT)*
`server/workspace-file.ts`: `resolveWorkspaceFilePath` + `readWorkspaceFile` with a
realpath-escape guard and a `WorkspaceFileError` with HTTP status. Cleaner than our
`safePath` sprawl; same threat model (GOTCHAS #4).

- **Port effort:** ~0.5 day. Possibly fold into `server.js`'s existing `safePath`.

---

### 🟡 Tier 2 — Concept + contract, reimplement the surface

#### 5.1 **Awaitable RPC + session-snapshot endpoint** *(THE KEYSTONE)* ⭐
This is the change that unblocks the most else. Today our RPC is fire-and-forget; responses
come back only as SSE `response` events keyed by `id`. livecraft's manager forwards a command
and **resolves the HTTP response** with Pi's `{type:"response"}` payload.

**Proposed for pi-webui (single-process safe):**
- Keep `POST /api/cmd` fire-and-forget (smuggle channels depend on it).
- Add an **awaitable** path: a small request-id registry in `server.js`. `sendToPi(obj)`
  already tags `obj.id`. Register a `Promise` resolver keyed by `id`; when the JSONL reader
  sees `{type:"response", id, success, data, error}`, resolve it (with a timeout). Expose
  `POST /api/rpc` that awaits and returns the payload.
- Add `GET /api/snapshot` that fans out the 5 bootstrap RPCs in parallel and returns one
  bundled object (state+messages+models+commands+stats). One round-trip instead of five.

**Why:** halves bootstrap latency, makes snapshot/reload deterministic, and is the substrate
for §4.2 (analysis), §4.6 (isolated prompts), session rename, and any future "ask Pi a
one-off structured question" feature.
**Risk:** Medium — must not regress the smuggle channel (GOTCHAS #1/#6). Keep both paths; the
awaitable path is opt-in per call. Add a test that a `tool_execution_start` smuggle still
fires before its sibling `response`.

#### 5.2 Live-event buffer + sequence-based replay
`server/session-snapshot.ts` `LiveSessionEvents`: keeps only **current-turn** events
(agent_start→tool starts/updates), keyed, and exposes a sequenced snapshot. The client
replays only events with `sequence > lastApplied`.

- **For us:** on `pi_ready`/reconnect we currently blow away live state and re-`get_messages`.
  A server-side current-turn buffer + monotonic sequence lets a reconnecting tab rebuild
  in-flight tool cards without a full reload. Ports cleanly to our SSE model: we already
  `broadcast({source:"pi", payload})`; just add a `sequence` and buffer the turn.
- **Effort:** ~1 day server, ~0.5 day client replay.

#### 5.3 Compaction-aware message reconstruction
`activeSessionMessages(entries, leafId)` walks the entry parent-chain from the leaf and emits
compaction entries as synthetic `custom` messages so a compacted transcript doesn't look
truncated. We currently don't handle compaction at all.

- **For us:** depends on switching history rendering to consume `get_entries` (parent-chain)
  instead of flat `get_messages`. Bigger change to `renderMessage` (`app.js:2852`), so it's
  Tier 2 not Tier 1. Worth it once we adopt §5.1.

#### 5.4 Parallel/live sessions + process pooling
Manager keeps 3 live Pi children per workspace and reuses an idle (>3 min) one via
`switch_session`. Sessions survive refresh.

- **For us:** this is a **large** product shift (we're single-live-session-per-workspace).
  The pooling logic is reusable, but it presupposes the manager split we're declining.
  **Defer** unless multi-session becomes a goal. The *cheaper* win: make a reconnecting tab
  not lose the live session (§5.2) without full multi-process pooling.

#### 5.5 Composer UX additions (slash, images, improve, templates, behavior)
- **Slash-command autocomplete** (`composer-utils.ts` `isCommandDraft` + the dropdown): low
  effort, high polish. We already send `/cmd`; a filtered popover is ~100 lines of vanilla JS.
- **Image paste** (model-capability-aware, base64, capped count): `composer-images.ts`. We
  have no image input. Medium effort; needs the composer's `prompt` RPC to carry `images[]`.
- **Prompt templates** (insert/preview/save to `~/.pi/agent/prompts` or `.pi/prompts`):
  `prompt-templates.ts` + a save dialog. We expose commands but not authoring. Low-medium.
- **Steer vs Follow-up behavior toggle** while running: we already have `mode` →
  steer/followUp mapping; surface it as a running-only toggle like theirs. Trivial.
- **Improve-prompt** dropdown: depends on §4.6.

#### 5.6 Quotas via pi extension (vs our client-side fetch)
`pi-extensions/quotas.ts` + `quota-service.ts`: a pi extension publishes normalized
OpenAI-Codex / GitHub-Copilot usage through `ctx.ui.setStatus`, using **Pi's own stored
OAuth** (`getProviderAuth` + `modelRegistry.runtime.credentials.read`) — no user-pasted keys.

- **For us:** we fetch z.ai/codex/opencode client-side with user keys. The extension approach
  is more secure (no key handling in the browser) and covers Codex/Copilot without keys, but
  it's provider-specific (they only ship OpenAI + Copilot) and reaches into a semi-private
  `modelRegistry.runtime.credentials` shape. **Selective:** adopt the *pattern* (a status
  channel for provider usage) for providers where Pi holds the token; keep client-side for
  key-based providers. Not urgent.

#### 5.7 `ask_user_question` versioned protocol + multiSelect
Our shadow already routes via `ctx.ui.input`. Theirs adds: a **versioned** JSON payload
(`protocol`+`version`), `multiSelect`, and a clean `shared/ask-user-question.ts`
parser/validator. The TUI variant (select/input loops) is also nice.

- **For us:** our extension (`extensions/pi_minimal_webui/index.ts`) is simpler but less
  structured. Adopting the **versioned payload + multiSelect** is a cheap, compatible
  upgrade to our existing modal (`askQuestion`, `app.js:1904`). Don't replace our smuggle
  channel — extend the payload it carries.

#### 5.8 Session rename + directory picker
- **Rename:** `set_session_name` through a disposable process, 1–120 char validation. Trivial
  once §5.1 exists. `GET/POST /api/sessions/rename`.
- **Directory picker:** `listDirectories` returns accessible subdirs + a navigable parent.
  Powers a workspace-picker UI nicer than a text field. ~0.5 day.

---

### 🔴 Tier 3 — Do not adopt

| Item | Why not |
|---|---|
| **React/Vite/TS stack** | Breaks the zero-build invariant. The whole point of pi-webui. |
| **3-process manager/supervisor/backend split** | Solves HMR-safe Pi survival. We have no HMR and no build; the split is pure overhead here. Our single-process + crash-backoff + deliberate-restart already keeps Pi alive across the events that matter to us. |
| **Their `ask_user_question` extension** | We already shadow the tool; replacing ours would break the wire contract and our smuggle channel (GOTCHAS #3). Take only the payload schema (§5.7). |
| **Their `todo` extension / browser todos** | We have a richer agent-driven `todo` + `discipline.ts` gate. Different (better-for-us) model. |
| **`subagent` is ours, not theirs** | They don't have it. |
| **dprint / husky / oxlint / lint-staged toolchain** | Against our minimal-deps ethos. |
| **`npm install` at runtime / `concurrently`** | Hard constraint violation. |
| **Their editable diff "Apply"** | Ours is strictly more capable (editable new pane + Apply writes file). Keep ours. |
| **Eval harness (`evals/`)** | Interesting but an LLM-cost dev tool, not a runtime feature. Skip. |

---

## 5. The keystone: awaitable RPC + snapshot (deep dive)

Read this section if adopting anything from Tier 1 that needs Pi data.

### Current state (pi-webui)
```
client ──POST /api/cmd {type:"get_messages", id:"init-msgs"}──▶ server writes to pi.stdin
server returns {ok:true}   ← caller learns NOTHING about the result
…
pi.stdout ──{type:"response", id:"init-msgs", data:{…}}──▶ server broadcasts via SSE
client matches id in the SSE "response" handler (app.js:3478)
```
Five of these fire on connect. Latency = 5 RTTs of "fire, wait for SSE". No way to `await`
a single command from the client's perspective.

### Proposed (additive, non-breaking)
1. **Server-side pending map.** `const pending = new Map<id, {resolve, reject, timer}>()`.
   In `sendToPi`, if the object already has `id` and a new flag/endpoint opts into awaiting,
   register it. The JSONL reader's existing line handler, on `{type:"response", id}`:
   - still `broadcast(...)` it (smuggle channels & existing clients keep working), **and**
   - resolve/reject the matching pending entry.
2. **New endpoint** `POST /api/rpc` → `{command}` → awaits → returns `{ok, data, error}`.
   Keep `POST /api/cmd` exactly as-is.
3. **New endpoint** `GET /api/snapshot` → server issues the 5 bootstrap RPCs in parallel via
   the awaitable path → returns one object. Client does one fetch instead of five fire-then-
   wait-for-SSE.

### What this unlocks (and what each needs it)
- §4.2 analysis: client can fetch stats/messages on demand and get them back.
- §4.6 isolated prompt: the disposable child's RPCs resolve inline.
- §5.7 rename, §5.8 directory listing of sessions: trivial awaitable calls.
- §5.2 live buffer: snapshot can include `liveEvents` for clean reconnect replay.

### Guardrails
- **Never** remove the SSE `response` broadcast — the smuggle channels (ask, todo, sdd,
  subagent) and multi-tab sync depend on it (GOTCHAS #1,#6,#9).
- Timeout every pending entry (30 s default, 10 min for `prompt`/`compact`, matching
  livecraft's `request()` defaults).
- Reject on pi exit (clear all pending — livecraft's `#fail()` does this).

---

## 6. Deep dives on the other high-value items

### 6.1 Why we keep a single process (and still get most of the benefit)
livecraft's manager split exists so **Vite HMR of the frontend, or a restart of the backend,
does not kill Pi**. We have neither HMR nor a separate backend, so:
- A browser refresh already does **not** kill Pi (server.js owns the child, not the browser).
- A `server.js` restart kills Pi (same as today) — acceptable, and our crash-backoff already
  handles it.
- The one thing we *don't* get is "edit server.js and keep Pi alive" — but that's a dev-time
  convenience, and `node --watch` (which livecraft uses for `dev:backend`) would kill Pi on
  backend change too. The split only protects against **frontend** edits, which for us are
  static files served without a restart anyway.

**Conclusion:** adopt livecraft's *cross-platform kill* (§4.7) and its *guarded-restart
discipline* as a pattern (confirm-idle-before-restart for any deliberate restart), but **not**
the process split.

### 6.2 Session analysis: what to actually build
The math (`analyzeSession`) is pure and ports as-is. The interesting design choice is the UI.
Options, in increasing effort:
1. **Status-bar enrichment** — show per-turn cost + cache-hit% next to the existing cost.
2. **A "Usage" panel** (right rail or modal) — list turns with cost, click to scroll to the
   message. Pure DOM, no canvas. ~1 day after the math ports.
3. **Graphs** (their flagship) — needs a chart. To stay zero-dep, draw with `<canvas>` (≈150
   lines for a scatter/line of cost-per-turn) or inline SVG bars. Avoid pulling in a lib.

Recommend **(2)** first; graphs are a "delightful but unnecessary" tier like their confetti.

### 6.3 Git sidebar: scope the first cut
Ship read-only: `getGitSnapshot` (branch, ahead, changed files w/ +/- counts, unpushed
commits w/ files) + `getGitFileDiff`. This is ~60% of the value (review without leaving the
UI) with none of the mutation risk. Add commit/push/reset/revert/discard behind the existing
confirm-modal pattern in a second pass. All actions scoped to `realpath(PI_CWD)`.

### 6.4 Isolated prompts: the security boundary
The clever bit is the **separate profile dir** (`~/.pi/livecraft-isolated`) so an isolated
`--system-prompt ""` and `--no-tools` can never write to the user's main settings, while
still authenticating (copied `auth.json`/`models.json`). Keep this exactly. The
`cheapestAvailableModel` sort (output cost → input cost → reasoning) is a nice default we can
reuse for any "cheap model" feature.

---

## 7. Suggested roadmap (effort-ordered, dependency-aware)

| # | Item | Tier | Dep | Effort | Value |
|---|---|---|---|---|---|
| 1 | `jsonl.ts` codec + record-size cap (§4.5) | 🟢 | — | 0.25d | def-in-depth |
| 2 | Cross-platform process-tree kill, centralized (§4.7) | 🟢 | — | 0.5d | unifies drift |
| 3 | **Awaitable RPC + `/api/snapshot`** (§5) | 🟡 | — | 1.5d | **keystone** |
| 4 | Tool-call presentation registry (§4.4) | 🟢 | — | 0.5d | refactor |
| 5 | Recent-sessions head/tail reader (§4.1) | 🟢 | — | 1d | new capability |
| 6 | Session-analysis math + Usage panel (§4.2/§6.2) | 🟢 | #3 | 2.5d | flagship |
| 7 | Git sidebar, **read-only first** (§4.3/§6.3) | 🟢 | — | 2d | high-demand |
| 8 | Live-event buffer + reconnect replay (§5.2) | 🟡 | #3 | 1.5d | resilience |
| 9 | Slash-command autocomplete (§5.5) | 🟡 | — | 0.5d | polish |
| 10 | Run-isolated-prompt + Improve-prompt (§4.6) | 🟢 | #3 | 1.5d | new capability |
| 11 | Session rename + directory picker (§5.8) | 🟡 | #3 | 0.5d | polish |
| 12 | Git mutations behind confirm (§4.3) | 🟢 | #7 | 1d | completes git |
| 13 | ask_user_question versioned payload + multiSelect (§5.7) | 🟡 | — | 1d | compat upgrade |

Items 1–5 are independent and safe to land first. **#3 is the keystone** — do it before #6,
#8, #10, #11. Everything in 🔴 is explicitly out of scope.

---

## 8. Things explicitly worth copying beyond code

- **Doc structure for agents.** Their `docs/` is a routing index ("you want X → start here")
  with feature READMEs recording local contracts. Our `AGENTS.md` is denser but flatter. A
  short `docs/README.md` routing index (like theirs) would help agents land features in the
  right file. Low effort, high leverage for an agent-maintained repo.
- **"Closest contract first" exploration discipline** (their `AGENTS.md`). Their rule "the
  first repository tool call must read `docs/README.md`" is a strong pattern for keeping
  agent edits in-bounds. We already route via `AGENTS.md`/`GOTCHAS.md`; their layered
  version is worth studying.
- **Versioned payloads across the extension↔browser boundary** (`shared/`). When we extend
  ask_user_question or add any extension→browser data, tag it `{protocol, version}` and
  parse strictly in a shared module. Cheap future-proofing.
- **Focused-test naming + a real-Pi integration test.** Their `pi-rpc.integration.test.ts`
  (skips `/agent` when absent) is a model for a smoke test we lack. We have manual smoke
  tests only (AGENTS.md "Manual smoke tests").

---

## 9. Open questions to resolve before adopting

1. **Multi-session product direction?** If "yes," §5.4 (pooling) climbs the list and may
   justify a *thin* manager concept. If "no," we keep single-live-session and §5.2 (reconnect
   replay) is enough.
2. **Image input priority?** Determines whether composer image-paste (§5.5) is early.
3. **Do we want provider quotas via extension (§5.6) or keep client-side keys?** Security
   vs. provider-coverage tradeoff.
4. **Graphs for session analysis (§6.2)?** Decide canvas-vs-SVG-vs-none before building #6.

---

## 10. File-by-file reference (what to read when porting each item)

| Adopt | Read in pi-livecraft |
|---|---|
| §4.1 recent sessions | `server/pi-session-store.ts` |
| §4.2 analysis | `src/features/session-analysis/session-analysis.ts`, `src/features/conversation/message-usage.ts`, `tool-protocol.ts`, `tool-presentation.ts` |
| §4.3 git | `server/features/git/git.ts` (+ `shared/types.ts` Git* types) |
| §4.4 presentations | `src/features/conversation/tool-call-presentations/*` |
| §4.5 jsonl | `server/jsonl.ts` |
| §4.6 isolated prompts | `server/run-isolated-prompt.ts`, `server/prompt-improvement.ts`, `server/pi-process.ts` |
| §4.7 process kill | `server/pi-process.ts` (`terminateChild`/`forceKillChild`/`taskkillProcessTree`) |
| §4.8 path guard | `server/workspace-file.ts` |
| §5.1 awaitable rpc | `server/manager.ts` (`requestPi`/`handleRequest`/`#pending`), `server/pi-process.ts` (`request`/`#receive`) |
| §5.2 live buffer | `server/session-snapshot.ts` (`LiveSessionEvents`) |
| §5.3 compaction | `server/session-snapshot.ts` (`activeSessionMessages`) |
| §5.5 composer | `src/features/composer/*` (esp. `composer-utils.ts`, `composer-images.ts`, `prompt-title.ts`) |
| §5.6 quotas ext | `pi-extensions/quotas.ts`, `server/features/quotas/*`, `shared/quota-parsers.ts` |
| §5.7 ask payload | `shared/ask-user-question.ts`, `pi-extensions/ask-user-question.ts`, `src/features/dialogs/dialog-protocol.ts` |
| §6.4 isolated profile | `server/run-isolated-prompt.ts` (`ensureIsolatedAgentDir`), `server/pi-process.ts` (`ISOLATED_AGENT_DIR`) |

---

*Prepared as an analysis document only. No source files in this repository were modified.*
