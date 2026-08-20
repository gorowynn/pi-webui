# Tasks — a11y-contrast (U2 / A4) — 07082026

Dependencies: T1 → T2 → T3 → T4 → T5 (independent after T3's contract file
exists) → T6 → T7 → T8 → T9 → T10. T5–T9 depend only on the contract-test
file existing (born in T3).

---

## T1 — Contrast math + theme scanner (FR-1)

New `test/contrast.test.js` (zero-dep, `node:assert/strict`). Pure module
under test: `a11y-contrast.js` (new, dual-mode not required — Node-only,
required by the test; no browser use).

Functions:

- `hexToRgb("#rrggbb")` → `[r,g,b]` 0–255; rejects short/non-hex.
- `relativeLuminance(rgb)` → WCAG linearized-sRGB sum.
- `contrastRatio(a, b)` → `(L1+0.05)/(L2+0.05)`, L1 ≥ L2.
- `extractThemeTokens(css)` → `{ dark: {--x: hex}, paperlike: {--x: hex} }`
  by scanning the bare `:root { … }` block and the bare
  `[data-theme="paperlike"] { … }` block (no descendant selector; only
  `--x: #hex;` declarations; ignores everything else).
- `resolveToken(palette, nameOrHex)` → hex (var lookup or passthrough).

**Tests (TiCoder):**

- `contrastRatio("#000000","#ffffff") === 21`; `contrastRatio("#ffffff","#000000") === 21` (order-independent) — WCAG anchor.
- `contrastRatio("#767676","#ffffff")` ≈ 4.54 (documented WCAG example, ±0.05).
- `relativeLuminance([255,255,255])` ≈ 1.0; `[0,0,0]` ≈ 0.0; pure gray linearization spot-check `[128,128,128]` ≈ 0.2158.
- `hexToRgb` parses `#abc`? → **reject** (we only emit 6-digit; fail loudly instead of silently mis-parsing).
- `extractThemeTokens` on a fixture with: dark `:root` block, bare paperlike block, a `[data-theme="paperlike"] #transcript` rule (must NOT be captured), `--x: #rgb` short forms (ignored), comments — extracts exactly the two palettes.
- `extractThemeTokens(real public/style.css)` — smoke: palettes contain `--muted`, `--canvas`, `--secondary`, `--success`, `--warning`, `--accent`, `--ink`, `--cyan`, `--danger`, `--surface`, `--surface-raised`, `--bubble-user`, `--surface-inset` in BOTH themes.
- `resolveToken` returns the var's hex, and passes literal hex through.

Red-first: module absent → require throws (red); flip per function.

- [x] T1 — contrast math + scanner
  - Tests: `test/contrast.test.js` — PASS (all assertions, incl. real-file
    smoke: 13 tokens in both themes)
  - Compliance: FR-1 ✓ (WCAG math from scratch, hex-only scanner, media
    blocks + comments stripped, descendant selectors excluded, merged
    bare `:root` blocks). Fixture forced two real module fixes: media-
    nested `:root` must not masquerade as default (brace-matched strip),
    and the paperlike selector needs regex-escaping (bare `[data-theme…]`
    is a char class). Test-side fix: empty palette map is `{}`, not
    `undefined`. ✓

---

## T2 — Pair table + paperlike AA (FR-2, FR-3)

Contrast pair table lives at the top of `test/contrast.test.js`:
`{ id, token, fg, bg, px, threshold }`. Threshold 4.5 for all entries
(≤13px text — UI has no honestly-3.0 large-text uses at these tokens).

Minimum table (each row asserted on BOTH palettes):

| id | fg | bg | px (informational) | context |
|---|---|---|---|---|
| P1 | `--ink` | `--canvas` | 12 | body |
| P2 | `--ink` | `--surface` | 11 | statusbar/header |
| P3 | `--ink` | `--surface-raised` | 11 | tool cards |
| P4 | `--ink` | `--bubble-user` | 13 | user bubble |
| P5 | `--muted` | `--canvas` | 10 | timestamps |
| P6 | `--muted` | `--surface` | 10 | statusbar meta |
| P7 | `--muted` | `--surface-raised` | 10 | cost/cache strips |
| P8 | `--secondary` | `--canvas` | 11 | thinking label |
| P9 | `--secondary` | `--surface-inset` | 11 | thinking panel |
| P10 | `--success` | `--canvas` | 11 | success strips |
| P11 | `--success` | `--surface-raised` | 11 | git badges |
| P12 | `--warning` | `--canvas` | 11 | warnings |
| P13 | `--cyan` | `--canvas` | 13 | links |
| P14 | `--accent` | `--surface` | 13 | buttons |
| P15 | `--accent` | `--surface-raised` | 13 | active tabs/buttons |
| P16 | `--danger` | `--canvas` | 12 | errors |

