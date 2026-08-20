# Browser tools — design specification

> **Role:** proposed design for giving pi a local browser session for web-UI
> debugging. This is a product/architecture specification, not an active
> implementation plan; implementation still requires a focused SDD run.
>
> **Status:** proposed. The first target is pi-webui itself at
> `http://127.0.0.1:4317`.

## 1. Goal

Give pi enough browser access to answer questions such as:

- What is currently visible?
- Which controls and values are present?
- Did the page produce console errors or failed requests?
- What does the page look like after a change?
- Can pi reproduce a user action and inspect the result?

The browser result must be useful to both text-only and vision-capable models.
A compact semantic snapshot is the primary representation; a screenshot is
optional visual evidence.

## 2. Constraints

The design preserves pi-webui's existing constraints:

- Node 18+ and browser-native SSE/fetch;
- no React, bundler, transpiler, or runtime `npm install`;
- no required third-party browser-automation dependency;
- one active pi child per workspace;
- local-only operation by default;
- existing RPC, safeguard, and tool-result contracts remain authoritative.

Playwright may be useful as an optional companion later, but it is not part of
the core package. The core implementation uses the Chromium DevTools Protocol
(CDP) over a small Node built-in transport.

## 3. User and browser model

### 3.1 Managed browser (recommended)

The first browser call lazily starts Chromium or Edge with:

- a temporary, dedicated user-data directory;
- a random loopback remote-debugging port;
- no sync, extensions, or default-profile cookies;
- the requested URL, usually the local pi-webui URL.

The browser is visible by default so the user can watch the reproduction.
Headless mode is an explicit opt-in for CI or unattended checks.

### 3.2 Explicitly attached browser

An existing browser can be attached only when it was started with remote
debugging enabled. A normal desktop Chrome tab cannot be attached after the
fact, by design.

The endpoint may be supplied through configuration such as
`PI_BROWSER_CDP_URL`, but it must resolve to loopback unless the user explicitly
opts into a remote target. The model must not be able to choose an arbitrary
WebSocket endpoint.

### 3.3 Proposed configuration

| Setting | Purpose |
| --- | --- |
| `PI_BROWSER_BIN` | Explicit Chromium/Edge executable path. |
| `PI_BROWSER_CDP_URL` | Explicit loopback CDP HTTP endpoint to attach to. |
| `PI_BROWSER_HEADLESS` | Launch managed browser without a visible window. |
| `PI_BROWSER_ALLOWED_HOSTS` | Additional hosts allowed by the user. |

Defaults should be conservative: discover a local Chromium/Edge binary, allow
`localhost`, `127.0.0.1`, and `::1`, and reject `file:`, `chrome:`, and other
browser-internal URLs.

## 4. Proposed architecture

```text
LLM
 │ custom browser tool call
 ▼
pi --mode rpc
 │ extensions/pi_minimal_webui/browser.ts
 ▼
zero-dependency CDP client
 │ loopback HTTP discovery + WebSocket transport
 ▼
managed Chromium/Edge page
```

### 4.1 Extension facade

Add `extensions/pi_minimal_webui/browser.ts` and register specialized tools
from `extensions/pi_minimal_webui/index.ts`.

The facade owns a lazy, session-scoped browser manager. It should:

- start or attach to one browser target;
- serialize browser operations because pi may execute sibling tools in parallel;
- translate CDP data into bounded, model-friendly results;
- honor the tool `AbortSignal`;
- close the transport and managed process on `session_shutdown`.

Browser state belongs in the extension for the first slice. No new HTTP route
is needed: pi already emits the tool result through RPC, and `server.js`
broadcasts it over the existing SSE path. A server-owned browser manager can be
considered later if multiple pi sessions must share a browser.

### 4.2 CDP transport

Add a small zero-dependency module, proposed as
`extensions/pi_minimal_webui/browser-cdp.js`, with:

