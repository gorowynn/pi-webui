#!/usr/bin/env node
// Minimal zero-dependency bridge between a browser and `pi --mode rpc`.
// Browser <--SSE-- POST--> Node <--stdin/stdout JSONL--> pi subprocess.
// Run: node server.js   (optionally set PORT, PI_BIN, PI_ARGS, PI_CWD)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");

const PORT = parseInt(process.env.PORT || "4317", 10);
const PI_BIN = process.env.PI_BIN || "pi";
const PI_ARGS = (process.env.PI_ARGS || "").split(/\s+/).filter(Boolean); // e.g. "--no-session"
const PI_CWD = process.env.PI_CWD || process.cwd();
const HTML_PATH = path.join(__dirname, "index.html");

// ponytail: one shared agent process for all tabs. Multi-session is a later concern.
let pi = null;
const clients = new Set(); // open SSE responses

function broadcast(obj) {
	const line = "data: " + JSON.stringify(obj) + "\n\n";
	for (const res of clients) {
		try {
			res.write(line);
		} catch {
			/* drop, onclose cleans up */
		}
	}
}

function startPi() {
	// ponytail: --approve trusts project-local files (.pi/extensions) for the run.
	// Without it, RPC mode can't resolve trust (no select-prompt handler) → the
	// ask-user-webui plugin is skipped → stock npm ask_user_question runs and
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
			})
		: spawn(PI_BIN, args, { cwd: PI_CWD, env: process.env });

	// Strict JSONL reader: split on \n only, strip trailing \r. (readline is non-compliant.)
	let buf = "";
	pi.stdout.on("data", (chunk) => {
		buf += chunk.toString("utf8");
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
		console.error(`[pi] spawn error: ${e.message}; retrying in 1s`);
		setTimeout(startPi, 1000);
	});
	pi.on("exit", (code, sig) => {
		broadcast({ source: "pi_exit", payload: { code, sig } });
		console.error(`[pi] exited code=${code} sig=${sig}; restarting in 1s`);
		setTimeout(startPi, 1000); // survive a crashed agent
	});
}
startPi();

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
		}).trim();
		const changes = execSync("git status --porcelain", {
			cwd: PI_CWD,
			stdio: ["ignore", "pipe", "ignore"],
			encoding: "utf8",
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

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, "http://localhost");

	if (
		req.method === "GET" &&
		(url.pathname === "/" || url.pathname === "/index.html")
	) {
		const body = fs.readFileSync(HTML_PATH);
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		return res.end(body);
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
		let body = "";
		for await (const c of req) body += c;
		try {
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

	res.writeHead(404);
	res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(
		`pi-webui on http://127.0.0.1:${PORT}  (pi: ${PI_BIN} ${["--mode", "rpc", ...PI_ARGS].join(" ")})`,
	);
});
