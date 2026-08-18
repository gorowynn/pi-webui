# CHANGELOG — pi-webui

> Running history, newest first. Moved out of [`AGENTS.md`](AGENTS.md) so the
> orientation doc stays lean. One entry per meaningful chunk of work:
> `### YYYY-MM-DD — <area>: <one-line summary>` then bullet detail (what + why + file).

## History

### 2026-08-18 — fix(extension): keep discipline prompt cache-stable

- `discipline.ts` now appends one fixed process-discipline suffix on prompted
  turns; live todo state remains in the hard gate and tool results instead of
  changing the provider's cached system-prompt prefix. Added
  `test/discipline-contract.test.js`.

### 2026-08-18 — fix(webui): exclude permission waits from tool timing

- Usage tool-duration telemetry now pauses while a safeguard permission prompt
  is open and resumes after the decision is resolved. Waiting for permission no
  longer inflates tool runtime; tool-owned input waits remain measured.

### 2026-08-18 — fix(webui): preserve Usage telemetry per session

- Browser-local Usage storage now keeps a versioned map of the 12 most recently
  saved session histories instead of replacing the previous session on switch.
  Existing v1 single-session payloads migrate on the next save. See
  [`docs/usage-telemetry.md`](docs/usage-telemetry.md).

### 2026-08-18 — feat(webui): compact context header and inspector rail

- `#statusbar` now lives in the header beside the connection state, keeping repo
  and model visible while the composer stays focused on writing. Secondary
  git/thinking/cache/token/cost/IDE data is centered in the spare header width
  and consumes it in order; only trailing non-fitting entries move into the
  accessible `details` popover. A `ResizeObserver` plus live status updates
  rebalance it without
  duplicating DOM values or reopening a dismissed popover.
- The right inspector strip is now 64px and icon-first (`style.css`): labels stay
  in the accessibility tree and native titles retain hover discoverability,
  badges remain visible, and selected tabs use tint + accent icon instead of the
  prohibited side stripe. The expanded resizable pane is unchanged.
- Added `test/shell-layout.test.js`; `test/a11y-contract.test.js` and
  `test/rail.test.js` confirm the layout keeps its accessibility, adaptive
  overflow, and rail contracts.
- Transcript turns now carry explicit hierarchy (`assistant-turn`, `user-turn`,
  `system-turn`, `tool-turn`): assistant prose is open and calm, user prompts
  are compact right-aligned cards, and tool/system containers remain prominent.
  Assistant usage telemetry now starts with a muted inline `turn N` label. Added
  `test/transcript-layout.test.js` for the visual contract.
- The composer is now one calm writing block: the input uses an inset surface,
  actions sit behind a quiet divider, mobile keyboards get `enterkeyhint="send"`,
  image drag/drop visibly highlights the drop target, and the visible Image picker
  follows the selected model's image capability. Added
  `test/composer-layout.test.js`.
- Both sidebars now share the same restrained hierarchy: the workspace/session
  drawer has separated sections and clearer active rows; the inspector rail has
  quiet tab boundaries, visible compact labels, higher-contrast readable badges,
  a roomier inset pane, and a more deliberate pane head. Workspace sections
  gained semantic labels; `test/sidebar-layout.test.js` covers the
  visual/accessibility contract.
- Pending approval modals now keep a persistent `Waiting for approval` state,
  focus the first actionable control after async diff rendering, and restore
  focus to the prior control or composer on close.
- The Usage rail widget now gives the total cost a primary treatment and uses a
  readable two-column summary for the roomier pane, with token cards retaining
  their labels instead of collapsing into a cramped six-card row. Missing
  provider cost data is now explicit, with output-token and no-turn fallbacks
  instead of an empty cost section. The per-turn bars also have a definite chart
  height, so their percentage heights render instead of collapsing to zero. A
  current-context line now overlays the cost bars point-for-point by turn, with
  the legend identifying it separately from cost. The live chart now refreshes
  from incoming messages/stats, shows the last 100 billed model turns, and
  labels the graph `TURN HISTORY`; the subtitle distinguishes billed model
  turns from the transcript's visible-turn numbering. Turn tooltips include
  context percentage, and token counts use compact `k`/`M`/`B` notation.

### 2026-08-18 — feat(webui): calm conversation density and grouped tool activity

- `public/app.js` now presents the persisted detail modes as **Focus / Balanced /
  Trace**, with Balanced (`semi`) as the new default; legacy saved values remain
  compatible. The header and command palette no longer expose the implementation
  names `simple / headers / detailed`.
- Consecutive live and replayed tool calls are wrapped in a native turn-local
  `.tool-group` disclosure (`N tools · state · elapsed`). Running calls open the
  group; successful groups collapse outside Trace; errors remain open and visible.
  Crash finalization also settles the group state, so reconnect replay cannot leave
  a stale "working" summary.
- `style.css` removes nested card shadows inside the group and makes Balanced hide
  successful raw outputs (the prior selector did not match the `.out-wrap` DOM).
  `public/tool-presentation.js#toolGroupSummary` is pure and covered by the new
  `test/tool-presentation.test.js`.

### 2026-08-17 — feat(webui): usage bar + todo panel moved fully into the rail

- Header `#usagebar` and in-flow `#todopanel` are GONE; quota windows and the
  todo list now render only in the rail's Quotas / Todos widgets (`app.js`:
  `refreshUsageBar` re-scoped to feed `quotaBadgePct` + the open panel,
  `renderTodos` delegates to the Todos widget; `index.html` elements removed).
- The Quotas modal (`showUsage`) is deleted — the rail widget owns forms
  (key + OpenCode Go creds) and refresh; palette "quota usage" / "agent todos"
  open the rail widget directly (PARITY flags for quotas/todos retired).
- Open rail widgets now AUTO-REFRESH: `refreshRailWidget` honors each widget's
  `interval:N` policy (SDD manual/plan-poll, analysis 10s, git+quotas 60s,
  todos 5s) with scroll preservation; event paths (todo ops, quota poll, git
  mutations, plan-state) still push immediately.
- `quotaBadgePct` now live (was a `const null` placeholder) — the Quotas tab
  badge shows the tightest window's percent once the poll resolves.
- Rail todo-row CSS retargeted `#todopanel` → `.tools-pane`; dead `#usagebar`/
  `.ub-*` CSS removed. test/rail.test.js 65 → 68 checks.

### 2026-08-17 — feat(safeguard): bash-sensitive path protection (closes `cat .env` bypass)

