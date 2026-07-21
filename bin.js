#!/usr/bin/env node
// pi-webui — standalone launcher.
//
// Starts server.js (which spawns its OWN `pi --mode rpc`) in this process and
// opens the browser, so `npm i -g pi-webui` → `pi-webui` works with NO pi TUI
// and no `/webui`. Equivalent to `node server.js` + auto-open.
//
// Env (all optional): PORT (4317), PI_BIN (pi), PI_ARGS, PI_CWD (defaults to
// your shell's cwd — set it to pin a project without `cd`-ing).
const { spawn } = require("child_process");
const path = require("path");
const PORT = parseInt(process.env.PORT || "4317", 10);

// Run the server in this process: it reads the env above, spawns pi, and
// listens on 127.0.0.1. Inheriting stdio surfaces the "pi-webui on http://…"
// ready line and any startup error (port in use → exit 1).
require(path.join(__dirname, "server.js"));

// ponytail: open the browser a beat after listen so index.html is served on the
// first GET (not a refused connection). ceiling: a slow bind just means the
// browser's EventSource reconnects — it retries anyway; if the port is taken,
// server.js has already exited(1) and this fire is moot.
setTimeout(() => {
	const url = "http://127.0.0.1:" + PORT;
	try {
		if (process.platform === "win32")
			spawn("cmd", ["/c", "start", "", url], {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			}).unref();
		else if (process.platform === "darwin")
			spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
		else
			spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
	} catch {
		/* best-effort; server is still up at the printed URL */
	}
}, 400);
