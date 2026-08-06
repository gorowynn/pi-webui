# Action plan: adopting from pi-livecraft

> Orchestrates three analysis docs into an executable roadmap:
> - **[F]** [`pi-livecraft-adoption.md`](./pi-livecraft-adoption.md) — architecture & features
> - **[U]** [`pi-livecraft-ui-adoption.md`](./pi-livecraft-ui-adoption.md) — UI/UX
> - **[R]** [`pi-livecraft-rendering-adoption.md`](./pi-livecraft-rendering-adoption.md) — markdown / tool output / images
>
> Section refs like `F§5` or `R§2.3` point back to the analysis. This doc is the **what/when**;
> those are the **why/how**. **No code changed — plan only.**

---

## Strategy

**Default to Path A** (steal structure, keep our anti-slop stance): adopt the engineering
foundation, structural UX, tool-output rendering, and new capabilities. Stay flat / mono /
opaque. Defer the 🟠 aesthetic items (Path B) unless you explicitly decide to change the visual
identity and rewrite `design.md`.

Two items are **keystones** — everything else gets cheaper or becomes possible because of them:

1. **Color-token system** (U§1) — 8 source colors → `color-mix()` derived tokens. Unlocks
   theme-following syntax colors, soft tints, hover states, and the multi-theme editor. Do first.
2. **Awaitable RPC + `/api/snapshot`** (F§5) — one round-trip session bootstrap; RPC calls that
   return data. Unlocks session analysis, isolated prompts, rename, directory picker, live
   reconnect. Do early.

**Total Path A scope:** ~26 days of work across 6 phases. Each phase is a shippable milestone.
A coherent **first tranche** (Phases 0–2, ~8 days) transforms the tool's feel without touching
the riskiest paths.

---

## Dependency graph

```
                    ┌─ Color-token system (U§1) ──────────┐
                    │        (keystone #1)                 │
                    │   ├─ token-driven syntax (R§1.3)     │
                    │   ├─ soft tints / hover (U§3.4)       │
                    │   └─ multi-theme editor (U§3.5) 🟠    │
                    │                                      │
 ┌─ jsonl codec ─┐   │   ┌─ Awaitable RPC + snapshot (F§5) ┐│
 │  (F§4.5)      │   │   │        (keystone #2)            ││
 ├─ proc-kill    │   │   │   ├─ session-analysis (F§4.2) ──┘│
 │  (F§4.7)      │   │   │   │     └─ usage panel (U§4)     │
 │               │   │   │   │     └─ per-turn strip (U§2.2)│
 └─ path guard   │   │   │   ├─ isolated prompts (F§4.6)    │
    (F§4.8)      │   │   │   ├─ session rename (F§5.8)      │
                 │   │   │   ├─ dir picker (F§5.8)          │
                 │   │   │   └─ live reconnect (F§5.2)      │
                 │   │   │       └─ compaction (F§5.3)      │
                 │   │   │                                  │
                 │   │   └─ Tool-output rendering (R§2) ────┘
                 │   │       (needs token system for soft cards)
                 │   │
 deferred highlight (R§1.2) ── independent
 image display (R§3.2) ────── independent → enables image input (R§3.1)
```

**Read as:** arrows mean "makes possible / cheaper." Items with no inbound arrows are
independent and can start immediately.

---

## Phases

### Phase 0 — Foundation (keystones + hardening) · ~3.5d · **status: ✅ done**
Everything downstream depends on this. No visible change except faster bootstrap.

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 0.1 | Color-token system (8 sources → color-mix derived); rename existing tokens | U§1 | 1.0d | — |
| 0.2 | Awaitable RPC (`POST /api/rpc`) + `GET /api/snapshot` (5 bootstrap RPCs bundled, parallel). Keep fire-and-forget `/api/cmd` + SSE `response` broadcast intact | F§5 | 1.5d | — |
| 0.3 | `jsonl.ts` codec (split-on-`\n`, strip `\r`, record-size cap) factored out of `server.js` | F§4.5 | 0.25d | — |
| 0.4 | Cross-platform process-tree kill centralized (SIGTERM→SIGKILL / stdin-EOF→`taskkill /T`) | F§4.7 | 0.5d | — |
| 0.5 | `workspace-file.ts` path-traversal guard folded into `safePath` | F§4.8 | 0.25d | — |

