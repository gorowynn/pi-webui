# Verify — a11y-contrast (U2 / A4) — 07082026

## FR → Evidence map

| FR | Requirement | Evidence |
|---|---|---|
| FR-1 | Zero-dep contrast test | `test/contrast.test.js` — WCAG math from scratch (21:1 anchor, 4.54 documented example, gray 128 ≈ 0.2158), strict 6-digit `hexToRgb`, `extractThemeTokens` (bare `:root`/`[data-theme]` blocks only, media-nested + comments stripped, merged blocks, color-mix/rgba/short-hex ignored, real-file smoke: 13 tokens × 2 themes). PASS. |
| FR-2 | Paperlike AA ≥4.5 at ≤13px | 16-row pair table (P1–P16) — exactly the 10 predicted rows failed; 5 tokens darkened in the paperlike block only: `--muted` #8a7f70→#6a5f4e, `--secondary` #7a6b8a→#6c5c7f, `--accent` #b45309→#92400e, `--success` #4d7c0f→#3f6212, `--warning` #a16207→#854d0e. All 32 rows (16×2 themes) now ≥4.5; worst paperlike = P13 cyan 4.72. White-on-accent 7.09. PASS. |
| FR-3 | Dark theme AA (regression gate) | Dark rows untouched (`:root` unchanged) — all pass; worst = P7 muted-on-raised 4.64. PASS. |
| FR-4 | Native disclosures | Tool-card head converted `<div role="button" tabindex="0">` → `<button type="button" class="head" aria-expanded>` (keydown removed; button resets + existing `:focus-visible` ring). It was the app's only `role="button"`. Think/um-raw/cmd/compact-mark verified native `<details><summary>`; sx-tab/an-bar/an-item native buttons (evidence). Contract asserts. PASS. |
| FR-5 | Icon controls native + named | All 7 (`modal-x`, `ws-x`, `ws-mini`, `set-x`, `sdd-close`, `toast-x`, `um-refresh`) verified native `<button>` with accessible names; one gap fixed: `#ws-new` (ws-mini) gained `aria-label="new session"` (was title-only). PASS. |
| FR-6 | Splitter keyboard + WAI metadata | `#sddbar .rail-resize`: `tabIndex=0`, `aria-valuemin/max=0/100`, live `aria-valuenow` from BOTH pointer + keyboard via one `applyWidth`; ArrowLeft=wider/ArrowRight=narrower (±5)/Home/End via pure `resizeStep` (test/rail-resize.test.js, 14 asserts); persists `pi:rail-width`; focus retained. PASS. |
| FR-7 | Labelled regions | wsbar/sddbar/palette/modal were already labelled; `#input` gained `aria-label="message composer"`; conversation named via the feed label. PASS. |
| FR-8 | Turns as semantic articles | New `#tfeed` (`role="feed" aria-label="conversation"`) inside `<main>` (main landmark preserved); all 7 message/tool/marker append sites target the feed; user/assistant/note/bash turns are `<article class="msg">` with `aria-labelledby` → per-turn `turn-N-role` ids; tool blocks `<article class="tool">`; compaction markers `<article class="compact-turn">` wrapping the existing details (CSS untouched). PASS. |
| FR-9 | Coarse status + busy | `#a11y-status` (`role="status"`, `.sr-only` clip) announced at agent_start/agent_end/auto_retry_start/compaction_start via pure `statusTextForEvent` (mapping also covers error/extension_error/auto_retry_end for U4's event-surfacing); every streaming event → null (17 mapping asserts). `applyMessages` brackets the synchronous mutation with `feedEl` `aria-busy` true/false. PASS. |
| FR-10 | Focus visible + unclipped | Auto-audit (contract test) proved every live `:hover` class has a `:focus-visible`/`:focus-within` twin or is native (global `button:focus-visible` ring already existed); `scroll-padding-top: 36px` on `.tool .out` (the only container with a sticky child — `.dhunk`; no page-level sticky chrome exists over the transcript — verified). PASS. |
| FR-11 | Touch targets | 24px floors added: `.ws-x`, `#ws-open`, `.imgthumb-x`, `.ws-mini`, `.set-x`, `.sdd-close`, `.toast-x`, `.um-refresh`; rail-resize gets a 24px `::after` hit zone + `.sdd-rail` `padding-left: 24px` reservation (scrollbar side is flush — the WCAG 8px-spacing exception does NOT apply, so a reserved zone instead). Evidence table below. PASS. |
| FR-12 | Hover→focus/touch | Audit-driven: zero live violations (only `item` — palette listbox option — exempted: `.item:hover`/`.item.sel` share one rule, aria-activedescendant, never focusable). `@media (hover: none)` keeps the rail-resize handle visible (base transparent); `#usagebar` dims ON hover so base 1.0 is touch-safe. PASS. |

## Touch-target evidence table (FR-11)

| Control | Size | Basis |
|---|---|---|
| .modal-x | 24×24 | explicit width/height |
| .ws-x | 24×24 | bumped 22→24 |
| .ws-mini | ≥24×24 | min-width/min-height added |
| .set-x | ≥24×24 | min-width/min-height added |
| .sdd-close | ≥24×24 | min-width/min-height added |
| .toast-x | ≥24×24 | min-width/min-height added |
| .um-refresh | ≥24×24 | min-height added |
| .imgthumb-x | ≥24×24 | min-width/min-height added (grows over image corner) |
| #ws-open | 24×34 | width bumped 22→24 |
| .rail-resize | 24×100% hit | ::after width 24 + .sdd-rail padding-left 24 reservation |
| .sx-conflict-btn / .sx-mode-btn / .sx-ctx-btn / .sx-reset | ≥24 | pre-existing min sizes (evidence) |
| .ss-step / .qopt / .qlink / .bar button / .sx-tab / .an-item | ≥24 | content padding (evidence) |
| .an-bar | n/a | decorative bar inside .an-item button (target is the button) |

## Decisions log

- **feed over log**: `role="feed"` chosen — `role="log"` carries implicit `aria-live="polite"` which would announce every streamed token (FR-9 violation); feed has no implicit live region and streaming mutates article interiors without reparenting children. Feed sits on an inner `#tfeed` div so `<main>` keeps its landmark role.
- **T5 arrow directions**: the tasks table's ArrowLeft/ArrowRight were inverted vs. its own prose + the pointer math (`delta = startX - clientX` = left drag widens); prose + pointer win: ArrowLeft = wider (+5), ArrowRight = narrower (−5).
- **`statusTextForEvent` covers error/extension_error/auto_retry_end** even though those handlers don't exist yet — they arrive with U4's event-surfacing; the mapping is ready (tested).
- **scroll-padding-top on `.tool .out`**: no page-level sticky chrome exists over the transcript (the only sticky elements are diff-internal: `.sx-gnum` columns, `.dhunk` labels) — the honest target is the diff box (36px ≥ hunk label + margin).
- **Rail hit zone via reserved padding**: the handle is flush against both the transcript scrollbar and the rail buttons — the WCAG 2.5.8 spacing exception fails by the letter, so the 24px `::after` + `.sdd-rail` `padding-left: 24px` reserve the zone without stealing any target's edge.
- **palette `item` exempt**: listbox option with roving `aria-activedescendant` — never focusable; its keyboard highlight `.sel` shares the rule with `.item:hover`.
- **Audit-tooling discoveries**: JS double-quoted strings collapse `"\s"` → `"s"` (legacy escape behavior) — the space-exclusion in the audit silently never worked until single-quoted; chunked template markup (`class="an-bar' + …`) and createElement+className need tolerant tag parsing; hyphen-boundary + same-simple-selector rules kill `.git-file:hover`→`git` and `.bubble a:hover`→`bubble` false positives.
- **biome autofix fights**: `let turnSeq` → `const` (useConst) — reworked to a const `{ n }` counter.

## Browser spot-check list (pending user)

1. Paperlike metadata legibility at 100/125/150% (statusbar, cost/cache strips, timestamps, gutter) — token darkenings should read clearly; both themes.
2. Focus rings: Tab through the transcript → tool-card heads, diff tabs, conflict banner; Tab to the sdd rail → the resize handle; rings visible against all chrome (the global `button:focus-visible` rule).
3. Splitter keyboard: focus the handle, ArrowLeft/ArrowRight/Home/End — rail resizes; `aria-valuenow` updates; pointer drag unchanged.
4. Tool disclosures: Enter/Space opens/closes tool cards (native button now); thinking block toggles.
5. Screen-reader pass (optional): turns announced in order; status announced once at turn boundaries ("assistant working" / "response complete"); no per-token chatter.
6. Touch targets: rail-resize hit zone (24px — rail content shifted 24px right, buttons 64px wide now), ws-mini/set-x/sdd-close/toast-x tap targets, imgthumb-x close button.
7. Compaction markers still collapse/expand; bashExecution cards look unchanged (article wrapper is unstyled).

## Post-slice fix (2026-08-07) — loaded sessions rendered blank

User report: "loaded sessions chat are not rendered". Root cause: the T6
feed refactor made `#tfeed` a child of `<main id="transcript">`, but all
three history-clearing sites (`applyMessages`, the `workspace_changed`
handler, `resumeSession`) still cleared `transcript` — destroying the feed
itself, so replayed messages rendered into a detached node. Live chat
worked (feed existed until the first clear). Fix: clear `feedEl` at all
three sites, `applyMessages` reads `feedEl.lastChild` for `data-mi`, and
the empty-state moved OUT of the feed (sibling of `#tfeed`) so it
survives clears. Regression guards in `test/a11y-contract.test.js`
(no `setSafeHtml(transcript`, ≥3 feed-clears, `feedEl.lastChild`).
Re-check pending: load a session from the sidebar, switch workspaces,
resume a session — all render.

## Suite gate

19/19 test files green (16 pre-existing + contrast + a11y-contract + rail-resize); `node --check` app.js/server.js clean; `git diff --check` clean; server.js untouched by this slice (verified: no a11y terms in its diff).
