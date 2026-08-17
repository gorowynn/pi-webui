# Spec — policy-hardening (SEC-01/02/04/06/14/15)

**SDD run:** `policy-hardening` · 2026-08-11 · Phase 2 of U7
**Source:** [`docs/security-review.md`](../docs/security-review.md) findings
SEC-01, SEC-02, SEC-04, SEC-06, SEC-14, SEC-15 (ratings 9.9/9.8/9.4/8.9/9.1/8.0).
Requirement IDs below reuse the finding IDs (SEC-01a…SEC-15b) so tests trace
1:1 to the review. Reproduced-evidence lines come from the review's
"Validation evidence" section.

**Contracts that must not change:** the engine stays pure/zero-dep (no fs —
callers inject realpath; no node:path — implement lexical resolution);
`resolve()`'s verdict shape `{action,tier,matchedRule,layer,reason}`; the
`applyMode` signature; `gateBash`'s return shape; the v2 config schema
(`validateConfig` unchanged except where a finding demands it); the wire
contract (tool name `safeguard`, option labels, `extension_ui_response`).

---

## SEC-01 — Workspace layer can weaken its own tighten-only layer (9.9)

### SEC-01a — Scalar workspace rules compare against EVERY inherited subrule

`mergeLayers`' tighten-only sweep compares a workspace scalar (e.g.
`bash: "ask"`) with `effActionFor(effUser, tool, tool)`, which resolves the
tool's own wildcard — not each inherited subrule. A workspace `bash: "ask"`
is therefore accepted and shadows the built-in `bash: {deny: …}` table
(`rm -rf /` drops from hard-deny to ordinary-ask).

- A workspace rule (scalar or pattern-table) is a **loosening** when ANY
  inherited subrule of the same tool is stricter than it:
  - scalar `ask` is loosening if any inherited subrule is `deny`;
  - scalar `allow` is loosening if any inherited subrule is `ask` or `deny`;
  - per-key: the key's action loosens when the SAME key (or wildcard) in the
    inherited tool table is stricter (existing `effActionFor` behavior) AND
    when the key pattern itself would shadow a stricter inherited pattern —
    conservative rule: a workspace `allow` for a tool whose inherited table
    contains ANY `deny` is loosening unless the allow key exactly matches an
    inherited `allow` key.
- Loosening workspace rules are dropped with a diagnostic (existing pattern),
  the rest of the layer still applies.
- All 45 existing `policy-engine.test.js` tighten-only tests stay green.

### SEC-01b — Workspace metadata cannot bypass the tightening sweep

The sweep skips `META_KEYS`, so workspace `grants`, `nonInteractive`, and
`sensitivePaths` flow into `effective` unfiltered; `safeguard.ts` then trusts
`effective.grants` as exact-selector always-grants and `effective.sensitivePaths`
as the sensitive table. A committed `.pi/safeguard.json` can inject an
always-grant or clear sensitive paths.

- **`grants`** in the workspace layer: rejected (dropped with a diagnostic).
  Grants are user-layer-only; a workspace may never add always-grants.
- **`nonInteractive`** in the workspace layer: rejected (dropped with a
  diagnostic). Headless posture is user/floor-only.
- **`sensitivePaths`** in the workspace layer: merged **additively** with the
  inherited list (never replacing it), and **tighten-only**: entries with
  `action: "ask"|"deny"` are appended; entries with `action: "allow"` are
  dropped with a diagnostic (an "allow" entry would weaken inherited
  protections). Workspace may add sensitive paths, never remove them.
- **`mode`** in the workspace layer: only `"read-only"` may force mode
  (existing behavior); `"default"`/`"auto-approve"`/`"yolo"` are dropped with
  a diagnostic.

### SEC-01c — `effective` is computed from the FILTERED workspace layer

`mergeLayers` computes `eff = mergeTwo(ws, effUser)` BEFORE the sweep and
returns `effective: {...eff, mode}` — so the Permissions page displays rules
that resolution (which uses `layers`) already dropped. The UI can therefore
show a loosened rule as effective while the gate denies.

- `effective` must be derived AFTER the tighten-only sweep and metadata
  filtering, from the filtered `ws` — the effective view and the `layers`
  resolution view can never disagree.
