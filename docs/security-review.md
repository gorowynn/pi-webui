# Security and robustness review — current working tree

> **Role:** Evidence-backed security, error-resistance, self-healing,
> release-readiness, and reliability review with rated findings and remediation
> order.
>
> **Reviewed:** 2026-08-11. **Status:** open findings; not release-ready.
> Line references and results describe a working tree with 73 dirty entries,
> not the last published npm package.

## Verdict

| Area | Rating |
| --- | ---: |
| Security | **2.5/10** |
| Release readiness | **1/10** |
| Reliability | **4/10** |
| Test posture | **5/10** |
| Architecture | **6/10** |
| **Overall** | **3/10 — not release-ready** |

Ratings use 9–10 = critical, 7–8.9 = high, 4–6.9 = medium, and
0–3.9 = low.

## Critical findings

### SEC-01 — Workspace policy can weaken its own tighten-only layer — 9.9/10

`mergeLayers()` has two independent precedence failures. A scalar workspace
rule is compared with the inherited wildcard instead of every inherited
subrule, so a workspace `bash: "ask"` is accepted and then shadows stricter
built-in Bash denies. Separately, workspace metadata is merged before only tool
rules are filtered; `grants`, `sensitivePaths`, and `nonInteractive` therefore
bypass the tightening sweep.

Evidence:

- `extensions/pi_minimal_webui/policy-engine.js:554-566` merges the workspace
  object into `effective` before validation.
- `extensions/pi_minimal_webui/policy-engine.js:592-616` explicitly skips all
  metadata keys during the tighten-only sweep.
- `extensions/pi_minimal_webui/policy-engine.js:627-631` returns that unfiltered
  effective configuration.
- `extensions/pi_minimal_webui/safeguard.ts:307-318` trusts the resulting grants
  and sensitive-path table.
- `extensions/pi_minimal_webui/safeguard.ts:386-390` lets a matching grant bypass
  the gate.
- A direct engine check confirmed that adding workspace `bash: "ask"` changes
  catastrophic `rm -rf /` from `deny/hard-deny` to `ask/ordinary-ask` without a
  diagnostic.

A committed `.pi/safeguard.json` can weaken built-in hard denies, clear
sensitive paths, change headless behavior to allow, or inject an exact-selector
command grant without producing a diagnostic.

**Required remediation:** compare scalar workspace rules against every inherited
subrule and preserve the strictest action; reject workspace `grants` and
`nonInteractive`; merge sensitive paths additively/tighten-only; calculate
`effective` only after the workspace layer has been filtered.

### SEC-02 — Read-only mode permits destructive shell commands — 9.8/10

The Bash classifier labels commands read-only mostly from the executable name:

- `env`, `find`, `sed`, `awk`, and `sort` are allowlisted at
  `extensions/pi_minimal_webui/bash-classifier.js:16-21`.
- Argument semantics are ignored at
  `extensions/pi_minimal_webui/bash-classifier.js:143-160`.
- `extensions/pi_minimal_webui/policy-engine.js:684-694` converts any
  classifier-readonly Bash verdict to allow in read-only mode.
- `extensions/pi_minimal_webui/safeguard.ts:398-414` explicitly lets
  mode-induced allows bypass the compound gate.

Direct checks confirmed that all of these resolve to **allow** in read-only
mode:

```text
env rm -rf .
find . -delete
sed -i s/a/b/ file
awk 'BEGIN { system("touch pwn") }'
git remote -v remove origin
```

**Required remediation:** read-only Bash must require the strict per-part policy
gate. Remove argument-sensitive utilities from the name-only allowlist and
validate complete argument sequences.

### SEC-03 — Project-local extensions are automatically trusted — 9.6/10

`server.js:271-294` starts every pi child with `--approve`. The surrounding
comment confirms that this trusts project-local `.pi/extensions`.

Opening or switching to an attacker-controlled repository can therefore execute
repository code as the current user.

**Required remediation:** explicitly load only the bundled bridge extension.
Do not approve the entire workspace; require separately persisted trust for
project extensions.

