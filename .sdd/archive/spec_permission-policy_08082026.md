# Phase 2 — Detailed Specification: Permission Policy & Approval Broker (U6 + modes)

> Slug: `permission-policy` · Date: `08082026` · SDD Phase 2 artifact.
> Builds on [`plan_`](./plan_permission-policy_08082026.md). FRs are the
> test-traceable contract; every task chunk in Phase 3 tags its FRs.

## User Stories

1. As a user, I want dangerous compound commands to be conservatively
   classified so that `git status && rm -rf ./src` can never be auto-allowed
   by a read-only pattern.
2. As a user, I want to see WHICH rule matched and WHY before I approve, so my
   decision is informed, not reflexive.
3. As a user, I want a permission modal that survives a reload and never
   closes before my decision is recorded, so approvals are not silently lost.
4. As a user, I want one global posture switch — default / auto-approve /
   read-only / yolo — so I don't hand-edit rules to change trust levels.
5. As a user in read-only mode, I want every mutation blocked silently (with a
   notification), so a mistaken `write` can't happen and I'm not prompted.
6. As a user in yolo mode, I want zero prompts, a visible warning state, and
   the mode gone when the session ends.
7. As a user, I want to inspect and edit the effective policy from the UI —
   layers, grants, diagnostics, an Explain form — without opening JSON.
8. As an IDE user, I want the JetBrains diff approval to enforce the same
   policy, modes, and project containment as the browser.

## Functional Requirements

### A. Policy engine (new pure module `extensions/pi_minimal_webui/policy-engine.js`)

- **FR-1** Zero-dep CommonJS module, dual-mode (`module.exports` + `window.*`
  not needed — server-only, but CommonJS so both `server.js` and the jiti-run
  extension can `require` it). Pure functions only; no fs except via injected
  readers. Unit-testable under `node test/policy-engine.test.js`.
- **FR-2** `resolve(toolName, selector, layers, mode)` returns a verdict object:
  `{ action: "allow"|"ask"|"deny", tier: "hard-deny"|"mandatory-ask"|"grant"|"ordinary-ask"|"allow", matchedRule, layer: "default"|"user"|"workspace", reason }`. Provenance is mandatory — every verdict carries the matched rule key and the layer it came from.
- **FR-3** Precedence (high→low): hard-deny → mandatory-ask → remembered-grant
  (session/always) → ordinary-ask → allow. Same-layer first-match within a tool
  rule table (existing semantics: first non-`*` match wins, then `*`), then
  tool-level action, then top-level `*` (existing behavior preserved as the
  rule-lookup layer, now under the documented precedence).
- **FR-4** Layers: `default` (shipped, read-only floor) → `user`
  (`~/.pi/agent/safeguard.json`) → `workspace` (`<PI_CWD>/.pi/safeguard.json`).
  Merge: user overlays default tool-by-tool (existing), workspace overlays user.
  **Workspace layer may only tighten**: it may set `ask`/`deny`/`mode:"read-only"`
  but never `allow` where user/default say ask or deny, never `mode:"auto-approve"`
  or `mode:"yolo"`. A loosening workspace rule is rejected at load with a
  diagnostic entry; the rest of the workspace layer still applies.
- **FR-5** Config versioning: schema `version: 2` (`mode`, `nonInteractive`,
  per-tool rules as today, optional `sensitivePaths`). A v1 file (no `version`)
  loads as v2 with `mode:"default"`. Config writes are atomic
  (temp file + rename) and carry a `revision` counter; writes with a stale
  revision are rejected (`409`). Unreadable/corrupt config → defaults +
  diagnostic (existing behavior kept).
- **FR-6** Path canonicalization: path selectors are `fs.realpathSync`-resolved
  (when they exist) before rule matching; symlink hops are followed. A path
  that escapes the workspace root is denied for write/edit, and treated as
  user-layer-rule-only for read tools (never workspace-rule-allowed).
- **FR-7** Sensitive-path policy applies to EVERY path-capable tool — the set
  grows from `{read, write, edit}` to include `grep`, `find`, `ls`, `glob`
  when their selector is a path. Matches against the `sensitivePaths` table
  (`{pattern, action}` globs, deny wins) produce **mandatory-ask** or deny —
  never grantable, never auto-allowed, and checked on the canonical path AND
  basename (existing read-rule matching semantics).

