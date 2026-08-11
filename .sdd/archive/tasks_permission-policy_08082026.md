# Phase 3 — Implementation Plan & TiCoder Tests: Permission Policy & Approval Broker (U6 + modes)

> Slug: `permission-policy` · Date: `08082026` · SDD Phase 3 artifact.
> Builds on [`plan_`](./plan_permission-policy_08082026.md) +
> [`spec_`](./spec_permission-policy_08082026.md). 12 chunks, each
> independently implementable + verifiable; never batch two chunks.

## Dependency graph

```text
C1 engine-core ──▶ C2 layers ──▶ C3 paths
C4 classifier (independent)      C5 safeguard+motions ──▶ C9 in-card UX
C6 broker ──▶ C7 server ──▶ C8 browser wire ──▶ C9 ──▶ C10 #permissions page
C11 JetBrains (needs C5,C7)      C12 e2e regression (needs all)
```

## Task List & TiCoder Test Suite

### C1 — Engine core: verdict / provenance / tiers / grants

**Files:** new `extensions/pi_minimal_webui/policy-engine.js` (dual-mode CJS,
zero-dep, injected readers).

**FRs:** FR-1, FR-2, FR-3.

- [x] Engine core implemented
  - Tests: `test/policy-engine.test.js` C1 section — 18/18 PASS (verdict shape, layer
    attribution, lookup order, precedence, grantability, provenance, fallback, CJS/jiti)
  - Compliance: FR-1/2/3 fully covered; v1 lookup semantics byte-compatible; engine
    exists before any behavior change (safeguard.ts untouched). ✓

**Tests — `test/policy-engine.test.js` (new):**

