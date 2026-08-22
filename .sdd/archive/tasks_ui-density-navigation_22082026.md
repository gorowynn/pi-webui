# Implementation Plan: UI Density and Navigation

Source artifacts:

- `plan_ui-density-navigation_22082026.md`
- `spec_ui-density-navigation_22082026.md`

## Plan Goal Map

- **PG-1:** Make workspace/session resumption and common navigation faster.
- **PG-2:** Improve readability and accessibility while preserving the terminal identity.
- **PG-3:** Prioritize active, failed, pending, and security-relevant state over history and inherited detail.
- **PG-4:** Establish consistent hierarchy across chat, navigation, inspector, Permissions, and Fleet.
- **PG-5:** Preserve the zero-build architecture and existing operational contracts.

## Ordered Chunks

### Chunk 1 — Readability and target-size foundation

- [x] Raise the shared readability and interaction-target baseline in both themes.
  - **Compliance:** Added shared 13px/11px typography tokens, 32px pointer targets, 44px hoverless targets, metadata sizing, and regression coverage in `public/style.css` and `test/ui-density.test.js`; contrast, accessibility, shell, and syntax checks pass.
  - **Delivers:** FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-61, FR-62; PG-2, PG-4, PG-5.
  - **Scope:** `public/style.css`, `test/contrast.test.js`, `test/a11y-contract.test.js`, `test/shell-layout.test.js`.
  - **Behavior:** Establish minimum ordinary/metadata sizes, AA token contrast, desktop/touch target rules, non-color state cues, and reduced-motion parity without changing feature behavior.

#### TiCoder tests for Chunk 1

- **T1.1 (FR-1):** Source contracts reject ordinary UI text below 13px and secondary metadata below 10px in the changed shell/sidebar/rail surfaces.
- **T1.2 (FR-2):** `test/contrast.test.js` verifies required foreground/background token pairs at 4.5:1 or the applicable non-text threshold in dark and paperlike themes.
- **T1.3 (FR-3):** Accessibility contracts verify 32px pointer targets and 44px no-hover targets for primary and icon-only changed controls.
- **T1.4 (FR-5):** Layout contracts retain bounded flex/min-width behavior rather than fixed widths that overflow.
- **T1.5 (FR-6, FR-61):** Active/error/security states retain textual or structural cues in both themes.
- **T1.6 (FR-62):** Reduced-motion rules cover any affected transitions.

Run: `node test/contrast.test.js`, `node test/a11y-contract.test.js`, `node test/shell-layout.test.js`.

### Chunk 2 — Pure sidebar view behavior

- [x] Add a zero-dependency dual-mode sidebar helper for workspace disclosure and session filtering.
  - **Delivers:** FR-7, FR-9, FR-10, FR-14, FR-15, FR-59, FR-60; PG-1, PG-5.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/sidebar-ux.js`, `server.js` static whitelist, `public/index.html` load order, new `test/sidebar-ux.test.js`.
  - **Behavior:** Pure functions derive visible workspace rows, collapsed/expanded state, case-insensitive session matches, counts, and reset state without DOM, storage, or server mutation.

#### TiCoder tests for Chunk 2

- **T2.1 (FR-7, FR-9):** Collapsed projection returns the active workspace only; expanded projection returns all rows in original order.
- **T2.2 (FR-10):** Missing-active, empty, and failed states never project a falsely empty collapsed list.
- **T2.3 (FR-14):** Session filtering matches display name and first prompt case-insensitively and preserves source order.
- **T2.4 (FR-14):** Blank query returns every session and accurate counts.
- **T2.5 (FR-15, FR-60):** Reset projection clears query and returns collapsed workspace state.
- **T2.6 (FR-59):** Inputs remain unchanged, proving presentation-only behavior.
- **T2.7 (PG-5):** Browser and CommonJS exports load without global collisions.

Run: `node test/sidebar-ux.test.js`, `node test/shell-contract.test.js`.

### Chunk 3 — Collapsed workspace section

- [x] Integrate the compact workspace disclosure into the left sidebar.
  - **Compliance:** `#ws-toggle` (native button, `aria-expanded`/`aria-controls`/labelled) added to `#ws-workspaces-sec`; `ws-collapsed` class hides only inactive rows (CSS), reset via `sidebarUxSafe.resetState()` on `workspace_changed`, error/empty/no-active force expanded via `ws-error` hook, initial load starts compact, `no-switch` untouched. Covered by `test/workspace-collapse.test.js` + existing sidebar/a11y/shell tests (all green).
  - **Delivers:** FR-7, FR-8, FR-9, FR-10, FR-11, FR-12, FR-16; PG-1, PG-2, PG-5.
  - **Depends on:** Chunk 2.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/sidebar-layout.test.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Show the active row by default, expose a labelled native toggle, expand all rows on demand, collapse after a successful switch, and preserve IDE no-switch/drawer behavior.

