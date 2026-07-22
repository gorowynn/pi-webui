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
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = parseInt(process.env.PORT || "4317", 10);
const LOG = path.join(os.tmpdir(), "pi-webui.log");
const URL = "http://127.0.0.1:" + PORT;
const truthy = (v) => /^(1|true|yes)$/i.test(v || "");

// ---- standalone stop: kill by port ------------------------------------
// ponytail: kill by PORT, not a stored PID. Works when no handle exists —
// server hung, pi restarted, or launched via another process (global bin vs
// /webui vs `node server.js`). server.js has no signal handler and leaves its
// `pi --mode rpc` child orphaned on death, so we force-kill the WHOLE tree under
// the listener, not just the listener.
// ceiling: a server.js crash that orphaned its pi child BEFORE you ran this is
// no longer under the listener's tree and won't be reaped (intentionally —
// matching `pi --mode rpc` blindly risks killing unrelated pi sessions).
//
//   pi-webui --stop [port]      (port defaults to PORT env / 4317)
//   pi-webui stop [port]
function listenerPids(port) {
	if (process.platform === "win32") {
		// netstat -ano is always present. PID is the LAST column; match the
		// local-address (p[1]) suffix and ignore the STATE word — it's localized
		// ("LISTENING" / "ABHÖREN" / …), so we never compare against it.
		const out =
			spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
		const pids = [];
		for (const line of out.split(/\r?\n/)) {
			const p = line.trim().split(/\s+/);
			const pid = p.at(-1);
			if (
				p[0] === "TCP" &&
				p[1] &&
				p[1].endsWith(":" + port) &&
				/^\d+$/.test(pid)
			) {
				pids.push(Number(pid));
			}
		}
		return [...new Set(pids)];
	}
	// POSIX: lsof ships with macOS and most Linux dev boxes.
	const r = spawnSync("lsof", ["-ti", "tcp:" + port, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (r.error && r.error.code === "ENOENT") {
		console.error(
			"stop needs `lsof` on this platform (not found); install it or stop the process on port " +
				port +
				" manually.",
		);
		process.exit(1);
	}
	return [
		...new Set(
			(r.stdout || "")
				.split(/\r?\n/)
				.map((s) => s.trim())
				.filter(Boolean)
				.map(Number)
				.filter((n) => Number.isFinite(n)),
		),
	];
}

// root + all descendants via `pgrep -P`. Depth-capped (a pi tree is shallow).
function collectTreePosix(root) {
	const all = [root];
	const seen = new Set([root]);
	let frontier = [root];
	let depth = 0;
	while (frontier.length && depth < 8) {
		const next = [];
		for (const pid of frontier) {
			const r = spawnSync("pgrep", ["-P", String(pid)], {
				encoding: "utf8",
			});
			if (r.status === 0) {
				for (const line of (r.stdout || "").split(/\r?\n/)) {
					const n = Number(line.trim());
					if (Number.isFinite(n) && !seen.has(n)) {
						seen.add(n);
						all.push(n);
						next.push(n);
					}
				}
			}
		}
		frontier = next;
		depth++;
	}
	return all;
}

function killByPort(port) {
	const roots = listenerPids(port);
	if (!roots.length) return [];
	const killed = [];
	if (process.platform === "win32") {
		// taskkill /T walks + kills the whole tree in one shot.
		for (const pid of roots) {
			spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
				stdio: "ignore",
				shell: true,
				windowsHide: true,
			});
			killed.push(pid);
		}
	} else {
		const pgrepOk = !spawnSync("pgrep", ["-V"], { encoding: "utf8" }).error;
		for (const root of roots) {
			const victims = pgrepOk ? collectTreePosix(root) : [root];
			for (const pid of victims) {
				try {
					process.kill(pid, "SIGKILL");
					killed.push(pid);
				} catch {
					/* already gone */
				}
			}
			if (!pgrepOk) {
				// best-effort: detached launches share a process group == root pid
				try {
					process.kill(-root, "SIGKILL");
				} catch {
					/* no such group */
				}
			}
		}
	}
	return [...new Set(killed)];
}

const argv = process.argv.slice(2);
const stopIdx = argv.findIndex(
	(a) => a === "stop" || a === "--stop" || a === "-s",
);
if (stopIdx !== -1) {
	const port = parseInt(argv[stopIdx + 1], 10) || PORT;
	const killed = killByPort(port);
	if (killed.length)
		console.log(
			`pi-webui stopped (killed PID ${killed.join(", ")}) on port ${port}`,
		);
	else console.log(`nothing listening on port ${port}`);
	process.exit(0);
}

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
			spawn("xdg-open", [url], {
				detached: true,
				stdio: "ignore",
			}).unref();
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
			"pi-webui exited early" +
				(log ? ":\n" + log.slice(-800) : " (no log)"),
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
