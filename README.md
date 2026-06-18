# pi-webui

A minimal, **zero-dependency** web UI for [pi](https://github.com/earendil-works/pi-coding-agent).
No npm install. No build step. No React, no Express, no `ws`.

Just Node's built-in `http` + `child_process`, native browser SSE + `fetch`,
and pi's built-in **RPC mode** (`pi --mode rpc`) over stdin/stdout JSON.

```
browser ──SSE──▶ Node (server.js) ──stdin──▶ pi --mode rpc
        ◀─POST─                  ◀─stdout─
```

## Run

```bash
node server.js
# open http://127.0.0.1:4317
```

That's it. Requires `pi` on your PATH and Node 18+.

### Configuration (env vars)

| var       | default            | meaning                                            |
|-----------|--------------------|----------------------------------------------------|
| `PORT`    | `4317`             | HTTP port                                           |
| `PI_BIN`  | `pi`               | path to the pi binary                               |
| `PI_ARGS` | *(none)*           | extra args, e.g. `PI_ARGS=--no-session`             |
| `PI_CWD`  | server's cwd       | working dir for pi (session location, tool roots)   |

## Features

- **Streaming chat** — text deltas, thinking blocks, tool calls + results render live.
- **Skills & commands** — type `/` for a palette of skills, prompt-templates, and extension commands (sourced live from `get_commands`).
- **Permission prompts & questions** — pi's extension-UI dialogs (`select`, `confirm`, `input`, `editor`) surface as modal dialogs and are answered over the bridge. `notify`/`setStatus`/`set_editor_text` are handled too.
- **Model picker**, **Stop** (abort), **New session**, and mid-stream delivery modes (`auto`→steer / `steer` / `follow-up`).
- Session is **persistent on the pi side** by default — refresh the page and history reloads via `get_messages`.

## Files

- `server.js` — the bridge (~120 lines, CommonJS, no `package.json` needed).
- `index.html` — the entire frontend (inline CSS + vanilla JS).

## Endpoints

- `GET /` — serves `index.html`
- `GET /api/events` — SSE stream; every JSONL line from pi is forwarded as an event
- `POST /api/cmd` — body is a JSON RPC command; written verbatim to pi's stdin
- `GET /api/health` — sanity check

## Notes / limits

- One shared pi session for all browser tabs (multi-session is a later concern).
- If the pi subprocess crashes, the bridge restarts it after 1s.
- `readline` is deliberately **not** used for framing — it splits on Unicode line separators that are valid inside JSON strings. The bridge splits on `\n` only, per the RPC spec.