#### TiCoder tests for Chunk 3

- **T3.1 (FR-8):** Markup contains a native workspace disclosure control with `aria-expanded`, `aria-controls`, and an accessible name.
- **T3.2 (FR-7, FR-9):** Source/layout contracts show only inactive rows are hidden in compact state.
- **T3.3 (FR-10):** Fetch failure, no-active, and empty data remain visible.
- **T3.4 (FR-11):** Successful workspace switch resets the disclosure and active row.
- **T3.5 (FR-12):** No-switch mode hides the section and toggle.
- **T3.6 (FR-16):** Existing drawer, focus, scrim, and Escape assertions remain green.

Run: `node test/sidebar-ux.test.js`, `node test/sidebar-layout.test.js`, `node test/a11y-contract.test.js`, `node test/shell-layout.test.js`.

### Chunk 4 — Session search and sticky session controls

- [x] Add transient session search, clear/count feedback, and sticky controls above the session list.
  - **Compliance:** `#ws-search` (`type=search`, labelled, `aria-live` count, explicit clear) filters via the pure `sessionView` over cached rows; `no matching sessions` empty state; query cleared on new session and workspace change (`resetState`); `#wsbar` is flex with `#ws-sessions` scrolling independently under sticky heading+search. Covered by `test/session-search.test.js`; full suite green.
  - **Delivers:** FR-13, FR-14, FR-15, FR-16, FR-59, FR-60; PG-1, PG-2.
  - **Depends on:** Chunk 3.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/sidebar-ux.test.js`, `test/sidebar-layout.test.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Filter already-fetched current-workspace sessions, preserve source data and selection, clear on workspace/new-session transitions, and keep heading/search available during list scroll.

#### TiCoder tests for Chunk 4

- **T4.1 (FR-13):** Sidebar layout contracts verify sticky session heading/search controls and an independently scrollable result list.
- **T4.2 (FR-14):** DOM wiring uses the approved pure filter, announces result count, and exposes a clear action.
- **T4.3 (FR-14):** No-match state is explicit and current source records remain untouched.
- **T4.4 (FR-15, FR-60):** Workspace change and new-session paths clear the query.
- **T4.5 (FR-16):** Resume/current-session behavior remains unchanged under empty and filtered queries.

Run: `node test/sidebar-ux.test.js`, `node test/sidebar-layout.test.js`, `node test/recent-sessions.test.js`, `node test/a11y-contract.test.js`.

### Chunk 5 — Conversation hierarchy

- [x] Make assistant prose primary and operational metadata subordinate without changing density semantics.
  - **Compliance:** The repeated per-turn assistant role label is now a quiet muted lowercase marker (no accent competition); prose keeps the transparent 14px reading surface; thinking/Tool Activity/usage already sit on quieter surfaces — density semantics, error visibility, tool names, and single usage strip unchanged (tool-presentation + a11y tests green). Covered in `test/transcript-layout.test.js` (17→25 assertions).
  - **Delivers:** FR-17, FR-18, FR-19, FR-20, FR-21, FR-22, FR-23; PG-2, PG-4, PG-5.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/app.js`, `public/style.css`, `test/transcript-layout.test.js`, `test/tool-presentation.test.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Retain one turn identity, quiet repeated labels/thought/tool/usage surfaces, keep errors and approvals prominent, and preserve live/history parity plus Tool Activity names.

