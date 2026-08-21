# Plan: Contextual Git Review Workspace

## Problem Statement

pi-webui already provides a strong conversation surface, workspace/session navigation,
tool grouping, permissions, and Git operations, but those capabilities are split
between compact rails and the transcript. The reference UI makes repository state,
branch context, tool progress, and code review part of one coherent workbench.

Users should be able to move from an agent action to the affected files and review
the resulting diff without losing conversation context, while narrow screens must
remain focused on one active surface instead of squeezing all panels together.

## Business Goals

- Make repository state and code-review context immediately understandable.
- Reduce the number of steps between an agent tool call and reviewing its changes.
- Give the existing Git and diff capabilities a more visible, contextual home.
- Improve session/workspace orientation without turning the UI into a cloud PR client.
- Preserve pi-webui's terminal-adjacent, dependency-free, security-first identity.

## Scope

This plan covers an incremental workbench adaptation:

1. A contextual Changes/review surface built around the existing Git snapshot and
   diff capabilities.
2. Compact repository/branch/change context in the shell.
3. More useful workspace/session metadata in the left navigation.
4. Lightweight tool-timeline actions linking commands to files or diffs.
5. A narrow-screen active-pane model for Chat, Changes, Usage, and Tasks.
6. Composer hierarchy and affordance polish that keeps the existing permission,
   image, context-meter, and Improve features.

The first meaningful milestone is the contextual Git review workspace; the other
items should support it rather than become unrelated redesign work.

## Constraints

- Keep the zero-build, vanilla-browser architecture and existing dependency policy.
- Reuse current `#toolsbar`, `rail.js`, `git.js`, diff, permission, and session seams
  instead of introducing a parallel navigation system.
- Do not add cloud PR integration, voice controls, or a browser code editor in this
  effort unless separately approved.
- Do not weaken safeguard/permission flows, editable-diff confirmation, keyboard
  access, or mobile focus containment.
- Preserve existing RPC/API wire contracts and current Git mutation confirmations.
- The result must work on wide desktop and narrow viewport modes without horizontal
  overflow or clipped composer actions.

## Success Criteria

- A user can identify the current repository, branch, and change summary from the
  shell without opening a separate modal.
- A user can open the changed-file list and inspect a selected diff from the
  contextual review surface while retaining access to the conversation.
- Tool activity exposes only useful, low-noise links/actions and remains compact by
  default.
- Workspace/session rows provide enough state to distinguish active, idle, and
  relevant sessions without becoming oversized cards.
- Narrow layouts present one usable active surface at a time; drawers, sheets, and
  composer actions do not clip or create horizontal page scroll.
- Existing permission, Git, diff, session, rail, and browser-tool tests remain green,
  with focused coverage added for any new state or formatting behavior.
- A live browser review at desktop and narrow widths shows no new console errors,
  horizontal overflow, or broken focus/keyboard paths.

## Approval Gate

This is Phase 1 only. Upon approval, Phase 2 will define the detailed user stories,
functional requirements, data models, and edge cases in the matching specification
artifact.
