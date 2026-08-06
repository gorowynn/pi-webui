# Adopting pi-livecraft's rendering: markdown · tool output · images

> Companion to [`pi-livecraft-ui-adoption.md`](./pi-livecraft-ui-adoption.md). This doc covers
> the three *content rendering* subsystems in depth: how each project parses and renders
> **markdown prose**, **tool call output**, and **images** (input + display).
> Source audited: pi-livecraft v1.1.0. Target: this repo's zero-build vanilla-JS frontend.
> **Analysis only — no code changed.**

---

## 0. Capability snapshot

| | pi-webui (today) | pi-livecraft |
|---|---|---|
| **Markdown engine** | Vendored **markdown-it 14.x** UMD via `md.js` (`html:false`/`breaks:true`/`linkify:true`); `esc()` global escaper. `<a target=_blank>`. | **react-markdown + remark-gfm** (full GFM: tables, strikethrough, autolink-literals, task lists). |
| **Code highlighting** | Vendored **highlight.js 11** `github-dark`, run **synchronously** over every `pre code` after render (`highlightCode()`). Fixed CSS theme. | **Prism (PrismLight)**, **lazy-loaded per block** via `IntersectionObserver` (800px rootMargin), 8 registered langs, **theme tokens via CSS vars** (`var(--accent)` etc.). |
| **Frontmatter** | None. | Leading `--- yaml ---` parsed (`yaml` dep) → rendered as a Property/Value table above the body. |
| **Tool output** | Flatten `content[].text` → `textContent` in a `<details>`. Raw text, **no typed previews**. Special: `edit`/`write` (editable LCS diff), `subagent` (live view), `compact`. | **Content-type detection by file extension** → CSV table / rendered Markdown / **sandboxed HTML iframe** / SVG-as-img / line-numbered highlighted code / bounded text preview. |
| **Tool output bounds** | None — a 50KB `read` renders in full. | First-N-lines preview + "view M more"; **height-preserving offscreen placeholder** (ResizeObserver) so long transcripts don't relayout. 50K-char highlight cap. |
| **Edit diff** | **Line-level LCS**, editable new pane + Apply. | **Word-level intra-line diff** (`diffWords`) on Pi's `details.diff` string; read-only. |
| **Images (input)** | **None.** Composer is text-only; no image content part handled. | Paste → **canvas downscale + JPEG quality loop** → raw base64; max 4 imgs; model-capability gated. |
| **Images (display)** | **None.** `nonEmptyContent()` ignores `type:"image"`. | `{type:"image"}` → `<img src="data:...">`, max 480×420. |

**Headline:** pi-webui's markdown layer is solid and arguably *more* dependency-minimal
(vendored markdown-it vs react-markdown+remark-gfm+react-syntax-highlighter+yaml = 4 npm
deps). The gaps are (a) **deferred/highlight-token theming** for code, (b) the entire
**typed tool-output rendering** layer, and (c) **images** (input + display). All three are
portable to vanilla JS without adopting their stack.

---

## 1. Markdown

### 1.1 Keep markdown-it — don't switch to react-markdown
react-markdown + remark-gfm + react-syntax-highlighter + yaml is **4 runtime npm deps** and a
React render tree per message. Our `md.js` is a vendored UMD + a 105-line shim, zero npm deps,
returns an HTML string. For a zero-build project this is the right call. **Do not migrate.**

What's worth lifting from their setup is *behavior*, not the engine:

### 1.2 🟢 Deferred code highlighting (the big win)
Their `MarkdownCode` component (`Markdown.tsx`) wraps each fenced block in an
`IntersectionObserver` with `rootMargin: '800px'` — highlighting **only fires when the block is
within 800px of the viewport**, and only once (then it sticks). A `Suspense` fallback shows
plain code meanwhile.

**Why it matters here:** our `highlightCode()` (`app.js:236`) runs `hljs.highlightElement()`
**synchronously on every `pre code` in the bubble, all at once**, right after render. On a long
assistant message or a big paste this janks the frame. The fix is a ~25-line vanilla wrapper:

```js
// highlightCode replacement: defer until near viewport
function highlightCode(root) {
  if (!window.hljs || !root) return;
  const blocks = root.querySelectorAll("pre code:not([data-highlighted])");
  if (!blocks.length) return;
  if (!("IntersectionObserver" in window)) {           // graceful fallback
    blocks.forEach(hl); return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (e.isIntersecting) { hl(e.target); obs.unobserve(e.target); }
    }
  }, { rootMargin: "800px" });
  blocks.forEach((b) => io.observe(b));
}
function hl(el) {
  el.dataset.highlighted = "1";
  try { window.hljs.highlightElement(el); } catch (e) {}
}
```

