# CHANGELOG — pi-webui

> Running history, newest first. Moved out of [`AGENTS.md`](AGENTS.md) so the
> orientation doc stays lean. One entry per meaningful chunk of work:
> `### YYYY-MM-DD — <area>: <one-line summary>` then bullet detail (what + why + file).

## Changelog

### 2026-07-21 — feat(ui): detached `pi-webui` launcher + workspace-switch lock + sidebar polish

- **Detached launcher (`bin.js`):** `pi-webui` now spawns `server.js` in its own
  process group, so **closing the terminal/console no longer kills the webui** —
  the server (and the `pi --mode rpc` child it owns) keep running after the
  launcher exits. It polls a temp log to report an early death (port in use, pi
  spawn failure), opens the browser, then exits. New `PI_WEBUI_NO_OPEN` skips the
  auto-open (headless/IDE). (`node server.js` standalone is unchanged.)
- **Workspace-switch lock (`PI_WEBUI_NO_SWITCH`):** a new env flag (1/true/yes)
  disables project switching — `POST /api/workspace` → 403 and `/api/health`
  advertises `noSwitch`, which hides the `#wsbar` Workspaces section entirely
  (Sessions stays). The IDE `/webui` extension now sets it by default (the IDE
  owns the cwd); standalone `pi-webui` leaves switching on.
- **Sidebar UX:** the `#wsbar` collapse/expand buttons (≪/≫) moved to the
  vertical center of the edge (were top-aligned).
- **Files:** `bin.js`, `server.js`, `app.js`, `style.css`,
  `extensions/pi_minimal_webui/webui.ts`, `AGENTS.md`.
- **Verified:** `node --check` on all JS. (Live detachment + 403 smoke returned
  no output in this harness — worth a 10s manual confirm.)

### 2026-07-21 — feat(ui): workspace sidebar + SDD rail relocated to the right

- **What:** persistent left sidebar (`#wsbar`) listing every project pi has run
  in (auto-discovered from session storage) with one-click switching, plus the
  active project's session history (resume without the footer modal). The SDD
  phase rail moved left→right (Task 5 was already in place; verified + its stale
  "left edge" CSS comment fixed). Left = navigation, right = run context — the
  two rails now flank the transcript on opposite edges.
- **Why:** pi-webui bound to one `PI_CWD` (server-start fixed) and showed history
  only in a disposable footer modal; switching projects meant restarting the
  server. The sidebar makes both a single click from the chrome. Spec-driven:
  `.sdd/{plan,spec,tasks,verify}_workspace-sidebar_21072026.md`.
- **How:** new `workspaces.js` (pure — `discoverWorkspaces` scans
  `~/.pi/agent/sessions/--<cwd>--/` subfolders and recovers each project root
  from the newest `.jsonl`'s `{type:"session"}.cwd`, **not** the encoded folder
  name; `isKnownWorkspacePath` gates switches to realpath-matches only).
  `server.js` `PI_CWD` became `let`; `POST /api/workspace` validates →
  `switchWorkspace` mutates it, tree-kills pi, and the exit handler respawns
  immediately in the new cwd (skipping crash backoff) + broadcasts
  `workspace_changed` to all SSE clients. `app.js` resyncs on that event and
  renders the sidebar; `safePath`/sessions re-derive off the live `PI_CWD`.
  Collapsible per-rail (`localStorage`), edge launcher re-opens, auto-collapses
  <720px.
- **Security:** the switch endpoint accepts **only** a realpath-match of a
  discovered workspace — never an arbitrary path — so `safePath`'s sandbox can't
  be pointed outside a known project root. CSRF + DNS-rebinding gate unchanged.
- **Verified:** `node test/workspaces.test.js` (T1.1–T1.8 green); real-data
  discovery (6 workspaces, correct active); boot smoke (`GET /api/workspaces` 200,
  bogus `POST /api/workspace` 400, `Host:evil.com` 403, page serves both rails);
  `node --check` on all JS. Browser-only flows (multi-tab broadcast,
  click-switch, collapse persistence, mid-stream abort) are the manual smoke
  matrix in the verify report.
- **Zero-build intact:** no new deps; plain edits + one CommonJS module + one
  `node:assert` test.
- **Files:** `workspaces.js`, `test/workspaces.test.js` (new); `server.js`,
  `app.js`, `index.html`, `style.css` (edits).

### 2026-07-21 — feat(bin): `pi-webui` standalone launcher (no pi TUI needed)

- **What:** added a `bin.js` launcher + `package.json` `bin` entry, so
  `npm i -g pi-webui` exposes a `pi-webui` command that starts the server (which
  spawns its own `pi --mode rpc`) and auto-opens the browser — no need to start
  pi or type `/webui`. Equivalent to `node server.js` + browser open.
- **Why:** the webui already spawns its own pi (`server.js` owns the subprocess),
  so it never required pi *running* — only the ergonomics were missing (no global
  command; `PI_CWD` defaulted to the shell cwd). The launcher closes that gap.
- **How:** `bin.js` `require()`s `server.js` in-process (it reads `PORT`/`PI_BIN`/
  `PI_ARGS`/`PI_CWD` from env and listens), then opens the browser after a 400ms
  delay (reusing the `openBrowser` logic from `webui.ts`). `Ctrl-C` kills the
  whole tree because pi is an in-process child (same process group), unlike the
  detached `/webui` spawn which needs `killTree`.
- **Limit (pre-existing, separate P0):** `package.json` `files` still omits
  `app.js`/`style.css`/`vendor`, so a global install ships a broken UI until that
  is fixed (tracked in `docs/improvements.md`). The bin entry itself is correct.
- **Verified:** `node --check bin.js`; runtime smoke on PORT 4399 printed the
  `pi-webui on http://127.0.0.1:4399` ready line, then clean tree-kill.
- **Files:** `bin.js` (new); `package.json` (`bin`, `files`, description);
  `AGENTS.md` (run/dev).

### 2026-07-21 — feat(webui): SDD phase rail replaces the header plan badge

- **What:** the header `plan-badge` + its modal plan/spec viewer are replaced by
  a persistent **left rail** (`#sddbar`). While an active (non-`verify`) SDD set
  exists, the rail shows the 4-phase stepper vertically (`plan`→`spec`→`tasks`→`verify`,
  `●` reached / `○` pending, current in accent); phases without an artifact yet are
  dimmed/disabled (nudges the next phase). Clicking a reached phase expands the
  rail into a pane that renders that doc as markdown (via `md()` + `highlightCode()`);
  clicking it again or the `×` collapses back to the rail. Expanded state + the
  open doc persist across reloads (`localStorage["pi:sddbar"]`). No SDD set → the
  rail is fully hidden (`display:none`, out of the a11y tree).
- **Why:** requested — surface the active SDD step as a small always-on sidebar
  instead of a header pill, expand on demand to read the doc, and keep todos out
  of it (they stay in `#todopanel`).
- **How:** `position:fixed` left rail; `body.sdd-on`/`.sdd-open` set `margin-left`
  so the whole in-flow app (header, transcript, composer, statusbar) shifts right
  in unison — nothing floats on the left, so there are no collisions, and the
  width/margin use `min(400px,58vw)` to self-limit on narrow screens. Reuses the
  existing `activeSet`/`planSets`/`setSummary`/`renderPlanDoc`; drops the now-dead
  `updatePlanBadge`, `openPlanViewer`, `planDocTabs`, `todosAsMarkdown`,
  `stepperHtml`, `todoActive`, and `PHASE_NEXT`. `/api/plan-state` is unchanged.
- **Files:** `index.html` (drop `#plan-badge`; add `#sddbar` aside); `style.css`
  (`.plan-pill`/`.sdd-stepper`/`.doc-tabs` → `#sddbar`/`.sdd-rail`/`.ss-step`/
  `.sdd-pane`/`.sdd-head`/`body.sdd-on*`); `app.js` (`updateSddBar`/`openSddPhase`/
  `closeSddPane`/`initSddBar`); `AGENTS.md` (skills/sdd row).

### 2026-07-21 — docs: add cross-cutting improvements audit

- **What:** added a prioritized audit grouped by visuals, performance, and
  features/reliability, including the smallest practical fixes and a recommended
  implementation order.
- **Why:** preserve the review as durable project knowledge while keeping
  `docs/roadmap.md` authoritative for detailed feature proposals.
- **Files:** `docs/improvements.md`; `docs/README.md`.

### 2026-07-21 — fix(webui): modal diff scroll broken; editable textarea collapsed to ~2 rows

- **What:** in the edit/write approval modal the editable proposal pane (right
  column) didn't scroll and its scrollbar sat wrong over the text.
- **Why:** the modal textarea used `height: 100%`, but the height chain upward
  is all `max-height` (indefinite), so the percentage never resolved and the
  textarea fell back to its ~2-row default. That shrunken textarea scrolled
  independently of the full-height highlight layer behind it (scroll desynced)
  and its scrollbar rendered in the wrong place. The left (read-only) pane was
  fine because it is flex-sized, not percentage.
- **Fix:** `.sx-edit` is now a flex column and the modal `.sx-ta` sizes with
  `flex: 1 1 auto` instead of `height: 100%`, so it fills its column like the
  left pane and the two scroll in sync. Transcript (non-modal) diff unchanged
  (textarea keeps its fixed 300px).
