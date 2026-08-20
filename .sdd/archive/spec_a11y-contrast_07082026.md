# Spec — a11y-contrast (U2 / A4) — 07082026

## User Stories

- As a keyboard-only user, I can open/close every tool disclosure, every
  collapsible, every modal button, and every rail with Tab + Enter/Space, and
  I can resize the tools rail with the arrow keys, because nothing in the UI
  is pointer-only.
- As a low-vision user on the paperlike theme, metadata text (status strips,
  cost/cache lines, timestamps, gutter) is legible (≥4.5:1 at its 10–13px
  sizes), and the same holds for the dark theme.
- As a screen-reader user, I hear the conversation as labelled turns in a
  feed/log, I hear coarse progress once per turn (not per token), I know when
  the transcript is being replaced (busy), and every icon control has an
  accessible name.
- As a touch user, every tap target is at least 24×24px or has 8px clearance,
  and actions that only appear on hover also appear on tap.
- As a mouse user on either theme, I see a visible focus ring when keyboard-
  navigating, never clipped by sticky chrome.

## Functional Requirements

### Contrast (FR-1 … FR-3)

- **FR-1 — zero-dep contrast test.** `test/contrast.test.js` implements WCAG
  2.x relative luminance + contrast ratio from scratch (hex → linearized
  sRGB → luminance → ratio), parses the pair table, resolves `var(--x)`
  token references against the two theme blocks (`:root` dark + `[data-theme="paperlike"]`)
  via a small hand-rolled scanner (hex only; no CSS parser dependency), and
  asserts every pair ≥ its threshold. Pair table lives in the test (single
  source of truth for which token/background/size combinations are in use).
- **FR-2 — paperlike AA.** Every pair in the table used at ≤13px computes
  ≥4.5:1 on paperlike. Baseline audit: `--muted #8a7f70` (measured ~3.0–3.35
  on canvas/surface/raised), `--secondary #7a6b8a` (~4.2 on canvas),
  `--success #4d7c0f` (~4.4 on canvas), `--warning #a16207` (~4.38 on canvas)
  — darken tokens as needed so all three backgrounds pass; `--ink`,
  `--cyan`, `--accent`, `--danger` are expected to already pass (the test
  proves it). The pair table covers at minimum: `muted` × {canvas, surface,
  surface-raised}, `secondary` × {canvas, surface}, `success`/`warning` ×
  {canvas, surface-raised}, `ink` × {canvas, surface, surface-raised,
  bubble-user}, `cyan` × {canvas}, `accent` × {surface, surface-raised},
  each at the smallest px size the CSS uses it at (≥10px).
- **FR-3 — dark theme AA.** The same pair table passes ≥4.5:1 on the dark
  palette (`:root` tokens). Expected no token change; the test is the proof.
  A token change is permitted only if FR-3 still holds and both themes'
  visual identity is preserved (user re-check).

### Native controls (FR-4 … FR-5)

- **FR-4 — disclosures are native.** Every collapsible/disclosure in the
  transcript and tool output — tool cards (`<summary>` at app.js:428),
  `um-raw` blocks, `cmd` blocks, the `.tool-more` "more" trigger, diff
  `.sx-tab`s, analysis bars (`.an-bar`/`.an-item` if interactive) — is either
  a native `<summary>` or a native `<button>` with correct `aria-expanded`
  and a visible `:focus-visible` style. No div/span click-only disclosures
  remain. (Native `<summary>` already has keyboard activation — where one
  exists it stays; the audit's job is finding the non-native ones, e.g.
  `.tool-more`.)
- **FR-5 — icon controls are native buttons.** `.modal-x`, `.ws-x`,
  `.ws-mini`, `.set-x`, `.sdd-close`, `.toast-x`, `.um-refresh` (and any
  similar icon trigger) are `<button type="button">` with an `aria-label`
  (or visible text) and a visible `:focus-visible` ring. Pointer-only
  activation removed.

### Splitters (FR-6)

- **FR-6 — tools-rail splitter is fully keyboard-operable.** The
  `#sddbar .rail-resize` handle: `tabindex="0"`, `role="separator"`,
  `aria-orientation="vertical"`, `aria-valuemin="0"`, `aria-valuemax="100"`,
  `aria-valuenow` (percent, updated live during both pointer and keyboard
  resize), ArrowLeft/ArrowRight ±5% (clamped), Home/End = min/max,
  Enter/Space not required (separator semantics: arrows only). Pointer
  drag behavior unchanged. The handle keeps focus after resize. Hit area
  ≥24px tall × ≥10px wide (or invisible extension) for touch (FR-11).
  The workspace rail (`#wsbar`) has no resize handle today — nothing to do
  there, noted as evidence.

### Regions & semantics (FR-7 … FR-8)

