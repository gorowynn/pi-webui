# pi-webui — JetBrains plugin

A thin tool window that embeds the **already-running** [pi-webui](..) panel in
any JetBrains IDE via JCEF (bundled Chromium), plus a **native IDE diff
approval gate** for edit/write: proposed changes open in the IDE's diff viewer
and the Approve/Deny decision flows straight back to pi.

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
       → builds {filename, leftText, rightText}  (left = /api/file; right = left + hunks applied)
       → awaits window.piWebuiOpenDiff(payload)        ── JCEF bridge ──▶ Kotlin
              Kotlin opens DiffApprovalDialog (native diff + 4 buttons)
              user clicks → returns one of safeguard's option labels
       ◀── promise resolves with the label ───────────────────────────── Kotlin
       → app.js posts api({type:"extension_ui_response", id, value: label})   ← SAME channel as the modal
  → safeguard.ts maps the label to allow/session-allow/allow-always/deny   (UNCHANGED)
```

The security-critical gate (`safeguard.ts`) is **untouched** — the plugin just
replaces the modal *renderer*. If the plugin isn't present, or the bridge
rejects, app.js falls back to the existing webui modal (see `openSelectModal`).
The four button labels are a **wire contract** with `safeguard.ts` and must
match exactly: `Allow once` / `Allow for this session` /
`Allow always (save to config)` / `Deny`.

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
  `DiffContent` is) — easy package mix-up. `create(String)` works as-is.

Gson is bundled in the IntelliJ Platform (`lib/gson-*.jar`) — no extra dependency.

## Roadmap

- Dispose `JBCefJSQuery` + remove the load handler on tool-window close
  (currently outlive the browser — fine for one long-lived window).
- Optional `autoStartCommand` so opening the tool window can spawn server.js
  (with the project's existing cross-platform tree-kill).
- Single-window embedded diff via `DiffManager.createRequestPanel(...)` instead
  of `showDiff()` + a separate button dialog.
- Resolve edit paths to IDE `VirtualFile`s (when under the project root) for
  ref-aware highlighting instead of plain text content.
