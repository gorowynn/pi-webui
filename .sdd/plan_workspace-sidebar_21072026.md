# Plan — Workspace Sidebar + SDD Rail Relocation

> SDD Phase 1 artifact. Defines the **What** and **Why** only — no
> implementation, no tasks. Approval gate at the end.
>
> Slug: `workspace-sidebar` · Date: `21072026` (21 Jul 2026).
> Followed by `spec_`, `tasks_`, `verify_` artifacts sharing this slug+date.

## Problem Statement

pi-webui currently binds to **one** project directory (`PI_CWD`, fixed at server
start) and exposes session history only inside a transient **modal** opened from
the footer. To work across several projects a user must restart the server with a
different `PI_CWD`, and to resume a past conversation they must open a modal,
scan a flat list, and lose the view the moment it closes.

Meanwhile the SDD phase rail just added sits on the **left**, which is the
natural home for primary navigation (project switching + history). The right side
is a better fit for the SDD rail, which is contextual to the active run rather
than top-level navigation.

We need a persistent **left sidebar** that is the home for *where am I working*
(workspaces) and *what have I done here* (session history), and the SDD rail
moved to the **right** so the two rails flank the transcript without competing
for the same edge.

## Business Goals

1. **One-click project switching.** Move between project roots without restarting
   the server or editing env vars — pi re-points at the chosen directory and its
   sessions/SDD artifacts reload automatically.
2. **Always-visible history.** Session history for the active workspace lives in
   the chrome, not a disposable modal — resuming a conversation is a single click
   from anywhere.
3. **Zero-config workspace discovery.** No manual list to maintain: every project
   pi has ever run in is discovered from pi's own per-project session storage.
4. **Clear edge semantics.** Left = navigation (workspaces + sessions); right =
   run context (SDD phase rail). The two never share an edge.
5. **Preserve the minimal-dependency / zero-build invariant.** No new runtime
   deps, no build step; plain DOM + Node built-ins, exactly as today.

## Constraints

- **Hard: zero-build.** No bundler/transpiler, no `npm install` at runtime. Plain
  edits to `server.js` / `app.js` / `style.css` / `index.html` + refresh.
- **Hard: localhost security model.** No new network surface; any new endpoint
  keeps the existing CSRF + DNS-rebinding gate and path sandboxing (`safePath`).
  Workspace switching must not let the browser read/execute outside an allowed
  project root.
- **One pi process.** The bridge runs a single shared `pi --mode rpc` subprocess.
  Switching workspace **respawns** that one process in the new cwd (it does not
  spawn a second parallel agent). All tabs share the switch (existing one-process
  model, per GOTCHAS #9).
- **Mutable `PI_CWD`.** Today `PI_CWD` is a module-load `const` feeding
  `startPi()`, `sessionDirFor()`, and `safePath()`. Switching workspaces requires
  it to become live-mutable so all three re-derive against the new root.
- **Session storage layout is the source of truth for the workspace list.**
  `AGENT_DIR/sessions/--<sanitized-realpath-cwd>--/` holds one folder per project
  root; the real path is recoverable from each folder's `.jsonl` `session.cwd`
  entry (already parsed by `listSessions`). The current `PI_CWD` is always
  included even if it has no sessions folder yet.
- **Layout collision-free.** Nothing in the current app floats on the left *or*
  right edges in-flow (verified: floating elements are `#jump-bottom` /
  `.toast` / `#settings` / `#modal`, all right/centered). Both rails can use the
  same `position:fixed` + `body` margin pattern the SDD rail already uses, one
  per edge.
- **No behavior loss.** The existing Sessions modal, `switch_session`, and
  `new_session` flows must keep working; the left sidebar is an *additional*
  surface, not a replacement (the modal can stay or fold into the sidebar —
  decided in the spec).

## Success Criteria

- [ ] **SC-1** A persistent left sidebar lists all workspaces (project roots)
      known to pi, sourced automatically from session storage, with the active
      one marked. No manual configuration is required to populate it.
- [ ] **SC-2** Clicking a workspace switches the active project: pi respawns in
      the chosen cwd, and the transcript, session list, and SDD rail all reflect
      the new project. All open tabs converge on the switch.
- [ ] **SC-3** The left sidebar lists the active workspace's session history
      (preview, message count, recency) and a single click resumes a session —
      without opening the footer modal.
- [ ] **SC-4** The SDD phase rail renders on the **right** edge (narrow stepper;
      expands to its doc on click), behaving exactly as it does today, and the
      topbar plan badge is still gone.
- [ ] **SC-5** Switching workspaces does not let the browser access files outside
      the chosen project root (`safePath` re-binds to the new cwd; no traversal).
- [ ] **SC-6** On a project root with no sessions and no `.sdd` artifacts, the
      left sidebar shows a sensible empty state and the right SDD rail hides —
      no broken/blank UI.
- [ ] **SC-7** Both rails collapse/hide gracefully so the transcript stays usable
      on narrow screens; the zero-build invariant is intact (no deps added).

## Out of Scope (this effort)

- True **parallel** per-tab sessions/workspaces (conflicts with the one-process
  bridge; deferred — same decision as the roadmap).
- Workspace **rename / pin / reorder** — discovery order (recency) is enough for
  v1; curation can come later.
- Remote/LAN workspaces — the localhost-only security model is unchanged.
- Migrating the existing footer **Sessions modal** away (it stays functional;
  whether the left sidebar fully supersedes it is a spec decision, not a goal).

---

**Phase 1 gate:** Does this plan align with your goals? Reply **Yes** to proceed
to the detailed specification (Phase 2), or **No** with corrections.
