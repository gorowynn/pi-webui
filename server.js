#!/usr/bin/env node
// Minimal-dependency bridge between a browser and `pi --mode rpc`.
// Browser <--SSE-- POST--> Node <--stdin/stdout JSONL--> pi subprocess.
// Run: node server.js   (optionally set PORT, PI_BIN, PI_ARGS, PI_CWD)
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const os = require("os");
const { JsonLineDecoder, encodeJsonLine } = require("./jsonl.js"); // strict JSONL codec (plan F§4.5)
const { createLiveBuffer } = require("./livebuf.js"); // current-turn buffer for reconnect replay (plan F§5.2)
const { activeSessionMessages } = require("./session-entries.js"); // compaction-aware history (plan F§5.3)
const { listRecentSessions } = require("./recent-sessions.js"); // head/tail session reader (plan F§4.1)
const {
	getGitSnapshot,
	getGitFileDiff,
	commitChanges,
	pushCommits,
	resetGitCommit,
	revertGitCommit,
	discardFileChanges,
	discardChanges,
	gitExecutableForPlatform,
	sanitizeWindowsPathExt,
} = require("./git.js"); // git porcelain + mutations (plan 4.5/4.6)
// Protect every descendant — pi itself, extensions, language servers, and tools —
// from resolving this repository's git.js through Windows PATHEXT.
sanitizeWindowsPathExt(process.env, process.platform);
const { improvePrompt } = require("./isolated-prompt.js"); // disposable isolated pi prompt (plan 4.7/4.8)
const { discoverWorkspaces, isKnownWorkspacePath } = require("./workspaces.js");
const { opencodeGoWindows } = require("./public/usage-provider.js"); // dashboard HTML parser (shared with the browser, like md.js)

const PORT = parseInt(process.env.PORT || "4317", 10);
const GIT_BIN = gitExecutableForPlatform(process.platform);
const PI_BIN = process.env.PI_BIN || "pi";
const PI_ARGS = (process.env.PI_ARGS || "").split(/\s+/).filter(Boolean); // e.g. "--no-session"
let PI_CWD = process.env.PI_CWD || process.cwd(); // let: workspace switch re-points it live
const NO_SWITCH = /^(1|true|yes)$/i.test(process.env.PI_WEBUI_NO_SWITCH || ""); // IDE mode: workspace switching is disabled (the host owns the cwd)
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");
const AGENT_DIR = path.dirname(AUTH_FILE); // ~/.pi/agent — pi's agent dir
const HTML_PATH = path.join(__dirname, "public", "index.html");
// ponytail: static assets (all browser-facing, under public/) split out of
// index.html. Whitelist (not a full static dir) keeps the surface to known
// files — no path traversal, no MIME guessing.
const STATIC = {
	"/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
	"/md.js": { file: "md.js", type: "text/javascript; charset=utf-8" },
	// vendored highlight.js (github-dark theme) — first third-party runtime we
	// ship; static asset like md.js, no npm/build. Gated client-side so a
	// missing file degrades to uncolored code (see app.js highlightCode).
	"/vendor/highlight.min.js": {
		file: "vendor/highlight.min.js",
		type: "text/javascript; charset=utf-8",
	},
	"/vendor/highlight.css": {
		file: "vendor/highlight.css",
		type: "text/css; charset=utf-8",
	},
	// vendored markdown-it 14.x (UMD, sets window.markdownit). Loaded BEFORE
	// md.js, which is now a thin shim delegating to it (the hand-rolled parser
	// is gone). Static asset like the highlight.js vendor entry — no npm/build.
	"/vendor/markdown-it.min.js": {
		file: "vendor/markdown-it.min.js",
		type: "text/javascript; charset=utf-8",
	},
	"/usage-provider.js": {
		file: "usage-provider.js",
		type: "text/javascript; charset=utf-8",
	},
	"/tool-presentation.js": {
		file: "tool-presentation.js",
		type: "text/javascript; charset=utf-8",
	},
	"/csv-preview.js": {
		file: "csv-preview.js",
		type: "text/javascript; charset=utf-8",
	},
	"/tool-protocol.js": {
		file: "tool-protocol.js",
		type: "text/javascript; charset=utf-8",
	},
	"/session-analysis.js": {
		file: "session-analysis.js",
		type: "text/javascript; charset=utf-8",
	},
	"/composer-images.js": {
		file: "composer-images.js",
		type: "text/javascript; charset=utf-8",
	},
	"/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
	// ponytail: PWA install surface — manifest, service worker, icons. Served
	// like any static asset (no-cache so sw.js edits propagate on reload).
	"/manifest.webmanifest": {
		file: "manifest.webmanifest",
		type: "application/manifest+json; charset=utf-8",
	},
	"/sw.js": { file: "sw.js", type: "text/javascript; charset=utf-8" },
	"/icon-192.png": { file: "icon-192.png", type: "image/png" },
	"/icon-512.png": { file: "icon-512.png", type: "image/png" },
};

// ponytail: single source of truth for the ask_user_question rendezvous marker.
// Both the browser (injected below) and the pi_minimal_webui extension (reads
// process.env.PI_WEBUI_ASK_MARKER) take this value, so the literal can't drift.
const ASK_MARKER = "\u0000pi-webui:ask-user-question";
process.env.PI_WEBUI_ASK_MARKER = ASK_MARKER;
// Inject the marker into the page before app.js loads; cache once at startup.
const HTML = fs
	.readFileSync(HTML_PATH, "utf8")
	.replace(
		'<script src="app.js"></script>',
		"<script>window.__PI_ASK_MARKER=" +
			JSON.stringify(ASK_MARKER) +
			';</script>\n    <script src="app.js"></script>',
	);

// ponytail: one shared agent process for all tabs. Multi-session is a later concern.
let pi = null;
// ponytail: set by POST /api/stop so pi's exit handler tears the server down
// instead of respawning (startPi's crash-backoff would otherwise bring it back).
let shuttingDown = false;
// ponytail: crash-loop guard. An unconditional 1s restart loops forever if
// pi can't start (bad binary, broken install). Count consecutive fast exits and
// back off exponentially up to 30s; reset once a process lives >5s.
let restartAttempts = 0;
let startStamp = 0;
let deliberateRestart = false; // ponytail: workspace switch — exit handler respawns in the new cwd, skipping crash backoff
const clients = new Set(); // open SSE responses
// current-turn event buffer (plan F§5.2): survives a pi CRASH so a reconnecting
// tab can rebuild in-flight tool cards; cleared on workspace switch (old
// project's turn must not leak) and on agent_end (turn committed → get_messages).
const lb = createLiveBuffer();

