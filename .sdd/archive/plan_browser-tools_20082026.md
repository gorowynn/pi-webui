# Plan: Browser tools

## Problem Statement

pi currently cannot inspect a local web page as part of a debugging conversation. This makes visual and browser-only failures in pi-webui difficult to reproduce, because the agent has no bounded view of the page, its console output, or its rendered appearance.

## Business Goals

- Let pi inspect the local pi-webui through a dedicated, isolated browser session.
- Give text-only models useful semantic evidence and vision-capable models optional visual evidence.
- Keep browser access local, observable, bounded, and consistent with the existing safeguard and RPC contracts.
- Preserve pi-webui's zero-build and zero-required-dependency distribution model.

## Constraints

- Deliver the first slice described by `docs/browser-tools.md`: open/attach, semantic snapshot, screenshot, and console inspection.
- Do not include arbitrary page-script evaluation or page-mutating interaction tools in this slice.
- Managed browser state must be session-scoped and isolated from the user's normal browser profile.
- Local targets are the default; navigation and browser access must fail closed when configuration or safety checks are invalid.
- Existing pi RPC, extension, safeguard, and web UI behavior must remain compatible.
- Normal unit tests must not require a browser binary; live checks, if added, must be opt-in.

## Success Criteria

- Pi exposes the four first-slice browser tools through the extension and can use one managed or explicitly attached local browser target.
- Browser results are bounded, structured, and suitable for both text-only and vision-capable model contexts.
- Invalid hosts, targets, stale browser state, transport failures, missing binaries, aborts, and oversized outputs produce controlled tool errors.
- Browser operations are serialized and the session is cleaned up when pi shuts down.
- Zero-dependency unit coverage verifies transport framing/correlation and browser-tool limits/security behavior.
- Existing project tests and diagnostics remain green.
