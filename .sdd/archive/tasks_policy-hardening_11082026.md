# Tasks — policy-hardening (SEC-01/02/04/06/14/15)

**SDD run:** `policy-hardening` · 2026-08-11 · Phase 3

Execution order is dependency-first: classifier verbs (SEC-02a) before the
mode gate (SEC-02b); mergeLayers internals (SEC-14) before the tighten sweep
(SEC-01) so mode resolution is stable while sweep tests land; canonicalize
(SEC-04) and matching (SEC-06) are independent of layers. Each chunk is one
small change + its tests; run the full affected suite after each. Never
advance on red.

**Primary files:** `extensions/pi_minimal_webui/policy-engine.js` (engine),
`extensions/pi_minimal_webui/bash-classifier.js` (classifier),
`extensions/pi_minimal_webui/safeguard.ts` (gate),
`test/policy-engine.test.js`, `test/bash-classifier.test.js`,
`test/safeguard-contract.test.js`.

---

## Chunk 1 — SEC-02a: classifier drops argument-sensitive name-only verbs

**Change:** `bash-classifier.js` `READONLY` set — remove `env`, `find`,
`sed`, `awk`, `sort`. `classifyPart` git branch: after `remote`, skip leading
`-*` flags, then classify the first non-flag token as the subcommand
(`remove`/`add`/`set-url` → mutate; none or `-v` → readonly).

**Tests** (`test/bash-classifier.test.js`):

- `classify("env rm -rf .").verdict === "mutate"` (was readonly) `# SEC-02a`
- `classify("find . -delete").verdict === "mutate"` `# SEC-02a`
- `classify("sed -i s/a/b/ f").verdict === "mutate"` `# SEC-02a`
- `classify("awk 'BEGIN{system(\"touch p\")}'").verdict === "mutate"` `# SEC-02a`
- `classify("sort -o out f").verdict === "mutate"` `# SEC-02a`
- `classify("ls -la").verdict === "readonly"` (unchanged safe verbs) `# SEC-02a`
- `classifyPart("git remote -v") === true`; `classifyPart("git remote remove origin") === false`; `classifyPart("git remote -v remove origin") === false` `# SEC-02a`
- `classifyPart("git status") === true` (unchanged) `# SEC-02a`

- [x] Chunk 1
  - Tests: `test/bash-classifier.test.js` 12/12 — PASS (new SEC-02a blocks green)
  - Compliance: READONLY drops env/find/sed/awk/sort; `git remote` skips leading flags then classifies the first non-flag token; safe verbs + probes unchanged; FR-11 locks green. ✓

## Chunk 2 — SEC-14: persisted yolo normalizes to default

**Change:** `policy-engine.js` `mergeLayers` mode resolution — a `mode:
"yolo"` in ANY layer contributes `"default"` to `effective.mode` (diagnostic
already emitted; keep it). Yolo never propagates.

**Tests** (`test/policy-engine.test.js`):

- user `{mode:"yolo"}` → `mergeLayers(...).effective.mode === "default"` and a
  diagnostic mentions yolo `# SEC-14`
- workspace `{mode:"yolo"}` → same; workspace `{mode:"read-only"}` still
  forces `"read-only"` `# SEC-14`
- `resolve("bash","rm -rf /", layers(user yolo))` + `applyMode(v, "default")`
  → `hard-deny` (action deny) `# SEC-14`
- default + user `{mode:"auto-approve"}` → `effective.mode === "auto-approve"`
  (unchanged) `# SEC-14`

- [x] Chunk 2
  - Tests: `test/policy-engine.test.js` SEC-14 block + full suite 47/47 — PASS
  - Compliance: mode resolution now drops yolo from ANY persisted layer (user/workspace/default → default); workspace read-only still forces; diagnostic loop unchanged; FR-12 tests still green. ✓

## Chunk 3 — SEC-01a: scalar workspace rules tighten against every inherited subrule

