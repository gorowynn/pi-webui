# pi-webui — JetBrains plugin

A thin tool window that embeds the **already-running** [pi-webui](..) panel in
any JetBrains IDE via JCEF (bundled Chromium), plus a **native IDE diff
approval gate** for edit/write: proposed changes open **as a diff tab in the
IDE's main editor area** — same window, not a floating popup — syntax-highlighted
against the open editor's current text, with the Approve/Deny decision flowing
straight back to pi. The right (**Proposed**) pane is **editable** — tweak pi's
proposal and pi applies *your* version (fed back via `event.input` mutation).
A statusbar badge shows which IDE hosts the panel (or
`none` in a standalone browser tab).

> This is a **standalone Gradle project**. It does NOT affect the webui's
> zero-build invariant — `server.js` / `app.js` / `style.css` / `index.html`
> stay build-free. A native IDE plugin inherently needs Gradle; that's the
> IntelliJ Platform's contract, not a choice we impose on the webui.

Because it depends only on `com.intellij.modules.platform`, the **same plugin
runs in Rider, IDEA, PyCharm, WebStorm, CLion, GoLand, RubyMine** — not just Rider.

## Prerequisites

- The plugin **auto-detects** your installed JetBrains IDE (the folder with
  `product-info.json`) to build against — no IntelliJ Community download, no
  hardcoded path. Override with `RIDER_HOME` env var or `-PriderHome=<dir>`.
- A JDK as the **Gradle JVM** (Rider → Settings → Build Tools → Gradle). Rider's
  bundled JBR works; `jvmToolchain(21)` sets the compile target, and Foojay
  (`settings.gradle.kts`) auto-downloads a 21 if none is local. See **Build notes**
  for the JDK 25 specifics (Kotlin version, `instrumentCode`).
- pi-webui running at `http://127.0.0.1:4317` — start it with `node server.js`
  (from the repo root) or via pi's `/webui` command.

## Build

```bash
cd jetbrains
gradle wrapper            # once — generates ./gradlew
./gradlew buildPlugin     # → build/distributions/pi-webui-0.1.0.zip
./gradlew runIde          # launch a sandbox IDE with the plugin loaded (for dev)
```

## Install

`Settings → Plugins → ⚙ → Install Plugin from Disk…` → pick the zip from
`build/distributions/`. Restart. Open the **pi-webui** tool window (right stripe).

## Configure

The base URL is persisted in `~/.config/JetBrains/<IDE>/options/pi-webui.xml`
(default `http://127.0.0.1:4317`).

## How the native diff approval gate works

```
pi proposes an edit
  → tool_execution_start carries {path, edits:[{oldText,newText}]}  (captured by app.js)
  → safeguard.ts asks permission via ctx.ui.select(...)
  → app.js uiRequest() sees method:"select" + curToolName ∈ {edit,write}
       AND window.piWebuiOpenDiff exists (the plugin injected it)
       → builds {filename, path, op, edits, content, leftText, rightText}
            (path+edits let the plugin resolve the IDE file for a highlighted,
             editor-aware diff; leftText/rightText are the /api/file fallback)
       → awaits window.piWebuiOpenDiff(payload)        ── JCEF bridge ──▶ Kotlin
              Kotlin opens a CENTER editor tab (DiffReviewEditor: the native
                 diff embedded as the tab content + the 4 buttons in a top
                 bar — same window as the IDE; a decision or closing the tab
                 resolves the promise and removes it)
              user may EDIT the right pane; if changed, the resolve value is
                 {label, oldFull, newFull} instead of a bare label string
              user clicks → returns one of safeguard's option labels
       ◀── promise resolves with the label (or {label,oldFull,newFull}) ── Kotlin
       → app.js posts api({type:"extension_ui_response", id, value})   ← SAME channel as the modal
  → safeguard.ts maps the label to allow/session-allow/allow-always/deny;
     if value carries oldFull/newFull it mutates pi's event.input so pi applies
     the EDITED version (write→content, edit→edits=[whole-file replace])
```

The security-critical gate (`safeguard.ts`) keeps its allow/deny logic; the only
addition is that when the resolve value carries `oldFull`/`newFull` it mutates
pi's `event.input` so pi applies the user's edited text (no edit → unchanged).
The four button labels are a **wire contract** with `safeguard.ts` and must
match exactly: `Allow once` / `Allow for this session` /
`Allow always (save to config)` / `Deny`. If the plugin isn't present, or the
bridge rejects, app.js falls back to the existing webui modal (`openSelectModal`,
now also editable for edit/write).