- `resolve` returns `{action,tier,matchedRule,layer,reason}` with layer
  attribution (`default` vs `user`) (# FR-1, FR-2)
- tool-object rule: first non-`*` match wins, then `*`, then tool-level
  string, then top-level `*`, then `allow` (existing v1 semantics preserved)
  (# FR-3)
- precedence: deny beats grant beats ordinary-ask beats allow (# FR-3)
- `hasGrant(key)` lifts ordinary-ask → tier `grant`; mandatory-ask is NOT
  liftable by a grant; hard-deny is NOT liftable (# FR-3)
- provenance: `matchedRule` carries the exact rule key, `layer` the source
  layer, `reason` a human string (# FR-2)
- unknown tool + empty layers → `default:*` fallback (# FR-1)
- module is require-able from Node AND the same file loads under jiti
  (no ESM-only syntax; `module.exports` only) (# FR-1)

### C2 — Layered config: merge / tighten-only / migration / validation

**Files:** `policy-engine.js` (additions) + `test/policy-engine.test.js`.

**FRs:** FR-4, FR-5 (validation half), FR-37 (shared validator).

- [x] Layered config implemented
  - Tests: `test/policy-engine.test.js` C2 section — 11/11 PASS (merge semantics,
    tighten-only rejections + diagnostics, workspace mode rules, v1 migration,
    validateConfig, yolo rejection in every layer)
  - Compliance: FR-4/5/12/37 covered; workspace layer cloned before tightening
    (FR-1 purity); mode.yolo never persisted. ✓

**Tests:**

- merge(default,user,workspace): user overlays default tool-by-tool; workspace
  overlays user; first-match per tool preserved across layers (# FR-4)
- workspace `allow` where user/default say `ask|deny` → rejected + diagnostic
  entry; remaining workspace rules still apply (# FR-4)
- workspace `mode:"auto-approve"|"yolo"` → rejected + diagnostic; workspace
  `mode:"read-only"` accepted (# FR-4)
- v1 config (no `version`) loads as v2 `mode:"default"` (# FR-5)
- `mode:"yolo"` in ANY config → rejected + diagnostic (# FR-12)
- `validateConfig` rejects: wrong types, unknown `mode`, unknown top-level
  keys, non-object tool rules, bad regex in `re:` patterns (# FR-5, FR-37)
- corrupt/missing user config → defaults + diagnostic; cache cleared so a fix
  is picked up next call (# FR-5)

### C3 — Paths: canonicalization + sensitivePaths + path-tool set

**Files:** `policy-engine.js` (additions) + `test/policy-engine.test.js`.

**FRs:** FR-6, FR-7.

- [x] Paths implemented
  - Tests: `test/policy-engine.test.js` C3 section — 10/10 PASS (isPathSelector,
    injected-realpath canonicalization + ENOENT fallback, workspace-root containment
    - read-class workspace-layer drop, sensitivePaths override incl. the
    implicit-allow fallback path, grant-proof mandatory-ask)
  - Compliance: FR-6/7 covered. Found + fixed a real gap: the implicit-allow
    fallback bypassed the sensitive override — now routed through buildVerdict. ✓

**Tests:**

- path selectors resolve through an injected `realpath` before rule matching;
  symlink-hop fixtures (temp dir + junction where the OS allows, else
  `..`/case fixtures via injected resolver) (# FR-6)
- write/edit escaping the workspace root → deny; read tools escaping → only
  user-layer rules apply (workspace layer ignored) (# FR-6)
- `sensitivePaths` matches on canonical path AND basename; deny wins over
  ask; result tier is `mandatory-ask` or `hard-deny` (# FR-7)
- sensitive checks apply to `grep`/`find`/`ls`/`glob` path selectors, not
  just read/write/edit (# FR-7)
- `grep` with a non-path selector (no path arg) is NOT treated as a path
  tool (# FR-7)

### C4 — Bash classifier

**Files:** new `extensions/pi_minimal_webui/bash-classifier.js` (pure) +
`test/bash-classifier.test.js` (new).

**FRs:** FR-8, FR-9, FR-10, FR-11.

- [x] Bash classifier implemented
  - Tests: `test/bash-classifier.test.js` — 8/8 PASS (separator splitting + per-part
    verdicts, quotes/substitution/redirect/background/paren flags, the 3 roadmap
    bypasses locked as non-readonly, gateBash per-subcommand allow/deny gating,
    git mutation verbs)
  - Compliance: FR-8/9/11 covered. FR-10's DEFAULT_CONFIG audits (echo rule gone,
    git allowlist narrowed) moved to C5's safeguard-contract.test.js — the config is
    actually changed there, so the audit belongs with the change (same FRs, same
    assertions). ✓

**Tests:**

- split on `&&`, `||`, `;`, `|`, backticks, `$(…)`; verdict `readonly` iff
  every subcommand is read-only AND no substitution/redirect/metachar (# FR-8)
- `git status` → readonly; `ls -la` → readonly; `npm test` → mutate
  (unknown/exec) (# FR-8)
- `cat x | grep y` → readonly; `cat x > out.txt` → not readonly (redirect) (# FR-8)
- **regression locks:** `git status && rm -rf ./src` → contains mutate →
  NOT auto-allowable; `echo $(cat ~/.ssh/id_rsa)` → substitution → NOT
  auto-allowable; `git remote remove origin` → mutate verb → NOT
  auto-allowable (# FR-11)
- per-subcommand allow gating: compound allowed only when every subcommand
  matches an allow rule AND verdict readonly; `git status && ls` with both
  allow-ruled → allow; `git status && npm test` → ask (# FR-9)
- any deny rule on any subcommand → deny wins (# FR-9)
- `rm -rf /`-class pattern stays deny; echo pattern no longer exists in
  DEFAULT_CONFIG (source audit) (# FR-10)
- DEFAULT_CONFIG git allowlist is exactly
  `status|log|diff|show|blame|ls-files|branch --show-current|remote -v`
  (source audit of the extension) (# FR-10)

### C5 — Modes + safeguard.ts integration

**Files:** `policy-engine.js` (add `applyMode`, read-class set),
`safeguard.ts`, `test/policy-engine.test.js` (+ applyMode), new
`test/safeguard-contract.test.js` (source audit).

**FRs:** FR-12, FR-13, FR-14, FR-15, FR-16, FR-17 (extension half),
FR-32 (grants revoke channel), FR-42.

- [x] Modes + safeguard.ts integration implemented
  - Tests: `test/policy-engine.test.js` C5-modes 6/6 (applyMode transforms + tool
    sets) + `test/safeguard-contract.test.js` 8/8 (engine single gate, echo/git
    allowlist audits, yolo session-only, mandatory-ask option set, provenance
    setStatus, revoke/mode commands, headless branch, wire labels)
  - Compliance: FR-12/13/14/15/16/17/32/42 covered. Extension verified loading under
    pi's jiti + a real bash tool_call passed the new gate (stderr clean). index.ts:
    removed a stale @ts-expect-error (LSP surfaced it via the import edge).
    Complexity advisories (handler cyclomatic) carried from v1 — noted for verify. ✓

**Tests (`applyMode` unit, in `policy-engine.test.js`):**

- default = identity (# FR-13)
- auto-approve: ordinary-ask → allow; mandatory-ask stays ask; deny stays
  deny (# FR-13)
- read-only: readonly-verdict/bash-readonly + read-tool-set → allow;
  everything else (incl. mandatory-ask, deny tiers) → deny, no prompt
  signal; coordination tools (ask_user_question, todo) exempt (# FR-13, FR-16)
- yolo: every action → allow (# FR-13)
- headless composition: nonInteractive default/auto-approve/read-only/yolo
  matrix (# FR-15)

**Tests (`safeguard-contract.test.js`, source audit of safeguard.ts):**

- engine import + `resolve()` + `applyMode()` are the single gate; no
  inline allow/deny logic remains in the handler (# FR-42)
- yolo is session-only: held in module/instance state, cleared on
  `session_shutdown` + `session_start`; config `mode:"yolo"` never read
  (# FR-14)
- before every blocking `select`, the extension emits a
  `setStatus`/context extension_ui_request (statusKey `safeguard`) carrying
  `{tier, matchedRule, layer, reason}` for the pending approval (feeds C9's
  banner) (# FR-2 → browser provenance)
- `/safeguard mode yolo` command exists and requires no config write;
  `/safeguard reset` unchanged; new `/safeguard revoke <n>` (numbered
  session-grant list, insertion order) (# FR-14, FR-32)
- mandatory-ask select options = `[Allow once, Deny]` only (# FR-13)
- discipline.ts composition untouched (both hooks still present) (# FR-42)

### C6 — Broker (pure module)

**Files:** new `server/broker.js` — actually repo-root `broker.js` (server-side
only) + `test/broker.test.js` (new).

**FRs:** FR-18, FR-19, FR-20.

- [x] Broker implemented
  - Tests: `test/broker.test.js` — 6/6 PASS (register + tool identity via
    setContext + provenance attach, first-wins + immutable decision, unknown/
    resolved rejection, broadcast event shape, clear + snapshot copies, CJS)
  - Compliance: FR-18/19/20 covered. Record carries provenance for C9; get() and
    snapshot() are copy-safe so callers can't tamper live records. ✓

**Tests:**

- `register` creates a pending record with requestId/method/toolCallId/
  toolName/createdAt; `toolCallId` from last `setContext(toolCallId, toolName)`
  (# FR-18)
- first response wins: second resolve with same id → rejected (410-ish
  result), pi-forward payload produced exactly once (# FR-19)
- stale/unknown id → rejected; resolved entries emit a broadcast event
  object with `{requestId, toolCallId, decision}` (# FR-19)
- `clear()` on pi-exit/workspace-switch empties pending; `snapshot()` returns
  an array copy (# FR-20)
- broker is dependency-free CommonJS (# FR-1 style, FR-18)

### C7 — Server wiring: broker + `/api/permissions`

**Files:** `server.js`, `broker.js` integration, `test/permissions-api.test.js`
(source/contract audit), reuse `policy-engine.js` validator.

**FRs:** FR-21, FR-22 (server half), FR-24 (server half), FR-37.

- [x] Server wiring implemented
  - Tests: `test/permissions-api.test.js` 8/8 (6 endpoints, CSRF + body cap,
    revision 409 + atomic write, pendingApprovals in snapshot, marker 410,
    approval_resolved broadcast, explain same-engine, broker cleanup) +
    live smoke: /api/permissions + audit + explain respond; the 3 roadmap
    bypasses resolve gate.allow:false even against the STALE v1 user config
  - Compliance: FR-21/22/24/35/37 covered.
  - SPEC REFINEMENT (C7, FR-9/31): "Allow always" now writes an EXACT-SELECTOR
    grant (config `grants: [tool\0selector]`) instead of a pattern rule, and the
    FR-9 compound gate is BINDING for every rule-based bash allow (a stale
    pattern rule can never auto-allow a mutating compound; the classifier verdict
    gates it). Mode-induced allows (read-only/auto-approve/yolo) bypass the gate
    so modes stay prompt-free. Verified live against the user's real stale config
    (`git remote remove origin` → classifier mutate → asks). Grants + binding
    gate asserted in safeguard-contract (C5) + validateConfig. ✓

**Tests (`permissions-api.test.js`):**

- exactly the 6 fixed endpoints exist:
  `GET /api/permissions`, `PUT /api/permissions/config`,
  `DELETE /api/permissions/grants/:id`, `DELETE /api/permissions/grants`,
  `POST /api/permissions/explain`, `GET /api/permissions/audit` (# FR-37)
- all are inside the `isAllowed` CSRF gate path; PUT body size-capped;
  PUT with stale `revision` → 409 path exists (# FR-37)
- `/api/snapshot` response shape includes `pendingApprovals` from
  `broker.snapshot()` (# FR-21)
- the extension_ui_response forward path validates the marker's `toolCallId`
  against the pending record before writing to pi stdin; mismatch → rejected
  (# FR-24)
- `approval_resolved` broadcast is emitted via `broadcast()` on resolve
  (# FR-19, FR-22)
- explain endpoint calls the SAME engine function as the live gate
  (source audit: no second rule implementation) (# FR-35)

### C8 — Browser wire: marker / ack-before-close / toolCallId map

**Files:** `public/app.js`, `public/index.html` (no new markup yet),
`test/permission-ux.test.js` (new source-audit + state-machine sims).

**FRs:** FR-25, FR-22 (client half), FR-23, FR-24 (client half), FR-27.

- [x] Browser wire implemented
  - Tests: `test/permission-ux.test.js` 10/10 (marker shape + 5 enums, toolCallId
    map + pendingToolArgs in the diff paths, ack-before-close + watchdog, stale/
    mismatched handling, Esc=Deny gate, ask-ordering preservation) +
    LIVE e2e with a stub pi: broker registers select (tc=tc-stub-1/bash),
    marker-validated POST → 200, approval_resolved broadcast seen on SSE,
    second response 410, wrong toolCallId 410, unknown id legacy 200,
    audit entry recorded, pending cleared, response forwarded to pi
  - Compliance: FR-21(client)/22/23/24/25/27 covered. uiRequest setStatus gains
    the safeguard provenance special-case (never overwrites the statusbar);
    ask bridge untouched (immediate-close + plain response). ✓

**Tests:**

- `extension_ui_response` payloads for approvals carry
  `marker:{v:1,toolCallId,decision}` with decision ∈ the 5 stable enums;
  value forwarded to pi is the unchanged label/edited-object (# FR-25)
- `curToolArgs` singleton replaced: args map keyed by toolCallId, fed at
  `tool_execution_start` (audit: no remaining reads of `curToolArgs` in the
  permission paths) (# FR-25)
- ack-before-close: modal/card closes only after `approval_resolved` for its
  requestId; 2s timeout → UI stays + retry toast (# FR-22)
- Esc/backdrop → Deny routed through the same ack path; failed POST keeps
  the UI with the decision retained (# FR-23)
- `approval_resolved` with stale/mismatched requestId → "decision too late",
  no close (# FR-24)
- ask-question ordering preserved: tool_execution_start → select → input(MARKER)
  → rich modal; state-machine sim of the sequencing (# FR-27)

### C9 — In-card pending approval + bottom sheet

**Files:** `public/app.js`, `public/style.css`, `test/permission-ux.test.js`.

**FRs:** FR-26, FR-28, FR-2 (provenance render).

- [x] In-card approval surface implemented
  - Tests: `test/permission-ux.test.js` C9 section — 2/2 (in-card renderer +
    placement rules incl. 720px/offscreen fallback, mandatory-ask option filter,
    Review/Edit diff mount, removal on resolve, receipts ring ≤50; style.css
    .approval + bottom-sheet media query) — 12/12 total with C8
  - Compliance: FR-26/28 covered; ask/confirm/input/editor modals untouched;
    a11y-contract + status-race suites still green after the app.js surgery. ✓

**Tests:**

- tool card gets `.pending` banner showing risk reasons (classifier verdict +
  sensitive hits), matched rule + layer, grant scope, and (edit/write) the
  U5 Review/Edit diff — banner classes present; data fed from the
  `safeguard` status context (C5) + broker record (C7) (# FR-26)
- decision buttons live in the card; mandatory-ask tier renders exactly
  `[Allow once, Deny]`; other tiers render the 4-button set (# FR-26)
- narrow-width/bottom-sheet fallback: a `sheet` class path exists and is
  keyboard-operable (focus trap, Esc=Deny) (# FR-26)
- `confirm`/`input`/`editor`/ask-question keep their modals (audit: modal
  path untouched for non-select methods) (# FR-26, FR-27)
- decision receipts ring buffer (≤50) maintained for audit + retry (# FR-28)

### C10 — `#permissions` page + mode selector

**Files:** new `public/permissions-ux.js` (dual-mode pure helpers) +
`test/permissions-ux.test.js` (new), `public/app.js`, `public/index.html`,
`public/style.css`.

**FRs:** FR-29, FR-30, FR-31, FR-32, FR-32b, FR-33, FR-34, FR-35, FR-36, FR-17.

- [x] #permissions page + mode selector implemented
  - Tests: `test/permissions-ux.test.js` — 7/7 (5 pure helpers: layer tree,
    editor messages, redactor, explain view, mode state machine; 2 page-wiring
    audits: hash route + palette + settings launchers + fixed-endpoint-only,
    numbered revoke + clear-all + PUT revision + yolo command) +
    LIVE: GET → PUT auto-approve (v1→v2 migrate, revision 1) → stale 409 →
    mode:yolo 400 → explain (bypass gate.allow:false) → GET reflects mode;
    real user config backed up + restored
  - Compliance: FR-17/29/30/31/32/32b/33/34/35/36/37 covered. Page never
    touches policy files (browser-supplied paths absent); yolo engages via the
    session command only. ✓

**Tests (`permissions-ux.test.js` — pure helpers):**

- layer-tree builder: merged per-tool rules with per-rule layer badges;
  effective vs default vs user vs workspace panes (# FR-30)
- rule editor validation messages reuse `validateConfig` output; workspace
  loosenings surface the diagnostic text (# FR-31, FR-33)
- audit redactor: sensitive-class selectors stored/displayed as basename
  only; non-sensitive truncated at 400 chars (# FR-34)
- explain renderer maps a verdict object to the same fields as the live
  gate (action/tier/rule/layer/reason + per-subcommand breakdown) (# FR-35)
- mode select state machine: yolo requires confirm; confirm cancel keeps the
  previous mode; yolo engage issues the command + shows the ACTIVE banner
  (# FR-32b, FR-14)

**Tests (`permission-ux.test.js` + source audit in app.js):**

- `#permissions` route reachable from settings sidebar, command palette, and
  a rail badge placeholder (W1-ready); hash routing, no router (# FR-29)
- page landmarks + focus management on open/close; no hover-only controls
  (# FR-36)
- grants panel: numbered list mirroring the broker mirror; per-grant revoke
  issues `/safeguard revoke <n>`; clear-all issues `/safeguard reset`
  (# FR-32)
- settings sidebar mode select writes `default|auto-approve|read-only` via
  PUT /api/permissions/config (# FR-17)

### C11 — JetBrains bridge hardening

**Files:** `jetbrains/src/main/kotlin/com/gorowynn/piwebui/DiffReviewEditor.kt`
(+ small pure helper), optional `jetbrains/src/test` (junit5 on mavenCentral).

**FRs:** FR-38, FR-39, FR-40, FR-41.

- [x] JetBrains bridge hardening implemented
  - Tests: `jetbrains` gradle test — BUILD SUCCESSFUL, 4/4 (WorkspaceContainment:
    children/root, sibling + system-path rejection, .. collapse both directions,
    name-prefix sibling) — plugin sources incl. the editor changes compile
  - Compliance: FR-38 (canonical containment gate in resolveVirtualFile → null =
    no IDE-filesystem read outside the project; webui fallback), FR-39 (payload
    carries requestId/toolCallId; marker stays browser/server-side per C8),
    FR-40 (conflict detection at decision time ships `conflict:true` on edited
    decisions; webui warns), FR-41 (mode badge + YOLO warning in the native top
    bar; app.js sends provenance.mode). Build env note: JAVA_HOME must point at
    a JVM ≥17 (WebStorm JBR 21 used; the machine default is JDK 11). ✓

**Tests:**

- containment helper: realpath-under-project check; outside-root absolute
  path → false (unit-test the pure helper with a temp-dir fixture) (# FR-38)
- `DiffReviewFile` carries requestId + toolCallId; `decide()` remains
  idempotent and the value shape stays the safeguard label /
  `{label,oldFull,newFull}` wire contract (# FR-39)
- dispose→Deny regression asserted in the helper/comment contract test
  (# FR-40)
- mode line in the top bar: bar label reflects active mode + YOLO warning
  (source-level assert; the mode value arrives via the `safeguard` status
  context through the JS bridge) (# FR-41)
- `./gradlew test` (or build) green — environmental: needs RIDER_HOME/IDE;
  if no IDE present, the chunk's automated gate is the pure-helper test +
  `git diff --check` and the manual smoke is recorded in verify_ (# FR-43)

### C12 — End-to-end regression + docs

**Files:** `test/` additions as needed, CHANGELOG.md, AGENTS.md/GOTCHAS.md
(if new invariants), `docs/roadmap.md` (U6 status note after verify).

**FRs:** FR-43, FR-44.

**Tests:**

- full suite: `node test/*.test.js` all green (excluding the pre-existing
  environmental rpc-sse) (# FR-43)
- FR-11 regression locks re-run (C4) + mode matrix re-run (C5) +
  broker first-wins/stale re-run (C6) — the FR-44 set is explicitly listed
  in the verify report (# FR-44)
- manual smoke matrix recorded: auto-approve skips asks but mandatory-ask
  still prompts; read-only blocks a write with a notify and no prompt;
  yolo confirm-gate + zero prompts + gone after session restart; reload
  mid-approval replays; two-tab first-wins; Esc=Deny; JetBrains diff shows
  mode + deny-on-close (# FR-44)

## TiCoder Validation Loop

The tests above express the spec. At this point they should FAIL — none of
the new modules exist yet and the source-audit tests assert behavior the
current code doesn't have (e.g. the three bypass locks, the marker, the
broker endpoints). Do they capture the intended behavior?
