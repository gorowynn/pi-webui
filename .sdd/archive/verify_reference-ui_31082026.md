# Verification: Reference UI adaptation

## Outcome

PASS — the screenshot-guided shell adaptation is implemented on
`ui/reference-adaptation`, branched from `dev`.

## Requirement Evidence

| Requirement | Evidence | Result |
|---|---|---|
| FR-1 shell hierarchy | Existing rail/sidebar/transcript/composer shell; wide sidebar layout contract | PASS |
| FR-2 workspace/session navigation | Wide-only dual-section CSS; existing shell/sidebar contracts | PASS |
| FR-3 header context/actions | `#header-new`, `#sb-tok`, `#sb-cost`, shared existing new-session handler, overflow logic | PASS |
| FR-4 transcript hierarchy | Existing transcript contract plus restrained `.tool.done` success cue | PASS |
| FR-5 composer priority | Existing composer contract plus bounded surface shadow and 48px/14px input treatment | PASS |
| FR-6 visual adaptation | Existing tokens/themes retained; no new dependency, terminal split, or explorer | PASS |
| FR-7 responsive/accessibility | Existing shell/sidebar/a11y contracts; wide/mid/narrow selectors preserved | PASS |
| FR-8 compatibility/safety | `node --check public/app.js`; full deterministic suite | PASS |

## Checks

- `node --check public/app.js` — PASS
- `node test/reference-ui.test.js` — PASS
- `node test/shell-contract.test.js` — 31 passed
- `node test/transcript-layout.test.js` — 25 passed
- `node test/ui-density.test.js` — PASS
- `npm test` — 66/66 suites passed

## Notes

The existing a11y contract had an obsolete assertion that `sb-tok` and
`sb-cost` were retired. It was updated to require the new header telemetry,
which is intentional for FR-3. No API, SSE, permission, workspace validation,
or session semantics changed.