P14/P15 must be usage-audited first (grep where `--accent` text sits on
surface/raised; if a pair is not actually used at ≤13px it is removed from
the table with a note — the table is evidence, not fiction).

**Known failing rows on paperlike (from the plan audit):** P5–P7 `--muted`
(measured 2.9–3.35), P8/P9 `--secondary` (3.7–4.2), P10–P12 `--success`/
`--warning` (~4.4), P14/P15 `--accent` (3.94–4.26).

Fix in `public/style.css` **paperlike block only**: darken `--muted`,
`--secondary`, `--success`, `--warning`, `--accent` until every row passes.
Hard rules: the darkest background each token sits on drives the target
(`--muted` must pass on `--surface-raised`, the lightest of its three);
shared `:root` tokens may change only if the dark rows still pass (FR-3 gate);
visual identity preserved (user re-check).

**Tests (TiCoder):** the table itself — every row ≥ 4.5 on paperlike AND on
dark. Test failure output names the failing row id, measured ratio, and
current hex (so the fix loop is data-driven). `node test/contrast.test.js`
green = slice's core claim proven.

- [x] T2 — pair table + paperlike AA
  - Tests: `test/contrast.test.js` — PASS (16-row table × both themes = 32
    rows; all ≥ 4.5)
  - Compliance: FR-2 ✓ — exactly the 10 predicted paperlike rows failed
    (P5–P9, P10–P12, P14–P15); fixed by darkening 5 tokens in the
    `[data-theme="paperlike"]` block only: --muted → #6a5f4e (P7 3.04→
    4.84), --secondary → #6c5c7f (P9 3.83→4.74), --accent → #92400e (P15
    3.89→5.49; white-on-accent 7.09), --success → #3f6212 (P11 3.87→5.48),
    --warning → #854d0e (P12 4.33→6.03). FR-3 ✓ — dark theme unchanged
    (worst row 4.64, all :root tokens untouched). P14/P15 usage-audited:
    accent-as-text at ≤13px on surface/raised is real (`.sx-tab.active`
    12px, mode buttons). Visual identity re-check pending (user). ✓

- [x] T3 — native disclosures + contract-test birth
  - Tests: `test/a11y-contract.test.js` — PASS (FR-4 asserts + helper
    units: hoverRules fixture, liveClasses sanity)
  - Compliance: FR-4 ✓ — tool-card head converted from `<div
    role="button" tabindex="0">` to `<button type="button" class="head"
    aria-expanded>` (keydown handler dropped — Enter/Space native;
    button resets added to `.tool .head`; `:focus-visible` ring already
    existed). It was the only `role="button"` in the app. Think block /
    um-raw / cmd / compact-mark already native `<details><summary>`;
    `.sx-tab` / `.an-bar` / `.an-item` already `<button>` (evidence).
    Contract helpers made chunk-proof: `liveClasses` splits template
    chunks on quotes (an-bar) and scans app.js + index.html (modal-x).
    `hoverRules` extracts :hover selectors incl. media-nested (T8
    feedstock). ✓

---

## T3 — Native disclosures (FR-4) + contract-test birth

New `test/a11y-contract.test.js` (zero-dep, scans SOURCE files — same
approach as `test/diff-contract.test.js`):

- `liveClasses(src)` — extract className literals from app.js markup strings.
- `interactiveClassIn(markup, cls)` — the class appears inside a `<button`
  or `<summary` opening tag in app.js (regex over the class string position).
- `hasAriaExpanded(markup, cls)` — the same tag's string contains
  `aria-expanded`.

Audit findings to encode as pass/fail:

