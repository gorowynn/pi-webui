# UI Layout & System Design Specification

> Visual source of truth for pi-webui. The live values live in
> [`../style.css`](../style.css); this spec holds the intent and the palette.

## 1. Color Palette (Obsidian — default dark)

The default is a modern dark canvas: near-black with glassy overlays and soft
violet accent glows (Arc / Linear hero vibe). Live values in
[`../style.css`](../style.css) `:root` + `[data-theme="obsidian"]`.

- **Primary Background:** near-black (`#0A0A0B`); a faint violet radial glow radiates from the top of the canvas.
- **Panel / Block Background:** `#131316` / `#1A1A20` for containers; overlay surfaces (settings sidebar, modal card, activity bar) are **glassy** — translucent `rgba(19,19,22,.72)` + `backdrop-filter: blur`.
- **Typography (Body):** near-white (`#EDEDED`) for high contrast without glare; muted `#71717A` for metadata.
- **Accent 1 (Action/Headers):** violet (`#8B5CF6`) — headings, the user-input stripe, the primary Send, and the elements that glow.
- **Accent 2 (Technical/Links):** blue (`#60A5FA`) for variables and file paths.
- **Accent 3 (Success/Status):** emerald (`#34D399`) for completed actions and file states.
- **Warn / Err:** amber `#FBBF24` / rose `#FB7185`.
- **Shape & depth:** `--r` 8px (modern/rounded); cards (`pre`, `.think`, `.tool`) lift with a soft shadow carrying a quiet violet halo.

## 2. Structural Layout & Typography Hierarchy

- **Font Family:** Global monospace font (e.g., Fira Code, JetBrains Mono) across both prose and code blocks to maintain a cohesive engineering-first feel.
- **Global Header:** A thin, full-width horizontal rule separating top metadata (model name left-aligned, theme name right-aligned in muted text) from the main content.
- **User Input Block:**
  - Enclosed in a distinct, full-width container with a slightly lighter background than the canvas.
  - A solid, vertical violet accent line (3–4px) bounds the entire left edge.
  - Preceded by a small, muted "You" label.
- **Content Sectioning:**
  - **Headings:** Large font size in the primary accent color (violet), preceded by markdown hashes (`##`).
  - **Prose Text:** Regular weight, off-white, using inline code styling (light background tint or cyan text color) for technical terms.

## 3. Code Block Design

- **Container:** A rounded-corner card spanning the content width, filled with a deep dark background.
- **Syntax Highlighting Style:**
  - **Keywords** (`export`, `function`, `return`, `let`, `for`): Bright orange or purple.
  - **Types & Variables** (`number`, `n`, `seq`): Alternating soft cyan and light pink.
  - **Comments** (`//...`): Muted slate gray.
  - **Brackets & Operators:** Light gray/white.

## 4. Status and Lists

- **Action/Status Bar:** A full-width horizontal banner signaling a file mutation (e.g., "Edit src/utils.ts"). Solid green vertical accent line on the left, green checkmark icon on the right, success-green text.
- **Key-Value Bullet Points:** A standard bulleted list at the bottom for summaries — small accent-colored bullet points, regular near-white text, and inline blue code blocks for variables.

## 5. Switchable themes (obsidian · paperlike)

The default **obsidian** is §1's palette — a near-black modern dark with glassy
overlays and violet accent glows. An alternate **paperlike** design is
switchable from the settings sidebar (appearance → theme); it is a deliberate
redesign, not a recolor:

- **Color:** warm cream paper (`#f5f0e6`) + dark warm ink (`#3a342a`), sepia
  muted text, and deeper accents (amber/cyan/lime) tuned for contrast on cream.
  The dark-theme accent alphas are kept verbatim (near-invisible either way).
- **Shape:** `--r` 2→6px (softer corners) and a soft `--shadow` on cards
  (`pre`, `.think`, `.tool`) instead of relying on hard 1px borders.
- **Type:** the transcript renders in a **system serif** (Iowan / Palatino /
  Georgia / …) at a slightly larger size for document readability; code stays
  monospace and the surrounding chrome keeps the mono identity, so the
  conversation sits in a tool frame.
- **Surfaces that needed overrides:** code listings (`pre` → paper-white), the
  thinking block (quiet violet on cream), and the diff panes (darker red/green
  labels), plus `.hljs` token colors since the vendored highlight theme is
  GitHub-Dark.

Mechanics: `:root` holds the obsidian palette (the default); obsidian's
glass/glow/gradient rules gate on `[data-theme="obsidian"]`, and paperlike
overrides via `[data-theme="paperlike"]` (later in source, wins only when its
attribute is present). The inline `<head>` script always sets the attribute from
`localStorage` before first paint (no flash); `app.js` keeps the `<select>` in
sync and persists changes (`pi:theme`).
