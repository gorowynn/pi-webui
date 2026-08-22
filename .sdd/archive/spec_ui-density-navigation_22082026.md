# Specification: UI Density and Navigation

Source plan: `plan_ui-density-navigation_22082026.md`

## User Stories

- As a user returning to a project, I want the current workspace and recent sessions to be immediately visible so that I can resume work quickly.
- As a user reading a long conversation, I want assistant prose to dominate operational metadata so that I can follow the result without losing access to details.
- As a user monitoring workspace state, I want the inspector rail to remain legible and discoverable so that its widgets are useful rather than decorative.
- As a user managing permissions, I want current posture, my overrides, grants, and pending decisions prioritized over inherited rule detail.
- As a user monitoring subagents, I want active work and failures prioritized over completed history so that I can act promptly.
- As a narrow-screen user, I want primary status and composer actions available without clipped labels or a crowded control row.
- As a keyboard or assistive-technology user, I want every disclosure, filter, overflow action, and state change to remain understandable and operable.
- As a user of either theme, I want the same hierarchy, readability, and behavior in dark and paperlike modes.

## Functional Requirements

### Global readability and interaction targets

- **FR-1:** Ordinary navigation, form, and card text must render at no less than 13px. Secondary metadata may render at 11px but must not fall below 10px.
- **FR-2:** Normal text must meet WCAG AA contrast against its rendered background; meaningful boundaries and state indicators must meet the applicable non-text contrast requirement.
- **FR-3:** Primary and icon-only controls must provide at least a 32×32px interactive target on pointer layouts and at least 44×44px when hover is unavailable.
- **FR-4:** Monospace styling remains available for code, paths, selectors, commands, and compact metadata; ordinary labels and prose may use a more readable UI face without losing the terminal-inspired identity.
- **FR-5:** Increased readability must not introduce horizontal page overflow at supported viewport widths.
- **FR-6:** Color must not be the sole indication of active, failed, selected, expanded, or security-relevant state.

### Workspace and session navigation

- **FR-7:** When workspace switching is available, the workspace section must start collapsed on page load with the active workspace row visible.
- **FR-8:** A labelled native control must expand and collapse the complete workspace list, expose its state through `aria-expanded`, and operate by pointer, Enter, and Space.
- **FR-9:** Collapsing the workspace list must hide only inactive workspace rows; the active workspace and workspace-section heading remain visible.
- **FR-10:** If no active workspace can be identified, the complete workspace list or an explicit error/empty state must remain visible rather than producing an empty collapsed section.
- **FR-11:** After a successful workspace switch, the workspace section returns to its compact state and identifies the new active workspace.
- **FR-12:** `PI_WEBUI_NO_SWITCH` continues to hide the workspace section and its controls entirely.
- **FR-13:** The Sessions heading and session search remain available while the session list scrolls.
- **FR-14:** Session search filters the current workspace's sessions case-insensitively by display name and first-prompt text, with an explicit clear action and a visible result count or empty state.
- **FR-15:** Session search is transient and clears when the workspace changes or a new session is started; it does not alter or delete session data.
- **FR-16:** Current-session selection, resume behavior, new-session confirmation, drawer focus restoration, scrim behavior, and narrow-screen Escape handling remain unchanged.

### Conversation hierarchy

- **FR-17:** Each rendered assistant turn has one primary visual identity; repeated `assistant` labels must not compete with prose within the same turn.
- **FR-18:** Assistant prose remains the visually strongest content in a turn. Thoughts, Tool Activity, and usage metadata remain available but use quieter surfaces and typography.
- **FR-19:** Successful operational detail follows existing density semantics: Focus may hide it, Balanced summarizes it, and Trace exposes it.
- **FR-20:** Running work, failures, approvals, operational notices, and tool errors remain visible regardless of density where the existing contract requires them.
- **FR-21:** Tool Activity headers continue to show ordered tool names, repetition counts, total calls, state, errors, and duration without exposing arguments or results while collapsed.
- **FR-22:** Usage metadata appears once per assistant turn as subordinate metadata and remains available to session-analysis navigation.
- **FR-23:** Live streaming and restored history produce equivalent turn hierarchy and content ordering.

### Inspector rail

