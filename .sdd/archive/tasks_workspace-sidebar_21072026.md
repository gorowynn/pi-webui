# Implementation Plan & Tests — Workspace Sidebar + SDD Rail Relocation

> SDD Phase 3 artifact. Task ordering + TiCoder test suite. **No implementation
> code yet** — written in Phase 4 after this is approved. Approval gate at the end.
>
> Slug: `workspace-sidebar` · Date: `21072026` (21 Jul 2026).
> Builds on [`plan_`](./plan_workspace-sidebar_21072026.md) +
> [`spec_`](./spec_workspace-sidebar_21072026.md).
>
> **✅ Phase 4 complete (2026-07-21)** — all 6 tasks implemented; T1.1–T1.8 unit
> tests green; endpoint + page-load smoke green. Browser-only flows are the
> manual smoke matrix in [`verify_`](./verify_workspace-sidebar_21072026.md).

## Design for testability (the "How", decided here)

The security-critical and bug-prone logic is **server-side & pure**: discovering
workspaces from session storage and validating a switch target. That lives in a
new **`workspaces.js`** CommonJS module exporting two pure-ish functions (fs
reads only, no server/pi/process state), unit-tested with a temp fixture — the
project's existing convention (`test/usage-provider.test.js`, `node:assert`, no
framework, no install).

`server.js` becomes a **thin caller**: `const PI_CWD` → `let PI_CWD` (all current
consumers — `safePath`, `sessionDirFor`, `listSessions`, `startPi` — already read
the live variable, so a reassignment re-binds them with no other change). The
kill/respawn/broadcast glue is side-effectful → validated by smoke test (no
isolatable pure logic). Client UI is DOM wiring → smoke test (no browser harness;
adding one violates zero-build). Every task names its validation type honestly.

## Task List

### Task 1 — Pure workspace logic + unit tests  `[FR-1, FR-2, FR-5]`

Create `workspaces.js`:

- `discoverWorkspaces(sessionsDir, currentCwd)` → `Workspace[]` (scan subdirs of
  `sessionsDir`; for each, read the newest `.jsonl`'s first `{type:"session"}`
  `cwd`; build `{path,name,lastUsed,sessions,active}`; always include
  `realpath(currentCwd)`; dedupe by realpath; `active` = realpath match; sort
  active-first then `lastUsed` desc). Skip folders with no resolvable cwd (EC-1).
- `isKnownWorkspacePath(discovered, candidate)` → `bool` (`realpath(candidate)`
  matches a `discovered[].path`; false for nonexistent/unmatched).

Create `test/workspaces.test.js` (see **TiCoder Test Suite**). **Validation:
unit — T1.1…T1.8 must pass.**

### Task 2 — Server: mutable PI_CWD + endpoints + switch  `[FR-3, FR-4, FR-5, FR-12]`

- `const PI_CWD` → `let PI_CWD`. Add `let deliberateRestart = false;`
- `GET /api/workspaces` → `{ok, current, workspaces: discoverWorkspaces(path.join(AGENT_DIR,"sessions"), PI_CWD)}`.
- `POST /api/workspace` → `readBody`; `isKnownWorkspacePath(discoverWorkspaces(...), body.path)`:
  - false / missing → `400 {ok:false, error}`.
  - true → `switchWorkspace(resolved)` → `200 {ok, workspace}`.
- `switchWorkspace(newCwd)`: `PI_CWD = newCwd; deliberateRestart = true;` then
  tree-kill pi (`taskkill /pid <pid> /T /F` on Windows, `pi.kill("SIGTERM")` on
  POSIX). The existing `pi.on("exit")` handler: if `deliberateRestart` → clear
  it, **skip backoff**, `startPi()` immediately, then `broadcast({source:"server",
  type:"workspace_changed", workspace:newCwd})`. Otherwise → unchanged crash logic.
- **Validation: smoke** (Task-1 unit tests stay green; valid POST→200+broadcast to
  all tabs; bogus path→400; switch mid-stream aborts the run without backoff).

### Task 3 — Client: `workspace_changed` resync  `[FR-4]`

In `es.onmessage`: handle `env.source === "server" && env.type ===
"workspace_changed"` → `setTodos([])`, `setSafeHtml(transcript,"")`,
`toolBlocks.clear()`, re-send `get_state`+`get_messages` (the existing init pair),
then `refreshWorkspaces`/`refreshSessionsSidebar`/`refreshPlanState`. Idempotent
(initiating tab also receives the broadcast — EC-6). **Validation: smoke.**

