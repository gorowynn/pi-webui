/*
 * subagents.js — read-only view + control delivery for the pi-subagents
 * plugin's ASYNC (background) runs. Zero-dep CommonJS.
 *
 * The plugin (npm:pi-subagents) parks every background run under
 *   <os.tmpdir()>/pi-subagents-<scope>/async-subagent-runs/<runId>/
 * with `status.json` (live state, updated by the runner), per-step
 * `output-<i>.log` tails, `subagent-log-<runId>.md`, and a FILE-BASED control
 * inbox (`control/stop.json`, `control/steer-requests/*.json`) that is the
 * plugin's documented portable control path (works on Windows where signals
 * don't). This module reads those artifacts and writes control requests —
 * it never talks to the plugin process itself, so a crashed/stale view can
 * never corrupt a run.
 *
 * Security: run ids are validated (/^[A-Za-z0-9][A-Za-z0-9._-]*$/) AND must
 * resolve to a directory that currently exists under a discovered root, so no
 * client string ever reaches path.join unvalidated (GOTCHAS #4 spirit).
 * PI_SUBUI… no — PI_SUBAGENTS_TEMP_ROOT env overrides discovery (tests).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const RUNS_DIRNAME = "async-subagent-runs";
const MAX_RUNS = 60; // newest-first cap for the listing
const MAX_STEPS = 32; // cap projected steps per run
const MAX_STATUS_BYTES = 512 * 1024; // status.json read cap (workflowGraph can be big)
const MAX_LOG_TAIL = 32 * 1024; // log endpoint returns the last 32 KB
const MAX_STEER_BYTES = 32 * 1024; // plugin accepts 128 KB; we cap tighter
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const ACTIVE_STATES = new Set(["queued", "running", "paused"]);

/** Roots = every `pi-subagents-*` dir in tmpdir (normally exactly one; uid vs
 *  username scope changes leave stale siblings — merging is harmless). */
function discoverRoots(opts) {
	const o = opts || {};
	if (o.roots) return o.roots.slice();
	const override = o.envRoot || process.env.PI_SUBAGENTS_TEMP_ROOT;
	if (override) return [path.resolve(override)];
	const tmp = typeof o.tmpdir === "function" ? o.tmpdir() : os.tmpdir();
	let names = [];
	try {
		names = fs.readdirSync(tmp);
	} catch {
		return [];
	}
	return names
		.filter((n) => n.startsWith("pi-subagents-"))
		.map((n) => path.join(tmp, n));
}

