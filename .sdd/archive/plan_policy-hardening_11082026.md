# Plan — policy-hardening (SEC-01/02/04/06/14/15)

**SDD run:** `policy-hardening` · 2026-08-11 · U7 tranche (roadmap `docs/roadmap.md`)

## Problem Statement

The security review (`docs/security-review.md`, 2026-08-11) reproduced six
defects in the delivered U6 policy layer that make safeguard untrustworthy in
every mode. A committed `.pi/safeguard.json` can weaken built-in hard denies;
read-only mode auto-allows destructive shell commands; path containment has
three independent bypasses; sensitive-path patterns fail on Windows;
persisted `mode:"yolo"` overrides hard denies; and malformed config fails open
with no durable error. None of these produce a diagnostic the user would see.

## Business Goals

1. Safeguard is trustworthy in default, auto-approve, and read-only modes:
   no committed config can weaken a built-in deny, and read-only never runs a
   destructive command.
2. Path containment holds for every path-capable tool on POSIX and Windows,
   including missing targets below symlinks and `..` traversal.
3. Malformed or failed policy persistence degrades closed, with the failure
   visible to the user.
4. The policy engine remains pure, zero-dep, and shared by
   `server.js` (Permissions page) and the safeguard extension — UI verdicts
   can never diverge from the gate.

## Constraints

- Zero-dep CommonJS engine (policy-engine.js / bash-classifier.js), loaded by
  Node (tests, server) AND pi's jiti loader (extension). No fs access in the
  engine — callers inject readers/realpath.
- No API/schema break of the v2 config unless required by a finding; existing
  configs keep working (tighten-only semantics preserved).
- `applyMode` / gate flow in `safeguard.ts` stays the single live gate;
  yolo remains session-only in-memory state.
- Every change lands with its failing-first unit tests (TiCoder loop);
  existing 45 engine + 8 classifier + safeguard-contract tests keep passing.
- No implementation code before Phase 3 approval (SDD rule).

## Success Criteria

- SEC-01: workspace layer can never loosen an inherited subrule or inject
  `grants`/`nonInteractive`/`sensitivePaths` authority; strictest action
  always wins, with diagnostics.
- SEC-02: `env rm -rf .`, `find . -delete`, `sed -i`, `awk 'system(...)'`,
  `git remote -v remove origin` all resolve to ask/deny in read-only mode.
- SEC-04: `ls {"path":"/etc/passwd"}` (recon JSON), `sub/../../outside/new.txt`,
  and a write below an in-workspace symlink to outside all resolve ask/deny.
- SEC-06: sensitive patterns (`**/.env*` etc.) match `C:\proj\.env` on Windows.
- SEC-14: persisted `mode:"yolo"` normalizes to `default` with a diagnostic;
  file-backed yolo can never affect a verdict.
- SEC-15: malformed workspace config fails closed (previous good layer +
  visible error), and a failed grant-save surfaces before the approved call
  executes.
- All six have failing-first tests (existing reproduction asserts from the
  review's evidence list), then pass; full suite green; `.sdd/verify_` +
  archive completes the run.
