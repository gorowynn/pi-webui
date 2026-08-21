# Specification: Contextual Git Review Workspace

## 1. Purpose and Boundaries

This specification turns the approved Phase 1 plan into a behavioral contract for
an incremental workbench adaptation. The first release centers on repository
changes and diffs; shell context, session orientation, tool links, responsive pane
behavior, and composer polish support that workflow.

The feature must use pi-webui's existing Git, diff, rail, session, permission, and
workspace concepts. It must not introduce cloud pull-request integration, voice
input, or a browser code editor.

## 2. User Stories

### US-1: Repository context

As a user, I want to see the active repository, branch, and change summary in the
shell so that I understand what the agent is operating on before reviewing output.

### US-2: Review changed files

As a user, I want to open a Changes surface and select a changed file so that I can
review its diff without leaving the conversation.

### US-3: Safe diff review

As a user, I want diffs to be clearly read-only by default so that inspection never
silently mutates files, while existing confirmation-gated actions remain available
where appropriate.

### US-4: Connect tools to changes

As a user, I want a tool activity item to identify relevant files or open their
review entry so that I can follow the relationship between an agent action and a
repository change.

### US-5: Understand sessions

As a user, I want workspace and session rows to expose useful state and recency so
that I can choose the right session without opening each one.

### US-6: Use the workbench on narrow screens

As a narrow-screen user, I want one active surface at a time so that chat, changes,
and tasks remain usable without squeezed columns or clipped controls.

### US-7: Compose with confidence

As a user, I want the composer to remain prominent and its frequent actions easy
to reach while lower-frequency actions stay organized.

### US-8: Navigate accessibly and safely

As a keyboard, screen-reader, or permission-conscious user, I want the new surface
to preserve focus semantics, accessible names, path containment, and safeguard
behavior.

## 3. Functional Requirements

### Repository and shell context

- **FR-1 (PG-1):** The shell SHALL expose the active repository name/path in a
  compact context region; the full path SHALL remain available through an
  accessible name or equivalent disclosure.
- **FR-2 (PG-1):** When Git metadata is available, the shell SHALL expose the
  current branch (including a clear detached-head representation) and a compact
  change summary for staged, unstaged, and untracked files.
- **FR-3 (PG-1):** When the repository is clean, unavailable, or loading, the shell
  SHALL show an explicit state rather than stale or blank branch/change data.
- **FR-4 (PG-1):** Activating the change summary SHALL open or focus the contextual
  Changes surface without changing the active session or workspace.

### Changes and diff surface

- **FR-5 (PG-1):** The Changes surface SHALL be hosted by the existing workspace
  tools/rail surface and SHALL not create a second persistent navigation system.
- **FR-6 (PG-1):** The surface SHALL provide a review summary and a changed-file
  list with status labels for added, modified, deleted, renamed, untracked, and
  binary/unavailable files where those states are known.
- **FR-7 (PG-1):** Selecting a file SHALL render its current diff in the same
  contextual surface and SHALL identify the file path and status.
- **FR-8 (PG-1):** The surface SHALL provide an explicit empty state when there are
  no changes and an explicit selection state when no file is selected.
- **FR-9 (PG-1):** The diff view SHALL be read-only by default. Existing editable
  diff and permission-confirmation flows SHALL remain the only route for applying
  an agent proposal or user edit.
- **FR-10 (PG-1):** Existing commit, push, revert, reset, and discard operations
  SHALL remain confirmation-gated and SHALL continue to use the existing Git
  mutation contracts.
- **FR-11 (PG-1):** The surface SHALL provide a refresh/reconcile action or
  equivalent automatic refresh state. If the selected file disappears, the UI
  SHALL clear the selection and explain why.
- **FR-12 (PG-1):** Diff failures, binary files, deleted files, oversized diffs,
  and stale snapshots SHALL render bounded explanatory states rather than blank
  panels or uncaught errors.
- **FR-13 (PG-1):** The changed-file list and diff selection SHALL be scoped to the
  active canonical workspace and SHALL never trust a client-supplied path that is
  not validated by the existing Git/server boundary.

### Session and workspace orientation

- **FR-14 (PG-2):** Workspace rows SHALL retain their current switch behavior and
  SHALL add only compact, useful metadata such as branch, change count, or active
  status when available.
- **FR-15 (PG-2):** Session rows SHALL retain name/preview and recency information
  while exposing a bounded state indicator for the active, running, idle, or
  unavailable session state when known.
- **FR-16 (PG-2):** Metadata SHALL truncate safely, preserve the full value through
  an accessible label/title, and SHALL not make rows oversized cards.
- **FR-17 (PG-2):** Switching workspace or session SHALL reset or reconcile review
  context so a file/diff from the previous context cannot be displayed as if it
  belonged to the new one.

### Tool timeline links

- **FR-18 (PG-3):** Tool activity SHALL remain grouped and compact by default.
- **FR-19 (PG-3):** When a tool event exposes a safe, workspace-relative file
  target, the activity item MAY expose a link/action to the corresponding review
  entry; items without a reliable target SHALL not show a misleading link.
- **FR-20 (PG-3):** Any new tool action SHALL have an accessible name and SHALL
  preserve the existing expand/collapse, error, duration, and streaming states.
- **FR-21 (PG-3):** Tool links SHALL not bypass path validation, permissions, or the
  existing diff confirmation flow.

### Responsive pane behavior

- **FR-22 (PG-4):** On wide screens, chat and the contextual review panel SHALL be
  usable together without forcing the transcript or composer beyond its readable
  width.
- **FR-23 (PG-4):** On mid and narrow screens, the UI SHALL present one active
  surface at a time using the existing drawer/bottom-sheet semantics. The active
  surface set SHALL include Chat, Changes, Usage, and Tasks where those widgets
  exist.