function broadcast(obj) {
	const line = "data: " + JSON.stringify(obj) + "\n\n";
	for (const res of clients) {
		// ponytail: per-client queue. write()==false is backpressure (socket
		// saturated / main-thread stall), NOT a dead socket — buffer the line in
		// _piQ and flush on 'drain' instead of dropping it. Dropping was the old
		// bug: a saturated client skipped both text deltas AND the text_end heal
		// event, so words vanished until a full SSE reconnect/resync. A client
		// stuck >20s (backgrounded/slept tab) is still cut loose to reconnect.
		try {
			if (res._piPaused) {
				(res._piQ ||= []).push(line);
			} else if (!res.write(line)) {
				pause(res);
			}
		} catch {
			clients.delete(res);
			/* drop, onclose cleans up */
		}
	}
}

// ponytail: buffer _piQ until the socket drains, then flush; re-pause if it
// saturates again mid-flush. Recurses safely — once('drain') fires per saturation.
function pause(res) {
	res._piPaused = true;
	res._piQ = res._piQ || [];
	const deadline = setTimeout(() => {
		clients.delete(res);
		try {
			res.end();
		} catch {}
	}, 20000);
	res.once("drain", () => {
		res._piPaused = false;
		clearTimeout(deadline);
		const q = res._piQ;
		res._piQ = [];
		for (const l of q) {
			try {
				if (!res.write(l)) {
					pause(res);
					return;
				}
			} catch {
				clients.delete(res);
				return;
			}
		}
	});
}

// exponential backoff for the crash-loop guard: 1s, 2s, 4s, ... capped at 30s.
function backoffDelay() {
	return Math.min(1000 * 2 ** restartAttempts++, 30000);
}
function startPi() {
	startStamp = Date.now();
	// ponytail: --approve trusts project-local files (.pi/extensions) for the run.
	// Without it, RPC mode can't resolve trust (no select-prompt handler) → the
	// pi_minimal_webui plugin is skipped → stock npm ask_user_question runs and
	// auto-declines (ctx.ui.custom is a no-op in RPC). PI_ARGS can override with
	// --no-approve since it's appended after.
	const args = ["--mode", "rpc", "--approve", ...PI_ARGS];
	// Windows: npm-global bins (pi) are .cmd shims; spawn can't find them without a
	// shell to resolve PATHEXT. Fold args into one command string (avoids the
	// DEP0190 `shell + args` warning). Args are trusted operator flags only.
	const useShell = process.platform === "win32";
	pi = useShell
		? spawn(`${PI_BIN} ${args.join(" ")}`, [], {
				cwd: PI_CWD,
				env: process.env,
				shell: true,
				windowsHide: true, // no cmd window when launched headless (e.g. by /webui)
			})
		: spawn(PI_BIN, args, {
				cwd: PI_CWD,
				env: process.env,
				windowsHide: true,
			});

	// Strict JSONL reader (jsonl.js codec): split on \n, strip \r, buffer
	// incomplete UTF-8 across chunks (so a multibyte char split on a stdout seam
	// decodes instead of becoming U+FFFD — GOTCHAS #1/#2), plus a per-record cap
	// as a runaway-line guard. Factored from the old inline buf/StringDecoder loop
	// in plan F§4.5; behavior-preserving (broadcast still fires for every obj).
	const dec = new JsonLineDecoder();
	pi.stdout.on("data", (chunk) => {
		dec.push(chunk, (obj) => {
			// tag every pi event with a monotonic sequence (plan F§5.2) and buffer
			// the current turn's events for reconnect replay. push() returns the
			// sequence; the buffer only keeps turn-content events (agent_start→…,
			// cleared on agent_end). Sequence rides on the broadcast WRAPPER (not
			// pi's payload), so the client can ignore it until incremental replay.
			const sequence = lb.push(obj);
			broadcast({ source: "pi", payload: obj, sequence });
			// settle any awaitable RPC waiting on this response (plan F§5.1).
			if (obj && obj.type === "response" && obj.id) resolveRpc(obj);
		});
	});

	pi.stderr.on("data", (chunk) =>
		broadcast({ source: "stderr", payload: chunk.toString("utf8") }),
	);
	pi.on("error", (e) => {
		broadcast({ source: "pi_exit", payload: { error: e.message } });
		const delay = backoffDelay();
		console.error(`[pi] spawn error: ${e.message}; retrying in ${delay}ms`);
		setTimeout(startPi, delay);
	});
	pi.on("exit", (code, sig) => {
		if (shuttingDown) return shutdownNow();
		rejectAllRpc("pi exited"); // fail fast: pending awaitable RPCs won't resolve
		broadcast({ source: "pi_exit", payload: { code, sig } });
		if (deliberateRestart) {
			// workspace switch (not a crash): respawn now in the (already-updated)
			// PI_CWD, skip crash backoff, then tell every tab to resync. The new
			// pi's stdin is writable at once, so the client's resync get_state /
			// get_messages buffer in the pipe until pi boots.
			deliberateRestart = false;
			lb.clear(); // old project's in-flight turn must not leak into the new one
			startPi();
			broadcast({
				source: "server",
				type: "workspace_changed",
				workspace: PI_CWD,
			});
			return;
		}
		// survived >5s -> healthy run, reset the crash counter.
		if (Date.now() - startStamp > 5000) restartAttempts = 0;
		const delay = backoffDelay();
		console.error(
			`[pi] exited code=${code} sig=${sig}; restarting in ${delay}ms`,
		);
		setTimeout(startPi, delay); // survive a crashed agent
	});
	// ponytail: announce the (re)spawned pi so clients re-sync and flip out of the
	// "reconnecting" state a crash pushed them into. Without this the UI stayed
	// stuck in reconnecting forever after a pi exit — only a full SSE drop (server
	// restart) recovered it, since the browser↔server pipe survives a child crash.
	// Fire at spawn time: pi.stdin buffers the client's resync RPCs until pi's
	// reader is ready, so the response is always from the booted pi.
	broadcast({ source: "server", type: "pi_ready" });
}
startPi();

// ponytail: cross-platform process-tree termination (plan F§4.7). Centralized
// so workspace switch (graceful), stop (force), and future isolated-prompt
// cleanup share one tested path. POSIX: SIGTERM/SIGKILL. Windows: taskkill /T /F
// kills the whole tree (no gentle equivalent — a bare signal to the .cmd shim
// strands the real child). Returns false if the kill threw, so a caller can fall
// back (stop -> direct shutdown).
function killPiTree(force) {
	if (!pi || !pi.pid) return true;
	try {
		if (process.platform === "win32")
			execSync(`taskkill /pid ${pi.pid} /T /F`, {
				stdio: "ignore",
				windowsHide: true,
			});
		else process.kill(pi.pid, force ? "SIGKILL" : "SIGTERM");
		return true;
	} catch (e) {
		console.error(
			`[kill] ${force ? "force" : "graceful"} failed: ${e.message}`,
		);
		return false;
	}
}