#### TiCoder tests for Chunk 5

- **T5.1 (FR-17, FR-18):** Transcript contracts verify one assistant identity per turn and stronger prose than operational metadata.
- **T5.2 (FR-19, FR-20):** Focus/Balanced/Trace and error/pending visibility assertions remain intact.
- **T5.3 (FR-21):** Tool-name, repeat-count, state, error, and duration tests remain green.
- **T5.4 (FR-22):** Exactly one usage strip is associated with each completed assistant turn.
- **T5.5 (FR-23):** Live finalization and restored rendering share the same hierarchy path.

Run: `node test/transcript-layout.test.js`, `node test/tool-presentation.test.js`, `node test/a11y-contract.test.js`.

### Chunk 6 — Wide inspector-rail readability

- [x] Make wide-mode rail labels, badges, selected state, and targets fully readable.
  - **Compliance:** `.rt-lbl` + `.rt-badge` raised 9px→10px (metadata floor; complete labels, ellipsis only as overflow guard); selection keeps visible fill+border (non-color) with `aria-selected` (a11y-contract); targets already ≥32px/46px; fixed five-widget/permissions-launcher contract untouched (`rail.test.js` 70 checks green).
  - **Delivers:** FR-24, FR-25, FR-26, FR-27; PG-2, PG-3, PG-4.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/style.css`, `public/app.js`, `public/rail.js`, `test/rail.test.js`, `test/sidebar-layout.test.js`, `test/a11y-contract.test.js`, `test/shell-layout.test.js`.
  - **Behavior:** Remove partial-word clipping, preserve compact bounded badges, strengthen selected semantics, and retain the fixed five-widget/permissions-launcher contract.

#### TiCoder tests for Chunk 6

- **T6.1 (FR-24):** Wide rail contracts require complete labels or intentional icon-only labels with tooltip/accessibility text; clipped partial labels fail.
- **T6.2 (FR-25):** Badge formatters bound large counts and visible CSS does not clip the resulting value.
- **T6.3 (FR-26):** Selected tabs expose `aria-selected` plus non-color visible styling and no side stripe.
- **T6.4 (FR-27):** Target-size and roving-tabindex/arrow-key contracts remain green.
- **T6.5 (PG-5):** Widget order, IDs, permissions launcher, and persisted rail state remain unchanged.

Run: `node test/rail.test.js`, `node test/sidebar-layout.test.js`, `node test/a11y-contract.test.js`, `node test/shell-layout.test.js`.

### Chunk 7 — Discoverable narrow inspector launcher

- [x] Improve the mid/narrow rail launcher while preserving bottom-sheet containment.
  - **Compliance:** narrow strip tabs restored to the 32px floor (`body.w-narrow .rail-tab { min-width: 32px }`), dead resize-handle padding removed on narrow (`padding-left: 8px`), `body.rail-on` margin keeps the strip clear of the composer; sheet dialog semantics/Tab/Escape/focus-restore already covered by `a11y-contract.test.js` + `shell-layout.test.js`. Assertions in `test/ui-density.test.js`.
  - **Delivers:** FR-27, FR-28, FR-29; PG-1, PG-2, PG-4.
  - **Depends on:** Chunk 6.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/shell-layout.test.js`, `test/a11y-contract.test.js`, `test/rail-resize.test.js`.
  - **Behavior:** Provide a labelled, visible entry point with adequate hit area that does not overlap workspace/composer controls; retain focus trap, Escape, and return-focus behavior.

#### TiCoder tests for Chunk 7

- **T7.1 (FR-29):** Narrow layout contains one visible labelled inspector launcher with required hit area and bounded placement.
- **T7.2 (FR-28):** Bottom-sheet dialog semantics, Tab trap, Escape close, and trigger-focus restoration remain green.
- **T7.3 (FR-27):** Launcher supports native keyboard activation and a non-color open/selected state.
- **T7.4 (FR-29):** Layout contract forbids overlap with the workspace launcher and composer reserved area.