### Task 4 — Left sidebar `#wsbar`  `[FR-6, FR-7, FR-9, FR-10]`

- `index.html`: `<aside id="wsbar" aria-label="workspaces and sessions">` with a
  Workspaces section, a Sessions section (header + **New** action), and a collapse
  toggle. Empty-state markup.
- `style.css`: `position:fixed; left:0`; `body.ws-on{margin-left:<w>}`;
  `body.ws-on.collapsed` → `display:none` + `margin-left:0`; width `min(260px,30vw)`;
  collapse persisted in `localStorage["pi:wsbar"]`.
- `app.js`: `refreshWorkspaces()` (fetch `/api/workspaces`, render rows, active
  marked, click→`POST /api/workspace`), `refreshSessionsSidebar()` (reuse
  `/api/sessions` + `fmtSessionDate` + `resumeSession`; current marked via
  `curSessionFile`/`pathEq`; **New**→`new_session`), refresh on load +
  `workspace_changed`; empty states ("no sessions yet"). **Validation: smoke.**

### Task 5 — Move SDD rail to the right  `[FR-8, FR-10]`

`style.css` only: `#sddbar{ right:0 }` (drop `left:0`), `body.sdd-on{ margin-right:
46px }`, `body.sdd-on.sdd-open{ margin-right: min(400px,58vw) }`,
`#sddbar{ flex-direction: row-reverse }` (stepper stays rightmost, pane expands
leftward), `.sdd-rail{ border-left … }` (drop `border-right`). **Validation:
smoke** (rail on right edge; click→expands left; badge still absent).

### Task 6 — E2E smoke + verify report  `[all SCs]`

Run the smoke matrix (one check per FR/SC), then write
`verify_workspace-sidebar_21072026.md` mapping each FR → passing test/smoke step.
**Validation: manual smoke matrix green.**

## Dependencies

```
T1 ──▶ T2 ──▶ T3 ──▶ T4
                 ╲
                  └─ (T4 also needs T2's API)
T5  (independent — CSS only; do anytime)
T6  (last; needs T1–T5)
```

## TiCoder Test Suite (unit; `test/workspaces.test.js`)

Plain Node + `node:assert/strict`, `node test/workspaces.test.js`. Fixture: a temp
`sessions/` dir with `--<sanitized-cwd>--` subfolders each holding a `.jsonl`
whose first line is `{"type":"session","id":..,"cwd":<proj>,"timestamp":..}` (the
shape `listSessions` already parses). These express the requirements and
**should currently FAIL** — `workspaces.js` does not exist yet.

- **T1.1 `#FR-1 #FR-2`** current cwd (no folder on disk) is present, `active`, `sessions:0`.
- **T1.2 `#FR-1`** a folder is discovered; `path` == its session's `cwd` (realpath);
  `sessions` == file count; `lastUsed` == newest mtime (>0).
- **T1.3 `#FR-2`** exactly one workspace is `active`, and it realpath-matches `currentCwd`.
- **T1.4 `#EC-1`** a folder whose `.jsonl` has no parseable `{type:"session"}` is skipped.
- **T1.5 `#EC-1`** two folders resolving to the same realpath dedupe to one entry.
- **T1.6 `#FR-2`** ordering is active-first, then `lastUsed` descending.
- **T1.7 `#FR-5`** `isKnownWorkspacePath` returns `true` for a realpath match of a
  discovered workspace.
- **T1.8 `#FR-5`** `isKnownWorkspacePath` returns `false` for an arbitrary /
  nonexistent path (the security gate — rejects pointing pi at an unlisted dir).

Tasks 2–5 carry no unit tests (side-effectful glue / DOM wiring); they are
validated by the Phase-6 smoke matrix, with each smoke step tagged to the FR it
exercises (e.g. "bogus POST → 400" → `#FR-5`; "switch mid-stream aborts" → `#FR-12`).

---

**Phase 3 gate — TiCoder validation loop:** the tests above express your
requirements and **should currently FAIL** (the feature isn't built). Do they
capture the intended behavior? And do you **approve this implementation plan and
test suite to begin coding**? Reply **Yes** to start Phase 4 (Task 1 first), or
**No** with corrections.
