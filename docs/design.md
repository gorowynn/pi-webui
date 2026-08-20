---
version: alpha
name: pi-webui
description: >-
  Minimal-dependency web UI for pi. Zero-build, monospace-first, dark by
  default (Ink Black canvas + anthracite panels, Carolina Blue accent —
  GitHub-dark neutrals). Alternate "paperlike" cream theme switchable. The
  live values in public/style.css (:root) remain the normative source; the
  tokens below mirror them.
# ── colors (normative = dark theme) ──────────────────────────────────────
colors:
  # Token system: 8 source colors (canvas/surface/ink/primary/done/success/
  # attention/danger) drive the palette. Neutral constants (surface-inset/user/
  # think, hairline, fg-muted, primary-soft) are direct; derived accent/status
  # soft + hover tints use CSS color-mix() (Chrome 111+/Safari 16.2+/FF 113+,
  # all since May 2023) so they recompute per-theme without hand-mixing. These
  # frontmatter names are descriptive; style.css :root is the live source of
  # truth (--canvas/--surface/--ink/--accent/--secondary/…). Where they
  # disagree, :root wins.
  # Neutral — anthracite surfaces, Ink Black up through inset panels
  canvas: "#000000"            # Ink Black — app canvas
  surface: "#0D1117"           # Anthracite — header / sidebars / footer
  surface-inset: "#161B22"     # inset panels / assistant bubbles / inputs
  surface-user: "#1C2128"      # user bubble — a shade lighter than assistant
  surface-think: "#11161D"     # quiet inset "musing" panel
  hairline: "#30363D"          # GitHub "border.default" 1px hairline
  fg: "#E6EDF3"                # GitHub "fg.default" off-white ink
  fg-muted: "#7D8590"          # GitHub "fg.muted" metadata
  # Primary — Carolina Blue (GitHub blue): actions / headers / links
  primary: "#4493F8"
  primary-soft: "#79C0FF"      # GitHub "accent" code-blue: inline code / paths
  # Semantic
  success: "#3FB950"           # Forest Green
  attention: "#D29922"         # Amber
  danger: "#F85149"            # Coral Red
  done: "#A371F7"              # Violet — thinking-block label (GitHub "done")
# ── typography (monospace-first: chrome + prose share one family) ─────────
typography:
  body:
    fontFamily: "JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  meta:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1
# ── shapes (single radius token; paperlike softens to 6px) ────────────────
rounded:
  md: 8px                      # cards / bubbles / inputs (under the 16px slop threshold)
  pill: 999px                  # jump pill / accent chips
  circle: 50%                 # status dot
# ── components (reference tokens with {group.key}) ────────────────────────
components:
  bubble-assistant:
    background: "{colors.surface-inset}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.md}"
  bubble-user:
    background: "{colors.surface-user}"
    border: "1px solid {colors.hairline}"
    label: "You"
    labelColor: "{colors.fg-muted}"
  card:
    background: "{colors.surface}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.md}"
    shadow: "0 1px 3px rgba(0,0,0,0.4), 0 4px 12px -4px rgba(0,0,0,0.5)"
  think:
    background: "{colors.surface-think}"
    border: "1px solid #21262D"
    labelColor: "{colors.done}"
  action-primary:
    background: "{colors.primary}"
    color: "#0D1117"          # dark ink on Carolina Blue (passes WCAG AA ~5.8:1)
    radius: "{rounded.md}"
  inline-code:
    background: "#6E768133"   # GitHub "fg.subtle" @ ~20% — subtle chip
    color: "{colors.primary-soft}"
---

# pi-webui — DESIGN.md

