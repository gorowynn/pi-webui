# Specification: Reference UI adaptation

## User Stories

- As a user, I want the current workspace and session visible beside the chat so
  I can orient myself without opening a modal.
- As a user, I want to start a new session and see live connection/usage context
  from the shell so common actions do not require Settings.
- As a user, I want assistant prose to remain the primary reading surface while
  tool activity stays scannable and expandable.
- As a user, I want the composer to be the clear bottom-of-screen action area so
  sending, stopping, and checking permission posture are immediate.
- As a user on a small screen, I want the same navigation and tools to collapse
  into accessible drawers/sheets rather than becoming a second UI model.

## Functional Requirements

### FR-1 — Shell hierarchy

The shell SHALL present four visual regions: a left workspace/session
navigation area, a compact header, a centered transcript, and a bottom composer.
The optional workspace-tools rail SHALL remain secondary to the transcript.

On wide viewports, the left navigation may push the content and the right tools
rail may push the content when open. On mid and narrow viewports, navigation and
tools SHALL retain their existing drawer/bottom-sheet behavior.

### FR-2 — Workspace and session navigation

On wide viewports with the sidebar enabled, the workspace section and session
section SHALL be visible together, matching the reference's persistent project
context and history. On mid and narrow viewports, the existing one-section-at-a-
time drawer behavior SHALL remain.

The sidebar SHALL retain:

- active workspace and active session styling;
- workspace switching and recoverable removal behavior;
- the visible new-session action in the sessions section;
- session filtering, result counts, empty states, and keyboard focus behavior;
- the IDE/no-switch mode that hides workspace switching.

No file explorer SHALL be added as part of this adaptation.

### FR-3 — Header context and actions

The header SHALL keep the brand, repository/workspace, model, connection state,
and existing refresh/settings/density controls discoverable.

The header SHALL expose a direct new-session action that invokes the same
confirmation and session-reset behavior as the existing new-session control.
There SHALL be no decorative action without a real handler.

Token, cache, cost, and other live telemetry SHALL use the existing overflow
strategy: high-value values remain inline when space permits and trailing values
move into the accessible overflow disclosure. Long repository/model values SHALL
ellipsize without forcing horizontal scrolling.

### FR-4 — Transcript reading hierarchy

The transcript SHALL prioritize assistant prose over operational chrome:

- assistant text remains an open reading surface;
- user prompts remain compact, right-aligned cards;
- thinking remains a quiet collapsible block;
- consecutive tool calls remain grouped and collapsed by density settings;
- completed tools use a restrained success cue, running tools use the accent,
  and failed tools use the danger cue;
- tool output remains expandable and bounded by the existing preview limits.

The adaptation SHALL not introduce colored glow halos, heavy left stripes, or a
permanent right-side terminal pane.

### FR-5 — Composer priority

The composer SHALL remain centered within the transcript reading width and span
available content width. The text input SHALL be the dominant element, with a
clear focus state and the existing resize/autosize behavior.

Send, Stop, and the current permission mode SHALL remain direct controls. Lower-
frequency actions (compact, delivery mode, improve/review, session modal, and
new-session fallback) SHALL remain grouped behind the existing overflow control
where the responsive layout requires it.

The composer SHALL retain image attachment gating, slash-command autocomplete,
keyboard send/newline behavior, and the context indicator.

### FR-6 — Visual adaptation

The reference's visual cues SHALL be represented through spacing, grouping,
subtle borders, muted metadata, and clear active states. The existing dark theme
remains the default. The existing paperlike theme SHALL be the light visual
option for users who want the reference's lighter presentation.

No new font, icon, CSS framework, or runtime dependency SHALL be introduced.

### FR-7 — Responsive and accessibility behavior

All newly exposed actions SHALL have an accessible name, keyboard focus state,
and a minimum existing target size. Existing focus return, Escape handling,
scrims, and aria-expanded/aria-controls state SHALL continue to work.

Crossing wide/mid/narrow breakpoints SHALL not leave a hidden panel covering the
transcript, strand focus, or cause horizontal page scrolling.

### FR-8 — Compatibility and safety

The adaptation SHALL not change API endpoints, SSE event framing, permission
behavior, workspace validation, or session switching semantics. Dynamic labels
and telemetry SHALL continue to use the existing escaping/safe-rendering paths.

## Data Models

### ShellLayoutState

- `widthMode`: `wide | mid | narrow`
- `workspaceSidebarOpen`: boolean
- `workspaceView`: `workspaces | sessions`
- `workspaceListExpanded`: boolean
- `toolsRailOpen`: boolean
- `toolsWidget`: existing widget identifier or null

Persisted values remain in the existing browser-local keys; no new server state
is required.

### HeaderTelemetry

- `repository`: display string
- `model`: display string
- `connection`: existing connection state
- `git`: existing branch/status summary
- `thinking`: current thinking level
- `tokens`: input/output summary when available
- `cache`: read/write/hit summary when available
- `cost`: numeric cost when available
- `ide`: hosting IDE name or standalone marker

Any unavailable value renders as the existing neutral placeholder and never
breaks layout.

### NavigationRow

- `label`: escaped workspace name or session name/preview
- `metadata`: escaped path/count/date/size summary
- `active`: boolean
- `action`: existing switch/resume/remove/new behavior

## Edge Cases

- No workspaces: show the explicit empty/error state and do not collapse it as
  though data were loaded.
- Only one workspace: retain the current compact workspace behavior and keep the
  session list usable.
- No sessions or no filter matches: show the existing explicit empty message.
- IDE/no-switch mode: hide workspace controls and preserve session navigation.
- Missing health or stats: retain labels/placeholders and keep actions usable.
- Very long paths, model names, session names, or telemetry: ellipsize within
  their region and expose the full value through the existing title/ARIA text.
- A wide-to-mid/narrow resize: close or convert overlays using the existing
  breakpoint rules; never leave the wide sidebar covering the viewport.
- Disconnected/reconnecting state: retain the status dot/activity semantics while
  header telemetry degrades independently.
- Existing persisted rail/sidebar/theme state: honor it and migrate nothing
  beyond current compatibility behavior.