- **Effort:** ~30 min. Pure win, no visual change.
- **Risk:** none. IO is supported everywhere we care about; fallback is today's behavior.

### 1.3 🟢 Theme-token-driven syntax colors
Their Prism "theme" (`CodeHighlighter.tsx`) is a JS object mapping token types to **CSS
variables**: `keyword→var(--accent)`, `string→var(--success)`, `comment→var(--muted)`,
`number→var(--warning-strong)`, `function→var(--secondary)`, etc. So highlighting **recolors
with the active theme automatically** — no per-scheme CSS file.

We ship `vendor/highlight.css` (github-dark) — a fixed palette. Once the **color-token system**
is in (UI doc §1), we can replace it with a token-driven sheet:

```css
.hljs { color: var(--ink); background: transparent; }
.hljs-comment, .hljs-quote        { color: var(--muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag { color: var(--accent); }
.hljs-string, .hljs-attr          { color: var(--success); }
.hljs-number, .hljs-literal       { color: var(--warning); }
.hljs-title, .hljs-function       { color: var(--secondary); }
.hljs-type, .hljs-class           { color: var(--warning); }
.hljs-tag, .hljs-name             { color: var(--danger); }
.hljs-attr, .hljs-attribute       { color: var(--success); }
/* …map the ~15 hljs token classes to your 8 source tokens… */
```

- **Effort:** ~1 hour (map hljs classes → tokens), gated on the token-system migration.
- **Bonus:** highlight then matches light/dark/paperlike/custom themes with zero extra files.

### 1.4 🟡 Markdown frontmatter → table (for tool reads of `.md` files)
`parseMarkdownFrontmatter()` (`markdown-frontmatter.ts`) extracts a leading `--- … ---` YAML
block and renders `key: value` pairs as a table above the rendered body. Used when the `read`
tool reads a `.md` file (their `Markdown renderFrontmatter`).

- **The dep problem:** they use the `yaml` npm package (full YAML). We're zero-dep. Options:
  - **(a)** Hand-roll a *minimal* frontmatter parser (only flat `key: value` lines, no nested
    structures/anchors/flow). Covers 95% of real AGENTS.md/design.md frontmatter. ~40 lines.
  - **(b)** Vendor a tiny YAML lib (e.g. `js-yaml` is ~100KB minified — heavy).
  - **(c)** Skip it.
- **Recommendation:** **(a)** if/when typed tool-output rendering lands (§2); it's really a
  tool-output feature (read a `.md` → see its frontmatter), not a prose feature.

### 1.5 🟡 GFM task-list checkboxes
markdown-it's default preset gives us tables + strikethrough (the md.js comment confirms this).
What we *don't* get is **task lists** (`- [ ]` / `- [x]` → checkboxes) — that needs the
`markdown-it-task-lists` plugin or a tiny `render` rule. Low value; skip unless you render a lot
of TODO-style markdown.

---

## 2. Tool output rendering (the headline gap)

This is where pi-livecraft is dramatically ahead. Our tool box shows raw `textContent`; theirs
does content-type detection and typed rendering. **All of this is vanilla-portable** — it's pure
DOM + a couple of small parsers.

### 2.1 The detection + dispatch model
`tool-presentation.ts` `readContentDisplay(args)` inspects the `read`/`write` tool's `path`
extension and returns a `kind`:

| Extension | `kind` | Render |
|---|---|---|
| `.csv` | `csv` | Bounded table (§2.3) |
| `.md`/`.markdown` | `markdown` | Rendered markdown (+ frontmatter table) |
| `.htm`/`.html` | `html` | Sandboxed iframe (§2.4) |
| `.svg` | `svg` | `<img>` from data URL (§2.5) |
| `.js/.ts/.json/.css/.sh/...` | `code` | Highlighted, line-numbered (§2.2) |
| else | `text` | Plain `<pre>` |

A `toolCallPresentations` registry (`bash`/`read`/`edit`/`write`/`find`/`grep`) decides the
**header** (e.g. `bash` puts the command in the header + timeout in status). This is the
tool-presentation registry from the main adoption doc (§4.4) — the output rendering below is
the other half of the same system.

