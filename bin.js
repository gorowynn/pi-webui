#!/usr/bin/env node
// pi-webui — standalone launcher.
//
// Spawns server.js DETACHED in its own process group so closing the terminal /
// console window doesn't kill the webui — the server (and the `pi --mode rpc`
// child it owns) keep running after this launcher exits. Then opens the browser
// (unless PI_WEBUI_NO_OPEN) and reports. The detached child writes its ready
// line + any startup error to a temp log; we poll that to detect an early death
// (port in use, pi spawn failure) before claiming success.
//
// Env (all optional): PORT (4317), PI_BIN (pi), PI_ARGS, PI_CWD (defaults to
// your shell's cwd), PI_WEBUI_NO_SWITCH (1/true/yes → disable workspace
// switching + hide the workspace list, e.g. for IDE use), PI_WEBUI_NO_OPEN
// (1/true/yes → skip opening the browser).
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = parseInt(process.env.PORT || "4317", 10);
const LOG = path.join(os.tmpdir(), "pi-webui.log");
const URL = "http://127.0.0.1:" + PORT;
const truthy = (v) => /^(1|true|yes)$/i.test(v || "");

function openBrowser(url) {
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
		/* best-effort; the server is still up at the printed URL */
	}
}

// detached + own process group → the child survives this launcher (and the
// parent console) exiting. One log fd shared by stdout+stderr (truncate per run)
// so an early death leaves a reason in the file.
const logFd = fs.openSync(LOG, "w");
const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
	env: { ...process.env, PORT: String(PORT) },
	stdio: ["ignore", logFd, logFd],
	detached: true,
	windowsHide: true,
});
child.unref();

// Poll the log for the server's ready line (it bound) or an early exit, then
// open the browser + report. ceiling: a slow bind just trips the 4s fallback —
// the browser's EventSource retries anyway.
const deadline = Date.now() + 4000;
const poll = setInterval(() => {
	let log = "";
	try {
		log = fs.readFileSync(LOG, "utf8");
	} catch {}
	if (child.exitCode != null || child.signalCode) {
		clearInterval(poll);
		console.error(
			"pi-webui exited early" + (log ? ":\n" + log.slice(-800) : " (no log)"),
		);
		process.exit(1);
	} else if (log.includes("pi-webui on http") || Date.now() > deadline) {
		clearInterval(poll);
		if (!truthy(process.env.PI_WEBUI_NO_OPEN)) openBrowser(URL);
		console.log(
			`pi-webui on ${URL}  (detached — close this window anytime; log: ${LOG})`,
		);
		process.exit(0);
	}
}, 150);