**Change:** `policy-engine.js` `mergeLayers` sweep — when the workspace rule
is a scalar, it loosens if ANY inherited subrule of that tool is stricter
(helper `strictestActionFor(effCfg, toolName)` returning the strictest action
among the tool's object values + wildcard + string, with `deny > ask >
allow`); workspace `allow` on a tool whose inherited table contains ANY
`deny` is loosening unless the allow key exactly matches an inherited
`allow` key (per-key path). Existing per-key `effActionFor` behavior stays.

**Tests** (`test/policy-engine.test.js`):

- workspace `bash:"ask"` over default `bash:{deny:…, ask:…}` → dropped with
  diagnostic; `resolve("bash","rm -rf /", layers)` still `hard-deny` `# SEC-01a`
- workspace `bash:"allow"` over default `bash:{deny:…}` → dropped; resolve
  `git status` unchanged (allow rule still matches from default) `# SEC-01a`
- workspace `read:"ask"` over default `read:{*:"allow"}` → KEPT (ask is
  stricter than allow) and `resolve("read","x")` → ask `# SEC-01a`
- per-key: workspace `bash:{"re:^ls(\\s|$)":"allow"}` over default with a
  deny table → kept only if the allow key matches an inherited allow key;
  otherwise dropped with diagnostic `# SEC-01a`
- all existing tighten-only tests unchanged `# SEC-01a`

- [x] Chunk 3
  - Tests: `test/policy-engine.test.js` SEC-01a block (5 scenarios, incl. the rm -rf / evidence) + full suite — PASS
  - Compliance: `strictestActionFor` (deny>ask>allow) gates workspace scalars; per-key allow shadowing an inherited deny rejected unless the exact key is an inherited allow; tightening still allowed; FR-4 tighten-only tests green. ✓

## Chunk 4 — SEC-01b: workspace metadata cannot bypass the sweep

**Change:** `policy-engine.js` `mergeLayers` — drop workspace `grants` and
`nonInteractive` with diagnostics; merge workspace `sensitivePaths`
additively + tighten-only (append `ask`/`deny` entries, drop `allow` entries
with diagnostic); workspace `mode` other than `"read-only"` dropped with
diagnostic (existing message). Applies to BOTH `layers` and `effective`.

**Tests** (`test/policy-engine.test.js`):

- workspace `{grants:["bash\0rm -rf /"]}` → effective.grants excludes it +
  diagnostic; a session grant lookup never sees it `# SEC-01b`
- workspace `{nonInteractive:"block"}` → effective.nonInteractive is the
  inherited value + diagnostic `# SEC-01b`
- workspace `{sensitivePaths:[{pattern:"**/secret*",action:"ask"}]}` →
  effective.sensitivePaths contains the inherited list PLUS the new entry `# SEC-01b`
- workspace `{sensitivePaths:[{pattern:"**/.env*",action:"allow"}]}` → entry
  dropped + diagnostic; inherited `.env` ask survives `# SEC-01b`
- workspace `{mode:"auto-approve"}` → effective.mode unchanged + diagnostic `# SEC-01b`

- [x] Chunk 4
  - Tests: `test/policy-engine.test.js` SEC-01b block (grants/nonInteractive/sensitivePaths/mode) + full suite — PASS
  - Compliance: workspace grants + nonInteractive dropped with diagnostics; sensitivePaths filtered to ask/deny and merged additively into effective; workspace mode still read-only-only. ✓

## Chunk 5 — SEC-01c: effective computed from the filtered workspace layer

**Change:** `policy-engine.js` `mergeLayers` — compute `effective` from the
post-sweep `ws` (and post-filter metadata), not the pre-sweep merge.

**Tests** (`test/policy-engine.test.js`):

- workspace `bash:"ask"` loosening (Chunk 3 case): `effective.bash` does NOT
  contain the dropped scalar; effective equals layers-derived view `# SEC-01c`
- workspace `read:"ask"` kept: appears in `effective.read` AND resolves `# SEC-01c`
- `effective.mode` still resolved per SEC-14 after filtering `# SEC-01c`

- [x] Chunk 5
  - Tests: SEC-01c block below (effective derives from filtered ws) + full suite — PASS
  - Compliance: `effective` built post-sweep via mergeTwo(filtered ws, effUser); dropped loosening rules absent from effective; kept tightenings present; mode resolved after filtering. ✓

## Chunk 6 — SEC-06: Windows separator normalization in path matching

**Change:** `policy-engine.js` `matchValue` (isPath branch) and
`sensitiveFor` — compare against the `\`→`/`-normalized candidate (canon and
raw selector). POSIX unaffected.

**Tests** (`test/policy-engine.test.js`):

- sensitive hit: selector `C:\\proj\\.env`, canon same, patterns
  `**/.env*` → `resolve("read", "C:\\proj\\.env", layers with sensitivePaths,
  realpath: identity)` → `mandatory-ask` `# SEC-06`
- `C:\\proj\\id_rsa` → `hard-deny` (deny entry) `# SEC-06`
- POSIX `./.env` and `/home/u/.env` hits unchanged `# SEC-06`
- glob `**/*.key` matches `C:\\keys\\a.key` `# SEC-06`

- [x] Chunk 6
  - Tests: `test/policy-engine.test.js` SEC-06 block (Windows .env/id_rsa/key globs, POSIX unchanged) + full suite 51/51 — PASS
  - Compliance: `slashNorm` applied in matchValue's path branch (glob + exact); sensitiveFor normalizes before matching; POSIX behavior byte-identical. ✓

## Chunk 7 — SEC-04a: recon-tool JSON selectors canonicalized per field

**Change:** `policy-engine.js` `resolve` — for `MAYBE_PATH` tools, if the
selector parses as JSON, extract path-like string values (key
`path|filePath|dir`, or key `pattern` whose value looks path-like, or any
value matching `isPathSelector` shape); canonicalize + containment-check each
field; any outside → `outsideRoot`; sensitive matching per field. Non-JSON
selectors unchanged.

**Tests** (`test/policy-engine.test.js`):

- `resolve("ls", '{"path":"/etc/passwd"}', layers, {workspaceRoot:"/ws",
  realpath: identity})` → action ask / tier outside-workspace (not allow) `# SEC-04a`
- `resolve("grep", '{"path":"src/x","pattern":"foo"}', …, root /ws)` →
  inside-root stays allow when rule allows `# SEC-04a`
- `resolve("find", '{"path":"/outside"}', …)` → outsideRoot `# SEC-04a`
- JSON with no path-like values → treated as non-path (existing behavior) `# SEC-04a`

- [x] Chunk 7
  - Tests: `test/policy-engine.test.js` SEC-04a block (outside field ask-cap, inside-root allow, non-path unchanged) + full suite 52/52 — PASS
  - Compliance: `jsonPathFields` extracts path/filePath/dir + path-shaped values; per-field canonicalize + containment; per-field sensitive (deny wins); rule matching still sees the raw selector. ✓

## Chunk 8 — SEC-04b: `..` normalized before containment

**Change:** `policy-engine.js` `canonicalize` — after joining a relative
selector to cwd, collapse `.` and `..` segments lexically (pure string math,
preserve drive letters / backslashes for Windows) before returning; the
containment check then runs on the normalized form.

**Tests** (`test/policy-engine.test.js`):

- `resolve("write","sub/../../outside/new.txt", …, {cwd:"/ws", root:"/ws",
  realpath: fail stub})` → hard-deny, outsideRoot true `# SEC-04b`
- `resolve("write","sub/./x.txt", …, cwd/root /ws)` → allow (inside) `# SEC-04b`
- `resolve("read","../outside", …, root /ws)` → outside-workspace cap ask `# SEC-04b`
- Windows: `resolve("write","sub\\..\\..\\outside\\n.txt", cwd C:\\ws)` →
  outside `# SEC-04b`

- [x] Chunk 8
  - Tests: `test/policy-engine.test.js` SEC-04b block (.. traversal hard-deny, . collapse inside, read-class ask-cap, Windows) + full suite — PASS
  - Compliance: `collapseDotSegments` normalizes joined relative selectors (both separators, drive letters preserved); containment now runs on the normalized form. ✓

## Chunk 9 — SEC-04c: missing targets realpath nearest existing parent

**Change:** `policy-engine.js` `canonicalize` — when realpath of the full
path throws (missing target), walk up the ancestor chain, realpath the
longest existing ancestor via the injected `realpath`, append the missing
suffix, return that. Fall back to the raw join when no ancestor realpaths.

**Tests** (`test/policy-engine.test.js`):

- realpath stub that resolves `/ws` → `/ws` but throws on missing:
  `resolve("write","link/outside/new.txt", …, {cwd:"/ws", root:"/ws",
  realpath: stub where realpath("/ws/link") → "/outside"})` → hard-deny,
  outsideRoot `# SEC-04c`
- same selector with link staying inside → allow `# SEC-04c`
- existing target still realpaths directly (no behavior change) `# SEC-04c`
- missing target under a NON-existing parent (no ancestor realpaths) → raw
  join fallback (existing behavior) `# SEC-04c`

- [x] Chunk 9
  - Tests: `test/policy-engine.test.js` SEC-04c block (symlink-outside deny, symlink-inside allow, direct realpath, fresh-tree fallback) + full suite 54/54 — PASS
  - Compliance: `canonicalize` walks deepest-first ancestor prefixes via injected realpath, appends the missing suffix; leading separator preserved for absolute paths; fallback unchanged. ✓

## Chunk 10 — SEC-02b: mode-induced bash allows require the per-part gate

**Change:** `policy-engine.js` `applyMode` — read-only branch: bash is
read-class only when `bashClassify.verdict === "readonly"` AND
`ctx.bashGate && ctx.bashGate.allow`. `safeguard.ts` step 4: mode-induced
bypass for bash only when `bash.gate.allow`; else fall through to ask
(read-only already denied via transform). Yolo untouched.

**Tests**:

- `test/policy-engine.test.js`: `applyMode({action:"allow",tier:"ordinary-ask"},
  "read-only", {toolName:"bash", bashClassify:{verdict:"readonly"},
  bashGate:{allow:false}})` → action deny `# SEC-02b`; with
  `bashGate:{allow:true}` → allow/read-only `# SEC-02b`; non-bash read tool
  with no bashGate unchanged `# SEC-02b`
- `test/safeguard-contract.test.js`: simulated gate — read-only mode +
  `env rm -rf .` → block (deny, no prompt) `# SEC-02b`; read-only + `git
  status` → allow without prompt `# SEC-02b`; auto-approve + `git status &&
  rm -rf src` → ask (never silent allow) `# SEC-02b`

- [x] Chunk 10
  - Tests: engine SEC-02b block (read-only deny/allow, yolo override) + updated FR-13 bash assertions + safeguard-contract SEC-02b audit — all PASS
  - Compliance: applyMode read-only bash read-class = readonly verdict AND bashGate.allow; auto-approve bash gated; gate passes bashGate; yolo untouched; FR-13/16/42 contract checks green. ✓

## Chunk 11 — SEC-15a: malformed config keeps last-known-good + errors

**Change:** `safeguard.ts` — `readCfgOrEmpty` distinguishes missing (empty,
no error) from malformed (parse error surfaced); per-path last-known-good
cache retained on malformed (invalidated on mtime advance); `loadLayers`
result carries `errors`; gate reports the error via `ctx.ui.notify` on the
next tool call with UI; Permissions page can display it.

**Tests** (`test/safeguard-contract.test.js` — simulated fs + ctx):

- valid user config → no errors `# SEC-15a`
- malformed user JSON after a previously-valid parse → layers still use the
  last-known-good config + errors contains the path `# SEC-15a`
- malformed workspace JSON (never parsed before) → no workspace layer +
  error surfaced `# SEC-15a`
- missing files → no errors (normal cold start) `# SEC-15a`
- gate reports: ctx.ui.notify called with a warning mentioning the config
  path `# SEC-15a`

- [x] Chunk 11
  - Tests: `test/safeguard-contract.test.js` behavioral SEC-15a block (valid→no warnings, malformed-user→last-good+warning, malformed-workspace→warning, missing→clean) + full suite 29/29 — PASS
  - Compliance: readCfgOrEmpty distinguishes missing (no error) from malformed (error + last-known-good, mtime -1 forces rebuild until fixed); loadLayers carries errors; gate notifies per error with UI. Harness note: Node 24 type-stripping caches .ts per file, so each scenario loads a per-scenario module copy. ✓

## Chunk 12 — SEC-15b: atomic config writes; save failure blocks the call

**Change:** `safeguard.ts` — `saveConfig` writes temp sibling + rename over
target, returns success/failure; `saveAllowAlways` propagates it;
`ALLOW_ALWAYS` branch reports the failure (`ctx.ui.notify` warning) and
returns a BLOCK (retryable — Allow once/session unaffected, they need no
write).

**Tests** (`test/safeguard-contract.test.js` — simulated fs):

- successful save → temp file gone, target replaced atomically, no torn
  JSON `# SEC-15b`
- failed save (target dir unwritable) → ALLOW_ALWAYS returns
  `{block:true, reason:/save/i}` + warning notify; `Allow once` still
  releases `# SEC-15b`
- failed save does not add the grant to session allows `# SEC-15b`
- `revision` increments on success only `# SEC-15b`

- [x] Chunk 12
  - Tests: `test/safeguard-contract.test.js` behavioral SEC-15b block (atomic save+no tmp+revision+grant persisted; failure→block+warning+Allow-once still releases+no phantom session grant) + full suite 29/29 — PASS
  - Compliance: saveConfig writes temp sibling + renameSync (atomic), returns success; saveAllowAlways propagates; ALLOW_ALWAYS blocks with reason naming the save when it fails and warns. ✓

---

## Exit gates

- Full suite: `node test/bash-classifier.test.js && node
  test/policy-engine.test.js && node test/safeguard-contract.test.js` green,
  then the whole `test/*.test.js` set (no regressions).
- Every requirement SEC-01a…SEC-15b has a passing test tagged `# SEC-xx`.
- `.sdd/verify_policy-hardening_11082026.md` maps each SEC id → test + outcome.
- Archive the four files into `.sdd/archive/`.
