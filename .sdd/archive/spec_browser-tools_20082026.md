# Specification: Browser tools

## User Stories

- As a pi agent debugging pi-webui, I want to open the local UI in an isolated browser so that I can inspect the same page a user sees.
- As a text-only model, I want a bounded semantic snapshot so that I can identify visible controls and content without receiving raw HTML.
- As a vision-capable model, I want an optional bounded screenshot so that I can inspect layout and visual regressions.
- As a debugging agent, I want recent browser errors and warnings so that I can distinguish rendering failures from server-side failures.
- As a user, I want browser access to be local, isolated, approval-aware, and easy to observe so that the agent cannot silently reuse my normal browser data.

## Functional Requirements

### Browser session and transport

- **FR-1 — First-slice tools:** Register exactly these specialized tools: `browser_open`, `browser_snapshot`, `browser_screenshot`, and `browser_console`. Do not register interaction tools, `browser_tabs`, `browser_network`, or arbitrary `browser_evaluate` in this slice.
- **FR-2 — Session ownership:** Keep one lazy browser manager per extension session. Reuse its active page target for subsequent calls; do not create a new browser for every read.
- **FR-3 — Managed launch:** When no attachment is configured, launch a discovered Chromium/Edge-compatible binary with a unique temporary user-data directory, loopback-only remote debugging, and a random debugging port. The managed browser is visible by default; `PI_BROWSER_HEADLESS` is the explicit opt-in for headless mode.
- **FR-4 — Profile isolation:** Never launch with the user's default profile or copy its cookies, extensions, passwords, or local storage. Do not pass `--no-sandbox` or disable web security. Closing the managed session terminates its process and removes its temporary profile; an attached browser is never terminated by the extension.
- **FR-5 — Explicit attachment:** If `PI_BROWSER_CDP_URL` is set, discover and attach through that endpoint instead of launching a browser. The endpoint must be an HTTP(S) loopback endpoint and must resolve to a page target; invalid or non-loopback endpoints fail closed.
- **FR-6 — CDP transport:** Implement the required zero-dependency CDP transport: `/json/version` and `/json/list` discovery, HTTP Upgrade WebSocket handshake, masked client frames, unmasked server frames, 7/16/64-bit lengths, fragmentation, ping/pong, close handling, protocol errors, request correlation, event subscriptions, and bounded command/idle timeouts.
- **FR-7 — Serialized operations:** Serialize browser operations through one FIFO manager queue. A call may not race a sibling call against the same target. Queued aborts are discarded; an active abort stops exposing the result and leaves the manager in a safe reattachable state.
- **FR-8 — Lifecycle cleanup:** Close the transport and managed process on `session_shutdown`, and clear the manager on a new session or failed target. Cleanup is idempotent and must not leave child processes or WebSocket listeners behind.

### Host and trust policy

- **FR-9 — URL validation:** `browser_open` accepts only HTTP(S) URLs without credentials. Reject `file:`, `data:`, `javascript:`, `chrome:`, `devtools:`, and other browser-internal schemes before starting navigation.
- **FR-10 — Host allowlist:** Allow `localhost`, `127.0.0.1`, and `::1` by default. Permit additional exact hosts supplied by `PI_BROWSER_ALLOWED_HOSTS`; do not support wildcard host entries. Disallowed hosts fail before navigation.
- **FR-11 — Existing safeguard:** Route all four tools through the existing safeguard `tool_call` gate. `browser_open` is an ordinary approval-required operation; snapshot, screenshot, and console are read-only operations. Do not implement a second browser-side policy evaluator.
- **FR-12 — Untrusted page data:** Tool descriptions and result guidance must state that page text, attributes, titles, and console messages are untrusted data, never instructions. The MVP must not expose model-selected JavaScript evaluation.

### `browser_open`

- **FR-13 — Open/attach behavior:** Start or attach lazily, validate the requested URL, navigate the active page, and wait for the bounded load/navigation outcome. Return a structured text result containing the schema version, final URL, title, viewport, and whether the browser is managed or attached.
- **FR-14 — Navigation failure:** Missing binaries, failed discovery, invalid targets, CDP failures, disallowed hosts, navigation errors, and timeouts produce controlled tool errors and never silently fall back to another target or URL.

