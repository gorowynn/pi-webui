#!/usr/bin/env node
// Minimal zero-dependency bridge between a browser and `pi --mode rpc`.
// Browser <--SSE-- POST--> Node <--stdin/stdout JSONL--> pi subprocess.
// Run: node server.js   (optionally set PORT, PI_BIN, PI_ARGS, PI_CWD)
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const os = require("os");
const { StringDecoder } = require("string_decoder");

const PORT = parseInt(process.env.PORT || "4317", 10);
const PI_BIN = process.env.PI_BIN || "pi";
const PI_ARGS = (process.env.PI_ARGS || "").split(/\s+/).filter(Boolean); // e.g. "--no-session"
const PI_CWD = process.env.PI_CWD || process.cwd();
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");
const HTML_PATH = path.join(__dirname, "index.html");
// ponytail: static assets split out of index.html. Whitelist (not a full static
// dir) keeps the surface to known files — no path traversal, no MIME guessing.
const STATIC = {
	"/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
	"/md.js": { file: "md.js", type: "text/javascript; charset=utf-8" },
	"/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
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
// ponytail: crash-loop guard. An unconditional 1s restart loops forever if
// pi can't start (bad binary, broken install). Count consecutive fast exits and
// back off exponentially up to 30s; reset once a process lives >5s.
let restartAttempts = 0;
let startStamp = 0;
const clients = new Set(); // open SSE responses

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
		: spawn(PI_BIN, args, { cwd: PI_CWD, env: process.env, windowsHide: true });

	// Strict JSONL reader: split on \n only, strip trailing \r. (readline is non-compliant.)
	// ponytail: StringDecoder buffers incomplete UTF-8 tails across chunks so a
	// multibyte char (—, “”, emoji) split on a stdout seam decodes correctly
	// instead of becoming U+FFFD. chunk.toString("utf8") decoded each chunk in
	// isolation — the source of intermittent garbled characters in assistant text.
	let buf = "";
	const dec = new StringDecoder("utf8");
	pi.stdout.on("data", (chunk) => {
		buf += dec.write(chunk);
		let i;
		while ((i = buf.indexOf("\n")) !== -1) {
			let line = buf.slice(0, i);
			buf = buf.slice(i + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (!line) continue;
			let obj;
			try {
				obj = JSON.parse(line);
			} catch {
				continue;
			} // ignore non-JSON noise
			broadcast({ source: "pi", payload: obj });
		}
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
		broadcast({ source: "pi_exit", payload: { code, sig } });
		// survived >5s -> healthy run, reset the crash counter.
		if (Date.now() - startStamp > 5000) restartAttempts = 0;
		const delay = backoffDelay();
		console.error(
			`[pi] exited code=${code} sig=${sig}; restarting in ${delay}ms`,
		);
		setTimeout(startPi, delay); // survive a crashed agent
	});
}
startPi();

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
				resp.on("end", () => resolve({ status: resp.statusCode, body }));
			},
		);
		req.on("error", reject);
		req.setTimeout(8000, () => req.destroy(new Error("z.ai timeout")));
		req.end();
	});
}

// ponytail: sync git probe with a 2s cache; status endpoint, blocking ~50ms is fine.
let gitCache = { t: 0, data: null };
function gitInfo() {
	if (Date.now() - gitCache.t < 2000) return gitCache.data;
	let data = null;
	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: PI_CWD,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
			windowsHide: true, // health endpoint is polled every 2s — must never pop a window
		}).trim();
		const changes = execSync("git status --porcelain", {
			cwd: PI_CWD,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
			windowsHide: true,
		})
			.split("\n")
			.filter(Boolean).length;
		data = { branch, changes };
	} catch {
		data = null; // not a git repo
	}
	gitCache = { t: Date.now(), data };
	return data;
}

function sendToPi(obj) {
	if (!pi || !pi.stdin.writable) throw new Error("pi not running");
	pi.stdin.write(JSON.stringify(obj) + "\n");
}

// ponytail: sandbox any browser-supplied path to PI_CWD so the webui can't
// read/write outside the project (the manual-edit diff feature uses this).
// Resolve, then require the result to be PI_CWD itself or live beneath it.
// ponytail: path.resolve does NOT follow symlinks — a link inside PI_CWD aimed at
// ~/.ssh would pass. realpathSync does, so compare resolved-real paths. It throws
// on a not-yet-existing target (manual-edit writes new files), so in that case
// resolve the existing parent and re-append the basename.
function safePath(rel) {
	const base = fs.realpathSync(PI_CWD);
	const full = path.resolve(base, rel || "");
	let real;
	try {
		real = fs.realpathSync(full);
	} catch {
		real = path.join(fs.realpathSync(path.dirname(full)), path.basename(full));
	}
	if (real !== base && !real.startsWith(base + path.sep))
		throw new Error("path escapes project root");
	return real;
}

// ponytail: cap POST bodies (~1MB) so a runaway client can't OOM the bridge.
// Enforces both Content-Length up front and accumulated bytes on the wire.
const MAX_BODY = 1_000_000;
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
			res.writeHead(200, { "Content-Type": a.type });
			return res.end(fs.readFileSync(path.join(__dirname, a.file)));
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

	if (req.method === "GET" && url.pathname === "/api/health") {
		res.writeHead(200, { "Content-Type": "application/json" });
		return res.end(
			JSON.stringify({
				ok: true,
				pi: PI_BIN + " " + ["--mode", "rpc", ...PI_ARGS].join(" "),
				cwd: PI_CWD,
				git: gitInfo(),
			}),
		);
	}

	if (req.method === "GET" && url.pathname === "/api/file") {
		// manual-edit feature: read a project file (sandboxed to PI_CWD).
		try {
			const full = safePath(url.searchParams.get("path") || "");
			const content = fs.readFileSync(full, "utf8");
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
			fs.writeFileSync(full, obj.content == null ? "" : obj.content, "utf8");
			res.writeHead(200, { "Content-Type": "application/json" });
			return res.end('{"ok":true}');
		} catch (e) {
			res.writeHead(500, { "Content-Type": "application/json" });
			return res.end(JSON.stringify({ ok: false, error: e.message }));
		}
	}

	if (req.method === "GET" && url.pathname === "/api/zai-usage") {
		// z.ai usage/quota proxy. GET so it's read-only; localhost-bound like the
		// rest. Key: env ZAI_API_KEY -> pi auth.json -> X-ZAI-Key header (paste).
		const key =
			process.env.ZAI_API_KEY || zaiKeyFromAuth() || req.headers["x-zai-key"];
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