- `effective.mode` resolution (SEC-14) also happens after filtering.

## SEC-02 — Read-only mode permits destructive shell commands (9.8)

### SEC-02a — Name-only read-only allowlist drops argument-sensitive utilities

`bash-classifier.js`'s `READONLY` set classifies `env`, `find`, `sed`, `awk`,
`sort` as read-only **by executable name only**; argument semantics are
ignored. Under read-only mode, `applyMode` converts any classifier-readonly
bash verdict to allow, so `env rm -rf .`, `find . -delete`, `sed -i …`,
`awk 'system(…)’`, `sort -o file` all run.

- Remove `env`, `find`, `sed`, `awk`, `sort` from `READONLY`. They classify
  as `mutate` unless a future argument-level validator proves them safe
  (not in this run — the safe direction is ask).
- `classifyPart` keeps exact behavior for all remaining verbs (ls, cat, head,
  tail, grep, wc, diff, …).
- `git remote -v remove origin`: the git branch parser takes `toks[2]` as the
  remote subcommand and treats `-v` as "readonly" even when a mutating verb
  follows it. Fix: after `remote`, skip leading `-*` flags, then classify the
  first non-flag token as the subcommand (`remove`/`add`/`set-url` → mutate;
  none/`-v` → readonly).
- Review evidence `env rm -rf .` / `find . -delete` / `sed -i …` /
  `awk 'system(…)’` / `git remote -v remove origin` must all resolve
  **ask or deny** in read-only mode (never allow).

### SEC-02b — Mode-induced bash allows require the per-part gate

`safeguard.ts` step 4 lets `eff.tier ∈ {read-only, auto-approve, yolo}`
bypass the compound gate entirely. Read-only mode therefore auto-allows any
readonly-classified compound regardless of per-part rules.

- `applyMode` read-only branch: a bash command is read-class ONLY when the
  classifier verdict is `readonly` AND the per-part gate allows it
  (`bashGate && bashGate.allow`). Context gets `bashGate` alongside the
  existing `bashClassify`; non-bash tools unchanged.
- `safeguard.ts` step 4: mode-induced bypasses for bash apply only when
  `bash.gate.allow` — otherwise the command falls through to the ordinary
  ask path (read-only mode's transform already denied it in SEC-02b-1, so the
  deny path in step 1 handles read-only; auto-approve keeps the ask).
- Yolo remains the explicit session-only override (never gated).
- Review evidence: under read-only mode every command in SEC-02a resolves
  `deny`; under auto-approve mode they resolve `ask` (never silent allow).

## SEC-04 — Path containment has multiple bypasses (9.4)

### SEC-04a — Recon-tool JSON selectors are canonicalized per path field

`safeguard.ts` `selectorFor` serializes recon-tool inputs to JSON; the engine
treats the whole JSON string as one path, so `ls {"path":"/etc/passwd"}`
joins to cwd and resolves allow.

- `resolve()` gains a JSON-aware path extraction for `MAYBE_PATH` tools when
  the selector parses as JSON: collect every string value whose key is
  path-like (`path`, `filePath`, `dir`, `pattern` when it looks like a path)
  or whose value satisfies `isPathSelector`'s shape.
- Each extracted field is canonicalized and containment-checked
  independently; ANY field outside the root marks the call `outsideRoot`
  (read-class → ask cap, write/edit → hard-deny, existing FR-6 semantics).
- Sensitive matching (SEC-06) applies per field.
- Evidence: `ls {"path":"/etc/passwd"}` → not allow under default policy
  (outside-root cap → ask).

### SEC-04b — Relative paths normalize `..` before containment

`canonicalize` joins non-`..`-prefixed relative selectors to cwd raw;
`write sub/../../outside/new.txt` → `cwd/sub/../../outside/new.txt` → the
string-prefix containment check says inside → allow.