// ponytail: switch the active project root. Only a discovered-workspace realpath
// reaches here (the route validates via isKnownWorkspacePath first). Updates the
// live PI_CWD, then tree-kills pi so its exit handler respawns in the new cwd and
// broadcasts workspace_changed. taskkill /T /F (win) + SIGTERM (posix) to node
// are reliable; if a kill ever fails to land, deliberateRestart stays set and the
// next real exit still consumes it.
function switchWorkspace(newCwd) {
	PI_CWD = newCwd;
	deliberateRestart = true;
	if (!pi) {
		// no running pi (only briefly at boot) — respawn + broadcast directly.
		deliberateRestart = false;
		lb.clear(); // old project's in-flight turn must not leak into the new one
		startPi();
		broadcast({
			source: "server",
			type: "workspace_changed",
			workspace: PI_CWD,
		});
		return;
	}
	killPiTree(false); // graceful: deliberate restart — exit handler respawns in PI_CWD
}

// ponytail: graceful self-shutdown for the in-UI Stop button (POST /api/stop).
// Kill the pi child so it doesn't orphan; its exit handler sees shuttingDown and
// calls shutdownNow(). Force-kill (taskkill /T /F / SIGKILL) — we're tearing down,
// so a SIGTERM a hung pi would ignore just strands the exit. Broadcast "stopping"
// first so other open tabs show a stopped state instead of reconnect-looping.
function stopServer() {
	if (shuttingDown) return;
	shuttingDown = true;
	broadcast({ source: "server", type: "stopping" });
	if (pi && pi.pid) {
		if (!killPiTree(true)) shutdownNow(); // force-kill failed -> tear down directly
	} else {
		shutdownNow();
	}
}
// drop every SSE client + close the HTTP server, then exit. Called from the pi
// exit handler (after pi is reaped) or directly if no pi is running.
function shutdownNow() {
	for (const c of clients) {
		try {
			c.end();
		} catch {}
	}
	try {
		server.close();
	} catch {}
	process.exit(0);
}

// ponytail: read the z.ai key pi already stores (~/.pi/agent/auth.json) so the
// usage bar works once pi is logged in — no paste, no duplicate env var. Resolves
// the same $VAR/literal forms pi documents (providers.md > Key Resolution); the
// `!cmd` secret-manager form is left to the UI paste (executing an arbitrary
// stored command server-side is a bad shape).
function zaiKeyFromAuth() {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"));
	} catch {
		return "";
	}
	const key = raw && raw.zai && raw.zai.key;
	if (typeof key !== "string" || key === "" || key[0] === "!") return "";
	// $VAR / ${VAR} -> env; $$ -> $; $! -> !. Uppercase-only matches pi's
	// convention that lowercase stays literal.
	return key.replace(
		/\$(\$|!|\{([A-Z_][A-Z0-9_]*)\}|[A-Z_][A-Z0-9_]*)/g,
		(_, whole, braced) => {
			if (whole === "$") return "$";
			if (whole === "!") return "!";
			const name = braced || whole;
			return process.env[name] ?? "";
		},
	);
}

// ponytail: proxy z.ai usage so the key never reaches the browser and we dodge
// CORS (provider APIs don't set permissive CORS). Key resolution mirrors the
// operator-first convention: ZAI_API_KEY env, then pi's own auth.json (so the
// usage bar works once pi is logged in — no paste), finally the UI-paste header
// so a user can supply a different key without a server restart. Forwarded as a
// Bearer header — never a query param (those land in logs). 8s cap so a stalled
// z.ai can't hang the (already async) handler.
function zaiUsage(key) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: "api.z.ai",
				path: "/api/monitor/usage/quota/limit",
				method: "GET",
				headers: {
					Authorization: "Bearer " + key,
					Accept: "application/json",
				},
			},
			(resp) => {
				let body = "";
				resp.on("data", (c) => (body += c));
				resp.on("end", () =>
					resolve({ status: resp.statusCode, body }),
				);
			},
		);
		req.on("error", reject);
		req.setTimeout(8000, () => req.destroy(new Error("z.ai timeout")));
		req.end();
	});
}

// ponytail: Codex's OAuth access token stays server-side in pi's auth store.
// The undocumented usage endpoint may change; hide the bar on any failure.
function codexTokenFromAuth() {
	try {
		const credential = JSON.parse(fs.readFileSync(AUTH_FILE, "utf8"))[
			"openai-codex"
		];
		return credential?.type === "oauth" &&
			typeof credential.access === "string"
			? credential.access
			: "";
	} catch {
		return "";
	}
}
function codexUsage(token) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: "chatgpt.com",
				path: "/backend-api/wham/usage",
				method: "GET",
				headers: {
					Authorization: "Bearer " + token,
					Accept: "application/json",
				},
			},
			(resp) => {
				let body = "";
				resp.on("data", (c) => (body += c));
				resp.on("end", () =>
					resolve({ status: resp.statusCode, body }),
				);
			},
		);
		req.on("error", reject);
		req.setTimeout(8000, () =>
			req.destroy(new Error("ChatGPT usage timeout")),
		);
		req.end();
	});
}

