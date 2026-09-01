# Plan: Reference UI adaptation

## Problem Statement

pi-webui's current shell contains the right capabilities, but the reference
screenshot presents a clearer hierarchy: persistent workspace/session context,
compact high-value header actions, a calm reading-first transcript, and a
prominent composer. The adaptation should bring that hierarchy to pi-webui
without copying the reference app's architecture or adding unrelated panes.

## Business Goals

- Make the active workspace and session easy to understand and switch.
- Keep the transcript as the primary reading surface while making tool activity
  scannable.
- Make common actions and live usage context visible without opening settings.
- Keep secondary tools available but out of the way.

## Constraints

- Preserve the zero-build, vanilla browser architecture and existing API/event
  contracts.
- Preserve dark as the default theme and keep the existing paperlike theme as
  the light visual option.
- Preserve keyboard accessibility, responsive rail/drawer behavior, and the
  existing permission and safety affordances.
- Do not add a permanent terminal split or speculative file explorer solely to
  imitate the screenshot.
- Use existing files and dependencies; no new runtime dependency.

## Success Criteria

- The wide shell has a clear left workspace/session navigation area, a compact
  header with useful context/actions, a centered reading-first transcript, and
  a visually dominant composer.
- Tool and thinking activity remains compact by default and expandable for
  inspection.
- Cost/context/cache/failure information is discoverable from the shell without
  obscuring the conversation.
- The optional right tools rail remains available without competing with the
  transcript.
- Narrow and mid-width layouts retain usable navigation and composer controls.
- Existing unit tests and a focused UI smoke/check pass after implementation.