- `canonicalize` resolves the joined path lexically: collapse `.` segments
  and `..` segments against the joined root before any containment check
  (pure string math; drive-letter and `\` forms preserved for Windows).
- Containment (`isUnderRoot`) runs on the normalized form.
- Evidence: `write sub/../../outside/new.txt` → outside → hard-deny.

### SEC-04c — Missing targets realpath their nearest existing parent

For a missing write target below an in-workspace symlink/junction, realpath
of the full path fails and the raw join stays → allow.

- `canonicalize` walks up from the full joined path: realpath the longest
  existing ancestor, then append the missing suffix, then containment-check.
  Uses the already-injected `realpath` (realpathSync handles ancestor paths).
- Evidence: `write in-workspace-link/outside/new.txt` (link → outside) →
  outside → hard-deny.
- Mirror of server.js `safePath()`; that control is already verified — the
  engine gains the same semantics.

## SEC-06 — Sensitive-path rules fail on Windows (8.9)

Sensitive patterns use `/` separators (`**/.env*`); `C:\proj\.env` never
matches because `matchValue` compares raw backslash paths against the glob.

- Path matching (`matchValue` isPath branch and `sensitiveFor`) compares
  against the forward-slash-normalized candidate (both `canon` and the raw
  selector, `\` → `/`); `basename()` already normalizes.
- Evidence: `C:\proj\.env` read → mandatory-ask (sensitive hit) on Windows
  separators.
- POSIX behavior byte-identical (no backslashes present).

## SEC-14 — Persisted yolo mode overrides hard denies (9.1)

`mergeLayers` emits a diagnostic for persisted `mode:"yolo"` but still
returns `effective.mode === "yolo"`; `safeguard.ts` feeds it to `applyMode`,
which converts hard-deny → allow.

- `mode` resolution in `mergeLayers`: a `yolo` value in ANY layer is
  normalized to `"default"` with the existing diagnostic; yolo never reaches
  `effective.mode`.
- `validateConfig` keeps rejecting `yolo` on write paths (unchanged).
- Test: user config `{mode:"yolo"}` + `rm -rf /` → hard-deny under
  `resolve`+`applyMode("default")`; `effective.mode` is `"default"`.
- Yolo remains exclusively session state set by `/safeguard mode yolo`.

## SEC-15 — Policy parse/persistence failures weaken protection silently (8.0)

### SEC-15a — Malformed config fails closed with last-known-good + visible error

`readCfgOrEmpty` turns malformed JSON into `{}` (empty layer) with no
diagnostic — a corrupt workspace file silently discards its intended
tightening, and a corrupt user file silently drops user protections.

- `readCfgOrEmpty` distinguishes "missing file" (empty layer, no error) from
  "malformed JSON" (error surfaced).
- Malformed user/workspace file: the LAST KNOWN GOOD parsed layer is retained
  (per-file cache keyed by path, invalidated by mtime advance); the failure
  is surfaced through a new `errors` channel on the `loadLayers` result that
  the gate reports (ui.notify on the next tool call with UI) and the
  Permissions page displays.
- Fail-closed direction: malformed workspace → previous good workspace layer
  (or none if never parsed) — never a silent empty layer that pretends the
  workspace said nothing.

### SEC-15b — Config writes are atomic and save failures block the approved call

`saveConfig` swallows write errors (`catch { /* best-effort */ }`), and
`ALLOW_ALWAYS` proceeds even when the grant was never persisted — the user
believes the grant is saved, the gate will ask forever, and the approval flow
already released the tool call.

- `saveConfig` writes atomically: write a temp sibling file, then rename over
  the target (same directory → same filesystem).
- `saveConfig` returns success/failure; `saveAllowAlways` and the
  `ALLOW_ALWAYS` branch report the failure to the user (`ctx.ui.notify`,
  `"warning"`) and DO NOT release the call as if granted — the call is
  blocked with a reason naming the failed save (retryable: the user can
  choose Allow once/session, which need no write).
- Evidence: with `CONFIG_PATH` made unwritable, `ALLOW_ALWAYS` → warning +
  block (never a silent proceed); file content on disk unchanged or fully
  replaced (no torn JSON).

---

## Non-goals (out of scope this run)

- SEC-03 (project-local extensions `--approve`), SEC-05 (Git literal
  pathspecs), SEC-07 (IDE decision-set validation), SEC-17, REL-* — tracked
  separately in roadmap U7.
- A real shell parser for `partPathTokens` (named ceiling stays documented).
- Regex complexity bounds (SEC-13) — separate finding.
- `policy-engine.js` gaining fs access (never; callers inject).
