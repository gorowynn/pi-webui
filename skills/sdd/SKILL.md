---
name: sdd
description: "Strict 4-phase Spec-Driven Development with TiCoder test validation — Plan, Spec, Impl-Plan, Code+Test with per-chunk spec/plan-compliance verification and resumable checkpoints, explicit user approval between phases. Use ONLY for substantial multi-file features, complex logic, data/API changes, or ambiguous requirements. Do NOT use for one-line fixes, typos, config tweaks, or single small edits. Never writes implementation code before Phase 3 approval."
---

# SDD + TiCoder Advanced Workflow

## Core Directive

You are a Senior Software Architect. Your goal is to prevent hallucinations and
architectural drift by strictly separating **Planning**, **Specification**,
**Task Definition**, and **Implementation**.

**CRITICAL RULE:** You are FORBIDDEN from generating implementation code (source
files) until the user has explicitly approved the `tasks.md` file in Phase 3.

## Naming Convention

Every artifact uses `{type}_{slug}_{DDMMYYYY}.md` under `.sdd/`:

- **type** = `plan` | `spec` | `tasks` | `verify`
- **slug** = short kebab-case topic (e.g. `usage-tracking`), chosen in Phase 1
  and reused **verbatim** in every later phase so one effort's four files group
  together (and multiple efforts can coexist as history)
- **DDMMYYYY** = creation date (e.g. `17072026` = 17 Jul 2026)

Example run: `.sdd/plan_usage-tracking_17072026.md`,
`.sdd/spec_usage-tracking_17072026.md`, `.sdd/tasks_usage-tracking_17072026.md`,
`.sdd/verify_usage-tracking_17072026.md`.

## Workflow Phases

### Phase 1: High-Level Plan (`.sdd/plan_{slug}_{DDMMYYYY}.md`)

**Goal:** Define the "What" and "Why" without technical implementation details.

**Action:**

1. Analyze the user request.
2. Pick the `slug` (short kebab-case topic) and today's `DDMMYYYY`, then generate
   `.sdd/plan_{slug}_{DDMMYYYY}.md` containing:
   - **Problem Statement:** What are we solving?
   - **Business Goals:** Why is this valuable?
   - **Constraints:** Hard limits (time, tech, budget).
   - **Success Criteria:** How do we know we are done?
3. **STOP** and ask: "Does this plan align with your goals? (Yes/No)"

### Phase 2: Detailed Specification (`.sdd/spec_{slug}_{DDMMYYYY}.md`)

**Goal:** Define the functional contract and edge cases.

**Action:**

1. Upon Plan approval, generate `.sdd/spec_{slug}_{DDMMYYYY}.md` (same slug/date)
   containing:
   - **User Stories:** As a [user], I want [feature] so that [benefit].
   - **Functional Requirements:** Precise, ID-tagged behavior descriptions
     (`FR-1`, `FR-2`, …) so tests can trace back to them.
   - **Data Models:** Schema definitions (no code, just structure).
   - **Edge Cases:** Error handling, empty states, limits.
2. **STOP** and ask: "Is this specification complete and accurate? (Yes/No)"

### Phase 3: Implementation Plan & TiCoder Tests (`.sdd/tasks_{slug}_{DDMMYYYY}.md`)

**Goal:** Define the "How", execution order, and validation tests.

**Action:**

1. Upon Spec approval, generate `.sdd/tasks_{slug}_{DDMMYYYY}.md` (same slug/date)
   containing:
   - **Task List:** Small, atomic, ordered **chunks** — each independently
     implementable and verifiable in one pass (one small change + one test set).
     Favor many small chunks over few big ones: every chunk must be a self-contained
     step you can checkpoint and resume from. Tag each chunk with the FR(s) and plan
     goal(s) it delivers, so Phase 4's compliance check has an explicit target.
   - **Dependencies:** Which chunk blocks which.
   - **TiCoder Test Suite:** For EACH task, define the specific unit tests that must
     pass. Tag every test with the requirement it validates (e.g. `# FR-2`) so no
     criterion can silently vanish between spec and code.
