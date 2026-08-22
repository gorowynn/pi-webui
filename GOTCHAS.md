<!-- markdownlint-disable MD013 MD060 -->

# GOTCHAS.md — pi-webui

The full conventions & gotchas, kept out of `AGENTS.md` (which is auto-loaded
by pi every session) to save context. `AGENTS.md` holds a **keyword index**
that points here by number.

**Read the matching entry before editing the area it covers** — these are
load-bearing invariants that cost real time (or security) when violated.
Numbering is stable and is referenced as `GOTCHAS.md #N` from `AGENTS.md` and
`CHANGELOG.md`. When you learn a new gotcha, add it here **and** add its
keyword to the index in `AGENTS.md`.

1. **`follow_up` is snake_case on the wire** (`"follow_up"`, not `"followUp"`;
   `streamingBehavior` is the separate camelCase field). app.js maps
   `followUp`→`follow_up` in `send()`. Source of truth:
   `dist/modes/rpc/rpc-types.d.ts`.
2. **Never `readline` for framing** — it splits on Unicode line separators that
   are valid inside JSON strings. The bridge splits on `\n` only.
3. **`ASK_MARKER` has one source of truth: `server.js`** → exports
   `process.env.PI_WEBUI_ASK_MARKER` (read by the extension) + injects
   `window.__PI_ASK_MARKER` (read by app.js); both keep a standalone fallback.
   If you change it, change all three + run the round-trip self-check.
4. **`safePath` must use `fs.realpathSync`**, not `path.resolve` (resolve does
   *not* follow symlinks). Resolve both base and target (resolve the existing
   parent for not-yet-existing write targets) or a symlink inside `PI_CWD` aimed
   at `~/.ssh` slips through.
5. **`api()` attaches a no-op `.catch`** — fire-and-forget callers
   (refreshStats, init, buttons) never throw unhandled, awaited callers (send)
   still get rejections. Keep the pattern for new fire-and-forget fetches.
6. **Diff LCS guards at 4M cells** — skip the O(n·m) path above that to avoid
   locking the UI. Manual Apply bails on non-unique hunks.
7. **Permission-modal diff preview reads `curToolName`/`curToolArgs`**
   (`renderEditDiffPreviews`) — snapshot at `tool_execution_start`, cleared at
   `tool_execution_end`. No diff = start didn't carry `args`, or the tool isn't
   `edit`/`write`. Tool boxes + previews render from `tool_execution_*` only
   (`toolcall_*` is intentionally unhandled).
8. **Mutable top-level closure state in app.js** (~26 module-scope `let`s:
   `cur`, `curToolName`/`curToolArgs`, `streaming`, `pinned`, `lastScrollTop`,
   `todos`, `askId`, `pendingAskArgs`, `compacting`, `commands`,
   `currentModelId`, `curSessionFile`, `modalFree`, `palSel`/`palItems`,
   `lastThinkPaint`, `renderRaf`, `lastActivity`, `lastFocus`,
   `availableModels`, `subagentDensity`, 3 interval handles, …). Fine at this
   size; it's the one to watch before adding more (see AGENTS.md open work).
9. **One live pi session at a time** (shared process across tabs); the
   **⏱ Sessions** button (`GET /api/sessions` + `switch_session` RPC) swaps it
   to a past session file and repaints via `get_messages`/`get_state`.
   Multi-tab/concurrent sessions = later. On crash the bridge restarts after
   1s (exponential backoff).
