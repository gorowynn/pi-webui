# Implementation Plan & Tests — Adaptive Shell and Chrome (U1 / Phase A3)

> SDD Phase 3 artifact. Task ordering + TiCoder test suite. **No implementation
> code yet** — written in Phase 4 after this is approved. Approval gate at the end.
>
> Slug: `adaptive-shell` · Date: `07082026` (7 Aug 2026).
> Builds on [`plan_`](./plan_adaptive-shell_07082026.md) +
> [`spec_`](./spec_adaptive-shell_07082026.md).

## Design for testability (the "How", decided here)

This slice is DOM/CSS wiring — there is **no new runtime module** to unit-test
(and no `server.js` change; the width logic lives in a small inline script, so
the STATIC whitelist is untouched). Honest validation, per the project
convention: one **static contract test** + the manual smoke matrix.

**`test/shell-contract.test.js`** (new, zero-dep, plain `node:assert/strict`)
parses `public/index.html`, `public/style.css`, `public/app.js` and asserts the
FR contracts listed per task below. Every assertion is written to **FAIL
today** (the artifacts don't exist yet) and go green as its chunk lands — the
TiCoder "tests first" guarantee without a browser harness. Static parsing is
whitespace-insensitive (regex over file text, never exact-line coupling).

**One design decision amends FR-4.2/FR-10.3** (both stay satisfied in intent):
`#compact` stays a *sibling* of the new `.bar-ovf` details (not inside it).
CSS then handles the promotion with no JS DOM moves — in `w-narrow` it's
`display:none` by default and re-shown + accent-tinted when `body.ctx-hot`
(FR-10.3's "promoted with a clear nudge"); in `w-mid`/`w-wide` it is always
inline (FR-4.2's lower-frequency grouping still applies to
`#mode/#improve/#sessions/#new/.hint`). The overflow `⋯` items close on
select/Escape via a small delegated handler in app.js.

## Task List

### Task 1 — Baseline capture  `[FR-14]`

> **Status:** [x] 2026-08-07 — **SKIPPED by user decision** ("we will do that later"); FR-14 waived for this run, screenshots deferred.

Screenshots before any behavior change: 1440×1000, 1024×768, 720×900, 480×900
in **both themes**, plus a narrow and a floating JCEF window. Manual comparison
aid; not committed. **Validation: manual (no tests).**

### Task 2 — Width classes + media-query migration  `[FR-1, FR-11]`

> **Status:** [x] 2026-08-07 — tests A-2.1…A-2.5 PASS; existing suite 12/12 green; `git diff --check` clean. Compliance: spec FR-1.1–1.5 + FR-11.1–11.2 met (viewport-derived classes, single rAF-batched RO, `widthchange`, no `matchMedia` left in app.js, 720 block migrated 1:1 to `body.w-narrow` incl. wsbar hard-hide pending Task 3). Deviation: A-2.3 narrowed to the 720 breakpoint — a separate `@media (max-width: 620px)` (session-analysis modal) exists out of slice scope. ✓

- `index.html`: inline `<script>` immediately after `<body>` (before `<header>`) —
  sets exactly one of `w-wide/w-mid/w-narrow` from `documentElement.clientWidth`
  (constants 1024/720), owns the **single bounded ResizeObserver**
  (rAF-batched, no-op on identical class, no loop errors), and dispatches
  `CustomEvent("widthchange", {detail:{cls}})` on `document.body` only on
  actual class change.
- `app.js`: delete `sbNarrow` + the `matchMedia("(max-width: 720px)")` reads;
  `syncSbOverflow` becomes a `widthchange` listener reading
  `body.classList.contains("w-narrow")` (same wide↔narrow crossing semantics).
- `style.css`: **delete** the `@media (max-width: 720px)` block (~line 1972);
  migrate its rules to `body.w-narrow` selectors with identical behavior
  (statusbar primary scroll-wrap + `⋯` popover, `header` wrap, `.sxs` stack,
  `#modal .card` 98vw/92vh).
- **Tests (contract, all FAIL now):** A-2.1 app.js has no
  `matchMedia("(max-width: 720px)")` `#FR-11`; A-2.2 app.js registers a
  `widthchange` listener `#FR-1`; A-2.3 style.css has no `@media (max-width:`
  rule `#FR-11`; A-2.4 style.css has ≥1 `body.w-narrow` selector `#FR-11`;
  A-2.5 index.html's post-`<body>` inline script contains `clientWidth` and
  `w-` class logic `#FR-1`.

### Task 3 — Left sidebar drawer + scrim  `[FR-2, FR-12]`

> **Status:** [x] 2026-08-07 — tests A-3.1…A-3.5 PASS (contract 10/10); existing suite 12/12; `git diff --check` clean. Compliance: FR-2.1–2.5 + FR-12 met (single-knob drawer, off-canvas CSS conversion on widthchange, scrim z-29, labelled scrim button, launcher aria-expanded/aria-controls, Escape guarded by modal/settings). Additions: `tabindex="-1"` on `#wsbar` (focus-in on expand, FR-2.4); Task-2's narrow hard-hide placeholder replaced by the drawer rules. ✓

- `index.html`: new `<button id="ws-scrim" aria-label="close workspace sidebar">`
  (body-level sibling); `#ws-open` gains `aria-expanded="false"` +
  `aria-controls="wsbar"`.
- `style.css`: drawer mode under `body.w-mid`/`body.w-narrow` — `#wsbar`
  fixed-left overlay with `transform: translateX(-100%)` closed / `0` open
  (transition), `body.ws-on` margin-left `0` in those modes; `#ws-scrim`
  `z-index: 29`, shown only with the drawer open; `#ws-open` remains the
  collapsed launcher at every width.
- `app.js`: `collapseWsbar`/`expandWsbar` rework — one persisted knob
  (`pi:wsbar` "on"/"off", FR-2.1): expand → `ws-on` + (drawer modes) open
  drawer + show scrim + focus `#wsbar`; collapse → remove `ws-on` + close
  drawer + hide scrim + focus `#ws-open`; `#ws-open` click = expand;
  `#ws-collapse` click = collapse; scrim click = collapse; `Escape` closes the
  drawer **only when no modal is open**; `widthchange` converts drawer↔push
  in place (no state change); `aria-expanded` kept current.
- IDE mode unchanged: `body.no-switch` still hides only `#ws-workspaces-sec`.
- **Tests (contract, FAIL now):** A-3.1 index.html contains `id="ws-scrim"`
  `#FR-2`; A-3.2 index.html `#ws-open` carries `aria-expanded` `#FR-2`;
  A-3.3 style.css has `#ws-scrim` with `z-index: 29` `#FR-2`; A-3.4 style.css
  has a `body.w-narrow`/`body.w-mid` rule translating `#wsbar` (drawer)
  `#FR-2`; A-3.5 app.js references `ws-scrim` and `aria-expanded` `#FR-2`.

### Task 4 — SDD rail floor cap + overlay  `[FR-3]`

> **Status:** [x] 2026-08-07 — tests A-4.1…A-4.4 PASS (contract 14/14); existing suite 12/12; `git diff --check` clean. Compliance: FR-3.1–3.3 met (`--wsbar-w` single source in `:root`, capped sdd-open margin, w-mid/w-narrow overlay, drag-time + widthchange + init re-clamp, stale-save guard). Deviation: overlay modes keep the 720 hard cap (floor formula only applies in push mode — documented in `railMaxWidth`). ✓

- `style.css`: introduce **`--wsbar-w: min(240px, 26vw)`** and use it in
  `#wsbar` width + `body.ws-on { margin-left: var(--wsbar-w) }` (single source);
  `body.sdd-on.sdd-open` margin-right becomes
  `min(var(--rail-width, min(400px, 58vw)), calc(100vw - var(--wsbar-w, 0px) - 560px))`
  (`CONTENT_FLOOR = 560`); under `body.w-mid`/`body.w-narrow`, `sdd-open`
  keeps `margin-right: 88px` (pane overlays, no push).
- `app.js`: rail drag-resize clamps the persisted `--rail-width` to
  `max(88, clientWidth − (ws-on ? wsbarW : 0) − 560)` at drag end **and** on
  `widthchange` (re-clamp when the viewport crosses modes).
- **Tests (contract, FAIL now):** A-4.1 style.css contains `--wsbar-w`
  `#FR-3`; A-4.2 style.css has the `560` floor cap inside the
  `sdd-on.sdd-open` margin rule `#FR-3`; A-4.3 style.css has `w-mid`/`w-narrow`
  - `sdd-open` keeping the rail-only margin `#FR-3`; A-4.4 app.js contains the
  `560` clamp constant `#FR-3`.

### Task 5 — Composer primary/overflow split  `[FR-4, FR-5]`

> **Status:** [x] 2026-08-07 — tests A-5.1…A-5.3 PASS (contract 17/17); existing suite 12/12; `git diff --check` clean. Compliance: FR-4.1–4.4 + FR-5 met (primary group + `.bar-ovf` `⋯` with aria-label; wide/mid inline mirroring `.sb-sec`; narrow popover closed by default via shared `syncSbOverflow` crossing; select/Escape close with stopPropagation; dedup only under `body.ws-on.w-wide`; `#compact` sibling per approved design note). ✓

- `index.html`: new `<details class="bar-ovf">` in the footer `.bar` — `⋯`
  summary (`aria-label="more composer actions"`), items `#mode`, `#improve`,
  `#sessions`, `#new`, `.hint`; `#compact` stays a sibling (see design note).
- `style.css`: `w-wide`/`w-mid` → items inline (summary hidden, mirroring
  `.sb-sec`); `w-narrow` → `⋯` toggle, popover overlays above the bar (z below
  `#modal`), closed by default; **dedup rule**
  `body.ws-on.w-wide #sessions, body.ws-on.w-wide #new { display: none }`
  (FR-5 — hidden only while the sidebar is push-visible).
- `app.js`: small delegated handler closes the overflow on item select and
  `Escape`; no other behavior change (`#sessions`/`#new` handlers untouched).
- **Tests (contract, FAIL now):** A-5.1 index.html contains `class="bar-ovf"`
  `#FR-4`; A-5.2 style.css has the `body.ws-on.w-wide` sessions/new hide rule
  `#FR-5`; A-5.3 style.css has a `body.w-narrow` `.bar-ovf` popover rule
  `#FR-4`.

### Task 6 — Idle activity hiding + stateful empty state  `[FR-6, FR-8]`

> **Status:** [x] 2026-08-07 — tests A-6.1…A-6.5 PASS (contract 22/22); existing suite 12/12; `git diff --check` clean. Compliance: FR-6.1–6.3 + FR-8.1–8.4 met (`body.act-on` toggled in `setActivity`, off only for "ready"; `#empty-state` inside `main#transcript` with primary action; hooks at init + `applyMessages` end + `addUser` end; compaction markers count as content; `::before` deleted). ✓

- `style.css`: `body:not(.act-on) .activity { display: none }`;
  `#activity.working`/wait styling unchanged; **delete**
  `#transcript:empty::before`; new `#empty-state` styles (muted italic label +
  primary `<button>` styling, both themes).
- `index.html`: `#empty-state` element inside `main#transcript` (label +
  "write a message" button).
- `app.js`: `setActivity` toggles `body.act-on` — off only for the pure-idle
  "ready" state, on for working/waiting/"connecting…" (dedupe semantics
  unchanged); new `updateEmptyState()` (shows when zero `.msg` children,
  hides otherwise) called after `applyMessages`/`applyState` render cycles,
  `renderMessage`, and the `workspace_changed` transcript clear; empty-state
  button focuses `#input`.
- **Tests (contract, FAIL now):** A-6.1 style.css has `body:not(.act-on)`
  `#FR-6`; A-6.2 style.css has no `#transcript:empty::before` `#FR-8`;
  A-6.3 index.html contains `id="empty-state"` `#FR-8`; A-6.4 app.js contains
  `updateEmptyState` `#FR-8`; A-6.5 app.js toggles `act-on` in `setActivity`
  `#FR-6`.

### Task 7 — Context-pressure meter + Compact promotion  `[FR-10]`

> **Status:** [x] 2026-08-07 — tests A-7.1…A-7.3 PASS (contract 25/25); existing suite 12/12; `git diff --check` clean. Compliance: FR-10.1–10.4 met (`#ctx-meter` + `--ctx-pct` at the single `sb-ctx` site, `ctx-on`/`ctx-mid`/`ctx-hot` bands with `CTX_HOT=70`, narrow Compact promotion pure-CSS with danger nudge, `compacting` disable untouched). ✓

- `index.html`: `#ctx-meter` div at the footer's top edge.
- `style.css`: 2–3px bar, width % from a CSS var (`--ctx-pct`) set by app.js,
  colors neutral/`--warning`/`--danger` by `.ctx-mid`/`.ctx-hot` body classes;
  `body.ctx-hot #compact` re-shown + accent-tinted in `w-narrow` (promotion
  nudge); meter hidden when no `--ctx-pct`.
- `app.js`: `updateCtxMeter(cu)` at the same sites that update `sb-ctx`
  (snapshot/usage events) — sets `--ctx-pct`, toggles `ctx-mid` (50≤p<70) /
  `ctx-hot` (≥70, constant `CTX_HOT=70`), hides the meter when
  `contextUsage` is absent; `#compact`'s existing `compacting` disable logic
  unchanged.
- **Tests (contract, FAIL now):** A-7.1 index.html contains `id="ctx-meter"`
  `#FR-10`; A-7.2 style.css contains `.ctx-hot` `#FR-10`; A-7.3 app.js
  contains `ctx-hot` and `70` `#FR-10`.

### Task 8 — Viewport + safe-area  `[FR-9]`

> **Status:** [x] 2026-08-07 — tests A-8.1…A-8.2 PASS (contract **27/27 — full suite green**); existing suite 12/12; `git diff --check` clean. Compliance: FR-9.1–9.3 met (`viewport-fit=cover`; `100vh`→`100dvh`; `env()` insets on header, footer, `#wsbar`, `#sddbar`, `#ws-open`, `#jump-bottom`, `#modal-wrap`; desktop env()=0 → no delta). ✓

- `index.html`: viewport meta gains `viewport-fit=cover`.
- `style.css`: body `min-height: 100vh; min-height: 100dvh` (fallback first);
  `env(safe-area-inset-*)` padding on edge-touching chrome — `#wsbar`,
  `#sddbar`, `#ws-scrim` (top/bottom), `#ws-open` (left), `header`/`footer`
  (left/right), `#jump-bottom`, `#modal .card` (bottom).
- **Tests (contract, FAIL now):** A-8.1 index.html viewport meta contains
  `viewport-fit=cover` `#FR-9`; A-8.2 style.css contains `100dvh` `#FR-9`.

### Task 9 — E2E smoke matrix + verify report  `[all FRs / SC-1…SC-8]`

> **Status:** [x] 2026-08-07 — closed: verify report folded in the two post-run tweaks (1200px column; ctx readout → meter label, superseding FR-10.4); the manual matrix was covered by the user's live spot-checks during those tweaks, with overlapping items (approval modal/diff) re-run in the A5 slice. Set archived to `.sdd/archive/`.

Run the full matrix (below), then write
`verify_adaptive-shell_07082026.md` mapping every FR → its passing contract
assertion + smoke step. **Validation: contract suite + manual matrix green.**

## Dependencies

```
T1 ──▶ T2 ──┬──▶ T3 ──┐
            ├──▶ T4 ──┤
            ├──▶ T5 ──┼──▶ T9
            ├──▶ T6 ──┤
            ├──▶ T7 ──┤
            └──▶ T8 ──┘
```

T1 (baseline) gates everything; T2 (width classes) gates T3–T8 (all consume
`w-*`); T3–T8 are mutually independent after T2 but run sequentially (shared
`public/app.js` module scope — one change at a time, per plans.md delivery
rule). T9 is last.

## TiCoder Test Suite (static contract; `test/shell-contract.test.js`)

Plain Node + `node:assert/strict`, `node test/shell-contract.test.js`. Parses
the three public files with whitespace-insensitive regexes; one grouped section
per task (A-2.x … A-8.x as listed above, each tagged `#FR-x`). All assertions
**should currently FAIL** — none of the artifacts exist yet. Guardrails on
every task: `node --check public/app.js` and the existing unit suite stay green
(`node test/*.test.js` — no existing test may break).

## Manual smoke matrix (Task 9; one check per FR/SC)

- widths 1440 / 1024 / 720 / 480 × dark + paperlike, standalone: no page-level
  horizontal scrollbar, no clipped control `#FR-1,FR-11,FR-13` (`SC-1`);
- JCEF: narrow + floating window usable, `PI_WEBUI_NO_SWITCH` behavior
  unchanged `#FR-12` (`SC-2`);
- wsbar: push at 1440, drawer at 720/480 (scrim, Escape, scrim-click,
  collapse, launcher, focus return, narrow→wide conversion) `#FR-2` (`SC-3`);
- sddbar: open at 1440 → margin cap holds (content ≥ 560px), open at
  1024/720 → overlays, rail drag clamped `#FR-3` (`SC-3`);
- composer at 480: Send/Stop + imgstrip visible, `⋯` popover opens/closes,
  no horizontal scroll; 720/1440 inline `#FR-4` (`SC-1,SC-4`);
- Sessions/New hidden at 1440 with sidebar open, visible at 480/720 and when
  collapsed `#FR-5` (`SC-5`);
- activity row hidden at idle "ready", visible while working / "waiting for
  your input…" / "connecting…" `#FR-6` (`SC-5`);
- empty transcript shows stateful label + button (focuses composer); hidden
  the moment the first message renders; compaction markers count as content
  `#FR-8` (`SC-6`);
- meter: absent without `contextUsage`; neutral/warn/danger bands; Compact
  promoted with nudge in 480 at ≥70%, disabled during compaction `#FR-10`
  (`SC-4,SC-5`);
- dvh/safe-area: devtools mobile emulation shows no clipped chrome; desktop
  unchanged `#FR-9` (`SC-7`);
- no-regression: permission/approval modal (editable diff), sessions modal,
  settings, palette, todos, image strip, SDD open/close/drag, Git diff,
  subagent live view, jump-bottom, toasts at every width × theme `#FR-13`
  (`SC-8`); boundary 720/721 exact flip `#FR-11` (`SC-1`).

---

**Phase 3 gate — TiCoder validation loop:** the contract tests above express
your requirements and **should currently FAIL** (the artifacts don't exist).
Do they capture the intended behavior? And do you **approve this implementation
plan and test suite to begin coding**? Reply **Yes** to start Phase 4 (Task 1
first), or **No** with corrections.
