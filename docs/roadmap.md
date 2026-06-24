# Feature Roadmap

> Candidate features for pi-webui and its extension, mapped with benefits,
> drawbacks, and a value/effort ranking. Source of truth for *what we might
> build next*; track acceptance/closure of an item in
> [`../CHANGELOG.md`](../CHANGELOG.md), and tick the open-work list in
> [`../AGENTS.md`](../AGENTS.md) when an item is picked up.
>
> Grounded in the surface that already exists (sessions, statusbar with
> cost/tok/ctx, editable diffs + Apply, permission gate, todo panel, ponytail,
> commands palette, peak-usage bar) so nothing here duplicates present
> capabilities. Re-evaluate against the live code before acting — this doc can
> go stale.

## Tier 1 — high value, fits the minimal philosophy (do soon)

### 1. Session fork / "branch from here"

**What:** One-click duplicate of the current session file → opens a fresh
switch. Plus "edit & resend a past user message" (truncate the session at that
point, resend).
**Benefit:** Agent workflows live on "what if I'd gone the other way." Forking
is the single biggest lever for that, and it's nearly free: `switch_session` +
a file copy already exist; `get_messages`→truncate→rebuild is the only new
logic.
**Drawback:** Granular "rewind to message N" needs safe truncation of the JSONL
(don't corrupt mid-record). One process = one session means "fork into a new
tab" is still a tab-swap, not true parallelism.
**Effort:** M

### 2. Agent-finished notification

**What:** Browser Notification API (+ optional soft sound) when the agent goes
idle after a run longer than N seconds, especially if the tab is hidden.
**Benefit:** Fire off a long task and walk away. Highest value-per-line in the
whole list — ~15 lines, native API, zero deps.
**Drawback:** Needs a permission prompt; easy to make annoying (only notify on
`agent_end` after a real run, throttle).
**Effort:** S

### 3. Context-usage visualization + compact nudge

**What:** The statusbar already has `ctx`/`tok`/`$cost`. Promote it to a visible
% bar (reusing the `#usagebar` styling built for peak hours) and toast
"context > 80%, suggest compact" near the limit.
**Benefit:** Compaction timing is currently guesswork. A bar turns the latent
data into a decision. Reuses existing plumbing.
**Drawback:** Need reliable context-capacity from RPC (`get_state`); if it's
approximate the bar lies. Mild.
**Effort:** S

### 4. Surface unhandled RPC events (completeness)

**What:** `auto_retry_end` and `extension_error` are deliberately unhandled
(AGENTS §RPC coverage). Toast the retry outcome and surface extension throws
instead of silently dropping them.
**Benefit:** A retried failure currently either silently "fixes itself" or fails
opaquely. Surfacing = trust in the UI.
**Drawback:** `extension_error` payloads aren't well-specified; might be noisy
if an extension throws often. Easy to mute.
**Effort:** S

## Tier 2 — worth it, more involved

### 5. Changed-files panel + per-file revert

**What:** A view of files pi touched this session (from `tool_execution_*`
args), with inline diff and a **Revert** button (restore the pre-edit snapshot
kept during `Apply`).
**Benefit:** "Undo a bad edit" is the missing safety net for the Apply workflow
— today a bad apply is permanent unless you notice immediately. Doubles as a
mini git-changes browser.
**Drawback:** Requires snapshotting file contents pre-edit (disk I/O + a tmp
store) and a reliable revert path. Must not fight pi's own view of the tree.
**Effort:** M

### 6. Mobile-responsive / installable PWA

**What:** Responsive composer + transcript for narrow screens, plus a tiny
manifest so it's "Add to Home Screen." Pairs with **(7)** for non-localhost
access.
**Benefit:** Check on / steer your agent from your phone. Aligns with the
"minimal, no-install" identity.
**Drawback:** Touch keyboard ergonomics on a diff/code UI are rough; the
permission modal flow needs a mobile pass. CSS work, not logic.
**Effort:** M

### 7. Auth gate for LAN/remote access

**What:** Optional passphrase/token check (env-configured) so the port can be
exposed beyond localhost without the DNS-rebinding gate killing legit LAN use.
**Benefit:** Unlocks (6) for real — otherwise mobile = same laptop only.
Security-positive (the project already hardens CSRF/rebinding).
**Drawback:** Adds an auth path to `server.js`; must not weaken the existing
gate. Token storage in browser. The hardening is the point — do this carefully,
not lazily.
**Effort:** M

### 8. @-mention file injection + drag-drop

**What:** `@path/to/file` in the composer injects file contents into the prompt;
drag-drop a file/image does the same or attaches.
**Benefit:** Stops the copy-paste-into-prompt loop for context. The `/api/file`
endpoint already exists for reads.
**Drawback:** Needs autocomplete UI for `@`, and image handling depends on the
model's multimodal support (graceful bail otherwise).
**Effort:** M

## Tier 3 — nice to have / speculative

### 9. Transcript search + copy buttons

**What:** Ctrl-F within conversation (scoped to transcript, not browser find);
per-message and per-code-block "copy" buttons.
**Benefit:** Trivial QoL; long sessions become searchable.
**Drawback:** Browser find mostly covers search; marginal gain is small. Copy
buttons are near-zero cost though.
**Effort:** S

### 10. Tool-call / cost history observability

**What:** Log tool calls + costs per session to localStorage; render a small
chart or "this session: 14 tool calls, $0.42."
**Benefit:** Insight into where time/money goes.
**Drawback:** Storage grows; charting without a dep means hand-rolled SVG.
Speculative unless you actually review these.
**Effort:** M

### 11. Theme/font settings + light mode

**What:** Settings persisted in localStorage; a second palette alongside
Ayu-Dark.
**Benefit:** Accessibility + daylight use.
**Drawback:** [`design.md`](design.md) is explicitly Ayu-Dark-first; a second
theme doubles CSS surface to keep in sync. The mutable state in `app.js`
(AGENTS gotcha #8) grows again.
**Effort:** M

## Context & cost optimization

A distinct domain: features that cut tokens / spend while *raising* answer
quality. The guiding tension — **the two biggest token-savers (compaction,
cheaper models) are also the biggest quality-killers** — so the highest-leverage
items are the ones that make those two *safe*. Grounded in the current surface:
a passive `contextUsage` statusbar (`ctx`/`cache`/`tok`/`$cost`), a manual
**Compact** button, pi-core's reactive auto-compaction at the overflow
threshold, and ponytail's "write less" discipline.

Implementation plans for the top two live in [`plans.md`](plans.md).

### O1. Pinned-notes keep-alive (survives compaction)

**What:** A small "things the agent must not forget" list, re-injected via
`before_agent_start` each turn (same channel as ponytail/discipline). Survives
compaction because it's never *in* the compacted history — it's prepended fresh
every turn.
**Benefit:** Kills compaction-induced drift — the #1 quality regression. The
`todo.ts summarize()` pattern already proves the mechanism (it re-injects state
post-compaction); one more is cheap.
**Tradeoff:** Tiny per-turn token cost; pays for itself by avoiding
re-derivation. Grows `app.js` module state (AGENTS gotcha #8).
**Quality ↑↑, tokens ~, effort S–M.**

### O2. Replace tool-output with manual summary (prune live context)

**What:** Tool outputs (a 2000-line file read, a huge command dump) are the #1
context consumer. Let the user select a past tool result and replace its verbatim
text with a short summary *they* write — dropping real tokens from live context
(unlike display-collapse, which only hides them).
**Benefit:** Biggest real token drop in the list; signal-to-noise for the agent
improves → quality ↑.
**Tradeoff:** Needs pi to support message-content edit/replacement (verify RPC);
otherwise a `before_agent_start` replay trick. Must not desync pi's stored
history from the displayed one.
**Tokens ↓↓, $ ↓↓, quality ↑, effort M.**

### O3. Cache-stable prompt audit

**What:** Anthropic/Gemini prompt caching rewards a **stable system-prompt
prefix**; any per-turn change busts the cache. Audit every `before_agent_start`
injection: it must be constant across turns (move dynamic state to a different
channel). The statusbar `cache` stat already measures the hit rate.
**Finding (pre-audit):** `ponytail.ts` injects a constant per-mode string ✓;
`discipline.ts` injects live todo-state (ids, counts) that changes every turn ✗
— the fix is to make that nudge static and rely on the hard `tool_call` gate +
the todo tool's returned state for the dynamic specifics.
**Benefit:** One-time, near-free $ win (cache hits don't change answers, they
change price); quality ↑ (stable context).
**$ ↓↓, quality ↑, effort S.**

### O4. Compaction preview + pin-to-keep

**What:** Before summarizing, show what's about to be condensed and let the user
pin messages to preserve verbatim (the spec, key decisions, the last error+fix).
Today compaction is a black box — high-value context and chaff get summarized
equally.
**Benefit:** Makes the existing Compact button safe instead of lossy; quality ↑↑
when used with O1.
**Tradeoff:** Granular pinning needs a compact-scope RPC (verify support) or a
keep-list re-inject (O1 generalizes).
**Tokens ↓, quality ↑↑, effort M.**

### O5. Subagent-based tier routing (was: per-turn model routing) — SHIPPED

**Pivot (2026-06-24):** the original per-message `set_model` override was
built, caused errors (a `modeSel` mis-bind bug), and was the wrong shape —
**reverted**. Routing is now **subagent-based** and shipped
(`extensions/pi_minimal_webui/subagent.ts`).

**What:** A `subagent` tool the parent LLM calls to delegate a bounded task to
an isolated `pi --mode json` subprocess pinned to a tier model. The parent
never ingests the subagent's tool I/O — only its capped ≤50KB final text
returns. So this delivers **both** cost routing (tier→model) **and** context
savings (isolated context = O2, structurally).

**Tiers** (from `pi --list-models`):

- capable `zai/glm-5.2` → planner, reviewer, debugger
- implement `zai/glm-5-turbo` → implementer (bump to glm-5.1 if quality dips)
- lookup `zai/glm-4.5-air` → scout, summarizer

**Why subagents over per-message `set_model`:** delegation is the natural unit
(hard reasoning → capable, implementation → small, lookup → smallest), and the
isolated context is a bonus the per-message switch can't give. The parent
stays on its chosen model; only delegated work routes.

**Tradeoff / open:** the spawned child loads global extensions too (harmless —
single-shot, tool-allowlisted). Tiers are in-code config (edit the model
string in `subagent.ts` to retune); not yet user-editable `.md` agents. Smoke
test pending.
**$ ↓↓ + context ↓↓, quality ↑, effort M — DONE.**

### O6. Peak-hours cost deferral / routing

**What:** The peak-hours badge already exists. Extend: nudge "cost is high now —
defer if non-urgent" or auto-pick the cheaper model during 14:00–18:00 UTC+8.
**Benefit:** $ ↓, quality neutral.
**Tradeoff:** Marginal; overlaps O5's routing mechanism.
**$ ↓, effort S.**

### Items folded into existing roadmap entries (not duplicated here)

- **Proactive boundary compaction** (compact at a clean turn boundary before
  overflow, not mid-turn) → extends roadmap **#3**.
- **Fork instead of bloat** (focused per-branch context) → roadmap **#1**.
- **Pre-send huge-input guard** (summarize-first before giant pastes enter
  context) → extends roadmap **#8**.

### Optimization ranking

| # | Feature | Tokens | $ | Quality | Effort | Score |
|---|---------|:---:|:---:|:---:|:---:|:---:|
| O1 | Pinned-notes keep-alive | ~ | ~ | ↑↑ | S–M | ★★★★★ |
| O2 | Replace tool-output w/ summary | ↓↓ | ↓↓ | ↑ | M | ★★★★★ |
| O3 | Cache-stable prompt audit | – | ↓↓ | ↑ | S | ★★★★½ |
| O4 | Compaction preview + pin | ↓ | ↓ | ↑↑ | M | ★★★★ |
| O5 | Subagent tier routing (SHIPPED) | – | ↓↓ | ↑ | M | ★★★★★ |
| O6 | Peak-hours deferral | – | ↓ | ~ | S | ★★★ |

**Suggested order:** **O3** first (one-time audit, near-free $ win), then
**O1** (pinned notes — the quality anchor), then **O2** (biggest real token
drop), then **O4** (make compact safe). **O5** (subagent tier routing) is
SHIPPED — see `extensions/pi_minimal_webui/subagent.ts`.

## Ranking

Value ● = low, ●●●●● = high. Effort S/M/L. Score = value ÷ effort.

| # | Feature | Value | Effort | Score |
|---|---------|:----:|:----:|:----:|
| 2 | Agent-finished notification | ●●●● | S | ★★★★★ |
| 3 | Context-usage bar + compact nudge | ●●●● | S | ★★★★★ |
| 4 | Surface unhandled RPC events | ●●● | S | ★★★★ |
| 1 | Session fork / rewind | ●●●●● | M | ★★★★ |
| 5 | Changed-files panel + revert | ●●●● | M | ★★★½ |
| 9 | Transcript search + copy buttons | ●● | S | ★★★ |
| 8 | @-mention files + drag-drop | ●●● | M | ★★★ |
| 7 | Auth gate (LAN) | ●●● | M | ★★★ |
| 6 | Mobile / PWA | ●●● | M | ★★½ |
| 10 | Tool-call / cost history | ●● | M | ★★ |
| 11 | Theme/font settings | ●● | M | ★★ |

## Suggested order

Knock out **#2 + #3 + #4** first (all S, immediate feel improvements, pure
additive UI, mutually independent). Then **#1 fork** (the biggest workflow win).
Then decide between safety (**#5 revert**) vs. mobile (**#6/#7**) based on
whether the project is actually used off-laptop.
