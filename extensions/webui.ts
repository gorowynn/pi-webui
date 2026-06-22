/**
 * pi-webui — `/webui` launcher command.
 *
 * Spawns the bundled server.js (a zero-dep HTTP bridge that itself spawns its
 * own `pi --mode rpc`) in the background, opens the browser, and leaves the
 * TUI fully usable. The webui is a SEPARATE pi session in the same cwd — not
 * the TUI session you ran /webui from (RPC mode is fixed at process start, so
 * the bridge must own its own pi).
 *
 * Lifecycle:
 *   - `/webui [port]`   start (default port 4317); noop + notify if already up
 *   - `/webui-stop`     stop the running server
 *   - session_shutdown  tears the whole tree down so no orphans survive
 *
 * The whole process tree (server.js + its pi child) is killed together:
 * POSIX kills the detached process group; Windows uses `taskkill /T`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));
const serverScript = join(baseDir, "..", "server.js"); // extensions/ → package root
const DEFAULT_PORT = 4317;

let webui: ChildProcess | null = null;

function openBrowser(url: string) {
	try {
		if (process.platform === "win32") {
			spawn("cmd", ["/c", "start", "", url], {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			}).unref();
		} else if (process.platform === "darwin") {
			spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
		} else {
			spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
		}
	} catch {
		/* best-effort */
	}
}

function killTree(proc: ChildProcess) {
	const pid = proc.pid;
	if (pid == null) {
		webui = null;
		return;
	}
	try {
		if (process.platform === "win32") {
			spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
				stdio: "ignore",
				shell: true,
				windowsHide: true,
			});
		} else {
			// server.js is spawned detached (own session/group), so -pid kills it
			// plus its pi grandchild in one shot.
			try {
				process.kill(-pid, "SIGTERM");
			} catch {
				/* gone */
			}
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				/* gone */
			}
		}
	} finally {
		webui = null;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("webui", {
		description: "Start the pi-webui browser UI (http://127.0.0.1:<port>)",
		handler: async (args, ctx) => {
			if (webui) {
				ctx.ui.notify(
					"pi-webui is already running — use /webui-stop first",
					"info",
				);
				return;
			}
			const port = parseInt((args || "").trim(), 10) || DEFAULT_PORT;
			if (!existsSync(serverScript)) {
				ctx.ui.notify(`server.js not found at ${serverScript}`, "error");
				return;
			}
			const env = { ...process.env, PORT: String(port), PI_CWD: ctx.cwd };
			const proc = spawn(process.execPath, [serverScript], {
				cwd: ctx.cwd,
				env,
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			webui = proc;
			proc.on("error", (e) => {
				if (webui === proc) {
					ctx.ui.notify(`pi-webui failed to start: ${e.message}`, "error");
					webui = null;
				}
			});
			proc.on("exit", (code) => {
				if (webui === proc) {
					if (code !== 0 && code !== null && code !== 143 && code !== 130) {
						ctx.ui.notify(
							`pi-webui exited unexpectedly (code ${code})`,
							"info",
						);
					}
					webui = null;
				}
			});
			proc.unref();
			const url = `http://127.0.0.1:${port}`;
			ctx.ui.notify(`pi-webui on ${url}`, "info");
			openBrowser(url);
		},
	});

	pi.registerCommand("webui-stop", {
		description: "Stop the running pi-webui server",
		handler: async (_args, ctx) => {
			if (!webui) {
				ctx.ui.notify("pi-webui is not running", "info");
				return;
			}
			killTree(webui);
			ctx.ui.notify("pi-webui stopped", "info");
		},
	});

	pi.on("session_shutdown", async () => {
		if (webui) killTree(webui);
	});
}
