# Plan: Adapt selected rpiv-mono capabilities

## Problem Statement

`rpiv-mono` contains useful Pi workflow patterns, but several of its features assume Pi's in-process SDK, terminal TUI, or a multi-session process manager. Directly importing them would duplicate capabilities already present in pi-webui or violate its zero-build, RPC, and single-active-child architecture.

pi-webui needs a focused adaptation plan that preserves the strongest ideas while fitting the existing browser workbench: transcript-safe secondary conversations, stronger review assistance, safe web/GitHub research, bounded workflow visibility, and safer skill parameterization.

## Business Goals

- Let users ask short side questions without polluting the primary transcript or session history.
- Make stronger-model review available for drafts, turns, and proposed changes without granting the reviewer tools.
- Give the agent bounded, security-reviewed web and GitHub research capabilities.
- Make multi-stage work understandable and resumable without introducing an unsupported process pool or parallel chat model.
- Improve reusable skill invocation with safe arguments while keeping shell execution under the existing safeguard policy.
- Preserve pi-webui's existing todo, questionnaire, SDD, fleet, usage, permission, and RPC behavior instead of creating competing systems.

## Constraints

- Keep Node 18+, browser SSE/fetch, Pi RPC subprocesses, and the zero-build/minimal-dependency model.
- Maintain one active Pi child per workspace; do not port rpiv-mono's in-process lane manager or detached-session supervisor wholesale.
- Keep all browser-facing paths, network access, process control, and persistence behind server-side validation and existing security gates.
- Side conversations and advisor calls must be bounded, no-tool, cancellable, and clearly separate from the primary transcript.
- Web research must be opt-in/configurable, limited to safe HTTP(S) access, bounded in size and duration, and protected against private-network/metadata probing.
- Telemetry must remain opt-in and must not silently export prompts, credentials, file contents, or tool arguments.
- Do not duplicate the existing `ask_user_question`, todo/discipline, fleet, SDD rail, usage-analysis, or browser-CDP systems.
- Voice, Warp notifications, a full i18n SDK, the rpiv monorepo packaging model, and direct MLflow integration remain explicitly out of this plan unless separately approved.

## Success Criteria

- Users can open a side question and receive an answer without a new transcript message, session-file entry, tool execution, or interruption of the active primary turn.
- Users can request an isolated advisor/reviewer response for a selected draft or turn and receive a structured, clearly labelled result with safe failure and cancellation behavior.
- The agent can perform bounded web/GitHub research with clear source URLs, predictable truncation, safe-network enforcement, and useful errors when configuration or access is unavailable.
- Workflow/stage state can be represented and surfaced through existing workspace tools without claiming unsupported concurrent chats; interrupted work can be understood or resumed from durable state.
- Skill arguments are expanded deterministically and safely, with malformed or missing arguments handled explicitly and no unreviewed shell-substitution escape hatch.
- Existing permission, todo, questionnaire, fleet, SDD, reconnect, compaction, session, and single-child tests remain green, with focused regression coverage for each adapted capability.
- The resulting UX remains usable at desktop, narrow WebUI, and JetBrains-hosted widths and follows the existing accessibility and visual contracts.

## Scope Boundary

This plan adapts behavior and small, compatible patterns from `rpiv-btw`, `rpiv-advisor`, `rpiv-web-tools`, `rpiv-workflow`, `rpiv-args`, and the bounded telemetry dispatcher. It does not transplant their package layout, terminal-only UI, Pi SDK runner, or provider ecosystem wholesale.