// ponytail: OpenCode Go has NO public usage endpoint (unlike z.ai/Codex) — the
// quota windows live in the dashboard page, which needs the browser-session
// cookie, not the API key pi stores. Credential resolution mirrors
// opencode-bar: OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE env, then
// the ~/.config/{opencode-bar,opencode-quota}/opencode-go.json config file
// ({workspaceId, authCookie}), then the UI-paste headers (so a user can supply
// creds without a server restart — same fallback slot as the z.ai key paste).
function opencodeGoCreds() {
	const envW = process.env.OPENCODE_GO_WORKSPACE_ID;
	const envC = process.env.OPENCODE_GO_AUTH_COOKIE;
	if (envW && envC) return { workspaceID: envW, authCookie: envC };
	for (const rel of [
		".config/opencode-bar/opencode-go.json",
		".config/opencode-quota/opencode-go.json",
	]) {
		try {
			const o = JSON.parse(
				fs.readFileSync(path.join(os.homedir(), rel), "utf8"),
			);
			const w = o.workspaceId || o.workspaceID || o.workspace_id;
			const c = o.authCookie || o.auth_cookie || o.cookie;
			if (typeof w === "string" && w && typeof c === "string" && c)
				return { workspaceID: w, authCookie: c };
		} catch {}
	}
	return null;
}
// ponytail: proxy the Go dashboard (opencode.ai/workspace/<id>/go). The cookie
// header is `auth=<value>` unless the pasted value already includes `auth=`.
// Browser-ish UA like opencode-bar: the page may serve different markup to
// curl. 8s cap like the other provider proxies.
function opencodeGoUsage(creds) {
	return new Promise((resolve, reject) => {
		const req = https.request(
			{
				hostname: "opencode.ai",
				path:
					"/workspace/" +
					encodeURIComponent(creds.workspaceID) +
					"/go",
				method: "GET",
				headers: {
					Cookie: /auth=/.test(creds.authCookie)
						? creds.authCookie
						: "auth=" + creds.authCookie,
					Accept: "text/html,application/xhtml+xml",
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
				},
			},
			(resp) => {
				let body = "";
				resp.on("data", (c) => (body += c));
				resp.on("end", () =>
					resolve({ status: resp.statusCode, body }),
				);
			},
		);
		req.on("error", reject);
		req.setTimeout(8000, () =>
			req.destroy(new Error("opencode.ai timeout")),
		);
		req.end();
	});
}

// ponytail: resolve the active ponytail mode for the header dropdown. Mirrors
// the ponytail extension's resolver so the UI and the agent agree: default =
// PONYTAIL_DEFAULT_MODE env > config file defaultMode > "full"; a session
// override (last ponytail-mode custom entry in the session jsonl) wins.
const PONY_VALID = ["off", "lite", "full", "ultra"];
function ponyConfigPath() {
	if (process.env.XDG_CONFIG_HOME)
		return path.join(
			process.env.XDG_CONFIG_HOME,
			"ponytail",
			"config.json",
		);
	if (process.platform === "win32")
		return path.join(
			process.env.APPDATA ||
				path.join(os.homedir(), "AppData", "Roaming"),
			"ponytail",
			"config.json",
		);
	return path.join(os.homedir(), ".config", "ponytail", "config.json");
}
function ponyDefaultMode() {
	const env = process.env.PONYTAIL_DEFAULT_MODE;
	if (env && PONY_VALID.includes(env.toLowerCase())) return env.toLowerCase();
	try {
		const c = JSON.parse(fs.readFileSync(ponyConfigPath(), "utf8"));
		if (
			c &&
			c.defaultMode &&
			PONY_VALID.includes(String(c.defaultMode).toLowerCase())
		)
			return String(c.defaultMode).toLowerCase();
	} catch {}
	return "full";
}
// ponytail: scan the session jsonl newest-first for the last ponytail-mode
// custom entry. Cheap string-include pre-filter before JSON.parse per line.
function ponySessionMode(sessionFile) {
	if (!sessionFile) return null;
	let lines;
	try {
		lines = fs.readFileSync(sessionFile, "utf8").split(/\r?\n/);
	} catch {
		return null;
	}
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!lines[i].includes("ponytail-mode")) continue;
		try {
			const e = JSON.parse(lines[i]);
			if (
				e &&
				e.type === "custom" &&
				e.customType === "ponytail-mode" &&
				e.data &&
				typeof e.data.mode === "string" &&
				PONY_VALID.includes(e.data.mode.toLowerCase())
			)
				return e.data.mode.toLowerCase();
		} catch {}
	}
	return null;
}

// ponytail: sync git probe cached above the health-poll cadence. /api/health is
// polled every 6s (app.js refreshHealth); a cache TTL BELOW that (the old 2s)
// missed on every poll → ~20 git process spawns/min while idle. A 7s window
// (>6s poll) makes consecutive polls hit the cache, halving spawns; the badge
// still refreshes within ~12s. Blocking ~50ms, only on a cache miss.
let gitCache = { t: 0, data: null };
function gitInfo() {
	if (Date.now() - gitCache.t < 7000) return gitCache.data;
	let data = null;
	try {
		const branch = execFileSync(
			GIT_BIN,
			["rev-parse", "--abbrev-ref", "HEAD"],
			{
				cwd: PI_CWD,
				stdio: ["ignore", "pipe", "ignore"],
				encoding: "utf8",
				windowsHide: true, // health endpoint is polled every 2s — must never pop a window
			},
		).trim();
		// porcelain XY: staged = index col (X), unstaged = worktree col (Y),
		// untracked = "??". A file in both columns (e.g. MM/DD) counts in both —
		// accurate: it has staged AND unstaged changes.
		const counts = execFileSync(GIT_BIN, ["status", "--porcelain"], {
			cwd: PI_CWD,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
			windowsHide: true,
		})
			.split("\n")
			.filter(Boolean)
			.reduce(
				(a, line) => {
					const x = line[0],
						y = line[1];
					if (x === "?" && y === "?") a.untracked++;
					else {
						if (x !== " ") a.staged++;
						if (y !== " " && y !== "?") a.unstaged++;
					}
					return a;
				},
				{ staged: 0, unstaged: 0, untracked: 0 },
			);
		data = { branch, ...counts };
	} catch {
		data = null; // not a git repo
	}
	gitCache = { t: Date.now(), data };
	return data;
}

// ponytail: list resumable sessions for this project. Sessions are append-only
// JSONL under ~/.pi/agent/sessions/<encoded-cwd>/. The dir-name encoding mirrors
// pi's session-manager.getSessionDir() verbatim (realpath, strip one leading sep,
// replace / \ : with '-', wrap in '--'), so the lookup can't drift from pi.
// One pass per file via recent-sessions.js (plan 4.1): a head/tail reader that
// recovers {id,cwd,name,updatedAt} from only the first 64 KB + a backward-
// scanned tail — never parsing multi-MB middles. Exact message count only when
// the whole file fits the window; otherwise messages:null + size (bytes). name
// falls back to the first user prompt; updatedAt is the latest message time.
// No path param is taken -> no traversal surface.
function sessionDirFor(cwd) {
	let resolved;
	try {
		resolved = fs.realpathSync(cwd);
	} catch {
		resolved = cwd;
	}
	const safe =
		"--" + resolved.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-") + "--";
	return path.join(AGENT_DIR, "sessions", safe);
}
function listSessions() {
	const raw = listRecentSessions(sessionDirFor(PI_CWD));
	// Map to the client's long-standing shape, adding the new fields. `when` stays
	// the creation timestamp (ms) for fmtSessionDate; updatedAt/size are additive.
	return raw.map((s) => ({
		path: s.sessionPath,
		id: s.id,
		cwd: s.cwd,
		when: s.createdAt,
		updatedAt: s.updatedAt,
		name: s.name,
		preview: s.firstPrompt || "(no messages)",
		messages: s.messages, // null when the file was too large to read whole
		size: s.size,
		truncated: s.truncated,
		mtime: s.mtime,
	}));
}