The diff is a **real file diff**: the editor resolves the edit path to an IDE
`VirtualFile`, reads the open editor's current text (unsaved edits included)
for the left side, and builds both sides with the file's `FileType` for syntax
highlighting. If the path isn't under the project, it falls back to the
`/api/file` text. The tab is rendered by a `FileEditorProvider` (`DiffReviewEditorProvider`,
registered in `plugin.xml`) over an in-memory `LightVirtualFile` (`DiffReviewFile`)
that carries the payload + the decision callback; `HIDE_DEFAULT_EDITOR` keeps
the text editor off that tab, and `DumbAware` keeps the gate working during
indexing (otherwise the open would be skipped and the JS promise would hang).
Closing the tab without deciding fails closed to `Deny` (the editor's
`dispose()` is the hook). **The right pane is editable**
(`DiffContentFactory.createEditable`); on a decision the edited text is read
back (`DocumentContent.getDocument().getText()`) and, if it differs from the
original proposal, shipped as `{label, oldFull, newFull}`. The standalone webui
modal offers the same editing (`mountEditableDiff` — two `<textarea>`s: left
read-only / right editable). The plugin also injects `window.piWebuiIdeInfo = {name,
version}` (via `ApplicationInfo`) on load; app.js shows a **statusbar badge**
(green `Rider`, or dim `none`) so the hosting state — and the no-IDE fallback
— is visible at a glance.

**Verify after a rebuild** — the plugin can't run headless, so smoke-test it in a
sandbox IDE (`./gradlew runIde`): open the pi-webui tool window, ask pi for an
edit on a project file, and a `<file> — pi change` tab opens in the editor area
with the diff + the 4 buttons; the **right (Proposed) pane is editable**. **Allow
once** applies your edited text (or pi's original if untouched) and closes the tab;
closing the tab via ✕ without choosing tells pi **Deny** (fail-closed via the
editor's `dispose()`).

## Build notes (the bootstrap that worked)

Built successfully against Rider 2026.1.2 on Gradle 9. These versions are
load-bearing — older ones throw cryptic errors:

- **IntelliJ Platform Gradle Plugin 2.7.0** (2.3.0 throws `JvmVendorSpec …
  IBM_SEMERU` on Gradle 9 — its `JbrResolver` touches a removed vendor-spec).
- **Foojay resolver 1.0.0** (`settings.gradle.kts`) — older versions also
  reference the removed `IBM_SEMERU`.
- **Kotlin 2.4.0** — the Kotlin *daemon* runs on the Gradle JVM (JDK 25); older
  Kotlin's bundled version parser throws `IllegalArgumentException: 25.0.3`.
- **`instrumentCode = false`** — the platform's bytecode-instrumentation task
  chokes on the JDK 25 Gradle JVM (`Packages does not exist`); it only injects
  `@NotNull` checks, not load-bearing. Re-enable when building on a JDK 21.
- **`DiffContentFactory` lives in `com.intellij.diff`** (NOT `.contents`, where
  `DiffContent` is) — easy package mix-up. `create(proj, String, FileType)` gives
  a read-only, syntax-highlighted content; `createEditable(proj, String, FileType)`
  is the editable variant (read it back via `DocumentContent.getDocument().getText()`).
  `create(String)` is the plain variant.
- **`FileEditor` extends `UserDataHolder`** (no method defaults in this build) →
  extend `UserDataHolderBase()` so `getUserData`/`putUserData` are supplied; a
  bare `: FileEditor` fails with "does not implement abstract members".
- **`LightVirtualFile` has no `(String, FileType)` constructor** — use the 1-arg
  `(String)` (defaults to plain text + empty content, which the editor ignores).
  It's `com.intellij.testFramework.*` but ships in `intellij.platform.core.jar`
  (runtime-available); `FileEditorProvider`/`FileEditorManager`/`FileEditorPolicy`
  live in `intellij.platform.analysis.jar`.

Gson is bundled in the IntelliJ Platform (`lib/gson-*.jar`) — no extra dependency.

## Roadmap

- Dispose `JBCefJSQuery` + remove the load handler on tool-window close
  (currently outlive the browser — fine for one long-lived window).
- Optional `autoStartCommand` so opening the tool window can spawn server.js
  (with the project's existing cross-platform tree-kill).
- A Settings UI for the base URL (today it's hand-edited in `pi-webui.xml`).
