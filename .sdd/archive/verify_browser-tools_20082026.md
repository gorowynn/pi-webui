# Verification: Browser tools

## Outcome

**PASS** — the approved browser-tools plan/spec is implemented and the managed
browser now uses an actual 1920×1080 content viewport by default. Explicitly
attached browsers retain their existing viewport.

## Requirement evidence

| Requirement | Evidence |
|---|---|
| FR-1 | Source-contract test registers exactly `browser_open`, `browser_snapshot`, `browser_screenshot`, and `browser_console`; mutation/evaluation tools are absent. |
| FR-2 | `BrowserManager` owns one lazy session and serial queue; live facade smoke reused the session across open/snapshot/screenshot. |
| FR-3 | Runtime tests verify isolated managed launch, loopback debugging, random port, visible-by-default/headless opt-in, and 1920×1080 launch size. |
| FR-4 | Runtime lifecycle tests verify temporary profiles, no `--no-sandbox`, idempotent managed cleanup, and untouched attached processes. |
| FR-5 | Runtime tests verify loopback-only explicit CDP attachment and no managed fallback for invalid attachment configuration. |
| FR-6 | `test/browser-cdp.test.js`: 17 passing transport/discovery/correlation/framing assertions. |
| FR-7 | CDP abort/timeout tests pass; the facade routes calls through the manager's FIFO queue. |
| FR-8 | Cleanup tests pass; the live facade smoke invoked `session_shutdown` cleanup. |
| FR-9–FR-10 | Host-policy tests pass for HTTP(S), loopback defaults, exact allowlisted hosts, credentials, unsafe schemes, and disallowed hosts. |
| FR-11 | Policy tests verify browser-open ordinary ask and read-only snapshot behavior through the existing safeguard engine. |
| FR-12 | Source-contract test verifies untrusted-page guidance and absence of arbitrary evaluation. |
| FR-13–FR-14 | Live facade smoke opened the local app and returned final URL/title/viewport; navigation and failure paths are covered by browser-tool tests. |
| FR-15–FR-19 | Snapshot tests pass schema, bounds, password redaction, safe links, visible controls, generation, and stale-ref behavior. |
| FR-20–FR-22 | Screenshot tests pass JPEG quality fallback, 300 KiB cap, metadata, image capability fallback, and no progress image; live capture was 1920×1080 and 52,529 bytes. |
| FR-23–FR-24 | Console tests pass bounded warning/error normalization and valid empty results; live clean-page console was empty. |
| FR-25–FR-26 | CDP/browser tests pass stable protocol, target, abort, timeout, malformed-frame, and output-limit handling. |
| FR-27–FR-28 | Existing RPC/tool-result contract is preserved; package and full-suite tests pass with no browser automation dependency or HTTP route. |

## Validation commands

- `node test/browser-cdp.test.js` — 17 passed
- `node test/browser-tools.test.js` — 33 passed
- `node test/policy-engine.test.js` — 56 assertions passed
- Full `test/*.test.js` suite — 46 files, 0 failures
- Primary LSP diagnostics — clean for changed JavaScript/TypeScript files
- Live Edge facade smoke — open, snapshot, screenshot, console, and shutdown passed

## Plan success criteria

All plan success criteria are met: four bounded tools are registered, managed
sessions are isolated and local-only, results are structured for text and image
models, failure paths are fail-closed, cleanup is session-scoped, and normal
unit tests remain browser-binary-free.