**Exit criteria:** token migration is a no-op visually; `/api/snapshot` returns one bundled
object; bootstrap does 1 fetch instead of 5 fire-then-wait-for-SSE; smuggle channels (ask/todo/
sdd/subagent) still work. **Must test:** a `tool_execution_start` smuggle still fires before its
sibling `response` (GOTCHAS #1/#6).

**Risk:** 0.2 touches the RPC hot path. Add a focused test; never remove the SSE broadcast.

---

### Phase 1 — Quick wins · ~0.5d · **status: ✅ done**
Tiny, high-visibility. Build momentum after the invisible foundation.

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 1.1 | Deferred code highlighting (IntersectionObserver, 800px) — kills jank | R§1.2 | 0.5h | — |
| 1.2 | Transcript max-width + centering (`max(28px, calc((100%-900px)/2))`, `scrollbar-gutter: stable`) | U§2.8 | 15m | — |
| 1.3 | Sticky scroll-to-bottom pill styling on existing `jumpBottom` | U§2.7 | 1h | — |
| 1.4 | ANSI C1 (0x9B) escape stripping in `stripAnsi` | R§3.3 | 5m | — |
| 1.5 | Image content-part display (`{type:"image"}` → `<img>` in `nonEmptyContent`/render) | R§3.2 | 1h | — |

**Exit criteria:** long messages don't jank; wide screens center; image results render.

---

### Phase 2 — Tool-output rendering · ~4d · **status: ✅ done**
The biggest perceived gap, shipped as one cohesive workstream. Depends on 0.1 (soft cards) and
1.1 (deferred highlight).

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 2.1 | Tool-presentation registry (`bash`/`read`/`edit`/`write`/`find`/`grep` → header/detail); migrate `describeTool` switch | F§4.4, R§2.1 | 0.5d | 0.1 |
| 2.2 | Bounded text preview + "view M more lines" expand | R§2.6 | 2h | 2.1 |
| 2.3 | Line-numbered highlighted code for `read` (starts at `offset`, 50K cap) | R§2.2 | 0.5d | 1.1, 2.1 |
| 2.4 | CSV table preview (bounded parser, 8×20×160, 64KB scan) → `public/csv-preview.js` | R§2.3 | 0.5d | 2.1 |
| 2.5 | SVG-as-`<img>` preview (data URL) | R§2.5 | 10m | 2.1 |
| 2.6 | Sandboxed HTML preview (`<iframe sandbox="">` + `stripScripts()`, opt-in click-to-render) | R§2.4 | 0.5d | 2.1 |
| 2.7 | Tool protocol extraction layer (`public/tool-protocol.js`): streaming call tracking, partial results, nested-content flatten | R§2.9 | 1.0d | 2.1 |
| 2.8 | Height-preserving offscreen placeholder (ResizeObserver virtualization) | R§2.7 | 0.5d | 2.3, 2.4 |

**Exit criteria:** `read`/`grep`/`bash` results render by content type; CSV shows as a table;
HTML/SVG preview safely; huge outputs collapse to a preview. **Security gate:** raw tool content
never `innerHTML`'d — only `textContent`, safe parse, markdown escaper, or sandboxed iframe.

**Risk:** 2.7 rewires the SSE tool handlers (GOTCHAS #6/#7). Test the smuggle channels + the
editable edit-diff still fire.

---

### Phase 3 — Structural UX · ~5d · **status: ✅ done**
Interaction patterns, aesthetic-agnostic. The edit-diff stays editable (ours); tool cards get
expand/collapse on top of Phase 2's renderers.

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 3.1 | Tool-call cards: header (icon + truncated cmd + status + duration) + `grid-template-rows:0fr→1fr` expand animation | U§2.3 | 1.5d | 2.1 |
| 3.2 | Conversation detail modes (simple / semi-detailed / detailed) toggle, persisted | U§2.1 | 0.5d | 3.1 |
| 3.3 | Toasts: sticky errors, auto-dismiss routine (two-tier) | U§2.5 | 0.5d | — |
| 3.4 | Command palette polish (Alt+K, unified registry, widget auto-register) — extends existing `renderPalette` | U§2.4 | 1.0d | — |
| 3.5 | Right-rail widget shell (resizable, collapsible-to-rail, width persisted). Flat `--surface` + `--line`, **no accent gradient** | U§2.6 | 1.5d | 0.1 |

**Exit criteria:** tool calls collapse/expand smoothly; a "simple" reading mode hides them;
errors stay until dismissed; `Alt+K` opens a real palette; right rail hosts widgets.

---

### Phase 4 — Capabilities · ~11d
The meaty features. Each is independently shippable; order by appetite.

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 4.1 | Recent-sessions head/tail reader (`GET /api/sessions/recent?cwd=`) | F§4.1 | 1.0d | — |
| 4.2 | Session-analysis math port (`analyzeSession`, per-turn/per-tool attribution) | F§4.2 | 2.0d | 0.2 |
| 4.3 | Session-analysis widget (HTML/CSS cost-per-turn bars + ranked lists + click→scroll) in the right rail | U§4 | 1.5d | 3.5, 4.2 |
| 4.4 | Per-turn usage strip under each assistant message | U§2.2 | 0.5d | 4.2 |
| 4.5 | Git sidebar — **read-only** (snapshot, per-file/per-commit diffs, ahead count) | F§4.3 | 2.0d | — |
| 4.6 | Git sidebar — mutations (commit/push/reset/revert/discard) behind confirm modal | F§4.3 | 1.0d | 4.5 |
| 4.7 | Run-isolated-prompt (disposable `--no-tools` profile dir + cheapest-model sort) | F§4.6 | 1.5d | 0.2, 0.4 |
| 4.8 | Improve-prompt dropdown (Clarify/Ideate/Precise) via isolated prompt | U§5.5, F§4.6 | 0.5d | 4.7 |
| 4.9 | Session rename (`set_session_name`) + directory picker UI | F§5.8 | 0.5d | 0.2 |
| 4.10 | Image input (canvas downscale + JPEG quality loop, max 4, raw base64, model-cap gated) | R§3.1 | 1.0d | 1.5 |

**Exit criteria:** usage panel with clickable turns; git review without leaving UI; "Improve"
rewrites a draft via a cheap disposable model; images can be pasted and sent.

**Risk:** 4.6 (git mutations) + 4.7 (new process type) are the riskiest. Ship 4.5 read-only
first; gate 4.6 behind the existing confirm modal. For 4.7, verify reliable termination on all
paths (reuse 0.4).

---

### Phase 5 — Resilience · ~2.5d · **status: ✅ done**
Hardening the live stream. Lower visible payoff but fixes real reconnect pain.

| ID | Item | Ref | Effort | Dep | ✅ |
|----|------|-----|--------|-----|----|
| 5.1 | Live-event buffer (current-turn only) + monotonic `sequence`; snapshot includes `liveEvents` | F§5.2 | 1.5d | 0.2 | ✅ |
| 5.2 | Compaction-aware message reconstruction (walk `get_entries` parent-chain from `leafId`) | F§5.3 | 1.0d | 5.1 | ✅ |

**Exit criteria:** a reconnecting tab rebuilds in-flight tool cards without a full reload; a
compacted session doesn't look truncated (compaction entries render as synthetic messages).

**Risk:** 5.2 switches history rendering from flat `get_messages` to `get_entries` parent-chain
— bigger change to `renderMessage`. Done last.

**Shipped:** `livebuf.js` (current-turn buffer, 10 tests) + `session-entries.js`
(parent-chain walk, 10 tests); `/api/snapshot` now returns `liveEvents` and derives `messages`
from `get_entries` (superset of `get_messages` — adds compaction markers, no regression for
non-compacted sessions). Client replays `liveEvents` through `handle()` after `applyMessages`
(finalizing dead turns on an idle pi) and renders `role:"custom"` compaction entries as a
muted collapsible `<details>` callout. Validated end-to-end against a real 882-entry compacted
session (921 messages, 3 markers correctly placed between turns).

---

### Phase 6 — Path B aesthetic (OPTIONAL) · ~2.75d
**Only if you decide to change the visual identity.** Each item individually defensible; together
they're a stance change. Requires a `design.md` rewrite. See [U§0](./pi-livecraft-ui-adoption.md#0-read-this-first-the-honest-tension).

| ID | Item | Ref | Effort | Dep |
|----|------|-----|--------|-----|
| 6.1 | Accent-filled right-aligned user bubble (chat-style) | U§3.1 | 1h | — |
| 6.2 | Accent-colored assistant `strong` + list markers + `--accent-soft` inline-code chips | U§3.2, U§3.4 | 1.5h | 0.1 |
| 6.3 | Softer radii (messages 10–12px, keep inputs/buttons 8px; stay <16px) | U§3.3 | 20m | — |
| 6.4 | Multi-theme editor (8-color live edit, custom themes, restore-default). Ship curated set only (skip Néon/Acid Pop as defaults) | U§3.5 | 2.0d | 0.1 |
| 6.5 | Sans-serif prose *option* via `--prose-font` token (keep mono as default) | U§3.6 | 0.5d | 0.1 |

---

## Flat backlog (tracking)

Copy this into your issue tracker. `Phase` · `Ref` (analysis doc) · `Eff` (days) · `Dep` · `Status`.

| ID | Item | Phase | Ref | Eff | Dep | Status |
|----|------|-------|-----|-----|-----|--------|
| 0.1 | Color-token system | 0 | U§1 | 1.0 | — | ✅ |
| 0.2 | Awaitable RPC + snapshot | 0 | F§5 | 1.5 | — | ✅ |
| 0.3 | jsonl codec | 0 | F§4.5 | 0.25 | — | ✅ |
| 0.4 | Process-tree kill | 0 | F§4.7 | 0.5 | — | ✅ |
| 0.5 | Path-traversal guard | 0 | F§4.8 | 0.25 | — | ✅ |
| 1.1 | Deferred highlight | 1 | R§1.2 | 0.05 | — | ✅ |
| 1.2 | Transcript centering | 1 | U§2.8 | 0.03 | — | ✅ |
| 1.3 | Scroll-to-bottom pill | 1 | U§2.7 | 0.1 | — | ✅ |
| 1.4 | ANSI C1 strip | 1 | R§3.3 | 0.01 | — | ✅ |
| 1.5 | Image display | 1 | R§3.2 | 0.1 | — | ✅ |
| 2.1 | Tool-presentation registry | 2 | F§4.4, R§2.1 | 0.5 | 0.1 | ✅ |
| 2.2 | Bounded text preview | 2 | R§2.6 | 0.25 | 2.1 | ✅ |
| 2.3 | Line-numbered code | 2 | R§2.2 | 0.5 | 1.1, 2.1 | ✅ |
| 2.4 | CSV table | 2 | R§2.3 | 0.5 | 2.1 | ✅ |
| 2.5 | SVG preview | 2 | R§2.5 | 0.02 | 2.1 | ✅ |
| 2.6 | Sandboxed HTML preview | 2 | R§2.4 | 0.5 | 2.1 | ✅ |
| 2.7 | Tool protocol layer | 2 | R§2.9 | 1.0 | 2.1 | ✅ |
| 2.8 | Offscreen placeholder | 2 | R§2.7 | 0.5 | 2.3, 2.4 | ✅ |
| 3.1 | Tool-call cards (expand/collapse) | 3 | U§2.3 | 1.5 | 2.1 | ✅ |
| 3.2 | Detail modes | 3 | U§2.1 | 0.5 | 3.1 | ✅ |
| 3.3 | Sticky-error toasts | 3 | U§2.5 | 0.5 | — | ✅ |
| 3.4 | Command palette | 3 | U§2.4 | 1.0 | — | ✅ |
| 3.5 | Right-rail widget shell | 3 | U§2.6 | 1.5 | 0.1 | ✅ |
| 4.1 | Recent-sessions reader | 4 | F§4.1 | 1.0 | — | ☐ |
| 4.2 | Session-analysis math | 4 | F§4.2 | 2.0 | 0.2 | ☐ |
| 4.3 | Session-analysis widget | 4 | U§4 | 1.5 | 3.5, 4.2 | ☐ |
| 4.4 | Per-turn usage strip | 4 | U§2.2 | 0.5 | 4.2 | ☐ |
| 4.5 | Git sidebar (read-only) | 4 | F§4.3 | 2.0 | — | ☐ |
| 4.6 | Git mutations | 4 | F§4.3 | 1.0 | 4.5 | ☐ |
| 4.7 | Run-isolated-prompt | 4 | F§4.6 | 1.5 | 0.2, 0.4 | ☐ |
| 4.8 | Improve-prompt dropdown | 4 | U§5.5 | 0.5 | 4.7 | ☐ |
| 4.9 | Session rename + dir picker | 4 | F§5.8 | 0.5 | 0.2 | ☐ |
| 4.10 | Image input | 4 | R§3.1 | 1.0 | 1.5 | ☐ |
| 5.1 | Live-event buffer + replay | 5 | F§5.2 | 1.5 | 0.2 | ✅ |
| 5.2 | Compaction-aware messages | 5 | F§5.3 | 1.0 | 5.1 | ✅ |
| 6.1 | Accent user bubble 🟠 | 6 | U§3.1 | 0.1 | — | ☐ |
| 6.2 | Accent type + chips 🟠 | 6 | U§3.2, U§3.4 | 0.2 | 0.1 | ☐ |
| 6.3 | Softer radii 🟠 | 6 | U§3.3 | 0.03 | — | ☐ |
| 6.4 | Multi-theme editor 🟠 | 6 | U§3.5 | 2.0 | 0.1 | ☐ |
| 6.5 | Sans-serif prose option 🟠 | 6 | U§3.6 | 0.5 | 0.1 | ☐ |

**Totals:** Path A (Phases 0–5) ≈ **25.6 days**. Path B (Phase 6) adds ≈ **2.8 days** + a design stance change.

---

## Recommended first tranche

If you want the maximum transformation for minimum risk, ship **Phases 0 → 1 → 2** first
(~7.5 days). That delivers: a maintained token foundation, faster bootstrap, no jank, and the
entire typed tool-output story (CSV/HTML/SVG/numbered-code + bounded previews + safe sandboxing).
It touches no mutating paths and no new process types. Everything in Phases 3–5 is incremental
on top and independently shippable.

Within Phase 2, the minimum viable slice is **2.1 → 2.2 → 2.3 → 2.4** (registry + text preview +
numbered code + CSV) — ~1.75 days for most of the perceived value.

---

## Guardrails (invariants that must not break)

Carry these into every item. Each maps to a GOTCHAS entry.

1. **Zero build step.** No bundler/transpile/`npm install` at runtime. New vendored libs only
   if defensible (we propose **none** — every port above is pure JS or reuses existing vendors).
2. **Fire-and-forget `/api/cmd` + SSE `response` broadcast stays.** The awaitable path (0.2) is
   *additive*; the smuggle channels (ask/todo/sdd/subagent) depend on both. (GOTCHAS #1/#6)
3. **`ask_user_question` stays shadowed.** Tool name = wire contract. (GOTCHAS #3)
4. **`safePath` / realpath confinement.** Every new file-touching endpoint (git, isolated
   prompts, rename) resolves under `realpath(PI_CWD)`. (GOTCHAS #4)
5. **Raw tool/file content is never `innerHTML`'d.** `textContent`, safe parse, markdown
   escaper, or sandboxed iframe only. (Rendering security gate, R§4)
6. **Authoritative render from `payload.message.content`.** Don't regress the live-vs-reload
   parity (GOTCHAS #13).
7. **Terminate child processes reliably.** Reuse 0.4 for isolated prompts (4.7) and any new spawn.

---

## Decision points (gate later phases)

- **After Phase 0:** confirm Path A vs Path B. If Path B, slot Phase 6 items where desired
  (6.1/6.2/6.3 are cheap; 6.4 is a 2-day feature).
- **Before 4.6 (git mutations):** confirm the confirm-modal discipline is sufficient, or whether
  git actions need an undo/audit trail.
- **Before 4.3 (analysis widget viz):** decide HTML/CSS bars (cheap) vs SVG vs `<canvas>` —
  affects effort (0.5–1.5d swing).
- **Before 5.2 (compaction):** confirm willingness to switch history rendering from
  `get_messages` to `get_entries` parent-chain (bigger change).

---

## Per-phase exit checks (smoke tests)

Adapted from `AGENTS.md` "Manual smoke tests"; add one row per phase.

- **Phase 0:** `GET /api/snapshot` returns state+messages+models+commands+stats; ask-question
  smuggle still fires before its response; editable transcript diff still Applies.
- **Phase 1:** paste a 200-line code block → no frame jank; open on ultrawide → centered.
- **Phase 2:** `read` a `.csv` → table; `read` a `.html` → click → sandboxed iframe; `read` a
  `.md` → rendered; huge `grep` → collapsed preview + "view more".
- **Phase 3:** collapse all tool calls → reading mode; trigger a send error → sticky toast;
  `Alt+K` → palette.
- **Phase 4:** open analysis widget → cost-per-turn bars, click → scrolls; `git status` shows
  changed files; paste an image into composer → thumbnail → send.
- **Phase 5:** kill+restart the server mid-turn → tab rebuilds in-flight tool card; compact a
  long session → earlier turns still visible as a compaction marker.

---

## Workflow: git worktrees for implementations

All implementation work happens in **git worktrees**, not the main checkout. The main checkout
(`D:/Repository/pi-webui`, branch `dev`) stays on the stable integration branch; each plan item
gets its own worktree so multiple items can progress in parallel without stashing or context
switches.

### Layout

```text
D:/Repository/pi-webui/                 # main checkout, always on `dev`
D:/Repository/pi-webui-worktrees/       # sibling dir, holds all worktrees
  ├── color-tokens/                     # one worktree per plan item
  ├── tool-output-registry/
  └── ...
```

Each worktree is a full checkout — `node server.js` runs independently per worktree. The
zero-build invariant holds everywhere; there is no shared build state between worktrees.

### Convention

- **Branch name:** `<type>/<slug>` — e.g. `feat/color-tokens`, `feat/tool-output-registry`,
  `fix/bootstrap-latency`. Reference the plan item ID (e.g. `0.1`, `2.3`) in commit messages
  for traceability back to the backlog above.
- **Worktree path:** `D:/Repository/pi-webui-worktrees/<slug>` (drop the `<type>/` prefix).
- **Base:** branch from `dev`, where these docs live — so every worktree has the analysis + plan.

### Commands

```bash
# create a worktree for plan item 0.1 (color-token system)
git worktree add D:/Repository/pi-webui-worktrees/color-tokens -b feat/color-tokens dev
cd D:/Repository/pi-webui-worktrees/color-tokens
# ...implement... then commit, e.g.:
#   git commit -am "feat(tokens): 8-source color-mix token system (plan 0.1)"

# list worktrees
git worktree list

# when done + merged into dev: clean up
git worktree remove D:/Repository/pi-webui-worktrees/color-tokens
git branch -d feat/color-tokens
```

### Rules

- Never commit implementation work on `dev` directly — always in a worktree branch.
- Land finished work by merging the worktree branch into `dev` (fast-forward when linear),
  then remove the worktree. Keep `dev` a known-good baseline to branch from.
- One worktree per plan item (or one per cohesive batch, e.g. all of Phase 2). Don't pile
  unrelated items into one worktree.
- Re-read the relevant analysis-doc section *inside* the worktree before implementing — the docs
  travel with every checkout.

---

*Plan derived from the three analysis docs. No implementation source files were modified to
produce this plan; the docs themselves are committed on `docs/pi-livecraft-adoption` and merged
into `dev` so every worktree branches with them.*
