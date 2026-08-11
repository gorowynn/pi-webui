# Specification — Workspace Sidebar + SDD Rail Relocation

> SDD Phase 2 artifact. Functional contract + data models + edge cases. **No
> implementation, no task ordering** (that is Phase 3). Approval gate at the end.
>
> Slug: `workspace-sidebar` · Date: `21072026` (21 Jul 2026).
> Builds on [`plan_workspace-sidebar_21072026.md`](./plan_workspace-sidebar_21072026.md).

## User Stories

- **US-1 (switch project):** As a developer working across several repos, I want
  to see every project pi has run in and switch to one with a single click, so I
  don't have to restart the server or edit env vars.
- **US-2 (resume history):** As a developer mid-task, I want my current project's
  session history visible at all times in the chrome, so I can resume a past
  conversation without opening a modal and losing my view.
- **US-3 (run context on the right):** As an SDD practitioner, I want the phase
  rail on the right edge so the left edge is reserved for navigation and the two
  never compete for the same space.
- **US-4 (multi-tab consistency):** As a multi-tab user, I want a workspace
  switch in one tab to take every tab to the same project, so the shared agent
  and all views stay coherent.

## Functional Requirements

> Each FR is tagged to a Success Criterion from the plan so nothing silently
> vanishes between spec and tests.

### Workspaces — discovery & data

- **FR-1 (SC-1)** `GET /api/workspaces` returns the auto-discovered workspace
  list. Source: scan `AGENT_DIR/sessions/` for directories; for each, resolve the
  real project root by reading the newest `.jsonl`'s first `{type:"session"}`
  entry's `cwd` (the field `listSessions` already parses). The current `PI_CWD`
  (realpath-resolved) is **always** included even with no session folder.
- **FR-2 (SC-1)** Each workspace object carries: `path` (absolute realpath),
  `name` (basename, fallback to the tail), `lastUsed` (newest `.jsonl` mtime, 0
  if none), `sessions` (`.jsonl` count), `active` (realpath === current `PI_CWD`).
  Order: active first, then `lastUsed` desc.

### Workspaces — switching

- **FR-3 (SC-2)** `POST /api/workspace { path }` switches the active project.
  The server realpath-resolves `path` and **rejects** anything not exactly
  matching a discovered workspace (→ `400`). On accept: set `PI_CWD` (now
  mutable), kill the running pi, call `startPi()`, and `broadcast` a
  `{source:"server", type:"workspace_changed", workspace}` SSE event to **all**
  clients. Returns `{ok, workspace}`.
- **FR-4 (SC-2)** On receiving `workspace_changed`, every tab clears the
  transcript, `toolBlocks`, and todos, then re-runs the init sequence
  (`get_state` + `get_messages`) against the respawned pi, and refreshes the
  workspace list, session list, and plan-state.
- **FR-5 (SC-5)** `/api/workspace` accepts **only** realpath-matches of a
  discovered workspace — never an arbitrary path. After a switch, `safePath`,
  `sessionDirFor`, and `listSessions` all re-derive against the new `PI_CWD`, so
  file read/write and session enumeration stay sandboxed to the chosen root.
- **FR-12 (SC-2)** A switch while pi is mid-stream kills pi (aborts the run).
  A **deliberate** switch resets the crash-loop backoff counter (it is not a
  crash), so it does not trigger escalating restart delays.

### Left sidebar — UI

- **FR-6 (SC-3)** A persistent left sidebar (`#wsbar`) renders two stacked
  sections: **Workspaces** (FR-2 list) and **Sessions** (FR-7 list). The active
  workspace and the current session are each visually marked.
- **FR-7 (SC-3)** The Sessions section lists the active workspace's history from
  `GET /api/sessions` (preview, message count, recency via `fmtSessionDate`).
  Clicking a row resumes it (clear transcript + `switch_session`) **without** the
  footer modal; a **New** action starts a fresh session (`new_session`).
- **FR-9 (SC-6)** Empty states: a workspace with 0 sessions shows "no sessions
  yet"; a project with no `.sdd` set hides the SDD rail (existing behavior).
- **FR-10 (SC-7)** Both sidebars are collapsible; collapse state persists per
  rail in `localStorage`. On narrow screens they degrade (hide or collapse)
  without breaking the transcript. No new runtime dependencies.

### Right SDD rail — relocation

- **FR-8 (SC-4)** The SDD phase rail moves from the left edge to the **right**:
  `position:fixed; right:0`, `body.sdd-on`/`.sdd-open` switch from `margin-left`
  to `margin-right`, the rail's divider moves from `border-right` to
  `border-left`, and the pane expands leftward (`flex-direction: row-reverse` so
  the stepper stays at the rightmost edge). Narrow-by-default → click a reached
  phase → expand to its doc → click again/`×` to collapse. The topbar plan badge
  stays removed.

### Non-regression

- **FR-11** The existing footer **Sessions** modal (`showSessions`) and **New**
  button keep working unchanged; the left sidebar is an additional surface, not
  a replacement.

## Data Models

```text
// GET /api/workspaces  →  { ok, workspaces: Workspace[], current: string }
Workspace = {
  path:      string,   // absolute, realpath-resolved project root
  name:      string,   // basename(path); fallback to path tail
  lastUsed:  number,   // mtimeMs of newest session .jsonl (0 if none)
  sessions:  number,   // count of .jsonl files for this workspace
  active:    boolean   // realpath === current PI_CWD
}

// GET /api/sessions  →  { ok, sessions: Session[] }   (unchanged, existing)
Session = { path, id, when, cwd, preview, messages, mtime }

// POST /api/workspace
Request  = { path: string }                       // a workspace.path to switch to
Response = { ok: true, workspace: string }
         | { ok: false, error: string }            // 400 when not a known workspace

// SSE server-originated event (source !== "pi"); fanned out via broadcast()
SSE = { source: "server", type: "workspace_changed", workspace: string }
```

## Edge Cases

- **EC-1** A discovered session folder whose newest `.jsonl` has no parseable
  `{type:"session"}` entry (can't recover `cwd`) → skip that folder. Dedupe
  folders that resolve to the same realpath.
- **EC-2** Current `PI_CWD` has no session folder yet (brand-new project) →
  included as the active workspace with `sessions: 0`, `lastUsed: 0`.
- **EC-3** A posted `path` that no longer exists on disk or isn't a discovered
  workspace → `400 { ok:false, error }`, `PI_CWD` unchanged.
- **EC-4** Switch while pi is streaming → kill pi (abort); respawn in new cwd;
  client resync. No crash-loop backoff increment (deliberate switch).
- **EC-5** Only one workspace exists (the current project) → list has one entry,
  marked active; switching is a no-op/disabled.
- **EC-6** Multi-tab: the initiating tab's `POST` also receives the broadcast →
  resync is idempotent (clearing an already-cleared transcript + re-init is safe).
- **EC-7** Path form drift (Windows `\` vs `/`, case) → active/current matching
  uses the existing slash/case-agnostic `pathEq`; server validation uses
  `fs.realpathSync` (canonical form).
- **EC-8** Left sidebar collapse: when collapsed, `body` loses its left margin
  and the sidebar is `display:none` (out of the a11y tree). Right rail collapse
  is independent.
- **EC-9** A workspace switch changes which `.sdd` set is "active" →
  `refreshPlanState` re-runs as part of the resync, so the right rail reflects
  the new project's SDD phase (or hides).

---

**Phase 2 gate:** Is this specification complete and accurate? Reply **Yes** to
proceed to the implementation plan + TiCoder test suite (Phase 3), or **No** with
corrections.
