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
|----------|-------|--------------|
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
|------|------|
| [`design.md`](design.md) | UI/UX spec — color palette, typography hierarchy, layout, code-block & status styling. **Source of truth for every visual decision.** |
| [`roadmap.md`](roadmap.md) | Candidate features (benefits, drawbacks, value/effort ranking). Source of truth for *what we might build next*. |
| [`plans.md`](plans.md) | Concrete build plans for active items (the *how*). Subordinate to `roadmap.md`; retire a section when its work lands in `../CHANGELOG.md`. |

## Adding a new doc

1. Drop a `*.md` in `docs/` with a one-line role header.
2. Add a row to the **Index** table above.
3. If agents must read it, link it from the relevant section of `AGENTS.md`
   (don't duplicate the content — link to it, so there's one source).