- **FR-7 — labelled regions.** The conversation (`#transcript`), composer
  (`#composer`/`#input`), session navigation (`#wsbar` list + session list),
  tools rail (`#sddbar`), palette, and modal each carry an accessible name
  (`aria-label`/`role="region"`/landmark where appropriate). Missing labels
  added; existing ones verified (index.html already has 16 aria-labels —
  audit, don't duplicate).
- **FR-8 — turns are semantic.** The conversation renders as a labelled
  `role="feed"` (or `role="log"` if the feed child-structure can't be kept
  stable during streaming — decide in implementation, record the reason),
  and each turn is an `<article>` with an accessible name (e.g.
  `aria-labelledby` pointing at the turn's `.role` label). Streaming DOM
  updates must not break the structure (articles are the stable unit;
  inner text streams inside them). Compaction markers keep their role
  (custom turn), also as articles.

### Progress & busy (FR-9)

- **FR-9 — coarse status, honest busy.** One `role="status"` element
  (visually hidden or quiet) is updated at turn boundaries only — start
  ("assistant working"), end ("response complete"), error/retry — never per
  streamed token. During history replacement/prepend (`applyMessages`,
  prepend paths) the transcript gets `aria-busy="true"` before the mutation
  and `false` after (batched, one toggle per operation, not per message).
  Existing per-turn spinner/toasts stay visual-only.

### Focus & interaction (FR-10 … FR-12)

- **FR-10 — focus visible and unclipped.** Every interactive element
  (buttons, summaries, tabs, splitter, palette items, modal opts, ws items)
  has a visible `:focus-visible` style in both themes (2px ring, ≥3:1 vs
  adjacent, not clipped). Scroll containers that scroll content under sticky
  chrome (`.statusbar`/composer area) get `scroll-padding-top` ≥ the sticky
  heights so programmatic focus/scrollIntoView never lands hidden.
- **FR-11 — touch targets.** Every pointer control is ≥24×24px **or** has
  ≥8px clearance from its nearest target (WCAG 2.5.8 spacing exception).
  `#sddbar .rail-resize`'s effective hit area is ≥24px (via padding/
  pseudo-element). Evidence per control goes into the verify log
  (control → px or spacing rationale). No blanket size bump; dense UI stays
  dense where the exception applies.
- **FR-12 — hover-only actions appear on focus and touch.** Every
  `:hover`-only rule (inventory: `.tool-more`, `.sx-ctx-btn`, `.sx-tab`,
  `.modal-x`, `.ws-x`, `.ws-mini`, `.set-x`, `.sdd-close`, `.an-bar`,
  `.an-item`, `.um-refresh`, `.toast-x`, `.qopt`, `.qlink`, `#palette .item`,
  `.composer .bar-ovf > summary`, `.statusbar .sb-sec > summary`,
  `#usagebar`, `#ws-open`, `.rail-resize`, `#settings .set-stop`, `.ws-x`)
  gains a `:focus-visible`/`:focus-within` twin with the same affordance,
  and `@media (hover: none)` surfaces the affordance persistently (or the
  control is already visible/obvious). Links and native buttons with browser
  defaults are fine as-is.

## Data Models

**Contrast pair** (test table entry):
`{ id, token, fg, bg, px, threshold }` — `token` is the var name (e.g.
`--muted`) or literal hex; `fg`/`bg` are var names resolved from the theme
block under test; `px` = smallest used size (informational + used to pick
threshold 4.5 vs 3.0); `threshold` = 4.5 (≤13px text) or 3.0 (UI component
graphics / large text — only where honestly applicable).

**Splitter state**: `{ railWidthPx, percent, min, max }` — persisted via
existing localStorage key if present (keep current persistence; only add
the keyboard/ARIA path).

## Edge Cases

- **Token darkening must not regress dark theme**: FR-3 is a hard gate —
  paperlike-only token changes live in the `[data-theme="paperlike"]` block
  (shared `:root` tokens only if the dark ratio still passes).
- **`--muted` is used on three backgrounds** (canvas, surface, raised) —
  the darkening target must satisfy the lightest background's ratio, not
  just canvas.
- **Feed vs streaming**: `role="feed"` requires article children and
  browsers may announce removals oddly; if the turn container is
  reparented/rebuilt per message, `role="log"` + articles is the fallback.
  Decide with the streaming renderer in view, record the choice.
- **aria-busy timing**: set/clear must bracket the synchronous DOM
  mutation, not the async fetch, or it announces nothing.
- **Splitter at min/max**: arrows clamp; `aria-valuenow` reflects the
  clamp; no focus loss on clamp.
- **`<summary>` inside `.tool` cards** already keyboard-operable — audit
  must not convert them into broken custom buttons; conversion only where
  non-native.
- **Hidden-until-hover controls on touch**: `@media (hover: none)` must not
  permanently expose noisy chrome (e.g. `#usagebar`) — expose the action
  affordance, not the whole panel.
- **Zoom 125/150%**: contrast math is zoom-independent, but the browser
  spot-check re-verifies focus rings + sticky offset at all three zooms.
- **JetBrains + RPC wire**: no server routes change in this slice; if a
  route must change, the wire smoke + JetBrains parity (GOTCHAS #17) apply.

## Out of Scope

Full WCAG audit; composer draft behavior (U3); JetBrains a11y; server
routes; diff editor geometry.
