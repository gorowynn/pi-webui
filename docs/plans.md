# Implementation Plans

> Concrete build plans for the top-ranked optimization items. Subordinate to
> [`roadmap.md`](roadmap.md) (the *what*) — this holds the *how* for items
> actively being built. Retire a section here when the work lands in
> [`../CHANGELOG.md`](../CHANGELOG.md) and ticks off in
> [`../AGENTS.md`](../AGENTS.md).

## O3 — Cache-stable prompt audit (= roadmap E1)

**Goal:** make every `before_agent_start` system-prompt injection byte-constant
across turns, so the provider's prompt cache isn't busted every turn. Provider
caching (Anthropic/Gemini) rewards a stable prefix; any per-turn change to the
injected text discards the cached prefix → re-billed tokens.

> **Status (2026-06-24): instrumentation shipped.** The per-turn `[O3]`
> cache logger is live in `app.js` — `awaitingTurnStats` is armed at
> `agent_end` and the `sb-stats` handler prints
> `[O3] turn-end: input=… cacheRead=… cacheWrite=… cacheHit=N%`. Run a steady
> multi-turn conversation with an active todo list → read those console lines
> as the **baseline**. Then apply the `discipline.ts` fix and re-run. If the
> baseline shows `cacheRead ≈ 0` across turns, the cache does not reach the
> extension tail → **O3 is a no-op**; close it and move to O1.

### Current state (the finding)

Two handlers inject into `event.systemPrompt`:

- `extensions/pi_minimal_webui/ponytail.ts:97-102` — injects
  `getPonytailInstructions(currentMode)`: a **constant string per mode**. Mode
  only changes via the `/ponytail` command, never mid-turn. **Cache-safe ✓.**
- `extensions/pi_minimal_webui/discipline.ts:84-118` — injects a nudge built
  from live `getTodos()` state. Three branches:
  1. *list active, unfinished* → embeds live ids (`#1, #2`), counts
     (`X started`, `Y open`). **Changes every turn while a list is active —
     i.e. most of the time. Cache-busting ✗.**
  2. *list active, all finished* → "call action:clear". State-dependent but
     stable within that state.
  3. *no list + fresh prompt* → generic reminder. **Static ✓.**

Branch 1 is the culprit. It duplicates information the agent already gets from
two other sources: the `todo` tool's own return value (`todo.ts summarize()`
returns the live list + flags) and discipline's **hard `tool_call` gate**
(`discipline.ts` second layer) which enforces the invariant mid-turn. So the
soft nudge does not need to carry the live ids — it only needs to remind the
agent of the *rhythm*.

### The change

In `discipline.ts`, replace branch 1's dynamic nudge with a **constant** string
that never references live state:

```ts
// branch 1: list active, unfinished
nudge =
  "Todo list active. Keep it current with action:\"update\" as you work — " +
  "one started at a time, flip to finished when done.";
```

Leave branch 2 and branch 3 as-is (already stable per state). The hard gate
keeps enforcing the real invariant; the soft nudge is now just a constant
reminder.

### Verify (A/B run)

The instrumentation above *is* the measurement. Baseline → apply the
`discipline.ts` fix → compare the `cacheHit%`. Remove the `O3-MEASUREMENT` block
from `app.js` once decided.

### Self-check

Across two turns with *different* todo contents, the injected suffix must be
byte-identical while the list is active. Add a temporary `console.log` of the
final `systemPrompt` suffix (or a `before_agent_start` debug) and eyeball it,
then remove the log.

### Risks / ceilings

- **No-op if cache doesn't reach the tail** — that's why "verify the cache
  extends here" is step one, not an afterthought.
- The static nudge loses the "you have #3, #5 open" specificity. Acceptable:
  the agent can call the `todo` tool to read the live list, and the hard gate
  still blocks drift. Net quality is unchanged; cost drops.

### Rollback

`git revert` the discipline.ts nudge change.

---

## O5 — Subagent-based tier routing (= roadmap O5; was D1 "per-turn routing")

