# Implementation Plan: Tool Names in Tool Activity

Source artifacts:

- `plan_tool-activity-tool-names_22082026.md`
- `spec_tool-activity-tool-names_22082026.md`

## Plan Goal Map

- **PG-1:** Understand agent activity without expanding successful groups.
- **PG-2:** Improve scanability and trust in long, tool-heavy conversations.
- **PG-3:** Preserve compact, conversation-first density behavior.
- **PG-4:** Keep failures and active work immediately recognizable.

## Ordered Chunks

### Chunk 1 — Pure tool-usage summary

- [x] Add a pure tool-name formatter to the existing dual-mode presentation helper and export it for Node tests.
  - **Tests:** `node test/tool-presentation.test.js` — 9 passed (FR-2, FR-3, FR-4, FR-5, FR-6, FR-14).
  - **Compliance:** Preserves first-seen order, aggregates exact repeats, applies the `tool` fallback, emits names only, and leaves existing activity metadata wording unchanged. Matches the compact, zero-dependency plan goals. ✓
  - **Delivers:** FR-2, FR-3, FR-4, FR-5, FR-14; PG-1, PG-2, PG-3.
  - **Scope:** `public/tool-presentation.js`, `test/tool-presentation.test.js`.
  - **Behavior:** Accept ordered tool names, apply the `tool` fallback, retain first-seen order, aggregate exact repeats as `×N`, and return text containing names only.
  - **Guardrail:** Keep the existing `toolGroupSummary()` count/state/duration contract unchanged.

#### TiCoder tests for Chunk 1

Run: `node test/tool-presentation.test.js`

- **T1.1 (FR-2, FR-3):** One `read` call formats as `read`, not `read ×1`.
- **T1.2 (FR-2, FR-3):** `read, read, edit, read` formats as `read ×3, edit`, proving first-seen order and repeat aggregation.
- **T1.3 (FR-4):** Missing and empty names format through the shared fallback, producing `tool ×2, write` for two unknown calls followed by `write`.
- **T1.4 (FR-2):** Exact display strings remain distinct, so `Read, read` preserves both entries in that order.
- **T1.5 (FR-5):** The formatter output contains only the supplied display names and counts; it has no API for arguments or results.
- **T1.6 (FR-6):** The four existing `toolGroupSummary()` assertions remain unchanged and pass.

These new assertions should currently fail because the formatter and export do not exist.

### Chunk 2 — Tool-group state and header integration

- [x] Track tool names in each activity group and render identity separately from existing status metadata.
  - **Tests:** `node test/tool-presentation.test.js` — 9 passed; `node test/a11y-contract.test.js` — PASS (FR-1, FR-6, FR-7, FR-8, FR-9, FR-10, FR-11, FR-13).
  - **Compliance:** Records names before every shared live/history group refresh, preserves count/state/duration and density/error behavior, and labels the native disclosure with the complete names plus status. Matches the plan's glanceability and active/error-recognition goals. ✓
  - **Delivers:** FR-1, FR-6, FR-7, FR-8, FR-9; PG-1, PG-2, PG-4.
  - **Depends on:** Chunk 1.
  - **Scope:** `public/app.js`, `test/a11y-contract.test.js`.
  - **Behavior:** Record each call's tool name when it joins a group, refresh the formatted identity immediately, preserve names after calls settle, and use the same path for live and restored calls.
  - **Presentation contract:** The header retains `Tool Activity`, gains a distinct tool-name region, and keeps the existing count/state/error/duration region intact.
  - **Accessibility contract:** The header exposes the complete combined activity description without requiring expansion.

#### TiCoder tests for Chunk 2

Run: `node test/a11y-contract.test.js`

