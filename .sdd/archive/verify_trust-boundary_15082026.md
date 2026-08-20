# Verify — trust-boundary (SEC-03/07/17, REL-24)

**SDD run:** `trust-boundary` · 2026-08-15 · Phase 4 terminal verification

## Requirement → test mapping

| Req | Finding | Test (all `PASS`) | Outcome |
| --- | --- | --- | --- |
| SEC-03 | pi child trusted all project-local files (`--approve`) | `test/trust-boundary.test.js` SEC-03 block (7 checks): BUNDLED_EXT from `__dirname` not PI_CWD; exists-branch `--no-approve`+`-e`; fallback `--no-approve` alone + loud `console.error`; no unconditional `--approve`; `...PI_ARGS` last (explicit override wins); isolated-prompt keeps `--no-extensions`. Upstream probe (2026-08-15): `--no-approve -e <bundled>` loads the full extension (safeguard setStatus fires) | Fixed |
| SEC-07 | Decisions not validated against offered options (mandatory-ask → "Allow always" via IDE) | `test/broker.test.js` SEC-07 blocks (5 tests): illegal label → `{ok:false, reason:"invalid-option"}` with record **staying pending**; correct answer still wins; object decisions validated by `.label`; freeform (confirm/input/editor) unchanged; `{label}`/malformed option entries normalize/skip. Client side: `test/trust-boundary.test.js` SEC-07 block (5 checks) — payload carries `options`, `diffInIde` awaits the ack, `invalid-option` → reopen modal, answered-elsewhere → toast only, awaited send inside the try. Kotlin: `DiffBridgeTest.normalizeOptions*` + `validFullPayload` (options ride the payload) | Fixed |
| SEC-17a | Malformed bridge JSON became an empty approvable DiffPayload | `DiffBridgeTest`: blank/`{not json`/non-object root → `parsePayload` null; `validFullPayload` + `missingOptionalFieldsUseDefaults` keep the well-formed paths. Factory wiring (compile-gated): null → immediate Deny, no editor tab | Fixed |
| SEC-17b | Stale-file allows passed with only a browser toast | `DiffBridgeTest.isStaleBasics` + `shouldBlockAllowOnlyWhenStaleAllow` (allow labels blocked when stale, Deny never); editor wiring: inline warning + `Re-read file` rebuilds the diff (fresh base, proposal re-applied, old panel disposed) | Fixed |
| SEC-17c | `decide()` check-then-set race (double-click vs dispose→Deny) | `DiffBridgeTest.decideResolvesExactlyOnce` — exactly one `onDecide`, first value wins (AtomicBoolean CAS; constructs in plain JVM test) | Fixed |
| REL-24a | Single global `__piDiffResolve` cross-resolved overlapping requests | `DiffBridgeTest.resolveCallExact` + `resolveCallSerializesObjects` (id-keyed call, single Gson-escaped value arg); page keeps `__piDiffResolvers` map — unknown id / double resolve no-op; both bridge ends derive the id from `payload.requestId` (page assigns before stringify) | Fixed |
| REL-24b | JS query + load handler leaked past the browser | Wiring (compile-gated): parent `bridgeDisp` Disposable owns the JS query, the load-handler removal (`CefClient.removeLoadHandler()`), and the browser; set as the tool-window content disposer. javap-verified API surface (JBCefJSQuery is Disposable) | Fixed (manual IDE teardown = residual check) |

## Outcome

- **7/7 requirements fixed and test-locked** (SEC-03 9.6, SEC-07 8.8, SEC-17 7.6,
  REL-24 5.6 in the review's ratings).
- Node: full suite **30/30** files green (29 prior + NEW
  `test/trust-boundary.test.js`; `broker.test.js` extended 6 → 11 tests).
- Kotlin: `gradlew.bat test` green — DiffBridgeTest **12/12** (new) +
  WorkspaceContainmentTest 4/4. Built via `cmd.exe /c` + Rider JBR (GOTCHAS #17
  workaround; `./gradlew` sh-wrapper stays off-limits).
- Wire compatibility preserved: `piWebuiOpenDiff(payload) → decision` promise
  shape, `extension_ui_response` + marker format, safeguard labels, broker
  record shape (additive `optionLabels` only). Cross-version pairs degrade:
  old plugin + new webui (plugin JS is self-contained) and new plugin + old
  webui (missing `options` → four-label fallback; Gson ignores unknown fields).
- `PI_ARGS=--approve` remains the documented explicit opt-in to project trust.

## Residual notes (not regressions)

- **REL-24b disposal** is compile-gated + API-verified but not behavior-tested
  (needs a live IDE); manual check on tool-window close is the residual task.
- The malformed-cefQuery Deny call keys the id `"malformed"` (no resolver —
  correct no-op: garbage cefQuery traffic never registered a promise).
- The webui modal path (non-IDE) already rendered `req.options`, so it cannot
  mint an invalid label; only the IDE path needed the enforcement + fallback.
- SEC-07's broker validation is the authoritative gate — future clients
  (mobile, CLI) inherit it for free via `/api/cmd`'s 410 mapping.