10. **Security baseline (don't regress):** CSRF + DNS-rebinding gate on POSTs,
    SSE backpressure (drops stalled clients), markdown-it `html:false` (raw
    HTML escaped) + `validateLink` (blocks `javascript:`/`data:`/`vbscript:`
    hrefs), 1MB body cap.
11. **Load order: `vendor/markdown-it.min.js` → `md.js` →
    `vendor/highlight.min.js` → `app.js`.** markdown-it MUST load before md.js
    (its shim). All three are served via the `server.js` `STATIC` whitelist.
    `highlightCode(cur.bubble)` runs at the end of `renderAssistantContent` —
    the single hljs chokepoint.
12. **`esc()` lives ONLY in `md.js`** (static entity map, null-safe→`""`).
    app.js has ~40 call sites using the global. Don't re-add a local `esc` to
    app.js — it would silently shadow + drift (the old copy returned `"null"`
    for null input).
13. **Assistant text + thinking stream LIVE, then finalize from pi's
    AUTHORITATIVE message.** `scheduleRender`→`renderText`/`renderThink` per
    rAF during deltas; `finalizeBubble(payload.message.content)` at
    `message_end` is the authoritative re-render (`renderAssistantContent`,
    shared with `renderMessage`/reload). Live view self-corrects because
    markdown-it renders partial input as literal/partial form and the
    `message_end` finalize re-renders from authoritative
    `payload.message.content`. **Diagnostic: if text looks wrong persistently
    (not just mid-stream) it must ALSO be wrong after reload** (same
    authoritative input) — if not, suspect `payload.message` absent/empty at
    `message_end`, where the `cur.content` fallback would reintroduce the old
    symptom. (History of the live-streaming fix/re-enable is in CHANGELOG.)
14. **Subagent live view reads `partialResult.details`, not `.content`.** The
    `subagent` tool streams its whole state
    (`{mode, results:[{agent,model,turns,exitCode,messages,usage}]}`) via
    `onUpdate`→`partialResult.details`; `agent-session.js` forwards
    `partialResult` whole on every `tool_execution_update`. `app.js`
    `renderSubagentView` renders details at start/update/end. **Density** is a
    sidebar toggle (`pi:sa-density`): `full` = child calls + text, `compact` =
    status + calls.
15. **Settings + permissions are in-shell utility PAGES**, not drawers/overlays
    (design.md §4): `<section id="settings">` and `<section id="permissions">`
    are flex children of `body` that replace the center transcript/composer
    column while open — `body.page-open` (set/cleared by `openSettings`/
    `closeSettings`/`openPermPage`/`closePermPage`) hides `#scroll-wrap`,
    `#todopanel`, `footer`, and `.activity`; the shell header stays. Shared
    chrome: `.perm-head` (sticky title bar) + `.perm-body` (centered 900px).
    ⚙ opens, ✕/Esc closes; opening one page closes the other. Model/thinking/
    pony selects keep their IDs → existing `onchange` unchanged.
    `subagentDensity` = module-scope `let` set from its select.
    The **composer mode chip** (`#mode-chip` in `.bar`) shows the active
    permission posture at all times: persisted modes via `GET
    /api/permissions/mode` piggybacked on `refreshStats`, yolo via the
    extension's `setStatus("safeguard", {mode})` broadcast (session-only — a
    config read can never see it; safeguard.ts broadcasts on yolo engage and
    `session_start`). The page's **rules editor** mutates a clone of the USER
    layer only (`applyRule`/`removeRule` in permissions-ux.js; floor is
    locked, the workspace layer is tighten-only and edited via its own file) —
    every write goes through the same revision-checked `PUT
    /api/permissions/config` as the mode select. `buildLayerTree` shows the
    HIGHEST-priority layer's action for a rule (not the last-written one).
16. **JetBrains plugin build is version-pinned (load-bearing):** IntelliJ
    Platform Gradle Plugin **2.7.0** + Foojay resolver **1.0.0**; Kotlin
    **2.4.0**; `instrumentCode = false`. `DiffContentFactory` lives in
    `com.intellij.diff` (NOT `.contents`, where `DiffContent` is). `local()`
    builds against the auto-detected installed IDE. **Why each pin matters +
    full build notes: [`jetbrains/README.md`](jetbrains/README.md).**
