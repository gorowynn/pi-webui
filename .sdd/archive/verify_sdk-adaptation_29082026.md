# Verification: Complete the SDK adaptation

**Date:** 2026-08-29
**Outcome:** PASS WITH ACCEPTED ENVIRONMENT LIMITATIONS — automated release gate
passed; manual browser and JetBrains checks are environment-blocked and accepted
as release deferrals.

## Automated evidence

| Requirements | Evidence | Result |
| --- | --- | --- |
| FR-1–FR-6, FR-9, FR-12, FR-19–FR-24, FR-38 | `node test/pi-sdk-runtime.test.js`, `node test/sdk-command-contract.test.js`, `node test/sdk-events.test.js`, `node test/runtime-resilience.test.js` | PASS |
| FR-7–FR-11, FR-13–FR-18 | SDK command/event contracts plus `PORT=4317 node test/rpc-sse.test.js` | PASS (2/2 smoke checks) |
| FR-25–FR-30 | `node test/permissions-api.test.js`, `node test/permission-ux.test.js`, `node test/trust-boundary.test.js`, `node test/safeguard-contract.test.js` | PASS |
| FR-31–FR-34 | `node test/isolated-prompt.test.js`, `node test/secondary-runs.test.js`, `node test/advisor-contract.test.js`, `node test/browser-tools.test.js`; provider-backed HTTP fixtures skip unless explicitly enabled | PASS |
| FR-35–FR-37 | `node test/sdk-docs-contract.test.js`, `node test/package.test.js`, `node test/shell-contract.test.js`, `npm pack --dry-run` | PASS |
| FR-39 | `npm test` | PASS — 65 test files, 65 passed, 0 failed |
| FR-35, FR-36, FR-40 startup/shutdown subset | Packed artifact install, SDK-ready `/api/health`, `/api/snapshot`, and SIGTERM shutdown smoke | PASS |
| FR-1, FR-19, FR-21 | `git diff --check` plus primary-source scan for old executable/forwarding paths | PASS |

The packed-artifact smoke used `npm install --offline` from the generated tarball
and confirmed the published `server.js`, `pi-sdk-runtime.js`, bundled bridge,
and public assets start without a repository-relative dependency.

## Environment-blocked evidence

- `browser_open http://127.0.0.1:4317` could not run: no Chromium or Edge
  browser binary is installed. Desktop/narrow visual checks, browser prompt
  streaming, reconnect UI, and console/focus/overflow inspection remain pending.
- `cd jetbrains && ./gradlew test` could not run: `JAVA_HOME` is unset and no
  `java` executable is available. JetBrains host/no-switch verification remains
  pending.
- An actual provider prompt was not sent to the existing user session during
  release verification to avoid mutating the live conversation or incurring an
  unintended provider request. The SDK-shaped prompt path is covered by the
  adapter and isolated-runtime tests.

## Release disposition

C1–C8 are complete. The unavailable browser, Java, and provider-backed manual
checks are accepted environment limitations for this release decision and remain
recorded for a later verification pass. The SDD artifact set is now archived.