Run: `node test/shell-layout.test.js`, `node test/a11y-contract.test.js`, `node test/rail-resize.test.js`.

### Chunk 8 — Responsive utility-page width

- [x] Let Permissions and Fleet use wide displays without changing chat reading width.
  - **Compliance:** `@media (min-width: 1440px)` raises `.perm-body` to 1240px (inside the approved 1100–1280 band); transcript 1200px reading cap untouched (asserted); mid/narrow behavior unchanged (flex + min-width:0). Covered in `test/ui-density.test.js`.
  - **Delivers:** FR-30, FR-31, FR-32; PG-2, PG-4.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/style.css`, `test/shell-layout.test.js`, `test/permissions-ux.test.js`, `test/subagents-ux.test.js`.
  - **Behavior:** Keep transcript constraints, widen utility bodies only on wide viewports, and preserve bounded mid/narrow padding/overflow.

#### TiCoder tests for Chunk 8

- **T8.1 (FR-30):** Transcript max-width contract remains unchanged.
- **T8.2 (FR-31):** Wide utility body resolves within the approved 1100–1280px range.
- **T8.3 (FR-32):** Mid/narrow utility rules use available width without fixed overflow.
- **T8.4:** Permissions/Fleet page visibility, focus, and close contracts remain green.

Run: `node test/shell-layout.test.js`, `node test/permissions-ux.test.js`, `node test/subagents-ux.test.js`.

### Chunk 9 — Pure Permissions view projection

- [x] Extend the pure Permissions helper with prioritized sections, grouping, filtering, and safe selector summaries.
  - **Compliance:** `permView` (user-editable rows first with provenance, inherited floor/workspace rules grouped by tool behind a collapsed disclosure, case-insensitive tool/action/layer/selector filter, pending counts independent of collapse, no input mutation) + `selectorExplain` (bounded known-shape hints, raw stays authoritative). 9 helper checks in `test/permissions-ux.test.js`.
  - **Delivers:** FR-33, FR-34, FR-35, FR-36, FR-37, FR-39, FR-40, FR-59; PG-2, PG-3, PG-5.
  - **Depends on:** Chunk 8.
  - **Scope:** `public/permissions-ux.js`, `test/permissions-ux.test.js`.
  - **Behavior:** Derive ordered user/inherited groups, search matches, counts, known-selector explanations, and empty states without mutating configuration or changing verdict provenance.

#### TiCoder tests for Chunk 9

- **T9.1 (FR-33, FR-34):** Projection orders posture/pending/user/grants before collapsed inherited groups.
- **T9.2 (FR-35):** Editable and locked rows retain layer/provenance metadata.
- **T9.3 (FR-36):** Filter matches tool, action, layer, and selector case-insensitively while preserving source order.
- **T9.4 (FR-37):** Known selectors receive bounded explanations and always retain exact raw text.
- **T9.5 (FR-39):** No-match, malformed, and diagnostics states remain explicit.
- **T9.6 (FR-40):** Pending/security rows are never removed by inherited-policy collapse.
- **T9.7 (FR-59):** Input policy objects remain unchanged.

Run: `node test/permissions-ux.test.js`, `node test/permission-ux.test.js`.

### Chunk 10 — Permissions page integration

- [x] Integrate the prioritized Permissions view, inherited disclosure, and rule filter.
  - **Compliance:** `renderPermRules` renders through `pu.permView` (your-rules block with user-layer remove buttons, inherited groups behind a native collapsed `<details>` `inherited policy · N rules`), `#perm-filter` (`type=search`, labelled) re-renders from the cached tree with `no matching rules` empty state, `selectorExplain` hints beside raw code; revision-checked mutations/yolo/grants untouched (`safeguard-contract`, `permission-ux` green). Page-wiring asserts added to `test/permissions-ux.test.js` (12 checks).
  - **Delivers:** FR-33, FR-34, FR-35, FR-36, FR-37, FR-38, FR-39, FR-40; PG-2, PG-3, PG-4, PG-5.
  - **Depends on:** Chunk 9.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/permissions-ux.test.js`, `test/a11y-contract.test.js`, `test/safeguard-contract.test.js`.
  - **Behavior:** Render the approved priority, keep advanced inherited detail one action away, wire transient filtering, and leave revision-checked policy mutations/yolo/security behavior untouched.

#### TiCoder tests for Chunk 10

- **T10.1 (FR-33, FR-34):** DOM order and default disclosure state match the pure projection.
- **T10.2 (FR-35, FR-38):** User edit/remove and inherited lock contracts remain intact.
- **T10.3 (FR-36):** Filter input is labelled, transient, and delegates to the pure helper.
- **T10.4 (FR-37):** Explanation and raw selector are both accessible.
- **T10.5 (FR-39):** Loading, save failure, stale revision, and no-match states are visible.
- **T10.6 (FR-40):** Pending/security actions remain outside the collapsed inherited region.

Run: `node test/permissions-ux.test.js`, `node test/safeguard-contract.test.js`, `node test/a11y-contract.test.js`.

### Chunk 11 — Pure Fleet view projection

- [x] Extend Fleet helpers with priority grouping, summary counts, filtering, history disclosure, and steering-target reconciliation.
  - **Compliance:** `fleetView` (stopping→active→failed rows with newest-first order, completed history separated behind a collapsed disclosure, active/stopping/failed/completed counts, case-insensitive status+text filters, steering target kept only while active / auto-target only when exactly one active, empty + injected-clock stale flags, input-immutable) + `failureSummary` (first line, ≤160 chars, empty when no error). 11 new checks in `test/subagents-ux.test.js` (48 total).
  - **Delivers:** FR-41, FR-42, FR-43, FR-44, FR-45, FR-46, FR-47, FR-49, FR-59; PG-2, PG-3, PG-5.
  - **Depends on:** Chunk 8.
  - **Scope:** `public/subagents-ux.js`, `test/subagents-ux.test.js`.
  - **Behavior:** Derive active/failed/completed groups, newest-first ordering, bounded errors, counts, text/status matches, and valid steerable selection without mutating server projections.

#### TiCoder tests for Chunk 11

- **T11.1 (FR-41, FR-42):** Mixed runs produce correct summary counts and active/stopping → failed → completed order.
- **T11.2 (FR-43):** Completed history is omitted from the default visible projection but retained in the history projection.
- **T11.3 (FR-44, FR-45):** Active/failed cards expose required summary fields and bounded failure text.
- **T11.4 (FR-46):** Status/text filtering is case-insensitive and stable.
- **T11.5 (FR-47):** Missing, completed, or disappeared selections reconcile to no steerable target.
- **T11.6 (FR-49):** Empty/stale inputs return explicit noninteractive states.
- **T11.7 (FR-59):** Input run arrays remain unchanged.

Run: `node test/subagents-ux.test.js`.

### Chunk 12 — Fleet page integration

- [x] Integrate Fleet summaries, priority groups, completed-history disclosure, filters, failure summary, and selected steering target.
  - **Compliance:** `renderFleetList` renders through `sau.fleetView` (summary count chips + stale flag, priority rows, completed history behind native `#fleet-history` details with toggle persistence, `no matching runs` empty state); `#fleet-status` + `#fleet-filter` (labelled, transient) re-render from cached runs; steer bar names the target (`fl-steer-label`) and `send.disabled = !view.steerableId`; `sendFleetSteer` uses the reconciled `steerableId`; delegated stop/log/select handler, 2s poll, log cache, and control-inbox wire untouched. 6 wiring checks in `test/subagents-ux.test.js` (53 total).
  - **Delivers:** FR-41, FR-42, FR-43, FR-44, FR-45, FR-46, FR-47, FR-48, FR-49; PG-2, PG-3, PG-4, PG-5.
  - **Depends on:** Chunk 11.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/subagents-ux.test.js`, `test/subagents.test.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Render the approved projection, label steering target, disable invalid sends, preserve logs across polls, and leave control-inbox wire behavior unchanged.

