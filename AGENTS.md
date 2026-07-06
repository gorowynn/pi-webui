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

**pi-webui** — a **minimal-dependency** web UI for
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
| `index.html` | Markup only. Inline refs to `style.css` + `vendor/highlight.css` + `vendor/markdown-it.min.js` + `md.js` + `vendor/highlight.min.js` + `app.js` (load order matters: markdown-it → md.js → highlight.min.js → app.js). |
| `style.css` | All styling. Ayu-Dark palette — see [docs/design.md](docs/design.md). |
| `md.js` | **Thin shim over vendored markdown-it** + the `esc()` HTML escaper. ~45 lines: `md(markdown)` delegates to a configured markdown-it 14.x (`html:false`/`breaks:true`/`linkify:true` + `target=_blank` on links); `esc(text)` stays (project-wide source of truth). Same globals + `require`-able export as before. The hand-rolled ~790-line parser is gone (2026-07-06). Loaded AFTER `vendor/markdown-it.min.js`. |
| `app.js` | The entire frontend (vanilla JS). SSE handling, rendering, modals, diffs, commands palette. Uses `md()` + `esc()` globals from md.js. |
| `vendor/` | **Vendored 3rd-party runtimes**, both static assets via the `server.js` `STATIC` whitelist (no npm, no build): **markdown-it** (`markdown-it.min.js` v14.1.0 UMD, 124 KB — sets `window.markdownit`; `md.js` is its shim) and **highlight.js** (`highlight.min.js` v11.11.1 common build + `highlight.css` github-dark). `app.js` `highlightCode()` post-processes `pre code` blocks `md.js` emits; both gated so a missing/removed asset degrades silently (md.js → escaped text; hljs → uncolored code). |
| `docs/` | Durable specs: [`design.md`](docs/design.md) (UI/UX, visual source of truth) and [`README.md`](docs/README.md) (index + SSOT charter). |
| `extensions/pi_minimal_webui/` | The pi extension shipped with the package. See below. |
| `package.json` | `keywords:["pi-package"]` makes it `pi install`-able. `pi` manifest declares `extensions` + `skills` (both package-relative); `files:` whitelist ships both to npm. |
| `skills/` | Shipped skills. Currently `sdd/` — strict 4-phase Spec-Driven Development + TiCoder (Plan→Spec→Impl-Plan→Code+Test, explicit approval between phases). Discovered via the `pi.skills` package manifest (same path the extension uses), so it ships with the repo AND is auto-discovered — no settings entry beyond the existing local-path package. `/reload` picks up edits; invoke with `/skill:sdd`. Skill-only = advisory (no gate backs it); the size gate lives in the `description` (the one field always in context). |
| `jetbrains/` | **Standalone Gradle plugin** (separate project — the webui's zero-build invariant is preserved). Embeds the webui panel in a JetBrains tool window via JCEF, plus a **native IDE diff approval gate** for edit/write: the proposed change opens in the IDE diff viewer; the 4-button decision (safeguard labels — a wire contract) flows back via the existing `extension_ui_response` channel; `safeguard.ts` is **unchanged**. Depends only on `com.intellij.modules.platform` → runs in any JB IDE. See [`jetbrains/README.md`](jetbrains/README.md); build `gradlew buildPlugin`, install the zip via Settings → Plugins → ⚙ → Install from Disk. |

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
    SSE backpressure (drops stalled clients), markdown-it `html:false` (raw HTML
    escaped) + built-in `validateLink` (blocks `javascript:`/`data:`/`vbscript:`
    hrefs), 1MB body cap. Don't regress these.

11. **Load order: `vendor/markdown-it.min.js` → `md.js` → `vendor/highlight.min.js` → `app.js`.** `md.js` is now a thin SHIM over vendored markdown-it 14.x (UMD, sets `window.markdownit`) — it keeps `esc()` (project-wide HTML-escaping source of truth) and delegates `md()` to a configured markdown-it (`html:false`, `breaks:true`, `linkify:true`; links get `target=_blank rel=noopener noreferrer`). So markdown-it MUST load before md.js. app.js calls `md()`/`esc()` as globals set by md.js's IIFE. All three (`md.js` + both vendor files) are served via the `server.js` `STATIC` whitelist. md.js is still `require`-able in Node (exports `{md, esc}`; the shim resolves markdown-it via the `markdownit` global, else `require('./vendor/markdown-it.min.js')`); exercise with `node -e "const{md}=require('./md.js');console.log(md('**x**'))"`. `app.js` `highlightCode(cur.bubble)` runs at the end of `renderAssistantContent` — the single chokepoint for hljs (gotcha #13). The `vendor/` dir holds the project's vendored 3rd-party runtimes (markdown-it + highlight.js — see File map).
12. **`esc()` is shared, not duplicated.** It lives ONLY in `md.js` (static entity map, null-safe). app.js has ~40 call sites that use the global. Don't re-add a local `esc` to app.js — it would silently shadow and drift (the old copy returned `"null"` for null input; the shared one returns `""`).
13. **Assistant text + thinking both stream LIVE, then finalize from pi's
    AUTHORITATIVE message.** (`app.js`: `scheduleRender`→`renderText`/`renderThink`
    per rAF during deltas; `finalizeBubble(payload.message.content)` at
    `message_end` is the authoritative re-render; `renderAssistantContent` is
    shared with `renderMessage`/reload.) History: md used to render broken
    *sometimes* live but always fine after reload. The decisive 2026-06-24 fix
    was rendering from `message_end`'s full final `message` (`agent-session.js`
    relays it — the SAME object pi persists and returns via `get_messages`), not
    browser-re-accumulated `text_delta`s (LOSSY/CORRUPTIBLE in SSE: dropped/
    merged deltas → missing words; stripped spaces/parens/digits → words jammed).
    **2026-07-06: text streaming was RE-ENABLED** (markdown-it replaced the
    hand-rolled parser — see md.js file-map row). Safe now because: markdown-it
    renders partial input as its literal/partial form (unclosed fence/emphasis/
    link → literal text), so the live view is "incomplete" not "broken"; and the
    `message_end` finalize still re-renders from authoritative
    `payload.message.content`, so a transiently-wrong live token self-corrects
    (the old bug STAYED broken until reload; this is momentary). `finalizeBubble`
    clears the bubble + RESETS per-block cursors (`textPar`/`thinkEl`/…) so
    re-render creates fresh nodes. Thinking streams live via `renderThink` (now
    `md()`, not `textContent`) and is re-rendered finalized at `message_end`.
    **If text ever looks wrong persistently** (not just mid-stream), it must ALSO
    be wrong after reload (same authoritative input); if not, suspect
    `payload.message` absent/empty at `message_end` — the `cur.content` fallback
    would kick in and reintroduce the old symptom.
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
16. **JetBrains plugin (`jetbrains/`) build bootstrap is version-pinned** — every
    version below cost a failed build, so they are load-bearing: IntelliJ Platform
    Gradle Plugin **2.7.0** + Foojay resolver **1.0.0** (older →
    `JvmVendorSpec IBM_SEMERU` on Gradle 9); Kotlin **2.4.0** (older →
    `IllegalArgumentException: 25.0.3` — the Kotlin daemon runs on the Gradle JVM,
    Rider's default JDK 25, and older Kotlin's bundled parser can't read "25");
    `instrumentCode = false` (the platform's instrumentation task throws
    `Packages does not exist` on the JDK 25 Gradle JVM; it only injects
    `@NotNull` checks, not load-bearing — re-enable when building on JDK 21);
    `DiffContentFactory` lives in `com.intellij.diff` (NOT `.contents`, where
    `DiffContent` is). `local()` builds against the auto-detected installed IDE
    (folder with `product-info.json`; override `RIDER_HOME` / `-PriderHome`) —
    no hardcoded path, no IntelliJ Community download. Full detail:
    [`jetbrains/README.md`](jetbrains/README.md) "Build notes".
17. **Don't try to build `jetbrains/` from the pi agent's git-bash** —
    `./gradlew` crashes the shell (0xC0000005 on the `java` exec); every
    `BUILD EXIT=0` is a silent no-op, and `build/` reflects the user's Rider
    build, not the agent's. Build in Rider (or a real terminal). Verify Kotlin
    APIs you're unsure about with `javap` (`~/.jdks/ms-25.0.3/bin/javap.exe
    -classpath "<rider>/lib/*"`), not by running gradlew. The webui side IS
    testable here (`node --check app.js` + greps). Current plugin diff-gate
    surface: the real-file diff (`DiffContentFactory.create(proj, text,
    fileType)` over a resolved `VirtualFile` — highlighted, reads the open
    editor) + the IDE-connection badge (plugin injects `window.piWebuiIdeInfo` →
    app.js `sb-ide` statusbar cell: green IDE name when hosted, dim `none`
    standalone).

## RPC coverage (verified 2026-06-23)

Checked `app.js`/`server.js`/extensions against
<https://pi.dev/docs/latest/sdk> + <https://pi.dev/docs/latest/rpc>. Nothing
to change — don't re-audit without a pi version bump.

- **Use RPC, not the SDK.** The SDK docs cover `createAgentSession()` /
  in-process `AgentSession`; we deliberately use `pi --mode rpc` (subprocess)
  instead — it keeps the minimal-dependency constraint, the process isolation,
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