### 2.2 🟢 Line-numbered highlighted code
`NumberedPre` renders `<pre>` with a right-aligned, dimmed line-number gutter, **starting at the
`read` tool's `offset`** (so reading lines 500–520 shows 500, 501…). Highlighting is the same
deferred-highlighter from §1.2, capped at 50K chars (`canHighlightFile`) — beyond that it falls
back to plain numbered pre with a "Highlighting disabled beyond 50,000 characters" notice.

- **Effort:** ~0.5 day. `NumberedPre` is ~15 lines; wire `offset` from the `read` args.

### 2.3 🟢 Bounded CSV table (`csv-preview.ts`)
`parseCsvPreview(content)` is a **hand-rolled, allocation-bounded CSV parser** — no dep. It
scans only the first 64KB and produces at most 8 columns × 20 rows × 160 chars/cell, handling
quoted fields, escaped `""`, and `\r\n`. Anything beyond the limits sets `truncated: true` and
the UI shows "Preview limited for performance" + a "View source" toggle (which shows the first
20KB raw via `csvSourcePreview`).

- **Why it's good:** a 5MB CSV never materializes in the DOM. The scan budget is the key idea.
- **Effort:** ~0.5 day. The parser (`csv-preview.ts`, ~90 lines) ports almost verbatim — it's
  pure JS, no React. Drop into a new `public/csv-preview.js`.

### 2.4 🟢 Sandboxed HTML preview (with a real sanitizer)
For `.html` reads, render an `<iframe sandbox=""> srcDoc={stripScripts(content)}>`.

Two layers of defense, both worth copying exactly:
1. **`sandbox=""`** — the empty sandbox token string is the *most restrictive* mode: no scripts,
   no forms, no popups, no same-origin, no plugins. The content cannot touch the parent.
2. **`stripScripts(html)`** (`tool-presentation.ts`) — defense-in-depth *before* injection:
   strips `<script>…</script>` and `<script/>`, all `on*=` event handlers, and `javascript:`
   `href`/`src`/`action`/`formaction`/`poster`/`xlink:href` values.

```js
function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>(?:[\s\S]*?<\/script\s*>|[\s\S]*)/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(/<\/script\s*>/gi, "")
    .replace(/\s+on[a-z][\w:-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|src|action|formaction|poster|xlink:href)\s*=\s*
      (?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, "");
}
```

- **Their caution:** the HTML preview is **opt-in** (`showHtmlPreview` state) — it defaults off
  until the user clicks to render, showing plain code first. Good instinct for untrusted output.
- **Effort:** ~0.5 day. `stripScripts` ports verbatim; the iframe is one element.
- **Risk:** low *if* you keep both layers (empty sandbox + strip). Never render HTML output
  without the sandbox attribute. Never set `sandbox="allow-scripts"`.

### 2.5 🟢 SVG as `<img>` (safe by construction)
`<img src="data:image/svg+xml;charset=utf-8,{encodeURIComponent(content)}">`. An `<img>` loaded
from an SVG data URL **does not execute scripts** in the SVG (unlike embedding SVG inline in the
DOM, where `<script>` and `onload=` would run). This is the safe way to preview SVG output.

- **Effort:** ~10 min. One element.
- **Risk:** none, *if* you use `<img>` (not inline SVG / not `srcdoc`).

### 2.6 🟢 Bounded text preview + "view more"
`toolTextPreview(text, maxLines=4)` returns the first N lines + a `remainingLineCount`, rendered
as "Click to view M more lines". Clicking expands the full content. Prevents a 2000-line `grep`
result from dominating the transcript.

- **Effort:** ~2 hours. ~25 lines; wire into the existing `tool_execution_end` text path.

### 2.7 🟢 Height-preserving offscreen placeholder (virtualization)
The subtle perf trick in `ToolCallPreview`: a `ResizeObserver` records the rendered preview's
height; when it scrolls out of view, the expensive rendered content is replaced by a
`<div style="height:{measured}px">` placeholder so the scroll position and document height stay
stable. Re-entering viewport re-renders.

- **Why:** a transcript with 40 expanded tool outputs keeps all their DOM/syntax nodes alive,
  making scroll janky. This keeps only on-screen ones materialized.
- **Effort:** ~0.5 day. Only worth it once you have typed previews that are expensive to keep
  mounted (highlighted code, CSV tables). Pair with §2.2–2.3.
- **Vanilla note:** `ResizeObserver` + `IntersectionObserver` are both native; no dep.

