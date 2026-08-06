# Adopting pi-livecraft's UI/UX into pi-webui

> Companion to [`pi-livecraft-adoption.md`](./pi-livecraft-adoption.md) (which covered
> architecture/features). This doc focuses purely on **look, feel, and interaction**.
> Source audited: pi-livecraft v1.1.0 CSS + theme system + components. Target: this repo's
> zero-build vanilla-JS frontend. **Analysis only — no code changed.**

---

## 0. Read this first: the honest tension

pi-webui's [`docs/design.md`](../design.md) is not a neutral spec — it's a **deliberate
anti-slop manifesto**. It explicitly *bans*, as recognized AI-slop tells:

- the violet/cyan-on-dark "AI palette"
- glowing box-shadow halos on dark
- glassmorphism / `backdrop-filter` blur
- hero aurora / radial gradients
- side-tab accent stripes on bubbles/cards/rows
- over-rounded corners (radius > 16px) and neon-saturated cyan

pi-livecraft's aesthetic uses several things on that caution list:

| livecraft choice | design.md status |
|---|---|
| Teal/green accent (`#23776d`/`#4fb9ab`) instead of Carolina Blue | different palette — fine, but it's a taste call |
| **Accent-filled user bubble** (`background: var(--accent)`) | ✅ allowed (not a banned tell) |
| **Accent-colored assistant headings + bold + list markers** | ⚠️ design.md keeps headings accent-colored too — compatible |
| Soft tinted backgrounds everywhere via `color-mix(accent 3-12%)` | ⚠️ "warmer" than our flat hairlines; not banned, but a shift |
| Subtle **accent gradient** on the right-rail panel | 🔴 a gradient — design.md bans "hero aurora gradients" (though this is a *panel* tint, not a hero glow) |
| Rounded **9–14px** (messages 14/14/4, cards 9px) | ⚠️ our `--r:8px` cap exists to stay under the 16px threshold — 14 is fine, 9 is fine |
| Soft drop shadows `--shadow-soft` | ✅ allowed (we have a neutral black shadow already) |
| 6 built-in themes incl. **Néon** (neon pink/cyan) & **Acid Pop** | 🔴 those two *are* the banned neon-saturated palette |

**So:** adopting livecraft's *look* wholesale would partly walk back a documented, deliberate
stance. That's a real decision, not an oversight. This doc separates three things so you can
decide with eyes open:

1. **🟢 Unconditional wins** — better engineering, aesthetic-agnostic. Adopt regardless of taste.
2. **🟡 Structural UX patterns** — interaction ideas that work in *any* palette. High value.
3. **🟠 Visual aesthetic** — the warmer/rounder/multi-theme "look." A taste call; needs a
   `design.md` update if you take it.

---

## 1. 🟢 The one thing to adopt unconditionally: the color-token system

pi-livecraft derives an **entire palette from 8 source colors** using CSS `color-mix()`. This
is strictly better engineering than our current flat token list, and it works with our
*existing* palette — you don't have to change a single color to get the benefit.

### How it works
- `:root` declares **8 source colors**: `--canvas --surface --ink --accent --secondary --success --warning --danger`.
- ~16 **derived tokens** are computed from them: `--muted = mix(ink 55%, canvas)`,
  `--line = mix(ink 12%, canvas)`, `--accent-soft = mix(accent 12%, surface)`,
  `--accent-hover = mix(accent 78%, ink)`, etc.
- Feature CSS only ever references `var(--accent)`, `var(--muted)`, `var(--line)` — never hardcodes shades.
- Theme switching = set the 8 sources; everything else recomputes automatically.
- `--on-accent` (white-or-black contrast text) is computed in JS via W3C relative luminance.

### Why it's better than what we have
Our `style.css :root` has ~14 hand-picked hexes (`--bg --panel --panel2 --border --text --muted
--user --accent --cyan --ok --warn --err --think --shadow`). Adding a hover state, a soft tint,
or a second accent currently means **hand-mixing another hex** and hoping it matches across
themes. With `color-mix`, you write `color-mix(in srgb, var(--accent) 78%, var(--ink))` once and
it's correct in light *and* dark, for *any* accent the user picks.