17. **Don't build `jetbrains/` from pi's git-bash** — `./gradlew` (the sh
    wrapper) crashes the shell (0xC0000005 on the `java` exec); every
    `BUILD EXIT=0` is a silent no-op and `build/` reflects the user's Rider
    build, not the agent's. **What DOES work from git-bash (2026-08-15):**
    `cmd.exe /c <bat>` with `JAVA_HOME` set to the Rider JBR — write a `.bat`
    (`set "JAVA_HOME=C:\Program Files\JetBrains\JetBrains Rider 2025.1.1\jbr"`
    + `call gradlew.bat test`) and run `MSYS_NO_PATHCONV=1 cmd.exe /c
    run-test.bat < /dev/null` (the `/c` needs `//c` or `MSYS_NO_PATHCONV=1`;
    stdin must be redirected or cmd just prints a banner). The JBR has NO
    `javap` — use `C:/Program Files/Microsoft/jdk-11.0.27.6-hotspot/bin/
    javap.exe -classpath "<rider>/lib/*"` for API checks. The webui side IS
    testable here (`node --check app.js` + greps). Plugin diff-gate surface:
    the diff renders as a **CENTER editor tab in the main IDE window** (not
    a floating `DialogWrapper`) — `DiffReviewEditorProvider` (`plugin.xml`:
    `HIDE_DEFAULT_EDITOR`+`DumbAware`) builds `DiffReviewEditor` over an
    in-memory `DiffReviewFile` (`LightVirtualFile` carrying payload + the
    decision callback); native diff uses `DiffContentFactory.create`/
    `createEditable` over a resolved `VirtualFile`; decision buttons come
    from the payload's offered `options` (SEC-07; four-label fallback for
    old-webui payloads); a decision closes the tab, a tab-✕/close fails
    closed → `Deny` via `dispose()`; stale-file allows are blocked until
    "Re-read file" re-bases the diff (SEC-17b). A user-edited proposal yields
    bridge value `{label, oldFull, newFull}`; `safeguard.ts` then mutates
    pi's `event.input` (`write`→`content`, `edit`→`edits=[{oldText,newText}]`)
    so pi applies the user's version — the standalone webui modal does the
    same via `mountEditableDiff`. The bridge resolves through an id-keyed
    `window.__piDiffResolvers` map (`payload.requestId`; malformed JSON →
    immediate Deny, SEC-17a). Pure helpers + tests: `DiffBridge.kt`/
    `DiffBridgeTest.kt`. `javap` facts: `LightVirtualFile` is
    `com.intellij.testFramework.*` but ships in `intellij.platform.core.jar`
    (runtime-available — constructs fine in plain JVM tests);
    `FileEditorProvider`/`FileEditorManager`/`FileEditorPolicy` are in
    `intellij.platform.analysis.jar`; `JBCefJSQuery` implements `Disposable`
    (`Disposer.register`-able); `CefClient.removeLoadHandler()` takes NO
    argument; `DiffRequestPanel` is `Disposable`.
18. **Never invoke bare `git` from this repository on Windows.** Windows command
    resolution searches the working directory before `PATH` and commonly has
    `.JS` in `PATHEXT`, so local [`git.js`](git.js) shadows Git for Windows and
    launches through the user's JavaScript file association. A polled synchronous
    call then blocks the HTTP server and reopens the file whenever the editor
    exits. Use `gitExecutableForPlatform()` (`git.exe` on Windows) with argument
    arrays and no shell. That only protects bridge-owned calls: at server boot,
    `sanitizeWindowsPathExt()` must also remove `.JS` from the inherited
    `PATHEXT` so spawned pi, extensions, language servers, and tools cannot make
    the same collision.
19. **app.js top-level statements run during script evaluation — a TDZ
    `ReferenceError` aborts the WHOLE script, silently killing everything after
    the throw point** (no `initWsbar` → `body.ws-on` never set → the left
    sidebar is off-canvas and "gone"; no later `registerCommand` calls; SSE
    handlers attached EARLIER fire and throw too). Symptom:
    `Cannot access 'X' before initialization` at eval. Rule: never call
    `registerCommand(...)`/any function before the `const`/`let` it touches is
    declared (`const uiCommands = []` lives in the command-palette section;
    `let noSwitch` in the left-sidebar section). When reordering sections in
    a reformat, grep top-level call sites vs. their declarations.
    **Cousin bug — biome const-demotion (2026-08-22 fleet incident):** biome's
    auto-fix demotes `let x = null` to `const x = null` when the assignment
    lives far from the declaration; for module-scope state assigned later
    (`fleetBadgeCounts`, also `anMetric`/`anShownAll`/`anSelected` during the
    usage-tab work) the first poll throws `Assignment to constant variable` —
    and when that assignment sits inside a swallowed catch (`refreshFleet`),
    the surface just goes blank/stuck-loading forever with a clean console.
    Rule: module-scope `let x = null` state assigned in a distant function
    gets a source-contract test (`/^let x = /m`, see the fleetBadgeCounts
    check in `test/subagents-ux.test.js`), and never let a silent `catch {}`
    wrap render code — log it.