- **Files:** `style.css` (`.sx-edit` flex column; `#modal .sx-ta` flex sizing).

### 2026-07-21 — docs: mark roadmap theme item shipped; drop stale latest_review.md

- **What:** `docs/roadmap.md` #11 (theme settings) → **SHIPPED** (obsidian +
  paperlike); fixed dead "Ayu-Dark" refs (default removed 2026-07-17) + the
  ranking table. Deleted `docs/latest_review.md` (its two P0s — missing
  `package.json` runtime assets + safeguard allow-before-deny — still hold
  against live code, but a fresh review will supersede it). `docs/README.md`
  index updated accordingly.
- **Files:** `docs/roadmap.md`; `docs/README.md`; `docs/latest_review.md` (deleted).

### 2026-07-17 — feat(webui): "obsidian" modern dark theme (new default); ayu-dark removed

- **What:** replaced the legacy **ayu-dark** default with **obsidian** — a modern dark design: near-black canvas (`#0a0a0b`), **glassy overlays** (translucent panels + `backdrop-filter: blur` on the settings sidebar, modal card, and activity bar), a faint violet **hero gradient** at the top of the canvas, and **soft violet accent glows** on the live status dot, primary Send, and jump-to-bottom pill. Rounder corners (`--r` 2→8px) and a glow-carrying card shadow. Accent shifted warm-orange→violet `#8b5cf6`, with blue/emerald/amber/rose supporting tones. `paperlike` stays as the alternate. Theme list is now **obsidian · paperlike**.
- **Why:** asked to add a dark theme and make it look modern; the chosen direction (previewed) was the near-black + glass + glow aesthetic (Arc / Linear hero vibe). ayu-dark was removed at the user's request, so obsidian became the default rather than a third option.
- **How:** `:root` now IS the obsidian palette (default, no attribute needed for color); obsidian's decorative layer (gradient/glass/glow) gates on `[data-theme="obsidian"]` so it can't leak into paperlike. The inline `<head>` script now **always** sets `data-theme` (obsidian default) so the decorative layer applies on first paint, and migrates a stale `pi:theme="ayu"` to obsidian; `app.js` mirrors that. Because obsidian is itself a dark theme, the existing dark hardcoded colors (`#0009` code bg, `.tool` overlay, github-dark `.hljs`, the thinking-block purples, the diff light-on-dark labels) needed **no** overrides — only the vars + decorative rules. The `--shadow` token changed from `none` to a violet-glow shadow (paperlike still overrides to its warm soft shadow).
- **Migration:** any prior `localStorage["pi:theme"]` of `"ayu"` collapses to obsidian in both the head script and `app.js`; users keep their theme, just remapped.
- **Files:** `style.css` (`:root` rewrite + `[data-theme="obsidian"]` decorative layer); `index.html` (theme `<select>` now obsidian+paperlike; head script always-sets + migrates); `app.js` (default/migration); `docs/design.md` (§1 default→obsidian, §5 list + mechanics); `AGENTS.md` (file-map).

### 2026-07-17 — feat(webui): switchable "paperlike" design (color + shape + type)

- **What:** a second, switchable design alongside the default ayu-dark. "paperlike" is warm cream paper + dark ink, **serif prose** (system serifs only — zero-build invariant kept), **softer corners** (`--r` 2→6px) and **subtle drop-shadows** on cards instead of hard borders, light code listings, and a GitHub-Light-ish syntax palette. Toggled from a new **appearance** section in the settings sidebar; choice persists in `localStorage` and is applied before first paint (no FOUC).
- **Why:** requested as a genuinely different design, not a flat color swap — so shapes (radius/borders/shadows), typography (mono chrome vs serif transcript), and the code/thinking/diff surfaces all adapt, not just the palette.
- **How:** everything keys off CSS custom properties. A `--shadow` token (`none` dark / soft shadow paper) was added and applied to the base `pre`/`.think`/`.tool` rules (zero visual change for dark). The `[data-theme="paperlike"]` block overrides the vars + the few hardcoded colors that wouldn't adapt (`pre`/`.tool` backgrounds, the thinking-block purples, the diff light-on-dark labels) and re-tints `.hljs` tokens since `vendor/highlight.css` ships GitHub-Dark. An inline `<head>` script sets `<html data-theme>` from `localStorage` pre-paint; `app.js` keeps the `<select>` in sync and persists on change (mirrors the `pi:sa-density` idiom).
- **Skipped (ponytail):** no layout restructure (a centered max-width "sheet" transcript is a nicer paper metaphor but risks the flex layout — add later if wanted); the handful of low-alpha accent tints (`#ff9f43xx` etc.) keep the bright-orange base since they're near-invisible and keep all themes consistent. Chrome (header/footer/sidebar/modal) intentionally stays mono so the conversation reads as a document in a tool frame.
- **Files:** `style.css` (`--shadow` token + base box-shadow; `[data-theme="paperlike"]` block); `index.html` (appearance `<select>` + anti-FOUC head script); `app.js` (theme-select wiring); `docs/design.md` (theme section).

### 2026-07-17 — fix(server): missing static asset crashed the whole server (ERR_HTTP_HEADERS_SENT)

- **What:** A `GET` for a whitelisted `STATIC` asset whose backing file was missing threw `ERR_HTTP_HEADERS_SENT` and killed the **entire** `server.js` process (taking every SSE client down with it). Root cause: the handler did `res.writeHead(200, …)` **before** `fs.readFileSync(…)`, so an ENOENT fell into the `catch`, which then tried `res.writeHead(404)` on a response that had already sent its 200 status line.
- **Fix:** read the file **first**, then commit the 200 — if the read throws, no headers are sent yet and the `catch` can emit a clean 404. A bad asset request now degrades gracefully instead of crashing the process.
- **Trigger:** `usage-provider.js` was deleted from the working tree (`git status: D`) but still registered in `STATIC`, loaded by `index.html`, and required by `test/usage-provider.test.js` — so every page load hit the crash path. Restored the file from git (deletion was accidental; a deliberate removal would also strip the `<script>` tag, `STATIC` entry, and test).
- **Verified:** `node test/usage-provider.test.js` passes; simulating the exact failure (missing `vendor/highlight.css`) now returns `404` with the server staying alive (next request `200`).
- **Files:** `server.js` (STATIC handler, read-before-writeHead); `usage-provider.js` (restored).

### 2026-07-17 — feat(sdd): reinforce the plan/spec workflow + `{type}_{slug}_{date}.md` naming

- **What:** SDD artifacts now use `.sdd/{type}_{slug}_{DDMMYYYY}.md` (plan/spec/tasks/verify, e.g. `.sdd/plan_usage-tracking_17072026.md`) instead of fixed `plan.md`/`spec.md`/…, so multiple efforts coexist as history. The header pill badges the **latest active** set's current phase (+ slug) and the viewer gains a **phase stepper** (`● reached / ○ pending`, current in accent) that nudges the next missing phase.
- **Why:** reinforce usage of the SDD workflow — the badge now signals *what's relevant* (a set is finished once it reaches `verify`; todo only while unfinished) and the viewer makes the progression visible. Asked-and-answered scope: skill+docs **and** UI reinforcement; latest-active in badge, full history in viewer.
- **How:** `server.js /api/plan-state` globs `.sdd/*.md` and parses `{type}_{slug}_{8-digit-date}` (+ legacy fixed names incl. `verify-report.md` back-compat), returning `{phase,slug,date,rel,mtime}` newest-first. `app.js` groups artifacts into sets (`slug|date`), `activeSet()` picks the newest non-`verify` set for the badge, `planDocTabs()` lists all as history, and `stepperHtml()` renders the per-set progression above the doc body. Naming adopted in `skills/sdd/SKILL.md` (Phase 1 picks slug+date, reused verbatim) + a "when to use" directive; `AGENTS.md` file-map row updated.
- **Files:** `skills/sdd/SKILL.md`; `server.js` (`/api/plan-state`); `app.js` (`planSets`/`setSummary`/`activeSet`/`updatePlanBadge`/`planDocTabs`/`stepperHtml`/`openPlanViewer`); `style.css` (`.sdd-stepper`/`.ss-step`); `AGENTS.md`.

### 2026-07-16 — feat(webui): highlight + enlarge the editable approval diff