### The migration is mechanical and risk-free
Map our tokens onto theirs, keep our exact hexes:

```css
:root {
  /* 8 sources = our current dark palette, renamed */
  --canvas:  #000000;   /* was --bg      */
  --surface: #0d1117;   /* was --panel   */
  --ink:     #e6edf3;   /* was --text    */
  --accent:  #4493f8;   /* was --accent  */
  --secondary: #a371f7; /* was --think label violet — repurpose */
  --success: #3fb950;   /* was --ok      */
  --warning: #d29922;   /* was --warn    */
  --danger:  #f85149;   /* was --err     */

  /* derived — replaces --panel2, --border, --muted, --user, --think */
  --surface-raised: color-mix(in srgb, var(--surface) 92%, var(--canvas)); /* ≈ #161b22 */
  --surface-inset:  color-mix(in srgb, var(--surface) 85%, var(--canvas)); /* ≈ #11161d */
  --muted:    color-mix(in srgb, var(--ink) 48%, var(--canvas));           /* ≈ #7d8590 */
  --line:     color-mix(in srgb, var(--ink) 14%, var(--canvas));           /* ≈ #30363d */
  --line-strong: color-mix(in srgb, var(--ink) 24%, var(--canvas));
  --accent-soft:  color-mix(in srgb, var(--accent) 14%, var(--surface));
  --accent-hover: color-mix(in srgb, var(--accent) 78%, var(--ink));
  --danger-soft:  color-mix(in srgb, var(--danger) 12%, var(--surface));
  --success-soft: color-mix(in srgb, var(--success) 14%, var(--surface));
  --on-accent: #0d1117; /* dark ink on Carolina Blue (passes WCAG AA) */
}
```

Then a find-replace pass: `--bg→--canvas`, `--panel→--surface`, `--panel2→--surface-raised`,
`--border→--line`, `--text→--ink`, `--muted` stays, `--user→--surface-inset` (or a dedicated
bubble token), `--ok→--success`, `--warn→--warning`, `--err→--danger`. ~1 day, zero visual change.

**Browser support:** `color-mix()` ships in Chrome 111+, Safari 16.2+, Firefox 113+ (all since
May 2023). For a localhost tool in 2025 this is a non-issue, but add a note in design.md.

**This single change is the foundation** that makes themes (§3.5), soft tints, and consistent
hover states cheap. Do it first.

---

## 2. 🟢 Structural UX patterns (aesthetic-agnostic, high value)

These are interaction/architecture ideas. They improve the experience in **any** palette,
including our current flat dark one.

### 2.1 Conversation detail modes (simple / semi-detailed / detailed)
A single toggle (top-right of transcript) cycles three renderings of the *same* messages:
- **simple** — messages only, no tool calls (reading mode)
- **semi-detailed** — tool-call **headers only**; click one to expand
- **detailed** — tool calls visible with expandable preview (≈ our current behavior)

The toggle is a 29px icon that **expands on hover** into a labeled button
(`conversation.css:64-120`). Persisted in `localStorage`.

- **Why adopt:** our transcript is always-detailed. A "simple" reading mode is genuinely useful
  for reviewing a long agent run without the tool noise. Cheap to build.
- **Effort:** ~0.5 day. We already render tool blocks conditionally; add a `data-view` on the
  transcript container + CSS to hide `.tool` in simple / collapse-in semi-detailed.
- **Risk:** none.

### 2.2 Per-turn usage strip
Under each assistant turn, a thin monospace strip: `cache-miss 1.2k · cache-read 8.4k · output
410 · $0.003` (`messages.css:.turn-usage`, with a 300ms fade-in). Sourced from per-message usage
parsing (depends on the session-analysis math from the main adoption doc).

