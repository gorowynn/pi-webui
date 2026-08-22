# Plan: Tool Names in Tool Activity

## Problem Statement

Collapsed Tool Activity cards currently summarize only the number of calls, their state, errors, and elapsed time. Users must expand each card to discover which tools the agent used, making long conversations harder to scan and reducing confidence in what work was performed.

## Business Goals

- Make agent activity understandable at a glance without expanding successful tool groups.
- Improve scanability and trust in long or tool-heavy conversations.
- Preserve the compact, conversation-first presentation of Balanced and Focus views.
- Keep failures and active work immediately recognizable.

## Constraints

- Preserve the project's zero-build, minimal-dependency browser architecture.
- Preserve existing tool-group counts, running/error state, duration, expansion behavior, and conversation-density modes.
- Show tool identity only; do not expose arguments, commands, paths, or result content in the collapsed summary.
- Remain readable for single, repeated, and numerous tool calls without allowing the summary to dominate the conversation.
- Work across live activity, restored session history, desktop layouts, and narrow layouts.
- Retain accessible names, keyboard behavior, and non-color status cues.

## Success Criteria

- A collapsed Tool Activity card identifies the tool or tools used without requiring expansion.
- Single-tool, multi-tool, and repeated-tool groups remain clear and compact.
- Existing count, working/completed/error state, and elapsed-time information remains accurate and visible.
- Focus, Balanced, and Trace behavior remains consistent with the current design.
- Long tool-name sets degrade gracefully rather than overflowing or obscuring status information.
- Live and restored tool groups present the same summary information.
- Automated checks protect the summary behavior and existing tool-group states from regression.