### B. Conservative bash classifier (pure module `bash-classifier.js`)

- **FR-8** A bash selector is parsed into subcommands split on `&&`, `||`, `;`,
  `|`, backticks, `$(…)`, and redirect operators (`>`, `>>`, `<`, `2>`, `&>`).
  The command's verdict is `readonly` iff every subcommand is a recognized
  read-only command AND there is no substitution, no redirect to a file, and no
  shell metacharacter outside a quoted literal.
- **FR-9** A command is auto-allowed only when: (a) verdict is `readonly`, AND
  (b) **every subcommand** matches an allow rule in the layers (per-subcommand
  rule matching, not whole-command), AND (c) no deny rule matches any
  subcommand. Otherwise the rule outcome is ask. Substitution/redirect/
  separator/unknown-token presence forces ask regardless of allow patterns.
- **FR-10** Unsafe default auto-allows removed from DEFAULT_CONFIG:
  `echo` (FR-8's substitution case makes it dangerous), and mutating git
  verbs. The git recon allowlist is exactly
  `status|log|diff|show|blame|ls-files|branch --show-current|remote -v` —
  `git remote remove origin` and `git branch -D x` no longer match anything.
- **FR-11** The three verified bypasses are regression-locked: `git status && rm -rf ./src`, `echo $(cat ~/.ssh/id_rsa)`, and `git remote remove origin` must resolve to **ask** (never allow) under the default layer. `rm -rf /`-class patterns keep their deny.

### C. Permission modes

- **FR-12** `mode` is a config value in the user layer (`default |
  auto-approve | read-only`), re-read on every call (existing mtime-cache
  applies). `yolo` is NEVER a config value — a config containing
  `mode:"yolo"` is rejected with a diagnostic.
- **FR-13** Mode transforms the resolved action (post-FR-2, pre-grant):
  - `default` — identity (FR-3 precedence applies).
  - `auto-approve` — ordinary-ask → allow; **mandatory-ask stays ask**; deny stays deny; grants (session/always) continue to work.
  - `read-only` — verdict-`readonly` actions → allow; everything else (ask AND deny tiers, mandatory-ask included) → deny **without prompting**; a `notify` (non-blocking) reports the block. Coordination tools (FR-16) exempt.
  - `yolo` — every action → allow, no prompts, session-scoped.
- **FR-14** Yolo engagement: only via an explicit confirm-gated action (the
  page's mode selector requires a confirm dialog naming the risk; a
  `safeguard mode yolo` pi command also works). The extension holds it
  in-memory (`sessionYolo`), cleared on `session_shutdown`/`session_start`
  (new session). While active: a visible indicator in the webui header AND in
  the JetBrains panel; every blocked-rule still reports via notify so the
  transcript shows what ran. Not persisted anywhere.
- **FR-15** Headless (nonInteractive) composition: default → existing
  `nonInteractive` behavior; auto-approve → ask-class auto-allows;
  read-only → mutate blocked; yolo → allow. Subagent delegates run headless;
  their own `--tools` allowlist remains the capability wall (unchanged).
- **FR-16** Coordination tools `ask_user_question` and `todo` are exempt from
  read-only/yolo transformations in the sense that read-only does NOT block
  them (they have no side effects); yolo still bypasses their prompts is NOT
  allowed — the ask bridge's human-in-the-loop is preserved under every mode
  (a model asking the user is not a permission grant). Their allow rules are
  unchanged in all modes.
- **FR-17** The webui exposes the mode selector (Permissions page + a compact
  select in the settings sidebar); `default`/`auto-approve`/`read-only` write
  the user config via `/api/permissions` (FR-37); yolo engages via the
  confirm flow + pi command, reflected back via the extension's structured
  status (FR-32b).

### D. Server-owned pending-request broker (new pure module `broker.js` + `server.js` wiring)

- **FR-18** The broker registers a pending approval for every blocking
  extension-UI request (`select` with allow/deny option labels, `confirm`,
  `input`, `editor`) that the server relays. The record:
  `{ requestId, method, title, message, options, toolCallId, toolName, status:"pending", createdAt }`; `toolCallId`/`toolName` come from the most recent `tool_execution_start` before the request (ordering guarantee, same as today's `curToolName`; documented as "preparation is sequential").
- **FR-19** First response wins: a resolution is accepted exactly once;
  duplicate/stale request ids are rejected (`410 Gone`, response not forwarded
  to pi). Resolutions broadcast to every tab as
  `{source:"server", type:"approval_resolved", requestId, toolCallId, decision}`.
- **FR-20** Cleanup: entries removed on resolve, on pi exit, and on workspace
  switch (`lb.clear()` sites). No fixed expiry (pi's own `ui.select` latch
  bounds the wait); a pi restart rejects all pending (reuse `rejectAllRpc`).
- **FR-21** `/api/snapshot` includes `pendingApprovals` (broker snapshot) so a
  reloaded tab re-renders the in-flight approval (roadmap: blocking requests
  survive reload). The reloaded tab re-issues the request UI from the record;
  the response id is unchanged.
- **FR-22** Acknowledgement before close: the browser's decision POST
  (`/api/cmd`, `extension_ui_response` + marker, FR-25) is processed by the
  broker, then the server broadcasts `approval_resolved`; the browser closes
  the decision UI ONLY after receiving it (2s timeout → keep UI, toast retry).
- **FR-23** Esc/backdrop = Deny: routes through the same broker path (not a
  direct fire-and-forget); on failure the decision UI stays with the decision
  retained and a retry affordance.
- **FR-24** The marker (FR-25) is validated against the pending record:
  `toolCallId` must match; mismatched/stale markers are rejected (410) and the
  UI shows "decision too late" instead of closing.

### E. Browser approval UX

- **FR-25** Versioned permission marker replaces label heuristics: the browser
  sends `{ type:"extension_ui_response", id, value, marker:{ v:1, toolCallId, decision:"allow-once"|"allow-session"|"allow-always"|"deny"|"edited" } }`. The
  payload forwarded to pi is UNCHANGED (safeguard.ts's wire contract intact).
  `isPermission` label sniffing in `openSelectModal` is removed in favor of
  the marker path; the global `curToolArgs` singleton is replaced by a
  `toolCallId → args` map (built from `tool_execution_start`, already the
  source for tool cards).
- **FR-26** Pending approval renders IN its tool card: a `.pending` banner with
  deterministic risk reasons (classifier verdict + sensitive-path hits),
  matched rule + layer, exact grant scope, and for edit/write the U5
  Review/Edit diff. The decision buttons live in the card (Allow once /
  Allow session / Allow always / Deny; mandatory-ask offers only Allow once /
  Deny). At narrow widths or when the card is offscreen the surface becomes a
  bottom sheet; `confirm`/`input`/`editor`/ask-question keep their modals.
- **FR-27** Ask-user-question flow (existing rich modal, `pendingAskArgs`
  stash) is preserved; the marker path must not regress its ordering
  (tool_execution_start → safeguard select → input(MARKER) → modal).
- **FR-28** The browser keeps a bounded ring of decision receipts (last 50,
  in-memory) for the audit view's "recent decisions" and for retry semantics.

### F. `#permissions` page

- **FR-29** A dedicated page at `#permissions`, reachable from the settings
  sidebar, the command palette, and a rail badge (W1-ready; the page is
  standalone until the rail exists). Route = hash change; no router.
- **FR-30** Layers panel: effective vs default vs user vs workspace — per-tool
  rules rendered as merged tree with per-rule layer badges and matched-rule
  provenance from FR-2.
- **FR-31** Structured rule editor: add/edit/remove rules with live validation
  (schema + tighten-only workspace check); writes go through `/api/permissions`
  with revision-conflict handling (FR-5); a raw JSON advanced view validates
  before saving.
- **FR-32** Status panel: active session grants (mirrored from broker + from
  the extension's `/safeguard` status command) with per-grant revoke and
  clear-all (revoke-all issues `/safeguard reset`; the extension remains
  authoritative for gating — the page mirror is display + convenience).
- **FR-32b** Mode selector (FR-17) with the yolo confirm flow (FR-14) and a
  visible "YOLO ACTIVE" banner state.
- **FR-33** Diagnostics: config parse errors, schema version, mtime, rejected
  workspace loosenings, unreadable layers — each with a suggested fix.
- **FR-34** Redacted decision audit (last 200, in-memory ring): time, tool,
  verdict, tier, matched rule, mode, layer; selectors for sensitive-class
  entries stored as basename only; full selectors never leave the browser for
  display beyond the truncated preview.
- **FR-35** Explain form: paste a sample call (tool + args/command) → shows
  the same verdict the live gate would produce (same engine, same layers) with
  matched rule, tier, reason, and per-subcommand breakdown for bash.
- **FR-36** `#permissions` is keyboard-operable and aria-compliant (page-level
  landmarks, focus management on open/close, no hover-only controls).

### G. Fixed `/api/permissions` endpoints (server)

- **FR-37** Only these endpoints exist: `GET /api/permissions` (full state:
  layers, effective config, mode, diagnostics, grants mirror, pending list),
  `PUT /api/permissions/config` (revision-checked atomic write, schema
  validated server-side), `DELETE /api/permissions/grants/:id` (revoke one),
  `DELETE /api/permissions/grants` (clear all → issues `/safeguard reset`),
  `POST /api/permissions/explain` (FR-35), `GET /api/permissions/audit`
  (FR-34). No browser-supplied file paths anywhere; all writes go through the
  fixed paths (user config = `~/.pi/agent/safeguard.json` resolved server-side;
  workspace layer = `<realpath(PI_CWD)>/.pi/safeguard.json`). CSRF gate
  (`isAllowed`) applies.

### H. JetBrains bridge hardening

- **FR-38** Canonical project containment in `resolveVirtualFile`: the target
  realpath must be under `realpath(proj.basePath)`; an absolute path outside
  the project root (after symlink resolution) falls back to the webui diff —
  never a native tab outside the project.
- **FR-39** Request-ID-keyed resolvers: `DiffReviewFile` carries the broker
  `requestId` + `toolCallId`; the decision callback resolves by request id
  (already idempotent via `decide()`), and the response carries the same
  marker shape (FR-25) so the broker validates identity.
- **FR-40** Unsaved-document/conflict handling: `readCurrentText` (document
  text incl. unsaved edits) is compared to the leftText snapshot at decision
  time; if the file changed mid-review, the decision UI shows a conflict
  banner and the reviewer can re-open with fresh content. `dispose → Deny`
  (fail-closed) is kept and regression-locked.
- **FR-41** The IDE diff surface reflects modes: the top bar shows the active
  mode (and the YOLO warning state); mandatory-ask renders only Allow once /
  Deny.

### I. Integration & tests

- **FR-42** `safeguard.ts` is the single enforcement point (unchanged hook
  composition with `discipline.ts` — both must allow; discipline is untouched
  by modes). Its `resolve()` is replaced by the engine's; deny/mandatory-ask/
  grant/allow all flow from FR-2's verdict.
- **FR-43** Every FR has ≥1 automated test: `policy-engine.test.js` (A),
  `bash-classifier.test.js` (B), `broker.test.js` (D, pure module),
  `permissions-api.test.js` (G, endpoint behavior via `server.js` harness or
  contract test), `status-race.test.js`-style source audits for app.js
  (E/F/FR-22/23/25), a JetBrains build + wire-contract check (H, gradle
  `test` task stays green).
- **FR-44** The three roadmap example bypasses, mode semantics, reload replay,
  ack-before-close, first-wins, stale-ID rejection, and yolo session-scoping
  are all covered by explicit regression tests.

## Data Models

### Policy config (v2, user layer `~/.pi/agent/safeguard.json`)

```jsonc
{
  "version": 2,
  "revision": 7,                      // bumped on every atomic write; PUT must send the current one
  "mode": "default",                  // "default" | "auto-approve" | "read-only"; "yolo" REJECTED
  "nonInteractive": "allow",          // "allow" | "block" (headless fallback, existing)
  "sensitivePaths": [                 // global sensitive table (FR-7); deny wins
    { "pattern": "**/.env*", "action": "ask" },
    { "pattern": "**/id_rsa", "action": "deny" }
  ],
  // per-tool rule tables — shape unchanged from v1 (string action or
  // {pattern: action} object, "*" wildcard; "re:" regex prefix; glob/basename
  // matching preserved)
  "read": { "*": "allow", ".env*": "ask", "id_rsa": "deny" },
  "bash": { "*": "ask", "re:^git (status|log|diff|show|blame|ls-files)(\\s|$)": "allow" }
}
```

### Workspace layer (`<realpath(PI_CWD)>/.pi/safeguard.json`)

```jsonc
{
  "version": 2,
  "mode": "read-only",   // workspace may ONLY force read-only (FR-4); anything looser rejected
  "bash": { "re:^npm (run|test)(\\s|$)": "ask" }  // tighten-only: ask/deny only
}
```

### Verdict (engine output, FR-2)

```jsonc
{
  "action": "ask",                    // "allow" | "ask" | "deny"
  "tier": "ordinary-ask",             // "hard-deny" | "mandatory-ask" | "grant" | "ordinary-ask" | "allow"
  "matchedRule": "bash.re:^git (…)",  // provenance — rule key or "default:*"
  "layer": "user",                    // "default" | "user" | "workspace"
  "reason": "compound command contains rm (mutating); not auto-allowable"
}
```

### Broker record (FR-18)

```jsonc
{
  "requestId": "uuid",                // the extension_ui_request id
  "method": "select",                 // select | confirm | input | editor
  "title": "🔐 Allow bash?", "message": "…", "options": ["Allow once", "…"],
  "toolCallId": "tc-42", "toolName": "bash",
  "status": "pending",                // "pending" | "resolved" | "rejected"
  "decision": null,                   // set once on resolve
  "createdAt": 1723100000000
}
```

### Permission marker (FR-25)

```jsonc
{ "v": 1, "toolCallId": "tc-42", "decision": "allow-session" | "allow-once" | "allow-always" | "deny" | "edited" }
```

### Audit entry (FR-34)

```jsonc
{ "t": 1723100000000, "tool": "bash", "verdict": "deny", "tier": "hard-deny",
  "rule": "bash.re:rm -rf /", "mode": "default", "layer": "default",
  "selector": "rm -rf /tmp/x (redacted)" }
```

## Edge Cases

- **Corrupt/missing config** → defaults + diagnostic; cache cleared so a fix
  is picked up next call (existing behavior preserved).
- **Workspace layer loosening** (an `allow` where user says deny, or
  `mode:"auto-approve"`) → that rule rejected + diagnostic; rest of layer
  applies.
- **Config says `mode:"yolo"`** → rejected + diagnostic; mode stays previous
  effective value.
- **Parallel tool calls** → each `tool_execution_start` updates the
  last-start association; preparation is sequential so the pending record
  always pairs with its own tool card; marker `toolCallId` disambiguates.
- **Reload mid-approval** → snapshot replays the pending record; the UI
  re-renders it; the original request id stays valid (FR-21).
- **Two tabs, one approval** → first resolution wins; the other tab's modal
  receives `approval_resolved` and closes (or shows the decision).
- **Decision POST fails** (server restart) → modal stays, decision retained,
  retry affordance; never silently close (FR-22/23).
- **ask_user_question under modes** → always prompt (FR-16); read-only does
  not block it; yolo does not suppress it.
- **Empty/whitespace selector** → skip gating (existing behavior).
- **Sensitive path in auto-approve** → still asks (mandatory-ask, FR-7/FR-13).
- **write/edit to a path escaping the workspace** → deny for write/edit,
  user-layer-only for read tools (FR-6).
- **Very long selectors** → truncated previews in UI, full value only in the
  audit selector when non-sensitive (existing 400-char preview kept).
- **JetBrains tab closed mid-review** → Deny (fail-closed, FR-40); file
  changed mid-review → conflict banner, re-open fresh.
- **Broker entry superseded by pi exit** → rejected with reason, UI resets
  to ready state (no dangling modal).
- **Legacy v1 config file** (no `version`) → loads as v2/default-mode; first
  page-driven write migrates it to v2 (adds `version`, `revision:1`).

---

**STOP — Phase 2 gate.** Is this specification complete and accurate — in
particular FR-13/14 (mode semantics), FR-4 (workspace tighten-only + mode
rules), and FR-26 (in-card decision surface)? (Yes/No)