### 2.8 🟡 Word-level intra-line diff
Our `edit`/`write` diff is **line-level LCS** (a line is added/removed/context). Their
`editDiffDisplayLines()` + `intraLineDiff()` does **word-level** diffing *within* a changed
line pair: for a single removed→added line pair, it runs `diffWords()` and highlights just the
changed words, not the whole line. Mirrors Pi's own edit renderer.

- **The dep problem:** they use the `diff` npm package (`diffWords`). We're zero-dep. Options:
  - **(a)** Hand-roll a word-diff (split on `\s`, LCS over word tokens). ~60 lines. Our existing
    `diffLines()` (`app.js:620`) already does LCS over lines — generalize it to tokens.
  - **(b)** Vendor `diff` (~30KB). Against the minimal-deps ethos but defensible.
  - **(c)** Keep line-level (it's already good; our pane is *editable*, theirs isn't).
- **Recommendation:** **(a)** — extend our own LCS to operate on word-token arrays. Reuses
  existing, tested code; no new dep. ~1 day. Lower priority than §2.2–2.6.
- **Note:** they parse Pi's pre-rendered `details.diff` string (`+ / - / space` + line numbers);
  we build the diff ourselves from `oldText`/`newText`. Different inputs, same visual goal.

### 2.9 🟢 Tool protocol extraction layer (`tool-protocol.ts`)
This isn't rendering per se — it's the **robust extraction** of tool calls/results from Pi's
message format. Worth adopting as the model for refactoring our ad-hoc `toolBlock` state:

- `toolCallsInMessage(message)` — pull every `{type:"toolCall", id, name, arguments}` from an
  assistant message's `content[]`.
- `toolCallInUpdate(event)` — track **streaming** tool-call generation across
  `toolcall_start`/`toolcall_delta`/`toolcall_end` by `contentIndex`, with an `interrupted`
  state when generation ends without an `end` event.
- `toolResultInMessage(message)` — validated `{toolCallId, toolName, content, isError, details}`
  from a `toolResult` message.
- `toolExecutionUpdateInEvent(event)` — partial results (`tool_execution_update`).
- `toolContentText(content)` — flatten nested content arrays (handles `{content:{content:[…]}}`)
  to text.

Our `app.js` does this inline and less defensively (e.g. we don't track `contentIndex` or
`interrupted` states). Porting this as a `public/tool-protocol.js` module would make the render
layer cleaner and fix edge cases (interrupted tool-call generation, nested result shapes).