### SEC-04 — Path containment has multiple bypasses — 9.4/10

Three independent failures were reproduced:

1. `extensions/pi_minimal_webui/safeguard.ts:182-221` serializes recon-tool
   inputs as JSON, after which the policy engine treats the entire JSON string
   as one path.
2. `extensions/pi_minimal_webui/policy-engine.js:250-286` joins missing relative
   paths without normalizing embedded `..`, then relies on a string-prefix
   containment check.
3. For a missing write target below an in-workspace symlink/junction, policy
   canonicalization does not realpath the nearest existing parent. A target
   whose parent pointed outside the workspace still resolved to
   `allow/allow`, `outsideRoot=false`.

Observed results:

```text
ls {"path":"/etc/passwd"}                 → allow
write sub/../../outside/new.txt           → allow
write in-workspace-link/outside/new.txt   → allow
```

The recon-tool case works under the default policy because `grep`, `find`, `ls`,
and `glob` are allowed.

**Required remediation:** extract and canonicalize each real path field
independently. Resolve relative paths with `path.resolve(cwd, value)` and
realpath the nearest existing parent before appending a missing suffix and
performing any containment check.

### SEC-05 — Git single-file discard expands pathspec magic — 9.2/10

Browser-derived repository paths reach Git as pathspecs at `git.js:456-484`.
The `--` separator stops option parsing but does not disable pathspec magic.

A POSIX filename such as `:(glob)**` can make a one-file discard affect every
matching file. For an added file, the `git rm --cached` followed by `git clean`
sequence can cause severe data loss.

A temporary-repository check confirmed:

```text
git ls-files -- ':(glob)**'                 → matched every file
git --literal-pathspecs ls-files -- ...     → matched none
```

**Required remediation:** use Git's `--literal-pathspecs` global option or
prefix every browser-derived path with `:(literal)`.

### SEC-14 — Persisted yolo mode overrides hard denies — 9.1/10

`mergeLayers()` emits a diagnostic for persisted `mode: "yolo"` but still
returns `effective.mode === "yolo"`. `safeguard.ts` then passes that effective
mode to `applyMode()`, which changes even a built-in `deny/hard-deny` verdict to
`allow/yolo`.

A direct engine check using user configuration `{ "mode": "yolo" }` confirmed
that catastrophic `rm -rf /` changes from hard-deny to allow while the only
failure signal is a non-blocking diagnostic.

**Required remediation:** remove persisted yolo from the effective configuration
before returning it, normalize it to `default`, and test that file-backed yolo
can never affect a tool verdict. Keep yolo exclusively in confirmed in-memory
session state.

### REL-01 — Published npm package omits all root runtime modules — 10/10

`package.json:7-13` ships only `server.js`, `bin.js`, and three directories.
`server.js` requires nine root modules that are not in the package whitelist.

`npm pack --dry-run --json` confirmed all nine are absent:

```text
broker.js
git.js
isolated-prompt.js
jsonl.js
livebuf.js
recent-sessions.js
session-entries.js
workspace-file.js
workspaces.js
```

An installation built from this tree fails immediately with
`MODULE_NOT_FOUND`.

**Required remediation:** add every runtime module to `package.json#files`, then
make package-completeness validation a release test.

## High findings