### `browser_snapshot`

- **FR-15 — Snapshot shape:** Return an object with schema `pi-webui.browser-snapshot/v1`, current URL, title, viewport `{width,height}`, bounded visible `pageText`, and an `elements` array. Do not return raw HTML, page source, CSS selectors, or unrestricted accessibility-tree nodes.
- **FR-16 — Element contract:** Each element may contain a manager ref, semantic role, accessible name, bounded text/value, disabled state, checked/selected state where applicable, an HTTP(S) href where applicable, and a finite bounding rectangle. Password control values must never be returned.
- **FR-17 — Snapshot bounds:** Limit visible text to 12 KiB, interactive elements to 200, and individual text/name/value/href fields to bounded lengths. Truncation must be deterministic and must not make the JSON invalid.
- **FR-18 — Interactive candidates:** Include useful visible controls such as buttons, links, form controls, summaries, and contenteditable elements, using explicit ARIA semantics where present and stable native-role fallbacks otherwise. Hidden, detached, non-rendered, and non-interactive nodes are excluded.
- **FR-19 — Ref invalidation:** Refs are manager-owned handles, not selectors. Invalidate them when navigation or a structure change replaces the snapshot generation; a stale ref must fail closed with a short instruction to request a fresh snapshot. The first slice emits refs for forward compatibility but does not expose mutating ref-action tools.

### `browser_screenshot`

- **FR-20 — Bounded image:** Capture only the current viewport as JPEG through CDP, using bounded quality and dimensions. Keep decoded image bytes at or below approximately 300 KiB; reduce quality within the configured floor or return a bounded output-limit error rather than emitting an oversized image.
- **FR-21 — Result content:** A supported result contains one text block identifying the page and one image block with `mimeType: image/jpeg`, base64 data, and bounded metadata `{url,width,height,bytes}`. Never send a screenshot as a progress/update event.
- **FR-22 — Text-only fallback:** If the selected model does not declare image input support, return the page metadata and a short instruction to use `browser_snapshot`, without including image bytes.

### `browser_console`

- **FR-23 — Console capture:** Subscribe to page console and exception events for the active target and retain only recent warnings and errors. Return a structured result with schema `pi-webui.browser-console/v1` and at most 50 entries.
- **FR-24 — Console entry shape:** Each entry may include level, bounded text, source URL, line/column when available, and timestamp. Do not include arbitrary protocol payloads or unbounded stack/source text. An empty buffer is a valid successful result.

### Errors, limits, and compatibility

- **FR-25 — Fail-closed errors:** Invalid input, disallowed host, unavailable browser, invalid target, stale session/ref, unsupported capability, command timeout, malformed CDP frame, closed transport, aborted call, and output-limit violations must be distinguishable by stable error codes and must not return partial untrusted data as success.
- **FR-26 — Abort and timeout bounds:** Every tool honors its `AbortSignal`; CDP handshake, commands, navigation, snapshot, console, and screenshot operations have finite timeouts. A timed-out or aborted operation cannot block later calls forever.
- **FR-27 — RPC compatibility:** Tool results use pi's existing RPC tool-result/content contract, preserve image content compatibility, and do not add an HTTP route or a second browser-to-server protocol.
- **FR-28 — Dependency and runtime compatibility:** The implementation uses Node 18-compatible built-ins and ships without a required browser-automation package, build step, or runtime install.

## Data Models

### Browser target

```text
BrowserTarget {
  id: string,
  type: "page",
  title: string,
  url: string,
  webSocketDebuggerUrl: string
}
```

`webSocketDebuggerUrl` is internal and must never be returned to the model.

### Browser session

```text
BrowserSession {
  state: "idle" | "starting" | "ready" | "closed" | "failed",
  ownership: "managed" | "attached",
  targetId: string,
  url: string,
  title: string,
  viewport: { width: number, height: number },
  snapshotGeneration: number,
  consoleEntries: ConsoleEntry[]
}
```

