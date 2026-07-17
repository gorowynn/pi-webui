# Latest Code Review

## Scope

Reviewed the server bridge, browser UI, extensions, packaging, tests, and diagnostics. No files were changed as part of the review. The reviewed worktree had pre-existing changes in `app.js`, `style.css`, and `CHANGELOG.md`.

## P0 — Fix before publishing

| Rating | Finding | Location | Recommended fix |
|---:|---|---|---|
| 10/10 | **The published npm package is non-functional.** `package.json.files` omits `app.js`, `style.css`, and `vendor/`. `npm pack --dry-run` confirmed all runtime assets are absent. | `package.json` | Add the missing assets/directories to `files`; enforce this with a package-content check in CI. |
| 10/10 | **Safeguard shell-deny bypass.** Allow patterns are evaluated before deny patterns, so `echo ok; rm -rf /` matches the `^echo` allow rule. | `extensions/pi_minimal_webui/safeguard.ts:163-173,279-282` | Evaluate matching deny rules first and reject shell operators in allow-listed command patterns. |

## P1 — Security and reliability

| Rating | Finding | Location | Recommended fix |
|---:|---|---|---|
| 9/10 | **“Allow always” grants substring matches.** Saving `npm test` also permits `npm test && curl … \| sh`. | `extensions/pi_minimal_webui/safeguard.ts:272,355` | Persist approvals as exact, escaped/anchored rules. |
| 8/10 | **An unauthenticated GET can block or exhaust the server.** The `session` query parameter is an arbitrary path and is synchronously read; `/dev/zero` hangs on POSIX. | `server.js:326-330,762-772` | Accept session IDs only, constrain them to the session directory, and cap input bytes. |
| 7/10 | **Single and chain subagent output is unbounded.** Only parallel summaries receive the 50 KB cap; chain output is inserted into later prompts. | `extensions/pi_minimal_webui/subagent.ts:611-616,657,764` | Cap all final outputs and limit chain length. |
| 6/10 | **Manual writes are non-atomic.** An I/O failure can truncate a user file. | `server.js:663-665` | Write and fsync a temp file in the same directory, then rename it atomically. |
| 6/10 | **SSE events can be dropped and queues can grow indefinitely.** A second backpressure pause loses the remaining queue tail. | `server.js:108-120` | Preserve unflushed events and impose a queue byte/event cap. |

## P2 — Quality, UX, and maintainability

| Rating | Finding | Location | Recommended fix |
|---:|---|---|---|
| 6/10 | **Failed sends create phantom user messages.** The composer clears and renders before verifying the HTTP response. | `app.js:3203-3229` | Validate `response.ok`; restore or mark failed drafts. |
| 6/10 | **Async modal rendering can strand permission prompts.** Usage/diff rendering shares one modal card; stale async work may replace Allow/Deny controls. | `app.js:1405-1413,2177-2230` | Use a modal generation token and discard stale renders. |
| 5/10 | **Todo discipline disappears after reload/resume.** Extension state is reset despite persisted browser/tool-result state. | `todo.ts:205-206`; `discipline.ts:71` | Rehydrate active todos on `session_start`. |
| 5/10 | **Subagent JSONL decoding can corrupt split UTF-8.** | `subagent.ts:414-418` | Use `StringDecoder`, as `server.js` already does. |
| 5/10 | **CSRF policy trusts any localhost origin.** | `server.js:547-560` | Require the exact configured origin; use a per-process capability token for stronger protection. |
| 5/10 | **Core behavior has no automated coverage or CI.** Only the usage-provider classifier is tested; there is no `npm test` script. | `test/usage-provider.test.js`, `package.json` | Add a test script and CI for syntax, type, server/security, and package-content checks. |
| 4/10 | **The z.ai API key persists in `localStorage`.** | `app.js:1141,1420` | Default to in-memory/session storage; make persistence explicit opt-in. |
| 4/10 | **Accessibility gaps.** The hidden settings drawer remains focusable and lacks dialog focus/Escape behavior; palette items are non-semantic clickable divs. | `index.html:25-82`, `app.js:3104-3112` | Use `inert`, focus management, Escape handling, and semantic buttons/listbox roles. |
| 3/10 | **Slash palette selection can throw after filtering.** | `app.js:3364-3412` | Reset or clamp `palSel` whenever filtered items change. |
| 3/10 | **The npm artifact lacks a root README, LICENSE, and published docs.** | repository root, `package.json` | Add a concise root README and MIT LICENSE; ship or link user documentation. |

## Tooling results

- `node test/usage-provider.test.js` passed.
- `node --check` passed for JavaScript files.
- LSP reports extension TypeScript diagnostics: unused `@ts-expect-error` directives, implicit `any`s, and unavailable peer-package types. Add a reproducible typecheck configuration and CI gate.

## Recommended roadmap

1. **Release hotfix:** ship the missing runtime assets, add `npm test`, and validate `npm pack --dry-run` contents in CI.
2. **Harden the safeguard:** deny-first policy evaluation, exact saved approvals, and shell separator/pipe/redirection regression tests.
3. **Stabilize bridge I/O:** bounded session reads, atomic writes, bounded SSE queues, and UTF-8-safe subagent parsing.
4. **Improve UI resilience:** modal ownership token, failed-send recovery, and keyboard-accessible drawer/palette behavior.
5. **Further development:** add session search/export and a read-only multi-client mode after the release and security baseline is complete.

## Existing strengths

The zero-runtime-dependency design, loopback binding, body caps, centralized escaping, and UTF-8-safe server JSONL handling are solid foundations.