- `.sx-tab` — already `document.createElement("button")` (evidence ✓).
- `.tool-more` — orphan CSS (no markup in app.js/index.html) → whitelist
  with a note; the contract test only checks classes present in app.js.
- `.an-bar` / `.an-item` (session-analysis bars) — check interactivity:
  if clickable, make native + aria-expanded; if static, whitelist as
  non-interactive (evidence in verify log).
- Tool cards `<summary>` (app.js:428), `um-raw`, `cmd` — already native
  `<summary>`; contract asserts them + `aria-expanded` is set when toggled
  (check current toggle code sets it; add if missing).
- Any div/span with a click handler that is a disclosure → convert.

**Tests (TiCoder):** for each disclosure class in the live list, assert
native-tag + aria-expanded; `liveClasses` unit checks; whitelist asserted
(documenting why each entry is exempt).

- [x] T4 — icon controls are native buttons
  - Tests: `test/a11y-contract.test.js` — PASS (ICON_BUTTONS loop: 7/7
    native, 7/7 not-in-div, 7/7 named)
  - Compliance: FR-5 ✓ — the audit flipped to EVIDENCE: modal-x, ws-x,
    set-x, sdd-close, um-refresh are already `<button type="button">`
    with aria-labels in index.html; toast-x is `createElement("button")`
    - aria-label in app.js. One gap fixed: `#ws-new` (ws-mini) had only
    `title` (weak accname) → added `aria-label="new session"`. Contract
    helpers gained the createElement+className path (synthetic window)
    and a markup-vs-window accessible-name test. ✓

---

## T4 — Icon controls are native buttons (FR-5)

Convert `.modal-x`, `.ws-x`, `.ws-mini`, `.set-x`, `.sdd-close`, `.toast-x`,
`.um-refresh` to `<button type="button" class="…" aria-label="…">` where
they are currently div/span with click handlers. Labels: close modal /
remove workspace / close settings / close sd d / dismiss toast / refresh.
Keep all existing CSS (button reset rules added if the class relies on
div-typography — check for `button { font: inherit }` presence).

**Tests (TiCoder):** contract additions — each icon class appears inside a
`<button` string AND the same string contains an `aria-label`. Plus a
general assertion: no `class="…modal-x…"` inside a `<div`/`<span` string in
app.js.

- [x] T5 — splitter keyboard + WAI metadata
  - Tests: `test/rail-resize.test.js` — PASS (14 assertions; steps,
    clamps, Home/End, pass-through, symmetry, idempotence); contract FR-6
    block — PASS
  - Compliance: FR-6 ✓ — `#sddbar .rail-resize` is now focusable
    (`tabIndex = 0`) with `aria-valuemin/max/now` (0/100/live percent,
    updated from BOTH pointer and keyboard paths via one `applyWidth`);
    keydown handles ArrowLeft/ArrowRight/Home/End through the pure
    `resizeStep` (a11y-contrast.js) and persists `pi:rail-width`; pointer
    drag behavior unchanged. NOTE: the T5 test table's ArrowLeft/
    ArrowRight directions contradicted its own prose + the pointer math
    (`delta = startX - clientX` — left drag = wider); prose + pointer win:
    ArrowLeft = wider (+5), ArrowRight = narrower (−5). Tests written to
    the corrected contract. ✓

- [x] T6 — labelled regions + semantic turns
  - Tests: `test/a11y-contract.test.js` — PASS (6 region-label asserts,
    7 turn/feed asserts)
  - Compliance: FR-7 ✓ — wsbar/sddbar/palette/modal were already
    labelled; `#input` gained `aria-label="message composer"`;
    `#transcript` stays the main landmark (name via aria-label would be
    redundant there — the feed carries the conversation name). FR-8 ✓ —
    new `#tfeed` (role="feed" aria-label="conversation") inside main;
    all 7 message/tool/marker append sites now target the feed; turns
    render as `<article class="msg">` (user/assistant/note/bash) with
    `aria-labelledby` → per-turn role ids (`turn-N-role`); tool blocks
    are `<article class="tool">` (role="group" dropped); compaction
    markers are `<article class="compact-turn">` wrapping the existing
    `details.compact-mark` (CSS `> summary` selectors untouched).
    DECISION: feed over log — role="log" carries implicit aria-live
    (per-token announcement spam, violates FR-9); role="feed" has no
    implicit live region, and streaming mutates article interiors without
    reparenting feed children. `transcript.appendChild` fully eliminated
    from message paths (asserted). Note: biome autofix flipped `let
    turnSeq` to `const` (useConst) — reworked to a const `{n}` counter.
    ✓