> **Status (2026-06-24): REVERTED the per-turn approach; SHIPPED subagents.**
> The per-message `set_model` override below was built, hit a `modeSel` mis-bind
> bug (caused real errors), and was the wrong shape — **reverted** from
> `index.html` + `app.js`. Routing is now **subagent-based**, shipped in
> `extensions/pi_minimal_webui/subagent.ts` (wired from `index.ts`). It ports
> pi's `examples/extensions/subagent` core (no TUI render — rpc uses
> `result.content`; tiers are in-code config, no .md discovery). Each call
> spawns an isolated `pi --mode json -p --no-session --model <tier>`; the parent
> never ingests the subagent's tool I/O, only its capped ≤50KB final text — so
> it wins on cost AND context (roadmap O2 structurally). Tiers: capable
> `zai/glm-5.2` (planner/reviewer/debugger), implement `zai/glm-5-turbo`
> (implementer), lookup `zai/glm-4.5-air` (scout/summarizer). Modes:
> single/parallel/chain. Smoke test pending. See `CHANGELOG.md` + `roadmap.md`
> §O5 for the current truth; the per-turn detail below is kept only as the
> historical (reverted) design.

### (Historical) Per-turn design — REVERTED

**Goal (original):** send ONE message on a different (e.g. cheaper) model, then
revert to the prior model — without a sticky global switch. **Manual override
only**; no auto-routing (misrouting the hard part is a quality loss the $
saving can't buy back).

### Current state

- `app.js:2387` `modelSel.onchange` → emits `set_model` RPC, sets
  `currentModelId`, persists `pi:model` to localStorage. **Sticky / global.**
- `app.js:2308` handles the `set_model` response. Switching is live (no pi
  restart) — proven by the existing onchange path.
- There is **no per-message model RPC**. Routing = `set_model(override)` →
  send → `set_model(revert)`.

### As built

- **UI** — `<select id="override">` in the footer `.bar` (`index.html`),
  after the mode select. `populateModels` mirrors the model list into it with a
  leading `value=""` "⚡ next model" option. Unpersisted (no localStorage — an
  override should not survive reload).
- **Send** (`send()` in `app.js`) — only when `!streaming` (fresh turn) and
  `overrideSel.value` is set: parse it, set
  `pendingRevert = {overrideId, originalId: currentModelId}`,
  `await api(set_model override)` (ordered: the server writes `set_model` to
  pi's stdin before resolving, so the subsequent prompt POST is processed
  after), then reset `overrideSel.value`. Steer / follow-up leaves it armed for
  the next NEW turn.
- **Revert** (`revertOverride(force)`) — runs on `agent_end` (`force=false`) and
  in the send-failure `catch` (`force=true`). Guard: skip the turn-end revert
  if `currentModelId !== overrideId` (user switched mid-turn — keep their
  choice). The send-failure path forces because no turn ran (no manual switch
  possible) and the `set_model` echo may not have landed yet (stale
  `currentModelId`). `originalId` is split on the first `/` to recover
  provider/modelId for the revert RPC.

### Verify

- **Happy path:** pick override, send → `set_model` fires (RPC echo), statusbar
  `sb.model` shows the override during the turn, revert fires on `agent_end`,
  next normal message runs on the original model.
- **Failure path:** pick override, send, hit **Stop** → revert still fires.
- **Mid-turn switch:** pick override, send, manually change model mid-turn →
  revert does **not** overwrite the user's choice.

### Risks / ceilings

- **Sticky-during-turn:** pi uses the override model for the whole turn (every
  tool call + final answer); it can't switch mid-turn. A "turn" is the work
  unit, so acceptable. (`// ponytail: per-turn granularity, not per-tool.`)
- **Strand-on-crash:** if the bridge/pi dies mid-turn, the session is left on
  the override until the user reselects. Mitigation: store a pending-revert hint
  (localStorage `pi:model-revert`) and replay it on reconnect/init. Lightweight;
  defer if crashes prove rare.
- **Cost of routing wrong** is bounded because routing is the user's explicit
  choice each time.

### Rollback

Remove the ⚡ UI + the `set_model`/revert calls in `send()` and the
`agent_end`/error handlers. The global `modelSel` path is untouched.
