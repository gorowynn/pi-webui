# Plan — Adaptive Shell and Chrome (U1 / Phase A3)

> SDD Phase 1 artifact. Defines the **What** and **Why** only — no
> implementation, no tasks. Approval gate at the end.
>
> Slug: `adaptive-shell` · Date: `07082026` (7 Aug 2026).
> Followed by `spec_`, `tasks_`, `verify_` artifacts sharing this slug+date.
> Sources: [`docs/roadmap.md`](../docs/roadmap.md) U1 +
> [`docs/plans.md`](../docs/plans.md) Phase A3 (first UI slice of Phase A).
>
> **Ordering note (user decision 2026-08-07):** the U6/safeguard security slice
> (formerly the first Phase A runtime slice) is **deferred until after the UI
> changes**. UI-first execution: A3 → remaining UI slices → A6 later.

## Problem Statement

The current chrome — left workspace/session sidebar (`#wsbar`), right SDD rail
(`#sddbar`), header/footer/status bar, composer, and modals — clips or forces
horizontal scrolling at supported widths. Verified against the live source
(2026-08-07):

- one `@media (max-width: 720px)` cascade block (`style.css:1972`) is the single
  narrow-width fallback; the sidebar/rail body-margin pattern
  (`body.ws-on`, `body.sdd-on`) squeezes the transcript instead of yielding to
  it, and the sidebar has no overlay/drawer mode for narrow or floating JCEF
  windows;
- the empty transcript state is **CSS-only** (`#transcript:empty::before`) —
  no real accessible surface, no primary action;
- the `.activity` idle row renders permanently, duplicating status already
  implied by the header/footer;
- composer actions are not split primary/overflow, so Send/Stop and attachment
  compete with lower-frequency commands for width;
- no `100dvh`, no safe-area insets, no container-query/ResizeObserver width
  adaptation — installed (PWA) and JCEF surfaces fall outside the tested
  desktop widths.

We need the shell to adapt by **available content width** — drawers before the
transcript is squeezed, overflow before actions clip, stateful empty states,
and viewport/safe-area correctness — without redesigning the visual identity
or touching the server.

## Business Goals

1. **The transcript never squeezes below a usable floor.** Sidebars become
   overlay drawers (or collapse) *before* they hurt content; the content
   column always gets the width it needs.
2. **Every primary action reachable at every width.** Send/Stop and
   attachment stay primary and never scroll off; lower-frequency actions move
   to an explicit overflow group.
3. **Width adaptation by content, not viewport alone.** One mechanism
   (container queries if the minimum JCEF version supports them, otherwise a
   single bounded `ResizeObserver` toggling named width classes) drives the
   shell's responsive behavior instead of scattered media queries.
4. **Calmer chrome.** The idle activity row hides (reserved for
   work/intervention/error); the status set stays compact (repository/model/
   context); secondary metadata sits behind a labelled disclosure; the
   Sessions/New duplication disappears while left navigation is visible.
5. **Real empty states.** The transcript's empty state becomes stateful DOM
   with a label and one primary action — visible, accessible, actionable.
6. **Installed and embedded surfaces work.** `100dvh` + safe-area insets for
   PWA/standalone; narrow/floating JCEF windows usable with
   `PI_WEBUI_NO_SWITCH` unchanged.
7. **Nothing else regresses.** Modals, image strip, todos, SDD rail, Git diff,
   and permission UI are exercised at every baseline width in both themes;
   zero-build and zero new deps hold.

## Constraints

- **Hard: zero-build.** Plain `style.css` / `index.html` / `app.js` edits only;
  no bundler, no runtime install, no new dependencies.
- **Client-only slice.** No `server.js` changes (no new endpoints, no config
  surface) unless a smoke step proves an existing endpoint insufficient.
- **Existing state contracts preserved.** Sidebar collapse persists in the
  existing `localStorage` keys (`pi:wsbar`, `pi:sddbar`); the SDD rail keeps
  its drag-resize behavior; `PI_WEBUI_NO_SWITCH` (IDE/JCEF) mode stays fully
  usable and hides the workspace switcher exactly as today.
- **Both themes.** Dark and paperlike must pass the width matrix; no
  theme-specific responsive divergence.
- **Baseline first (A0 items 1–2).** Capture standalone screenshots at
  1440×1000, 1024×768, 720×900, and 480×900 in both themes plus a narrow and a
  floating JCEF window *before* changing behavior — manual comparison aid,
  not committed binaries.
- **Not a redesign.** Fit/correctness at widths only; no visual identity
  overhaul, no layout invention, no new features. W1 (unified rail) is a
  separate Next-horizon slice.

## Success Criteria

- [ ] **SC-1 — No clipping at baselines.** No page-level horizontal scrollbar
      and no clipped action/control at 1440, 1024, 720, and 480 px widths in
      both themes (standalone).
- [ ] **SC-2 — JCEF usable.** Narrow and floating JetBrains tool windows
      render without clipping, and IDE mode (`PI_WEBUI_NO_SWITCH`) behaves
      unchanged.
- [ ] **SC-3 — Drawer before squeeze.** The left sidebar converts to an
      overlay/drawer (collapse preserved) before the transcript falls below
      the usable floor; the right SDD rail behaves identically on its edge.
- [ ] **SC-4 — Composer stays primary.** Send/Stop and attachment are
      reachable without horizontal scrolling at every baseline width;
      lower-frequency actions live in an overflow group; a thin context-
      pressure meter exists and Compact is promoted with a clear nudge near
      the agreed threshold (kept in overflow while usage is low).
- [ ] **SC-5 — Calmer status.** The idle activity row is hidden; the status
      set is compact (repository/model/context); secondary metadata sits
      behind a labelled disclosure; Sessions/New is not duplicated while the
      left navigation is visible.
- [ ] **SC-6 — Stateful empty state.** The empty transcript renders a
      labelled, accessible state surface with one primary action (no
      pseudo-element-only fallback).
- [ ] **SC-7 — Viewport/safe-area.** `100dvh` and safe-area insets are applied
      so installed/PWA and embedded surfaces size correctly.
- [ ] **SC-8 — No regression.** Modals, image strip, todos, SDD rail, Git
      diff, and permission UI pass the width/theme smoke matrix; the full
      existing unit suite and `git diff --check` stay green; zero new deps.

## Out of Scope (this effort)

- **U6 / safeguard policy engine and broker** (A6 steps 1–14) — deferred after
  the UI changes per user decision; the `#permissions` launcher/badge surface
  mentioned in A3 step 11 is exercised only as an existing modal.
- **A1** (large-record/live-state), **A2** (draft-safe composer + Improve
  review), **A4** (contrast/a11y contract — though A4 needs this slice's
  shell, per U2 "U1 coordination"), **A5** (editable diff correctness) —
  separate slices.
- **A0 items 3–5** (permission fixtures, keyboard-order record, contrast
  measurements) — belong to their own slices.
- Server changes, new endpoints, new features, visual identity work, remote/
  LAN access.

---

**Phase 1 gate:** Does this plan align with your goals? Reply **Yes** to proceed
to the detailed specification (Phase 2), or **No** with corrections.