/** runId → dir map across all roots (for log/control). Returns a Map. */
function runDirs(opts) {
	const map = new Map();
	for (const root of discoverRoots(opts)) {
		const runsDir = path.join(root, RUNS_DIRNAME);
		let names = [];
		try {
			names = fs.readdirSync(runsDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const d of names)
			if (d.isDirectory() && ID_RE.test(d.name))
				map.set(d.name, path.join(runsDir, d.name));
	}
	return map;
}

/** Bounded read+parse of one run's status.json → projection (or null). */
function readRunStatus(dir, id) {
	let raw;
	try {
		const st = fs.statSync(path.join(dir, "status.json"));
		if (!st.isFile() || st.size > MAX_STATUS_BYTES) return null;
		raw = fs.readFileSync(path.join(dir, "status.json"), "utf8");
		const s = JSON.parse(raw);
		if (!s || typeof s !== "object") return null;
		const steps = Array.isArray(s.steps) ? s.steps.slice(0, MAX_STEPS) : [];
		return {
			id,
			runId: typeof s.runId === "string" ? s.runId : id,
			state: typeof s.state === "string" ? s.state : "unknown",
			mode: typeof s.mode === "string" ? s.mode : undefined,
			description:
				typeof s.description === "string" ? s.description : undefined,
			startedAt:
				typeof s.startedAt === "number" ? s.startedAt : undefined,
			endedAt: typeof s.endedAt === "number" ? s.endedAt : undefined,
			error: typeof s.error === "string" ? s.error : undefined,
			currentTool:
				typeof s.currentTool === "string" ? s.currentTool : undefined,
			currentPath:
				typeof s.currentPath === "string" ? s.currentPath : undefined,
			turnCount:
				typeof s.turnCount === "number" ? s.turnCount : undefined,
			toolCount:
				typeof s.toolCount === "number" ? s.toolCount : undefined,
			pid: typeof s.pid === "number" ? s.pid : undefined,
			cwd: typeof s.cwd === "string" ? s.cwd : undefined,
			// stop requested but still active → the runner saw the graceful stop and
			// is waiting for children to reach an abort boundary (can hang on a long
			// LLM call). The UI uses this to show "stopping…" + a force-stop button.
			stopRequested:
				ACTIVE_STATES.has(s.state) &&
				fs.existsSync(path.join(dir, "control", "stop.json")),
			agents: Array.isArray(s.agents) ? s.agents.slice(0, 16) : undefined,
			stepsTotal:
				typeof s.stepsTotal === "number" ? s.stepsTotal : undefined,
			runningSteps:
				typeof s.runningSteps === "number" ? s.runningSteps : undefined,
			completedSteps:
				typeof s.completedSteps === "number"
					? s.completedSteps
					: undefined,
			steps: steps.map((st2) => ({
				index: typeof st2.index === "number" ? st2.index : undefined,
				agent: typeof st2.agent === "string" ? st2.agent : "?",
				status: typeof st2.status === "string" ? st2.status : "unknown",
				description:
					typeof st2.description === "string"
						? st2.description
						: undefined,
				phase: typeof st2.phase === "string" ? st2.phase : undefined,
				label: typeof st2.label === "string" ? st2.label : undefined,
				startedAt:
					typeof st2.startedAt === "number"
						? st2.startedAt
						: undefined,
				model: typeof st2.model === "string" ? st2.model : undefined,
				sessionFile:
					typeof st2.sessionFile === "string"
						? st2.sessionFile
						: undefined,
			})),
			stepsTruncated:
				Array.isArray(s.steps) && s.steps.length > MAX_STEPS,
		};
	} catch {
		return null; // half-written / racing runner — never 500 the listing
	}
}

/** All runs across roots, active-first then newest. [{...status, dir}] */
function listSubagentRuns(opts) {
	const dirs = runDirs(opts);
	const out = [];
	for (const [id, dir] of dirs) {
		const s = readRunStatus(dir, id);
		if (s) out.push(Object.assign(s, { dir }));
	}
	out.sort((a, b) => {
		const aa = ACTIVE_STATES.has(a.state) ? 0 : 1;
		const ba = ACTIVE_STATES.has(b.state) ? 0 : 1;
		if (aa !== ba) return aa - ba;
		return (b.startedAt || 0) - (a.startedAt || 0);
	});
	return out.slice(0, MAX_RUNS);
}

/** Tail of a run artifact: output-<step>.log (kind "output") or the run log
 *  markdown (kind "run", the default). Returns {name, text} or null. */
/** Tail-read the last ≤maxBytes of a file → {name, truncated, text}|null. */
function tailFile(file, maxBytes) {
	try {
		const st = fs.statSync(file);
		if (!st.isFile()) return null;
		const fd = fs.openSync(file, "r");
		try {
			const start = Math.max(0, st.size - maxBytes);
			const buf = Buffer.alloc(st.size - start);
			fs.readSync(fd, buf, 0, buf.length, start);
			return {
				name: path.basename(file),
				truncated: start > 0,
				text: buf.toString("utf8"),
			};
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return null;
	}
}

/** Child transcripts also live PROJECT-LOCAL: <run cwd>/.pi-subagents/
 *  artifacts/<childRunId>_<agent>_<i>_transcript.jsonl (records: message /
 *  tool_start / tool_end / stdout / stderr / truncated — see the plugin's
 *  shared/child-transcript.ts). Workflow steps have no output-<i>.log, so the
 *  step log falls back to these. Correlation: agent name + first-record ts
 *  nearest the step's startedAt (spawn lands within ~100 ms). */
function pickTranscript(artifactsDir, agent, startedAt, sessionFile) {
	let names = [];
	try {
		names = fs.readdirSync(artifactsDir);
	} catch {
		return null;
	}
	const cands = names.filter(
		(n) => n.endsWith("_transcript.jsonl") && n.includes(`_${agent}_`),
	);
	// DETERMINISTIC path: the child's own run id appears both in its
	// sessionFile (…\<childRunId>\run-0\session.jsonl) and as the artifact
	// filename prefix. ts-proximity alone cross-matches same-agent children
	// spawned near-simultaneously (parallel workflow waves).
	const rid =
		typeof sessionFile === "string"
			? sessionFile.match(/[\\/]([0-9a-f]{6,12})[\\/]run-\d+[\\/]/)
			: null;
	if (rid) {
		const exact = cands.find((n) => n.startsWith(`${rid[1]}_`));
		if (exact) return path.join(artifactsDir, exact);
	}
	let best = null;
	let bestDiff = Number.POSITIVE_INFINITY;
	for (const n of cands) {
		const fp = path.join(artifactsDir, n);
		try {
			const fd = fs.openSync(fp, "r");
			const size = fs.fstatSync(fd).size;
			// head only; the first record's `ts` sits within the first KBs even
			// when the (fork-context) prompt makes the full line 100 KB+
			const buf = Buffer.alloc(Math.min(16384, size));
			fs.readSync(fd, buf, 0, buf.length, 0);
			fs.closeSync(fd);
			const head = buf.toString("utf8").split("\n")[0];
			let ts;
			try {
				ts = JSON.parse(head).ts;
			} catch {
				const m = /"ts"\s*:\s*(\d{10,})/.exec(head);
				ts = m ? Number(m[1]) : undefined;
			}
			const diff =
				startedAt && typeof ts === "number"
					? Math.abs(ts - startedAt)
					: 0;
			if (diff <= bestDiff) {
				bestDiff = diff;
				best = fp;
			}
		} catch {
			/* unreadable candidate — skip */
		}
	}
	if (!best) return null;
	if (startedAt && bestDiff > 30000) return null; // no plausible match
	return best;
}

/** JSONL transcript records → compact readable lines (last 400). */
function formatTranscript(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let r;
		try {
			r = JSON.parse(line);
		} catch {
			continue; // partial tail line
		}
		if (r.recordType === "message") {
			const t = String(r.text || "")
				.replace(/\s+/g, " ")
				.trim();
			if (!t) continue;
			if (r.role === "user") out.push("▸ " + t.slice(0, 200));
			else if (r.role === "toolResult")
				out.push(
					(r.isError ? "✗ " : "✓ ") +
						(r.toolName || "tool") +
						": " +
						t.slice(0, 200),
				);
			else out.push(t.slice(0, 400));
		} else if (r.recordType === "tool_start") {
			out.push(
				"→ " +
					(r.toolName || "?") +
					(r.argsPreview ? " " + r.argsPreview : ""),
			);
		} else if (r.recordType === "tool_end") {
			out.push("  " + (r.isError ? "✗" : "✓") + " " + (r.toolName || ""));
		} else if (r.recordType === "stdout" || r.recordType === "stderr") {
			out.push(
				(r.recordType === "stderr" ? "! " : "  ") +
					String(r.line || "").slice(0, 200),
			);
		} else if (r.recordType === "truncated") {
			out.push("…(transcript truncated)");
		}
	}
	return out.slice(-400).join("\n");
}

/** Run events.jsonl → compact readable lines (last 200). */
function formatEvents(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let r;
		try {
			r = JSON.parse(line);
		} catch {
			continue;
		}
		const at =
			typeof r.ts === "number"
				? new Date(r.ts).toISOString().slice(11, 19) + " "
				: "";
		let extra = "";
		if (Array.isArray(r.trace))
			extra =
				" " +
				r.trace
					.map((x) => `${x.key || x.operation}:${x.state}`)
					.join(", ");
		else if (r.agent)
			extra = " " + r.agent + (r.status ? ":" + r.status : "");
		out.push(at + String(r.type || "?").replace(/^subagent\./, "") + extra);
	}
	return out.slice(-200).join("\n");
}