function sendToPi(obj) {
	if (!pi || !pi.stdin.writable) throw new Error("pi not running");
	pi.stdin.write(encodeJsonLine(obj));
}

// ── awaitable RPC registry (plan F§5.1 — the keystone) ──────────────────────
// sendToPi stays fire-and-forget (POST /api/cmd + the SSE response stream the
// client matches by id — the smuggle channels depend on it). This ADDS an
// awaitable path: rpcRequest(obj) sends + registers a Promise keyed by obj.id;
// when the JSONL reader parses pi's {type:"response", id}, resolveRpc settles it
// (with a timeout). The reader STILL broadcasts every payload to SSE, so the
// existing client flow + tool_execution_start smuggling are untouched
// (GOTCHAS #1/#6) — the awaitable path is opt-in per call.
const rpcPending = new Map(); // id -> {resolve, reject, timer}
const RPC_TIMEOUT_MS = 30000; // a bootstrap RPC answers well under this

function rpcRequest(obj, timeoutMs) {
	if (!obj || typeof obj !== "object") obj = {};
	if (!obj.id) obj.id = "rpc-" + Math.random().toString(36).slice(2, 10);
	const id = obj.id;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			if (rpcPending.delete(id)) reject(new Error("rpc timeout"));
		}, timeoutMs || RPC_TIMEOUT_MS);
		rpcPending.set(id, { resolve, reject, timer });
		try {
			sendToPi(obj);
		} catch (e) {
			clearTimeout(timer);
			rpcPending.delete(id);
			reject(e);
		}
	});
}

// settle a pending awaitable RPC when pi's {type:"response", id} lands. Called
// from the JSONL reader (after broadcast). Unknown ids (fire-and-forget cmds the
// client sent, or cmds another caller originated) are a no-op.
function resolveRpc(obj) {
	const p = rpcPending.get(obj.id);
	if (!p) return;
	rpcPending.delete(obj.id);
	clearTimeout(p.timer);
	if (obj.success === false) p.reject(new Error(obj.error || "rpc failed"));
	else p.resolve(obj);
}

// fail every pending awaitable RPC fast (pi exited/crashed — no response will
// come) instead of letting each wait out its 30s timeout.
function rejectAllRpc(reason) {
	for (const p of rpcPending.values()) {
		clearTimeout(p.timer);
		p.reject(new Error(reason));
	}
	rpcPending.clear();
}

// ponytail: sandbox any browser-supplied path to PI_CWD so the webui can't
// read/write outside the project (the manual-edit diff feature uses this).
// Resolve, then require the result to be PI_CWD itself or live beneath it.
// ponytail: path.resolve does NOT follow symlinks — a link inside PI_CWD aimed at
// ~/.ssh would pass. realpathSync does, so compare resolved-real paths. It throws
// on a not-yet-existing target (manual-edit writes new files), so in that case
// resolve the existing parent and re-append the basename.
// ponytail: structured workspace-file error (plan F§4.8). Carries an HTTP
// status so routes can map it; code lets callers distinguish traversal (403)
// from not-found (404). IS-A Error, so existing `catch (e) { ... e.message }`
// routes keep working unchanged.
class WorkspaceFileError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.name = "WorkspaceFileError";
		this.status = status;
		this.code = "WORKSPACE_FILE";
	}
}

// ponytail: sandbox any browser-supplied path to PI_CWD so the webui can't
// read/write outside the project (the manual-edit diff feature uses this).
// Resolve, then require the result to be PI_CWD itself or live beneath it.
// path.resolve does NOT follow symlinks — a link inside PI_CWD aimed at ~/.ssh
// would pass. realpathSync does, so compare resolved-real paths. It throws on a
// not-yet-existing target (manual-edit writes new files), so in that case resolve
// the existing parent and re-append the basename.
function safePath(rel) {
	const base = fs.realpathSync(PI_CWD);
	const full = path.resolve(base, rel || "");
	let real;
	try {
		real = fs.realpathSync(full);
	} catch {
		// not-yet-existing target (new file): resolve the existing parent and
		// re-append the basename.
		try {
			real = path.join(
				fs.realpathSync(path.dirname(full)),
				path.basename(full),
			);
		} catch {
			throw new WorkspaceFileError("parent directory not found", 404);
		}
	}
	if (real !== base && !real.startsWith(base + path.sep))
		throw new WorkspaceFileError("path escapes project root", 403);
	return real;
}

// ponytail: convenience primitive (plan F§4.8) — resolve + read in one call, so
// future file-touching features (git diffs, isolated-prompt scratch) reuse the
// same sandboxed guard instead of reimplementing safePath + readFileSync.
function readWorkspaceFile(rel) {
	const full = safePath(rel);
	try {
		return fs.readFileSync(full, "utf8");
	} catch (e) {
		throw new WorkspaceFileError(
			e.code === "ENOENT" ? "file not found" : e.message,
			404,
		);
	}
}

// ponytail: cap POST bodies (~1MB) so a runaway client can't OOM the bridge.
// Enforces both Content-Length up front and accumulated bytes on the wire.
const MAX_BODY = 6_000_000; // raised for image input (plan 4.10): 4×~350 KB JPEG ≈ 1.9 MB base64 + text
function readBody(req) {
	const clen = parseInt(req.headers["content-length"] || "0", 10);
	if (clen > MAX_BODY) throw new Error("body too large");
	return new Promise((resolve, reject) => {
		let body = "",
			n = 0,
			aborted = false;
		req.on("data", (c) => {
			n += c.length;
			if (n > MAX_BODY) {
				aborted = true;
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			body += c;
		});
		req.on("end", () => aborted || resolve(body));
		req.on("error", reject);
	});
}

// ponytail: CSRF + DNS-rebinding gate. The bridge is bound to 127.0.0.1, but any
// website in your browser can still POST to 127.0.0.1:PORT. For state-changing
// methods require Origin (when sent) to be localhost; always require Host to be
// localhost. Kills drive-by /api/cmd and /api/write POSTs and rebinding attacks.
const isLocalHost = (h) =>
	typeof h === "string" && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h);