- **FR-24:** In wide mode, every visible inspector tab presents either its complete text label or an intentional icon-only representation with an accessible name and tooltip; partial clipped words are not allowed.
- **FR-25:** Count and state badges remain readable without clipping and use compact bounded values when counts exceed available space.
- **FR-26:** The selected widget is identifiable through visible styling plus `aria-selected`; selection must not rely on a narrow accent stripe or color alone.
- **FR-27:** Every rail tab meets the global target-size requirement and retains roving-tabindex keyboard behavior.
- **FR-28:** Mid and narrow modes retain the contained bottom-sheet behavior, focus trap, Escape close path, and trigger-focus restoration.
- **FR-29:** The narrow-screen inspector launcher is visibly discoverable, labelled, and does not overlap the workspace launcher, composer, or permission indicator.

### Desktop and utility-page space

- **FR-30:** Chat prose remains constrained to a readable line length on wide displays.
- **FR-31:** At viewport widths of 1440px or greater, Permissions and Fleet may use a content width between 1100px and 1280px when data benefits from additional columns or unwrapped detail.
- **FR-32:** Utility pages use the available width responsively below that threshold without horizontal page overflow or fixed-width clipping.

### Permissions usability

- **FR-33:** The default Permissions view prioritizes current posture, pending decisions, user-layer overrides, and active grants before inherited or raw policy detail.
- **FR-34:** Floor/default and workspace-layer rules are grouped by tool and collapsed behind a clearly labelled inherited-policy disclosure by default.
- **FR-35:** User-layer rules remain directly editable and visually distinguishable from locked inherited rules.
- **FR-36:** Rule search/filter matches tool name, action, layer, and visible selector text without changing the policy configuration.
- **FR-37:** Known common selectors may receive a human-readable explanation, but the exact selector and provenance remain available and authoritative.
- **FR-38:** Explain, add, remove, revoke, posture, and yolo-confirm behavior retain their existing policy-engine and revision-check contracts.
- **FR-39:** Empty, loading, stale-revision, malformed-config, and failed-save states remain explicit and actionable.
- **FR-40:** Security-sensitive state and destructive actions remain prominent and may not be hidden solely because advanced policy detail is collapsed.

### Fleet usability

- **FR-41:** Fleet displays summary counts for active, failed, stopping, and completed runs.
- **FR-42:** Runs are ordered by action priority: active/stopping first, failed second, completed history last; ordering within a group remains newest first.
- **FR-43:** Completed runs are collapsed under a labelled history disclosure by default and remain one action away.
- **FR-44:** Active and failed run cards show their most relevant status, elapsed time, agent/workflow identity, and step summary without opening a log.
- **FR-45:** A failed run presents a bounded failure reason when one exists, while the full run/step log remains accessible.
- **FR-46:** Fleet filtering supports status and text matching without mutating run artifacts.
- **FR-47:** Steering clearly names the selected target, disables sending when no steerable run is selected, and preserves the current stop/force-stop safety behavior.
- **FR-48:** Polling, cached open logs, row selection, and control-inbox wire contracts remain unchanged.
- **FR-49:** Empty, loading, stale, stopped, and unreachable-runner states remain explicit and do not leave an apparently interactive but ineffective control.

### Header and composer density

- **FR-50:** The header always keeps connection state, settings access, and the active conversation-density control available.
- **FR-51:** Repository, model, thinking, cache, IDE, and Git status must not degrade into partially clipped fragments; lower-priority status moves into a labelled overflow disclosure when space is insufficient.
- **FR-52:** Header overflow content preserves the full text and current state of every moved status item.
- **FR-53:** The composer always keeps permission posture, Send, and Stop immediately available.
- **FR-54:** On narrow layouts, Compact, Improve, Sessions, New Session, and other secondary actions move into one labelled overflow disclosure rather than wrapping into competing rows.
- **FR-55:** Image attachment remains discoverable when supported and becomes immediately visible whenever images are attached or require user action.
- **FR-56:** Composer overflow actions retain their existing keyboard shortcuts, disabled states, confirmation gates, and accessible names.
- **FR-57:** The resting composer must not obscure the latest message, jump-to-bottom control, or narrow-screen inspector/workspace launchers.
- **FR-58:** Expanding the textarea for user-authored multiline content remains allowed and must not be constrained by the compact resting-state requirement.

### State, themes, and validation