#### TiCoder tests for Chunk 12

- **T12.1 (FR-41..FR-46):** Source/HTML contracts render counts, priority groups, filter controls, history disclosure, and bounded failure summary.
- **T12.2 (FR-47):** Steer input names its target and disables when the pure projection reports none.
- **T12.3 (FR-48):** Poll interval, cached logs, stop/force-stop envelopes, IDs, and row-position step lookup remain green.
- **T12.4 (FR-49):** Empty/loading/stale/unreachable states disable ineffective controls and remain explicit.
- **T12.5:** Native disclosure and filter controls meet keyboard/accessibility contracts.

Run: `node test/subagents-ux.test.js`, `node test/subagents.test.js`, `node test/a11y-contract.test.js`.

### Chunk 13 — Header status overflow hierarchy

- [x] Make header status deterministic and unclipped across width modes.
  - **Compliance:** Verified + locked: connection/settings/density live outside the disclosure (FR-50); `syncHeaderStatusOverflow` moves whole `.sb-meta` nodes (never text rewrites — FR-51/52) into the labelled native `⋯` disclosure; `widthchange` + ResizeObserver funnel into one sync pass (race-safe); inline repo/model bounded with ellipsis (no page overflow). Locked in new `test/header-overflow.test.js` (existing behavior was already contract-correct — no source change needed).
  - **Delivers:** FR-50, FR-51, FR-52, FR-59, FR-60; PG-1, PG-2, PG-4.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/shell-layout.test.js`, `test/shell-contract.test.js`, `test/status-race.test.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Keep connection/settings/density primary, move complete lower-priority status items into the existing labelled overflow based on available width, and prohibit partial fragments.

