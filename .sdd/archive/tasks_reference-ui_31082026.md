# Implementation Plan: Reference UI adaptation

## Task List

- [x] T1 — Expose header context and new-session action (FR-3, FR-8)
  - Add real, accessible header New control and connect it to the existing
    confirmation/reset/new-session behavior.
  - Add existing stats targets for tokens and cost so `applyStats` can surface
    the already-available values inline; leave overflow handling to the current
    statusbar logic.
  - Keep all existing IDs, commands, and safe rendering paths intact.
  - Tests: `node test/reference-ui.test.js` + `node --check public/app.js` — PASS.
  - Compliance: header New uses the existing confirmed `new_session` path;
    tokens/cost use existing guarded stats updates and statusbar overflow. ✓

- [x] T2 — Make the wide sidebar persistent and screenshot-like (FR-1, FR-2,
  FR-7)
  - Show workspace and session sections together only in wide mode while
    retaining one-section-at-a-time behavior for mid/narrow drawers.
  - Preserve active-row, filtering, empty/error, IDE/no-switch, archive/remove,
    focus, and Escape behavior.
  - Update the stale shell contract assertion that currently describes every
    viewport as one-section-at-a-time.
  - Tests: `node test/reference-ui.test.js` + `node test/shell-contract.test.js` — PASS.
  - Compliance: wide mode reveals both existing sections; base drawer selectors
    still hide the inactive section, with no navigation/API changes. ✓

- [x] T3 — Tune transcript and composer hierarchy (FR-4, FR-5, FR-6)
  - Use the existing CSS surfaces/tokens to make completed tool rows read as
    restrained success cards, keep running/error states distinct, and preserve
    expandable bounded output.
  - Make the composer/input visibly dominant within the existing 1200px reading
    cap, with direct Send/Stop/permission controls and secondary actions still
    in the overflow.
  - Do not add a file explorer, terminal split, new dependency, glow, or heavy
    accent stripe.
  - Tests: `node test/reference-ui.test.js`, `node test/transcript-layout.test.js`,
    and `node test/ui-density.test.js` — PASS.
  - Compliance: done tools now use a restrained success border; composer gains
    neutral elevation and larger input treatment while existing controls and
    density/expand behavior remain unchanged. ✓

- [x] T4 — Run responsive/accessibility and compatibility verification (FR-7,
  FR-8)
  - Check wide/mid/narrow source contracts, focus/ARIA attributes, no-switch
    behavior, and the existing API/event/permission surface.
  - Run `node --check public/app.js`, the focused source-contract test, and the
    full `npm test` suite.
  - Record any intentional test-contract updates and complete the verification
    artifact before archiving the SDD set.
  - Tests: focused contract, shell contract, syntax check, and `npm test` — PASS
    (66 test files / 66 suites; 65 pass + 1 initial stale assertion, then 66/66).
  - Compliance: responsive selectors, ARIA navigation, no-switch behavior, and
    existing API/event/permission surfaces remain intact; the a11y contract was
    intentionally updated for the newly visible header token/cost telemetry. ✓

## Dependencies

- T2 depends on T1 only for the shared shell review; T1 and T2 can otherwise be
  implemented in order without API changes.
- T3 depends on the final markup shape from T1/T2.
- T4 depends on T1–T3.

## TiCoder Test Suite

Keep the tests intentionally small: one source-contract file plus the existing
shell contract that must change for the wide-sidebar behavior. The new focused
assertions are expected to fail before implementation.

### T1 tests — FR-3, FR-8

Add `test/reference-ui.test.js` with only these assertions:

- `public/index.html` has an accessible `type="button"` `#header-new` and header
  `#sb-tok`/`#sb-cost` telemetry targets.
- `public/app.js` wires `#header-new` and `#new` to one new-session action that
  preserves confirmation, todo/git reset, and the `new_session` command.

### T2 tests — FR-1, FR-2, FR-7

Use `test/reference-ui.test.js` plus the existing shell contract:

- CSS shows both workspace/session sections in wide mode and keeps the
  one-section drawer rule for mid/narrow mode.
- Existing navigation IDs and ARIA labels remain present.
- Update the old shell-contract assertion to describe the new wide-only rule.

### T3 tests — FR-4, FR-5, FR-6

In `test/reference-ui.test.js`:

- Completed tools retain a success cue, while running/error states retain their
  accent/danger cues.
- The composer remains a bounded bordered surface with direct Send/Stop/mode
  controls and an overflow for secondary actions.

### T4 tests — FR-7, FR-8

Run only the focused contract, `test/shell-contract.test.js`, and
`node --check public/app.js` during the chunk loop. Run `npm test` once at the
end as the final regression check.

## Approval Gate

These tests express the approved specification and should currently fail only
for the new reference-adaptation assertions. The user approved this plan with
an explicit bare-minimum-test constraint.