> Visual source of truth for pi-webui. The live values live in
> [`public/style.css`](public/style.css) (`:root`); this spec holds the intent, the
> palette, and the rationale. Follows the [DESIGN.md format](https://github.com/google-labs-code/design.md).
> Frontmatter tokens mirror `:root`; where they disagree, `:root` wins.

## 1. Overview (Brand & Style)

pi-webui is a minimal-dependency web UI for
[pi](https://github.com/earendil-works/pi-coding-agent): no build step, no
React/Express/`ws` — Node built-ins + native browser `fetch`/SSE. The visual
identity matches that posture: an **engineering-first, terminal-adjacent tool**,
not a marketing page.

- **Mood:** calm, opaque, dense-but-readable. Reads like an IDE panel.
- **Philosophy — deliberately flat:** the earlier default was a near-checklist
  of AI-slop tells ([impeccable.style/slop](https://impeccable.style/slop/)) —
  a violet/cyan-on-dark "AI color palette", a violet hero aurora glow,
  frosted-glass (`backdrop-filter`) overlays, and glowing accent box-shadow
  halos. All were removed. The look is now **Ink Black canvas + anthracite
  panels + a single Carolina Blue accent**, flat and opaque, with hierarchy
  carried by hairline borders and background contrast rather than glow.
- **Themes:** the default `dark` (above) is normative. An alternate
  **`paperlike`** cream theme is switchable from the settings sidebar. Theme is
  the `<html data-theme>` attribute, persisted in `localStorage["pi:theme"]`;
  an inline `<head>` script sets it before first paint (no FOUC) and migrates a
  stale `obsidian` value → `dark`. `app.js` keeps the `<select>` in sync.

## 2. Colors

Normative = the **dark** theme. Descriptive names below map to the frontmatter
tokens (the hexes are the source of truth).

**Neutral — anthracite (the surfaces):**

- **Ink Black** `canvas` (`#000000`) — app canvas.
- **Anthracite** `surface` (`#0D1117`) — header, sidebars, footer (GitHub canvas tone).
- **Inset** `surface-inset` (`#161B22`) — assistant bubbles, inputs, block containers.
- **User** `surface-user` (`#1C2128`) — user bubble, one shade lighter than the assistant.
- **Hairline** `hairline` (`#30363D`) — the single 1px border tone (GitHub `border.default`).
- **Off-white** `fg` (`#E6EDF3`) and **muted** `fg-muted` (`#7D8590`) — ink and metadata.

**Primary — Carolina Blue (GitHub blue):**

- `primary` (`#4493F8`) — headings, primary Send, active states, links. Solid, never glowing.
- `primary-soft` (`#79C0FF`) — inline code, file paths, variables (GitHub code-blue).

**Semantic:**

- `success` **Forest Green** (`#3FB950`); `attention` **Amber** (`#D29922`);
  `danger` **Coral Red** (`#F85149`); `done` **Violet** (`#A371F7`) — reserved
  for the thinking-block label.

**Alternate — `paperlike`:** a deliberate redesign, not a recolor. Warm cream
paper (`#F5F0E6`) + dark warm ink (`#3A342A`), sepia muted text, and deeper
semantic accents. The current muted/semantic small-text pairs do **not** all
reach WCAG AA 4.5:1 on raised cream surfaces; the measured gaps and required
token audit are tracked in [`improvements.md`](improvements.md). `--r` softens
`2→6px` and cards gain a soft shadow. The transcript also renders in a **system serif**
on the cream surface, so the conversation reads as ink-on-paper while the chrome
stays mono. Surfaces that needed overrides: code listings (paper-white), the
thinking block (quiet violet on cream), diff panes, and `.hljs` tokens.

## 3. Typography

**Monospace-first.** One family — `JetBrains Mono → Fira Code → system mono`
— is used across header, footer, sidebar, tools, code, *and* prose, for a
cohesive engineering-first feel (GitHub-dark style; no separate prose face in
the default theme). Hierarchy comes from **size, weight, and color**, not a
second typeface.

- **Body / prose** `body` — 13px / 1.6, the global mono stack.
- **Code** `code` — `ui-monospace` stack at 13px / 1.45 (tab-size 2).
- **Labels** `label` — 11px / 500, uppercase, `0.05em` tracking: tool/type tags, the "You" label, status-bar captions.
- **Meta** `meta` — 12px mono for header status / model / theme name.
- **Headings** — accent-colored (`primary`), sized via an `em` scale (`##`), preceded by markdown hashes.
- **Inline code** — subtle blue-gray chip (`#6E7681` @ ~20%) + `primary-soft` text.

## 4. Layout (Layout & Spacing)

- **Frame:** a thin full-width header with the brand, continuously visible
  **repo/model** context, connection state, and compact actions. Live secondary
  telemetry is centered in the remaining header width and fills it in priority
  order; only trailing non-fitting items move into the accessible `details`
  popover. A left
  **workspace/session sidebar**; the **transcript** center; and the **composer**
  input at the bottom complete the shell. Addressable utility views such as
  `#permissions` reuse it and replace the center transcript/composer region with
  a bounded page, rather than opening a nested modal.
- **Workspace/session sidebar:** workspace and session lists use separated
  sections, clear active-row tint, compact metadata, and semantic labels. On
  mid/narrow widths it remains the same keyboard-accessible drawer rather than
  becoming a second navigation model.
- **Inspector rail:** the right workspace-tools rail is a **64px compact**
  strip with visible icon + text labels and readable status badges. Native hover
  titles and accessible names remain as a fallback; selected state is a soft
  background + accent icon with a quiet boundary, never a side stripe. The
  selected tab opens a roomier calm inset detail pane; on mid/narrow widths it
  becomes a contained bottom sheet with trapped focus and an Escape/close path
  that restores the rail trigger. The Usage view is headed `TURN HISTORY`,
  keeps the last 100 billed model turns, and overlays per-turn context usage.
- **Conversation density:** the header control cycles **Focus → Balanced → Trace**;
  **Balanced** is the default. Focus hides successful tool work but keeps failures,
  Balanced collapses each turn's tool activity to a summary, and Trace exposes raw
  result panels. Persisted internal values remain `simple` / `semi` / `detailed`.
- **Turn hierarchy:** assistant prose is an open reading surface; user prompts are
  compact right-aligned cards; tool and system turns retain their own containers
  so errors, approvals, and operational notices stay prominent.
- **User input block:** a distinct full-width container on a slightly lighter
  anthracite shade than the canvas, distinguished by background + a small muted
  "You" label — **no left accent stripe** (side-tab accent borders are a top slop tell).
- **Key-value bullets:** small accent-colored bullets, regular off-white text,
  inline code chips for variables.
- **Spacing:** ad-hoc per-component px (4 / 6 / 8 / 10 / 12 / 14 / 16) — there
  is **no formal spacing-scale token** in `:root`; component padding/margin is
  set directly. (Add a `--sp` ramp if a shared scale becomes load-bearing.)

## 5. Elevation & Depth

**Flat.** Visual hierarchy is carried by **1px hairline borders** (`hairline`)
and **background contrast** between `canvas`, `surface`, and `surface-inset`,
plus a single **neutral-black soft shadow** on standalone cards (`pre`, `.think`,
and legacy `.tool`); turn-grouped tool rows intentionally remain flat:

`0 1px 3px rgba(0,0,0,0.4), 0 4px 12px -4px rgba(0,0,0,0.5)`

Explicitly absent (deliberate anti-slop removals): colored glow halos on dark,
glassmorphism (`backdrop-filter` blur), and hero aurora gradients. State is
signaled by background + accent text, never by elevation or a stripe.

## 6. Shapes

A single radius token, `--r` = `rounded.md` (**8px**) — cards, bubbles, inputs,
buttons all share it; it stays under the 16px over-rounding threshold. Two
component-specific exceptions: the status dot uses `circle` (`50%`), and the
jump pill / accent chips use `pill` (`999px`). `paperlike` softens `--r` to 6px.

## 7. Components

- **Bubbles** — `.bubble.user` (`surface-user`) is the compact user card;
  assistant prose is an open `.assistant-turn` reading surface with no side
  stripe. The "You" label is muted mono; thinking remains an inset panel.
- **Cards** — `pre` code blocks and the shared card treatment: `surface`
  background, hairline, `--r` radius, neutral shadow.
- **`.think`** (assistant reasoning) — `surface-think` inset panel, a `#21262D`
  border, a `done` (violet) label + spinner while streaming; mono body.
- **Tool activity** — consecutive calls in an agent turn live in one native
  `<details>` `.tool-group`, headed by `N tools · state · elapsed`. It has one
  outer hairline; nested `.tool` rows are flat. Successful groups collapse in
  Balanced, Trace opens them, and errors stay exposed.
- **`.tool` (inside tool activity)** — a full-width row for file mutations,
  carried by the status icon on the left (`●` running / `✓` done / `✗` error)
  and the tool-name color — **no left accent stripe**.
- **Code highlighting** — vendored **highlight.js v11 `github-dark`**: keywords
  red/purple, strings light blue, functions purple, numbers blue, comments gray.
  Degrades to uncolored if the vendor file is missing.
- **Diffs** — red/green line panes, monospace, `surface` background.
- **Permission request** — a full-page modal with risk summary, matched
  rule/scope, bounded command or U5 Review/Edit diff, and a sticky decision
  row. A warning notification accompanies a newly arrived request; the tool
  card remains status-only.
- **Permissions page** — a full center utility page with compact overview cards,
  structured rule rows, active grants, pending requests, redacted audit, and an
  advanced validated source editor. The rail contains only its badge/launcher.
- **Composer** — `.composer` is a full-width `surface-raised` writing block;
  the textarea uses `surface-inset`, the action row has a quiet divider, image
  drag/drop gets an accent border without adding a new overlay, and a visible
  Image action follows the selected model's image capability.
- **Actions** — primary button / Send / jump pill: solid `primary` (Carolina
  Blue) with dark ink text.

## 8. Permissions and approval

Permission UI is a security workflow, not a generic four-button select. The
extension policy remains authoritative; browser risk text is explanatory only.

### 8.1 Pending approval

- Render every blocking tool interaction in one full-page modal, keyed by
  `toolCallId`; the originating tool card remains a status record only.
- Lead with a one-line action summary, workspace-relative resource, deterministic
  risk level/reasons, and “Matched rule” disclosure. Raw structured arguments
  stay behind an expandable Details control. Show a warning notification when a
  new interaction modal opens.
- Bash detail uses a non-wrapping code block with explicit subcommand boundaries.
  Edit/write uses the shared U5 Review/Edit surface and reports baseline conflict
  before any allow action becomes available.
- Decision labels state their real scope: **Allow once**, **Allow this exact
  action for this session**, **Allow in this workspace**, and **Deny**. A global
  grant is available only from the Permissions page's advanced flow.
- Persistent/sensitive grants require a second scope confirmation. Deny remains
  visible at all times; neither an allow control nor the diff editor receives an
  implicit Enter/default action.
- Initial focus lands on the dialog heading or Deny. Escape and backdrop
  dismissal mean Deny. While a response is being acknowledged, controls disable
  without hiding the reviewed content; failure restores them with Retry.
- A minimized or offscreen request leaves a persistent rail badge and status
  text. The modal shows “Waiting for approval”, focuses its first actionable
  control after async rendering, and restores focus to the prior control or
  composer on close. Resolution, timeout, abort, another-tab response, Pi exit,
  or workspace switch removes/neutralizes every duplicate surface.

### 8.2 Dedicated WebUI Permissions page

The page is addressable at `#permissions` inside the existing `index.html`
shell. Open it from Settings, Alt+K, and the right-rail shield badge. Back returns
to the prior conversation and restores focus/scroll. Unsaved changes block
navigation with Save / Discard / Stay.

Desktop information shape (illustrative, not literal pixel art):

```text
┌ ← Conversation   Permissions                         policy healthy · 2 grants ┐
│ Workspace: pi-webui     Mode: Default     Headless: Block     Pending: 1       │
├ Rules ─ Active grants ─ Pending ─ Audit ─ Explain ─ Advanced ──────────────────┤
│ Current workspace rules                                      + Add rule        │
│ ? Ask   bash    npm publish *          workspace   user rule       Edit · Delete│
│ ⛔ Deny  read    **/.ssh/id_*           built-in    locked           Explain    │
│                                                                               │
│ Built-in floor (read only)                                      8 rules        │
└───────────────────────────────────────────────────────────────────────────────┘
```

Page structure, top to bottom:

1. **Overview:** current workspace, policy/config health, effective mode,
   headless posture, pending count, and active-grant count. Errors are persistent
   and actionable, never toast-only.
2. **Rules:** grouped sections for immutable built-in floor, user-global rules,
   and current-workspace rules. Each row shows effect, tool, typed matcher,
   provenance, remember eligibility, enabled state, and Edit/Delete actions.
3. **Active grants:** exact normalized scope, source surface, creation time/
   expiry, and Revoke; include a confirm-gated Clear Session Grants action.
4. **Pending:** links to the originating tool card and the current full-page
   review surface; the page does not create a second independent decision.
5. **Audit:** bounded, redacted decision metadata (tool, risk, rule ID, decision,
   scope, duration, surface). Never persist raw secret-bearing commands or file
   contents; use a safe summary plus fingerprint.
6. **Explain:** tool + typed sample input → canonical selector, matched rules,
   precedence, final effect, risk reasons, and whether each remember scope is
   eligible. Explain is read-only and runs the same server/policy module as Pi.
7. **Advanced source:** raw versioned JSON with schema errors, normalized preview
   and old/new diff. Save stays disabled until valid and requires the expected
   config revision.

The structured editor is the primary path. Tool is selected from registered
names; matcher controls change by selector kind (command, path, agent, typed
input); effect is Allow / Ask / Deny; scope is user-global or current workspace.
Project-owned files may add Deny or mandatory Ask but cannot create grants.
Default-floor rows are inspectable and copyable but not editable.

At widths below the content breakpoint, overview cards become one column and
rule rows become labelled definition cards. Editing uses a full-screen sheet;
there is no horizontally scrolling desktop table requirement. Every tab/filter
is a native button, every row action is keyboard reachable, validation uses
`aria-describedby`, save status uses one coarse live region, and color is never
the only indicator of Allow/Ask/Deny.

### 8.3 Visual hierarchy

- Pending uses `warning` only for attention; high risk uses `danger`; ordinary
  manual review keeps neutral surfaces. Do not paint every approval red.
- Rule effects use text + icon (`✓ Allow`, `? Ask`, `⛔ Deny`) and subdued chips.
- The default floor is visually quieter but clearly locked. Workspace rules are
  the normal editing focus; global grants receive stronger scope warnings.
- Keep the page dense and IDE-like: hairlines, opaque surfaces, one-column forms,
  no dashboard gradients, oversized security illustrations, or celebratory
  “autonomy” treatment.

### 8.4 Subagent fleet page

Background (async) pi-subagents runs get an in-shell page (`#fleet`) that reuses
the permissions/settings chrome: sticky `.perm-head`, 900px `.perm-body`.

- Rows are quiet hairline cards: description/agents in ink, a small state chip
  (running = success, queued/paused = warning, failed/rejected = danger,
  done = success text only), and a muted mono meta strip
  (`mode · agents · elapsed · turns · current tool`).
- Per-step lines under a hairline rail; log buttons are small ghost buttons,
  not links. Logs render as capped (260px) mono `<pre>` on canvas, tail-marked.
- The steer input lives in the page header (right of the title) — it is a
  per-run control, so the targeted row gets the accent border (`.sel`), never a
  modal. Stop is confirm-gated and uses the danger outline.
- Completion/steer notices in the transcript are slim cards with a 3px
  left rule (ok/warn/err), first preview line only, session ids muted mono —
  same restraint as 8.3: hairlines, opaque surfaces, no dashboard theatrics.

## 9. Do's and Don'ts

**Don't** (each is a recognized AI-slop tell that was stripped out — don't
re-add it):

- The violet/cyan-on-dark "AI color palette" — use the Carolina Blue accent instead.
- Glowing box-shadow accents (halos) on dark-mode elements.
- Glassmorphism / `backdrop-filter` blur overlays.
- Hero aurora / radial-gradient glows.
- Side-tab accent stripes on bubbles, tool/think cards, sidebar rows, or rail steps.
- Over-rounded corners (radius > 16px) and neon-saturated cyan.
- A primary-UI global bypass, default-focused Allow, hidden Deny, or raw
  secret-bearing commands in persisted audit/history.
- A browser-evaluated duplicate of the extension policy or a generic endpoint
  that accepts the safeguard config path.

**Do:**

- Flat, opaque surfaces; 1px hairlines + a neutral black shadow for the only depth.
- Anthracite neutrals with one Carolina Blue accent; status colors only for state.
- Monospace-first, with hierarchy via size/weight/color. (Mono-everywhere is a
  deliberate identity, not the slop "single font everywhere" — the hierarchy
  compensates.)
- Signal active/selected state with background + accent text, never a stripe.
- Keep policy decisions extension-authoritative, config/workspace resolution
  server-authoritative, and every permission response acknowledged/fail-closed.