20. **A new `public/*.js` feature module needs THREE things or it fails in the
    browser while Node tests pass:** (a) a `server.js` `STATIC` whitelist entry
    (missing → silent 404, no JS error — the "explain failed: …
    'explainView'" bug); (b) dual-mode exports guarded with
    `if (typeof module !== "undefined" && module.exports)`; (c) the whole file
    wrapped in an IIFE — a top-level `const api`/`const mod` in a classic
    script leaks into the global lexical scope and collides with app.js's own
    `function api` (SyntaxError at the LATER script, breaking every page).
    House pattern: [`public/diff-view.js`](public/diff-view.js).
21. **Outside-workspace access is capped at ask in EVERY non-yolo mode** (FR-6
    containment, 2026-08-10 hardening): path tools (read-class) whose
    canonical path escapes the workspace root get tier `outside-workspace` in
    `buildVerdict` — rule allows are demoted to ask, and `applyMode` refuses
    to lift it (auto-approve only lifts `ordinary-ask`; read-only's read-class
    auto-allow skips the tier). write/edit outside root stay hard-deny.
    **Bash**: `partPathTokens` extracts path-like args per subcommand;
    `gateBash(…, isOutside)` marks the command `outside` if any part touches
    an outside path, and safeguard.ts blocks the auto-approve/read-only
    mode-bypass for outside commands (yolo is the ONLY exemption — explicit
    session override). Grants (exact-selector) still win — they're explicit
    per-action approvals. `isOutsidePart` lives in BOTH safeguard.ts and the
    server.js explain endpoint (realpath-aware, `~`/`$HOME`/`$PWD` expansion,
    cwd join) so the page can't diverge from the gate. Named ceiling: no shell
    parser — `$(…)`-built and `$VAR`-prefixed paths are invisible.
    Headless (`nonInteractive=allow`) can't prompt — the nonInteractive knob
    governs there.
22. **pi-subagents async fleet is a FILE bridge, not an RPC one.** The plugin's
    TUI widget/fleet views (`ctx.ui.setWidget`, `/sfleet`) never cross RPC —
    so the webui reads the plugin's on-disk artifacts instead: temp roots
    `<tmp>/pi-subagents-*/async-subagent-runs/<id>/status.json` via `subagents.js`.
    Step logs: `output-<i>.log` when the run mode writes one, ELSE the child
    transcript in the PROJECT-LOCAL `<run cwd>/.pi-subagents/artifacts/
    <childRunId>_<agent>_<i>_transcript.jsonl` (correlated by the child run id in the step's
    `sessionFile` `…\<childRunId>
un-0\session.jsonl` = artifact filename
    prefix — DETERMINISTIC; ts-proximity is only the fallback, it
    cross-matches same-agent children spawned near-simultaneously; regex-extract
    the first record `ts` — fork-context prompts make line 1 exceed any
    JSON.parse head). Run log: `subagent-log-*.md`, else
    formatted `events.jsonl`. Workflow steps carry NO `index` — the step-log
    button encodes ROW POSITION, and `steps[n]` is the lookup key., and
    STOP/STEER by writing the plugin's portable control inbox
    (`control/stop.json`, `control/steer-requests/<padded-ts>-<b64url>.json`,
    atomic temp+rename, envelope `{type,id,ts,message,source:"pi-webui"}`).
    STOP IS GRACEFUL — it waits for children to reach an abort boundary and
    can park forever on a hung LLM call; "force" writes `timeout.json` (the
    runtime-cap path — kills children decisively). The listing projects
    `stopRequested` (stop.json present + run still active) → "stopping" chip +
    the button relabels to "force stop". CEILING (seen live): the inbox is
    consumed by the run's control watcher; if the spawning parent stopped
    consuming (dead watcher / dead runner), stop/steer/force files sit unread
    and children leak — last resort is killing the child pid from
    `status.json` manually (the webui deliberately does NOT kill pids).
    **Never rename those filenames/envelopes without checking
    `node_modules/pi-subagents/src/runs/background/control-channel.ts`** — the
    runner watches them. Run ids are validated (`^[A-Za-z0-9][A-Za-z0-9._-]*$`)
    AND must resolve to a discovered dir (no traversal); `dir` is stripped
    before the client payload. Frontend: `#fleet` in-shell page (`#fleet` hash,
    2s poll, logs cached in `fleetLogs` so re-renders don't clobber open ones);
    notices = custom messages with customType `subagent-notify` /
    `subagent_steering_notice` / `subagent_control_notice` — rendered by
    `renderNoticeMsg` from BOTH `message_end` (live) and `renderMessage`
    (reload), which is also why generic custom messages now render live
    (parity). Hash-close guards: each page only clears its OWN hash (closing
    fleet mid-navigation to #permissions must not wipe that route). New
    `public/*.js` module rule (#20/#11) applied to `subagents-ux.js`.

23. **Bash selectors get sensitive-path protection via tokens, not paths.** FR-7
    sensitivePaths used to apply ONLY to path selectors (read/write/edit +
    path-shaped grep/find/ls/glob) — a bash command like `cat .env` or
    `grep -r KEY .env.local` matched the verb allow-regexes and sailed through
    auto-approve/read-only unguarded. The gate now computes a per-call
    `bashSensitive` override: `bash-classifier.js partCanonTokens` (expand
    `~`/`$HOME`/`$PWD`, cwd-join, realpath — the logic that used to live
    duplicated as `isOutsidePart` in `safeguard.ts` AND the `server.js` explain
    route, both now one-liners over it) feeds `policy-engine.js
    bashSensitiveFor`, and `resolve()` honours `opts.bashSensitive` for bash
    selectors (also wired into `/api/permissions/explain` so the page can't
    diverge). Effect: `.env`/`.pem`/key patterns inside the workspace get the
    same mandatory-ask/hard-deny as the `read` tool; deny beats ask; a
    sensitive hit anywhere in a compound blocks the WHOLE command (gate.allow
    false in every mode except yolo). Benign recon (`grep x public/style.css`)
    resolves null and auto-allows exactly as before.

    **Config foot-gun: a user bash table with `"*": "ask"` and no verb
    allowlist SHADOWS the floor's read-only verb regexes at the PER-PART gate.**
    Layers resolve user-first, and the user table's own `*` catches every part
    before the default layer's `re:^(cat|grep|…|cd)(\s|$)` allows are ever
    consulted — so `cd … && grep …` asks in auto-approve even rooted in the
    workspace. The floor⊕user key-union keeps the KEYS, but layer order wins.
    Safe (ask only, never loosens), but prompts. Migration: a v1-era user bash
    table should adopt the floor's anchored verb regexes (see
    `DEFAULT_CONFIG.bash` in `policy-engine.js`); the user config at
     `~/.pi/agent/safeguard.json` (rev 5) is migrated — don't regress it.

24. **The workspace-tools rail is one persisted, focus-contained surface.**
    `#toolsbar` owns the fixed SDD/Analysis/Git/Quotas/Todos table; Permissions
    is a launcher, not a widget. `localStorage["pi:rail"]` is canonical for
    `{widget,open,width}`; `pi:sddbar` and `pi:rail-width` are migration inputs.
    In `w-mid`/`w-narrow`, the active panel is a bottom sheet with dialog
    semantics and a document-level Tab/Escape guard that must restore the rail
    trigger. Do not reintroduce modal detail routes or Git/token/cost header
    duplicates after parity is verified; action-specific confirmation modals
    (such as Git commit) remain allowed.
