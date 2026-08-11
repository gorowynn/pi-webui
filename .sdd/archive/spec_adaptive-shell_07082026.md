# Specification — Adaptive Shell and Chrome (U1 / Phase A3)

> SDD Phase 2 artifact. Functional contract + edge cases. **No implementation
> code.** Approval gate at the end.
>
> Slug: `adaptive-shell` · Date: `07082026` (7 Aug 2026).
> Builds on [`plan_`](./plan_adaptive-shell_07082026.md). Followed by `tasks_`,
> `verify_`. Traces: every FR cites its plan SC; every SC is covered by ≥1 FR.

## 1. User Stories

- **US-1** As a user in a narrow window (≤720px), I want the sidebars to
  **overlay** the transcript instead of pushing it, so reading and typing never
  squeeze below a usable width.
- **US-2** As a user with a wide window and a large SDD pane open, I want the
  transcript to keep a readable floor width, so the rail can't starve the
  conversation.
- **US-3** As an IDE user (JetBrains, floating/narrow tool window), I want the
  panel usable without horizontal scrolling and with `PI_WEBUI_NO_SWITCH`
  behavior unchanged.
- **US-4** As an installed/PWA user, I want no clipped chrome and correct
  viewport height + safe-area handling (notch/home-indicator).
- **US-5** As a user mid-conversation, I want idle chrome hidden and Compact
  promoted only when context is actually pressured.
- **US-6** As a new user, I want a real, labelled empty state with one clear
  action instead of a blank transcript.
- **US-7** As a user on any width, I want Send/Stop and attached images
  reachable without hunting, and lower-frequency actions grouped.

## 2. Functional Requirements

### 2.1 Width adaptation mechanism — `FR-1` [SC-1, SC-7]

1. `document.body` carries exactly one of the classes **`w-wide`** (>1024px),
   **`w-mid`** (721–1024px), **`w-narrow`** (≤720px).
