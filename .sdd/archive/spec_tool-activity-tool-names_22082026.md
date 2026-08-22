# Specification: Tool Names in Tool Activity

Source plan: `plan_tool-activity-tool-names_22082026.md`

## User Stories

- As a user scanning a conversation, I want a collapsed Tool Activity card to name the tools used so that I can understand the work without opening it.
- As a user reviewing repeated activity, I want repeated calls summarized clearly so that the header stays compact without hiding repetition.
- As a user on a narrow screen, I want status information to remain readable even when many tools were used.
- As a keyboard or assistive-technology user, I want the complete tool summary to remain available without relying on color or pointer hover alone.

## Functional Requirements

### Tool identity

- **FR-1:** Every visible Tool Activity group header must include a tool-usage summary in addition to its existing activity metadata.
- **FR-2:** The tool-usage summary must list tool names in the order in which each distinct name first appears in the group.
- **FR-3:** Repeated calls to the same exact tool name must be represented once with a multiplication count, such as `read ×3`. A tool used once has no multiplication suffix.
- **FR-4:** A missing, empty, or non-displayable tool name must use the existing fallback label `tool` and participate in counting like any other name.
- **FR-5:** The summary must expose tool names only. Tool arguments, commands, paths, results, and other call details must remain inside the expanded activity rows.

### Existing activity behavior

- **FR-6:** Existing total-call count, running state, error count, completion state, and elapsed duration must remain accurate and visible.
- **FR-7:** Tool names and repetition counts must update as soon as a new tool call joins the group. Settling a call must not reorder or remove its tool identity.
- **FR-8:** Live activity and reconstructed session history must produce the same tool-usage summary for the same ordered calls.
- **FR-9:** Existing density behavior must remain unchanged: Focus may hide successful tool work, Balanced collapses successful completed groups, Trace exposes details, and groups with errors remain exposed. Whenever a group header is visible, its tool-usage summary is visible or accessibly available.
- **FR-10:** Existing disclosure keyboard behavior, focus behavior, error emphasis, and non-color status indicators must remain unchanged.

### Compact and accessible presentation

- **FR-11:** Tool identity and status metadata must be separate readable portions of the header so a long tool list cannot obscure call count or state.
- **FR-12:** When horizontal space is insufficient, the visible tool-name portion may truncate, but the header must not cause horizontal page overflow or uncontrolled height growth.
- **FR-13:** The complete, untruncated ordered tool-usage summary must remain available in the header's accessible name or description. Pointer users must also have a native text disclosure such as a title when visual truncation occurs.
- **FR-14:** Tool identity must remain understandable without color; punctuation, text, and repetition counts carry the meaning.

## Data Models

### Tool Activity Summary

| Field | Meaning |
| --- | --- |
| `totalCalls` | Number of tool calls in the group. |
| `tools` | Ordered collection of distinct tool identities. |
| `runningCalls` | Number of calls that have not settled. |
| `errorCalls` | Number of settled calls that failed. |
| `state` | Current textual activity state derived from running and error counts. |
| `duration` | Existing elapsed-time label, when available. |

### Tool Identity Entry

| Field | Meaning |
| --- | --- |
| `name` | Displayable registered tool name, or `tool` fallback. |
| `callCount` | Number of calls with that exact display name in the group. |
| `firstSeenOrder` | Stable position determined by the first matching call. |

No tool arguments or result data are part of either summary model.

## Edge Cases

- **One call:** Show the single tool name without `×1`; retain `1 tool` and current state.
- **Repeated calls:** Aggregate exact repeated names while keeping the total-call count unchanged.
- **Mixed tools:** Keep distinct names in first-seen order even when later calls repeat an earlier name.
- **Unknown names:** Group all fallback `tool` names consistently and count their repetitions.
- **Case differences:** Treat different exact display strings as distinct; no new normalization is introduced.
- **Running plus errors:** Preserve the current mixed error/working state while continuing to show every recorded tool identity.
- **Long names or many distinct tools:** Keep status readable, prevent horizontal overflow, and expose the complete list accessibly even if the visible list truncates.
- **Zero-call group:** No new empty group should be created. If legacy or malformed state produces one, retain the existing count/status fallback without inventing a tool name.
- **Restored history:** Missing timing data may omit duration as it does today; tool identity must still match the restored calls.
