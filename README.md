# pi-webui

A minimal, **zero-dependency** web UI for [pi](https://github.com/earendil-works/pi-coding-agent).
No build step. No React, no Express, no `ws`.

Just Node's built-in `http` + `child_process`, native browser SSE + `fetch`,
and pi's built-in **RPC mode** (`pi --mode rpc`) over stdin/stdout JSON.

```
browser ──SSE──▶ Node (server.js) ──stdin──▶ pi --mode rpc
        ◀─POST─                  ◀─stdout─
```

## Install

Requires `pi` on your PATH and Node 18+.

```bash
pi install npm:pi-webui
```

That registers the package with pi. The bundled extension auto-loads
in every pi session, including the one `/webui` spawns.

## Run

Inside pi, type:

```
/webui
```

This starts the bundled `server.js` in the background, opens your browser at
`http://127.0.0.1:4317`, and leaves your TUI usable. Optional port: `/webui 8080`.

```
/webui-stop   # stop the running server
```

> The webui is a **separate** pi session in the same working directory — not the
> TUI session you ran `/webui` from. RPC mode is fixed at process start, so the
> bridge owns its own `pi --mode rpc`. It is torn down automatically on
> `session_shutdown` (quit, reload, new/resume/fork), or via `/webui-stop`.

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
- **Editable diffs** — every `edit`/`write` tool call renders as a side-by-side (old | new) diff. The new pane is editable with an **Apply** button that writes the result to disk (sandboxed to the project root via `safePath`). Permission prompts for edits also show a read-only preview of the hunk before you approve.
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

## Development / standalone

You can run the bridge directly without installing as a pi package — handy for
hacking on `server.js` / `index.html`:

```bash
git clone https://github.com/gorowynn/pi-webui
node server.js                 # http://127.0.0.1:4317
```

Config (env vars): `PORT`, `PI_BIN`, `PI_ARGS`, `PI_CWD`.

## Manual test

Quick sanity checks for the diff UX:

- **Editable transcript diff** — ask the agent to make a small edit. Open the `edit`
  tool block; edit the right-hand pane, click **Apply** → the file on disk updates
  and the button briefly reads `Applied ✓`.
- **Permission-modal preview** — trigger an edit/write that requires approval
  (e.g. a `select`/`confirm` prompt). The modal should render a read-only old|new
  diff of the hunk you're approving. If no diff appears, `pendingEditCalls` is not
  being populated — confirm `toolcall_end` events carry `toolCall.arguments`
  (see `index.html`, `message_update` handler).

## Notes / limits

- One shared pi session for all browser tabs (multi-session is a later concern).
- If the pi subprocess crashes, the bridge restarts it after 1s.
- `readline` is deliberately **not** used for framing — it splits on Unicode line separators that are valid inside JSON strings. The bridge splits on `\n` only, per the RPC spec.