/** Tail of a run artifact. kind "output" (step): output-<i>.log when the run
 *  mode writes one, else the step's project-local transcript (formatted).
 *  kind "run": subagent-log-<runId>.md when present, else events.jsonl
 *  (formatted). Returns {name, truncated, text} or null. */
function readRunLog(id, step, kind, opts) {
	if (!ID_RE.test(id)) return null;
	const dir = runDirs(opts).get(id);
	if (!dir) return null;
	if (kind === "output") {
		if (!Number.isInteger(step) || step < 0 || step > 1000) return null;
		// 1) the plugin's own per-step output log, when it exists
		const raw = tailFile(
			path.join(dir, `output-${step}.log`),
			MAX_LOG_TAIL,
		);
		if (raw) return raw;
		// 2) workflow steps: the child transcript in <run cwd>/.pi-subagents
		const st = readRunStatus(dir, id);
		const stepInfo = st && st.steps[step];
		if (!stepInfo || !st.cwd) return null;
		const tp = pickTranscript(
			path.join(st.cwd, ".pi-subagents", "artifacts"),
			stepInfo.agent,
			stepInfo.startedAt,
			stepInfo.sessionFile,
		);
		if (!tp) return null;
		const tail = tailFile(tp, MAX_LOG_TAIL * 2);
		if (!tail) return null;
		return {
			name: tail.name,
			truncated: tail.truncated,
			text: formatTranscript(tail.text),
		};
	}
	// kind "run": markdown run log when present, else formatted events
	let names = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return null;
	}
	const log = names.find(
		(n) => n.startsWith("subagent-log-") && n.endsWith(".md"),
	);
	if (log) return tailFile(path.join(dir, log), MAX_LOG_TAIL);
	const ev = tailFile(path.join(dir, "events.jsonl"), MAX_LOG_TAIL);
	if (!ev) return null;
	return {
		name: ev.name,
		truncated: ev.truncated,
		text: formatEvents(ev.text),
	};
}

