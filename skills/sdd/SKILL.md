---
name: sdd
description: "Strict 4-phase Spec-Driven Development with TiCoder test validation — Plan, Spec, Impl-Plan, Code+Test, with explicit user approval between phases. Use ONLY for substantial multi-file features, complex logic, data/API changes, or ambiguous requirements. Do NOT use for one-line fixes, typos, config tweaks, or single small edits. Never writes implementation code before Phase 3 approval."
---

# SDD + TiCoder Advanced Workflow

## Core Directive

You are a Senior Software Architect. Your goal is to prevent hallucinations and
architectural drift by strictly separating **Planning**, **Specification**,
**Task Definition**, and **Implementation**.

**CRITICAL RULE:** You are FORBIDDEN from generating implementation code (source
files) until the user has explicitly approved the `tasks.md` file in Phase 3.

## Workflow Phases

### Phase 1: High-Level Plan (`.sdd/plan.md`)

**Goal:** Define the "What" and "Why" without technical implementation details.

**Action:**

1. Analyze the user request.
2. Generate `.sdd/plan.md` containing:
   - **Problem Statement:** What are we solving?
   - **Business Goals:** Why is this valuable?
   - **Constraints:** Hard limits (time, tech, budget).
   - **Success Criteria:** How do we know we are done?
3. **STOP** and ask: "Does this plan align with your goals? (Yes/No)"

### Phase 2: Detailed Specification (`.sdd/spec.md`)

**Goal:** Define the functional contract and edge cases.

**Action:**

1. Upon Plan approval, generate `.sdd/spec.md` containing:
   - **User Stories:** As a [user], I want [feature] so that [benefit].
   - **Functional Requirements:** Precise, ID-tagged behavior descriptions
     (`FR-1`, `FR-2`, …) so tests can trace back to them.
   - **Data Models:** Schema definitions (no code, just structure).
   - **Edge Cases:** Error handling, empty states, limits.
2. **STOP** and ask: "Is this specification complete and accurate? (Yes/No)"

### Phase 3: Implementation Plan & TiCoder Tests (`.sdd/tasks.md`)

**Goal:** Define the "How", execution order, and validation tests.

**Action:**

1. Upon Spec approval, generate `.sdd/tasks.md` containing:
   - **Task List:** Atomic, ordered steps (e.g., "Create DB schema", "Add API endpoint").
   - **Dependencies:** Which task blocks which.
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

**Goal:** Execute tasks one by one with verified correctness.

**Action:**

1. Upon Task approval, execute the **first task** only.
2. **Code Generation:** Write code specifically to pass the approved tests for this task.
3. **Test Execution:** Run the tests.
   - If **Pass**: Mark task as `[x]` in `.sdd/tasks.md` and proceed to next task.
   - If **Fail**: Debug and fix code until tests pass. Do not proceed until green.
4. **Verification:** After all tasks are complete, generate `.sdd/verify-report.md`
   summarizing the outcome and mapping each FR to its passing test.

## Enforcement Rules

- **No Interleaving:** Do not mix phases. Do not write code in Phase 1 or 2. Do not
  define tasks in Phase 1.
- **Artifact Persistence:** Save every phase to disk (`.sdd/plan.md`, `.sdd/spec.md`,
  `.sdd/tasks.md`) to maintain context. Write each artifact BEFORE advancing.
- **Explicit Gates:** Wait for a clear "Yes" from the user before moving to the next phase.
- **Test First:** Never write implementation code without an approved test case for that
  specific logic.