| ID | Rating | Finding | Evidence and impact |
| --- | ---: | --- | --- |
| SEC-06 | **8.9** | Sensitive-path rules fail on Windows | `extensions/pi_minimal_webui/policy-engine.js:52-83` never normalizes `\` to `/`, while shipped patterns use `**/…`. A reproduced `C:\proj\.env` read resolved to allow rather than mandatory ask. |
| SEC-07 | **8.8** | Mandatory approvals can become permanent grants | Safeguard offers only Allow once/Deny at `extensions/pi_minimal_webui/safeguard.ts:461-470`, but the IDE always renders all four choices at `jetbrains/src/main/kotlin/com/gorowynn/piwebui/DiffReviewEditor.kt:100-109`. Safeguard accepts session/always labels at `extensions/pi_minimal_webui/safeguard.ts:502-514`, and `server.js:1029-1068` does not validate the decision against the broker's options. |
| REL-02 | **8.2** | Process-tree termination is broken | `server.js:9` does not import `execSync` but calls it at `server.js:397-405`, so Windows workspace switching cannot kill pi. POSIX signals only the parent PID; `isolated-prompt.js:50-55` has the same descendant-process problem. |
| REL-03 | **7.9** | Git snapshot can exhaust processes and memory | `git.js:49-79` has no timeout or output cap. `getGitSnapshot()` spawns once per untracked file and `unpushedCommits()` twice per commit using unbounded `Promise.all` at `git.js:89-240`. |
| SEC-08 | **7.8** | Loopback API remains browser-attackable | Every GET bypasses Origin validation at `server.js:943-956`, exposing expensive snapshot/Git/SSE endpoints to cross-site requests. HTML responses at `server.js:967-1004` have no `frame-ancestors` or `X-Frame-Options`, allowing clickjacking. Any localhost origin and port is accepted for writes. |
| SEC-09 | **7.5** | JCEF bridge is injected into every navigated page | `jetbrains/src/main/kotlin/com/gorowynn/piwebui/PiWebuiToolWindowFactory.kt:48-114` installs the IDE bridge without checking scheme, host, port, current URL, or main-frame status. A navigated remote page can open project-file diffs and potentially receive file content after user interaction. |
| SEC-10 | **7.0** | Headless safeguard defaults fail-open | `extensions/pi_minimal_webui/policy-engine.js:340-344` sets `nonInteractive: "allow"`; `extensions/pi_minimal_webui/safeguard.ts:424-434` therefore permits ask-class calls when no UI exists. This is documented behavior but means JSON/print automation does not receive ordinary safeguards. |

## Medium findings

| ID | Rating | Finding | Required remediation |
| --- | ---: | --- | --- |
| DEP-01 | **6.8** | Vendored `markdown-it@14.1.0` is affected by CVE-2026-2327 / GHSA-38c4-r59v-3vqw. `public/md.js:74-79` enables the vulnerable `linkify` path. | Upgrade to at least 14.1.1, preferably 14.2.0. The separate smartquotes advisory is not reachable while `typographer:false`. |
| SEC-11 | **6.5** | z.ai API keys and OpenCode authentication cookies are persisted in plaintext localStorage at `public/app.js:1663-1683` and `2028-2046`. | Prefer server-side environment/auth storage. Otherwise keep secrets in memory or session storage and provide an explicit clear action. |
| REL-04 | **6.0** | Caller-controlled `/api/rpc` IDs overwrite existing `rpcPending` entries at `server.js:808-824`, potentially cross-wiring responses and hanging callers. | Reject duplicate pending IDs or always mint IDs server-side. |
| REL-05 | **5.8** | Workspace version checks are not atomic. `workspace-file.js:33-64` reads and hashes, then writes separately. | Use exclusive creation for new files and an atomic compare/write strategy for existing files; revalidate canonical targets immediately before replacement. |
| SEC-12 | **5.6** | Sandboxed HTML previews still permit network requests at `public/tool-presentation.js:357-394`. | Add an iframe CSP such as `default-src 'none'; style-src 'unsafe-inline'` to block remote images, CSS, and loopback requests. |
| SEC-13 | **5.5** | User/workspace policy regexes are compiled but not complexity-checked at `extensions/pi_minimal_webui/policy-engine.js:67-73`. | Bound pattern and selector lengths; disallow repository regex rules or accept only a constrained anchored syntax. |
| TEST-01 | **6.3** | Test orchestration is stale: `rpc-sse.test.js` expects removed `snap-state` IDs and its SSE heartbeat prevents timeout. `package.json` has no test script or Node engine declaration, and the repository has no CI configuration. | Make the integration test self-contained, use a wall-clock timeout, update its snapshot assertion, add a canonical test command, and run it on supported Windows/Linux and Node versions. |

## Runtime robustness findings

### High runtime findings

| ID | Rating | Finding | Evidence and required remediation |
| --- | ---: | --- | --- |
| REL-06 | **8.8** | An ordinary API failure can terminate the server | Permission grant mutation routes call `sendToPi()` outside route-level error handling at `server.js:1136-1172`. A fault probe with pi unavailable exited Node with `Error: pi not running`. Wrap every route in the common error boundary and convert child-unavailable failures to a bounded 503 response. |
| REL-07 | **8.6** | `agent_start` immediately falls through to `agent_end` | `public/app.js:3618-3989` has no `break` after `case "agent_start"`. Every start clears streaming state, corrupting stop controls, status, polling cadence, and steer/follow-up routing. Add the missing non-fallthrough boundary and a switch-event regression test. |
| REL-08 | **8.4** | Safeguard status events throw on assignment to a constant | `lastSafeguardCtx` is declared `const` at `public/app.js:56` and reassigned in the safeguard event branch. Provenance and active-mode updates fail at runtime. Make the state mutable or mutate one stable object, then exercise the event in a browser-free test. |
| REL-09 | **8.3** | SSE backpressure drops the unflushed queue tail | `server.js:239-265` replaces `_piQ` before flushing it. If `res.write()` saturates again, the remaining old entries are lost; a direct probe wrote the first item and dropped the next two. Preserve the unprocessed tail, bound the queue by bytes, and force a reconnect/snapshot if the bound is exceeded. |
| REL-10 | **8.1** | Resolved approvals remain pending forever | `broker.js:19-106` retains resolved records, and `snapshot()` returns them without filtering. Reload can resurrect a completed approval; memory and stale provenance grow for the process lifetime. Agent-side dialog timeouts are not reflected into broker state, and tool/provenance context is retained after registration so it can attach to an unrelated dialog. Remove records after resolution or keep only bounded tombstones, consume context at registration, expire timed-out/disconnected requests, and snapshot pending records only. |
| REL-11 | **8.0** | Live replay storage is unbounded and quadratic | `livebuf.js:35-80` stores every cumulative tool update. Two hundred growing updates serialized to about 19.2 MiB in a fault probe. Coalesce updates by tool-call/content identity and enforce event and byte ceilings. |
| SEC-15 | **8.0** | Policy parse and persistence failures weaken protection silently | `safeguard.ts:131-180` turns malformed configuration into an empty layer and performs direct writes without durable error reporting. An allow-always action can proceed even if persistence fails. Retain the last known-good layer, fail closed for malformed workspace policy, write atomically, and surface save failures before executing the approved call. |
| REL-12 | **7.8** | Prompt, ask, and approval submission are acknowledged too early | `public/app.js:83-137`, `230-242`, and `5200-5233` clear UI state after transport submission rather than authoritative RPC/SSE acceptance. The approval watchdog marks the request settled before `approval_resolved`; a lost acknowledgment can leave pi blocked while the browser believes it succeeded. Correlate submissions to responses, preserve drafts until accepted, and keep retry UI until terminal acknowledgment. |
| REL-13 | **7.7** | Snapshot recovery can finalize live work or repaint stale state | `public/app.js:4144-4318` swallows snapshot errors, has no generation guard, treats unknown streaming state as idle, ignores emitted sequence gaps, and only heals compaction state toward true instead of clearing it when authoritative `isCompacting` is false. Retry visibly, apply only the newest generation, finalize only when state is explicitly idle, force a fresh snapshot on a sequence gap, and make every authoritative state field bidirectional. |
| REL-14 | **7.5** | Generic confirm answers use the wrong RPC shape | The browser sends `value: { confirmed: true }`, while pi RPC expects top-level `confirmed: true`; selecting Yes therefore resolves false. Encode each Extension-UI response according to the upstream RPC schema and add contract fixtures for confirm/select/input/editor. |
| SEC-16 | **7.4** | Approval audit retains raw edited file contents | The server audit ring stores the complete response value, including editable-diff `oldFull`/`newFull` payloads. This retains source and secrets and can consume large memory. Store only redacted metadata, hashes, byte counts, and the decision enum. |
| SEC-17 | **7.6** | IDE diff handling can fail open or overwrite a newer file | Malformed bridge JSON becomes an empty `DiffPayload`; an edited-write conflict only warns and still allows approval; and `DiffReviewFile.decide()` uses a non-atomic volatile check. Reject malformed payloads, block stale-file approval until the proposal is rebased or explicitly re-read, and use compare-and-set for first-response-wins. |

### Medium runtime findings

| ID | Rating | Finding | Evidence and required remediation |
| --- | ---: | --- | --- |
| REL-15 | **6.9** | HTTP and Git decoding corrupt split UTF-8 | `server.js:917-937` and Git output handling concatenate Buffer chunks directly into strings. A split four-byte character became replacement characters in a fault probe. Use `StringDecoder` or collect bounded Buffers and decode once. |
| REL-16 | **6.7** | Replayed approval dialogs lose protocol fidelity | Broker snapshots omit timeout, placeholder, and editor prefill, while the browser reopens every record as a select modal, including confirm/input/editor requests. Persist the request kind and bounded presentation fields and synchronize timeout cancellation, or cancel non-select dialogs on disconnect instead of reconstructing the wrong UI. |
| REL-17 | **6.6** | Process readiness, workspace switching, and shutdown are optimistic | Child stdin has no error listener; restart begins on `exit` before stdio `close`; workspace switching commits `PI_CWD` before confirming the old child died, creating split-brain file/Git and agent roots after a failed kill; `/api/health` reports success during child outage/backoff; and no server signal handler tree-kills descendants. Add stream error handlers, generation-tag events, commit workspace state only after termination succeeds, restart after close, report child readiness only after a successful RPC, and clean up on process signals. |
| REL-18 | **6.5** | Git mutations are not transactional against concurrent changes | Snapshot validation and mutation are separated, `commitChanges()` leaves everything staged if commit fails, reset/discard do not carry an expected HEAD/status token, and push can wait indefinitely on networking or an interactive credential helper. Revalidate immediately before mutation, use literal pathspecs, serialize mutations, restore or clearly report partial staging, add timeouts, and set `GIT_TERMINAL_PROMPT=0`. |
| REL-19 | **6.3** | Isolated prompt execution has fragile cleanup and Windows quoting | `isolated-prompt.js` builds a Windows shell command by joining unquoted arguments, ignores failed RPC responses until the 120-second timeout, lacks stdin error handling and concurrency limits, leaves stderr unbounded, never refreshes copied credentials/models, and on POSIX kills only the immediate pi PID. Spawn with an executable plus argument array, fail immediately on negative RPC responses, cap output/concurrency, refresh credentials safely, and tree-kill on every terminal path. |
| REL-20 | **6.1** | Browser initialization can abort on unavailable storage | Top-level `localStorage` reads in `public/app.js` are unguarded. Embedded/private contexts can throw before the app installs recovery handlers. Wrap storage behind one null-safe helper and fall back to in-memory defaults. |
| REL-21 | **5.9** | Network and scan helpers lack resource bounds | Provider proxy response bodies are uncapped, Git subprocess output and duration are unbounded, and workspace discovery reads an entire newest session file to obtain its header. Apply byte/time/concurrency limits and use bounded head reads. |
| REL-22 | **5.8** | `--stop` can kill an unrelated process | `bin.js:112-149` kills whichever PID owns the configured port without verifying pi-webui identity. Require a server-owned PID/token file or an authenticated shutdown endpoint. |
| REL-23 | **5.7** | Todo discipline can silently disable after a pi restart | The browser restores and displays todos from localStorage, while the extension resets its canonical in-process list on session restart/reload. The UI can show unfinished work although the discipline gate sees no list. Rehydrate the extension from one acknowledged source or clear the browser mirror when the extension resets. |
| REL-24 | **5.6** | JetBrains bridge request plumbing is not reentrant and leaks handlers | A single global `window.__piDiffResolve` cannot safely represent overlapping requests, and the JS query/load handler has a documented disposal leak. Give each request a unique ID and resolver, reject duplicates/stale replies, and dispose handlers with the tool window/browser lifecycle. |
| TEST-02 | **6.5** | Passing checks do not exercise runtime protocol invariants | The suite missed switch fallthrough, constant reassignment, undefined process-kill symbols, SSE queue loss, split UTF-8, broker resurrection, and response-shape drift. Add focused fault tests for these cases plus packed-install and Windows/Linux lifecycle CI. |

## Validation evidence

- **55/55** reviewed JavaScript files passed `node --check`.
- **27/27** non-integration Node test files passed. `rpc-sse.test.js` was
  excluded because it requires a live server; its stale snapshot ID and
  heartbeat-reset timeout can make it hang.
- `npm pack --dry-run`: **9/9 root runtime dependencies missing**.
- Pure engine checks reproduced every policy, path, Windows, read-only,
  scalar-rule-shadowing, and persisted-yolo failure listed above.
- Fault probes reproduced the server crash on unavailable pi, SSE queue-tail
  loss, split-UTF-8 corruption, broker resurrection, and approximately 19.2 MiB
  from only 200 cumulative live-buffer updates.
- Git pathspec expansion was reproduced in a temporary repository.
- OSV returned two advisories for markdown-it 14.1.0; one is reachable under
  the current configuration. Highlight.js 11.11.1 had no OSV matches.
- A full pi-lens scan reported 31 blockers and 188 warnings. Several are
  environment or audit heuristics; the dynamic-regex and process/shell findings
  support the issues above.
- TypeScript checking is incomplete because the repository does not locally
  provide the pi peer dependency and its declarations.
- JetBrains Gradle tests were not run because `GOTCHAS.md` #17 documents that
  Gradle crashes or silently no-ops in this harness.

## Controls verified as strong

- The server binds to `127.0.0.1`.
- Server-side `safePath()` canonicalizes existing targets and nearest existing
  parents with `realpathSync`; this control is not yet shared by the safeguard
  policy engine.
- Workspace switching requires a discovered realpath match.
- Request bodies have declared-length and streamed-byte caps.
- RPC pending requests have timeouts and are rejected promptly on child exit.
- Crash restart uses bounded exponential backoff.
- JSONL framing is strict, bounded, uses `StringDecoder`, and is factored into a
  tested module.
- Snapshot/live replay and compaction-aware history are sound architectural
  recovery directions despite the state-management defects above.
- Markdown disables raw HTML and unsafe links; reviewed direct HTML sinks escape
  their dynamic values.
- HTML preview uses an empty iframe sandbox.
- Git normally uses argument arrays and `git.exe` on Windows and validates
  displayed file paths against a snapshot.
- Policy/parser pure modules have substantial unit coverage.
- The approval broker implements first-response-wins and stale-ID handling, and
  workspace writes use revision checks.

## Remediation order

1. Fix SEC-01, SEC-02, SEC-03, SEC-04, SEC-06, SEC-07, SEC-14, and SEC-15
   before relying on safeguard in any mode.
2. Fix REL-01 before publishing another npm package; validate a packed install
   in CI rather than only testing the repository checkout.
3. Repair the immediate runtime regressions: REL-06 through REL-09 and REL-14.
4. Make Git paths literal, serialize/revalidate mutations, and bound Git
   concurrency, duration, and output.
5. Repair broker lifecycle, acknowledgment semantics, snapshot generations,
   live-event coalescing, and sequence-gap recovery.
6. Repair process-tree termination and readiness on Windows and POSIX, then add
   failure-path lifecycle tests.
7. Add per-launch API authentication, reject cross-site fetches, deny framing,
   and restrict the JCEF bridge to the exact configured loopback origin.
8. Make workspace/policy writes atomic, retain last-known-good policy, and bound
   provider/session scanning.
9. Upgrade markdown-it, stop persisting browser credentials, redact audit data,
   and add the canonical cross-platform test command.
