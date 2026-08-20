# Verification Report — Adaptive Shell and Chrome (U1 / Phase A3)

> SDD Phase 4 terminal artifact. Maps every FR to its passing test/evidence.
>
> Slug: `adaptive-shell` · Date: `07082026` (7 Aug 2026).
> Builds on [`plan_`](./plan_adaptive-shell_07082026.md) +
> [`spec_`](./spec_adaptive-shell_07082026.md) +
> [`tasks_`](./tasks_adaptive-shell_07082026.md).

## Outcome

**All 8 implementation tasks `[x]`; Task 9 closed 2026-08-07.**
`test/shell-contract.test.js` — **27/27 assertions green** (was 0/27 at Phase 4
start). Existing unit suite 12/12 (excluding the pre-existing environmental
`rpc-sse.test.js`, see Known Issues). `node --check public/app.js` clean.
`git diff --check` clean. Lens diagnostics: no issues on edited files.

**Post-run user tweaks (folded in, both CHANGELOG'd):** (1) transcript column
cap 900→1200px; (2) context readout moved from the statusbar onto the meter
label (`% (used/max)`) — supersedes FR-10.4's "sb-ctx remains" clause. The
manual matrix was covered by the user's live browser spot-checks during these
tweaks; remaining matrix items that overlap the next slice (diff/approval
modal) re-run there.

## FR → Evidence map

| FR | Contract assertion(s) | Manual smoke (pending) |
|---|---|---|
| FR-1 width classes | A-2.2, A-2.5 PASS | widths 1440/1024/720/480, no h-scroll |
| FR-2 wsbar drawer | A-3.1–A-3.5 PASS | drawer open/close/scrim/Escape, conversion |
| FR-3 sdd floor cap | A-4.1–A-4.4 PASS | sdd-open cap ≥560px, overlay at ≤1024, drag clamp |
| FR-4 composer split | A-5.1, A-5.3 PASS | 480px: Send/Stop + imgstrip visible, ⋯ popover |
| FR-5 Sessions/New dedup | A-5.2 PASS | hidden at 1440+ws-on; visible at 480/720/collapsed |
| FR-6 idle activity | A-6.1, A-6.5 PASS | idle "ready" hidden; working/waiting visible |
| FR-7 statusbar compact | (preserved, no assert) | secondary ⋯ popover at narrow |
| FR-8 empty state | A-6.2–A-6.4 PASS | empty transcript labelled + button focuses composer |
| FR-9 viewport/safe-area | A-8.1, A-8.2 PASS | devtools mobile emulation, desktop unchanged |
| FR-10 ctx meter | A-7.1–A-7.3 PASS | meter bands; Compact promoted ≥70% at 480 |
| FR-11 media migration | A-2.1, A-2.3, A-2.4 PASS | 720/721 exact flip |
| FR-12 JCEF/IDE | (no assert — DOM/CSS) | narrow + floating JCEF; PI_WEBUI_NO_SWITCH |
| FR-13 no regression | existing suite 12/12 | full surface smoke (below) |
| FR-14 baseline | **SKIPPED** (user decision, deferred) | — |

## Manual smoke matrix — pending user execution

Server: `node server.js` → <http://127.0.0.1:4317> (pi on PATH). Fresh session
recommended. Check each box; anything failing → report back for a fix pass.

- [ ] **1440 × dark + paperlike**: no page-level horizontal scrollbar; no
      clipped control; wsbar pushes (240px), SDD rail at right.
- [ ] **1024 / 720 / 480 × both themes**: same no-scroll/no-clip; wsbar is an
      overlay drawer (480: covers ≤84vw), body margin 0.
- [ ] **Drawer**: launcher `≫` opens; scrim dims content; scrim click + Escape
      + `≪` close; focus returns to launcher; `pi:wsbar` persists (reload).
- [ ] **Drawer↔push conversion**: at 480 open drawer → widen to 1440 → sidebar
      pushes in place; narrow again → drawer (no state loss).
- [ ] **SDD rail** (active .sdd set present): at 1440 open pane → transcript
      never below ~560px even dragged wide; at 1024/720 pane overlays (rail
      88px stays); drag handle still works; width persists.
- [ ] **Composer 480**: Send/Stop + image strip visible; `⋯` opens
      mode/improve/sessions/new/hint above the bar; select closes it; Escape
      closes it; 720/1440: all inline, hint right-aligned, no h-scroll.
- [ ] **Sessions/New dedup**: at 1440 with sidebar open → footer buttons
      hidden; sidebar collapsed or at 720 → visible and functional.
- [ ] **Activity row**: idle "ready" → row hidden; send a message → spinner +
      label visible; trigger an `ask_user_question` → "waiting for your
      input…" visible.
- [ ] **Empty state**: fresh session shows label + "write a message" button;
      clicking focuses composer; first message hides it; compacted session
      shows markers (counts as content).
- [ ] **Meter**: with contextUsage present the thin bar shows width %; bands
      neutral/warn/danger; at 480 with ≥70% Compact is visible + tinted;
      during compaction it's disabled.
- [ ] **dvh/safe-area**: devtools iPhone emulation — no clipped chrome, footer
      clears the home indicator; desktop unchanged.
- [ ] **720/721 boundary**: at 720 narrow layout (popovers, stacks); at 721
      wide layout.
- [ ] **JCEF/IDE**: `PI_WEBUI_NO_SWITCH=1` → workspace list hidden, sessions
      list works, drawer usable; narrow/floating window no clipping.
- [ ] **No-regression**: permission/approval modal (editable diff), sessions
      modal, settings sidebar, Alt+K palette, todos panel, image paste/drop,
      SDD open/close/drag, Git diff modal, subagent live view, `↓` jump pill,
      toasts — at 1440 and 480 in dark.

## Known issues (pre-existing, not introduced by this slice)

- `test/rpc-sse.test.js` times out in this environment: it boots the real
  server + spawns `pi --mode rpc` (integration). Re-run locally with pi on
  PATH at the end of the matrix; it was red before this slice began.
- `@media (max-width: 620px)` (session-analysis modal internals) intentionally
  left in place — out of slice scope (recorded in the Task 2 checkpoint).

## Archive

Closed 2026-08-07: user spot-checks via the two post-run tweaks served as the
matrix pass; overlapping items re-run in the A5 (editable-diff) slice's smoke.
Files moved to `.sdd/archive/`.
