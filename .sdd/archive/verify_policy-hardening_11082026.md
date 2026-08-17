# Verify — policy-hardening (SEC-01/02/04/06/14/15)

**SDD run:** `policy-hardening` · 2026-08-11 · Phase 4 terminal verification

## Requirement → test mapping

| Req | Finding | Test (all `PASS`) | Outcome |
| --- | --- | --- | --- |
| SEC-01a | Scalar workspace rules tighten against every inherited subrule | `policy-engine.test.js` SEC-01a block: workspace `bash:"ask"`/`"allow"` over a default deny table dropped with diagnostic; `rm -rf /` stays hard-deny; tighten `read:"ask"` kept; per-key allow shadowing a deny rejected unless exact inherited allow | Fixed |
| SEC-01b | Workspace metadata cannot bypass the sweep | SEC-01b block: workspace `grants` excluded from effective + diagnostic; `nonInteractive` ignored; `sensitivePaths` merged additively, `allow` entries dropped; workspace mode only read-only | Fixed |
| SEC-01c | effective derives from the filtered workspace layer | SEC-01c block: dropped scalar absent from `effective`, kept tightening present, mode resolved post-filter | Fixed |
| SEC-02a | Name-only READONLY drops env/find/sed/awk/sort; git remote flag-skip | `bash-classifier.test.js` SEC-02a block: `env rm -rf .`, `find . -delete`, `sed -i …`, `awk 'system(…)’`, `sort -o` all mutate; `git remote -v remove origin` mutates; safe verbs unchanged | Fixed |
| SEC-02b | Mode-induced bash allows require the per-part gate | `policy-engine.test.js` SEC-02b + updated FR-13 bash assertions; `safeguard-contract.test.js` SEC-02b source audit (bashGate plumbed, read-only bash requires gate, auto-approve gated, yolo exempt) | Fixed |
| SEC-04a | Recon JSON selectors canonicalized per field | SEC-04a block: `ls {"path":"/etc/passwd"}` → ask/outside-workspace (review evidence), inside-root stays allow, non-path JSON unchanged | Fixed |
| SEC-04b | `..` normalized before containment | SEC-04b block: `sub/../../outside/new.txt` → hard-deny, `.` collapse inside, read-class ask-cap, Windows separators | Fixed |
| SEC-04c | Missing targets realpath nearest existing parent | SEC-04c block: symlink-parent write outside → hard-deny, inside link stays allow, direct realpath unchanged, fresh-tree fallback | Fixed |
| SEC-06 | Windows separator normalization | SEC-06 block: `C:\proj\.env` → mandatory-ask, `C:\proj\id_rsa` → deny, `**/*.key` matches `C:\keys\a.key`, POSIX unchanged | Fixed |
| SEC-14 | Persisted yolo normalizes to default | SEC-14 block: user/workspace yolo → effective.mode default + diagnostic; `rm -rf /` stays hard-deny; auto-approve survives | Fixed |
| SEC-15a | Malformed config keeps last-known-good + visible error | `safeguard-contract.test.js` behavioral block: valid→no warnings; malformed user after good→last-good denies + warning; malformed workspace→warning; missing files→clean | Fixed |
| SEC-15b | Atomic config writes; save failure blocks the call | behavioral block: success→atomic replace, no tmp, revision 1, grant persisted, released; failure→block + warning, Allow once releases, no phantom session grant | Fixed |

## Outcome

- **12/12 requirements fixed and test-locked**, mapping 1:1 to
  [`docs/security-review.md`](../docs/security-review.md) findings SEC-01, SEC-02,
  SEC-04, SEC-06, SEC-14, SEC-15 (ratings 9.9/9.8/9.4/8.9/9.1/8.0).
- Review evidence cases reproduced as failing tests first, then green:
  `ls {"path":"/etc/passwd"}` no longer allow; `write sub/../../outside/new.txt`
  and symlink-parent writes hard-deny; `env rm -rf .` / `find . -delete` /
  `sed -i` / `awk 'system()'` / `git remote -v remove origin` no longer
  read-only-class; workspace `bash:"ask"` cannot shadow `rm -rf /` deny;
  persisted yolo cannot reach `effective.mode`; malformed configs fail closed
  with last-known-good + visible error; failed always-grant saves block the
  call.
- **Full suite: 29/29 `test/*.test.js` pass** (policy-engine 55 checks,
  bash-classifier 12, safeguard-contract 10 source-audit + 14 behavioral
  asserts).
- Engine remains pure/zero-dep (no fs, no node:path — lexical `..` collapse,
  injected realpath ancestor walk); v2 config schema and the wire contract
  (labels, `extension_ui_response`, tool name `safeguard`) unchanged;
  yolo remains session-only.

## Residual notes (not regressions)

- SEC-15a errors surface via the gate's `ui.notify`; the `#permissions` page
  display of the errors channel is a follow-up (roadmap U7 items 7–9).
- `saveConfig`'s temp name uses `Date.now()` — fine for single-writer use;
  a collision retry would matter only under concurrent writers (none exist).
- SEC-03, SEC-05, SEC-07, SEC-17, REL-* remain open on the roadmap (U7).
