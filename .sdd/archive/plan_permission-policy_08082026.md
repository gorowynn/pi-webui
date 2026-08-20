# Phase 1 — High-Level Plan: Permission Policy & Approval Broker (U6 + permission modes)

> Slug: `permission-policy` · Date: `08082026` · SDD Phase 1 artifact.
> Source requirements: roadmap U6 (`docs/roadmap.md` §4) + user addition:
> **four permission modes — default / auto-approve / read-only / yolo.**

## Problem Statement

The current gate (`extensions/pi_minimal_webui/safeguard.ts`) is a single
config file with first-match-wins string resolution. It is not trustworthy
enough to be the security boundary for a coding agent:

- **Compound commands are misjudged.** Bash rules match the raw command string
  with substring/regex patterns — `git status && rm -rf ./src`,
  `echo $(cat ~/.ssh/id_rsa)`, and `git remote remove origin` all match
  read-only auto-allow patterns and pass without a prompt.
- **Approvals are fragile.** Blocking extension-UI requests are not replayed
  after a browser reload; closing a permission modal can drop the response
  before it is acknowledged; persistent grants are global, insertion-order
  sensitive, and poorly described.
- **Rule provenance is invisible.** There is no way to see which rule matched,
  why, or what the effective policy is — the config is a raw JSON file.
- **No global posture control.** The user cannot switch the whole workbench
  between "ask me" and "trust the agent" without editing rules by hand.

The user adds a requirement: **four permission modes** — `default`
(current behavior), `auto-approve` (skip asks, keep hard denials), `read-only`
(deny all mutations, no prompts), `yolo` (allow everything, no prompts,
session-scoped).

## Business Goals

1. **No dangerous compound command is mistaken for safe** — the gate classifies
   bash conservatively: every subcommand must be allowed, substitutions /
   redirects / separators / ambiguity force an ask.
2. **Every blocking approval survives reconnect and multi-tab use** — a
   server-owned pending-request broker replays, resolves once, and acknowledges
   before the UI closes.
3. **Users can see and edit the effective policy** without touching config
   files — a dedicated `#permissions` page with structured rule editor,
   effective-layers view, active grants, and an Explain form.
4. **One global posture switch** — the four modes are a single visible control
   with clear, safe semantics; `yolo` is an explicit, session-scoped, confirmed
   engagement — never the persisted default.
5. **Same enforcement for the native IDE** — the JetBrains approval bridge
   shares the policy and modes, not a second implementation.

## Constraints

- Zero-build, low-dependency: no new runtime npm packages, no bundler. Policy
  engine = pure zero-dep module (CommonJS, Node-testable), same as
  `git.js`/`jsonl.js`.
- The pi extension stays minimal-dep and re-reads policy on every call
  (live edits apply without restart).
- `safeguard.ts` tool name/wire contract with the LLM is unchanged; the
  `tool_call` hook stays the single enforcement point (composes with
  `discipline.ts`).
- One active pi child per workspace; server-authoritative cwd/path
  validation; CSRF/DNS-rebinding defenses retained.
- Browser never supplies a config path or unrestricted filesystem API — only
  fixed `/api/permissions` endpoints with schema validation and atomic writes.
- Non-goal (roadmap): an LLM permission judge, a silent always-on bypass.
  `yolo` is included only because the user explicitly requested it — with
  guardrails (confirm-to-engage, session-scoped, visible indicator).
- U5's editable-diff (Review/Edit) rendering is reused for file-change
  approvals; the JetBrains native diff remains preferred in IDE mode.

## Scope (deliverables of this run)

1. **Zero-dep policy engine** (`policy-engine.js`, new module): rule
   provenance (which rule matched, why), documented precedence
   (hard-deny → mandatory-ask → remembered-grant → ordinary-ask → allow),
   versioned layered config (global + canonical-workspace; project content may
   tighten, never grant), canonical path/symlink handling.
2. **Conservative bash classifier**: allow only when *every* subcommand is
   allowed; ask on substitutions, redirects, separators, ambiguity; unsafe
   default auto-allows removed (`echo`, mutating `git branch`/`git remote`).
3. **Sensitive-path policy applied to every path-capable tool**, including
   grep/find/list operations.
4. **Permission modes** (default / auto-approve / read-only / yolo) as a
   transformation layer above the resolved action, enforced in safeguard.ts:
   - `default` — current ask/deny behavior.
   - `auto-approve` — `ask` → allow; hard `deny` still blocks.
   - `read-only` — read-class tools/commands only; everything else denies
     without prompting (secret-class reads also denied).
   - `yolo` — every action allows, no prompts; **session-scoped** (never
     persisted), requires an explicit confirm gesture, shown in the UI as an
     active warning state.
   - `default`/`auto-approve`/`read-only` persist in the policy config
     (re-read per call); `yolo` lives in safeguard's session state and dies
     with the session.
5. **Server-owned pending-request broker** (`server.js`): snapshot/reconnect
   replay of blocking approvals, first-response-wins, resolved broadcasts,
   stale-ID rejection, timeout/abort, cleanup on pi exit/workspace switch.
6. **Browser approval UX**: versioned permission marker keyed by `toolCallId`
   (replaces label heuristics + global `curToolArgs`), await
   acknowledgement before closing, Esc/backdrop = Deny with retryable
   decision, pending approval rendered in its tool card with risk reasons,
   matched rule, grant scope, and U5's Review/Edit diff.
7. **`#permissions` page**: effective/default/user/workspace layers,
   structured rule editor, pending approvals, active grants (revoke/clear),
   config diagnostics, redacted audit, Explain form, mode selector.
8. **JetBrains bridge hardening**: canonical project containment,
   request-ID-keyed resolvers, unsaved-document/conflict handling, same
   policy/mode metadata.

## Success Criteria

- Every verified defect from the roadmap is closed by a test: the three
  example bypasses (`git status && rm -rf ./src`, `echo $(cat ~/.ssh/id_rsa)`,
  `git remote remove origin`) are NOT auto-allowed; blocked approvals replay
  after reload; the modal never closes before its response is acknowledged.
- The policy engine, bash classifier, mode transformation, and broker are pure
  modules with unit tests (≥1 test per FR; zero-dep, `node test/…`).
- The four modes behave per spec in automated tests AND manual smoke checks
  (auto-approve skips asks but still denies hard-denies; read-only denies a
  write with no prompt; yolo requires confirmation, allows everything, and
  does not survive a session restart).
- The `#permissions` page shows effective vs default vs user vs workspace
  layers with matched-rule provenance; Explain returns the same verdict as
  the live gate for sampled calls.
- A multi-tab test proves: approval asked in tab A resolves in tab B; a
  reloaded tab replays the pending request; a stale response is rejected.
- All existing suites stay green; the JetBrains plugin build still passes its
  diff-gate wire contract tests.

---

**STOP — Phase 1 gate.** Does this plan align with your goals — in particular
the mode semantics (auto-approve keeps hard denials, read-only denies without
asking, yolo is session-scoped + confirm-gated)? (Yes/No)