---

## T5 — Splitter keyboard + WAI metadata (FR-6)

New pure module function (in `a11y-contrast.js`): `resizeStep(percent, key,
min, max)` → clamped new percent for `ArrowLeft`/`ArrowRight` (±5, direction
matches visual: left = wider since rail is right-anchored — verify against
the existing pointer math and mirror it), `Home` → min, `End` → max,
unknown key → percent unchanged.

Wire in app.js `#sddbar .rail-resize` (already `role="separator"`,
mousedown drag, `aria-orientation`): add `tabindex="0"`,
`aria-valuemin/max/now` (now = current percent, updated live in BOTH the
pointer path and the key path), keydown handler calling `resizeStep` and
reusing the same apply/width persistence as the pointer path. Keep focus on
the handle after both interactions.

**Tests (TiCoder):** `test/rail-resize.test.js` — pure `resizeStep`: 50% +
ArrowRight → 55; 50% + ArrowLeft → 45; 97 + ArrowRight → clamps to max(100);
3 + ArrowLeft → clamps to min(0); Home/End; unknown key returns input;
symmetry ArrowLeft∘ArrowRight idempotence spot-check. Contract additions:
app.js contains `role="separator"` + `aria-valuenow` for `rail-resize`;
`tabindex` present in the same setup string.

---

## T6 — Labelled regions + semantic turns (FR-7, FR-8)

- `public/index.html`: `aria-label="conversation"` (or role+label) on the
  transcript container; composer + `#input` labels (input already has a
  placeholder — add `aria-label="message composer"`); `#wsbar` session
  navigation label; `#sddbar` tools-rail label; palette/modal labels where
  missing. Audit the 16 existing aria-labels — no duplicates.
- Turns: transcript gets `role="log"` (chosen over `role="feed"` because
  streaming mutates article interiors and reparents — record this decision
  in the verify log; `feed` demands stable direct-child articles and
  browser tooling for posinset/setsize). Each turn (user bubble,
  assistant bubble, compaction marker) renders as `<article>` with
  `aria-labelledby` → the `.role` label span gets an id
  (`turn-<n>-role`); the role span itself stays visually as-is.
  app.js:169/204/215/1315 bubble-creation sites updated.

**Tests (TiCoder):** contract — index.html contains the five labels;
app.js bubble markup strings contain `"<article` and `aria-labelledby`;
transcript container carries `role="log"` (index.html or app.js). Pure
helper if id-generation logic exists (`turnId(n)` → test).