function isAllowed(req) {
	if (!isLocalHost(req.headers.host)) return false;
	if (req.method === "GET" || req.method === "HEAD") return true;
	const origin = req.headers.origin;
	if (!origin) return true; // non-browser clients (curl, pi) send no Origin
	let host;
	try {
		host = new URL(origin).host;
	} catch {
		return false; // malformed Origin -> reject
	}
	return isLocalHost(host);
}

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");

	if (!isAllowed(req)) {
		res.writeHead(403, { "Content-Type": "text/plain" });
		return res.end("forbidden");
	}

	if (
		req.method === "GET" &&
		(url.pathname === "/" || url.pathname === "/index.html")
	) {
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(HTML);
	}

	if (req.method === "GET" && STATIC[url.pathname]) {
		const a = STATIC[url.pathname];
		try {
			// Read FIRST: if the asset is missing, committing a 200 status line
			// here would make the catch's writeHead(404) throw ERR_HTTP_HEADERS_SENT
			// and crash the whole server (taking every SSE client with it).
			// ponytail: no-cache so editing app.js/style.css + browser refresh always
			// picks up the change (the documented dev loop). Without it the browser
			// heuristically caches and serves stale JS after an edit.
			const data = fs.readFileSync(
				path.join(__dirname, "public", a.file),
			);
			res.writeHead(200, {
				"Content-Type": a.type,
				"Cache-Control": "no-cache, no-transform",
			});
			return res.end(data);
		} catch {
			res.writeHead(404);
			return res.end("not found");
		}
	}

	if (req.method === "GET" && url.pathname === "/api/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		res.write(": connected\n\n");
		const hb = setInterval(() => {
			try {
				res.write(": hb\n\n");
			} catch {}
		}, 15000);
		clients.add(res);
		req.on("close", () => {
			clearInterval(hb);
			clients.delete(res);
		});
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/cmd") {
		let body;
		try {
			body = await readBody(req);
			const obj = JSON.parse(body || "{}");
			sendToPi(obj);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end('{"ok":true}');
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: e.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/rpc") {
		// awaitable single RPC (plan F§5.1): like /api/cmd but resolves with pi's
		// {type:"response"} payload instead of fire-and-forget. Body = the command
		// obj (id optional — one is minted if absent). 200 + ok:false on error so
		// the client's fetch resolves cleanly (mirrors /api/file's posture).
		try {
			const obj = JSON.parse((await readBody(req)) || "{}");
			const resp = await rpcRequest(obj);
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, id: resp.id, data: resp.data }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: e.message }));
		}
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/snapshot") {
		// one-round-trip bootstrap (plan F§5.1): fans out the 5 RPCs the client
		// used to send fire-and-forget (get_state/messages/commands/models/stats)
		// in parallel via the awaitable path, returning one bundled object. Each
		// response is ALSO broadcast on SSE (the reader broadcasts everything),
		// where the client ignores ids it didn't issue — purely additive, doesn't
		// disturb the existing init flow. Unwrapped (messages/commands/models are
		// arrays, not {key:[...]} envelopes) for a clean client shape.
		try {
			// ponytail: each call MUST let rpcRequest mint a UNIQUE id. A fixed id
			// (the old "snap-state"/…) collided under concurrency — two overlapping
			// snapshots would overwrite each other's entry in rpcPending, orphaning
			// the first promise AND its timeout timer so it neither resolved nor
			// timed out → the HTTP handler hung forever (a reconnect/retry spiral
			// never recovers). The client ignores these ids anyway (it matches
			// init-*/sb-* on SSE, never snap-*), so random ids are safe.
			const ask = (type) =>
				rpcRequest({ type })
					.then((r) => r.data)
					.catch(() => null);
			const [state, ents, cmds, mdls, stats] = await Promise.all([
				ask("get_state"),
				ask("get_entries"), // parent-chain, not flat — survives compaction (plan F§5.3)
				ask("get_commands"),
				ask("get_available_models"),
				ask("get_session_stats"),
			]);
			// ponytail: build the FULL body BEFORE writeHead. The old code called
			// writeHead(200) first, then constructed the JSON inline as the arg to
			// res.end — so any throw in activeSessionMessages()/lb.snapshot()/
			// JSON.stringify landed in catch, which called writeHead(200) AGAIN →
			// ERR_HTTP_HEADERS_SENT → uncaught → the whole server crashed (and the
			// launcher's respawn loop reopened whatever the resumed turn was doing).
			const body = JSON.stringify({
				ok: true,
				state: state || null,
				// walk the entry parent-chain from leafId so compaction can't truncate
				// history: compaction entries render as a synthetic custom marker and
				// the pre-compact messages they summarize are dropped by pi anyway.
				// (plan F§5.3 — was flat get_messages, which hid everything before a
				// compaction.) Falls back to [] if get_entries failed.
				messages: activeSessionMessages(
					(ents && ents.entries) || [],
					ents && ents.leafId,
				),
				commands: (cmds && cmds.commands) || [],
				models: (mdls && mdls.models) || [],
				stats: stats || {},
				// current-turn buffer (plan F§5.2): lets a reconnecting tab rebuild
				// in-flight tool cards / streaming text instead of losing them.
				// Empty unless a turn is mid-flight. Point-in-time copy (see
				// livebuf.snapshot). Awaitable RPCs fan out FIRST, so this reads
				// the buffer state after those responses (most recent).
				liveEvents: lb.snapshot(),
			});
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(body);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: false, error: e.message }));
		}
		return;
	}

	if (req.method === "POST" && url.pathname === "/api/stop") {
		// respond BEFORE tearing down so the fetch resolves cleanly; the kill +
		// exit land on the next tick (150ms gives the 200 time to flush locally).
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end('{"ok":true}');
		setTimeout(stopServer, 150);
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(
			JSON.stringify({
				ok: true,
				pi: PI_BIN + " " + ["--mode", "rpc", ...PI_ARGS].join(" "),
				cwd: PI_CWD,
				git: gitInfo(),
				noSwitch: NO_SWITCH,
			}),
		);
	}

	if (req.method === "GET" && url.pathname === "/api/file") {
		// manual-edit feature: read a project file (sandboxed to PI_CWD).
		try {
			const content = readWorkspaceFile(
				url.searchParams.get("path") || "",
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true, content }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "POST" && url.pathname === "/api/write") {
		// manual-edit feature: write a project file (sandboxed to PI_CWD).
		let body;
		try {
			body = await readBody(req);
			const obj = JSON.parse(body || "{}");
			const full = safePath(obj.path || "");
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(
				full,
				obj.content == null ? "" : obj.content,
				"utf8",
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end('{"ok":true}');
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/codex-usage") {
		const token = codexTokenFromAuth();
		if (!token) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end('{"ok":false,"error":"no ChatGPT/Codex login"}');
		}
		try {
			const { status, body } = await codexUsage(token);
			let data = null;
			try {
				data = JSON.parse(body);
			} catch {}
			const error =
				data?.error?.message ||
				data?.detail ||
				(status >= 300 ? "usage request failed" : null);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok:
						status >= 200 &&
						status < 300 &&
						data !== null &&
						!error,
					status,
					data,
					error,
					raw: data ? null : body.slice(0, 2000),
				}),
			);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/opencode-usage") {
		// OpenCode Go quota proxy. GET so it's read-only; localhost-bound like
		// the rest. The dashboard HTML (not an API) carries the three usage
		// windows; parse it server-side so the raw page never reaches the
		// browser. Creds: env -> config file -> X-OpenCode-Go-* headers (paste).
		const hW = req.headers["x-opencode-go-workspace"];
		const hC = req.headers["x-opencode-go-cookie"];
		const creds =
			opencodeGoCreds() ||
			(typeof hW === "string" && typeof hC === "string" && hW && hC
				? { workspaceID: hW, authCookie: hC }
				: null);
		if (!creds) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: false,
					error: "no workspace credentials",
					hint: "set OPENCODE_GO_WORKSPACE_ID + OPENCODE_GO_AUTH_COOKIE, ~/.config/opencode-bar/opencode-go.json, or paste them in the usage dialog",
				}),
			);
		}
		try {
			const { status, body } = await opencodeGoUsage(creds);
			const windows = opencodeGoWindows(body);
			const error =
				status === 401 || status === 403
					? "dashboard auth failed (cookie expired?)"
					: status >= 300
						? "usage request failed"
						: Object.keys(windows).length
							? null
							: "no quota fields found in the dashboard page";
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: status >= 200 && status < 300 && !error,
					status,
					data: windows,
					error,
					raw: error ? body.slice(0, 2000) : null,
				}),
			);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/zai-usage") {
		// z.ai usage/quota proxy. GET so it's read-only; localhost-bound like the
		// rest. Key: env ZAI_API_KEY -> pi auth.json -> X-ZAI-Key header (paste).
		const key =
			process.env.ZAI_API_KEY ||
			zaiKeyFromAuth() ||
			req.headers["x-zai-key"];
		if (!key) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end('{"ok":false,"error":"no API key"}');
		}
		try {
			const { status, body } = await zaiUsage(key);
			let parsed = null;
			try {
				parsed = JSON.parse(body);
			} catch {}
			// ponytail: z.ai returns HTTP 200 even for auth/rate errors, burying the
			// real status in the body (code>=400 or success:false). Honor it so a
			// bad key surfaces as a clear error, not "no quota fields found".
			let error = null;
			if (
				parsed &&
				typeof parsed === "object" &&
				((typeof parsed.code === "number" && parsed.code >= 400) ||
					parsed.success === false)
			)
				error =
					parsed.msg ||
					parsed.message ||
					`provider error${parsed.code ? " (code " + parsed.code + ")" : ""}`;
			// ponytail: z.ai wraps the payload in an envelope {code,msg,data,success};
			// unwrap data so the client sees {limits[],level} directly (the envelope's
			// code/success were only needed for the error check above).
			const data =
				parsed &&
				typeof parsed === "object" &&
				parsed.data != null &&
				typeof parsed.data === "object"
					? parsed.data
					: parsed;
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: !error && status >= 200 && status < 300,
					status,
					data,
					error,
					// ponytail: raw fallback so a non-JSON error page still surfaces
					raw: data ? null : body.slice(0, 2000),
				}),
			);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/ponytail-mode") {
		// ponytail: read the active ponytail mode for the header dropdown.
		// Default mirrors the ponytail extension's resolver exactly:
		// PONYTAIL_DEFAULT_MODE env > config file defaultMode > "full". A
		// session override (most recent ponytail-mode custom entry in the
		// session jsonl, whose path the client passes in ?session=) wins.
		const mode =
			ponySessionMode(url.searchParams.get("session")) ||
			ponyDefaultMode();
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ ok: true, mode }));
	}

	if (req.method === "GET" && url.pathname === "/api/subagent-tiers") {
		// subagent tier-model config, shared with the extension: reads/writes
		// ~/.pi/agent/subagent-tiers.json ({capable,implement,lookup}→"provider/model").
		// ponytail: GET returns {} when absent so the sidebar shows defaults. No
		// client-controlled path (fixed to AGENT_DIR), so no traversal surface.
		const file = path.join(AGENT_DIR, "subagent-tiers.json");
		try {
			const raw = fs.readFileSync(file, "utf8");
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({ ok: true, tiers: JSON.parse(raw) }),
			);
		} catch {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end('{"ok":true,"tiers":{}}');
		}
	}
	if (req.method === "POST" && url.pathname === "/api/subagent-tiers") {
		// validate then persist the three tier models. Only the known keys are kept;
		// values must be non-empty strings (provider/model). isAllowed already
		// gated the POST (CSRF + DNS-rebinding); readBody caps at 1MB.
		let body;
		try {
			body = await readBody(req);
			const obj = JSON.parse(body || "{}");
			const clean = {};
			for (const k of ["capable", "implement", "lookup"]) {
				const v = obj && obj[k];
				if (typeof v === "string" && v.trim()) clean[k] = v.trim();
			}
			fs.mkdirSync(AGENT_DIR, { recursive: true });
			fs.writeFileSync(
				path.join(AGENT_DIR, "subagent-tiers.json"),
				JSON.stringify(clean),
				"utf8",
			);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true, tiers: clean }));
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "GET" && url.pathname === "/api/workspaces") {
		// auto-discovered project roots (FR-1/FR-2): scan pi's session storage,
		// always including the current cwd. No client path is accepted.
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(
			JSON.stringify({
				ok: true,
				current: PI_CWD,
				workspaces: discoverWorkspaces(
					path.join(AGENT_DIR, "sessions"),
					PI_CWD,
				),
			}),
		);
	}
	if (req.method === "POST" && url.pathname === "/api/workspace") {
		if (NO_SWITCH) {
			res.writeHead(403, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: false,
					error: "workspace switching disabled",
				}),
			);
		}
		// switch active project (FR-3/FR-5). Only a realpath-match of a discovered
		// workspace is accepted — never an arbitrary path — so the browser can't
		// point pi at a dir it hasn't already run in (the sandbox stays intact).
		let body;
		try {
			body = await readBody(req);
			const obj = JSON.parse(body || "{}");
			const discovered = discoverWorkspaces(
				path.join(AGENT_DIR, "sessions"),
				PI_CWD,
			);
			if (!isKnownWorkspacePath(discovered, obj.path)) {
				res.writeHead(400, { "Content-Type": "application/json" });
				return res.end(
					JSON.stringify({
						ok: false,
						error: "not a known workspace",
					}),
				);
			}
			switchWorkspace(fs.realpathSync(obj.path));
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true, workspace: PI_CWD }));
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "GET" && url.pathname === "/api/sessions") {
		// resumable sessions for this project's cwd (newest first). The dir is
		// derived from PI_CWD — no client path is accepted, so nothing escapes it.
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ ok: true, sessions: listSessions() }));
	}

	// read-only Git snapshot + per-file diff (plan 4.5). Scoped to realpath(PI_CWD);
	// no client cwd is accepted. The diff path must be a known changed file of the
	// current snapshot (validated inside getGitFileDiff), so nothing escapes the repo.
	if (req.method === "GET" && url.pathname === "/api/git") {
		try {
			const snapshot = await getGitSnapshot(PI_CWD);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true, snapshot: snapshot }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	// git mutations (plan 4.6). All scoped to PI_CWD; the client gates each behind a
	// confirm modal. Bodies are tiny JSON ({message}/{hash}/{path}); 200 + ok:false
	// on git error so the client shows the message in a toast.
	if (req.method === "POST" && url.pathname === "/api/git/commit") {
		try {
			const body = JSON.parse((await readBody(req)) || "{}");
			await commitChanges(PI_CWD, String(body.message || ""));
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "POST" && url.pathname === "/api/git/push") {
		try {
			const r = await pushCommits(PI_CWD);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: r.pushed,
					error: r.pushed ? undefined : r.pushError,
				}),
			);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "POST" && url.pathname === "/api/git/reset") {
		try {
			const body = JSON.parse((await readBody(req)) || "{}");
			await resetGitCommit(PI_CWD, String(body.hash || ""));
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "POST" && url.pathname === "/api/git/revert") {
		try {
			const body = JSON.parse((await readBody(req)) || "{}");
			await revertGitCommit(PI_CWD, String(body.hash || ""));
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "POST" && url.pathname === "/api/git/discard") {
		try {
			const body = JSON.parse((await readBody(req)) || "{}");
			if (body.path) await discardFileChanges(PI_CWD, String(body.path));
			else await discardChanges(PI_CWD);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	// Improve prompt (plan 4.8): rewrite the composer draft via a disposable isolated
	// pi process (cheapest model, --no-tools, separate profile dir). Long-running (the
	// isolated pi runs for a few seconds); isolated-prompt.js bounds it at 120s.
	if (req.method === "POST" && url.pathname === "/api/improve-prompt") {
		try {
			const body = JSON.parse((await readBody(req)) || "{}");
			const draft = String(body.text || "");
			const direction = String(body.direction || "");
			if (!draft.trim()) throw new Error("Nothing to improve.");
			const result = await improvePrompt(PI_CWD, draft, direction);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: true, text: result.text }));
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}
	if (req.method === "GET" && url.pathname === "/api/git/diff") {
		try {
			const p = url.searchParams.get("path") || "";
			const commit = url.searchParams.get("commit") || undefined;
			const result = await getGitFileDiff(PI_CWD, p, commit);
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(
				JSON.stringify({
					ok: true,
					diff: result.diff,
					path: result.path,
				}),
			);
		} catch (e) {
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/plan-state") {
		// ponytail: detect SDD plan/spec/tasks/verify artifacts under .sdd. Naming
		// convention is {type}_{slug}_{DDMMYYYY}.md (skills/sdd/SKILL.md), which lets
		// multiple efforts coexist as history; legacy fixed names (plan.md,
		// verify-report.md, ...) still match for back-compat. Fixed dir + parsed
		// filenames under PI_CWD — no client path, so no traversal surface;
		// contents read via sandboxed /api/file. Sorted newest-first so the client
		// can pick the "latest active" set for the badge and list the rest as history.
		const parseArtifact = (name) => {
			const base = name.replace(/\.md$/i, "");
			if (!base) return null;
			if (base === "verify-report")
				return { phase: "verify", slug: "", date: "" }; // legacy
			let m = base.match(/^(plan|spec|tasks|verify)_(.*)_(\d{8})$/);
			if (m) return { phase: m[1], slug: m[2], date: m[3] };
			m = base.match(/^(plan|spec|tasks|verify)(?:_(.+))?$/);
			if (m) return { phase: m[1], slug: m[2] || "", date: "" }; // legacy
			return null;
		};
		const out = [];
		try {
			const dir = path.join(PI_CWD, ".sdd");
			for (const name of fs.readdirSync(dir)) {
				if (!/\.md$/i.test(name)) continue;
				const p = parseArtifact(name);
				if (!p) continue;
				const rel = ".sdd/" + name;
				let mtime = 0;
				try {
					mtime = fs.statSync(path.join(dir, name)).mtimeMs;
				} catch {}
				const entry = { ...p, rel, mtime };
				// ponytail: count markdown task checkboxes so the rail can show chunk
				// progress (skills/sdd Phase 4 marks each chunk [x] + compliance note).
				// Heuristic counts checkboxes inside fenced code too — rare in real
				// tasks files; go fence-aware only if it ever misleads.
				if (p.phase === "tasks") {
					try {
						const txt = fs.readFileSync(
							path.join(dir, name),
							"utf8",
						);
						entry.total = (
							txt.match(/^\s*[-*]\s*\[[ xX]\]/gm) || []
						).length;
						entry.done = (
							txt.match(/^\s*[-*]\s*\[[xX]\]/gm) || []
						).length;
					} catch {}
				}
				out.push(entry);
			}
		} catch {
			/* no .sdd dir yet — no SDD run started */
		}
		out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ ok: true, artifacts: out }));
	}

	res.writeHead(404);
	res.end("not found");
});

// ponytail: surface listen-time failures (EADDRINUSE, EACCES, …) as a clear
// log line and exit, instead of an unhandled 'error' stack. server.js isn't
// supervised, so a clean exit + log line is what /webui tails to tell the user
// why it died on start. (Connection errors emit on req/res, not the server.)
server.on("error", (e) => {
	console.error(`[server] listen error: ${e.code || ""} ${e.message}`);
	process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(
		`pi-webui on http://127.0.0.1:${PORT}  (pi: ${PI_BIN} ${["--mode", "rpc", ...PI_ARGS].join(" ")})`,
	);
});
