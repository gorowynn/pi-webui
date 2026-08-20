# Plan — a11y-contrast (U2 / A4) — 07082026

## Problem Statement

The webui has grown (workspace rail, tool cards, diff editor, sd d rail, stats
strips) with no explicit accessibility contract. Concretely known gaps:

- **Paperlike theme contrast is unmeasured.** Text tokens render at 10–13px in
  several places (status strips, cache/cost lines, tool metadata, gutter,
  stepper); WCAG AA requires ≥4.5:1 for that size, and nothing computes or
  enforces it. Dark theme is likely fine; paperlike is the suspect.
- **Tool disclosures are non-native.** Transcript tool cards and stats
  `<summary>`/click-divs are not native buttons — no keyboard activation
  guarantee, no accessible name, no focus style.
- **Splitters are pointer-only.** The workspace sidebar / rail drag handles have
  no focus, no keyboard operation, no WAI-ARIA separator metadata.
- **Regions are unlabelled.** Composer, conversation, session navigation, tools
  rail, and diff tabs have no landmark labels.
- **Turns are not semantic.** Conversation turns are div soup, not
  articles/feed entries.
- **Progress is noisy or silent.** Streaming tokens are announced piecemeal
  (or not at all); there is no coarse `role="status"` progress and no busy
  state during history replacement/prepend.
- **Sticky chrome can swallow focus.** Focus outlines can land under sticky
  headers (composer, toolbar); hover-only actions (tool buttons, diff
  controls) are invisible on keyboard focus and touch.

## Business Goals

1. Keyboard, screen-reader, touch, and contrast behavior has an **explicit
   tested contract** (roadmap U2 outcome) — not a pile of ad-hoc fixes.
2. Paperlike theme reaches WCAG AA (≥4.5:1) for all 10–13px text uses, with a
   zero-dependency regression test so later theme edits can't silently break it.
3. All interactive affordances are reachable and operable by keyboard and
   announced by screen readers: disclosures, splitters, hover-only actions.
4. Coarse progress is announced once per turn, not per token; history
   replacement/prepend sets a busy state.
5. No visual regression to the shipped layout in either theme; zero-build
   invariant preserved.

## Constraints

- **Zero-build / minimal-dep** (hard): no bundler, no runtime `npm install`.
  The contrast test must be plain `node:assert` + a tiny hand-rolled CSS
  token scanner (no CSS parser dependency).
- **No DOM test harness**: DOM/a11y behavior is verified by reasoning + the
  user's browser checks; only pure logic (contrast math, token scanning,
  keyboard-mapping helpers if any) is unit-testable. Browser spot-checks go
  into the verify log like the U5 slice.
- **Both themes must stay correct**: dark (default) and paperlike
  (`[data-theme]`); zoom 100/125/150% re-checked.
- **Load-bearing invariants to not break**: single `esc()` (GOTCHAS #12);
  `md()`/load order (GOTCHAS #11); RPC smuggle channels; `#wsbar` workspace
  switching (GOTCHAS #9); JetBrains wire contract (GOTCHAS #17); the diff
  slice's `textarea:not(.sx-ta)` exclusion idiom; SDD rail/stepper behavior.
- **24×24px targets or WCAG 2.5.8 spacing exception** (8px gap rule) — not a
  blanket size bump; keep the UI dense where the exception applies.
- No change to RPC wire keys, JSONL framing, or server routes unless the
  slice proves a need.

## Success Criteria

- `test/contrast.test.js` (or equivalent) green: every paperlike 10–13px
  foreground/background pair in an explicit table computes ≥4.5:1 (WCAG
  relative-luminance math, zero-dep). Any token edits required to pass are
  made and visually re-checked in both themes.
- Every tool disclosure (transcript cards, stats, permission tool lists,
  diff tabs where non-button) is a native `<button>` with visible
  `:focus-visible` styling; no pointer-only click handlers remain on
  transcript/rail interactive elements.
- Both splitters (workspace rail + any other drag handle) are
  `role="separator"`, `tabindex="0"`, arrow-key operable, `aria-valuenow`
  updated live, and still work by pointer.
- Composer, conversation, session navigation, and tools rail carry
  accessible names (landmark/aria-label); turns render as
  `<article>`s (with h-scoped heading or aria-label) inside a labelled feed.
- A coarse `role="status"` (or `aria-live="polite"` region) announces
  turn start/end and error/complete once — not per token; a busy state is
  set during history replacement/prepend (`aria-busy`).
- Focus visibility: `:focus-visible` outlines render on top of sticky chrome
  (no clipping); every hover-only action also appears on `:focus-visible` /
  `:focus-within` and on touch (`@media (hover: none)`).
- All interactive controls ≥24×24px or satisfy the 8px spacing exception;
  the check list is written into the verify log with per-control evidence.
- Full suite green (16 existing + new contrast tests), `node --check`
  clean, `git diff --check` clean, browser spot-check log updated, roadmap
  U2 status flipped to delivered, set archived.

## Out of Scope

- Full WCAG audit of everything (audit-the-contract, fix-the-listed-items).
- Refactoring the diff editor geometry or the composer behavior (U3/A2).
- JetBrains plugin a11y (separate project).
- Server-side changes unless a route proves a11y-relevant.