- **FR-59:** Workspace expansion, session query, permission filter/disclosures, Fleet filter/history disclosure, and transient overflow state are browser-local presentation state only; none changes server data or RPC contracts.
- **FR-60:** Workspace expansion and session query reset on workspace change. Other presentation state may persist only where an existing canonical local-storage contract already exists.
- **FR-61:** Dark and paperlike themes expose the same controls, ordering, labels, and responsive behavior.
- **FR-62:** `prefers-reduced-motion` continues to suppress nonessential transitions introduced or retained by this effort.
- **FR-63:** Wide, mid, and narrow layouts must pass automated source/behavior contracts plus managed-browser smoke checks for overflow, visibility, focus, and console errors.
- **FR-64:** Existing unit tests remain green, and each changed behavior receives a focused regression test before its implementation chunk is complete.

## Data Models

All models below are client-side view projections. No server, session-file, RPC, policy, or subagent artifact schema changes are required.

### Workspace Navigation State

| Field | Meaning |
| --- | --- |
| `expanded` | Whether inactive workspaces are currently visible. Defaults to `false`. |
| `activePath` | Path of the active workspace, when known. |
| `query` | Transient session-search text. Defaults to empty. |
| `visibleSessionCount` | Number of sessions matching the current query. |

### Inspector Presentation State

| Field | Meaning |
| --- | --- |
| `selectedWidget` | Existing canonical selected widget identifier. |
| `open` | Existing canonical panel-open state. |
| `width` | Existing canonical wide-mode rail width. |
| `narrowLauncherVisible` | Derived visibility of the narrow-screen launcher. |

### Permissions View State

| Field | Meaning |
| --- | --- |
| `filter` | Transient rule-search text. |
| `inheritedExpanded` | Whether inherited policy detail is disclosed. Defaults to `false`. |
| `pendingCount` | Derived count of pending decisions. |
| `userRuleCount` | Derived count of editable user-layer rules. |

### Fleet View State

| Field | Meaning |
| --- | --- |
| `statusFilter` | Selected status group or `all`. |
| `textFilter` | Transient text query. |
| `historyExpanded` | Whether completed history is disclosed. Defaults to `false`. |
| `selectedRunId` | Current steering/log target, when valid. |
| `summaryCounts` | Derived active, failed, stopping, and completed totals. |

### Responsive Overflow State

| Field | Meaning |
| --- | --- |
| `headerOverflowOpen` | Transient header-disclosure state. |
| `composerOverflowOpen` | Transient composer-disclosure state. |
| `widthClass` | Existing `w-wide`, `w-mid`, or `w-narrow` body mode. |

## Edge Cases

- **Single workspace:** The active workspace remains visible; the expand control may be disabled or hidden because there are no inactive rows.
- **Missing active workspace:** The workspace list remains expanded with an explicit state rather than hiding every row.
- **Workspace fetch failure:** The current error text remains visible and the section cannot appear successfully collapsed and empty.
- **Large workspace/session sets:** Lists remain bounded and scrollable; filtering does not block input or discard unrendered records.
- **Session with no name or prompt:** It remains searchable by any available metadata and is not lost from an empty query.
- **Streaming turn interrupted by restart:** Restored content uses the same hierarchy and does not duplicate labels or usage metadata.
- **Very long tool, repository, model, selector, or run names:** Critical state remains visible; full text is available through accessible/native disclosure without horizontal overflow.
- **No inspector widgets visible:** The rail and narrow launcher do not present an empty interactive shell.
- **Pending permission while advanced policy is collapsed:** The pending decision remains prominent and fully actionable.
- **Policy revision conflict:** User input is preserved where it is today and the stale state remains explicit.
- **No Fleet runs:** Summary and controls degrade to a clear empty state; steering remains disabled.
- **Selected Fleet run completes between polls:** Selection reconciles safely, steering disables, and history retains the run.
- **Failed run without a captured reason:** Show a generic failed state and preserve log access without inventing detail.
- **Touch device at desktop CSS width:** Hover-independent target sizing and disclosure behavior still apply.
- **Browser zoom or translated labels:** Layout yields or overflows into disclosures rather than clipping critical text.
- **IDE no-switch mode:** Workspace controls remain absent while session navigation, chat hierarchy, and other improvements still apply.
- **Theme switch while a disclosure is open:** State and focus remain valid, and content remains readable in the new theme.
