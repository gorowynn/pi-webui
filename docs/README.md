# docs/ — pi-webui documentation

> **Single source of truth.** Project knowledge for pi-webui lives in exactly
> four places: [`../AGENTS.md`](../AGENTS.md) (agent orientation, **auto-loaded
> by pi**, conventions index, open work), [`../GOTCHAS.md`](../GOTCHAS.md) (full
> gotchas, linked from AGENTS.md by keyword), [`../CHANGELOG.md`](../CHANGELOG.md)
> (running history), and this `docs/` folder (durable, structured specs).
> Everything else — code comments, commit messages, chat — is **subordinate**
> and must defer to these.

## Division of labor

| Location | Holds | Update when… |
| --- | --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | What an agent needs to do its job: project shape, run/dev, conventions, the gotcha keyword index, smoke tests, **open work items**. **Auto-loaded by pi at startup.** Read this **first** every session. | You learn a convention or open/close a tracked task. |
| [`../GOTCHAS.md`](../GOTCHAS.md) | Full gotcha/convention detail, kept out of the auto-load to save context. AGENTS.md links here by keyword. **Read the matching entry before editing the area it covers.** | You add a new gotcha (also add its keyword to the AGENTS.md index). |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Running **history** (newest first, dated entries). | You finish a chunk of work worth recording. |
| `docs/` (here) | Durable **specs** that outlive any one task: design system, architecture, other product specs. Referenced by name, versioned with the repo. | A spec changes (palette, layout, etc.). |

**Rule of thumb:** a *gotcha / how to work safely* → `GOTCHAS.md` (+ its keyword
to the `AGENTS.md` index); an *open work item / tracked task* → `AGENTS.md`.
Finished work → `CHANGELOG.md`. A *product/design spec* → `docs/`. Never let
durable knowledge live only in a code comment or a chat transcript; move it here.

## Index

| File | Role |
| --- | --- |
| [`design.md`](design.md) | UI/UX spec — palette, typography, layout, component styling, approval workflow, and the WebUI Permissions page. **Source of truth for every visual decision.** |
| [`browser-tools.md`](browser-tools.md) | Proposed zero-dependency Chromium CDP tools for local browser inspection and pi-webui debugging. |
| [`usage-telemetry.md`](usage-telemetry.md) | Browser-local Usage sampling, rolling retention, per-session persistence, and sparkline downsampling. |
| [`improvements.md`](improvements.md) | Current source- and primary-research-backed UI/UX, accessibility, adaptive-layout, permission-safety, JetBrains, and perceived-performance audit. |
| [`security-review.md`](security-review.md) | Historical pre-SDK security and runtime-robustness review: rated findings, fault probes, recovery gaps, validation results, and remediation history. |
| [`pi-livecraft.md`](pi-livecraft.md) | Current post-adoption comparison with pi-livecraft: shipped overlap, verified gaps, residual candidates, and boundaries that must not be copied. |
| [`plans.md`](plans.md) | Staged execution plan, file/test touchpoints, dependencies, and exit gates for the roadmap's Now/Next horizons. |
| [`roadmap.md`](roadmap.md) | Prioritized product horizons, accepted outcomes, dependencies, conditional candidates, and explicit non-goals. Source of truth for *what we build next*. |

## Adding a new doc

1. Drop a `*.md` in `docs/` with a one-line role header.
2. Add a row to the **Index** table above.
3. If agents must read it, link it from the relevant section of `AGENTS.md`
   (don't duplicate the content — link to it, so there's one source).