- `/json/version` and `/json/list` target discovery;
- HTTP Upgrade WebSocket connection;
- masked client frames and unmasked server frames;
- 7-bit, 16-bit, and 64-bit payload lengths;
- fragmented messages, ping/pong, close, and protocol errors;
- request-id correlation and event subscriptions;
- bounded command and idle timeouts.

The transport should expose a narrow interface such as:

```text
connect(target) → session
session.command(method, params, signal) → result
session.on(eventName, handler) → unsubscribe
session.close()
```

The facade, not the model, chooses CDP methods and scripts. Arbitrary
model-supplied JavaScript evaluation is intentionally excluded from the MVP.

## 5. Tool surface

Use separate tools rather than one large action union. Separate schemas make
model selection, safeguard policy, and output contracts clearer.

| Tool | Purpose | Default policy |
| --- | --- | --- |
| `browser_open` | Start/attach and navigate to an allowed URL. | Ask |
| `browser_tabs` | List available page targets. | Read-only |
| `browser_snapshot` | Return the visible semantic tree and interaction refs. | Read-only |
| `browser_screenshot` | Capture the current viewport as an image when supported. | Read-only |
| `browser_console` | Return recent console errors and warnings. | Read-only |
| `browser_network` | Return recent failed or relevant network requests. | Read-only |
| `browser_wait` | Wait for a ref, text, or URL condition. | Read-only |
| `browser_click` | Activate a snapshot ref. | Ask |
| `browser_type` | Focus a snapshot ref and insert text. | Ask |
| `browser_reload` | Reload the current page. | Ask |
| `browser_close` | Close the managed browser session. | Ask |

The first implementation slice should ship `browser_open`,
`browser_snapshot`, `browser_screenshot`, and `browser_console`. Add
interaction and network tools only after the read-only path is reliable.

`browser_evaluate` is not an MVP tool. It would expose page-local storage,
DOM state, and credentials to arbitrary model-generated code; a future version
would need a narrowly scoped, explicitly approved contract.

## 6. Snapshot contract

`browser_snapshot` must return structured text, not raw HTML or an unbounded
accessibility tree:

```json
{
  "schema": "pi-webui.browser-snapshot/v1",
  "url": "http://127.0.0.1:4317",
  "title": "pi-webui",
  "viewport": { "width": 1440, "height": 900 },
  "pageText": "...bounded visible text...",
  "elements": [
    {
      "ref": "e12",
      "role": "button",
      "name": "Send",
      "value": null,
      "disabled": false,
      "rect": { "x": 1180, "y": 842, "width": 72, "height": 32 }
    }
  ]
}
```

Each element may include only useful interaction fields: role, accessible
name, text/value, checked/selected state, disabled state, href, and bounding
rectangle. Raw CSS selectors and page source should not be returned.

Refs are manager-owned handles, not page API contracts. They become invalid
when the page navigates or its structure changes; an action using a stale ref
returns a short error telling pi to call `browser_snapshot` again.

Proposed bounds:

- at most 200 interactive elements;
- at most 12 KiB of visible text;
- at most 50 console entries and 50 network entries;
- at most approximately 300 KiB per screenshot payload.

These limits protect the RPC JSONL stream, SSE queue, and model context.

## 7. CDP domains

The facade should use only the domains needed by the tools:

| Domain | Use |
| --- | --- |
| `Page` | Navigation, load state, viewport screenshots, frame lifecycle. |
| `Runtime` | Controlled DOM inspection and page metadata. |
| `DOM` | Resolve snapshot refs and inspect element geometry. |
| `Input` | Mouse, keyboard, and text actions. |
| `Log` / `Runtime` | Console errors and warnings. |
| `Network` | Failed requests and bounded request metadata. |

The semantic snapshot may begin with a controlled `Runtime.evaluate` helper
that collects visible interactive elements and body text. A later version can
use `Accessibility.getFullAXTree` if the initial semantic contract is
insufficient.