FR-7 sensitivePaths applied only to path selectors — bash selectors matched the
verb allow-regexes, so `cat .env` / `grep -r KEY .env.local` auto-allowed in
auto-approve (and even default) mode. The gate now computes a per-call
`bashSensitive` override: `bash-classifier.js partCanonTokens` (expansion +
join + realpath, centralising the previously duplicated `isOutsidePart` logic)
feeds `policy-engine.js bashSensitiveFor`; `resolve()` honours
`opts.bashSensitive` for bash and `/api/permissions/explain` mirrors it.
Sensitive tokens inside the workspace now produce the same mandatory-ask /
hard-deny as the `read` tool; a hit on ANY compound part blocks the whole
command in every non-yolo mode. Benign recon stays silent. Also uninstalled
`@gotgenes/pi-permission-system` (an independent bash-ask gate that overrode
the webui auto-approve; see GOTCHAS #23).

### 2026-08-15 — feat(subagents): async fleet page + notices (pi-subagents plugin support)

The pi-subagents plugin's background side was invisible in the webui: its
TUI fleet widget and `/sfleet` never cross RPC, and its custom messages
(completion/steering/control notices) rendered as generic markers — or not at
all until reload. The foreground `subagent` tool view (GOTCHAS #14) was
already covered.

- **`subagents.js`** (new, zero-dep): discovers the plugin's temp roots
  (`<tmp>/pi-subagents-*/async-subagent-runs/`), projects each run's
  `status.json` (512 KB cap, malformed skipped — a half-written file can't
  500 the listing), tails `output-<i>.log` / `subagent-log-*.md` (32 KB tail),
  and delivers STOP/STEER through the plugin's portable file control inbox
  (`control/stop.json`, `control/steer-requests/<padded-ts>-<b64url>.json` —
  atomic temp+rename, envelopes matching
  `pi-subagents/src/runs/background/control-channel.ts`). Run ids validated
  (charset + must resolve to a discovered dir — no traversal); the internal
  `dir` path is stripped from client payloads. Routes: `GET /api/subagents`,
  `GET /api/subagents/log`, `POST /api/subagents/control` (behind the existing
  CSRF/origin gate). `subagents.js` added to `package.json#files` (caught by
  `test/package.test.js`).
- **`#fleet` page** (`public/index.html` + `app.js` + `subagents-ux.js` +
  `style.css`): in-shell page like settings/permissions (`#fleet` hash, 2 s
  poll while open). Rows show description/agents, state chip (running green,
  paused/queued amber, failed red), mode · agents · elapsed · turns · current
  tool; steps with per-child status + log buttons; failed runs surface the
  error and keep a run-log button. Logs open inline (cached in `fleetLogs` so
  the poll re-render never clobbers an open log). Stop is confirm-gated; steer
  sends to the selected row (click to select; auto-targets the only active
  run when none is). Opening one page closes the others, and each page only
  clears its OWN hash (closing fleet mid-`#permissions` navigation can't wipe
  that route — the guard was added to `closePermPage` too).
- **Notices** (`renderNoticeMsg` in `app.js`, pure builders in
  `subagents-ux.js`): custom messages with customType `subagent-notify`,
  `subagent_steering_notice`, `subagent_control_notice` render as colored
  notice cards from BOTH `message_end` (live — previously invisible until
  reload) and `renderMessage` (reload), so the two can't diverge. Generic
  custom messages now render live too (same renderer as reload — parity).
  `subagent-notify` uses details `{agent,status,taskInfo,durationMs,
  resultPreview,session*}` when present, content-markdown fallback otherwise.
- **Log fallbacks (found live)**: workflow-mode runs write no `output-<i>.log`
  — step logs now fall back to the child transcript under the project-local
  `<cwd>/.pi-subagents/artifacts/<id>_<agent>_<i>_transcript.jsonl`
  (agent + nearest-start-ts correlation, 16 KB head with regex `ts` extraction
  because fork-context prompts make line 1 unparsable whole), rendered as
  readable lines (`▸ user`, `→ bash …`, `✓/✗ tool`, assistant text). Run log
  falls back from `subagent-log-*.md` to formatted `events.jsonl`. Step-log
  buttons encode row position (workflow steps carry no `index` — previously
  every button sent 0). subagents.js: 31 tests.
- **Honest stop UX (found live)**: a workflow run reports `complete` even
  when every child failed — rows now derive the chip from step statuses
  (all-failed → red `failed`, mixed → `done` + `N✗` meta). Manual stop is
  graceful (parks on hung LLM calls), so the listing projects `stopRequested`
  (stop.json pending + active) → "stopping" chip and the stop button
  escalates to "force stop" writing `control/timeout.json` (the same path
  the 30-min runtime cap uses — kills children decisively).
- **Notice content parsing (found live)**: some delivery paths attach no
  machine-readable `details` to `subagent-notify`, and the old fallback
  painted every such notice red ("✗ subagent · ?") even for completions.
  `notifyHtml` now parses the plugin's own markdown header
  (`Background task[s] <status>: **agent**[(n)]`, mirroring notify.ts
  `parseSubagentNotifyContent` + the grouped form), taking agent, status and
  the first preview line from it; fully unparseable content renders NEUTRAL,
  never red. subagents-ux: 37 tests.
- **Transcript correlation is deterministic now** (found live): parallel
  same-agent children spawned ~100 ms apart cross-matched under ts-proximity
  (step 1 showed its sibling's log). The child run id in the step's
  `sessionFile` (`…\<childRunId>
un-0\session.jsonl`) matches the artifact
  filename prefix exactly; ts-proximity remains only as fallback.
  subagents.js: 37 tests.
- **`cd` compounds stop prompting** (found live): `cd <cwd> && git status`
  always asked because `cd` was in neither the classifier's read-only set
  nor the floor's verb-allow regex. `cd` is read-only (chdir never touches
  the disk) and its path argument stays containment-checked —
  `cd <outside> && ls` still flags outside → ask, `cd <cwd> && npm test`
  still asks (npm isn't read-only).
- Palette: "subagent fleet" command. Tests: `test/subagents.test.js` (24 —
  listing/ids/stop/steer/log-tail/roots; test temp dirs use a non-matching
  prefix + self-cleanup so they never pollute the real scan) and
  `test/subagents-ux.test.js` (27). Full suite 32/32. Live-smoked against a
  real server (routes + static + unknown-id error paths).

### 2026-08-15 — fix(policy): end the benign-command prompt storm (SEC-02a/02b refinement)

Root cause of "why does grep/sed prompt every time": three stacked effects. (1) SEC-02a removed `env/find/sed/awk/sort` from the name-only READONLY set — every benign use classified `mutate`. (2) The floor `bash` table never had allow rules for the recon verbs (`grep`, `cat`, `head`, …), so the FR-9 compound gate reported "no allow rule" for them. (3) SEC-02b bound mode-induced allows to that gate — in `auto-approve`, every bash command not fully allow-ruled now prompts (by design), which surfaced (1)+(2) as a prompt storm. A fourth bug kept fixes from landing for existing users: `mergeTwo` replaced a user's `bash` table WHOLESALE, so floor improvements were invisible to anyone with an existing table.

- **Classifier is argument-aware now** (`bash-classifier.js`): the benign forms classify read-only again — `sed -n 1,5p f` / `sed s/a/b/ f` (no `-i*`/`-f*`/`--in-place`/`--file`, script carries no `w FILE` write command or `>>`), `find . -name x` (no `-delete`/`-exec*`/`-ok*`/`-fprint*`/`-fls`), `sort f` (no `-o`/`--output`), `awk '{print $1}'` (program has no `>`/`|`/`system(`/`getline` — comparisons like `$1 > 5` conservatively prompt), `env`/`env K=V`/`env -i ls` (a following command classifies as that command: `env rm -rf .` → mutate). Every SEC-02a review-evidence mutation still classifies `mutate`.
- **Floor allow-rules the recon verbs by verb** (`policy-engine.js` DEFAULT_CONFIG): one anchored regex covering the READONLY set + the five argument-sensitive verbs. Safe because an allow rule alone never suffices for bash — the compound gate still requires argument-aware read-only classification AND per-part rules, and SEC-02b keeps mode bypasses behind the same gate: `sed -i s/a/b/ f` matches the allow RULE but `gate.allow=false` → asks in every mode (locked by test).
- **`mergeTwo` unions object tool tables per key** (high key wins): a user's existing `bash` table no longer wholesale-shadows the floor — floor allows/denies reach everyone, user same-key entries still win (tightening preserved), scalars/arrays still replace wholesale.
- Verified against the live user config (auto-approve): `grep -rn foo src/`, `sed -n 1,5p server.js`, `cat x | head -5`, `find . -name '*.md'`, `sort x`, `awk '{print \$1}'`, `env | grep FOO` → silent allow; `sed -i`/`find -delete`/`sort -o`/`env rm -rf .` → prompt; `rm -rf /` → hard deny. Tests: bash-classifier 18/18 (7 new blocks), policy-engine 56 checks (floor rules + union merge + gate binding), full suite 30/30.
- Needs a pi restart to take effect (the extension `require`s the engine at spawn): `/webui-stop` + `/webui`, or restart `node server.js`.

### 2026-08-15 — fix(trust): close the trust-boundary findings (SEC-03/07/17, REL-24, U7 SDD run)

SDD run `trust-boundary` (plan/spec/tasks/verify archived). Four findings spanning the browser↔server↔IDE trust boundary; every fix landed with failing-first tests (Node 30/30 incl. a NEW `test/trust-boundary.test.js`; Kotlin DiffBridgeTest 12/12).

- **SEC-03** (9.6): `server.js` no longer spawns pi with `--approve` — project-local extensions of the opened workspace are NOT trusted anymore. The bundled bridge extension loads explicitly via `-e <__dirname>/extensions/pi_minimal_webui/index.ts` (package-root relative, so a workspace switch can't redirect it); a missing extension degrades loudly (warning + `--no-approve` alone — fail toward no-project-trust, never silently back to `--approve`). `PI_ARGS=--approve` remains the documented explicit opt-in (appended last, wins).
- **SEC-07** (8.8): approval decisions are now validated **server-side** against the options the gate offered. `broker.js` normalizes the offered options to labels; `resolve()` rejects a decision whose label (string or `{label,…}` object) isn't among them → `invalid-option` 410, and the record **stays pending** so a correct client can still answer. The mandatory-ask → "Allow always" upgrade path from the IDE is closed. Client side: the IDE payload carries `options` (the button bar renders only those — see below); a rejected IDE decision falls back to the webui select modal (`invalid-option`) or toasts (answered elsewhere).
- **SEC-17a/b/c** (7.6): the IDE diff gate fails closed — malformed bridge JSON (`DiffBridge.parsePayload` → null) resolves Deny with no editor tab instead of an empty approvable diff; an ALLOW against a file that changed on disk mid-review is **blocked** until "Re-read file" rebuilds the diff on the fresh base (Deny always resolves); `DiffReviewFile.decide()` is now `AtomicBoolean` compare-and-set (exactly one resolution, double-click/dispose race safe).
- **REL-24** (5.6): overlapping IDE approvals no longer cross-resolve — the injected page keeps an id-keyed `__piDiffResolvers` map (`payload.requestId`-keyed; the page assigns the id before stringify so both ends agree; unknown id/double resolve = no-op), and a parent `Disposable` now owns the JS query, the load handler (`removeLoadHandler()`), and the browser, released on tool-window close.
- Kotlin side lands in a NEW pure helper object `jetbrains/…/DiffBridge.kt` (parse/compose/normalize/stale helpers + the `DiffPayload`/`EditHunk` shapes, `options` added) with `DiffBridgeTest.kt` — runnable via `cmd.exe /c` + Rider JBR (`JAVA_HOME`), which un-blocks agent-side Kotlin testing (GOTCHAS #17 only bans the sh-wrapper).
- Wire compatibility preserved: `piWebuiOpenDiff(payload) → decision` promise, `extension_ui_response` + marker, safeguard labels, broker record shape (additive `optionLabels`); old/new plugin↔webui pairs degrade safely.

## Changelog

### 2026-08-11 — fix(policy): close six security-review findings (SEC-01/02/04/06/14/15, U7 SDD run)

SDD run `policy-hardening` (plan/spec/tasks/verify, archived) fixed 12 requirements in the shared policy engine + classifier + safeguard gate. Every finding's review evidence was reproduced as a failing test first; full suite 29/29 green after.

- **SEC-01** workspace tighten-only: scalar workspace rules now compare against EVERY inherited subrule via `strictestActionFor` (deny>ask>allow) — `bash:"ask"` can no longer shadow built-in `rm -rf /` denies; workspace `grants`/`nonInteractive` rejected with diagnostics; `sensitivePaths` merge additively + tighten-only (allow entries dropped); `effective` derives from the FILTERED workspace layer so the Permissions page can never show rules the gate rejected. (`policy-engine.js`)
- **SEC-02** read-only mode: `env/find/sed/awk/sort` out of the name-only `READONLY` set (argument-sensitive: `env rm -rf .`, `find . -delete`, `sed -i`, `awk 'system()'`, `sort -o`); `git remote -v remove origin` correctly mutates (flags skipped before the subcommand). Mode transforms now bind bash: read-only read-class requires the per-part gate (`bashGate.allow`), auto-approve never lifts a gated bash ask; yolo stays the session-only override. (`bash-classifier.js`, `policy-engine.js`, `safeguard.ts`)
- **SEC-04** path containment: recon-tool JSON selectors (grep/find/ls/glob) canonicalize + containment-check each path field independently (`ls {"path":"/etc/passwd"}` caps at outside-workspace ask); relative paths collapse `.`/`..` lexically before the containment check (`sub/../../outside/new.txt` hard-denies); missing targets realpath their NEAREST EXISTING ANCESTOR (in-workspace symlink to outside no longer passes). (`policy-engine.js`)
- **SEC-06** Windows: path matching normalizes `\`→`/` so `**/.env*` etc. hit `C:\proj\.env` (mandatory-ask) and `C:\proj\id_rsa` (deny); POSIX byte-identical.
- **SEC-14** persisted `mode:"yolo"` normalizes to `default` in every layer with the existing diagnostic — a hand-edited config can never flip a hard-deny; yolo remains session-only state.
- **SEC-15** fail-closed config: malformed user/workspace JSON keeps its LAST KNOWN GOOD parse and surfaces a visible warning via the gate (new `errors` channel on `loadLayers`; mtime -1 forces rebuild until the file parses again); `saveConfig` writes atomically (temp + rename) and returns success; a failed "Allow always" save now BLOCKS the call with a warning instead of releasing it as if the grant persisted (Allow once/session unaffected — no write needed). (`safeguard.ts`)
- Test harness note: Node 24's type-stripping loader caches `.ts` per file (survives `require.cache` deletion), so the new behavioral safeguard tests load a per-scenario module copy to get a fresh `CONFIG_PATH` per HOME. The behavioral block drives the REAL gate with a mock pi API against temp HOME/workspace dirs.

### 2026-08-11 — test: repair three stale/broken tests (TEST-01)

- `test/a11y-contract.test.js`: the rail-resize assertion checked for `resizeStep(` in `app.js`, but the math moved to `public/a11y-contrast.js` (app delegates via `a11y && a11y.resizeStep`, unit-tested in `rail-resize.test.js`). Assert the delegation instead.
- `test/permission-ux.test.js`: two stale contracts from the 08-11 modal rework — the ask modal no longer forces wide (`showModal("", false)`, width only with diffs per `bce9bcf`) and `openSelectModal` lost its `notify` flag (toasts live in the ask/input/editor branches). Assertions updated to the current behavior.
- `test/rpc-sse.test.js`: `ReferenceError: res is not defined` when an SSE request timed out before the response callback ran — `res` was scoped inside the `http.get` callback but referenced in the timeout handler. Hoisted it. Also TEST-01's two hangs: `sseCollect` capped on an idle `req.setTimeout`, which the server's SSE heartbeat defeats (never fires → infinite hang when the predicate never matches) — now a 12s wall-clock cap; and the snapshot assertion waited for the removed `snap-state` id (server mints random ids) — now asserts ≥5 fan-out responses broadcast on a fresh SSE connection plus a well-formed body check.
- All 29 `test/*.test.js` now pass (the 08-11 CHANGELOG claim "all 27 non-integration tests pass" had gone stale).

### 2026-08-11 — fix(release): ship all root runtime modules + bump markdown-it (REL-01, DEP-01)

- `package.json#files` listed only `server.js`/`bin.js`/`public`/`extensions`/`skills`; the other nine root runtime modules (`broker`, `git`, `isolated-prompt`, `jsonl`, `livebuf`, `recent-sessions`, `session-entries`, `workspace-file`, `workspaces`) were omitted, so any `npm install pi-webui` failed with `MODULE_NOT_FOUND`. Added all nine; `npm pack --dry-run` now includes 41 files, none missing.
- Added `test/package.test.js` — static guard that every root `require("./x.js")` in `server.js`/`bin.js`/shipped modules is covered by the `files` whitelist (faster than `npm pack` in CI; catches the same omission class).
- Vendored `public/vendor/markdown-it.min.js` 14.1.0 → 14.2.0 (CVE-2026-2327 / GHSA-38c4-r59v-3vqw, reachable through the enabled `linkify` path; smartquotes advisory not reachable with `typographer:false`). Same UMD shape (`window.markdownit`), no loader change; `md()` smoke test passes.
- Pre-existing (not from this change): `test/a11y-contract.test.js` + `test/permission-ux.test.js` fail against current `app.js` (stale assertions after 08-11 modal/a11y rework) — tracked under TEST-01. `test/rpc-sse.test.js` throws `ReferenceError: res is not defined` when an SSE request times out — also TEST-01.

### 2026-08-11 — fix(webui): a11y-contrast.js actually loads in the browser

- Module lived at repo root with an unguarded `module.exports` — never loaded by
  `index.html`, never shipped by npm, yet `app.js` calls `resizeStep`/
  `statusTextForEvent` (ReferenceError on rail-resize/status events).
- Moved to `public/a11y-contrast.js` with the dual-mode guard +
  `window.a11yContrast` export; added the `<script>` (before `app.js`) and the
  `server.js` `STATIC` entry; test requires updated.

### 2026-08-11 — chore(extension): drop orphaned subagent-tier config

- `subagent.ts` (tier-based tool) was removed earlier; the sidebar tier selects,
  the app.js tier block, and `GET/POST /api/subagent-tiers` were still wired.
- Removed all three; `safeguard.ts` comment no longer references `subagent.ts`;
  AGENTS.md + GOTCHAS.md #15 updated. Builtin pi `subagent` tool, its live view,
  and the policy gate stay.

### 2026-08-11 — test: rpc-sse smoke test fails fast without a server

- `test/rpc-sse.test.js` is integration-only (needs a booted server on PORT);
  it now preflights `GET /api/health` and exits 1 with boot guidance instead of
  a bare ECONNREFUSED. Also fixed the stale `../style.css` link in
  `docs/design.md` (→ `public/style.css`).

### 2026-08-11 — fix(approvals): use full-page interaction modals

- Removed in-card approval controls. Every blocking tool select, confirm, input,
  editor, and ask-user interaction now opens in the full-page modal and emits a
  visible warning notification; tool cards remain status-only.
- `applyState()` now clears the activity row when authoritative state says idle,
  preventing stale “thinking…”/tool status after a missed terminal event.

### 2026-08-11 — fix(composer): restore action and approval controls

- Added the missing `agent_start` switch break so streaming stays active and the
  Stop/send-mode controls work until `agent_end`; made safeguard provenance
  mutable so live mode updates no longer throw.
- Composer overflow actions now auto-close only in the narrow popover, rather
  than collapsing the always-inline wide toolbar. Confirm replies now include
  pi RPC's required top-level `confirmed` field.
- Added focused guards in `status-race.test.js`, `permission-ux.test.js`, and
  `shell-contract.test.js`; all 27 non-integration Node tests pass.

### 2026-08-10 — docs(security): record rated project review

- Added [`docs/security-review.md`](docs/security-review.md): security-first review
  of the current working tree with severity ratings, source evidence, reproduced
  policy/path/Git failures, verified controls, and a remediation order.
- Records the release-blocking npm package omission, permission-policy bypasses,
  process/Git/browser boundaries, reachable markdown-it advisory, and test gaps.
  Findings remain open; this entry records the review, not remediation.

### 2026-08-10 — feat(containment): outside-workspace access is at least ask in every non-yolo mode

- **Path tools** (read-class): `resolve` tracks whether the canonical path
  escapes the workspace root; `buildVerdict` caps rule-allow at ask with a
  new `outside-workspace` tier (`outsideRoot` flag + reason). `applyMode`
  can't lift it: auto-approve only lifts `ordinary-ask`, and read-only's
  read-class auto-allow skips the tier. write/edit outside root stay
  hard-deny (stronger than ask). Grants (exact-selector approvals) and yolo
  (explicit session override) still win.
- **Bash**: new `partPathTokens` (quote-stripped path-like args per
  subcommand) + `gateBash(…, isOutside)` marks the command `outside` when any
  part touches an outside path; safeguard.ts blocks the auto-approve/read-only
  mode-bypass for outside commands (falls through to the ask flow, tier
  `outside-workspace` in the provenance + approval card). The explain endpoint
  injects the same realpath-aware containment so the page can't diverge.
- Named ceiling: no shell parser — `$(…)`-built / `$VAR`-prefixed paths are
  invisible (GOTCHAS #21). Headless (`nonInteractive=allow`) still can't
  prompt — that knob governs headless.

### 2026-08-10 — feat(permissions): composer mode chip + in-page rule editor

- **Mode chip** (`#mode-chip`) sits in the composer bar, always visible: shows
  `default` / `auto-approve` / `read-only` / `⚠ yolo`, colored by posture
  (muted / amber / red), click opens the permissions page. Persisted modes
  poll via new `GET /api/permissions/mode` (piggybacked on `refreshStats`);
  yolo is session-only so the extension now broadcasts it — safeguard.ts
  emits `setStatus("safeguard", {mode})` on yolo engage and `session_start`,
  app.js flips the chip from that (and from every blocking-select
  provenance broadcast, which already carried mode).
- **Rule editor** on the permissions page: the "effective policy" section is
  now "rules" with an add row (tool + pattern + effect → user config via the
  existing revision-checked PUT) and an `×` remove button on every
  user-layer rule (floor + workspace rows stay locked; workspace layer is
  tighten-only via its own file). Pure helpers `applyRule`/`removeRule` in
  permissions-ux.js (unit-tested); a string tool rule converts to `{"*": …}`
  form so defaults survive adding a pattern.
- Fixed `buildLayerTree` action precedence: the displayed action for a rule
  present in multiple layers was the LAST (lowest-priority) layer's — now the
  highest-priority one (the effective action).
- `perm-tools` datalist (referenced but never defined — explain input had no
  suggestions) is now populated from the layer tree + known tools.

### 2026-08-10 — ui(utility pages): settings + permissions are real in-shell pages; permission modal is full-screen

- `#settings` and `#permissions` are no longer a right drawer / fixed overlay:
  both are flex children of `body` that replace the center transcript/composer
  column while open (`body.page-open` hides `#scroll-wrap`, `#todopanel`,
  `footer`, `.activity`; the shell header stays) — implementing design.md §4
  ("utility views reuse the shell and replace the center region"). Shared
  chrome `.perm-head`/`.perm-body`; `#settings-back` removed. GOTCHAS #15.
- The permission/approval modal (any `#modal .card.wide` — editable diff,
  preview stack, U6 C9 flows only) is now a REAL full modal: opaque surface,
  fills the viewport edge-to-edge, x button re-anchored inside. Non-permission
  dialogs (usage/git/sessions/ask) keep the centered card.

### 2026-08-10 — fix(permissions): Explain failed — module never loaded in browser

- **Root cause**: `public/permissions-ux.js` was not in `server.js`'s `STATIC`
  whitelist → the browser got a silent 404 and the script never ran
  (`window.permissionsUx` undefined → `pu.explainView` threw on the Explain
  click). Node tests passed because `require()` bypasses the HTTP surface.
  Two latent landmines fixed in the same file while making it browser-safe:
  bare `module.exports` (ReferenceError in the browser) → guarded dual-mode
  export, and a top-level `const api` (collided with app.js's `function api`
  in the shared global scope → SyntaxError killing app.js) → IIFE, matching
  the `diff-view.js` house pattern. Verified with a fresh headless-Edge CDP
  probe: `#permissions` page opens, `explainView` returns the verdict object,
  zero console exceptions. Gotcha: GOTCHAS.md #20.

### 2026-08-10 — fix(ui): left sidebar vanished (app.js TDZ abort)

- **Root cause**: a section reorder put the top-level
  `registerCommand("permissions", …)` call (`public/app.js`, permissions page
  section) BEFORE the `const uiCommands = []` registry declaration (command-palette
  section). The `ReferenceError: Cannot access 'uiCommands' before initialization`
  at script evaluation aborted the whole file — `initWsbar` never ran, so
  `body.ws-on` was never set and `#wsbar` stayed off-canvas (`translateX(-100%)`
  drawer state in `w-mid`/`w-narrow`); the SSE `onopen` handler (attached earlier,
  firing async) then also threw on the uninitialized `let noSwitch`.
- **Fix**: moved the permissions registration into the "register built-in UI
  commands" section, after the registry exists. Verified with a headless-Edge CDP
  probe (no console exceptions, `ws-on` set, workspace + session rows render).
  Gotcha documented: GOTCHAS.md #19.

### 2026-08-10 — permissions: U6 policy engine, approval broker, modes, #permissions page

- **Policy engine** (`extensions/pi_minimal_webui/policy-engine.js`, new, zero-dep
  CommonJS — the SINGLE resolution implementation shared by the extension gate and
  the server page/Explain): verdict `{action,tier,matchedRule,layer,reason}` with
  provenance; precedence hard-deny → mandatory-ask → remembered-grant → ordinary-ask
  → allow; layered config (shipped floor → `~/.pi/agent/safeguard.json` →
  `<cwd>/.pi/safeguard.json`, workspace tighten-only — loosening rules rejected with
  diagnostics); v2 schema (`version`/`revision`/`mode`/`sensitivePaths`/`grants`),
  atomic revision-checked writes; canonical path resolution + `sensitivePaths`
  mandatory-ask/deny on EVERY path-capable tool (grep/find/ls/glob too);
  `applyMode` (default/auto-approve/read-only + session yolo).
- **Bash classifier** (`extensions/pi_minimal_webui/bash-classifier.js`, new, pure):
  quote-aware compound splitting on `&& || ; | &` + substitution/redirect/background
  flags; a command is auto-allowable only when read-only AND every subcommand is
  allow-ruled and none deny-ruled. **The 3 roadmap bypasses are closed even against
  stale configs**: `git status && rm -rf ./src`, `echo $(cat ~/.ssh/id_rsa)`,
  `git remote remove origin` all resolve gate.allow:false (verified live).
  `echo` + mutating git verbs removed from the shipped floor; git recon allowlist
  narrowed to status|log|diff|show|blame|ls-files|branch --show-current|remote -v.
- **Modes** (user request): default / auto-approve (ordinary-ask → allow,
  sensitive/deny stay) / read-only (read-class only, silent deny + notify,
  coordination tools exempt) / **yolo** (everything allows, NO prompts,
  session-scoped, confirm-gated, never persisted — config with `mode:"yolo"` is
  rejected). "Allow always" now writes an exact-selector `grants` entry (the FR-9
  compound gate is binding for rule-based allows, so grants are the explicit
  bypass).
- **Approval broker** (`broker.js`, new, pure): server-owned pending registrations
  for every blocking extension-UI request (tool identity via the preceding
  `tool_execution_start`); first-response-wins, stale/unknown ids rejected (410),
  `approval_resolved` broadcast, cleared on pi exit/workspace switch, replayed via
  `/api/snapshot` `pendingApprovals` so a reload re-renders the approval.
- **Browser wire** (`public/app.js`): `toolCallId`-keyed args map replaces the
  `curToolArgs` singleton in permission paths; version-1 marker
  `{v:1, toolCallId, decision}` on every approval response (server validates
  identity, strips the marker, forwards the unchanged payload); ack-before-close
  (UI closes only on `approval_resolved`; 2s watchdog; Esc/backdrop = Deny via the
  same path; stale marker keeps the UI with retry); snapshot replay of pending
  approvals; the safeguard `setStatus` provenance context (tier/rule/layer/reason/
  mode) is stashed, not shown in the statusbar.
- **In-card approval** (`public/app.js` + `style.css`): the decision surface now
  renders IN the tool card (risk banner + matched rule + layer + Review/Edit diff +
  buttons; mandatory-ask offers only Allow once/Deny), bottom-sheet via
  `body.w-narrow` at narrow widths (no media queries — U1 shell contract), modal
  fallback for offscreen/reload; ≤50 decision receipts.
- **`#permissions` page** (`public/index.html` + `app.js` + `permissions-ux.js`
  dual-mode helpers): hash-routed, reachable from settings + command palette;
  posture select (yolo confirm step), Explain form (same engine as the gate +
  per-part bash breakdown + auto-allowable flag), effective policy layer tree with
  per-rule layer badges, diagnostics, numbered session-grant revoke + clear-all,
  redacted decision audit. Settings sidebar gains a mode select. Fixed
  `/api/permissions` endpoints only (GET / PUT config / DELETE grants[:n] /
  POST explain / GET audit) — browser never touches policy files.
- **JetBrains** (`jetbrains/`): canonical workspace containment
  (`WorkspaceContainment`, unit-tested) gates the native diff's filesystem reads;
  mid-review file-change conflict flag on edited decisions; mode badge + YOLO
  warning in the native top bar; requestId/toolCallId ride the bridge payload.
- Tests: 7 new suites (~90 assertions) + gradle test task green
  (`JAVA_HOME` must be ≥17; WebStorm JBR 21 used). Full suite green; rpc-sse
  remains environmental. Live e2e verified: broker register → marker-validated
  resolve → broadcast → 410s → audit; mode PUT/409/400 round trip; bypass
  gate.allow:false.

- `public/app.js` (fetchSnapshot race): the snapshot is a point-in-time bundle —
  `get_state` is read on the server BEFORE the possibly-multi-MB transcript is
  serialized. When a turn ended while the snapshot was in flight, the live SSE
  stream consumed `agent_end` (Node's live buffer cleared), then the stale
  snapshot applied + replayed the buffer — re-arming the activity bar with
  `writing…` — and the finalize branch was skipped because the STALE
  `isStreaming:true` said the turn was live. Nothing left could reset it: the
  spinner + label stuck on "writing…" until a reconnect.
- Fix: after applying the snapshot + replay, `fetchSnapshot` issues a fresh
  `get_state` (`id: "snap-recheck"`); the response handler finalizes the turn
  (via new shared `finalizeDeadTurn()`) only when pi is freshly idle AND no new
  `agent_start` has fired since the capture (`agentStarts` counter — bumped on
  EVERY agent_start, live or replay, so a new turn can never be clobbered). The
  recheck deliberately does NOT `applyState()` — a stale `isStreaming:true`
  captured by the check itself must not re-arm the spinner after the live
  stream already reset it. The pre-existing `!piStreaming` dead-turn branch
  now shares `finalizeDeadTurn()`.
- `test/status-race.test.js` (new): source-level structure audit of the guard
  - a state-machine simulation of both semantics — stale snapshot converges to
  "ready"; a new turn during the recheck is untouched.

### 2026-08-07 — a11y: loaded-session replay rendered into a detached feed (fix)

- `public/app.js` + `public/index.html` (post-slice bug): the a11y feed
  refactor made `#tfeed` a child of `<main id="transcript">`, but all
  three history-clearing sites still called `setSafeHtml(transcript, "")`
  — clearing `<main>` DESTROYED the feed element, so loaded/resumed
  sessions rendered into a detached node and appeared blank (live chat
  kept working: the feed existed until the first clear). Fixed:
  `applyMessages`, the `workspace_changed` handler, and `resumeSession`
  now clear `feedEl`; `applyMessages` reads `feedEl.lastChild` for
  `data-mi`; the empty-state moved OUT of the feed (now a sibling of
  `#tfeed`) so it survives clears. Regression guards added to
  `test/a11y-contract.test.js` (no `setSafeHtml(transcript`, ≥3
  feed-clears, `feedEl.lastChild`).

### 2026-08-07 — a11y: tested contrast contract + native controls (U2/A4 slice)

- `a11y-contrast.js` (new, Node-only): zero-dep WCAG relative-luminance /
  contrast math, a theme-token scanner (bare `:root` + `[data-theme=…]`
  blocks; media-nested blocks + comments stripped; color-mix/rgba/short-hex
  ignored), `resizeStep` (splitter keyboard math), `statusTextForEvent`
  (coarse-progress mapping).
- `test/contrast.test.js` (new): 16-row pair table × both themes = 32
  asserts ≥4.5:1. Paperlike `--muted`/`--secondary`/`--accent`/`--success`/
  `--warning` darkened to pass (e.g. muted 3.04→4.84 on raised, accent
  3.89→5.49); dark theme untouched (`:root` unchanged) and proven.
- `test/a11y-contract.test.js` (new): source-level audit of the REAL
  files — native disclosures/icon buttons with accessible names, a
  hover→focus-twin auto-audit (zero violations), region labels, status /
  busy wiring, per-control 24px touch rules.
- `public/app.js`: tool-card heads converted from `<div role="button">` to
  native `<button aria-expanded>` (the app's only role="button"); turns
  render as `<article class="msg">` with `aria-labelledby` → `turn-N-role`
  ids in a new `#tfeed` (`role="feed"`, kept inside `<main>`); tool
  blocks and compaction markers are articles too; `#a11y-status`
  (`role="status"`) announced at turn boundaries only (never per token);
  `applyMessages` brackets the DOM mutation with `aria-busy`; the sdd
  rail splitter is now focusable + arrow/Home/End-operable with live
  `aria-valuenow` (pure `resizeStep`).
- `public/style.css`: 24px touch floors (ws-x, ws-open, imgthumb-x,
  ws-mini, set-x, sdd-close, toast-x, um-refresh), rail-resize 24px hit
  zone via `::after` + `.sdd-rail` left-padding reservation,
  `@media (hover: none)` keeps the handle visible, `scroll-padding-top`
  under the sticky diff hunk labels, `.sr-only` clip class.
- `public/index.html`: `#tfeed` feed wrapper, `#a11y-status`, `#input`
  `aria-label="message composer"`, `#ws-new` `aria-label="new session"`.
- Decisions: feed over log (log's implicit aria-live would announce every
  streamed token); scroll-padding goes where sticky children actually
  exist (inside diff boxes); palette listbox options are exempt from the
  focus-twin rule (their `.sel` highlight shares the hover rule).

### 2026-08-07 — diff(editable): Review/Edit split + versioned apply (U5/A5 slice)

- `public/diff-view.js` (new, dual-mode): LCS row builder (`diffLines`/
  `diffRows`, ported verbatim from app.js), monotonic gutter reserve
  (`gutterReserveCh`, digits+1, never shrinks), `dirty`, `largeHunkExceeds`
  (4M-cell guard), `lineCountOf`. Registered in the STATIC whitelist + load
  order before app.js.
- `workspace-file.js` (new, server-side): `versionOf` (sha256 hex) +
  fs-injected `writeWorkspaceFileIfVersion` — hash must match, `null` =
  create-only, missing field = 400, mismatch = 409 with the current version.
- `server.js`: `/api/file` returns `version`; `/api/write` requires
  `expectedVersion` — the apply-time read→write version closes the TOCTOU
  window; CSRF/safePath/body-cap untouched.
- `public/app.js`: the editable pane is now a Review/Edit split — Review
  renders the aligned highlighted diff (read-only), Edit shows the REAL
  textarea (visible text/caret/selection) + a debounced line-number gutter;
  the transparent overlay plane is deleted and the SAME textarea element
  persists across mode switches (undo/selection/scroll survive). No LCS
  while typing: a 150ms coalesced recompute runs on Review-entry/Apply/
  blur; >4M cells shows an explicit paused label instead of freezing. Apply
  sends `expectedVersion`; a 409 opens an inline conflict banner (Reload /
  Compare / Cancel). Dirty dot + Reset Proposal + Ctrl/Cmd+Enter apply +
  file-named `aria-label`/`title`; stepper warns that a rebuild drops edits;
  the approval-capture getter stays byte-identical
  (`label | {label, oldFull, newFull}`); JetBrains wire contract untouched.
- `public/style.css`: shared geometry vars on `.sx-host` (fixed-px
  `--sx-lh: 17.4px`), `.sx-hdr` equalized at 36px, edit-mode gutter strip,
  segmented Review/Edit toggle, conflict banner, paused state, editor
  extent border. Global textarea cap excluded via `textarea:not(.sx-ta)`
  (see the un-cap entry below).
- Tests: `test/diff-view.test.js` (47), `test/workspace-file.test.js` (29),
  `test/diff-contract.test.js` (12, red-first) — all green; full existing
  suite green; HTTP wire smoke verified the version protocol end-to-end.

### 2026-08-07 — diff(editable): un-cap the diff editor (global textarea rule)

- `public/style.css` (browser spot-check round 3): the composer's generic
  `textarea { min-height: 48px; max-height: 200px }` rule applied to the diff
  editor too — nothing overrode `max-height`, so `.sx-ta` was clamped to
  exactly 200px (~11 lines) regardless of the 45vh pane. This explains all
  earlier symptoms (text in the upper third, gutter numbers below the text
  field). Selector narrowed to `textarea:not(.sx-ta)` — the same exclusion
  idiom the `#modal textarea:not(.sx-ta)` rule already used; the composer
  and modal inputs are unaffected, and the transcript diff editor (base
  `height: 300px`) is freed from the cap as well. The pre-A5 overlay design
  masked the cap (transparent textarea).

### 2026-08-07 — diff(editable): floor the modal edit-pane height

- `public/style.css` (browser spot-check round 2 of the U5 editable-diff
  slice): the permission modal's flex chain is content-driven — the
  `max-height: 92vh` clamp only resolves when the diff overflows, so short
  diffs sized the edit pane to the textarea's intrinsic 2-row height. Fixed
  with `#modal .sx-eedit { min-height: 45vh }` (visible only in Edit mode;
  Review stays content-sized) **plus** a deterministic `flex: 1 1 45vh`
  basis on `#modal .sx-ta` — the auto basis resolved to 2 rows and flex-grow
  had no free space in the content-driven chain; the explicit basis never
  depends on the chain resolving, and grow still fills the pane when a tall
  diff makes the chain definite.
- `public/style.css`: edit-mode textarea now draws a hairline border
  (`.sx-host[data-mode="edit"] .sx-ta`) so the editor's extent is visible
  instead of reading as dead space below the text.

### 2026-08-07 — diff(editable): equal header heights + fill-height edit pane

- `public/style.css` (browser spot-check round 1 of the U5 editable-diff
  slice): `.sx-hdr` gets `min-height: 36px` — the new column's header carries
  the 24px Review/Edit toggle + Apply and ran ~12px taller than the bare
  `− original` header, offsetting the two column bodies; both headers now
  clamp to the same height.
- `public/style.css`: `.sx-eedit` becomes `flex-direction: column` — it was a
  row flex, so in the approval modal the `flex:1 1 auto; height:auto`
  textarea only stretched horizontally and collapsed to its ~2-row intrinsic
  height (~34px, gutter clipped to match); the editor now fills the modal
  column vertically.

### 2026-08-07 — shell(context): move the ctx readout onto the pressure meter

- `public/{index.html,app.js,style.css}`: the context meter (`#ctx-meter`,
  footer top edge) now carries the numeric readout `percent% (used/max)` in a
  muted mono label (danger-tinted when hot); the statusbar `ctx` readout
  (`sb-ctx`) was removed from the primary group — the meter is now the single
  context display. Supersedes FR-10.4's "sb-ctx remains" clause.

### 2026-08-07 — shell(adaptive): widen the transcript column to 1200px

- `public/style.css`: transcript content cap 900 → 1200px (the 900px cap bound
  even at 1440 with both rails open, where the content area is ~1112px);
  edge-to-edge on ultrawide is still avoided, now centered at 1200px.

### 2026-08-07 — docs(security): specify permission policy, broker, and WebUI editor

- **Verified defects:** record that shipped safe-command prefix rules can
  auto-allow compound/substitution/redirection and mutating Git commands;
  pending extension dialogs disappear across reload; permission POSTs close the
  modal before acknowledgement; remembered grants are global/order-sensitive;
  and the native bridge accepts an unrestricted browser path.
- **Roadmap/plan (`docs/{roadmap,plans}.md`):** add Now outcome U6 and Phase A6
  for a tested pure policy engine, conservative shell/path handling, versioned
  workspace-scoped policy, fail-closed headless behavior, a `toolCallId`-keyed
  protocol, server pending-request broker, acknowledged responses, timeout/
  abort/multi-tab convergence, and JetBrains containment/lifecycle hardening.
- **Permissions page (`docs/design.md`):** specify a dedicated same-shell
  `#permissions` view opened from Settings, Alt+K, and the rail badge. It owns
  structured effective-rule editing, active grants/revoke, pending links,
  redacted audit, Explain, and a validated revision-safe advanced JSON view;
  fixed APIs keep config/workspace resolution server-authoritative.
- **Research/comparison (`docs/{improvements,pi-livecraft}.md`):** add the
  source-backed audit and adopt only Livecraft's `pendingUi` refresh recovery +
  acknowledged response pattern, not its manager/supervisor process model.
  Primary comparisons: Pi extension/RPC docs, VS Code approvals, Cline Auto
  Approve, and Claude Code command/path permission semantics. No runtime code
  changed.

### 2026-08-07 — docs(roadmap): replace the stale backlog with an executable sequence

- **Roadmap (`docs/roadmap.md`):** remove shipped PWA, highlighting, themes,
  Git/analysis foundations, images, subagents, and reconnect work from the live
  backlog; replace the old numbered list with Now/Next/Later horizons, stable
  outcome IDs, dependencies, explicit non-goals, and conditional security/
  checkpoint/context-pruning gates.
- **Action plan (`docs/plans.md`):** replace completed O3/O5/M1 implementation
  history with Phases A–F covering correctness/accessibility, the workspace-tools
  rail, conversation/change/session workflows, context/templates/JetBrains,
  long-history performance, validation matrices, and phase exit criteria.
- **Order:** adaptive/contrast/draft/live-state correctness must pass before the
  rail; conversation and change-review contracts precede context/IDE work;
  incremental history follows stable turn semantics. Remote auth, checkpoints,
  directory selection, and compaction pruning require separate specifications.
- **Index:** add the action plan to `docs/README.md` and clarify the roadmap as
  the source of truth for accepted product outcomes.
- **Follow-up — editable diff (`docs/{roadmap,plans}.md`):** add Now item U5 and
  Phase A5 after confirming the web editor's transparent textarea is offset by
  unmatched vertical padding and cannot track diff-only deletion placeholders.
  Plan a shared-geometry stopgap, explicit Review/Edit rendering, conflict-safe
  hash/version writes, debounced large-hunk updates, dirty/reset/keyboard state,
  and a later unified/intraline/navigation review pass. No runtime code changed.

### 2026-08-07 — docs(ui): rebaseline UI-improvement research

- **Research:** inspect the live UI at 1440×1000 and 480×900, current
  HTML/CSS/rendering paths, paperlike/dark contrast ratios, and the JetBrains
  JCEF bridge; compare primary guidance from VS Code/Cline, WAI-ARIA, WCAG 2.2,
  GitHub Primer, web.dev, and the IntelliJ Platform SDK.
- **Audit (`docs/improvements.md`):** replace the stale July cross-cutting list
  with a current workbench model, verified issues, ranked delivery tranches,
  accessibility acceptance criteria, long-session rendering plan, and native
  JetBrains integration opportunities.
- **Key findings:** narrow sidebar/composer rules fail in the actual cascade;
  status metadata horizontally overflows even at desktop width with the sidebar
  open; paperlike small-text pairs measure as low as 3.04:1; status is
  duplicated; the empty state is CSS-only; transcript/tool/splitter semantics
  are incomplete; drafts and Improve are destructive under failures/races.
- **Design/index:** correct `docs/design.md`'s obsolete paperlike contrast claim
  and refresh the audit's role in `docs/README.md`. No runtime code changed.

### 2026-08-07 — docs(pi-livecraft): consolidate the post-adoption audit

- **Why:** the four original pi-livecraft documents described a pre-port target
  and implementation plan, but Phases 0–5 have shipped; keeping those snapshots
  as current docs obscured the smaller set of verified residual gaps.
- **What (`docs/pi-livecraft.md`):** one current audit now records shipped
  overlap, source-backed correctness findings, ranked UI/UX and feature
  candidates, the zero-build/process/security boundaries that still reject a
  port, and a file-by-file source map.
- **Fresh findings:** the generic right rail is only partially realized (SDD is
  persistent while Analysis/Git remain modal), live analysis can use stale
  bootstrap messages, the main Pi decoder silently drops session records over
  8 MiB, narrow workspace rules lose the CSS cascade, Improve can overwrite a
  newer draft, and the slash palette retains rebuild-on-hover interaction.
- **Cleanup:** remove the superseded architecture, UI, rendering, and action-plan
  documents; add the consolidated audit to `docs/README.md`. Historical detail
  remains available in Git.

### 2026-08-06 — fix(windows): stop local git.js from shadowing Git for Windows

- **Root cause:** Windows searches the process working directory before `PATH`
  and this machine's `PATHEXT` includes `.JS`. The health poll's bare `git`
  command therefore launched the repository's own `git.js` through its file
  association. Because the probe was synchronous, the server stopped answering
  session/snapshot requests while the editor was open; the next poll reopened
  it after close, producing the apparent crash/reload loop.
- **Fix (`git.js`, `server.js`):** centralize platform command selection in
  `gitExecutableForPlatform()` (`git.exe` on Windows), use it for every
  bridge-owned Git subprocess, and replace health probe shell strings with
  `execFileSync` argument arrays. The first patch still let spawned pi and its
  tools inherit `.JS`; server startup now also calls `sanitizeWindowsPathExt()`
  so every descendant resolves bare `git` to Git for Windows.
- **Regression (`test/git.test.js`):** assert Windows selects explicit
  `git.exe` and strips only `.JS` from inherited `PATHEXT`; live smoke verified
  health, a populated resumable-session list, and the bundled snapshot endpoint
  while running from this repository.
- **Follow-up — windowless spawns (`git.js`, `server.js`):** every git spawn
  site (`runGit`, plus the `taskkill` kill path) now passes
  `windowsHide: true`. Headless servers (detached launcher, `/webui`, IDE panel)
  have no console, so a console-less parent spawning git.exe flashed a window
  per call — and the git snapshot fires 6 parallel spawns, so opening git
  status burst a pile of windows.
- **Follow-up — palette clicks (`public/app.js`):** Alt+K mouse clicks were
  dead while keyboard worked: per-item `onmouseenter` rebuilt the whole list on
  every hover, so a node swap between `mousedown` and `mouseup` (hover drift or
  a slow webview) retargeted the click to the container. Interaction is now
  delegated on `cmdkList` (click/mouseover resolve `data-i`) and hover
  selection toggles `.sel` in place without rebuilding.

### 2026-08-05 — feat(usage): OpenCode Go subscription quota tracking in the usage bar

- **Why:** the usage bar already covers z.ai (quota) and Codex (quota); OpenCode
  Go is a third quota-based provider pi can log into (`opencode-go` in pi's
  auth.json). Unlike z.ai/Codex it has **no public usage API** — verified against
  upstream anomalyco/opencode source (zen routes are inference-only, response
  headers scrubbed) and opencode-bar, which reads the quota windows out of the
  dashboard page.
- **Server (`server.js`):** new `GET /api/opencode-usage` proxy for
  `https://opencode.ai/workspace/<id>/go` (dashboard HTML, `Cookie: auth=<…>`,
  browser UA, 8s cap). The API key pi stores can't fetch quota (only validates
  against `/zen/go/v1/models`), so creds are the browser-session cookie:
  `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE` env →
  `~/.config/{opencode-bar,opencode-quota}/opencode-go.json`
  (`{workspaceId, authCookie}`) → `X-OpenCode-Go-*` paste headers (same fallback
  slot as the z.ai key paste). 401/403 → "cookie expired".
- **Parser (`public/usage-provider.js`):** `opencodeGoWindows(html)` — port of
  opencode-bar's dashboard parser (entity/escape normalization, then regex the
  flat `{status,resetInSec,usagePercent}` object after `rollingUsage` /
  `weeklyUsage` / `monthlyUsage`), handles both `__next_f.push` JSON-stringified
  and SolidStart `$R[n]={…}` serialization. Shared browser/Node like md.js;
  server.js `require`s it so raw HTML never crosses the wire.
- **Client (`public/app.js`):** `opencode-go` → `opencode-go-quota` kind; three
  percent bars (5h / 7d / 30d) in the header + usage modal via
  `opencodeGoLimits()`; a workspace-id + auth-cookie form in the modal when no
  creds are configured (localStorage `pi:opencode-go-creds`, sent as headers);
  peak-hours badge gated to z.ai only (it was leaking onto Codex bars too).
- **Tests:** `test/usage-provider.test.js` extended with opencode-bar's fixture
  shapes (escaped JSON, SolidStart refs, partial windows, no-data).

### 2026-07-22 — docs(design): restructure `docs/design.md` into the DESIGN.md format (google-labs-code/design.md)

- **Why:** adopt a standard, machine-readable design-spec format so the visual
  system is shareable across tools/agents.
- **What:** YAML **frontmatter** (token groups `colors` / `typography` /
  `rounded` / `components`, `version: alpha`) mirrors `public/style.css`
  `:root`; the body reorganized into the format's 8 standard sections (Overview,
  Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's &
  Don'ts). Component tokens cross-reference with `{group.key}`; prose uses
  descriptive color names (Ink Black, Anthracite, Carolina Blue, …) mapped to
  tokens.
- **Kept accurate:** no spacing-scale token exists in `:root` → `spacing`
  omitted, noted as ad-hoc in Layout. Filename kept lowercase (`design.md`) to
  avoid breaking `docs/README.md` + `AGENTS.md` cross-refs; the doc notes it
  follows the DESIGN.md format. `paperlike` documented as the switchable
  alternate. `:root` remains normative where it disagrees.

### 2026-07-22 — feat(theme): rework default theme into "dark" — black + anthracite, GitHub-dark neutrals/blue accent, slop-strip

- **Why:** the default dark theme was a near-checklist of AI-slop tells
  ([impeccable.style/slop](https://impeccable.style/slop/)): violet/cyan-on-dark
  "AI color palette", dark-mode glowing box-shadow accents, frosted-glass
  overlays, a violet hero aurora, and — the single most recognizable tell —
  side-tab accent stripes on the user bubble, every tool/think card, the active
  workspace row, and the SDD rail step. Reworked into a deliberate **dark**
  theme instead.
- **Palette (`public/style.css` `:root`):** black canvas (`#000000`), anthracite
  panels (`#0d1117`/`#161b22`), GitHub-dark neutrals (`#e6edf3` text, `#7d8590`
  muted, `#30363d` hairline) and accents — blue `--accent #4493f8`, code-blue
  `--cyan #79c0ff`, green `--ok #3fb950`, amber `--warn #d29922`, red `--err
  #f85149`. Neutral black soft shadow, no colored glow halo. Code/diff bodies
  `#0d1117`.
- **Slop tells removed:** the side-stripes (user bubble, `.tool`, `.think`,
  `.ws-row.active`, `.ss-step.cur`); the violet hero `radial-gradient`; the
  `backdrop-filter` glassmorphism on settings/modal; and the accent box-shadow
  halos on the live dot, primary Send, and jump pill. Active sidebar/rail rows
  now signal state via background + accent text instead of a stripe.
- **Mono prose:** the transcript renders in the app's global monospace
  (GitHub-dark style). An earlier iteration added a system-serif prose face
  ("dark paper"); dropped for a cohesive mono identity.
- **Docs:** `docs/design.md` §1/§2/§4/§5 rewritten for the dark theme + the
  anti-slop rationale; `AGENTS.md` style.css row updated. **Renamed** the theme
  `obsidian` → `dark` (label + `[data-theme]` value); the inline head script
  migrates a stale `obsidian` in `pi:theme` localStorage → `dark` (and still
  collapses the older removed `ayu`). Alternate theme stays `paperlike`.

### 2026-07-22 — feat(ui): review visuals — status-bar overflow, semantic rows/palette, persistent connection states

- **Why:** first pass on the `docs/improvements.md` → **Visuals** section (items
  1–3, all High). The status bar wrapped/competed for space on narrow windows;
  session/workspace rows and palette entries were non-semantic clickable `<div>`s;
  and a dead/restarting backend was signalled only by a short-lived toast.
- **Status-bar density (`index.html`/`style.css`/`app.js`):** the 9-readout footer
  splits into a **primary** group (repo·model·ctx) always visible and a
  **secondary** group (git·think·cache·tok·$cost·ide) that collapses into a native
  `<details>` ⋯ popover under 720px. Primary scrolls internally if the repo path
  overflows; `syncSbOverflow()` keeps the `<details>` open on wide / closed on
  narrow and only reacts to actual wide↔narrow crossings (so an open popover
  isn't snapped shut by a same-mode resize).
- **Affordances (`app.js`/`style.css`):** workspace rows, sidebar session rows,
  and modal session rows are now real `<button>`s — native keyboard/focus,
  `aria-current` on the active row, `disabled` so the current row is inert. Their
  `<div>` children became `display:block` spans (`<button>` accepts only phrasing
  content). Hover/current affordances are gated on `:not(:disabled)`; `:active`
  adds a pressed inset. The slash palette is now `role="listbox"` with
  `role="option"` items (`aria-selected`, stable ids); the textarea carries
  `aria-controls/expanded/autocomplete` + `aria-activedescendant` tracks the
  arrow-key highlight, and mouse hover stays in sync with keyboard selection.
- **State clarity (`app.js`/`style.css`):** the header status dot is now a
  connection-state indicator (`setConnState`/`renderStatusDot`): connecting (amber
  pulse) → ready (green steady) → working (green pulse) → reconnecting (red pulse)
  → stopped (red steady) — so a dead/restarting backend stays visible instead of
  toast-only. `pi_exit` + SSE errors now pin reconnecting. Empty transcript shows
  a CSS-only `#transcript:empty::before` hint.
- **Verify:** `node --check` clean; TS LSP clean on `app.js`; server boots, serves
  all assets (HTTP 200), `/api/health` ok. The 5 ast-grep `no-case-declarations-js`
  hits on the braced `tool_execution_end` case are false positives (decls sit in
  nested `if`/callbacks, not the case clause) — dispositioned as false-positive.

### 2026-07-22 — feat(skill): archive finished SDD sets into `.sdd/archive/`

- **Why:** finished runs (verify phase) cluttered `.sdd/` top level; user asked
  to move completed sets out once the implementation is done.
- **`skills/sdd/SKILL.md`:** Phase 4 gains a terminal **Archive** step — after
  `verify_{slug}_{date}.md` is written and every chunk is `[x]`, move the set's
  four files (`plan_`/`spec_`/`tasks_`/`verify_`) into `.sdd/archive/`
  (`mkdir -p` if missing), then confirm they're gone from `.sdd/` top level.
  Guarded: archive only after verify + all-green (archiving an incomplete run
  orphans the Resume Protocol). New **Archive on Completion** enforcement rule.
- **`AGENTS.md`:** one-line orientation note in the sdd bullet.
- **No server/app.js change:** `/api/plan-state` globs `.sdd/` non-recursively
  (`readdirSync` + `.md` filter), so the `archive/` subdir is ignored and
  archived sets vanish from the phase rail on the next 30s poll automatically;
  the open-pane sync logic already closes a pane whose artifact disappears
  (verified the subdir-ignored behavior with a throwaway fs test).

### 2026-07-22 — feat(ui): SDD sidebar shows chunk progress (done/total)

- **Why:** the SDD rail showed only a bare phase stepper; with the new per-chunk
  model (compliance notes + checkpoints in `tasks.md`, see previous entry) there
  was no at-a-glance view of how many chunks are done. User asked for the sidebar
  to surface more detail.
- **`server.js` (`/api/plan-state`):** for `tasks` artifacts, read the file and
  count markdown checkboxes → adds `done`/`total` to the artifact object.
  Heuristic regex (`^\s*[-*]\s*\[[ xX]\]`); correctly skips the indented
  `- Tests:`/`- Compliance:` compliance-note sub-bullets and plain dependency
  bullets (verified: 2/4 on a representative file). Ponytail ceiling noted inline:
  counts checkboxes inside fenced code too — go fence-aware only if it misleads.
- **`public/app.js`:** the `tasks` rail step now stacks a `done/total` meta line
  under the label (rail is only 88px, so inline wouldn't fit); the expanded pane
  title shows `tasks · slug (3/7)`.
- **`public/style.css`:** `.ss-txt` column + `.ss-meta` 10px muted line under the
  phase label.
- **Scope kept narrow:** no new artifact type, so the phase stepper's
  `plan|spec|tasks|verify` model is unchanged.

### 2026-07-22 — feat(skill): SDD per-chunk compliance verification + resumable checkpoints

- **Why:** Phase 4 ran the whole task list to completion before any compliance
  review, so spec/plan drift could accumulate across many tasks before being
  caught — and a mid-run crash or fresh session had no clean place to resume.
  User asked to split the plan into small chunks, verify spec/plan compliance
  after each, then continue — and make a new session startable after any step.
- **`skills/sdd/SKILL.md` changes:**
  - **Phase 3** task list now mandates small, atomic **chunks** (one change + one
    test set each), each tagged with the FR(s) + plan goal(s) it delivers — the
    explicit target for Phase 4's compliance check.
  - **Phase 4** rewritten as a strict per-chunk loop: pick next unchecked chunk →
    implement → run tests → **compliance check** (re-open spec + plan, confirm
    the implementation actually satisfies the tagged FRs/goals, not just that
    tests pass) → **checkpoint** (mark `[x]` + write a 1–2 line compliance note
    inline in the tasks file) → auto-advance. Terminal `verify_{slug}_{date}.md`
    generated only once every chunk is `[x]`.
  - **New Resume Protocol:** the tasks file is the single source of truth; a fresh
    session globs `.sdd/`, opens `tasks_{slug}_{date}.md`, finds the first
    unchecked chunk, reads the `[x]` + compliance notes above it, and continues.
  - **Enforcement Rules:** added *Compliance Per Chunk* (tests pass AND note
    written) and *One Chunk at a Time* (no batching before compliance); fixed
    Artifact Persistence to use the `{slug}_{date}` filenames (was stale legacy
    fixed names).
- **No server/UI changes:** checkpoints live inline in `tasks.md`; no new
  artifact type, so `server.js` `/api/plan-state` regex and `app.js` phase
  stepper (which only know `plan|spec|tasks|verify`) are untouched.

### 2026-07-22 — chore(repo): split browser assets into `public/`

- **Why:** root was cluttering as the app grew (12 source/asset files); separate
  what the browser fetches from Node-side. Zero-build invariant preserved —
  this is tidiness, not a functional change.
- **Moved into `public/`:** `index.html`, `app.js`, `md.js`, `style.css`,
  `usage-provider.js`, `manifest.webmanifest`, `sw.js`, `icon-192.png`,
  `icon-512.png`, `vendor/`. Server-side (`server.js`, `bin.js`, `workspaces.js`)
  stays at root.
- **Rewiring (minimal — `STATIC` maps URL→file, so URL paths unchanged):**
  `server.js` points `HTML_PATH` + the static-serve `readFileSync` at `public/`
  (2 lines; the `STATIC` whitelist itself untouched). `md.js`'s
  `require("./vendor/markdown-it.min.js")` survives because `vendor/` moved with
  it. `test/usage-provider.test.js` require repointed to `../public/usage-provider.js`.
  `package.json` `files`: three browser-file entries → `"public"` (side effect:
  now also ships `app.js`/`style.css`/`vendor/`, which were previously absent
  from the whitelist — latent oversight). `AGENTS.md` file map + `md.js`
  self-test command updated to new paths.
- **Verified:** both unit suites pass; `md.js` self-test renders at new path;
  all 13 endpoints boot-serve HTTP 200 with correct content-types.

### 2026-07-22 — feat(ui): installable PWA (own window, taskbar icon)

- **Why:** the webui reads as a standalone app; PWA is the rung-1/native way to
  give it window + dock identity for ~zero cost — no rewrite, no build step
  (chosen over Flutter/Tauri; Flutter is a full 6.5k-line rebuild that kills the
  zero-build invariant, Tauri is the heavier runner-up only if a real binary /
  tray / native menus are wanted later).
- **Added:** `manifest.webmanifest`; `sw.js` — an installability-only service
  worker (network-only, caches nothing so the edit+refresh dev loop is kept,
  never intercepts `/api/` so the `/api/events` SSE stream can't buffer/break);
  `icon-192.png` + `icon-512.png` — on-brand violet diamond (`--accent` on
  `--bg`), drawn as a polygon (no font dependency). Wired into `index.html`
  (manifest link, favicon, apple-touch-icon, `theme-color`, SW registration) and
  the `server.js` `STATIC` whitelist (4 entries, no-cache like all assets).
- **Install:** restart the server (HTML is cached at startup), open in
  Chrome/Edge → install icon in the address bar → own chromeless window +
  taskbar icon. `localhost` is a secure context so the SW registers.

### 2026-07-22 — feat(ui): stop the webui — standalone `--stop` + in-UI button

- **Standalone stop (`bin.js`):** `pi-webui --stop [port]` (alias `stop`) finds
  whatever listens on the port and force-kills the **whole process tree**
  (server + its `pi --mode rpc` child), not just the listener — so it works when
  the server is hung, the process handle is lost (pi restarted), or it was
  launched elsewhere (`pi-webui` vs `/webui` vs `node server.js`). Windows:
  `netstat -ano` → PID is the last column (locale-independent — matches
  `LISTENING`/`ABHÖREN`/…) → `taskkill /T /F`. POSIX: `lsof -ti tcp:PORT
  -sTCP:LISTEN` → `pgrep -P` descendant walk → `SIGKILL` (process-group
  fallback if no `pgrep`). This is the force fallback for the hang case, since a
  hung server can't serve a button.
- **In-UI stop button (`server.js`, `app.js`, `index.html`, `style.css`):**
  Settings → **server → stop webui** (danger-styled). `POST /api/stop` responds
  `{"ok":true}`, then `stopServer()` (150ms later so the 200 flushes)
  broadcasts `{type:"stopping"}`, force-kills `pi`, and a `shuttingDown` guard
  in the `pi` exit handler tears the server down (`server.close()` +
  `process.exit(0)`) instead of respawning. The CSRF/`isAllowed` gate covers it
  like every POST. Client-side `showStopped()` (idempotent) closes the
  `EventSource` (no reconnect loop) + toasts; other open tabs reach it via the
  broadcast. Graceful stop — needs the server responsive; for hangs use `--stop`.
- **Why:** no way to stop a hung/crashed webui short of hunting PIDs by hand, and
  no clean in-UI shutdown. The two are complementary: button = graceful,
  `--stop` = force-by-port.
- **Files:** `bin.js`, `server.js`, `app.js`, `index.html`, `style.css`.
- **Verified:** `node --check`; Windows smoke — `pi-webui --stop` reaped a
  parent+child tree by port (locale=de); `POST /api/stop` killed server + `pi`,
  listener gone, no orphan. POSIX `lsof`/`pgrep` path mirrors the extension's
  proven `killTree` (untested here — no POSIX box).

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
  P3 items were already listed as open work in [`AGENTS.md`](AGENTS.md). Removed it; `docs/`
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
