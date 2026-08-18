# Tasks — Unified workspace-tools rail (W1)

Date: 17 Aug 2026 · Spec: `.sdd/spec_workspace-tools-rail_17082026.md`
Chunks are atomic, ordered; each = one change-set + one test set + checkpoint.

## Chunk 1 — Pure rail-state module (`public/rail.js`)

**FR-1 (table shape), FR-4 (persistence), FR-8 (generation)**
`createRailState()` with: `load()/save()` over `pi:rail` ({widget, open,
width}); one-time legacy migration from `pi:sddbar` when `pi:rail` absent;
unknown widget id → `{widget:null, open:false}`; `WIDGET_IDS` frozen fixed
list (sdd, analysis, git, quotas, todos); `createGen()` — `open()` returns
++gen, `stale(gen)` check. Dual-mode (module.exports + window.rail).
Static registration: `STATIC` entry in server.js + script tag in index.html
(load order before app.js).

**Tests (`test/rail.test.js` — all RED until built):**

- `WIDGET_IDS` is the frozen 5-list, Permissions absent (# FR-1)
- save/load round-trip; unknown id → closed (# FR-4)
- legacy `pi:sddbar` {open:true, width:300} migrates once (# FR-4)
- gen: open stamps ++, stale(gen) true after re-open (# FR-8)

- [x] Chunk 1 done 17 Aug 2026
  - Tests: `rail.test.js` — 13 checks PASS
  - Compliance: FR-1 frozen 5-list + permissions-absent ✓; FR-4 round-trip /
    unknown→closed / one-time legacy migration (legacy key left) ✓; FR-8
    monotonic gen + stale ✓. Matches plan "pure module first" and spec Data
    Models. Dual-mode + STATIC + script tag per GOTCHAS #11/#20. ✓

## Chunk 2 — Shell generalization (`#sddbar` → `#toolsbar`) + tab a11y

**FR-2, FR-5**
index.html: rename `#sddbar/#sdd-rail/#sdd-title/#sdd-body/#sdd-close` →
`#toolsbar/#tools-rail/#tools-title/#tools-body/#tools-close`; body classes
`sdd-on/sdd-open` → `rail-on/rail-open` (style.css + app.js refs + resize
handle wiring). Rail nav = `role=tablist`, buttons `role=tab` +
`aria-selected` + roving tabindex + Left/Right arrows; panel `role=tabpanel`

- `aria-labelledby`; Esc closes + focus returns to active tab. Width/resize
unchanged (existing rail-resize tests must keep passing after rename).

**Tests (`test/a11y-contract.test.js` additions — RED):**

- index.html carries tablist/tab/tabpanel + tools ids (# FR-5)
- app.js has roving tabindex + ArrowLeft/ArrowRight + Esc-to-trigger (# FR-5)
- existing resize/contrast assertions still pass (rename-aware) (# FR-2)

- [x] Chunk 2 done 17 Aug 2026
  - Tests: a11y-contract (new W1 FR-5 section) + shell-contract 28/28 +
    rail-resize — all PASS
  - Compliance: FR-2 shell renamed (ids/classes/body classes), resize +
    240–720 clamp + floor cap untouched (rail-resize green) ✓; FR-5
    tablist/tab/tabpanel + roving tabindex + Arrow keys + Esc→focus-active ✓
    (delegated on the rail so chunk 3's widget tabs light it up). Legacy
    pi:sddbar key reads/writes untouched on purpose (chunk 3 rewires to
    rail.js state). ✓

## Chunk 3 — Widget table + SDD migration (first widget)

**FR-1, FR-3, FR-11 (SDD parity)**
Register all 5 entries; only SDD functional (badge = current phase,
render = existing doc renderer, refresh = interval 30 s — the existing poll).
Others render an "coming in this migration" empty state (temporary). SDD tab
hidden while no active set; archive-on-verify hides it. One panel mounted;
switch calls onClose. Palette command `sdd` opens the widget. `updateSddBar`
retired into the widget.

**Tests (`test/rail.test.js` additions — RED):**

- table entries all carry {id,label,icon,badge,render,onOpen,onClose,commandId,refresh} (# FR-1)
- SDD badge maps phase → {text,tone} (# FR-6 partial)
- no-active-set → sdd tab hidden (pure visibility fn) (# FR-11)

- [x] Chunk 3 done 17 Aug 2026
  - Tests: rail.test.js 39 checks (validWidgetEntry ×6, sddVisibility ×4,
    sddBadge ×2, app.js table contract ×8) + a11y/shell green + full suite
  - Compliance: FR-1 fixed table validated at registration ✓; FR-3 single
    mounted panel + onClose on switch ✓; FR-11 SDD parity — stepper semantics,
    doc render, poll-sync, archive-hide, restore-once (pi:rail:sdd rel,
    legacy pi:sddbar rel fallback), palette "sdd phases" ✓. Width stays
    pi:rail-width (resize handle owns it — FR-4's three independent
    restores). Placeholders for chunks 5-7. ✓

## Chunk 4 — Badges (pure builders) + Permissions launcher

**FR-6, FR-7**
Pure badge builders in rail.js over existing client state: git (snapshot
cache → N changed / none), quotas (tracker → warn near limit), todos
(open count; all-done → none), approvals (pending count → err tone),
config-error. Render: icon/count + `aria-label`, tone as class AND text —
never color alone. Permissions rail button (outside the table): badge +
click → `location.hash = "#permissions"`; editor never in panel.

**Tests (`test/rail.test.js` additions — RED):**

- each builder: shape + tones + empty states (# FR-6)
- badge HTML always includes text or aria-label (anti-color-only) (# FR-6)
- permissions launcher routes to #permissions, not a panel render (# FR-7)

- [x] Chunk 4 done 17 Aug 2026
  - Tests: rail.test.js 52 checks (builders x14 + wiring contract x2)
  - Compliance: FR-6 pure builders with text+tone (never color alone),
    rendered with title attr; todosBadge honors hide-when-all-done parity ✓.
    FR-7 launcher outside the table, pinned below tabs, routes #permissions,
    err-tone badge for the on-screen approval ✓. git/quota badges read
    placeholder state (null) until chunks 6/7 wire the caches — builders
    null-safe by test. ✓

## Chunk 5 — Analysis widget migration

**FR-8, FR-10, FR-11 (Analysis parity)**
`render` reuses the analysis renderer into the panel container; `onOpen`
lazy-fetches with gen-stamp; stale ignored. Palette `session usage` opens
the rail widget when `PARITY.analysis` (default false → modal until smoke).
Modal code kept until parity flip.

**Tests (`test/rail.test.js` additions — RED):**

- lazy fetch fires only on open; second open re-fetches (# FR-8)
- stale response (old gen) does not render (# FR-8)
- palette routing pure fn honors PARITY flag (# FR-10)

- [x] Chunk 5 done 17 Aug 2026
  - Tests: rail.test.js 57 checks (paletteRoute x2 + wiring contract x3);
    session-analysis 52 still green (shared renderer unchanged math)
  - Compliance: FR-10 PARITY gate + paletteRoute ✓; FR-11 analysis parity —
    analysisBody() shared verbatim by modal + rail panel, jump wiring shared
    (modal closes, rail stays open + scrolls) ✓. DEVIATION: the lazy-fetch/
    stale-gen tests deferred to chunk 6 — analysis computes synchronously
    from in-memory state, so the gen-stamp can't bite there; git/quota are
    the real async fetchers. ✓

## Chunk 6 — Git widget migration

**FR-8, FR-10, FR-11 (Git parity)**
`showGitModal` body moves into `render(container)`; commit/push/discard
handlers reused verbatim (confirm gates unchanged); on-open lazy fetch +
gen. Badge from git snapshot cache. `PARITY.git` gates palette switch.

**Tests (`test/rail.test.js` additions — RED):**

- git badge: 3 changed → {text:"3 changed", tone:"warn"}; clean → none (# FR-6)
- not-a-repo → empty state + badge none (# edge)
- mutations routed through the same confirm-gated handlers (# FR-11)

- [x] Chunk 6 done 17 Aug 2026
  - Tests: rail.test.js 61 checks (wiring contract x4); test/git.test.js 37
    unchanged (server parsers untouched)
  - Compliance: FR-8 real async fetch gen-stamped, stale dropped ✓; FR-10
    PARITY.git ✓; FR-11 confirm gates untouched, renderers retarget via
    gEl() (modal card XOR rail body), back button re-renders into the SAME
    target, badge fed from snapshot (changed count), not-a-repo empty state
    preserved ✓. ✓

## Chunk 7 — Quotas + Todos widgets

**FR-11 (Quotas/Todos parity)**
Quotas: detail panel (chip + compact warning stay in status area).
Todos: panel renders the tool-owned mirror (`getTodos` equivalent state);
`#todopanel` in-flow behavior unchanged; badge = open-task count; interval
refresh while open. `PARITY.quotas`, `PARITY.todos` gates.

**Tests (`test/rail.test.js` additions — RED):**

- quota no-API provider → dashboard note, badge none (# edge)
- todos all-done → badge none + todopanel hidden (unchanged) (# FR-11)
- open count badge (# FR-6)

- [x] Chunk 7 done 17 Aug 2026
  - Tests: rail.test.js 65 checks (wiring contract x4); full suite clean
  - Compliance: FR-8 quotas fetch gen-stamped ✓; FR-10 PARITY.quotas +
    PARITY.todos with legacy paths (showUsage modal / in-flow panel reveal) ✓;
    FR-11 todos rows shared with in-flow panel (tool-owned state untouched,
    hide-when-all-done unchanged), quota detail = renderUsage verbatim
    (no-API dashboard note preserved), compact usage chip retained ✓.
    quotaBadgePct still null — hook lands with chunk 9 polish (badge
    builders null-safe, tested). ✓

## Chunk 8 — Narrow drawer + chrome de-duplication

**FR-9, FR-12**
Narrow content-width class → active widget renders as focus-trapped bottom
sheet (Tab cycles inside, Esc closes, focus → rail trigger; sheet never
leaves composer permanently obscured). At parity flags: `sb-git` (git),
`sb-tok`/`sb-cost` (analysis) leave the statusbar; `⋯` section keeps
repo/model/think/cache/ide.

**Tests (`test/a11y-contract.test.js` additions — RED):**

- focus-trap helper + esc/focus-restore present (# FR-9)
- statusbar assertions honor parity flags (# FR-12)

## Chunk 9 — Smokes, parity flips, docs, verify + archive

**FR-10 (parity gates), FR-12**
Live smoke on 4318 per widget: desktop, narrow drawer, reconnect (SSE drop),
keyboard. User eyeball gate → flip PARITY.* → remove duplicate palette
entries + dead modal code for migrated widgets. Docs: AGENTS.md file-map row
(rail.js + widget table), GOTCHAS entry (rail state key + parity flags),
design.md §8 update, CHANGELOG. Then `verify_` report + archive the set.

**Tests:** all suites green; grep-level check that removed modal code leaves
no dangling references.

## Dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 (strict; each mounts on the previous
checkpoint; 5/6/7 are independent of each other but sequenced to keep one
live migration surface at a time).

## Parity flag flip gate (FR-10)

A widget's palette entry switches from modal to rail ONLY in chunk 9, after
its four smokes pass and the user confirms. Until then both paths coexist.