## 8. Screenshot behavior

`browser_screenshot` should use `Page.captureScreenshot` with a bounded JPEG
quality and viewport size. It returns:

```js
{
  content: [
    { type: "text", text: "Screenshot of <url>" },
    { type: "image", data: "...base64...", mimeType: "image/jpeg" }
  ],
  details: { url, width, height, bytes }
}
```

Before adding the image block, check the selected model's declared image
input capability. Text-only models receive the metadata and should be directed
to use `browser_snapshot` instead. The screenshot must never be emitted as a
streaming progress update; only the bounded final result should carry it.

The existing pi tool-result type supports image content. The current web UI can
continue to show the textual tool result first. Human-visible screenshot cards
can be added later by extending `public/tool-protocol.js` and the tool-result
renderer.

## 9. Security and trust

Browser content is untrusted input. A page can contain prompt injection,
misleading instructions, or secrets. Tool descriptions and prompt guidelines
must explicitly tell pi to treat page content as data, never as instructions.

Required controls:

1. **Loopback CDP:** bind managed debugging to loopback and use a random port.
2. **Dedicated profile:** never launch against the user's default profile or
   copy its cookies, extensions, passwords, or local storage.
3. **Host allowlist:** local hosts are the default; external navigation requires
   explicit configuration and approval.
4. **No arbitrary evaluation:** do not expose a generic JavaScript tool in the
   first release.
5. **Safeguard integration:** navigation and interaction tools must pass through
   the existing `tool_call` gate; their selectors should expose the URL, ref,
   and target field so approvals are meaningful.
6. **No weakened browser sandbox:** do not add `--no-sandbox` or disable web
   security as a convenience flag.
7. **Bounded output:** enforce limits before data reaches the RPC stream or
   session history.
8. **Fail closed:** missing browser, invalid target, stale ref, disallowed host,
   or expired command must be a tool error, not an implicit fallback.

## 10. Testing and verification

Add zero-dependency tests alongside the implementation:

- `test/browser-cdp.test.js`: frame encoding/decoding, masking, fragmentation,
  ping/pong, close, request correlation, timeout, and malformed-frame handling;
- `test/browser-tools.test.js`: snapshot bounds, ref invalidation, host policy,
  abort behavior, and image-size limits using a fake CDP server;
- optional live smoke tests behind `PI_BROWSER_E2E=1` so normal unit tests do
  not require a browser binary.

Manual smoke path:

1. Start `node server.js`.
2. Ask pi to open `http://127.0.0.1:4317`.
3. Ask for a snapshot and confirm the Send button and composer are present.
4. Introduce a temporary client-side error and inspect `browser_console`.
5. Request a screenshot and confirm a vision-capable model receives it.
6. Click/type only after an approval prompt and verify the snapshot changes.

## 11. Rollout

### Phase 1 — Observe

Implement managed launch/attach, target discovery, snapshot, screenshot, and
console capture. No page mutation and no arbitrary evaluation.

### Phase 2 — Reproduce

Add ref-based click, type, wait, reload, and bounded network failures. Add
safeguard selector handling and stale-ref errors before enabling these tools by
default.

### Phase 3 — Improve the human loop

Render image tool results in the WebUI, add a visible browser-session status,
and support explicit tab selection. Keep the browser manager single-session
until real usage requires sharing.

### Phase 4 — Optional richer adapter

If CDP becomes insufficient for cross-browser support, iframe-heavy workflows,
or automatic locator waiting, provide an optional Playwright companion process.
It must remain outside the zero-dependency core package.

## 12. Non-goals

- General-purpose remote browsing or LAN browser control;
- credential harvesting, cookie export, or default-profile reuse;
- arbitrary page JavaScript execution;
- replacing the existing pi `read`, `bash`, or file tools;
- a browser embedded inside the pi-webui layout;
- making browser automation a prerequisite for normal pi-webui use.