- **What:** the editable approval modal (edit/write, when not using the IDE diff) now renders the same syntax-highlighted, diff-colored side-by-side as the transcript diff, instead of two plain `<textarea>`s. The right pane stays editable (tweak pi's proposal before approving); the captured edit goes back via the permission response, so nothing is written to disk until you choose Allow.
- **How:** `mountSideBySide` gained a `capture` option (omits the Apply button + `applyEdit` disk-write; keeps the transparent-textarea overlay + live re-highlight). `mountEditableDiff` now delegates to it and reads `.sx-ta`'s value. The modal call passes `payload.path` so the diff highlights by language.
- **Sizing:** modal diff height raised from ~440–460px to `min(72vh, 720px)`; the old modal-only `.sx-edit` textarea rules (which would have clobbered the transparent `.sx-ta` overlay and broken `.sx-edit`'s positioning) were dropped in favor of a matching `#modal .sx-ta` height rule. The wide card already spans up to 96vw.
- **Files:** `app.js` (`mountSideBySide` capture option, `mountEditableDiff`, `openSelectModal`); `style.css` (modal diff heights, dropped dead textarea rules).

### 2026-07-16 — feat(webui): syntax-highlight the edit/write diff view

- **What:** the side-by-side edit/write diff (transcript + permission-modal preview) now renders code with the vendored highlight.js (GitHub-Dark), matching the JetBrains IDE diff. Each side is highlighted as a whole file (so multi-line tokens — block comments, strings — stay correct), then split into per-line HTML with open `<span>`s rebalanced at every newline.
- **Why:** the diff plumbing already carried `hlOld`/`hlNew` params and "live re-highlight" comments, but no highlight call was ever wired in, and per-line `.sx-ltxt` text-color overrides would have masked it anyway — so the webui diff read as flat monochrome text next to Rider's native diff.
- **Visibility:** diff line backgrounds raised from ~10% to ~20% alpha; the per-line red/green *text* tint was dropped so syntax colors show on changed lines (gutter number + background keep the add/del cue).
- **Editable pane:** `compute()` re-highlights on every input, so the editable new pane now truly live-highlights (the comment was aspirational before).
- **Files:** `app.js` (`splitHtmlLines`/`highlightLines`/`langOf`, wired into `rowsToSides`/`sideHtml`/`mountSideBySide.compute`); `style.css` (diff backgrounds + dropped `.sx-ltxt` overrides).

### 2026-07-16 — fix(usage): pair each quota window with its reset

- Header quota cards are compact side-by-side panels; every window returned by
  ChatGPT retains its own remaining allowance bar and reset countdown.

### 2026-07-16 — feat(usage): show ChatGPT/Codex subscription quota

- **What:** `openai-codex` now uses its authenticated ChatGPT usage endpoint. The header shows remaining short-window quota and time until reset; the modal includes both available rate-limit windows.
- **Security:** `server.js` reads the OAuth access token only from pi's existing `auth.json` and keeps it server-side.
- **Fallback:** if ChatGPT changes or rejects the undocumented endpoint, the quota bar hides and the usage modal reports the request failure; session token reporting remains for unsupported providers.

### 2026-07-16 — feat(usage): match the active model provider

- **What:** `app.js` now shows z.ai quota only for z.ai models. ChatGPT/Codex and other providers show pi RPC session input, output, cache-read, cache-write, and total tokens instead.
- **Limit:** ChatGPT subscription allowance is not exposed by pi RPC, so the UI directs users to their provider account rather than guessing a quota or reading OAuth credentials.
- **Files:** `usage-provider.js` provides the tested classifier; it is loaded before `app.js`, whitelisted by `server.js`, and included in the npm package. `test/usage-provider.test.js` covers z.ai, Codex, and fallback routing.

> Newest first. Format: `### YYYY-MM-DD — <area>: <one-line summary>` then
> bullet detail (what + why + file). One entry per meaningful chunk of work.

### 2026-07-07 — docs(context): split gotchas out of AGENTS.md → GOTCHAS.md (keyword index)

- **Why:** `AGENTS.md` is auto-loaded every session; the 17 gotchas (~6 KB) were
  the biggest controllable chunk of recurring context. First compressed them in
  place (−36%), then moved them out entirely per request — saves ~15 KB/session
  vs. the original, with no information loss.
- **What:** all 17 gotchas moved verbatim to root [`GOTCHAS.md`](GOTCHAS.md).
  `AGENTS.md` now holds a **keyword index** ("when touching X → read GOTCHAS.md
  #N") plus a read-before-editing trigger. Numbering preserved, so cross-refs
  updated to `GOTCHAS.md #N` (RPC coverage #1, smoke tests #7, open work #2/#8).
- **SSOT kept coherent:** `docs/README.md` + the AGENTS.md intro now list
  `GOTCHAS.md` as a 4th knowledge source; new gotchas go to `GOTCHAS.md` **plus**
  a keyword in the AGENTS.md index.
- **Trade-off:** gotchas are no longer in auto-load context — the keyword index +
  the "read before editing" line are the contract that the agent consults the
  matching entry before touching the relevant area.

### 2026-07-07 — feat(diff): the pi proposal is EDITABLE — tweak it before approving (IDE + standalone)

- **Capability:** the right (**Proposed**) pane of the approval diff is now
  editable. Edit it, click any Allow button, and **pi applies your edited version**
  (not its original). Works in BOTH the JetBrains editor-tab diff AND the
  standalone webui modal. Leave it untouched → unchanged behavior (pi's original).
- **The enabler:** pi's `tool_call` hook supports in-place `event.input` mutation
  (verified in the [extensions docs](https://pi.dev/docs/latest/extensions):
  "Mutations to event.input affect the actual tool execution, no re-validation").
  So the edited text is fed back into pi's OWN edit/write — pi applies the user's
  version, keeping its context consistent (no stale file, no clobber). This is
  the clean path; the alternative (plugin writes + Deny) was rejected for the
  stale-context wart.
- **Wire contract change:** the `extension_ui_response` `value` is now
  `string | {label, oldFull, newFull}`. Bare label = no edit; the object carries
  the full old/new text when the user edited. The 4 safeguard button LABELS are
  unchanged (still the wire contract).
- **IDE (`DiffReviewEditor.kt`):** right pane via `DiffContentFactory.createEditable`;
  `resolveValue()` reads it back (`.document.text`) and ships `{label, oldFull,
  newFull}` when it differs from the original proposal. `DiffReviewFile.decide` /
  bridge callback widened `(String)` → `(Any)`; `Gson().toJson` handles both.
- **safeguard.ts:** the `tool_call` `select` result is parsed (string or object);
  on any ALLOW, `applyEdits()` mutates `event.input` (`write`→`content=newFull`,
  `edit`→`edits=[{oldText:oldFull,newText:newFull}]` whole-file replace). Deny /
  no-payload → unchanged. The `select` return type widened to allow the object.
- **app.js:** `mountEditableDiff` (two `<textarea>`s, left read-only / right
  editable) renders in `openSelectModal` for edit/write; resolves with the object
  when edited, else the label. `diffInIde` was already pass-through (`value:
  decision`) — no change needed for the IDE object shape. New `.sx-edit` CSS.
- **Files:** `DiffReviewEditor.kt`, `PiWebuiToolWindowFactory.kt`,
  `extensions/pi_minimal_webui/safeguard.ts`, `app.js`, `style.css`, `jetbrains/README.md`,
  `AGENTS.md` gotcha #17. Verified: `node --check app.js` OK, Kotlin LSP clean,
  wire-contract grep (label/oldFull/newFull) consistent across all three.
- **Note (one caveat):** the edited apply is one-shot. `Allow for this session` /
  `Allow always` apply the edit THIS time, but the saved allow-rule auto-approves
  future calls WITHOUT the diff (so those apply pi's original next time) — the
  rule is about re-prompting, not content.

### 2026-07-07 — feat(jetbrains): diff approval renders as a CENTER editor tab, not a floating window

- **Symptom:** the edit/write approval diff popped up as a separate floating
  `DialogWrapper` window; wanted it in the same window as the IDE.
- **Fix:** replaced `DiffApprovalDialog` (`DialogWrapper`, always a separate
  window) with a real editor tab in the main editor area — `DiffReviewEditor`
  (`FileEditor`) over an in-memory `DiffReviewFile` (`LightVirtualFile` carrying
  the payload + an idempotent `decide()` callback), claimed by
  `DiffReviewEditorProvider` (`FileEditorProvider`, registered in `plugin.xml`).
  The native diff (`DiffManager.createRequestPanel`, embedded) is the tab content,
  with the 4 safeguard buttons in a top bar — same window, wide/central like a
  file. `HIDE_DEFAULT_EDITOR` keeps the text editor off that tab; `DumbAware`
  keeps the gate working during indexing (else `openFile` is skipped → the JS
  promise hangs → pi's approval latch stalls).
- **Decision/fail-closed:** a button click resolves the safeguard label via the
  bridge (`window.__piDiffResolve`) + `FileEditorManager.closeFile`; closing the
  tab any other way (✕, session close) hits `dispose()` → fail-closed `Deny`.
  `decide()` is idempotent so exactly one resolution fires. The wire contract
  with `safeguard.ts` (the 4 labels) and the app.js bridge are **unchanged**.
- APIs verified via `javap` against Rider 2026.1.2 (per gotcha #17): `LightVirtualFile`
  is `com.intellij.testFramework.*` but ships in `intellij.platform.core.jar`
  (runtime-available); `FileEditorProvider`/`FileEditorManager`/`FileEditorPolicy`
  are in `intellij.platform.analysis.jar`.
- Files: `DiffReviewEditor.kt` (new: file + editor + provider, with
  `resolveContents` moved from the old dialog), `PiWebuiToolWindowFactory.kt`
  (bridge now `openFile`s the tab + resolves the promise from the decision
  callback instead of blocking on `DialogWrapper.show()`), `plugin.xml` (registers
  the provider), `DiffApprovalDialog.kt` (**deleted**), `jetbrains/README.md` +
  `AGENTS.md` gotcha #17 updated.

### 2026-07-07 — feat(webui): header reload button (JCEF has no F5)

- Rider's JCEF panel doesn't forward F5/Ctrl-R to the page, so there was no
  way to reload after a static-asset edit. Added a `↻` button (`#refresh-btn`)
  in the header next to `⚙` → `location.reload()`. Shares the existing
  `header button` styling (no CSS). Files: `index.html`, `app.js`.

### 2026-07-07 — feat(webui): chat-app autoscroll (reactive follow + jump-to-bottom pill)

- **Symptom:** autoscroll "didn't behave correctly all the time" — the viewport
  drifted off the bottom when `<details>` expanders changed, and there was no
  affordance when you scrolled up to read history (new output piled up silently).
- **Root cause (expanders — confirmed):** `autoscroll()` was called at only 4
  sites (`renderText`, `renderThink`, `toolBlock`, tail of `tool_execution_end`).
  But `<details>` toggles changed `scrollHeight` *outside* that cycle: tool
  blocks auto-open for diffs (`tool_execution_end`) and auto-close on long
  results; the thinking `<details>` toggle paints tens of KB with no re-snap;
  and `mountSideBySide` is **async** (fetches `/api/file`) so its diff content
  laid out *after* the trailing `autoscroll()` already ran against a stale
  height. **Fix:** ONE `MutationObserver` on `#transcript` (`childList`+
  `subtree`+`open` attr) → `autoscroll()`. Catches every layout change;
  `autoscroll()` is rAF-coalesced + pinned-gated, so it's cheap and silent
  when scrolled up.
- **Chat-app affordance:** floating "↓ N new" pill (`#jump-bottom`) over the
  transcript, shown only when scrolled up. `unread` counts assistant turns that
  landed while away (guarded on `cur` so dropped tool-only bubbles aren't
  mis-counted). Click → re-pin + smooth-snap; scroll back to bottom or send →
  re-pin + reset. Required wrapping `#transcript` in a `position: relative`
  `#scroll-wrap` (absolute children of a scroll container move with content, so
  the overlay can't live inside `#transcript`) + `min-height:0` on both for the
  nested-flex scroll to work.
- Files: `app.js` (observer + pill wiring), `style.css` (`#scroll-wrap`,
  `main` min-height, `#jump-bottom`), `index.html` (wrap + button).

### 2026-07-07 — fix(webui): throttle live text re-render (scroll freeze / "messages don't update")

- **Symptom:** during streaming, scroll periodically locked up and long
  messages appeared to stop updating. Root cause: `renderText()` re-parsed the
  WHOLE growing buffer through markdown-it on **every animation frame** (up to
  60/s), unthrottled. `renderThink()` already had a 300ms throttle for this
  exact reason ("freezes the tab"), but the text path never got one. On a long
  message the per-frame `md()` cost saturates the main thread → scroll
  deadlocks and renders stall. One root cause, both symptoms.
- **Fix** (`app.js` `renderText`): mirror `renderThink` — time-throttle the
  streaming paint to ~8/s (120ms), with `force=true` bypassing it for the
  authoritative final render (`renderAssistantContent` at `message_end`, now
  `renderText(true)`). `md.js` confirmed robust (never throws), so this was
  cost, not a thrown render. The streaming path `scheduleRender→renderText()`
  stays throttled; the `message_end` finalize still re-renders from pi's
  authoritative `payload.message.content`, so live+reload can't diverge
  (gotcha #13 invariant preserved).
- Skipped a formal test (4-line throttle; needs fake timers+DOM, heavier than
  the fix) — add if streaming perf regresses again.

### 2026-07-06 — feat: markdown-it replaces hand-rolled parser + live text/thinking streaming

- **Replaced the ~790-line hand-rolled `md.js` parser with a ~45-line shim over
  vendored markdown-it 14.x** (`vendor/markdown-it.min.js`, UMD, 124 KB — same
  zero-build vendor pattern as highlight.js). Driver: "don't want to own a
  parser" + the conformance/reliability gap (markdown-it is CommonMark+GFM-
  conformant, 24M dl/wk vs `markdown-parser`'s 1.5K — see eval in session).
- **`md.js`** keeps `esc()` (project-wide source of truth) and delegates `md()`
  to markdown-it (`html:false`/`breaks:true`/`linkify:true`; links get
  `target=_blank rel=noopener noreferrer`). Same globals + `require` export.
- **Round-trip verified:** 22/30 structural match vs the old parser; the 8 diffs
  are benign (tag/attr order) or improvements (bare-URL linkify, real `![]()`
  images, better partial-input handling). All 6 security assertions PASS (raw
  HTML escaped; `javascript:`/`data:` schemes not in href).
- **Re-enabled LIVE text streaming** (off since gotcha #13, 2026-06-24) +
  **thinking now renders as markdown** (was plain `textContent`). markdown-it
  tolerates partial input (unclosed fence/emphasis → literal), and the
  `message_end` finalize from `payload.message.content` remains the
  authoritative correction — so a transiently-wrong live token self-corrects
  instead of persisting (the old bug stayed broken until reload).
- **Files:** `md.js` (rewrite→shim), `vendor/markdown-it.min.js` (new),
  `index.html` (load order: markdown-it → md.js → hljs → app.js), `server.js`
  (`STATIC` entry), `app.js` (`text_delta`→streaming, `renderThink`+toggle→
  `md()`, `scheduleRender`→+`renderText`), `style.css` (`.think .tbody`
  `pre-wrap`→`normal`), `AGENTS.md` (gotchas #10/#11/#13 + file-map).

### 2026-07-06 — feat: syntax highlighting for code blocks (vendored highlight.js)

- Colorized fenced code blocks instead of plain monochrome.
- **Approach (zero-build preserved):** vendored `highlight.js` v11.11.1 common
  build + the **github-dark** theme into `vendor/` (`highlight.min.js` 127 KB,
  `highlight.css` 1.3 KB) — served as static assets via the `server.js` `STATIC`
  whitelist, exactly like `md.js`. No npm, no build, no React.
- **Wiring:** `index.html` loads `md.js → vendor/highlight.min.js → app.js` so
  `window.hljs` is ready; `app.js` adds `highlightCode(cur.bubble)` at the end
  of `renderAssistantContent` (the one chokepoint for live finalize + reload,
  gotcha #13), gated `if(window.hljs)`. `style.css` neutralizes hljs's box
  (`pre code.hljs{background:transparent;padding:0}`) so our `<pre>` keeps its
  bg/border/padding and hljs supplies only token colors.
- **First third-party runtime the project ships.** Reversible: drop the 2
  includes + 1 hook call → silently back to uncolored output. Decision logged
  in roadmap #12 / plans M1 (both marked SHIPPED).
- **Verified:** `node --check` clean; md.js still emits `language-*`; hljs
  tokenizes a sample (`hljs-keyword`/`hljs-comment` spans); all assets serve
  200. Manual browser smoke (colored on send + reload + session-switch)
  pending.

### 2026-07-06 — docs: plan for syntax highlighting (roadmap #12 / plans M1)

- Added roadmap entry
  **#12** ("Richer markdown output — syntax highlighting", Value ●●●●, Effort S,
  Tier 1) and build plan **M1** in [`docs/plans.md`](docs/plans.md).
- **Why highlighting first:** `md.js` already emits `language-*` classes, and
  both render paths route through one chokepoint (`renderAssistantContent`),
  so the hook is a single `highlightCode(cur.bubble)` call — smallest diff,
  biggest visual win for a coding-agent UI. KaTeX/Mermaid noted as deferred follow-ons.
- **Open decision flagged in the plan:** vendoring `highlight.js` is the first
  third-party runtime the project ships — a reversible step away from the
  minimal-dep brand, gated behind `if(window.hljs)` so removal degrades silently.
  Recommend vendor; awaiting the call before building.

### 2026-07-06 — fix: ＋ New session works in the IDE panel (JCEF)

- **Symptom:** clicking ＋ New in the JetBrains tool window did nothing.
- **Cause:** the guard used the native `window.confirm()`; JCEF (embedded
  Chromium) has no default JS-dialog handler, so `confirm()` returned falsy and
  the `new_session` call was skipped. It was the webui's only native dialog —
  everything else is in-DOM modals.
- **Fix:** replaced it with a small `confirmModal()` in-DOM dialog (reuses the
  existing `.opts` button styling). Works in both a browser tab and the IDE;
  no plugin rebuild needed. (`app.js`)

### 2026-07-06 — fix+feat(jetbrains): diff-gate hardening, real-file diff, IDE-connection badge

- **🔴 Hang fix** — if `DiffApprovalDialog.open()` ever threw (huge file, OOM,
  bad payload), the JS promise from `window.piWebuiOpenDiff` stayed pending →
  app.js's `await` hung → pi's approval latch stalled. The CEF→EDT handler now
  wraps it in try/catch and ALWAYS resolves, failing closed to `"Deny"`.
  (`PiWebuiToolWindowFactory.kt`)
- **🟡 Enter fail-closed** — `DiffApprovalDialog` overrides `doOKAction()` →
  `Deny`, so Enter (the dialog's default OK path) can't implicitly approve; only
  an explicit button click allows. Esc / window-X already = Deny.
  (`DiffApprovalDialog.kt`)
- **Real-file diff** — the dialog resolves the edit path to an IDE `VirtualFile`
  and builds the diff via `DiffContentFactory.create(proj, text, fileType)`:
  **syntax highlighting** by file type, and the **left side reads the open
  editor's text** (unsaved edits included) instead of server.js's disk read.
  Falls back to the app.js `/api/file` text when the path isn't under the
  project. Payload gained `path`/`op`/`edits`/`content`; `EditHunk{oldText,
  newText}` mirrors app.js's first-occurrence replace. (`DiffApprovalDialog.kt`,
  `DiffPayload`/`EditHunk`, `app.js buildDiffPayload`)
- **IDE-connection badge** — the plugin injects `window.piWebuiIdeInfo =
  {name, version}` (via `ApplicationInfo`) on each load and calls
  `window.piWebuiIdeStatus(info)`; app.js renders a statusbar cell — green
  `Rider` (hover = version) when IDE-hosted, dim `none` in a standalone tab.
  Doubles as a visible check that the no-IDE fallback is active.
  (`PiWebuiToolWindowFactory.kt`, `index.html`, `app.js updateIdeBadge`,
  `style.css`)
- **Not build-verified in the dev shell** — the agent's git-bash can't exec the
  JVM via `gradlew` (0xC0000005); Kotlin is linter-clean + key APIs
  `javap`-verified, but the actual build/test ran in Rider.

### 2026-07-03 — fix(jetbrains): diff approval is one window — embed the diff panel, no blocking popup

- **Symptom:** the IDE diff-approval flow opened *two* modal windows —
  `DiffManager.showDiff()` (the diff) + our button `DialogWrapper` (the popup).
  The popup sat on top and blocked scrolling/interacting with the diff, and a
  decision left the diff window open (we had no handle to close it).
- **Fix:** embed the native diff viewer *inside* the approval dialog via
  `DiffManager.createRequestPanel(Project, Disposable, Window)` as the dialog's
  center panel; the 4 safeguard buttons live in the dialog's bottom action bar.
  One window → buttons never overlay the diff, and `close(OK_EXIT_CODE)` closes
  the whole dialog (diff included). Panel is torn down via a
  `Disposer.newDisposable()` parent in the overridden `dispose()`.
- **API note:** the modern `createRequestPanel` takes `Project`/`Disposable`/
  `Window` — no `DiffContext` (verified via `javap` against Rider 2026.1.2's
  `intellij.platform.diff.jar`). `DialogWrapper` is not `Disposable`, hence the
  manual parent disposable.
- File: `jetbrains/src/main/kotlin/com/gorowynn/piwebui/DiffApprovalDialog.kt`.

### 2026-07-03 — feat(jetbrains): IDE plugin — JCEF tool window + native diff approval gate

- **What.** Standalone Gradle plugin under `jetbrains/` (does NOT touch the
  webui's zero-build invariant). Embeds the already-running webui panel in a
  JetBrains tool window via JCEF (reuses 100% of the JS frontend, ~25-LoC Kotlin
  bridge), AND adds a **native IDE diff approval gate** for edit/write: proposed
  changes open in the IDE's diff viewer with 4 Approve/Deny buttons, and the
  decision flows back to pi through the existing safeguard channel. Depends only
  on `com.intellij.modules.platform` → runs in Rider/IDEA/PyCharm/WebStorm/
  CLion/GoLand/RubyMine.
- **The wire (security model).** The IDE diff replaces the webui modal *renderer
  only* — `safeguard.ts` is **unchanged**. The decision is a safeguard
  option-label posted via the SAME `api({type:"extension_ui_response", id,
  value})` channel. The 4 labels are a wire contract, exact: `Allow once` /
  `Allow for this session` / `Allow always (save to config)` / `Deny`. Esc/X
  defaults to Deny (fail-closed). If the plugin/bridge is absent, app.js falls
  back to the existing modal (`openSelectModal`).
- **Flow.** `tool_execution_start` carries `{path, edits:[{oldText,newText}]}` →
  app.js `uiRequest()` sees `method:"select"` + `curToolName∈{edit,write}` AND
  `window.piWebuiOpenDiff` exists → builds `{filename,leftText,rightText}`
  (left = `GET /api/file`; right = left + hunks applied) → JCEF bridge → Kotlin
  `DiffApprovalDialog` (`DiffManager.showDiff()` + `DialogWrapper`, 4 buttons) →
  label back → `extension_ui_response`.
- **Files.** `jetbrains/`: `PiWebuiToolWindowFactory.kt` (JCEF + `JBCefJSQuery`
  bridge), `DiffApprovalDialog.kt` (diff + buttons), `PiWebuiSettings.kt`
  (persisted URL), `plugin.xml` (tool window, platform-only dep). `app.js`:
  `diffInIde`/`buildDiffPayload`/`openSelectModal` + the select-branch guard.
  New `.gitignore` block ignores `jetbrains/{.gradle,build,local.properties}` +
  `.idea/`/`*.iml`; the Gradle wrapper stays committable.
- **Build bootstrap (every one of these cost a failed build — they are
  load-bearing).** IntelliJ Platform Gradle Plugin **2.7.0** (2.3.0 →
  `JvmVendorSpec IBM_SEMERU` on Gradle 9); Foojay resolver **1.0.0**
  (`settings.gradle.kts`; 0.8/0.9 → same `IBM_SEMERU`); Kotlin **2.4.0**
  (2.0.21 → `IllegalArgumentException: 25.0.3` — its daemon runs on the Gradle
  JVM/JDK 25 and its bundled parser can't read "25"); `instrumentCode = false`
  (the platform's instrumentation task throws `Packages does not exist` on the
  JDK 25 Gradle JVM; it only injects `@NotNull` checks, not load-bearing —
  re-enable when building on JDK 21); `DiffContentFactory` is in
  `com.intellij.diff` (NOT `.contents`, where `DiffContent` is). `local()`
  builds against the auto-detected installed IDE (`product-info.json`),
  overridable via `RIDER_HOME`/`-PriderHome` — no hardcoded path, no IntelliJ
  Community download. Build: `gradlew buildPlugin` → zip in
  `build/distributions/`; install via Settings → Plugins → ⚙ → Install from Disk.
- **Open.** Disposal of the JCEF query + load handler; `autoStartCommand` to
  spawn server.js; single-window embedded diff via `createRequestPanel` (vs the
  current `showDiff` + separate button dialog); VirtualFile highlighting.

### 2026-06-30 — fix(extension): subagent parallel & chain modes were dead since inception

- **Bug.** Operator-precedence error in the mode-detection guard
  (`subagent.ts` `execute()`; was `hasTasks = x?.length ?? 0 > 0`) parsed as
  `x?.length ?? (0 > 0)` → `length ?? false` → for an N-element array it
  returned the **length N** (a number), not a boolean. `modeCount` then summed
  array *lengths* instead of counting active *modes*, so any parallel/chain
  with **≥2 items** tripped `modeCount !== 1` and was rejected with "Provide
  exactly one mode" — *before* the real dispatch branches ever ran. Single mode
  (and N=1 arrays, by accident) worked, which is why prior smoke tests stayed
  green.
- **Fix.** Parenthesize — `((x?.length ?? 0) > 0)` on both `hasChain`/
  `hasTasks` (`subagent.ts:594-595`). Verified live: a 4-agent parallel batch
  (summarizer/planner/reviewer/debugger) and a 2-step scout→summarizer chain
  with `{previous}` substitution now dispatch correctly. All three modes + all
  five read-only agents exercised end-to-end; only `implementer` (bash-capable,
  `ask`-gated, paid `glm-4.7`) remains untested.
- **Scope.** Dispatch logic only. Tier→model routing (incl. the live
  `subagent-tiers.json` override), the `--tools` allowlists, and the
  safeguard/discipline gates were always correct — only the multi-element-array
  paths were unreachable.
- **Cost note (from the test run).** Subagents trade *parent context window*
  for *total token spend*, not money for money: every spawn carries a ~10k
  input-token floor (child re-loads system prompt + tool defs), so trivial
  lookups are pure loss and parallel batches are uniformly costlier than
  inline. The win is structural context isolation (roadmap O2) — largest for
  chain (a full 7k-token read stays in the child) — which is exactly the
  parallel/chain path this bug had dead-coded.

### 2026-06-25 — feat(skill): add `sdd` — strict 4-phase Spec-Driven Development + TiCoder

- **First shipped skill** (`skills/sdd/SKILL.md`). 4-phase loop with explicit
  Yes/No approval between phases: Plan (`.sdd/plan.md`) → Spec
  (`.sdd/spec.md`, requirements ID-tagged `FR-N`) → Impl-Plan + TiCoder tests
  (`.sdd/tasks.md`, each test tagged `# FR-N`) → Code+Test to green, then
  `.sdd/verify-report.md`. Implementation code is FORBIDDEN before Phase 3
  approval. Artifacts scoped under `.sdd/` so the package can run in any repo
  without colliding with a host `docs/`.
- **Skill-only, deliberately.** No `tool_call` gate backs it (an earlier draft
  had one; user rejected blocking). Enforcement ceiling = the `description`
  (always in context, drives auto-load) carrying the size gate (substantial /
  multi-file only; no one-line fixes) + per-phase disk artifacts. "STOP and ask
  Yes/No" is self-interruption, the weakest LLM behavior — accepted as the
  cost of no gate; revisit as a `before_agent_start` nudge if drift shows.
- **Wired through the package manifest** (`package.json`): added `"skills":
  ["./skills"]` to the `pi` key (the repo is a local-path package in settings,
  so resources load via the manifest — `packages.md`), and `"skills"` to the
  npm `files` whitelist so `pi install npm:pi-webui` ships it. `/reload`
  re-scans; `/skill:sdd` forces it on. `/skill:sdd` is the command because
  the frontmatter `name` is `sdd` (must be lowercase a-z/0-9/hyphens).
- **Docs:** `AGENTS.md` file map gained a `skills/` row + a `package.json`
  note refresh.

### 2026-06-25 — chore(extension): close subagent safeguard Option A ("B suffices + cheap harden")

- **Linchpin de-risked.** The deferred item (per-command safeguard via IPC for
  bash *inside* spawned subagents) is closed. The subprocess (`pi --mode json
  --no-session`) DOES load the safeguard extension and its `tool_call` hook
  fires — but headless (`hasUI=false`) → `nonInteractive` policy → default
  `allow` → **auto-allows every command** (stdin is `ignore`, so it couldn't
  prompt regardless). So the real capability wall today is the tier `--tools`
  allowlist, not safeguard.
- **Cheap harden** (`subagent.ts` TIERS): dropped `bash` from the `debugger`
  tier — its own code comment already endorsed this. debugger is now read-only
  recon (`read`/`grep`/`find`); its systemPrompt no longer references bash/git.
  5/6 tiers are now provably non-mutating (planner, reviewer, debugger, scout,
  summarizer). Only `implementer` keeps `bash` (it needs builds/tests), and the
  parent's Option B delegation gate (shipped 2026-06-24) shows agent + task
  before spawning, so a human approves that mutation.
- **Full IPC deferred.** ~150-250 lines across `subagent.ts` + `safeguard.ts`
  (stdio `ignore`→`pipe`, env-gated request/response protocol, parent brokering
  via `ctx.ui.select`, pending-request map + abort) — and it would interleave a
  non-pi protocol into pi's `--mode json` NDJSON stdout, risking the `\n`-only
  framing invariant (gotcha #2) for marginal benefit against the explicit
  auto-allow headless default. Net: the read-only wall + delegation gate
  achieve the safety goal; the residual (implementer bash) is bounded and
  human-approved.
- **Docs:** `AGENTS.md` open-work item ticked closed with the finding;
  gotcha #8 refreshed (closure-state count ~23→~26 + refreshed examples, after
  the O3 close-out shaved `awaitingTurnStats`); gotcha #15 dropped the stale
  `o3LogEnabled` ref.

### 2026-06-25 — chore(extension): close O3 — cache-stable discipline nudge + drop [O3] instrumentation

- **O3 verdict + fix.** The cache-stable prompt audit (`docs/plans.md` §O3) is
  closed. The permanent statusbar cache-hit readout (shipped same day) showed a
  healthy ~84% — the provider prompt cache *does* reach the extension tail and
  mostly holds, so the discipline nudge's per-turn churn was low-impact, not a
  serious cache-buster. Still applied the planned fix: `discipline.ts` branch 1's
  soft nudge is now a **constant** string (drops the live `#1, #2` ids /
  started-open counts that changed every turn). The hard `tool_call` gate already
  enforced the invariant mid-turn; the nudge only needed to remind of the
  rhythm. Branches 2 (all-finished → "clear") and 3 (no-list) were already
  state-stable, unchanged.
- **Removed the temporary `[O3]` instrumentation** (measurement scaffolding;
  the permanent hit-rate display replaces it):
  - `app.js`: the `awaitingTurnStats` arm-at-`agent_end` + `[O3] turn-end …`
    console-log block, the `let awaitingTurnStats` decl, and the `o3-log`
    sidebar-toggle wiring (`o3LogSel`/`setO3Log`/`o3LogEnabled`, `pi:o3-log`).
  - `server.js`: `logO3Cache()` + `O3_LOG`/`O3_CFG`/`o3LastInput`/`o3Enabled()`,
    the call in the stdout framing loop, and the `GET/POST /api/o3-log`
    endpoints.
  - `index.html`: the `cache logger` checkbox in the settings drawer.
- No behavior change to caching (the fix is correct-but-marginal); the win is a
  cleaner codebase + permanent visibility now lives in the statusbar.

### 2026-06-25 — feat(webui): statusbar git breakdown + cache hit rate

- **Git segment now splits changes by state** (`server.js` `gitInfo()` +
  `app.js` `refreshHealth()`). Was `branch (NΔ)` (one opaque count); now parses
  `git status --porcelain` into three buckets and renders `branch +a ~b ?c`
  (only non-zero buckets; clean tree → just branch):
  - `+N` staged (index column X), `~N` unstaged (worktree column Y),
    `?N` untracked (`??`). A file in both columns (e.g. `MM`/`DD`) counts in
    both — accurate, it has staged AND unstaged changes.
  - `title` tooltip explains the symbols. `gitInfo` shape changed
    `{branch, changes}` → `{branch, staged, unstaged, untracked}`.
- **Cache segment shows hit rate** (`app.js` stats handler). Was
  `read↓ write↑` (raw tokens, no context); appends `NN%` = `cacheRead / input`
  (the same formula the `[O3]` per-turn log uses), so you see how effective the
  prompt cache actually is. `title` explains read/write + the % basis.

### 2026-06-24 — feat(extension): solid default safeguard.json + subagent nudge/integration

- **Solid default (`safeguard.ts` `DEFAULT_CONFIG`):** the default WAS just `{"*":"ask",
  nonInteractive:"allow"}` — minimal but noisy (asked on every `read`/`grep`, no
  secrets handling, no safe-bash fast-paths). Replaced with a trust ladder that
  auto-writes on first run AND serves as the floor `loadConfig` overlays a user's
  partial config onto (so unlisted tools keep sane rules):
  - **allow** agent coordination (`ask_user_question`, `todo`) — no side effects.
  - **allow** read-only recon (`grep`, `find`, `ls`, `glob`).
  - **read** allow by default, but **ask** on secrets (`.env*`, `*.pem`, `*.key`,
    `*.pfx`, `.npmrc`, `.pypirc`, `*credentials*`) and **deny** SSH private keys
    (`id_rsa`, `id_ed25519`, `id_ecdsa`) — those are almost never wanted
    in-context.
  - **ask** on mutation (`edit`, `write`).
  - **bash**: anchored-regex **allow** for safe recon (`^git status/log/diff/
    show/blame/branch/remote/ls-files`, `^pwd`, `^ls`, `^echo`, version/help
    probes); **deny** catastrophic `rm -rf / ~ /usr /etc /var /boot` (incl.
    `rm -r` without `-f`); **ask** everything else. Every bash allow is
    `re:^...(\s|$)` anchored — never a bare substring (which would let `ls`
    match `false`/`curls`).
  - **subagent** delegation: allow read-only tiers, **ask** the bash-capable
    ones (`implementer`, `debugger`).
  - `*` stays `ask` (fail-safe fallback).
- **Hardening detail:** private keys hard-**deny** (you almost never want them
  read), secrets **ask** (you legitimately read `.env`). deny patterns are
  best-effort (documented inline: a determined agent can obfuscate; the prompt
  is the real gate — deny just fails closed on the obvious catastrophes so a
  reflexive "allow" click can't reach them).
- **Self-check:** 29-case matcher test (bash anchoring, rm-deny boundaries,
  secret/private-key glob+plain matching) — all pass. Catches the regression
  that DID slip in during this change.
- **Bug fixed mid-change:** the biome auto-fix run stripped backslashes from the
  bash regex literals (`(\s|$)` → `(s|$)`, `\brm\s+` → `brms+`), which at JS
  runtime drops the escapes entirely (`\s` is an unrecognized escape → `s`),
  breaking every anchored allow + the rm deny. Rewrote via Python `chr(92)` to
  avoid the edit-tool/heredoc double-escaping trap; verified each line via
  `repr()` (source `\\s` = runtime `\s`). LESSON: when editing regex string
  literals through the edit tool, verify backslash counts with a repr/hexdump
  afterward — the transport collapses `\\`→`\` unpredictably.

- **Goal:** the parent's `tool_call` gate already fired on `subagent`, but bash
  *inside* the spawned `pi --mode json --no-session` subprocess is ungated
  (headless, `hasUI=false`, auto-allows under `nonInteractive`). Decided on a
  hybrid: ship the coarse per-delegation gate (B) now; defer the fine per-command
  IPC gate (A) as open work until B proves too coarse.
- **Option B shipped (`safeguard.ts`):**
  - `selectorFor` `subagent` branch: single mode → agent name; parallel/chain →
    `<mode>(agent1,agent2,...)` (distinct agents, order-independent) so
    `"subagent": { "implementer": "ask", "*": "allow" }` and allow-always
    key meaningfully by delegation shape.
  - Ask-preview enriched for `subagent`: shows `<selector> — <task>` (truncated),
    so the approval is readable, not just a bare agent name.
  - Default `*:ask` already prompts once per delegation; the user tightens by
    agent in `~/.pi/agent/safeguard.json` (read-only tiers allow, bash-capable
    ask). One approval covers the whole task — maps to how trust is reasoned
    about; avoids 5 prompts for 5 `npm test` calls in one implementer run.
- **Two-layer model (documented inline + AGENTS.md):** parent safeguard decides
  IF the delegation happens; the subagent's `--tools` allowlist (subagent.ts
  TIERS) decides WHAT the delegate can do — the allowlist is the capability wall.
- **Option A deferred (open work, AGENTS.md):** per-command IPC gate — subprocess
  safeguard (env-gated `PI_SUBAGENT=1`) emits `safeguard_request` on stdout,
  `runSingle` relays to the browser via parent `ctx.ui.select`, answer flows back
  on `proc.stdin`. Linchpin to de-risk first: confirm json-mode subprocess loads
  the extension + fires `tool_call`. ~150-250 lines. Revisit if B is too coarse.

### 2026-06-24 — feat(extension): subagent nudge rewrite + safeguard integration

- **Nudge rewrite (`subagent.ts` `promptGuidelines`):** the old 3 bullets said
  "keep context lean" and listed agents but gave no decision rule, so the agent
  guessed when to delegate. Replaced with 4 rule-bullets: (1) delegate when input
  is large but the answer is small (3+ files → one question, multi-file trace,
  planning, review, well-specified impl); (2) DON'T delegate a single read/grep
  or anything answerable inline — the subprocess round-trip isn't worth it;
  (3) prefer **context-mode** (`ctx_execute_file`) over subagent for deriving a
  fact from ONE large file/log in-sandbox, use subagent for multi-file /
  reasoning / edits — disambiguates the two context-savings mechanisms that were
  silently colliding; (4) `tasks[]` for parallel, `chain[]` with `{previous}`
  for sequential (debugger→implementer turns a root-cause into an applied fix).
  Per pi docs every bullet names `subagent` (flat list, no tool prefix).
- **Safeguard integration (`safeguard.ts` `selectorFor`):** the parent's
  `tool_call` gate already fired on the `subagent` tool, but the selector fell
  to `JSON.stringify(input)`, so per-target rules like `"subagent": {
  "implementer": "ask" }` could never match. Added a `subagent` branch:
  selector = agent name (single mode), or `"parallel"`/`"chain"` for multi-agent
  modes. Users can now gate delegation by agent: `"subagent": { "*": "allow",
  "implementer": "ask", "debugger": "ask" }`, and "allow always" saves by
  agent name. Two-layer model documented inline: parent safeguard decides IF the
  delegation happens; the subagent's `--tools` allowlist (subagent.ts TIERS)
  decides WHAT the delegate can do — the allowlist is the real capability wall,
  since the spawned subprocess runs headless (hasUI=false) and auto-allows under
  nonInteractive.
- **Debugger safety comment (`subagent.ts`):** the debugger tier's `bash` tool is
  NOT read-only despite the system prompt asking for grep/git only — the
  `--tools` allowlist is a capability wall, not a behavioral one. Added a
  `ponytail:` comment naming the ceiling and the harden path (drop `bash`).
- **Type hygiene (`safeguard.ts`):** normalized to the sibling minimal-dep pattern
  (`@ts-expect-error` on `node:` imports + local minimal types for the pi
  surface) — safeguard.ts was the lone holdout still importing `node:fs` /
  `node:path` / `@earendil-works/pi-coding-agent` directly, producing 8 latent
  type errors. Now clean.

### 2026-06-24 — fix(extension): subagent returned "(no output)" for reasoning-model tiers (thinking-only answers)

- **Bug:** `subagent` on the lookup tier (zai/glm-4.5-air, provider-aliased to
  **glm-4.7**, a reasoning model) returned `(no output)` even though the model
  answered — wasted tokens, no result to the parent. Reproduced on a no-tool
  "reply pong" task (scout spent 3 output tokens, returned empty).
- **Root cause (`subagent.ts` `getFinalOutput`):** it only matched assistant
  content parts of `type:"text"`. glm-4.7 on a trivial prompt puts the answer
  ENTIRELY in a `thinking` block and emits **no `text` part at all**. Verified
  via raw `pi --mode json` capture: the assistant `message_end` content was
  `[thinking:"\npong"]` only (the capable tier glm-5.2 emits a proper `text`
  part, so it was unaffected — tier-specific). The stream completed normally
  (`turn_end`/`agent_end` present); it wasn't a truncation/capture-pipeline bug.
  (Earlier "no assistant message_end" reading was a `head -c` SIGPIPE truncating
  the capture file — re-verified without a truncating pipe.)
- **Fix:** `getFinalOutput` now falls back to the last `thinking` block's content
  (trimmed) when no `text` part exists. Text still takes priority; thinking is
  fallback only. Single point of change — `getResultOutput` / parallel summary /
  chain / single all route through it. Verified standalone over 4 cases (lookup
  thinking-only → "pong"; capable text → "pong"; both → text wins; empty → "").
- **Type-cleanups in the same file (pre-existing blockers surfaced by the edit):**
  added `thinking?: string` to `ContentPart`; added ambient `declare const` for
  the node globals `Buffer`/`process` (the file has no `@types/node` — jiti
  strips types; index.ts used per-line `@ts-expect-error` for its single
  `process.env`, but subagent.ts touches 7 global refs so a 2-line ambient
  declare is less noise); annotated 3 implicit-any callback params. All 12
  prior diagnostics cleared.
- **NOT live-verified yet:** the running pi cached the old extension at session
  start (no hot-reload). After a webui restart, `subagent scout "reply pong"`
  should return `pong`. Extension loads project-local from `./extensions/`
  (no installed copy under `~/.pi/agent/extensions/`), so the repo edit is the
  right file.

### 2026-06-24 — feat(webui): log O3 cache snapshots to a file (server-side sniff)

- **Why server, not browser.** The `[O3]` cache-rate numbers originate in **pi**
  (it owns the model API). They flow back as the `get_session_stats` response
  (id `sb-stats`), and `server.js` already `JSON.parse`s every pi line at the
  framing point (L146) before broadcasting — so the parsed payload is right
  there. A browser→POST→file round trip would be redundant (CSRF, double
  computation, dies when the tab closes). The sniff logs even with no browser
  open.
- **`server.js`:** `logO3Cache(obj)` helper after `broadcast()`. Matches the
  `sb-stats` response, formats the SAME fields `app.js` console.logs
  (`input`/`cacheRead`/`cacheWrite`/`cacheHit%`) plus an ISO timestamp, and
  `appendFileSync`es to `~/.pi/agent/o3-cache.log`. Called in the stdout
  framing loop right after `broadcast`. The `try/catch` is best-effort — a
  missing agent dir or perms issue must never stall pi IO.
- **Left in place:** the gated browser `console.log` (`o3LogEnabled`, sidebar
  toggle) — still useful as a live mirror during a session; flip the toggle off
  if you only want the file. The file is the durable record.
- **Verified:** standalone node self-check reproduces both real logged lines
  (540% / 658%) and skips the three negative shapes (wrong id, no tokens, null).

### 2026-06-24 — perf(webui): coalesce autoscroll to one rAF (kill forced reflows)

- **Root cause of the `[Violation] forced reflow` + slow `'message' handler`
  logs.** `autoscroll()` called `scrollDown()` synchronously, which reads
  `transcript.scrollHeight` (forces layout) then writes `scrollTop`. It's hit
  from four streaming-hot sites — `renderText` (L140), `renderThink` (L279),
  `toolBlock` (L309), `tool_execution_end` (L2265). During a burst (a long
  reasoning trace = hundreds of `thinking_delta`, or a subagent turn rendering
  many tool boxes) all those `onmessage` tasks run back-to-back before the next
  paint, so N autoscrolls = N forced layouts in one frame. Also fed the ~100ms
  `requestAnimationFrame` violations (renderThink's force paint does
  `textContent=buf` then `autoscroll()` — read-after-write on a huge node).
- **Fix (`app.js` `autoscroll`):** coalesce to a single rAF — the pinned check
  moves inside the callback, N synchronous calls/frame collapse to ONE layout.
  `scrollDown()` (the unconditional immediate snap used by `addUser`, `note`,
  `init-msgs`) stays synchronous — it's one-off, never in a burst.
- **Not changed:** the thinking body paint itself stays throttled (300ms) and
  only paints when the `<details>` is open or on the single `thinking_end`
  force paint — bounded and user-initiated; the `textContent` rewrite cost is
  unavoidable. The O3 cache-hit logs (540%→658%) were never a problem — that's
  the measurement feature reporting healthy cache reuse.

### 2026-06-24 — feat(webui): subagent live view + collapsible settings sidebar + tier-model config

- **Subagent live view** (`app.js`): the `subagent` tool streams its full live
  state via `partialResult.details` (agent, model, turns, exitCode, the child's
  tool calls + partial output, parallel/chain progress). `agent-session.js`
  forwards `partialResult` whole, so it was already arriving — the update
  handler just discarded `.details` for the `"(running…)"` text. New
  `renderSubagentView` renders it at start/update/end: per-row agent + tier
  color + status icon (✓/✗/⏳), the child's recent tool calls (`→ ls src/`),
  parallel `2/3 done` / chain `step 2/3` summaries. Density toggle (sidebar):
  `full` vs `compact`.
- **Collapsible settings sidebar** (`index.html` + `style.css` + `app.js`):
  `<aside id="settings">` fixed right drawer (⚙ opens; ✕ / backdrop / Esc
  closes). Relocated model + reload / thinking / ponytail selects here from the
  header (IDs unchanged, handlers intact). Also hosts two new sections:
- **Subagent tier-model config** (end-to-end): three selects in the sidebar
  (capable / implement / lookup) → `POST /api/subagent-tiers`
  (`server.js`, sandboxed to `~/.pi/agent`, guarded by `isAllowed`) → writes
  `subagent-tiers.json`. `subagent.ts` re-reads that file each `execute()`
  (safeguard pattern) and overrides `TIERS[].model` by tier — so a sidebar
  change routes the next subagent call to the new model, no restart.
- **Dev toggles**: subagent view density (`pi:sa-density`) + O3 cache-logger
  on/off (`pi:o3-log`, gates the `[O3]` console log).
- Verified: `node --check` clean on `app.js`/`server.js`; `subagent.ts` and
  `server.js` carry only baseline node-type noise (no new errors). HTML has all
  6 settings elements. Smoke test pending.

### 2026-06-24 — feat(ext): tier-based subagent routing (O5, rebuilt) + revert per-turn switch + cache logger (O3)

- **O5 pivot:** the per-message `set_model` override (shipped earlier today)
  caused errors (a `modeSel` mis-bind bug I introduced) and was the wrong shape
  — **reverted** (`index.html` + `app.js` clean; `modeSel` back to `$("mode")`).
  Routing is now **subagent-based**, per pi's `examples/extensions/subagent`.
- **O5 — subagent tool** (`extensions/pi_minimal_webui/subagent.ts`, wired from
  `index.ts`): ports the upstream core stripped to what `--mode rpc` uses (no
  TUI rendering — the webui shows `result.content`; no filesystem agent
  discovery — the tiers are in-code config). Registers a `subagent` tool the
  parent LLM calls to delegate; each call spawns an isolated
  `pi --mode json -p --no-session --model <tier>` subprocess. Two wins at once:
  cost routing (tier→model) + context savings (the parent never ingests the
  subagent's tool I/O — only its capped ≤50KB final text = roadmap O2,
  structurally). Modes: single / parallel / chain (`{previous}` placeholder).
  Tiers (from `pi --list-models`):
  - capable `zai/glm-5.2` → planner, reviewer, debugger
  - implement `zai/glm-5-turbo` → implementer (bump to glm-5.1 if quality dips)
  - lookup `zai/glm-4.5-air` → scout, summarizer
- **O3 — cache-rate instrumentation** (`app.js`): unchanged; `awaitingTurnStats`
  arms at `agent_end`, `sb-stats` prints `[O3] turn-end: … cacheHit=N%`. The
  `discipline.ts` fix is still pending the baseline A/B.
- Verified: `node --check` on `app.js`/`server.js`; `subagent.ts` carries only
  the baseline node-type noise (Buffer/process/implicit-any) every sibling
  extension ships with (minimal-dep, no @types/node). Smoke test pending: invoke
  `subagent` in the webui and confirm a delegated task runs on the pinned model.

### 2026-06-24 — fix(webui): render assistant text from pi's authoritative message (root cause of broken-until-reload)

- **Why:** despite the earlier render-path fix, assistant text STILL rendered
  broken live but clean after reload. A diff of the user's before/after capture
  showed the "before" text had words/fragments MISSING and spaces/parens/digits
  STRIPPED (e.g. "SSE set_model echo (line 2308)" → "SSEset_modelecholine 8)").
  That's not md mis-rendering and not a missing suffix — it's transport
  corruption/loss of `text_delta` events.
- **Root cause:** the live path rendered from `text_delta`s RE-ACCUMULATED in
  the browser, which are lossy/corruptible over the pi→SSE→browser pipe. Reload
  reads pi's stored message via `get_messages` — always clean. Same render fn,
  different DATA.
- **Decisive fix** (`app.js`): `message_end` carries the full final `message`
  (verified in `agent-session.js` L390-410; every `AssistantMessageEvent` also
  carries `partial` — pi-ai `types.d.ts` L330-374) — the SAME object pi
  persists and `get_messages` returns. `finalizeBubble(payload.message.content)`
  now renders from THAT authoritative content, so live and reload read
  byte-identical input and can't diverge regardless of transport hiccups. The
  hand-accumulated `cur.content` survives only as the `agent_end` safety-net
  fallback.
- **`finalizeBubble(content)`** also resets the per-block cursors
  (`textPar`/`thinkEl`/…) after clearing the bubble, so the re-render creates
  fresh nodes instead of painting into the detached live-streamed ones.
- **md.js is innocent:** verified by feeding it the full reload text — zero
  words lost. Documented in AGENTS.md gotcha #13 (two-layer history).

### 2026-06-24 — fix(webui): suppress empty assistant messages

- **Why:** empty assistant bubbles (just the "assistant" label, nothing else)
  appeared on turns that went straight to tool calls or ended with no text/
  thinking. Root cause: `message_start` eagerly created the bubble via
  `newAssistantBubble()`, and `message_end` rendered `cur.content` even when it
  was empty. Reload did the same (`renderMessage` also created eagerly).
- **Shared filter** (`app.js` `nonEmptyContent`): drops text blocks with no text
  and thinking blocks with no thinking. Used by BOTH the live path
  (`finalizeBubble`) and reload (`renderMessage`), so live and reload suppress
  empty messages identically (consistent with the text-render fix above).
- **Live path:** `message_start` no longer creates the bubble eagerly —
  creation is lazy (the existing `!cur` guard in `message_update` builds one
  only when real text/thinking arrives). `finalizeBubble` drops the whole `.msg`
  node when `nonEmptyContent` is empty, so a tool-only / blank turn leaves no
  label. `agent_end`'s safety net simplified to `if (cur) finalizeBubble();`
  (finalizeBubble handles empty → remove).
- **Reload:** `renderMessage` only creates the bubble when `nonEmptyContent` is
  non-empty — parity with live.

### 2026-06-24 — fix(webui): render assistant text once at message_end (no live text streaming)

- **Why:** md kept rendering broken *live* but always fine after reload — the
  live text path and `renderMessage` (reload) kept diverging on provider quirks
  (missing `text_end`, whole-message `text_end.content`, stray `text_delta`
  after `cur` nulled). Today's earlier per-block `text_start` flush fixed one
  case but the user reported it still broke. User doesn't need live answer text
  (only thinking streams), so the root fix is to **stop rendering text live**.
- **Single render path** (`app.js`): `message_update` now only *accumulates*
  raw blocks into `cur.content` (`{type:"text",text}` / `{type:"thinking",thinking}`;
  `cur._blk` = block being filled, survives a missing `text_end`). The ONE
  md() paint happens at `message_end` via `finalizeBubble()` →
  `renderAssistantContent(cur.content)` — the **same function** reload's
  `renderMessage` now calls. Identical path ⇒ identical md() input ⇒ live can
  no longer diverge from reload. `agent_end` re-runs it as a safety net if
  `message_end` never fired.
- **Thinking unchanged** in feel: still streams live (`renderThink` via the
  rAF-coalesced `scheduleRender`); just re-rendered finalized at `message_end`
  (collapsed by default → invisible swap).
- **Dead code removed:** `commitText` and the `renderText()` call inside
  `scheduleRender` (text no longer renders per-token/`text_end`). `renderText`
  survives — called only from `renderAssistantContent`.
- Docs: AGENTS.md gotcha #13 rewritten for the new design.

### 2026-06-24 — feat(webui): peak-hours usage indicator, drop redundant Usage button

- **Why:** z.ai tokencost is higher during peak hours (14:00–18:00 UTC+8 =
  06:00–10:00 UTC). Surfaced as a subtle signal on the inline usage bar.
- **Peak signal** (`style.css` + `app.js`): during peak hours the `#usagebar`
  gets a thin warn-colored border (`.peak` class, toggled in `refreshUsageBar`).
  Base bar carries a transparent border so only the color shifts — no layout
  jump. Minute-accurate: recomputed on the existing 60s poll, appears/disappears
  on its own. (First attempt was a flashing yellow badge — made subtle per
  feedback: just the border, no animation, no extra element.)
- **Drop Usage button** (`index.html`, `app.js`): the button duplicated the
  bar's own `onclick = showUsage`, so it's removed; the bar is now the sole
  entry point to the usage modal. `#usagebar` gains padding/border-radius so
  the peak border reads cleanly.

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
  the correct surface (not the in-process SDK — would break minimal-dep + process
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

- **New `md.js`** (~670 lines): minimal-dependency Markdown→HTML parser extracted from
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
- `55aa269` feat: initial commit — minimal-dependency pi web UI

### 2026-06-23 — chore: created AGENT_NOTES.md

- Added this file as the agent's persistent project memory + changelog. Seed
  content captured from README (absorbed here), design.md + TODO.md (since
  relocated to `docs/`), and git log. No code changes.
