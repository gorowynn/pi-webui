# Plan: Browser context efficiency

## Problem Statement

The browser-tools first slice is functionally useful, but repeated browser
results can consume more model context than the debugging signal requires.
Snapshot text and element metadata may repeat across calls, console reads may
repeat already-seen entries, and a full-size visual capture can be expensive
for a model even when the browser viewport is intentionally 1080p. Navigation
readiness also needs a predictable bounded outcome for slow pages and
same-document application routes.

## Business Goals

- Keep browser debugging evidence useful while reducing repeated model-context
  consumption.
- Make visual evidence proportional to the debugging question without changing
the managed browser's 1920×1080 default viewport.
- Let agents distinguish new browser evidence from unchanged state.
- Make local SPA, hash, and slow-navigation behavior predictable and recoverable.
- Preserve the zero-dependency, local-only, fail-closed browser-tools design.

## Constraints

- Preserve the four-tool first-slice surface unless a versioned contract change
  is explicitly approved: `browser_open`, `browser_snapshot`,
  `browser_screenshot`, and `browser_console`.
- Preserve the existing host allowlist, profile isolation, safeguard policy,
  untrusted-page guidance, screenshot byte cap, and 1920×1080 managed viewport.
- Do not add arbitrary evaluation, click/type tools, tabs, network capture, or a
  required browser-automation dependency.
- Keep normal unit tests browser-binary-free; live checks remain opt-in or use
  deterministic local CDP fixtures.
- Any new cursor, compact/full, or image-sizing behavior must be bounded,
  abortable, backward-compatible where possible, and documented as a stable
  result contract.

## Success Criteria

- The default browser results contain the smallest useful evidence for common
  debugging turns, with an explicit way to request bounded additional detail.
- Repeated snapshot and console calls do not resend unchanged evidence by
  default, while callers can recover a complete current view when needed.
- Screenshot output has a context-aware size policy independent of the managed
  browser viewport and remains within the existing transport limit.
- `browser_open` handles same-document navigation and slow/failed targets with
  stable bounded outcomes, and a timed-out session can recover on the next call.
- Security, stale-reference behavior, image capability fallback, and existing
  RPC/tool-result compatibility remain intact.
- Focused browser tests, the full Node test suite, diagnostics, and a local live
  smoke check pass without introducing runtime dependencies or new HTTP routes.