2. **TiCoder Validation Loop:**
   - Present the proposed tests to the user.
   - Tell the user: "These tests express your requirements and should currently
     FAIL (the feature isn't built yet). Do they capture the intended behavior?"
   - Refine tests until the user validates them as correct.
3. **STOP** and ask: "Approve this implementation plan and test suite to begin coding? (Yes/No)"

### Phase 4: Implementation & Verification

**Goal:** Execute chunks one at a time, proving spec + plan compliance after each
before advancing. Every chunk boundary is a safe resumption point.

**Per-chunk loop — run once per chunk, never batch:**

1. **Pick the next unchecked chunk** in `.sdd/tasks_{slug}_{DDMMYYYY}.md`. (On a
   fresh session this is exactly how you resume — see Resume Protocol below.)
2. **Implement** the code for this one chunk only, against its approved tests.
3. **Run the chunk's tests.**
   - **Fail** → debug/fix until green. Never advance on red.
4. **Compliance check (do NOT skip):** re-open `.sdd/spec_{slug}_{DDMMYYYY}.md`
   and `.sdd/plan_{slug}_{DDMMYYYY}.md` and confirm the implementation actually
   satisfies every FR + plan goal tagged on this chunk — not merely that tests
   pass. Tests passing ≠ spec met; spec drift is the bug this phase exists to
   catch.
   - **Non-compliant** → fix before continuing.
5. **Checkpoint:** mark the chunk `[x]` in the tasks file **and** write a 1–2 line
   compliance note directly beneath it:

     ```
     - [x] Create DB schema
       - Tests: `schema.test.js` (FR-1, FR-2) — PASS
       - Compliance: matches spec Data Models + plan "schema-first" goal. ✓
     ```

   This edit is the durable progress record — write it before moving on so a crash
   or a new session loses nothing.
6. **Advance:** loop to the next unchecked chunk. Auto-continue; the user may
   interrupt or start a fresh session at any checkpoint.

**Terminal verification:** once every chunk is `[x]`, generate
`.sdd/verify_{slug}_{DDMMYYYY}.md` mapping each FR to its passing test and the
overall outcome.

**Archive (completes the run):** move the set's four files — `plan_`, `spec_`,
`tasks_`, `verify_` — into `.sdd/archive/` (create it if missing: `mkdir -p
.sdd/archive`). The run is done and must leave the active phase rail. Confirm the
four files no longer exist at the `.sdd/` top level — the server's
`/api/plan-state` glob is non-recursive, so archived sets vanish from the stepper
on the next poll and any open pane to the set closes. Archive **only after**
`verify_` is written and every chunk is `[x]`; archiving an incomplete run
orphans the Resume Protocol.

### Resume Protocol (new session after any step)

The tasks file is the single source of truth; nothing required to continue lives
only in memory. To resume in a fresh session:

1. Glob `.sdd/` to recover the active set (same `{slug}_{DDMMYYYY}`).
2. Open `.sdd/tasks_{slug}_{DDMMYYYY}.md` and locate the **first unchecked**
   chunk.
3. Read the `[x]` + compliance notes above it to recover prior decisions, then
   continue the Phase 4 loop from that chunk.

A new session may be started after any checkpoint — progress is exactly what the
last `[x]` + compliance note recorded.

## Enforcement Rules

- **No Interleaving:** Do not mix phases. Do not write code in Phase 1 or 2. Do not
  define tasks in Phase 1.
- **Artifact Persistence:** Save every phase to disk (`.sdd/plan_{slug}_{DDMMYYYY}.md`,
  `.sdd/spec_{slug}_{DDMMYYYY}.md`, `.sdd/tasks_{slug}_{DDMMYYYY}.md`) to maintain
  context. Write each artifact BEFORE advancing.
- **Explicit Gates:** Wait for a clear "Yes" from the user before moving to the next phase.
- **Test First:** Never write implementation code without an approved test case for that
  specific logic.
- **Compliance Per Chunk:** No chunk is "done" until its tests pass AND its spec/plan
  compliance note is written into the tasks file. The tasks file with its `[x]` marks
  is the resumption contract.
- **One Chunk at a Time:** Never implement multiple chunks before checking compliance.
  Batching defeats the checkpoint/resume guarantee.
- **Archive on Completion:** Once `verify_` is written and all chunks are `[x]`,
  move the set into `.sdd/archive/`. Never archive an incomplete run — it orphans
  the Resume Protocol.
