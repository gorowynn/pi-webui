# Verify — Workspace Sidebar + SDD Rail Relocation

> SDD Phase 4 outcome. Maps each FR/SC to its passing validation (unit test or
> smoke step). Slug: `workspace-sidebar` · Date: `21072026` (21 Jul 2026).
> Builds on [`plan_`](./plan_workspace-sidebar_21072026.md) →
> [`spec_`](./spec_workspace-sidebar_21072026.md) →
> [`tasks_`](./tasks_workspace-sidebar_21072026.md).

## Outcome

All 6 tasks implemented; the feature ships. Task 1 unit tests (T1.1–T1.8) are
green; server endpoints + page load are smoke-green. Browser-only flows
(multi-tab broadcast, click-to-switch, collapse persistence, mid-stream abort)
form the **manual smoke matrix** below — the zero-build invariant means no
headless browser harness, so they are run by hand against `node server.js`.

## Automated validation (reproducible)

| Check | How | Result |
|---|---|---|
| T1.1–T1.8 unit | `node test/workspaces.test.js` | ✅ 8/8 pass |
| Real-data discovery | `discoverWorkspaces` against `~/.pi/agent/sessions` | ✅ 6 workspaces, `pi-webui` active, exactly 1 active, active-first then recency |
| `GET /api/workspaces` | boot `PORT=4399`, fetch | ✅ 200 `{ok,current,workspaces[]}` |
| `POST /api/workspace` bogus | fetch a non-workspace path | ✅ 400 `{ok:false}` (FR-5 gate) |
| DNS-rebinding gate | fetch with `Host: evil.com` | ✅ 403 (`isAllowed` covers the new route) |
| Page + both rails | `GET /` | ✅ `#wsbar` + `#sddbar` + `#ws-open` all served |
| `/api/sessions`, `/api/plan-state` | fetch | ✅ 200 each (non-regression) |
| JS parse | `node --check` server/app/md/workspaces/usage-provider | ✅ all OK |

## FR → validation map

| FR | SC | Validation | Status |
|---|---|---|---|
| FR-1 | SC-1 | T1.1, T1.2 (unit) + real-data discovery | ✅ |
| FR-2 | SC-1 | T1.2, T1.3, T1.6 (unit) | ✅ |
| FR-3 | SC-2 | `switchWorkspace` + `POST` 200 (code); live switch = manual S-2 | ✅ code · ⬜ manual |
| FR-4 | SC-2 | `workspace_changed` resync branch (Task 3); multi-tab = manual S-3 | ✅ code · ⬜ manual |
| FR-5 | SC-5 | T1.7, T1.8 (unit) + bogus-POST 400 smoke | ✅ |
| FR-6 | SC-3 | `#wsbar` markup + `refreshWorkspaces` (boot serves it) | ✅ code · ⬜ render |
| FR-7 | SC-3 | `refreshSessionsSidebar` reuses `/api/sessions` + `resumeSession` | ✅ code · ⬜ manual |
| FR-8 | SC-4 | `#sddbar` CSS `right:0`/`row-reverse` (Task 5, pre-existing) | ✅ |
| FR-9 | SC-6 | empty states "no sessions yet" / "no workspaces" | ✅ code · ⬜ manual |
| FR-10 | SC-7 | collapse/expand + `localStorage["pi:wsbar"]` + narrow `@media` | ✅ code · ⬜ manual |
| FR-11 | — | footer Sessions modal + `New` untouched (non-regression) | ✅ (no change) |
| FR-12 | SC-2 | `deliberateRestart` skips backoff (code); mid-stream = manual S-5 | ✅ code · ⬜ manual |

## Manual smoke matrix (run against `node server.js` in a browser)

- [ ] **S-1** Left sidebar lists all known workspaces; active one marked; recency order.
- [ ] **S-2** Click a non-active workspace → pi respawns; transcript / session list / SDD rail reflect the new project.
- [ ] **S-3** Multi-tab: switch in tab A → tab B also resyncs to the same project.
- [ ] **S-4** Sessions section: click a row resumes (no footer modal); current marked; `＋` starts a fresh session.
- [ ] **S-5** Switch while pi is mid-stream → run aborts, no crash-backoff delay, clean resync.
- [ ] **S-6** Collapse `≪` → sidebar hides; launcher `≫` re-opens; state survives reload (`localStorage["pi:wsbar"]`).
- [ ] **S-7** Brand-new project (0 sessions, no `.sdd`) → "no sessions yet", SDD rail hidden, no broken UI.
- [ ] **S-8** Narrow screen (<720px) → left sidebar auto-collapses; transcript stays usable.

## Design notes

- **Switch design (FR-3/FR-12):** `POST /api/workspace` validates via
  `isKnownWorkspacePath` (realpath must match a discovered workspace — never an
  arbitrary path), then `switchWorkspace` mutates the now-`let` `PI_CWD`,
  tree-kills pi (`taskkill /T /F` on Windows / `SIGTERM` on POSIX), and the
  `pi.on("exit")` handler respawns **immediately** in the new cwd (skipping crash
  backoff) and broadcasts `{source:"server", type:"workspace_changed"}` to every
  SSE client. `safePath` / `sessionDirFor` / `listSessions` re-derive against the
  new `PI_CWD` because they all read the live variable — no other change needed.
  The respawned pi's stdin is writable at once, so the client's resync
  `get_state`/`get_messages` buffer in the pipe until pi boots (no command queue
  needed — `_piQ` is SSE-backpressure only).
- **No new dependencies; zero-build intact.** Plain edits to `server.js` /
  `app.js` / `style.css` / `index.html` + new `workspaces.js` (CommonJS) +
  `test/workspaces.test.js` (`node:assert`, no framework). Discovery recovers each
  project root from the `.jsonl` content, **not** the encoded folder name, so it
  can't drift from pi's own encoding.
- **Pre-existing false positives (not this feature's):** 5
  `ast-grep:no-case-declarations-js` findings at `app.js` L3040/3041/3055/3067/3074
  flag `const`/`let` inside the nested `if`/`forEach`/`then` blocks of
  `case "tool_execution_end"` — valid JS in proper block scope (the rule doesn't
  even flag the actual direct case-level decls `const w`/`let t` at 3010/3012).
  `node --check` and the TypeScript LSP both pass clean; the rule misfires on
  descendants. Left untouched — churning correct code to satisfy a misfiring rule
  is the wrong trade; revisit the rule, not the code.

## Files

| File | Change |
|---|---|
| `workspaces.js` (new) | `discoverWorkspaces` + `isKnownWorkspacePath` (FR-1/2/5). |
| `test/workspaces.test.js` (new) | T1.1–T1.8 (`node:assert`, temp fixture). |
| `server.js` | `let PI_CWD`; `deliberateRestart`; exit-handler respawn+broadcast; `switchWorkspace`; `GET /api/workspaces`; `POST /api/workspace`; `require("./workspaces.js")`. |
| `app.js` | `workspace_changed` resync branch; `refreshWorkspaces` / `refreshSessionsSidebar` / `switchWorkspace` / `collapseWsbar` / `expandWsbar` + `initWsbar`; onopen + init-state hooks. |
| `index.html` | `<aside id="wsbar">` (workspaces + sessions sections) + `#ws-open` edge launcher. |
| `style.css` | `#wsbar` / `body.ws-on` / `.ws-*` block (mirrors `#sddbar`, opposite edge); stale sddbar "left edge" comment → "right edge"; narrow `@media` auto-collapse. |
