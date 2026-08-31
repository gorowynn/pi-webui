# Plan: Complete the SDK adaptation

## Problem Statement

The live pi-webui server is now using Pi's official `AgentSessionRuntime`, but the migration is still a working-tree change and surrounding code, documentation, tests, and release metadata retain assumptions from the former Pi CLI/RPC subprocess architecture. The project needs one coherent SDK-native boundary so existing WebUI, extension, session, permission, workspace, JetBrains, and reconnect behavior remains reliable after the migration is committed and packaged.

## Business Goals

- Make the official Pi SDK the single primary-session runtime for standalone and IDE-hosted WebUI.
- Preserve the existing browser protocol and user workflows while removing obsolete transport complexity.
- Expose SDK capabilities—sessions, models, commands, skills, extension UI, state, and events—through a small, maintainable adapter.
- Keep approvals, permissions, workspace containment, reconnect, compaction, and failure handling trustworthy during runtime replacement.
- Produce a releaseable package whose source, tests, documentation, launcher, and dependency metadata all describe the same architecture.

## Constraints

- Use the official `@earendil-works/pi-coding-agent` SDK and `AgentSessionRuntime`; do not restore a Pi CLI subprocess for the primary session.
- Keep the zero-build vanilla browser, Node HTTP/SSE/fetch, and minimal-dependency architecture.
- Preserve `/api/cmd`, `/api/events`, `/api/snapshot`, workspace/session behavior, JetBrains integration, and existing security gates unless a compatibility defect requires an additive change.
- Keep one active SDK runtime per workspace, with explicit disposal and rebinding on workspace or session changes.
- Keep project trust disabled and load only the package-owned WebUI bridge extension unless a separate security decision approves otherwise.
- Maintain Node and package requirements required by the SDK, with no runtime installation step.
- Do not add unrelated rpiv features, new transport layers, or duplicate permission/session/workflow systems in this adaptation.
- Follow the SDD gates: no implementation changes until the implementation plan and test suite are approved.

## Success Criteria

- A fresh server start reports an SDK runtime that is ready, and the primary prompt, tool, approval, session, model, compaction, and abort flows work without a CLI agent subprocess or JSONL RPC forwarding layer.
- Browser-facing command and SSE event contracts remain compatible, with SDK-specific event differences contained at the runtime adapter boundary.
- Workspace switching, runtime disposal/recreation, reconnect replay, compaction-aware snapshots, multi-tab behavior, and pending approval recovery remain correct and covered by tests.
- Extension commands, skills, browser-backed dialogs, safeguards, isolated prompts, images, and JetBrains-hosted operation continue to work without gaining project-code execution by accident.
- Obsolete RPC/process assumptions are removed or explicitly documented as compatibility history across server code, launcher/environment documentation, tests, and roadmap material.
- Package metadata, lockfile, Node engine, published file list, and installation/startup instructions are internally consistent and pass packaging checks.
- The complete test suite plus focused SDK and manual smoke checks pass at desktop, narrow WebUI, and IDE-hosted boundaries, with no new console, focus, overflow, or security regressions.

## Scope Boundary

This effort completes and verifies the primary-session SDK migration and its compatibility surface. It does not introduce new research, workflow, telemetry, or UI product features; those can use the finished adapter in later SDD runs. The archived rpiv adaptation work remains historical and is not resumed by this plan.

## Approval Gate

This is Phase 1 only. Upon approval, Phase 2 will define the detailed user stories, functional requirements, data models, edge cases, and compatibility contracts in the matching specification artifact.
