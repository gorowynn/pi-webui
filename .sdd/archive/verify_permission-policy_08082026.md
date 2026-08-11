# Verification Report — Permission Policy & Approval Broker (U6 + modes)

> SDD Phase 4 terminal artifact. Maps every FR to its passing test/evidence.
>
> Slug: `permission-policy` · Date: `08082026` (8–10 Aug 2026).
> Builds on [`plan_`](./plan_permission-policy_08082026.md) +
> [`spec_`](./spec_permission-policy_08082026.md) +
> [`tasks_`](./tasks_permission-policy_08082026.md).

## Outcome

**All 12 implementation chunks `[x]`; C12 (regression + docs) closed 2026-08-10.**
New test suites: `policy-engine` (45), `bash-classifier` (8), `broker` (6),
`safeguard-contract` (9), `permissions-api` (8), `permission-ux` (12),
`permissions-ux` (7) — **95 new assertions**, plus the JetBrains gradle `test`
task (4/4, BUILD SUCCESSFUL on WebStorm JBR 21). Full `node test/*.test.js`
suite green (only the pre-existing environmental `rpc-sse` excluded — it
requires a booted server by design). `node --check` clean on all edited JS;
Kotlin compiles; `git diff --check` clean.

## FR → Evidence map

| FR | Test(s) / evidence |
|---|---|
| FR-1 engine module | policy-engine C1 (CJS/jiti-safe, pure) |
| FR-2 provenance | policy-engine C1 (verdict shape + layer attribution); safeguard-contract (setStatus context) |
| FR-3 precedence | policy-engine C1 (lookup order, tiers, grantability) |
| FR-4 layers | policy-engine C2 (merge, tighten-only, workspace mode) |
| FR-5 v2 config | policy-engine C2 (v1 migration, validateConfig) |
| FR-6 canonical paths | policy-engine C3 (realpath injection, containment, layer drop) |
| FR-7 sensitive paths | policy-engine C3 (all path tools, deny-wins, grant-proof) |
| FR-8/9/10/11 bash | bash-classifier (8); safeguard-contract config audits; **live**: 3 bypasses gate.allow:false even vs stale config |
| FR-12/13 modes | policy-engine C5-modes (applyMode matrix); safeguard-contract (yolo never persisted) |
| FR-14 yolo | safeguard-contract (session scoping, confirm, commands) |
| FR-15 headless | safeguard-contract (nonInteractive branch) |
| FR-16 coordination exempt | policy-engine C5 (COORD_TOOLS); safeguard-contract |
| FR-17 mode selector | permissions-ux (settings select, PUT revision, yolo command) |
| FR-18/19/20 broker | broker (6); **live e2e**: register → first-wins 410 → clear |
| FR-21 snapshot replay | permissions-api (pendingApprovals); permission-ux (re-render path) |
| FR-22 ack-before-close | permission-ux (state-machine sims; watchdog); **live**: broadcast observed on SSE |
| FR-23 Esc/backdrop=Deny | permission-ux (dismissal gate) |
| FR-24 marker/stale | permissions-api (410 paths); permission-ux (UI stays/close per reason); **live**: wrong-marker 410 |
| FR-25 marker + map | permission-ux (marker shape, 5 enums, toolArgs map, pendingToolArgs) |
| FR-26 in-card surface | permission-ux (placement, mandatory-ask set, diff, sheet via body.w-narrow) |
| FR-27 ask ordering | permission-ux (ask flow untouched) |
| FR-28 receipts | permission-ux (≤50 ring) |
| FR-29..36 page | permissions-ux helpers (5) + wiring audits (2); **live**: GET/PUT/409/400/explain round trip |
| FR-37 endpoints | permissions-api (6 endpoints, CSRF, body cap, atomic writes) |
| FR-38/39/40/41 JetBrains | gradle WorkspaceContainmentTest (4); DiffReviewEditor changes compile; conflict flag + mode badge wired |
| FR-42 single gate | safeguard-contract (engine resolve/applyMode/mergeLayers only) |
| FR-43/44 regression | full suite + the FR-44 set re-run in C12 |

## Known issues / notes

- **rpc-sse.test.js** remains environmental (needs `PORT=4401 node server.js`).
- The JetBrains gradle build requires a JVM ≥17 (`JAVA_HOME`); the machine
  default is JDK 11 — use an IDE JBR (WebStorm 2025.3.2 = JDK 21).
- Tool-call handler complexity advisories (cyclomatic/fan-out) carried from the
  v1 monolith — a future refactor could split `safeguard.ts`'s `tool_call`
  handler, but the SDD gate is the behavior, not the metric.
- Manual smoke matrix (pending browser spot-checks): auto-approve skips
  ordinary asks but still prompts on sensitive paths; read-only blocks a write
  with a notify and no prompt; yolo confirm-gate + zero prompts + gone after a
  session restart; reload mid-approval replays the request; two-tab
  first-wins; Esc=Deny; JetBrains diff shows the mode + denies on close.