2. The class is derived from **viewport width** (`documentElement.clientWidth`),
   NOT from body content width — body margins (sidebar reservation) change with
   the classes themselves, so content-derived classes would oscillate
   (documented design decision; the transcript floor is instead guaranteed by
   FR-3's margin cap).
3. One **bounded `ResizeObserver`** (single instance, rAF-batched, no loop
   errors) on `documentElement` keeps the class current; it runs from a tiny
   **inline script right after `<body>`** so the class exists before first
   layout (no wide-flash on narrow screens). app.js never re-implements it.
4. When the class changes, the inline script dispatches a `CustomEvent`
   **`widthchange`** (`{detail:{cls}}`) on `document.body`; app.js listeners
   (statusbar overflow sync, rail-width clamp) react to it. No `matchMedia`
   remains in app.js for shell layout.
5. Thresholds are single-source constants in the inline script (720, 1024).

### 2.2 Left sidebar modes — `FR-2` [SC-3]

1. `#wsbar` has three modes, selected by width class × `WS_KEY`
   (`localStorage["pi:wsbar"]`, existing key, values `"on"|"off"`, single knob):
   - **w-wide + on**: *push* (today's behavior — `body.ws-on` margin-left,
     `#wsbar` in-flow fixed, no scrim);
   - **w-wide + off**: *collapsed* — hidden, edge launcher `#ws-open` visible;
   - **w-mid / w-narrow + on**: *drawer* — `#wsbar` fixed-left **overlay**
     (`transform: translateX(-100%)` closed / `0` open, full height), body
     margin-left stays `0`, a **scrim** (`#ws-scrim`) covers the content;
   - **w-mid / w-narrow + off**: *collapsed* — same as today (launcher visible).
2. Drawer interactions: open via `#ws-open`; close via scrim click, `Escape`,
   or the existing `#ws-collapse` button. Closing at narrow writes `"off"` to
   `WS_KEY` (the same knob as collapse — one persisted state, no transient
   drawer flag); opening writes `"on"`.
3. Resizing narrow→wide with `"on"` converts drawer→push without losing state;
   wide→narrow converts push→drawer.
4. `#ws-open` gets `aria-expanded` + `aria-controls="wsbar"`; the scrim is a
   `<button>` with `aria-label="close workspace sidebar"` (focusable; A4 deepens
   the keyboard contract). Drawer `Escape` must not fire while `#modal` is open
   (modal owns Escape then).
5. z-order: content < `#ws-scrim` (z 29) < `#wsbar` (z 30, unchanged) <
   settings-back (z 39) < settings (z 40) < modal (z 50) — no new top layer.

### 2.3 Right SDD rail modes — `FR-3` [SC-2, SC-3]

1. **Rail** (closed): `body.sdd-on` margin-right `88px`, identical at all
   widths (unchanged).
2. **Pane open** (`body.sdd-open`):
   - **w-wide**: pushes (`margin-right: var(--rail-width, min(400px, 58vw))`),
     **capped so the transcript never falls below `CONTENT_FLOOR`** (560px):
     effective margin-right =
     `min(var(--rail-width, min(400px, 58vw)), calc(100vw - var(--wsbar-w, 0px) - 560px))`
     where `--wsbar-w` mirrors the wsbar push width (new shared CSS var for
     `min(240px, 26vw)`, set when `body.ws-on`, else 0);
   - **w-mid / w-narrow**: **overlays** — margin-right stays `88px`; the pane
     covers content on the right edge (z 30, above content).
3. **Rail drag-resize** (existing `--rail-width` + handle): the persisted width
   is clamped at drag time and on `widthchange` to
   `max(88px, viewport − (ws-on ? wsbarW : 0) − CONTENT_FLOOR)` so a huge pane
   cannot be dragged past the floor in push mode. Existing drag behavior,
   persistence, and the `open` toggle semantics are otherwise unchanged.

### 2.4 Composer primary/overflow split — `FR-4` [SC-1, SC-4]

1. Primary group (always visible, never scrolls off): `#send`, `#stop`, the
   attachment affordance (paste/drop + `#imgstrip`).
2. Lower-frequency actions (`#mode`, `#improve`, `#compact`, `#sessions`,
   `#new`, `.hint`) move inside a new **`<details class="bar-ovf">`** in the
   footer bar (summary `⋯`, `aria-label="more composer actions"`), mirroring
   the proven `sb-sec` pattern:
   - **w-wide / w-mid**: inline (summary hidden, items inline-flex — identical
     visual to today);
   - **w-narrow**: `⋯` toggle above the bar; open popover overlays
     (not in flow), closed by default.
3. No horizontal scrollbar inside `.composer` or `.bar` at any baseline width.
4. The overflow toggle's open state is transient (not persisted); closing on
   `Escape` and on selecting an action inside it.

### 2.5 Sessions/New dedup — `FR-5` [SC-5]

`#sessions` and `#new` are hidden by CSS **only** while the sidebar is
push-visible (`body.ws-on.w-wide`). In w-mid/w-narrow (drawer — closed by
default) and in collapsed/IDE states they remain available. IDE mode
(`PI_WEBUI_NO_SWITCH`) keeps its existing behavior — only the workspace list
section is hidden (`body.no-switch`), never the session list.

### 2.6 Idle activity row — `FR-6` [SC-5]

1. The `.activity` element stays in the DOM; a new **`body.act-on`** class
   controls visibility: `body:not(.act-on) .activity { display:none }`.
2. `setActivity(label, working)` sets `act-on` **off only for the pure-idle
   "ready" state**; it stays on for working states ("thinking…", "running
   bash: …"), intervention waits ("waiting for your input…"), and the initial
   "connecting…". The function's dedupe/label semantics are unchanged.
3. Hiding is pure CSS — no element removal, no layout jump for the footer.

### 2.7 Statusbar compact set — `FR-7` [SC-5]

The existing split (primary `repo/model/ctx` always inline; secondary
`git/think/cache/tok/$cost/ide` behind the labelled `⋯` disclosure, popover
under narrow) is **already shipped**; this slice only preserves it and
re-drives its narrow behavior from `body.w-narrow` (FR-12) instead of the
removed media query. No readout is added/removed.

### 2.8 Stateful empty state — `FR-8` [SC-6]

1. New element **`#empty-state`** inside `main#transcript` (replaces the
   `#transcript:empty::before` pseudo-element, which is deleted).
2. Contains: a label ("no messages yet — send one to begin" or equivalent) and
   **one primary action** (a `<button>` "write a message" that focuses
   `#input`).
3. `updateEmptyState()` runs after every `applyMessages`/`applyState` render
   cycle and after `renderMessage`; it shows the state only when the transcript
   contains **zero `.msg` children** (including during compaction markers —
   a marker counts as content), hides otherwise.
4. Both themes must render it with the existing `--muted` text token; the state
   is labelled and the action is a native `<button>` (A4 owns the full
   keyboard/screen-reader contract).

### 2.9 Viewport + safe-area — `FR-9` [SC-7]

1. `meta[name=viewport]` gains `viewport-fit=cover`.
2. Body height becomes `min-height: 100vh; min-height: 100dvh` (fallback
   first); the fixed full-height rails/launcher keep their `top:0/bottom:0`
   sizing but add `env(safe-area-inset-*)` padding on the edges they touch
   (top/bottom for `#wsbar`/`#sddbar`/scrim, left/right for `#ws-open`,
   `header`, `footer`, `#jump-bottom`, `#modal .card` margins). `env()` is 0 on
   desktop — no visual change there.
3. No element may rely on `100vh` where `100dvh` changes behavior on mobile
   install; the transcript scroll region keeps `min-height:0` flex semantics.

### 2.10 Context-pressure meter + Compact promotion — `FR-10` [SC-4, SC-5]

1. New **`#ctx-meter`**: a thin (2–3px) bar rendered at the top edge of the
   footer, width % = `contextUsage.percent` (existing RPC shape
   `{percent, tokens, contextWindow}`), updated at the same sites that update
   `sb-ctx` (snapshot/usage events). Hidden when `contextUsage` is absent.
   `aria-hidden="true"` for now (A4 assigns semantics).
2. **`body.ctx-hot`** is toggled when `percent ≥ 70` (single constant).
3. In w-narrow, `.ctx-hot` promotes `#compact` out of the overflow into the
   primary row with a clear nudge (accent tint + title); at lower pressure it
   stays in overflow. The existing `compacting` disable state (button
   `disabled`) is preserved.
4. Meter color: neutral <50, `--warning` 50–70, `--danger` ≥70 — never the only
   signal (the numeric `sb-ctx` readout remains).

### 2.11 Media-query migration — `FR-11` [SC-1, SC-8]

1. The `@media (max-width: 720px)` block (`style.css` ~line 1972) is **removed**;
   its rules move to `body.w-narrow` selectors with identical behavior:
   statusbar primary scroll-wrap + `⋯` popover, `header` wrap, `.sxs` stack,
   `#modal .card` 98vw/92vh.
2. `app.js`'s `sbNarrow`/`syncSbOverflow` switch from `matchMedia("(max-width:
   720px)")` to reading `body.w-narrow` + the `widthchange` event (FR-1.4).
3. No behavior parity regression at exactly 720px and 721px (boundary smoke).

### 2.12 IDE / JCEF — `FR-12` [SC-2]

1. `PI_WEBUI_NO_SWITCH` semantics unchanged: `body.no-switch` hides only
   `#ws-workspaces-sec`; `refreshWorkspaces` still returns early; the sessions
   list and drawer behavior work normally.
2. A floating/narrow JCEF window renders with no horizontal scrollbar and no
   clipped controls at its minimum practical width (~480px).

### 2.13 No-regression gate — `FR-13` [SC-8]

Existing surfaces must pass the width×theme smoke matrix unchanged:
permission/approval modal (incl. editable diff), sessions modal, settings
sidebar, command palette, todos panel, image strip, SDD rail (open/close/
drag), Git diff modal, subagent live view, `#jump-bottom`, toasts. Full
existing unit suite green; `git diff --check` clean; zero new deps.

### 2.14 Baseline capture — `FR-14` [plan constraint]

Before any behavior change: capture standalone screenshots at 1440×1000,
1024×768, 720×900, 480×900 in both themes + a narrow and a floating JCEF
window. Manual comparison aid; not committed.

## 3. Data Models

### 3.1 Width classes (single source of truth)

| Class | Viewport range | Sidebar mode | sdd pane |
|---|---|---|---|
| `w-wide` | >1024 | wsbar push (or collapsed) | push, floor-capped |
| `w-mid` | 721–1024 | wsbar drawer | overlay |
| `w-narrow` | ≤720 | wsbar drawer | overlay |

Viewport-derived (not content-derived) to avoid the margin↔class feedback
cycle (FR-1.2). Constants: `WIDE=1024`, `NARROW=720`, `CONTENT_FLOOR=560`,
`CTX_HOT=70`.

### 3.2 Persisted state (all existing keys; no new keys)

- `pi:wsbar` = `"on" | "off"` — sidebar visibility (push at wide, drawer at
  narrow). Single knob; drawer open/close writes it.
- `pi:sddbar` = `{open, rel}` — SDD rail pane (unchanged).
- `--rail-width` CSS var — SDD pane width, now clamped by FR-3.3.

### 3.3 New DOM/CSS surface

| Element | Location | Role |
|---|---|---|
| `#empty-state` | inside `main#transcript` | labelled empty state + primary action |
| `#ws-scrim` | `<button>`, body-level sibling | drawer scrim, z 29 |
| `.bar-ovf` | `<details>` in footer `.bar` | composer overflow (`⋯`) |
| `#ctx-meter` | footer, above statusbar | pressure bar, aria-hidden |
| `--wsbar-w` | CSS var | wsbar push width, shared by `#wsbar`/`body.ws-on`/floor cap |
| `body.w-*`, `body.act-on`, `body.ctx-hot` | body classes | width mode / activity / pressure |
| `widthchange` | CustomEvent on body | `{detail:{cls}}`, from the inline width script |

### 3.4 Existing data consumed

`contextUsage = {percent, tokens, contextWindow}` (pi RPC; already rendered in
`sb-ctx`). Absent → meter hidden, `ctx-hot` off.

## 4. Edge Cases

1. **Margin↔class oscillation** — prevented by design (FR-1.2): classes derive
   from viewport width only; the transcript floor is enforced by the margin
   cap, never by reclassifying.
2. **Resize across modes** — drawer→push and push→drawer with `"on"` converts
   in place (FR-2.3); `widthchange` re-clamps `--rail-width` (FR-3.3).
3. **Drawer + modal** — Escape closes the modal first; scrim never appears
   above `#modal` (z-order FR-2.5).
4. **Empty state vs streaming** — a streaming turn's first `.msg` hides the
   state; compaction markers count as content (FR-8.3).
5. **`contextUsage` missing / `percent:null`** — meter hidden, no `ctx-hot`
   (FR-10.1/3.4).
6. **480px boundary** — composer overflow closed by default; `#modal .card`
   98vw; `.sxs` stacked; statusbar primary scrolls internally; no horizontal
   page scrollbar (FR-11 smoke).
7. **Safe-area on desktop** — `env()` resolves 0; no visual delta (FR-9.2).
8. **Drag beyond floor** — clamped at drag + on `widthchange` (FR-3.3); the
   clamp never shrinks below `88px`.
9. **720/721 boundary** — class flip is exact; sb popover and overflow states
   follow the class, not the media query (FR-11 smoke).
10. **no-switch + narrow** — drawer still usable for sessions; workspace list
    absent (FR-12.1).
11. **RO errors** — single observer, rAF-batched; identical class set is a
    no-op (no layout thrash); observer failure degrades to the last class
    (app still functional).
12. **Keyboard basics** — launcher focusable, scrim focusable, drawer closes
    on Escape with focus returned to the launcher (deep contract in A4).

## 5. Verification Approach

- **Automated**: no new pure-logic module is introduced by this slice (DOM/CSS
  wiring only); the existing unit suite must stay green (`node test/*.test.js`),
  `node --check public/app.js`, `git diff --check`.
- **Manual smoke matrix** (every FR/SC): 4 widths × 2 themes standalone; narrow
  - floating JCEF; drawer open/close/resize-conversion; SDD pane push/cap/
  overlay; composer overflow at 480; dedup visibility; activity hiding; empty
  state; meter thresholds; 720/721 boundary; no-regression list (FR-13).
- Baseline screenshots (FR-14) before the first behavior change; after-changes
  shots for comparison.

---

**Phase 2 gate:** Is this specification complete and accurate? Reply **Yes** to
proceed to the implementation plan + TiCoder tests (Phase 3), or **No** with
corrections.