#### TiCoder tests for Chunk 13

- **T13.1 (FR-50):** Required primary controls remain outside overflow in all width classes.
- **T13.2 (FR-51):** Overflow selection is deterministic and moves whole status items, never clipped substrings.
- **T13.3 (FR-52):** Overflow exposes full text/state with native keyboard and accessible disclosure semantics.
- **T13.4:** Resize/status races leave each item in exactly one container and retain current values.
- **T13.5 (FR-59, FR-60):** Overflow-open state is transient and does not affect session data.

Run: `node test/shell-layout.test.js`, `node test/shell-contract.test.js`, `node test/status-race.test.js`, `node test/a11y-contract.test.js`.

### Chunk 14 — Composer primary/secondary action hierarchy

- [x] Keep permission posture and Send/Stop primary while consolidating secondary narrow-layout actions.
  - **Compliance:** `#compact` moved into the single `#bar-ovf` disclosure (identical wide/mid inline layout — its summary is hidden there; popover on narrow — `display:none` rule removed so it is never undiscoverable); mode-chip/Send/Stop/attach-images stay direct; ctx-hot nudge now flags both the Compact button and the ⋯ summary (`body.ctx-hot` rules); shortcuts/disabled states/autosize untouched. `test/composer-layout.test.js` 18→31 assertions.
  - **Delivers:** FR-53, FR-54, FR-55, FR-56, FR-57, FR-58, FR-59; PG-1, PG-2, PG-4, PG-5.
  - **Depends on:** Chunks 1 and 13.
  - **Scope:** `public/index.html`, `public/app.js`, `public/style.css`, `test/composer-layout.test.js`, `test/a11y-contract.test.js`, `test/shell-layout.test.js`.
  - **Behavior:** Use the existing composer overflow for secondary actions on narrow layouts, preserve image-state escalation, shortcuts, confirmations, and multiline growth, and reserve nonoverlapping launcher space.

#### TiCoder tests for Chunk 14