### Snapshot

```text
BrowserSnapshot {
  schema: "pi-webui.browser-snapshot/v1",
  url: string,
  title: string,
  viewport: { width: number, height: number },
  pageText: string,
  elements: SnapshotElement[]
}

SnapshotElement {
  ref: string,
  role: string,
  name: string,
  value: string | null,
  text?: string,
  disabled: boolean,
  checked?: boolean,
  selected?: boolean,
  href?: string,
  rect: { x: number, y: number, width: number, height: number }
}
```

### Screenshot result

```text
BrowserScreenshotResult {
  content: [
    { type: "text", text: string },
    { type: "image", data: string, mimeType: "image/jpeg" }
  ] | [{ type: "text", text: string }],
  details: {
    url: string,
    width: number,
    height: number,
    bytes: number,
    imageIncluded: boolean
  }
}
```

### Console result

```text
BrowserConsoleResult {
  schema: "pi-webui.browser-console/v1",
  url: string,
  entries: ConsoleEntry[]
}

ConsoleEntry {
  level: "warning" | "error",
  text: string,
  source?: string,
  line?: number,
  column?: number,
  timestamp?: number
}
```

### Stable error

```text
BrowserToolError {
  code:
    "invalid-url" | "disallowed-host" | "invalid-cdp-endpoint" |
    "browser-unavailable" | "target-unavailable" | "cdp-protocol" |
    "timeout" | "aborted" | "stale-session" | "stale-ref" |
    "unsupported" | "output-limit",
  message: string
}
```

Messages are short and model-facing; raw command frames, WebSocket URLs,
profile paths, and process arguments are excluded.

## Edge Cases

- `PI_BROWSER_BIN` points to a missing, non-executable, or non-Chromium binary: fail with `browser-unavailable` and do not create a persistent profile.
- A managed browser exits before discovery or during a command: mark the manager failed, clean up, and require a fresh lazy start on the next call.
- `PI_BROWSER_CDP_URL` is malformed, non-loopback, unreachable, or exposes no page target: fail with a stable attachment error; never fall back to managed launch when explicit attachment was requested.
- The requested URL has an unsupported scheme, credentials, malformed host, or disallowed host: reject before any CDP navigation command.
- A page redirects to a host outside the allowlist: fail closed and do not report the redirected page as a successful open.
- The page has no visible controls or body text: return a valid empty snapshot with metadata.
- The page contains more text, controls, console entries, or screenshot bytes than allowed: truncate only where the contract permits; otherwise return an output-limit error. Never exceed the cap to preserve the JSONL/SSE budget.
- A control has no accessible name, a non-finite rectangle, a password type, or an unsupported value: use bounded null/empty fields and omit unsafe optional data rather than failing the whole snapshot.
- Navigation or a structure change invalidates a previous snapshot generation: refs are rejected as stale, and no future interaction tool may guess a replacement selector.
- CDP sends fragmented, ping, close, malformed, oversized, or unknown frames: handle control frames according to the transport contract, reject malformed/oversized data, and keep protocol errors out of model results.
- Two browser calls arrive concurrently: preserve FIFO order; never interleave command responses or console subscriptions.
- The caller aborts while queued or in flight: return `aborted` within the operation bound, suppress late data, and leave no permanently blocked queue entry.
- Screenshot capture is unsupported or the model cannot accept images: return metadata/text guidance without pretending an image was delivered.
- `browser_console` is called before any page event or after a clean page: return an empty, valid result rather than an error.
- Session shutdown happens twice or during launch: cleanup remains idempotent and attached browser processes remain untouched.
- Page content contains prompt injection or secrets: preserve only the bounded fields requested by the contract, label it untrusted in tool guidance, and never execute instructions or expose password values.

## Non-goals for this slice

- Browser click, type, reload, wait, tabs, network, or arbitrary evaluation tools.
- Default-profile reuse, cookie/password/local-storage export, remote/LAN browsing, or sandbox weakening.
- A browser embedded in pi-webui or a new server HTTP endpoint.
