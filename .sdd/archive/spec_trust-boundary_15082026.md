# Spec — trust-boundary (SEC-03/07/17, REL-24)

**SDD run:** `trust-boundary` · 2026-08-15 · Phase 2 of U7
**Source:** [`docs/security-review.md`](../docs/security-review.md) findings
SEC-03 (9.6), SEC-07 (8.8), SEC-17 (7.6), REL-24 (5.6). Requirement IDs reuse
the finding IDs (SEC-03, SEC-07, SEC-17a…c, REL-24a/b) so tests trace 1:1 to
the review.

**Contracts that must not change:** the `extension_ui_response` channel and
marker format (`{v, toolCallId, decision}`); broker record shape (additive
fields only); safeguard option labels ("Allow once" / "Allow for this
session" / "Allow always (save to config)" / "Deny"); `piWebuiOpenDiff(payload)
→ decision(value)` promise shape; pinned JetBrains build (IPG 2.7.0, Kotlin
2.4.0, GOTCHAS #16); zero-build webui.

**Probe-verified fact (2026-08-15):** `pi --mode rpc --no-approve -e
<abs>/extensions/pi_minimal_webui/index.ts` loads the bundled extension
(safeguard `setStatus` fires) while project-local extensions stay untrusted;
user-level npm packages keep loading.

---

## SEC-03 — pi child no longer trusts project-local files (9.6)

`server.js:282` spawns `["--mode","rpc","--approve", ...PI_ARGS]`. `--approve`
trusts ALL project-local files (`.pi/extensions`) — opening/switching to an
attacker-controlled workspace executes repository code.

- The spawn args become `["--mode","rpc","--no-approve","-e", BUNDLED_EXT,
  ...PI_ARGS]` where `BUNDLED_EXT = path.join(__dirname, "extensions",
  "pi_minimal_webui", "index.ts")` — **package-relative (absolute), never
  derived from `PI_CWD`**, so a workspace switch cannot redirect it.
- Startup guard: if `BUNDLED_EXT` is missing (broken install), log ONE loud
  warning and spawn `--no-approve` WITHOUT `-e` — fail toward no-project-trust
  with a degraded gate, never silently back to `--approve`.
- `PI_ARGS` is appended last, so `PI_ARGS=--approve` remains the documented
  explicit opt-in for users who want project-local trust.
- `isolated-prompt.js` already passes `--no-extensions` (no discovery) —
  verified, no change needed.

## SEC-07 — approval decisions are validated against the offered options (8.8)

The broker registers each blocking request's `options`, but `resolve()`
accepts any value. The IDE always renders all four allow labels, so a
**mandatory-ask** (safeguard offers only "Allow once"/"Deny") can be answered
"Allow always (save to config)" — a persistent grant the gate never offered —
and `server.js:1029-1068` forwards it unvalidated.

- **Registration** normalizes options to their string labels
  (`typeof o === "string" ? o : o && o.label`, strings only, order kept);
  the raw `options` field on the record is unchanged (replay fidelity).
- **`broker.resolve(requestId, decision)`** derives the label: a string
  decision is itself; an object decision uses `decision.label` when a string
  (the editable-diff shape `{label, oldFull, newFull}`); otherwise null.
  When the normalized list is non-empty and the label is not in it →
  `{ok:false, reason:"invalid-option"}` and the record **stays pending**
  (no response consumed; a correct client can still answer). Freeform
  methods (confirm/input/editor — no options) accept any value, unchanged.
- **server.js** `/api/cmd` already maps any `resolve` `!ok` to 410 + reason —
  `invalid-option` flows through unchanged.
- **IDE renders the offered options:** `DiffPayload` gains
  `options: List<String>`; the button bar iterates `payload.options` when
  non-empty, else falls back to the four-label list (old-webui back-compat).
  `app.js buildDiffPayload` adds `options` (string labels of the pending
  approval's options).
- **Rejected IDE decision degrades gracefully:** `app.js diffInIde` awaits
  the `/api/cmd` response; on `invalid-option` it toasts and reopens the
  webui select modal (legal options only). On `unknown`/`resolved` it only
  toasts (the approval was already answered elsewhere — a second modal would
  double-answer). The webui modal path already renders `req.options`, so it
  cannot produce an invalid label.

## SEC-17 — IDE diff gate fails open (7.6)

### SEC-17a — Malformed bridge JSON resolves Deny

`Gson().fromJson(json, …) catch → DiffPayload()` today yields an empty diff
("change") the user can still approve.

- Payload parsing moves to a pure `parsePayload(json): DiffPayload?` — null
  on blank input, Gson syntax errors, or wrong root type. The handler treats
  null as an immediate fail-closed Deny (no editor tab).

### SEC-17b — Stale-file allows are blocked until an explicit re-read

`resolveValue` computes `conflict` (file changed on disk vs. the diff's base)
but ships it as an advisory flag; the webui toasts and the allow still lands.

- Staleness is recomputed at decision time. An ALLOW decision while stale is
  **blocked**: no resolution, an inline warning explains why, and a
  **"Re-read file"** button rebuilds the diff (fresh base + the proposal
  re-applied per `payload.op`, right pane reset) and clears the block.
  **Deny always resolves** (fail-closed direction).
- Pure helpers `isStale(...)` / `shouldBlockAllow(...)` carry the logic;
  the UI wiring stays thin. The webui toast for the advisory `conflict`
  flag stays (REL-16 fidelity is out of scope).

### SEC-17c — decide() is atomic compare-and-set

`DiffReviewFile.decide` uses `@Volatile var decided` check-then-set — two
racing callers (button double-click vs. dispose→Deny) can both pass.

- `decided` becomes an `AtomicBoolean`; `decide` uses
  `compareAndSet(false, true)` — exactly one `onDecide` invocation ever.

## REL-24 — bridge plumbing is not reentrant and leaks handlers (5.6)

### REL-24a — id-keyed resolvers; stale/duplicate replies are no-ops

One global `window.__piDiffResolve` means overlapping approvals cross-resolve
(second request overwrites the first resolver).

- Injected JS keeps `window.__piDiffResolvers = {}`: `piWebuiOpenDiff`
  stores its resolver under `payload.requestId` (unique fallback id when
  absent) and exposes `window.__piDiffResolve(id, value)` which pops+calls
  exactly that resolver; unknown id / double resolve → no-op. Kotlin's
  `onDecide` calls the id form (id = payload.requestId). A pure
  `composeResolveCall(id, value)` builds the JS call string.
- Back-compat: the promise contract `piWebuiOpenDiff(payload) → decision`
  is unchanged for app.js; both bridge ends live in plugin code.

### REL-24b — bridge handlers are disposed with the tool window

`JBCefJSQuery` + the load handler outlive the browser (documented leak).

- A parent `Disposable` owns: the JS query (disposed), the load handler
  (removed via `removeLoadHandler`), and the browser; the tool-window
  content's disposer is set to that parent. Verify the disposal API
  surface with `javap` during implementation (GOTCHAS #17); no behavioral
  test — manual IDE teardown check, noted as residual risk.

## Non-goals (out of scope this run)

- SEC-08 (loopback auth), SEC-09 (JCEF injection scoping), SEC-16 (audit
  redaction), REL-16 (replay fidelity), REL-14 (confirm RPC shape) — later
  U7 medium tranche.
- Making the webui select modal await broker acks generally (only the IDE
  path gains the invalid-option fallback; REL-12's broader
  acknowledgment-until-terminal work is runtime-resilience tranche).
- Any change to safeguard's gate flow — the gate already offers the right
  options; this tranche makes the pipeline ENFORCE them.
