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
> [`../style.css`](../style.css) (`:root`); this spec holds the intent, the
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
accents (amber/cyan/lime) tuned for contrast on cream; `--r` softens `2→6px`
and cards gain a soft shadow. The transcript also renders in a **system serif**
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

- **Frame:** a thin full-width header (model left-aligned, theme name + status
  right-aligned in muted text) above the main area; a left **workspace/session
  sidebar**; the **transcript** center; the **composer** input at the bottom.
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
plus a single **neutral-black soft shadow** on cards (`pre`, `.think`, `.tool`):

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

- **Bubbles** — `.bubble` (assistant = `surface-inset`) and `.bubble.user`
  (`surface-user`): 1px hairline, no side-stripe. The "You" label is muted mono.
- **Cards** — `pre` code blocks and the shared card treatment: `surface`
  background, hairline, `--r` radius, neutral shadow.
- **`.think`** (assistant reasoning) — `surface-think` inset panel, a `#21262D`
  border, a `done` (violet) label + spinner while streaming; mono body.
- **`.tool` (status bar)** — a full-width banner for file mutations, carried by
  the status icon on the left (`●` running / `✓` done / `✗` error) and the
  tool-name color — **no left accent stripe**.
- **Code highlighting** — vendored **highlight.js v11 `github-dark`**: keywords
  red/purple, strings light blue, functions purple, numbers blue, comments gray.
  Degrades to uncolored if the vendor file is missing.
- **Diffs** — red/green line panes, monospace, `surface` background.
- **Actions** — primary button / Send / jump pill: solid `primary` (Carolina
  Blue) with dark ink text.

## 8. Do's and Don'ts

**Don't** (each is a recognized AI-slop tell that was stripped out — don't
re-add it):

- The violet/cyan-on-dark "AI color palette" — use the Carolina Blue accent instead.
- Glowing box-shadow accents (halos) on dark-mode elements.
- Glassmorphism / `backdrop-filter` blur overlays.
- Hero aurora / radial-gradient glows.
- Side-tab accent stripes on bubbles, tool/think cards, sidebar rows, or rail steps.
- Over-rounded corners (radius > 16px) and neon-saturated cyan.

**Do:**

- Flat, opaque surfaces; 1px hairlines + a neutral black shadow for the only depth.
- Anthracite neutrals with one Carolina Blue accent; status colors only for state.
- Monospace-first, with hierarchy via size/weight/color. (Mono-everywhere is a
  deliberate identity, not the slop "single font everywhere" — the hierarchy
  compensates.)
- Signal active/selected state with background + accent text, never a stripe.