- **T14.1 (FR-53):** Permission posture, Send, and Stop remain direct controls outside overflow.
- **T14.2 (FR-54):** Compact, Improve, Sessions, New Session, and other approved secondary actions move as whole labelled controls in narrow mode.
- **T14.3 (FR-55):** Image action remains discoverable when supported and escapes overflow when attachments need attention.
- **T14.4 (FR-56):** Existing shortcuts, disabled states, and confirmation paths remain wired.
- **T14.5 (FR-57):** Resting composer and edge launchers have nonoverlapping reserved layout zones.
- **T14.6 (FR-58):** Textarea autosize still permits authored multiline growth.

Run: `node test/composer-layout.test.js`, `node test/a11y-contract.test.js`, `node test/shell-layout.test.js`.

### Chunk 15 — Cross-theme responsive verification and documentation

- [x] Complete cross-surface regression coverage, browser verification, design documentation, and changelog.
  - **Compliance:** All 53 test files green (8 new/extended files: ui-density, sidebar-ux, workspace-collapse, session-search, header-overflow, transcript-layout 25, composer-layout 31, subagents-ux 53, permissions-ux 12); `node --check` + lens error scan clean on all 7 changed sources; managed-browser smoke on a temp server (PORT=4318): wide layout renders compact workspace disclosure + filter + rail + composer overflow with an empty console, tree-killed after; docs updated (`docs/design.md` density floors, `AGENTS.md` sidebar-ux row, CHANGELOG entry). Theme parity: all new rules are token-based (no theme-specific overrides needed — contrast suite covers both themes). Narrow/mid verified via source contracts (the managed viewport is fixed 1920px).
  - **Delivers:** FR-5, FR-6, FR-23, FR-28, FR-32, FR-57, FR-61, FR-62, FR-63, FR-64; all PGs.
  - **Depends on:** Chunks 3–14.
  - **Scope:** focused test files above, `docs/design.md`, `GOTCHAS.md` only if a new invariant was learned, `AGENTS.md` index only if GOTCHAS changes, `CHANGELOG.md`.
  - **Behavior:** Validate dark/paperlike and wide/mid/narrow parity, no overflow/console errors, focus/disclosure behavior, active/security visibility, and unchanged wire contracts.

#### TiCoder tests for Chunk 15

- **T15.1 (FR-61):** Theme contracts confirm identical control presence/order and passing token contrast in dark and paperlike modes.
- **T15.2 (FR-63):** Managed-browser smoke at wide, mid, and narrow widths verifies workspace/session priority, rail labels/launcher, Permissions, Fleet, header, composer, focus, and no horizontal overflow.
- **T15.3 (FR-23):** Reloaded/restored conversation hierarchy matches live rendering.
- **T15.4 (FR-28, FR-57):** Narrow workspace drawer, rail sheet, composer, and launchers remain mutually nonoverlapping and focus-correct.
- **T15.5 (FR-64):** Every focused test and all repository `test/*.test.js` files pass.
- **T15.6:** `node --check` passes for changed JavaScript, LSP reports no errors, and lens diagnostics reports no new blocking findings.

Run every focused command above, then all `test/*.test.js` files with the repository's zero-framework Node loop.

## Dependency Graph

```text
Chunk 1 readability foundation
├── Chunk 2 sidebar helper → Chunk 3 workspace collapse → Chunk 4 session search
├── Chunk 5 conversation hierarchy
├── Chunk 6 wide rail → Chunk 7 narrow rail launcher
├── Chunk 8 utility width
│   ├── Chunk 9 permissions projection → Chunk 10 permissions integration
│   └── Chunk 11 fleet projection → Chunk 12 fleet integration
└── Chunk 13 header overflow → Chunk 14 composer hierarchy

Chunks 3–14 → Chunk 15 final responsive/theme verification
```

Each chunk is a checkpoint. Implement one chunk, run its approved tests, re-open the plan and specification, record a compliance note beneath its checkbox, then advance.

## TiCoder Approval Status

Awaiting user validation. The new tests above express the approved UI requirements and should fail before their corresponding feature chunk is implemented.