- **Effort:** ~1 day to port + rewire `toolBlock`/`tool_execution_*` handlers.
- **Risk:** medium — touches the SSE hot path (GOTCHAS #6/#7). Test against the smuggle channels.

---

## 3. Images

pi-webui has **no image support** today — not input, not display. This is the biggest pure-add.

### 3.1 🟢 Image input with client-side compression (`composer-images.ts`)
The algorithm is the valuable part and it's zero-dep (canvas + FileReader + Image):

1. Load the pasted `File` into an `HTMLImageElement` via `URL.createObjectURL` (revoke after
   decode — no leak).
2. Cap the longest dimension at **1600px** (preserve useful model resolution).
3. Draw to a canvas with a **white background** first (flattens PNG transparency so JPEG encode
   doesn't black-out the alpha).
4. Encode as **JPEG** at descending quality `[0.84, 0.72, 0.6, 0.5]` until the blob is
   **≤350KB**.
5. If still too big, **shrink 80% and repeat**; give up at ≤640px (returns null → "could not be
   prepared").
6. Strip the `data:` URL prefix → **raw base64** + `mimeType:"image/jpeg"` (Pi's RPC format
   expects raw base64, not a data URL).
7. Max **4 images** per message.

**Why this design is right for us:**
- Bounds the **HTTP body** (our server has a 1MB cap — a 350KB×4 worst case fits with the text).
- Bounds the **model context** (token cost ≈ image resolution).
- Always-JPEG means a pasted PNG screenshot gets compressed (huge savings).
- No server-side work — all client-side.

**The send shape:** images go in the `prompt` RPC command's content array alongside text:
```js
api({ type: "prompt", message: text, images:
  [{ type: "image", data: base64, mimeType: "image/jpeg" }, ...] });
```
(Check Pi's RPC — the field may be `message` as a content array, or a sibling `images[]`. Their
`onSend(message, images, behavior, isCommand)` builds the content array in `App.tsx`.)

**Model-capability gating:** before send, check the selected model's `input` includes `"image"`;
if not, block with "The selected model does not accept images." (`snapshot.models[].input`).

- **Effort:** ~1 day. `composer-images.ts` (~75 lines) ports near-verbatim to vanilla; the
  composer UI (paste handler, thumbnail strip with remove buttons) is ~0.5 day of DOM.
- **Dep:** none. Canvas/FileReader/Image are native.
- **Risk:** low. Body-cap interaction — confirm our 1MB server cap accommodates 4×350KB + text
  (it's tight; may need to raise the cap or lower per-image to 256KB).

### 3.2 🟢 Image display in messages (`message-display.ts`)
Two tiny pieces:
1. **`isImageContent(part)`** — accept `{type:"image", data:string, mimeType}` where mimeType
   matches `^image/(gif|jpeg|png|webp)$`.
2. **Include it in "is this message visible?"** — `hasVisibleContent()` counts an image part as
   content, so a user message that is *only* an image isn't treated as empty/hidden.

Rendering: `<img class="message-image" src="data:{mimeType};base64,{data}">` with
`max-width:min(100%,480px); max-height:420px; object-fit:contain`.

**Our gap:** `nonEmptyContent()` (`app.js:222`) only keeps `type:"text"` and `type:"thinking"`.
Add `type:"image"` there, and emit an `<img>` in `renderAssistantContent`/`renderMessage`.

- **Effort:** ~1 hour. ~15 lines across two functions + a CSS rule.
- **Risk:** none. Pure additive render path.

### 3.3 Reasoning-text ANSI stripping (bonus, adjacent)
`message-display.ts` `reasoningTextForDisplay()` strips terminal **SGR escape sequences**
(`\x1b[…m` and the C1 0x9B variant) from assistant reasoning before rendering. We already have
`stripAnsi()` (`app.js:54`) covering the basic `\x1b[…m` form, but **not the C1 0x9B variant**.
Their regex is more complete:

```js
const ESC = String.fromCodePoint(0x1B);
const C1_CSI = String.fromCodePoint(0x9B);
const SGR = new RegExp(`(?:${ESC}\\[|${C1_CSI})[0-?]*[ -/]*m`, "g");
```

- **Effort:** ~5 min. One regex upgrade. Worth it if you ever see un-stripped escape codes in
  thinking blocks (rare, but their inclusion of the C1 form suggests they hit it).

---

## 4. Security model summary (copy this verbatim)

The rendering layer touches semi-trusted content (model output, tool output, file reads).
pi-livecraft's layered model is worth adopting as-is:

| Layer | Mechanism | Our status |
|---|---|---|
| **Markdown** | `html:false` (escape raw HTML) + `validateLink` drops `javascript:`/`data:`/`vbscript:` | ✅ already (md.js) |
| **Code highlighting** | operates on already-escaped text; no HTML injection surface | ✅ already |
| **Tool output (code)** | rendered as text in `<pre>`, then highlighted — never `innerHTML` of raw content | ✅ already (we use `textContent`) |
| **Tool output (HTML)** | `<iframe sandbox="">` (most restrictive) **+** `stripScripts()` pre-scrub **+** opt-in (click to render) | ❌ add (§2.4) |
| **Tool output (SVG)** | `<img src="data:image/svg+xml,…">` — img doesn't execute SVG scripts | ❌ add (§2.5) |
| **Tool output (CSV/MD)** | CSV is text-only parse; MD goes through the same safe markdown pipeline | ✅ MD safe; ❌ add CSV (§2.3) |
| **Images** | `mimeType` allowlist (`gif\|jpeg\|png\|webp`); rendered as `<img>` (no script surface) | ❌ add (§3.2) |

**The one rule that must never break:** raw tool output / file content is **never** injected via
`innerHTML`. It's either `textContent`'d, parsed into a safe structure (CSV table), run through
the markdown escaper, or sandboxed in an iframe. Our `setSafeHtml` helper already encodes this
discipline — keep using it; never reach for raw `innerHTML` on tool content.

---

## 5. Recommended order

Ordered by value-per-effort, with dependencies noted:

| # | Item | Tier | Dep | Effort | Impact |
|---|---|---|---|---|---|
| 1 | **Deferred code highlighting** (§1.2) | 🟢 | — | 0.5h | perf — kills jank on long messages |
| 2 | **Image display in messages** (§3.2) | 🟢 | — | 1h | unblocks image input; shows image results |
| 3 | **ANSI C1 strip** (§3.3) | 🟢 | — | 5m | tiny robustness |
| 4 | **Bounded text preview + "view more"** (§2.6) | 🟢 | — | 2h | stops huge outputs dominating |
| 5 | **Line-numbered highlighted code for `read`** (§2.2) | 🟢 | #1 | 0.5d | big readability win |
| 6 | **CSV table preview** (§2.3) | 🟢 | — | 0.5d | typed preview #1 |
| 7 | **SVG-as-img preview** (§2.5) | 🟢 | — | 10m | typed preview #2 |
| 8 | **Sandboxed HTML preview** (§2.4) | 🟢 | — | 0.5d | typed preview #3 (mind the security) |
| 9 | **Image input + compression** (§3.1) | 🟢 | #2 | 1d | new capability |
| 10 | **Token-driven syntax colors** (§1.3) | 🟢 | token system | 1h | theme-following highlight |
| 11 | **Tool protocol extraction layer** (§2.9) | 🟢 | — | 1d | refactor; fixes edge cases |
| 12 | **Height-preserving offscreen placeholder** (§2.7) | 🟢 | #5,#6 | 0.5d | perf for long transcripts |
| 13 | **Frontmatter → table** (§1.4) | 🟡 | #5 | 0.5d | nice for `.md` reads |
| 14 | **Word-level intra-line diff** (§2.8) | 🟡 | — | 1d | polish; our line-diff stays default |

**Do #1 first** (it's 30 minutes and immediately noticeable on any long message), then #2–4
(tiny, high-visibility). #5–8 are the "typed tool output" story — ship them as a batch behind a
tool-presentation registry (main adoption doc §4.4). #9 (images) is a standalone new feature.

---

## 6. What NOT to take

| Item | Why skip |
|---|---|
| **react-markdown / remark-gfm** | 2+ npm deps + React render tree. markdown-it (vendored, zero-dep) is the right call for us. Take the *behavior*, not the engine. |
| **`react-syntax-highlighter` (Prism)** | Heavy (~langs are separate chunks). Our vendored highlight.js + deferred-IO wrapper (§1.2) matches its perf benefit at zero dep cost. |
| **The `diff` npm package** | Vendoring for one function (`diffWords`) is overkill. Extend our own LCS to word tokens (§2.8a) instead. |
| **The `yaml` npm package** | Full YAML for frontmatter is overkill. Hand-roll flat `key: value` parsing (§1.4a) or skip. |
| **Their read-only edit diff** | Ours is editable + Apply — strictly more capable. Take only the *word-level* highlighting idea (§2.8). |
| **Inline SVG embedding** | Script-execution risk. Always use `<img data:image/svg+xml>` (§2.5). |

---

## 7. File reference

| Adopt | Read in pi-livecraft |
|---|---|
| §1.2 deferred highlight | `src/features/conversation/Markdown.tsx` (`MarkdownCode`, IntersectionObserver) |
| §1.3 token syntax theme | `src/features/conversation/CodeHighlighter.tsx` (`syntaxTheme` object) |
| §1.4 frontmatter | `src/features/conversation/markdown-frontmatter.ts` |
| §2.1 detection | `src/features/conversation/tool-presentation.ts` (`readContentDisplay`, `languageByExtension`) |
| §2.2 numbered code | `src/features/conversation/ToolCallOutput.tsx` (`NumberedPre`) |
| §2.3 CSV | `src/features/conversation/csv-preview.ts` (full) |
| §2.4 HTML preview | `tool-presentation.ts` (`stripScripts`), `ToolCallOutput.tsx` (iframe) |
| §2.5 SVG preview | `ToolCallOutput.tsx` (`svgPreview`) |
| §2.6 text preview | `tool-presentation.ts` (`toolTextPreview`) |
| §2.7 virtualization | `ToolCallOutput.tsx` (`ToolCallPreview`, ResizeObserver) |
| §2.8 word diff | `tool-presentation.ts` (`intraLineDiff`, `editDiffDisplayLines`, `parseEditDiff`) |
| §2.9 protocol layer | `src/features/conversation/tool-protocol.ts` (full) |
| §3.1 image input | `src/features/composer/composer-images.ts` (full) |
| §3.2 image display | `src/features/conversation/message-display.ts` (`isImageContent`, `hasVisibleContent`) |
| §3.3 ANSI strip | `message-display.ts` (`reasoningTextForDisplay`) |

---

*Analysis only. No source files in this repository were modified.*