/** Atomic JSON write (temp + rename), mirroring the plugin's own writer. */
function writeAtomicJson(file, obj) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
	fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
	fs.renameSync(tmp, file);
}

/** Deliver a control request through the plugin's file inbox.
 *  action "stop" → control/stop.json (GRACEFUL — waits for children to reach
 *  an abort boundary; can park indefinitely on a hung LLM call);
 *  "force" → control/timeout.json (the runtime-cap path — kills children
 *  decisively; this is what the 30-min cap uses); "steer" →
 *  control/steer-requests/*.json (same filename scheme the runner watches:
 *  <ts-padded>-<base64url(id)>.json). */
function deliverControl(input, opts) {
	const id = input && input.id;
	const action = input && input.action;
	if (!ID_RE.test(id)) throw new Error("invalid run id");
	if (action !== "stop" && action !== "force" && action !== "steer")
		throw new Error("action must be 'stop', 'force' or 'steer'");
	const dir = runDirs(opts).get(id);
	if (!dir) throw new Error("unknown run: " + id);
	const ts = Date.now();
	if (action === "stop" || action === "force") {
		const file = action === "stop" ? "stop.json" : "timeout.json";
		writeAtomicJson(path.join(dir, "control", file), {
			type: action === "stop" ? "stop" : "timeout",
			ts,
			source: "pi-webui",
		});
		return { delivered: action === "stop" ? "stop" : "force" };
	}
	const message = String((input && input.message) || "").trim();
	if (!message) throw new Error("steer message must not be empty");
	if (Buffer.byteLength(message, "utf8") > MAX_STEER_BYTES)
		throw new Error("steer message too large (max 32 KB)");
	if (
		input.targetIndex !== undefined &&
		(!Number.isInteger(input.targetIndex) ||
			input.targetIndex < 0 ||
			input.targetIndex > 1000)
	)
		throw new Error("targetIndex must be an integer 0..1000");
	const reqId =
		"webui-" +
		ts.toString(36) +
		"-" +
		Math.random().toString(36).slice(2, 10);
	const name =
		String(ts).padStart(13, "0") +
		"-" +
		Buffer.from(reqId).toString("base64url") +
		".json";
	writeAtomicJson(path.join(dir, "control", "steer-requests", name), {
		type: "steer",
		id: reqId,
		ts,
		message,
		source: "pi-webui",
		...(input.targetIndex !== undefined
			? { targetIndex: input.targetIndex }
			: {}),
	});
	return { delivered: "steer", requestId: reqId };
}

module.exports = {
	discoverRoots,
	listSubagentRuns,
	readRunLog,
	deliverControl,
	// exposed for tests
	_ID_RE: ID_RE,
};
