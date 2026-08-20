# Plan — trust-boundary (SEC-03/07/17, REL-24)

**SDD run:** `trust-boundary` · 2026-08-15 · U7 tranche (roadmap `docs/roadmap.md`)

## Problem Statement

The security review (`docs/security-review.md`, 2026-08-11) reproduced four
trust-boundary defects spanning the bridge between browser, server, and IDE:

- **SEC-03 (9.6):** `server.js` starts every pi child with `--approve`,
  which trusts ALL project-local files (`.pi/extensions`) for the run. Opening
  or switching to an attacker-controlled repository executes repository code
  as the current user — the whole point of a workspace-switching web UI makes
  this reachable in one click.
- **SEC-07 (8.8):** the broker registers each blocking request's legal options,
  but nothing validates the decision against them. The JetBrains gate always
  renders all four allow labels, so a **mandatory-ask** approval (safeguard
  offers only "Allow once"/"Deny") can be answered "Allow always" from the
  IDE — turning a one-shot gate into a persistent grant that safeguard
  accepts and persists.
- **SEC-17 (7.6):** the IDE diff gate fails open on malformed bridge JSON
  (becomes an empty diff the user can still approve), allows approving against
  a file that changed on disk mid-review (only a browser toast), and its
  `decide()` check-then-set is not atomic.
- **REL-24 (5.6):** the IDE bridge keys ALL diff requests to a single global
  `window.__piDiffResolve` — overlapping approvals cross-resolve — and the JS
  query + load handler are never disposed (documented leak).

## Business Goals

1. Opening an untrusted repository in pi-webui never executes repository
   code; only the bundled bridge extension and user-installed packages load
   (SEC-03 remediation: "explicitly load only the bundled bridge extension").
2. A blocking approval can only ever be answered with one of the options the
   gate actually offered — enforced server-side at the broker (authoritative),
   not by trusting any client (SEC-07).
3. The IDE diff gate fails closed: malformed payloads deny, stale-file
   approvals are blocked until an explicit re-read, decisions resolve exactly
   once (SEC-17).
4. Overlapping IDE approvals each resolve to their own request; bridge
   handlers are disposed with the tool window (REL-24).

## Constraints

- **Zero-build invariant** for the webui: no bundler/transpile; `server.js` /
   `app.js` edits stay plain Node/browser JS.
- `jetbrains/` is a standalone pinned Gradle project (IntelliJ Platform Gradle
  Plugin 2.7.0, Kotlin 2.4.0, `instrumentCode=false` — GOTCHAS #16). Build from
  this environment via `cmd.exe /c <bat>` with the Rider JBR as JAVA_HOME
  (`./gradlew` sh-wrapper crashes — GOTCHAS #17); the webui side stays testable
  with `node --check` + unit tests.
- **Wire compatibility:** the extension_ui_response channel, broker record
  shape, and safeguard label strings ("Allow once" / "Allow for this session" /
  "Allow always (save to config)" / "Deny") are load-bearing contracts
  (GOTCHAS #7). Cross-version plugin↔webui pairs must degrade safely (old
  plugin + new webui: server-side validation still holds; new plugin + old
  webui: promise contract unchanged — `piWebuiOpenDiff(payload) → decision`).
- The broker stays pure zero-dep CommonJS (server-side only, unit-tested).
- `PI_ARGS` is appended after built-in args today — the explicit
  `--approve` user override must keep working (documented escape hatch).
- Probe-verified fact (2026-08-15): `pi --mode rpc --no-approve -e
  <abs>/extensions/pi_minimal_webui/index.ts` loads the bundled extension
  (safeguard setStatus fires) while project-local extensions stay untrusted —
  the fix mechanism exists upstream.
- Every fix lands with failing-first tests; existing suites (29 Node files,
  Kotlin `WorkspaceContainmentTest`) keep passing; no implementation code
  before Phase 3 approval (SDD rule).

## Success Criteria

- **SEC-03:** `server.js` spawns pi with `--no-approve` plus an explicit `-e`
  pointing at the bundled extension (absolute, derived from the package root,
  NOT `PI_CWD`); the ask bridge + safeguard still function in standalone npm,
  repo-dev, and `/webui` (IDE) modes; `PI_ARGS=--approve` remains a working
  explicit override.
- **SEC-07:** broker.resolve rejects a decision whose label is not among the
  registered options (record stays pending — a correct client can still
  answer); the IDE renders only the offered options (payload carries them);
  a rejected IDE decision falls back to the webui select modal instead of
  leaving the approval silently pending.
- **SEC-17:** malformed bridge JSON resolves Deny (no empty-diff editor);
  an allow decision against a changed-on-disk file is blocked until the user
  explicitly re-reads (rebase UX) or denies; `decide()` is atomic
  compare-and-set.
- **REL-24:** each request resolves through an id-keyed resolver map; stale/
  duplicate replies are no-ops; the JS query and load handler are disposed
  with the tool window content.
- Full Node suite green (29 files + broker additions); `gradlew test` green
  in `jetbrains/` (existing + new pure Kotlin tests).