- **T2.1 (FR-1, FR-11):** The Tool Activity summary markup contains separate tool-name and status-metadata regions.
- **T2.2 (FR-7):** The activity-group state records every joining call name before refreshing the header.
- **T2.3 (FR-6):** Status metadata still comes from the existing `toolGroupSummary()` path rather than being replaced by tool-name text.
- **T2.4 (FR-7):** Settling a call updates running/error state without removing or reordering the recorded tool-name sequence.
- **T2.5 (FR-8):** Both live event handling and restored message rendering continue to create tool rows through the shared tool-group path that records names.
- **T2.6 (FR-9):** Existing Focus/Balanced/Trace visibility and error-open conditions remain present.
- **T2.7 (FR-10, FR-13):** The native disclosure header has a complete accessible activity description containing tool identity and status.

These source-contract assertions should currently fail because no tool-name region or group-level name state exists.

### Chunk 3 — Bounded responsive presentation and documentation

- [x] Make the tool-name region responsive and document the completed behavior.
  - **Tests:** `node test/tool-presentation.test.js` — 9 passed; `node test/a11y-contract.test.js` — PASS; managed-browser desktop live/history smoke — PASS with no console errors (FR-10, FR-11, FR-12, FR-13, FR-14).
  - **Compliance:** Tool names are a bounded, single-line flex region that yields to fixed status metadata, exposes complete native pointer and accessible text, and preserves the disclosure/state styling. Design and changelog contracts now match the plan's compact scanability goal. ✓
  - **Delivers:** FR-10, FR-11, FR-12, FR-13, FR-14; PG-1, PG-3, PG-4.
  - **Depends on:** Chunk 2.
  - **Scope:** `public/style.css`, `public/app.js`, `test/a11y-contract.test.js`, `docs/design.md`, `CHANGELOG.md`.
  - **Behavior:** Allow the name region to yield space and visually truncate before fixed status metadata, prevent horizontal overflow, preserve the full accessible text, and provide native pointer disclosure for truncated names.
  - **Documentation:** Update the Tool Activity design contract and record the user-visible change.

#### TiCoder tests for Chunk 3

Run: `node test/a11y-contract.test.js`

- **T3.1 (FR-11, FR-12):** The tool-name region is a shrinkable flex item with a zero minimum width and bounded overflow.
- **T3.2 (FR-12):** Long visible tool text uses ellipsis or an equivalent single-line bound rather than widening the page or growing without limit.
- **T3.3 (FR-11):** The status-metadata region does not shrink behind the tool-name region.
- **T3.4 (FR-13):** The complete tool-name text is available through an accessible description and native pointer text disclosure.
- **T3.5 (FR-10, FR-14):** The header remains a native keyboard-operable disclosure and names/repetition counts remain textual rather than color-only.

Manual browser validation after the unit checks:

- At desktop width, confirm a completed multi-tool group shows names, total count, state, and duration while collapsed.
- At 390px width, confirm the name region truncates before status, the page has no horizontal overflow, and expanding the group remains keyboard operable.
- Confirm a running group and an errored group retain their current emphasis and automatic open behavior.
- Reload a session containing multiple tools and confirm its collapsed summary matches the live rendering.

The new CSS/accessibility assertions should currently fail because the responsive tool-name region and full-text disclosure do not exist.

## Dependencies

```text
Chunk 1: pure summary formatter
    ↓
Chunk 2: group-state and header integration
    ↓
Chunk 3: responsive/a11y presentation and docs
```

Each chunk is a checkpoint. Do not begin the next chunk until its listed tests pass and its plan/spec compliance note is written beneath the completed checkbox.

## Final Validation

After all chunk tests pass:

1. Run `node test/tool-presentation.test.js`.
2. Run `node test/a11y-contract.test.js`.
3. Run every `test/*.test.js` file with the repository's existing zero-framework Node test loop.
4. Run browser validation at desktop and 390px widths.
5. Re-open the plan and specification and map every FR and PG to the completed chunks before creating the verification artifact.

## TiCoder Approval Status

Approved by the user before implementation. All three chunks are complete with passing tests and compliance notes.