- **Why adopt:** makes cost/cache visible per-turn without a separate panel. Directly surfaces
  the "am I burning cache?" question.
- **Effort:** ~0.5 day once per-message usage is parsed (Tier-1 math port).
- **Aesthetic:** rendered in `--muted` mono — fits our look exactly.

### 2.3 Tool-call cards: expand/collapse + inline previews
This is livecraft's strongest tool UX. Each tool call is a **card** (`tool-call.css`) with:
- a **header row**: tool icon + truncated command/path + status (spinner/check/✗) + duration
- click header → animated expand (`grid-template-rows: 0fr→1fr`, 180ms)
- **inline output rendering** by type: HTML, SVG, Markdown, **CSV as a scrollable table**,
  with a one-click toggle to the raw source
- distinct border color per state: running (accent), error (danger), interrupted (warning)

- **Why adopt:** our tool box is functional but flat — no collapse, no typed previews, no
  duration in the header. The CSV-as-table and Markdown-render-inside-tool-output are genuinely
  useful for `read`/`grep`/`bash` results.
- **Effort:** ~1.5 days. The `grid-template-rows: 0fr→1fr` expand animation is ~10 lines of
  CSS; the typed-preview registry is the tool-presentation port from the main doc (§4.4).
- **Compatibility:** maps onto our existing `toolBlock()` (`app.js:395`); we keep the LCS
  editable diff for `edit`/`write` (livecraft's is read-only — ours is better).

### 2.4 Command palette (Alt+K)
A centered modal with a single text input + filtered list of **all** commands (sidebar widgets,
view toggles, theme switch, open-settings, new-session…). One registry; sidebar widgets
auto-register their commands. Keyboard-navigable, `prefers-reduced-motion` respected
(`commands.css`).

- **Why adopt:** we already have a palette skeleton (`app.js:4123 renderPalette`) and a settings
  sidebar. A unified `Alt+K` palette is the natural evolution and great for keyboard users.
- **Effort:** ~1 day. Lift their CSS almost verbatim (it's palette-agnostic: `--surface`,
  `--line`, `--accent-soft`).

### 2.5 Toast notifications (auto-dismiss vs sticky-error)
Two-tier: routine notices auto-dismiss; **errors stay until dismissed**. Bottom-right of the
composer area, slide-in/out with `prefers-reduced-motion` opt-out (`notifications.css`).

- **Why adopt:** we have `toast()` (`app.js:1040`) but it's uniform. Making errors sticky is a
  real UX improvement (a failed send currently vanishes).
- **Effort:** ~0.5 day. Mostly JS; their CSS ports directly.

### 2.6 Right-rail widget system (resizable + collapsible + rail)
A third grid column that hosts widgets (session-analysis, git, todos, quotas). Each widget has
a header/content/footer; the whole rail is **drag-resizable** (a 10px hit area with a focus
ring) and **collapsible to a 48px icon rail**. Width persists in `localStorage`
(`right-sidebar.css`).

- **Why adopt:** our SDD right-rail (`#sddbar`) is the same idea, narrower. Generalizing to a
  widget rail gives a home for session-analysis (the flagship), git, todos without cramming the
  left sidebar.
- **Effort:** ~1.5 days for the shell; widgets are incremental.
- **Caveat:** their rail has a subtle accent→surface vertical gradient. For our anti-slop
  stance, make it a flat `--surface` with a `--line` left border instead. Same structure, no
  gradient.

### 2.7 Sticky "scroll to bottom" pill
A 36px circular button that fades in when the user scrolls up, centered at the bottom of the
transcript (`conversation.css:.scroll-to-bottom`). We have `jumpBottom`/`refreshJump`
(`app.js:123`) already — just needs the polished sticky-pill styling.

- **Effort:** ~1 hour. Pure CSS on our existing element.

### 2.8 Conversation max-width + centered padding
`padding: 42px max(28px, calc((100% - 900px) / 2))` — content caps at 900px and centers on wide
screens, with `scrollbar-gutter: stable` so the scrollbar doesn't cause reflow
(`conversation.css:1`). Messages themselves cap at 760px.

- **Why adopt:** on ultrawide screens our transcript stretches edge-to-edge, hurting
  readability. One-line change.
- **Effort:** ~15 min.

---

## 3. 🟠 Visual / interaction polish (the "look" — a taste call)

These move the **aesthetic** toward livecraft. Each is individually defensible; together they
amount to a softer, "designed-product" feel vs. our "engineering-terminal" feel. Take the ones
you want; update `design.md` so the stance stays honest.

### 3.1 Accent-filled user bubble (right-aligned, chat-style)
Our user input is a full-width container with a "You" label. livecraft's is a **right-aligned,
max-78%-width bubble filled with `--accent` and `--surface` text** (`messages.css:.message.user`),
with an asymmetric radius `14px 14px 4px` (tail toward the composer).

- **The trade:** chat-app convention vs. terminal-log convention. This is the single biggest
  "feel" change. It reads as more conversational, less log-like.
- **design.md impact:** allowed (not a banned tell), but reverses the "full-width You block"
  decision in §4. Document it.
- **Effort:** ~1 hour CSS. Affects `.bubble.user` + the render path.

### 3.2 Accent-colored assistant typography
Assistant prose: **headings, `strong`, and list markers all colored `--accent`**
(`messages.css`). Inline code gets an `--accent-soft` chip. Our headings are already
accent-colored, but our `strong` and markers are not.

- **Effect:** more "scannable" assistant output, more colored surface area.
- **Risk:** more color = closer to "busy." Keep `--accent-soft` chips subtle (12-14% mix).
- **Effort:** ~30 min CSS.

### 3.3 Softer radii + two-tier radius
livecraft: messages `14px` (with the 4px tail), cards/inputs `9px`, pills `999px`, the
detail-toggle `7px`. Ours: uniform `--r:8px`.

- **Adopt selectively:** bump message/tool radius to `10–12px`, keep inputs/buttons at 8px.
  Avoid going to 14px+ everywhere (that's the over-rounding threshold design.md warns about).
- **Effort:** ~20 min.

### 3.4 Soft tinted surfaces (the "warmth")
livecraft tints backgrounds with `color-mix(accent 2-5%, surface)` for tool-call bodies, hover
states, preview panes — instead of our flat `--surface` + hairline. This is the biggest
contributor to its "designed" vs our "flat" feel.

- **The trade:** more visually layered, but moves away from design.md's "hierarchy by hairline
  + background contrast, not tint." If you take it, do it sparingly (tool-call body + hover only).
- **Effort:** ~1 hour, gated on §1 (needs `color-mix` tokens).

### 3.5 Editable multi-theme system (the big one)
This is livecraft's headline UX feature for theming: **6 built-in themes** (Light, Dark, Néon,
GiPiTy, AntTropik, Acid Pop) + **user-created themes** + **edit any theme's 8 source colors**
inline, with live preview and restore-to-default.

- **Why it's powerful:** an agent (or user) can craft a theme by editing 8 hexes; everything
  else derives. This is only possible *because* of the §1 token system.
- **The conflict:** Néon (pink/cyan) and Acid Pop are exactly the "neon-saturated AI palette"
  design.md bans. GiPiTy/AntTropik are tasteful ChatGPT/Claude-style palettes.
- **Recommendation:** adopt the **system** (8-color editor, custom themes, live preview), ship a
  curated set that fits our stance (dark, paperlike, + maybe a GiPiTy-style and a
  Claude/Anthropic-style warm). Let users make their own neon if they want — that's their fork.
- **Effort:** ~2 days. The `themes.ts` logic (~400 lines) ports to vanilla JS cleanly:
  `contrastColor()` (luminance), `applyThemePalette()` (set 8 CSS vars + remove derived),
  persistence/migration. The Settings UI is the work.
- **Migration:** we already have `localStorage["pi:theme"]` + `data-theme`. Map to their
  `{active, themes[], builtInOverrides}` schema; their `normalizePalette` even migrates a legacy
  single-token key (we have exactly that).

### 3.6 Sans-serif prose option
livecraft renders assistant prose in `ui-sans-serif, system-ui` and reserves monospace for
code/meta/labels. Our identity is **mono-everywhere** (design.md §3, explicitly deliberate).

- **This is the load-bearing identity choice.** If you switch prose to sans-serif, you're
  changing pi-webui's character, not just its skin. design.md is explicit that mono-everywhere
  is "a deliberate identity, not the slop 'single font everywhere.'"
- **Compromise if you want it:** make it a **per-theme** or **per-user preference**
  (`--prose-font` token), defaulting to mono. The paperlike theme already switches to serif for
  prose — precedent exists. Don't make sans-serif the new default.

---

## 4. 🟢 The flagship: session-analysis visualization

Worth its own section because it's the thing you'll actually *show people*. livecraft renders
`analyzeSession()` output as **interactive graphs** in a right-rail widget
(`session-analysis.css`, 572 lines):

- **cost-per-turn** line/scatter — click a point → scroll to that message
- **per-tool summaries** (count, failures, total input/output chars, measured durations)
- **token/cache breakdown** (cache-miss vs cache-read vs output) with cache-hit %
- **costliest turns / largest tool outputs / slowest calls / failed calls** ranked lists
- **context %** with the same threshold coloring we could put in the composer

### How to build it zero-dependency
Their React widget uses no charting lib either — it's hand-rolled. For vanilla JS, options:
1. **SVG bars** (simplest): cost-per-turn as vertical bars, `title` tooltips, click→scroll.
   ~150 lines. No canvas, crisp at any DPI.
2. **`<canvas>` scatter/line**: smoother, more work, handles 100+ turns better.
3. **Pure HTML/CSS bars**: a flex row of `<div style="height:...">`. Zero graphics code.

**Recommendation:** start with **(3) HTML/CSS bars** for cost-per-turn + the ranked lists
(which are just styled `<ul>`). Add SVG/canvas only if you want the click-a-point graph. The
*math* is the Tier-1 port from the main adoption doc (§4.2); the *viz* is ~1–2 days on top.

- **Effort:** math port ~2 days (main doc §4.2) + HTML-bar widget ~1 day + click-to-scroll
  wiring ~0.5 day.
- **Depends on:** the awaitable-RPC/snapshot keystone (main doc §5) for clean data fetch.

---

## 5. What NOT to take from the aesthetic

| livecraft choice | Why skip |
|---|---|
| Néon / Acid Pop palettes as defaults | The exact neon-saturated AI palette design.md bans. Fine as *user-createable*, not as shipped defaults. |
| Accent gradient on the right-rail panel | A gradient; design.md bans gradient glows. Use flat `--surface` + `--line` border. |
| `backdrop-filter` anywhere | (They don't actually use it — good. Don't add it.) |
| Over-rounding (>16px) | Keep under the threshold. Their 14px message radius is the max to lift. |
| Glow halos on buttons | Their `.send` button has a `box-shadow` "depth edge" (`0 2px 0 accent-hover 35%)` — that's a *solid* depth shadow, not a glow. Fine and reusable; just don't add blur. |
| Their editable-diff (read-only) | Ours is editable + Apply. Keep ours. |

---

## 6. Suggested order (low-risk, high-visibility first)

| # | Item | Tier | Dep | Effort | Visible? |
|---|---|---|---|---|---|
| 1 | **Color-token system** (§1) | 🟢 | — | 1d | no (foundation) |
| 2 | Transcript max-width + centered (§2.8) | 🟢 | — | 15m | ✅ immediate |
| 3 | Sticky scroll-to-bottom pill (§2.7) | 🟢 | — | 1h | ✅ |
| 4 | Toasts: sticky errors (§2.5) | 🟢 | — | 0.5d | ✅ |
| 5 | Conversation detail modes (§2.1) | 🟢 | — | 0.5d | ✅ |
| 6 | Tool-call cards: expand/collapse + typed previews (§2.3) | 🟢 | #1 | 1.5d | ✅ big |
| 7 | Command palette polish (§2.4) | 🟢 | — | 1d | ✅ |
| 8 | Per-turn usage strip (§2.2) | 🟢 | analysis math | 0.5d | ✅ |
| 9 | Right-rail widget shell (§2.6) | 🟢 | #1 | 1.5d | ✅ |
| 10 | Session-analysis widget (§4) | 🟢 | #9 + math | 2.5d | ✅ flagship |
| — | *taste calls below — pick what you want* | | | | |
| 11 | Accent-filled user bubble (§3.1) | 🟠 | — | 1h | ✅ big feel shift |
| 12 | Accent assistant type + soft chips (§3.2/§3.4) | 🟠 | #1 | 1.5h | ✅ |
| 13 | Softer radii (§3.3) | 🟠 | — | 20m | subtle |
| 14 | Multi-theme editor (§3.5) | 🟠 | #1 | 2d | ✅ big |
| 15 | Sans-serif prose *option* (§3.6) | 🟠 | — | 0.5d | taste |

**Do #1 first** — everything in 🟠 and most of 🟢 gets cheaper and more consistent once the
token system is in. #2–5 are tiny, high-visibility wins to build momentum. #6 and #10 are the
features people will actually notice.

---

## 7. File reference (what to read when porting each UI item)

| Adopt | Read in pi-livecraft |
|---|---|
| §1 token system | `src/styles/base.css` (`:root` + `[data-theme="dark"]`), `docs/HOW-TO-THEME.md`, `src/features/settings/themes.ts` (`contrastColor`, `applyThemePalette`) |
| §2.1 view modes | `src/App.tsx` (`conversationView`, `nextConversationView`), `src/features/conversation/conversation.css` (`.chat-detail-*`) |
| §2.2 turn usage | `src/features/conversation/messages.css` (`.turn-usage`), `message-usage.ts` |
| §2.3 tool cards | `src/features/conversation/tool-call.css` (all), `tool-call-presentations/*`, `ToolCallCard.tsx` |
| §2.4 palette | `src/features/commands/CommandPalette.tsx`, `commands.css` |
| §2.5 toasts | `src/features/notifications/ToastStack.tsx`, `notifications.css` |
| §2.6 right rail | `src/features/right-sidebar/RightSidebar.tsx`, `right-sidebar.css`, `right-sidebar.ts` (width clamp/persist) |
| §3.1–3.4 look | `src/features/conversation/messages.css` (`.message.user/.assistant`, `.content`) |
| §3.5 themes | `src/features/settings/SettingsPanel.tsx`, `themes.ts` (full), `docs/HOW-TO-THEME.md` |
| §4 analysis viz | `src/features/session-analysis/SessionAnalysisWidget.tsx`, `session-analysis.css`, `session-analysis.ts` (`analyzeSession`, `buildSessionAnalysisPrompt`) |
| layout shell | `src/styles/base.css` (`.app-shell` grid), `src/styles/responsive.css` |

---

## 8. Decision you need to make

The fork in the road, stated plainly:

- **Path A — "keep our stance, steal their structure."** Adopt §1 (tokens) + all of §2
  (structural UX) + §4 (analysis). Stay flat/mono/anti-slop. You get a materially better,
  more capable UI without touching the aesthetic identity. Update design.md only to document
  the token migration. **Lowest risk, strongly recommended.**

- **Path B — "move toward their look."** Path A + the 🟠 items. Softer, rounder,
  accent-filled bubbles, multi-theme editor. This is a legit product direction (it's closer to
  what most users expect a "web UI" to look like), but it **rewrites design.md's anti-slop
  stance** — do it deliberately, ban-list and all, not by accretion.

Either way, **§1 (the token system) is the prerequisite** and a pure win. Start there.

---

*Analysis only. No source files in this repository were modified.*
