# Plan: UI Density and Navigation

## Problem Statement

The web UI is functionally rich, but its information density and hierarchy make common work harder to scan than necessary. Small low-contrast text, cramped controls, competing workspace and session lists, repetitive conversation metadata, clipped inspector-rail labels, narrow operational pages, and dense permission/fleet views create avoidable cognitive load. These issues become more pronounced on narrow screens, where header and composer controls compete for limited space.

The completed Tool Activity name summary improves one part of conversation scanning and is now a baseline to preserve. The remaining findings need one coordinated scope so isolated fixes do not shift clutter between surfaces or create inconsistent interaction patterns.

## Scope Findings

- **Readability and targets:** ordinary interface text and several controls are too small or quiet for sustained use.
- **Workspace/session hierarchy:** the full workspace list consumes substantial vertical space before users reach their sessions; the current workspace should remain visible while the rest of the list is collapsible.
- **Conversation hierarchy:** repeated role, thought, tool, and usage metadata can overpower assistant content in long sessions.
- **Inspector rail:** compact labels and badges can clip, selected state is subtle, and narrow-screen launchers are easy to miss.
- **Desktop space usage:** chat width is appropriately constrained for reading, but Permissions and Fleet underuse wide displays.
- **Permissions usability:** raw rule and selector detail dominates the page, making user overrides and common policy decisions difficult to scan.
- **Fleet usability:** completed runs dominate the view while active work, failures, steering target, and failure causes need stronger priority.
- **Header and composer density:** status fragments and secondary actions crowd primary controls, especially on mobile and narrow desktop layouts.

## Business Goals

- Reduce the time and effort required to find the active workspace, resume a session, understand an agent turn, and act on operational state.
- Improve readability and accessibility without losing the terminal-inspired visual identity.
- Make active, failed, and security-relevant information more prominent than historical or inherited detail.
- Establish consistent hierarchy across chat, navigation, inspector, Permissions, and Fleet rather than applying disconnected cosmetic fixes.
- Preserve the fast zero-build development loop and existing operational capabilities.

## Constraints

- Preserve the project's zero-build, minimal-dependency architecture; add no framework, bundler, or runtime dependency.
- Preserve workspace switching, session restoration, conversation-density modes, Tool Activity names, pending approvals, Fleet control, and existing security boundaries.
- Preserve dark and paperlike themes, wide/mid/narrow responsive modes, keyboard access, assistive-technology semantics, and reduced-motion behavior.
- Preserve `PI_WEBUI_NO_SWITCH` behavior in IDE-owned workspace mode.
- Coordinate with the active Git review workspace effort and the canonical right-rail contract; do not introduce duplicate status or detail surfaces.
- Keep chat prose width readable even where operational pages gain more room.
- Prefer incremental, independently verifiable changes over a wholesale redesign.
- Avoid backend or RPC contract changes unless a later approved specification proves they are required.

## Success Criteria

- The workspace area starts compact: the current workspace remains visible, other workspaces are one action away, and sessions receive most of the sidebar's vertical space.
- Ordinary text, metadata, contrast, and interactive targets are comfortably readable across supported viewport classes without destroying information density.
- Assistant turns present prose as the primary content while thoughts, tools, usage, and repeated labels remain available but visually subordinate.
- The inspector rail presents readable labels and badges, an unmistakable selected state, and a discoverable narrow-screen entry point without clipping.
- Chat remains reading-width constrained while Permissions and Fleet use available desktop space where it improves scanning.
- Permissions prioritizes posture, user overrides, active grants, and pending decisions; inherited or raw policy detail remains available without dominating the default view.
- Fleet prioritizes active and failed runs, clearly identifies steering targets and failure causes, and de-emphasizes completed history without removing it.
- Narrow layouts keep primary conversation and composer actions immediately available while secondary status and actions move into clear overflow or disclosure patterns.
- Both themes and wide, mid, and narrow layouts pass browser smoke checks without horizontal overflow, clipped critical status, inaccessible controls, or console errors.
- Existing automated tests remain green, and new behavior leaves focused regression coverage for navigation state, visibility priorities, responsive behavior, and accessibility contracts.