- [x] T7 — coarse status + busy state
  - Tests: `test/rail-resize.test.js` — PASS (17 mapping asserts: 8 known
    events → text, 9 streaming/unknown → null); contract FR-9 block —
    PASS
  - Compliance: FR-9 ✓ — new `#a11y-status` (`role="status"` +
    `.sr-only` clip pattern) in index.html/style.css; `announceStatus`
    (app.js) writes `statusTextForEvent(evt)` at agent_start/agent_end/
    auto_retry_start/compaction_start; the pure mapping also covers
    error/extension_error/auto_retry_end for U4's event-surfacing (their
    handlers don't exist yet — documented). Every streaming event maps
    to null — no per-token announcements. `applyMessages` brackets the
    synchronous DOM mutation with `aria-busy` true/false on the feed
    (set/clear around the mutation, per the spec's timing rule); no
    separate prepend path exists in the current code (evidence). ✓

---

## T7 — Coarse status + busy state (FR-9)

- `role="status"` element (visually-hidden class, e.g. `.sr-only` — add to
  style.css if absent) in index.html; app.js updates its `textContent` at
  **turn boundaries only**: `agent_start` → "assistant working", `agent_end`
  → "response complete", error/`extension_error`/`auto_retry_end` → mapped
  message. Never inside the streaming path.
- Pure mapping `statusTextForEvent(evt)` in `a11y-contrast.js` → test.
- `aria-busy="true"` on the transcript before history replacement
  (`applyMessages`) and prepend, `false` after — set/clear must bracket the
  synchronous DOM mutation (one toggle per operation).

**Tests (TiCoder):** `statusTextForEvent` mapping table test (known events,
known strings, unknown → null); contract — index.html has `role="status"`;
app.js `applyMessages` string contains `aria-busy` set+clear.

- [x] T8 — focus twins + scroll-padding
  - Tests: `test/a11y-contract.test.js` — PASS (the auto-audit runs the
    REAL css/app/html: zero live violations; hoverRules/sel-evidence
    asserts; scroll-padding assert)
  - Compliance: FR-10 ✓ — no page-level sticky chrome exists over the
    transcript (the only sticky elements are inside diff boxes:
    `.sx-gnum` gutter columns + `.tool .dhunk` hunk labels), so
    scroll-padding-top went where the sticky child actually is:
    `.tool .out { scroll-padding-top: 36px }`. FR-12 ✓ — the audit
    flagged exactly ONE live class without a focus twin or native tag
    after tooling fixes: `item` (palette listbox option) — exempted
    with evidence (`.item:hover` and `.item.sel` share one rule — the
    keyboard highlight IS the hover twin; aria-activedescendant, never
    focused). Audit-tooling work: quote-tolerant `tagClasses` (chunked
    markup like `class="an-bar' + …`), createElement+className native
    detection (toast-x/sx-tab/qopt/qlink/ss-step/imgthumb-x/…), hyphen
    boundary + same-simple-selector rules (`.git-file:hover` no longer
    flags `git`; `.bubble a:hover` no longer flags `bubble`); discovered
    the double-quoted-string `"\s"` → `"s"` JS escape collapse (the
    space-exclusion silently never worked). Touch: `@media (hover:
    none)` keeps the rail-resize handle visible (base is transparent;
    `#usagebar` dims ON hover so base 1.0 is already touch-safe). A
    global `button:focus-visible` ring already exists (style.css:2340) —
    the native exemption is sound. ✓

---

## T8 — Focus twins + scroll-padding (FR-10, FR-12)

Contract test auto-audit in `test/a11y-contract.test.js`:
`hoverRules(css)` → selectors from style.css containing `:hover`;
for each live class (from `liveClasses(app.js)`) that appears in a
`:hover` rule, assert style.css ALSO has the class in a `:focus-visible`
or `:focus-within` selector — OR the selector is native-whitelisted
(`button`, `a`, `summary`, `input`, `select`, `textarea`, `[type=…]`).

Fix loop driven by the audit: add `:focus-visible` twins for
`.sx-ctx-btn`, `.sx-tab`, `.modal-x`, `.ws-x`, `.ws-mini`, `.set-x`,
`.sdd-close`, `.an-bar`, `.an-item`, `.um-refresh`, `.toast-x`, `.qopt`,
`.qlink`, `#palette .item`, `.bar-ovf > summary`, `.sb-sec > summary`,
`#usagebar`, `#ws-open`, `.rail-resize`, `#settings .set-stop` (whichever
the audit flags), visible in BOTH themes (2px ring, ≥3:1 vs adjacent).
`@media (hover: none)`: persistent affordance for the genuinely
hover-hidden actions (scrollbar/close buttons that fade), not whole panels.

Sticky chrome: `scroll-padding-top` on the scroll container that owns the
sticky `.statusbar`/composer (find the actual scroller; value ≥ sum of
sticky heights + 8px).

**Tests (TiCoder):** the auto-audit itself — `hoverRules` unit checks;
for the CURRENT style.css the audit passes with zero live-class violations
(whitelist only native-element selectors + documented dead CSS); assert
`scroll-padding-top` exists in style.css.

- [x] T9 — touch targets
  - Tests: `test/a11y-contract.test.js` — PASS (13 per-class size asserts
    - rail hit-area + reservation asserts)
  - Compliance: FR-11 ✓ — bumped to ≥24: `.ws-x` 22→24, `#ws-open` 22→24,
    `.imgthumb-x` 16×16 → min 24×24 (grows over the image corner),
    `.ws-mini`/`.set-x`/`.sdd-close`/`.toast-x` got min-width/min-height
    24. `.um-refresh` min-height 24. `.sx-conflict-btn`/`.sx-mode-btn`/
    `.sx-ctx-btn`/`.sx-reset`/`.modal-x` already ≥24 (evidence).
    `.rail-resize`: 6px visual strip → 24px hit zone via `::after`
    (left:0; width:24) + `.sdd-rail` `padding-left: 24px` reserves the
    zone so the handle never steals rail-button edges (the scrollbar side
    is flush, so the WCAG spacing exception does NOT apply — reserved
    padding instead). `.an-bar` is decorative inside `.an-item` buttons
    (target is the button — evidence, no change). Rest of the matrix
    (qopt/qlink/ss-step/bar buttons/sx-tab) already ≥24 via padding
    (evidence). ✓

---

## T9 — Touch targets (FR-11)

Audit + fix: every pointer control ≥24×24px **or** ≥8px clearance from
nearest target. Fix by CSS (min-width/min-height/padding/pseudo-element hit
area), including `#sddbar .rail-resize` effective hit area ≥24px tall.
Per-control evidence table written into the verify log
(control → size or spacing rationale). No blanket size bump.

**Tests (TiCoder):** contract — for the icon-button classes of T4 (+
`.sx-conflict-btn`, `.sx-mode-btn`, `.sx-ctx-btn`, `.sx-reset`,
`.um-refresh`, `.toast-x`, `.rail-resize`), style.css contains
`min-width: 24px` (or `width: 24px`+`height: 24px`) / `min-height: 24px`
(or padding/pseudo proving the hit area) — exact assert per class; the
spacing-exception controls are listed as evidence in the verify log
(assert only that they are NOT flagged by the T8 audit as hover-only
with no focus twin — i.e., they have focus styles).

---

## T10 — E2E + docs + close

- [x] T10 — E2E + docs + close
  - Tests: 19/19 files green (16 pre-existing + contrast + a11y-contract
    - rail-resize); `node --check` clean; `git diff --check` clean;
    server.js diff verified free of a11y changes (only the prior U5
    versioned-write work remains uncommitted)
  - Compliance: verify report written (FR→evidence map, touch-target
    table, decisions log incl. feed-over-log + scroll-padding target +
    audit-tooling discoveries); CHANGELOG entry; roadmap U2 → delivered;
    set archived. Browser spot-checks pending (paperlike tokens, focus
    rings, splitter keys, disclosures, touch targets — listed in the
    verify report). ✓
- Full suite: all 16 existing + `contrast` + `a11y-contract` +
  `rail-resize` = 19 files green; `node --check` app.js/server.js;
  `git diff --check`; HTTP wire smoke only if server.js changed
  (not expected — prove unchanged with `git diff --stat server.js`).
- Browser spot-check list (user): paperlike metadata legibility at
  100/125/150%, focus rings both themes + against sticky chrome, splitter
  arrows/Home/End, disclosures via keyboard, screen-reader pass (optional),
  touch targets, turns announced as log entries.
- Docs: CHANGELOG entry; `.sdd/verify_a11y-contrast_07082026.md` (FR→
  evidence map, browser log, touch-target table, feed-vs-log decision);
  roadmap U2 status → delivered; archive the set.

**Tests (TiCoder):** the whole suite green (the gate), plus the verify
report's FR→evidence map cross-checked against this file.

---

## Test suite summary (presented for validation)

| File | Covers | Red-first? |
|---|---|---|
| `test/contrast.test.js` | WCAG math, token scanner, P1–P16 pair table on BOTH themes | T1 (module absent), T2 (failing rows) |
| `test/a11y-contract.test.js` | native disclosures/buttons, hover→focus audit, labels, status/busy, touch-size rules | T3, grown in T4–T9 |
| `test/rail-resize.test.js` | `resizeStep` pure math | T5 |
| (pure helpers in `a11y-contrast.js`) | `statusTextForEvent`, `resizeStep`, contrast math | as above |

The contract test reads the REAL source files (app.js/style.css/index.html)
and encodes the audit as pass/fail — the no-DOM-harness stand-in for
behavioral a11y tests, same pattern as diff-contract.