- **FR-24 (PG-4):** Entering a drawer-mode viewport SHALL not leave a persisted
  desktop sidebar covering most of the screen; explicitly opening the drawer again
  SHALL remain possible.
- **FR-25 (PG-4):** Narrow composer controls SHALL wrap or move into the existing
  overflow affordance; no action or text field may be clipped by a rail or create
  horizontal page scrolling.
- **FR-26 (PG-4):** Opening, closing, or switching the active pane SHALL restore
  focus to its invoking control and SHALL support Escape where the existing surface
  contract requires it.

### Composer and visual hierarchy

- **FR-27 (PG-5):** The composer SHALL remain the primary action area, centered and
  bounded on wide screens while retaining safe-area padding on supported narrow
  screens.
- **FR-28 (PG-5):** Frequent actions (permission mode, image attachment, send/stop)
  SHALL remain immediately visible; lower-frequency actions MAY remain behind the
  existing overflow control.
- **FR-29 (PG-5):** The context meter, permission-mode chip, image support, Improve
  action, and existing send/stop behavior SHALL remain available and visually
  distinguishable.
- **FR-30 (PG-5):** Any typography or surface treatment changes SHALL preserve the
  terminal-adjacent dark theme, readable code/metadata monospace styling, and
  paperlike-theme contrast goals.

### Accessibility, resilience, and compatibility

- **FR-31 (PG-6):** New controls, tabs, file rows, statuses, and pane triggers SHALL
  expose semantic roles, accessible names, keyboard focus, and selected/expanded
  state where applicable.
- **FR-32 (PG-6):** Updates from polling, SSE, workspace switching, session
  switching, and concurrent Git changes SHALL not leave stale selection, stale
  branch metadata, or duplicate panels.
- **FR-33 (PG-6):** The feature SHALL preserve the existing RPC/API wire contracts,
  CSRF/DNS-rebinding protections, safeguard posture, and no-build asset loading.
- **FR-34 (PG-6):** New state/formatting behavior SHALL have focused automated
  coverage, and the finished feature SHALL pass the existing suite plus a live
  browser review at wide and narrow widths.

## 4. Data Models

These are behavioral shapes, not implementation prescriptions.

### ReviewContext

```text
workspace: {
  name: string,
  canonicalPath: string,
  branch: string | null,
  detached: boolean,
  gitAvailable: boolean
}
summary: {
  staged: number,
  modified: number,
  untracked: number,
  unpushed: number | null,
  clean: boolean
}
revision: string | number | null
updatedAt: string | number | null
```

### ChangedFile

```text
path: string
oldPath: string | null
status: added | modified | deleted | renamed | untracked | binary | unknown
added: number | null
removed: number | null
diffAvailable: boolean
```

### ReviewSelection

```text
path: string
workspaceRevision: string | number | null
status: ChangedFile.status
diffState: loading | ready | empty | binary | stale | error
diffText: string | null
error: string | null
```

### SessionSummary

```text
id: string
name: string
preview: string
updatedAt: string | number | null
size: number | null
messageCount: number | null
state: active | running | idle | unavailable | unknown
workspacePath: string
```

### ToolReviewLink

```text
toolCallId: string | null
path: string
intent: inspect | changed-file | diff | unknown
enabled: boolean
reason: string | null
```

### PaneState

```text
activePane: chat | changes | usage | tasks
railOpen: boolean
selectedFile: string | null
focusReturnTarget: string | null
```

The existing persisted rail contract remains authoritative. Any new pane state
must not create a competing persistence key without a later approved migration.

## 5. Edge Cases and Required Outcomes

- **Clean repository:** Show branch/context and a clear “No changes” state.
- **No Git repository:** Keep chat usable; show “Git unavailable” without hiding
  Usage, Tasks, or Permissions.
- **Detached HEAD or missing branch:** Show a stable detached/unknown label rather
  than an empty header slot.
- **Renamed file:** Show the new path and old path where available; selection must
  use the current path.
- **Deleted file:** Show status and available deletion diff; if unavailable, explain
  that the file no longer exists.
- **Binary or oversized diff:** Show metadata and a bounded unavailable message;
  never freeze the transcript or render unbounded content.
- **Concurrent changes:** Reconcile the snapshot; never apply an action to a stale
  file without the existing confirmation/re-read safeguards.
- **Workspace/session switch:** Clear or revalidate branch, file list, selection,
  and tool links before showing the new context.
- **IDE/no-switch mode:** Hide workspace switching as it does today while keeping
  the active repository context and review surface usable.
- **Narrow resize with an open panel:** Close or transform the panel according to
  the existing drawer/sheet contract and return focus predictably.
- **Permission posture changes:** Keep the composer mode chip and all permission
  decisions synchronized; review actions must not silently elevate posture.
- **Keyboard navigation:** A user can reach the pane trigger, file list, selected
  diff, refresh, and close controls without pointer input.
- **Unavailable metadata:** Loading and error states must not retain values from a
  prior workspace or session.

## 6. Out of Scope

- Remote PR listing, checkout, review submission, or cloud-provider authentication.
- Full browser-based code editing beyond existing editable diff confirmation.
- Voice input, microphone controls, or mobile-native shell redesign.
- Replacing the vanilla UI with React/Vite or splitting the entire monolith as part
  of this feature.
- New Git mutation semantics, new permission modes, or changes to RPC wire keys.

## Approval Gate

This is Phase 2. Upon approval, Phase 3 will define the ordered implementation
chunks and the TiCoder tests that trace to the FR identifiers above. Those tests
should initially fail for behavior that does not yet exist.
