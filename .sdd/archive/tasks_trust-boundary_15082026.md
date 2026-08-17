# Tasks — trust-boundary (SEC-03/07/17, REL-24)

**SDD run:** `trust-boundary` · 2026-08-15 · Phase 3

Execution order is dependency-first: the broker's option validation
(SEC-07 core) before the client fallback that depends on its `invalid-option`
reason; the pure Kotlin bridge helpers (SEC-17a/REL-24a) before the wiring
that uses them (SEC-17b/c). Each chunk is one small change + its tests; run
the affected suites after each. Never advance on red.

**Primary files:** `server.js` (spawn args), `broker.js` (+ `test/broker.test.js`),
`public/app.js` (IDE fallback), `test/trust-boundary.test.js` (NEW — static
contracts for server.js/app.js), `jetbrains/.../DiffBridge.kt` (NEW — pure
helpers + `DiffBridgeTest.kt`), `DiffReviewEditor.kt`, `PiWebuiToolWindowFactory.kt`.

**Build/test commands:** Node — `node test/<x>.test.js`, full loop over
`test/*.test.js`. Kotlin — `cmd.exe /c <bat>` wrapper setting
`JAVA_HOME=<Rider>/jbr` then `gradlew.bat test` (GOTCHAS #17: never the
sh-wrapper; build/ output from Rider is not this environment's).

---

## Chunk 1 — SEC-03: pi child spawns without project-local trust

**Change:** `server.js` `startPi()` — compute `const BUNDLED_EXT =
path.join(__dirname, "extensions", "pi_minimal_webui", "index.ts")`. Args:
`["--mode","rpc", ...(fs.existsSync(BUNDLED_EXT) ? ["--no-approve","-e",
BUNDLED_EXT] : [ "--no-approve" ]), ...PI_ARGS]`. On missing extension, log
ONE loud warning (the ask bridge + safeguard are degraded — stock
ask_user_question auto-declines in RPC). `--approve` never appears unless the
user passes it via `PI_ARGS` (appended last → wins, documented override).
Replace the old `--approve` ponytail comment with the trust rationale.

**Tests** (`test/trust-boundary.test.js` — static contracts, failing-first):

- server.js source contains the `BUNDLED_EXT` derivation from `__dirname`
  (package-root relative, NOT `PI_CWD`/`process.cwd`) `# SEC-03`
- the spawn args contain `"--no-approve"` and `"-e"` in the exists-branch `# SEC-03`
- the fallback branch (missing extension) still spawns `--no-approve` without
  `-e` `# SEC-03`
- no unconditional `"--approve"` token anywhere in the args construction `# SEC-03`
- `...PI_ARGS` stays the LAST spread (explicit user `--approve` still wins) `# SEC-03`
- `isolated-prompt.js` keeps `--no-extensions` (regression lock) `# SEC-03`

- [x] Chunk 1
  - Tests: `test/trust-boundary.test.js` 7/7 — PASS (failing-first verified); full suite 30/30 PASS
  - Compliance: BUNDLED_EXT from `__dirname`; exists-branch `--no-approve`+`-e`, fallback `--no-approve` alone + loud console.error; no unconditional `--approve`; PI_ARGS last; isolated-prompt lock green. Probe-verified upstream: `-e` loads the full extension (safeguard setStatus fires). ✓

## Chunk 2 — SEC-07: broker validates decisions against offered options

**Change:** `broker.js` — `register` additionally stores `optionLabels`:
normalized string labels (`typeof o === "string" ? o : o && typeof o.label ===
"string" ? o.label : null`, filtered non-null, order kept) when `options` is a
non-empty array. `resolve(requestId, decision)` derives the label: string →
itself; object with string `.label` → that; else null. If `optionLabels` is
non-empty and the label ∉ optionLabels → `{ok:false, reason:"invalid-option"}`
and the record STAYS pending (response not consumed). Freeform methods
(confirm/input/editor — no options) accept any value, unchanged.

**Tests** (`test/broker.test.js`, failing-first):

- register with options `["Allow once","Deny"]`, resolve with
  `"Allow always (save to config)"` → `{ok:false, reason:"invalid-option"}`;
  `get(id).status === "pending"` `# SEC-07`
- same record then resolves with `"Allow once"` → `{ok:true}` (a correct
  client can still answer) `# SEC-07`
- object decision `{label:"Allow once", oldFull:"a", newFull:"b"}` → ok
  (label extraction) `# SEC-07`
- mandatory-ask evidence: options `["Allow once","Deny"]`, decision
  `"Allow for this session"` → invalid-option, pending preserved `# SEC-07`
- no options (confirm) → any value accepted, unchanged `# SEC-07`
- option objects `{label:"Deny"}` normalize; malformed entries (null, `{}`)
  skipped `# SEC-07`
- all 6 existing tests unchanged (first-response-wins, stale 410, clear,
  snapshot pending-only) `# SEC-07`

- [x] Chunk 2
  - Tests: `test/broker.test.js` 11/11 (5 new SEC-07 blocks + 6 existing) — PASS; full suite 30/30
  - Compliance: `optionLabelsOf` normalizes string/`.label` entries; `resolve` extracts the decision label (string or object `.label`) and rejects unknown → `invalid-option` WITHOUT consuming the response; freeform methods unchanged; server.js 410 path forwards the reason. ✓

## Chunk 3 — SEC-07: client renders offered options + graceful rejection

**Change:** `public/app.js` — `buildDiffPayload` adds `options` (string
labels of `pendingApproval.options`, mapped like line 154). `diffInIde`
awaits the response instead of fire-and-forget: `const r = await api(body);
const j = await r.json().catch(() => null);` — if `j && j.ok === false`:
`j.error === "invalid-option"` → toast warning + `openSelectModal(req)`
(re-ask with legal options; record still pending); `unknown`/`resolved` →
toast only (answered elsewhere; a second modal would double-answer).
Rejection (network) → existing catch (toast + modal fallback).

**Tests** (`test/trust-boundary.test.js` — static contracts):

- `buildDiffPayload` return object includes `options` derived from
  `pendingApproval.options` `# SEC-07`
- `diffInIde` inspects the response JSON and branches on
  `"invalid-option"` → reopens `openSelectModal(req)` `# SEC-07`
- `unknown`/`resolved` branches toast WITHOUT reopening the modal `# SEC-07`
- `api(body)` call is awaited inside a try (rejection still hits the existing
  fallback) `# SEC-07`

- [x] Chunk 3
  - Tests: `test/trust-boundary.test.js` 12/12 (5 new SEC-07 client checks) — PASS; full suite 30/30
  - Compliance: buildDiffPayload maps pendingApproval.options → string labels; diffInIde awaits the broker ack, invalid-option → toast + openSelectModal(req) (record still pending), answered-elsewhere → toast only; awaited send inside the try keeps the network-failure fallback. ✓

## Chunk 4 — SEC-17a + REL-24a: pure Kotlin bridge helpers

**Change:** NEW `jetbrains/src/main/kotlin/com/gorowynn/piwebui/DiffBridge.kt`
(pure, no IDE/CEF types): `parsePayload(json: String): DiffPayload?` — null
on blank/whitespace, Gson syntax error, or root not a JsonObject;
`composeResolveCall(id: String, value: Any): String` —
`window.__piDiffResolve("<id>",<gson value>);` with Gson-escaped args;
`normalizeOptions(raw: List<Any?>): List<String>` — string/`.label`
extraction, non-null, order kept (feeds the button bar).
`DiffPayload` moves into (or stays reachable from) DiffBridge.kt so the
parser owns its shape; add `options: List<String> = emptyList()`.

**Tests** (NEW `jetbrains/src/test/kotlin/com/gorowynn/piwebui/DiffBridgeTest.kt`):

- valid full payload JSON → all fields mapped incl. `options` `# SEC-17a`
- blank `""`/`"   "` → null `# SEC-17a`
- `"{not json"` → null (review evidence: no empty-DiffPayload fallback) `# SEC-17a`
- `"[1,2]"` (wrong root type) → null `# SEC-17a`
- missing optional fields → defaults, NOT null `# SEC-17a`
- `composeResolveCall("abc", "Deny")` → exact
  `window.__piDiffResolve("abc","Deny");` string; an object value serializes
  via Gson and stays a single argument `# REL-24a`
- `normalizeOptions(["Allow once", {label="Deny"}, null, {}])` →
  `["Allow once","Deny"]` `# SEC-07`

- [x] Chunk 4
  - Tests: `gradlew.bat test` — DiffBridgeTest 11/11 + WorkspaceContainmentTest 4/4, 0 failures — PASS
  - Compliance: `DiffBridge.kt` (pure object) owns parsePayload (null on blank/malformed/non-object root via JsonParser.isJsonObject), composeResolveCall (exact id-arg call), normalizeOptions, isStale/shouldBlockAllow (SEC-17b helpers landed here with their tests); DiffPayload+EditHunk moved in, `options: List<String>` added; old classes removed from the factory file. ✓

## Chunk 5 — SEC-17b/c + REL-24a/b: gate wiring, CAS, resolver map, disposal

**Change:**

- `DiffReviewEditor.kt`: button bar iterates `payload.options` when
  non-empty else the four-label fallback (old-webui back-compat). Stale-file
  block: at ALLOW decision, if the file changed on disk
  (`isStale(leftText, currentDiskText)` — pure helper in DiffBridge.kt),
  show inline warning + do NOT resolve; a "Re-read file" button rebuilds the
  diff request (fresh base, proposal re-applied per `payload.op`, right pane
  reset) and clears the block. Deny always resolves. `DiffReviewFile.decide`
  → `AtomicBoolean.compareAndSet(false,true)`; exactly one `onDecide`.
- `PiWebuiToolWindowFactory.kt`: `parsePayload` used in the handler (null →
  resolve Deny immediately, no editor). Injected JS becomes the
  `__piDiffResolvers` map keyed by `payload.requestId` (unique fallback when
  absent); `onDecide` → `composeResolveCall(id, value)`; unknown id/double
  resolve → no-op. A parent `Disposable` owns the JS query (disposed), the
  load handler (`removeLoadHandler`), and the browser; the tool-window
  content disposer is set to it (replaces `content.setDisposer(browser)`).

**Tests** (`DiffBridgeTest.kt` pure + CAS; wiring by compile + manual note):

- `isStale("a","b") == true`, `isStale("a","a") == false`, null/blank-safe `# SEC-17b`
- `shouldBlockAllow(label, stale)` — allow labels blocked when stale, Deny
  and edited-object-with-Deny-label never blocked `# SEC-17b`
- `DiffReviewFile` CAS: `decide("Allow once"); decide("Deny")` → callback
  fired EXACTLY once with the first value `# SEC-17c` (constructs without an
  IDE Application; if the test runtime can't load LightVirtualFile, assert
  the CAS logic via a extracted pure helper and note it here)
- compile of the resolver-map + disposal wiring = `gradlew.bat test` green `# REL-24a/b`
- manual IDE teardown check (tool window close frees handlers) noted as
  residual risk in verify `# REL-24b`

- [x] Chunk 5
  - Tests: `gradlew.bat test` — DiffBridgeTest 12/12 (incl. `decideResolvesExactlyOnce` CAS; LightVirtualFile constructs in the plain JVM test) + WorkspaceContainmentTest 4/4 — PASS; Node full suite 30/30
  - Compliance: editor buttons iterate `payload.options` (four-label fallback for old-webui payloads); stale allow blocked with inline warning + `Re-read file` rebuild (fresh base, proposal re-applied, right pane reset, old DiffRequestPanel disposed); Deny always resolves; `decide()` on `AtomicBoolean.compareAndSet`; factory uses `DiffBridge.parsePayload` (null → immediate Deny, no editor), id-keyed `__piDiffResolvers` map (page assigns requestId before stringify so both ends agree), `composeResolveCall`; parent `bridgeDisp` Disposable owns the JS query + load-handler removal (`removeLoadHandler()`) + browser, set as the content disposer. javap-verified: JBCefJSQuery is Disposable, CefClient.removeLoadHandler() takes no arg. Manual IDE teardown noted as residual risk. ✓

---

## Exit gates

- Node: full `test/*.test.js` loop green — 30 files (29 + NEW
  `trust-boundary.test.js`), including the extended `broker.test.js`.
- Kotlin: `cmd.exe /c` + Rider JBR `gradlew.bat test` green
  (WorkspaceContainmentTest + DiffBridgeTest + CAS).
- Every requirement SEC-03, SEC-07, SEC-17a/b/c, REL-24a/b has a passing
  test tagged `# <id>`.
- `.sdd/verify_trust-boundary_15082026.md` maps each id → test + outcome;
  archive the four artifacts into `.sdd/archive/`.
- CHANGELOG entry + roadmap U7 status update (trust-boundary tranche done).
