# docs/ — pi-webui documentation

> **Single source of truth.** Project knowledge for pi-webui lives in exactly two
> places: this `docs/` folder (durable, structured specs) and
> [`../AGENT_NOTES.md`](../AGENT_NOTES.md) (agent memory + conventions + the
> running changelog). Everything else — code comments, commit messages, chat —
> is **subordinate** and must defer to these.

## Division of labor

| Location | Holds | Update when… |
|----------|-------|--------------|
| [`../AGENT_NOTES.md`](../AGENT_NOTES.md) | What an agent needs to do its job: project shape, run/dev, conventions, gotchas, smoke tests, **open work items**, and the **changelog** (newest first, dated entries). Read this **first** every session. | You learn a non-obvious gotcha, convention, finish a chunk of work worth recording, or open/close a tracked task. |
| `docs/` (here) | Durable **specs** that outlive any one task: design system, architecture, other product specs. Referenced by name, versioned with the repo. | A spec changes (palette, layout, etc.). |

**Rule of thumb:** if it's about *how to work in this repo safely* or an *open
work item / tracked task* → `AGENT_NOTES.md`. If it's a *product/design spec* →
`docs/`. Never let durable knowledge live only in a code comment or a chat
transcript; move it here.

## Index

| File | Role |
|------|------|
| [`design.md`](design.md) | UI/UX spec — color palette, typography hierarchy, layout, code-block & status styling. **Source of truth for every visual decision.** |

## Adding a new doc

1. Drop a `*.md` in `docs/` with a one-line role header.
2. Add a row to the **Index** table above.
3. If agents must read it, link it from the relevant section of `AGENT_NOTES.md`
   (don't duplicate the content — link to it, so there's one source).
