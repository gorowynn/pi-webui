/**
 * pi_minimal_webui — Subagent tool: tier-based delegation.
 *
 * Ports pi's bundled examples/extensions/subagent core, stripped to what
 * `pi --mode rpc` actually uses: NO TUI rendering (renderCall/renderResult are
 * TUI-only; the webui shows result.content text + its own live details view),
 * NO filesystem agent discovery (the 3 tiers are in-code config below). Keeps
 * the part that matters: spawning an isolated `pi --mode json` subprocess on the
 * agent's pinned model.
 *
 * Why: the parent (this session) never ingests the subagent's full tool I/O —
 * only its final text returns (capped). Two wins at once: cost routing (tier →
 * model) + context savings (isolated context = roadmap O2 achieved structurally,
 * not by manual editing).
 *
 * Modes: single {agent, task} | parallel {tasks[]} | chain {chain[] w/ {previous}}.
 * The parent model decides which agent/mode; this just runs it. See docs/plans.md.
 *
 * Tier models are user-tunable from the webui sidebar: a config file at
 * ~/.pi/agent/subagent-tiers.json ({capable,implement,lookup} → "provider/model")
 * is re-read on every call (safeguard pattern) and overrides the TIERS defaults.
 */
// @ts-expect-error no @types/node in this zero-dep extension; built-ins at runtime.
import { spawn } from "node:child_process";
// @ts-expect-error no @types/node in this zero-dep extension; built-ins at runtime.
import * as fs from "node:fs";
// @ts-expect-error no @types/node in this zero-dep extension; built-ins at runtime.
import * as os from "node:os";
// @ts-expect-error no @types/node in this zero-dep extension; built-ins at runtime.
import * as path from "node:path";

// ponytail: ambient node globals. This extension has no @types/node (jiti strips
// types at load; runtime has the real globals). Declared minimally so the checker
// doesn't choke on Buffer/process used below. index.ts uses a per-line suppression
// comment for its single process.env access; this file touches 7 global refs, so a
// 2-line ambient declare is less noise than 7 suppressions.
declare const Buffer: { byteLength(val: string, encoding?: string): number };
declare const process: { argv: string[]; execPath: string };

// ---- local minimal types (no runtime host imports; jiti strips these) ----
// Shape mirrors ./todo.ts so the ExtensionAPI index.ts hands us is structurally
// assignable (methods bivariant, ctx a subset of the runtime shape).
interface ToolExecutionContext {
	hasUI: boolean;
	cwd?: string;
}
interface AgentToolResult {
	content: { type: "text"; text: string }[];
	details?: unknown;
	isError?: boolean;
}
type OnUpdateCallback = (partial: AgentToolResult) => void;
interface ToolDefinition {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: unknown;
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: ToolExecutionContext,
	): Promise<AgentToolResult>;
}
interface ExtensionAPI {
	registerTool(def: ToolDefinition): void;
}
// Minimal slice of pi-ai's Message — only the fields the json-mode parser reads.
interface ContentPart {
	type: string; // "text" | "thinking" | "toolCall" | ...
	text?: string;
	thinking?: string; // reasoning models put the answer here with no `text` part
	name?: string;
	arguments?: Record<string, unknown>;
}
interface MessageLike {
	role: string;
	content: ContentPart[];
	usage?: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
}
interface UsageStats {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
	totalTokens?: number;
}

// ---- tier agent config (the routing table) ----
// tools is a pi --tools allowlist: restricts what the subagent can do. Recon
// agents get read-only tools; the implementer can mutate. model pins the tier
// (default; overridden per-call by readTierModels()).
interface TierAgent {
	name: string;
	tier: "capable" | "implement" | "lookup"; // user-tunable model is keyed by this
	description: string;
	model: string;
	tools?: string[];
	systemPrompt: string;
}
const TIERS: TierAgent[] = [
	{
		// Capable tier — planning, review, debugging. Needs strong reasoning.
		name: "planner",
		tier: "capable",
		description:
			"Plan multi-step work; produce an ordered task breakdown. Read-only recon.",
		model: "zai/glm-5.2",
		tools: ["read", "grep", "find", "ls"],
		systemPrompt:
			"You are a planning agent. Investigate the codebase (read-only) and produce a concise, ordered implementation plan. Identify the exact files and the change per step. Do not write code.",
	},
	{
		name: "reviewer",
		tier: "capable",
		description:
			"Review code/diffs for correctness, bugs, edge cases, and style. Read-only.",
		model: "zai/glm-5.2",
		tools: ["read", "grep"],
		systemPrompt:
			"You are a code reviewer. Read the given code/diff and report concrete issues: bugs, edge cases, security, and clarity. Be specific (file:line) and prioritized. Do not edit.",
	},
	{
		name: "debugger",
		tier: "capable",
		description:
			"Investigate a bug; trace symptoms to a root cause. Read-heavy recon.",
		model: "zai/glm-5.2",
		// ponytail: read-only recon — `bash` was dropped (2026-06-25) to make the
		// capability wall match the read-only intent. The spawned subprocess runs
		// headless (hasUI=false); safeguard fires its tool_call hook but auto-allows
		// under the nonInteractive policy, so bash had no real per-command gate
		// (only this system prompt). Losing repro/git-blame traces is the accepted
		// trade-off vs unattended arbitrary bash. If reproduction is essential,
		// route that work to the parent (which is safeguard-gated).
		tools: ["read", "grep", "find"],
		systemPrompt:
			"You are a debugging agent. Trace the reported symptom to its root cause using read-only recon (read, grep, find) over the code. State the root cause, the offending code, and the minimal fix — do not apply it.",
	},
	{
		// Small tier — implementation. Competent but cheaper.
		name: "implementer",
		tier: "implement",
		description:
			"Implement a well-specified change: edit/write files, run checks. Mutates.",
		model: "zai/glm-5-turbo",
		tools: ["read", "edit", "write", "bash", "grep", "find"],
		systemPrompt:
			"You are an implementation agent. Apply the given spec exactly and minimally — edit/write files, run builds or tests to verify. Stop when the change works; don't refactor beyond the task.",
	},
	{
		// Smallest tier — lookups and summarizations. Cheapest.
		name: "scout",
		tier: "lookup",
		description:
			"Fast recon: locate files/symbols, summarize structure. Read-only.",
		model: "zai/glm-4.5-air",
		tools: ["ls", "find", "grep", "read"],
		systemPrompt:
			"You are a scout agent. Quickly locate the requested files/symbols or summarize structure. Return a compact, high-signal answer (paths + one line each). Do not read more than needed.",
	},
	{
		name: "summarizer",
		tier: "lookup",
		description: "Summarize a file, doc, or log into key points. Read-only.",
		model: "zai/glm-4.5-air",
		tools: ["read"],
		systemPrompt:
			"You are a summarizer. Read the given file/doc/log and return a tight summary of the key points. Preserve exact names/paths/IDs; drop prose.",
	},
];

// ---- internals ----
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const PER_TASK_OUTPUT_CAP = 50 * 1024;

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return (count / 1000).toFixed(1) + "k";
	if (count < 1000000) return Math.round(count / 1000) + "k";
	return (count / 1000000).toFixed(1) + "M";
}
function formatUsage(u: UsageStats, model?: string): string {
	const p: string[] = [];
	if (u.input) p.push("↑" + formatTokens(u.input));
	if (u.output) p.push("↓" + formatTokens(u.output));
	if (u.cacheRead) p.push("R" + formatTokens(u.cacheRead));
	if (u.cost?.total) p.push("$" + u.cost.total.toFixed(4));
	if (u.totalTokens && u.totalTokens > 0)
		p.push("ctx:" + formatTokens(u.totalTokens));
	if (model) p.push(model);
	return p.join(" ");
}

interface SingleResult {
	agent: string;
	task: string;
	exitCode: number;
	messages: MessageLike[];
	stderr: string;
	usage: UsageStats;
	turns: number;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}
interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	results: SingleResult[];
}

function getFinalOutput(messages: MessageLike[]): string {
	// text part = the real answer. Scan newest-first for the last assistant text.
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant")
			for (const part of msg.content)
				if (part.type === "text" && part.text) return part.text;
	}
	// ponytail: reasoning models (e.g. zai/glm-4.7, which glm-4.5-air is aliased
	// to) sometimes emit the answer ONLY in a `thinking` block with no `text`
	// part at all — so the text pass above returned "" and the parent saw
	// "(no output)" despite the model having answered (verified: 3 output tokens,
	// turn completed normally). Fall back to the last thinking content so the
	// parent gets the answer. Trim: reasoning models prefix a stray newline.
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant")
			for (const part of msg.content)
				if (part.type === "thinking" && part.thinking)
					return part.thinking.trim();
	}
	return "";
}
function isFailed(r: SingleResult): boolean {
	return (
		r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted"
	);
}
function getResultOutput(r: SingleResult): string {
	if (isFailed(r))
		return (
			r.errorMessage || r.stderr || getFinalOutput(r.messages) || "(no output)"
		);
	return getFinalOutput(r.messages) || "(no output)";
}
function firstResult(details: unknown): SingleResult | undefined {
	const d = details as SubagentDetails | undefined;
	return d && d.results[0];
}

function truncateCap(output: string): string {
	const bytes = Buffer.byteLength(output, "utf8");
	if (bytes <= PER_TASK_OUTPUT_CAP) return output;
	let t = output.slice(0, PER_TASK_OUTPUT_CAP);
	while (Buffer.byteLength(t, "utf8") > PER_TASK_OUTPUT_CAP) t = t.slice(0, -1);
	return `${t}\n\n[Output truncated: ${bytes - Buffer.byteLength(t, "utf8")} bytes omitted.]`;
}

async function mapLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (!items.length) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const out: TOut[] = new Array(items.length);
	let next = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			out[i] = await fn(items[i], i);
		}
	});
	await Promise.all(workers);
	return out;
}

// Reuse the running pi if possible, else fall back to `pi` on PATH. Ported from
// the upstream example so the spawned subagent uses the same binary/provider.
function getPiInvocation(extra: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	const isBunVirtual = script?.startsWith("/$bunfs/root/");
	if (script && !isBunVirtual && fs.existsSync(script))
		return { command: process.execPath, args: [script, ...extra] };
	const execName = path.basename(process.execPath).toLowerCase();
	if (!/^(node|bun)(\.exe)?$/.test(execName))
		return { command: process.execPath, args: extra };
	return { command: "pi", args: extra };
}

async function writeTempPrompt(
	agentName: string,
	prompt: string,
): Promise<{ dir: string; file: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
	const file = path.join(
		dir,
		`prompt-${agentName.replace(/[^\w.-]+/g, "_")}.md`,
	);
	await fs.promises.writeFile(file, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir, file };
}

async function runSingle(
	defaultCwd: string | undefined,
	agents: TierAgent[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	const base: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: {},
		turns: 0,
		step,
	};
	if (!agent) {
		const avail = agents.map((a) => `"${a.name}"`).join(", ");
		return {
			...base,
			exitCode: 1,
			stderr: `Unknown agent: "${agentName}". Available: ${avail}.`,
		};
	}

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools?.length) args.push("--tools", agent.tools.join(","));

	const cur: SingleResult = { ...base, model: agent.model };
	const emit = () =>
		onUpdate?.({
			content: [
				{ type: "text", text: getFinalOutput(cur.messages) || "(running...)" },
			],
			details: makeDetails([cur]),
		});

	let tmpDir: string | null = null;
	let tmpFile: string | null = null;
	try {
		if (agent.systemPrompt.trim()) {
			const tmp = await writeTempPrompt(agent.name, agent.systemPrompt);
			tmpDir = tmp.dir;
			tmpFile = tmp.file;
			args.push("--append-system-prompt", tmpFile);
		}
		args.push(`Task: ${task}`);
		let aborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const inv = getPiInvocation(args);
			const proc = spawn(inv.command, inv.args, {
				cwd: cwd ?? defaultCwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buf = "";
			const onLine = (line: string) => {
				if (!line.trim()) return;
				let ev: any;
				try {
					ev = JSON.parse(line);
				} catch {
					return;
				}
				if (ev.type === "message_end" && ev.message) {
					const msg = ev.message as MessageLike;
					cur.messages.push(msg);
					if (msg.role === "assistant") {
						cur.turns++;
						const u = msg.usage;
						if (u) {
							cur.usage.input = (cur.usage.input || 0) + (u.input || 0);
							cur.usage.output = (cur.usage.output || 0) + (u.output || 0);
							cur.usage.cacheRead =
								(cur.usage.cacheRead || 0) + (u.cacheRead || 0);
							cur.usage.cost = {
								total: (cur.usage.cost?.total || 0) + (u.cost?.total || 0),
							};
							cur.usage.totalTokens = u.totalTokens || 0;
						}
						if (!cur.model && msg.model) cur.model = msg.model;
						if (msg.stopReason) cur.stopReason = msg.stopReason;
						if (msg.errorMessage) cur.errorMessage = msg.errorMessage;
					}
					emit();
				}
				if (ev.type === "tool_result_end" && ev.message) {
					cur.messages.push(ev.message as MessageLike);
					emit();
				}
			};
			proc.stdout.on("data", (d: any) => {
				buf += d.toString();
				const lines = buf.split("\n");
				buf = lines.pop() || "";
				for (const l of lines) onLine(l);
			});
			proc.stderr.on("data", (d: any) => (cur.stderr += d.toString()));
			proc.on("close", (code: any) => {
				if (buf.trim()) onLine(buf);
				resolve(code ?? 0);
			});
			proc.on("error", () => resolve(1));
			if (signal) {
				const kill = () => {
					aborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) kill();
				else signal.addEventListener("abort", kill, { once: true });
			}
		});
		cur.exitCode = exitCode;
		if (aborted) throw new Error("Subagent was aborted");
		return cur;
	} finally {
		if (tmpFile)
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				/* ignore */
			}
		if (tmpDir)
			try {
				fs.rmdirSync(tmpDir);
			} catch {
				/* ignore */
			}
	}
}

// plain JSON-schema literal (TypeBox is plain JSON Schema; jiti strips the type
// constraint). Mirrors the sibling tools' parameter style — no Type import.
const SubagentParams = {
	type: "object",
	properties: {
		agent: {
			type: "string",
			description: "Name of the agent to invoke (single mode)",
		},
		task: { type: "string", description: "Task to delegate (single mode)" },
		tasks: {
			type: "array",
			description: "Array of {agent, task} for parallel execution",
			items: {
				type: "object",
				properties: {
					agent: { type: "string", description: "Name of the agent to invoke" },
					task: {
						type: "string",
						description: "Task to delegate to the agent",
					},
					cwd: {
						type: "string",
						description: "Working directory for the agent process",
					},
				},
			},
		},
		chain: {
			type: "array",
			description:
				"Array of {agent, task} for sequential execution; use {previous} in task text to receive the prior step's output",
			items: {
				type: "object",
				properties: {
					agent: { type: "string", description: "Name of the agent to invoke" },
					task: {
						type: "string",
						description: "Task; {previous} is replaced with prior output",
					},
					cwd: {
						type: "string",
						description: "Working directory for the agent process",
					},
				},
			},
		},
		cwd: {
			type: "string",
			description: "Working directory for the agent process (single mode)",
		},
	},
};

// ---- tier-model override (safeguard pattern: re-read each call) ----
// Config lives at ~/.pi/agent/subagent-tiers.json as { capable, implement,
// lookup } → "provider/model". Written by the webui sidebar via
// server.js GET/POST /api/subagent-tiers. Missing/unreadable/invalid → keep
// the TIERS defaults. ponytail: one read per call is fine; config changes take
// effect on the next subagent invocation, no restart.
function tierConfigPath(): string {
	const home = typeof os !== "undefined" && os.homedir ? os.homedir() : "";
	return path.join(home, ".pi", "agent", "subagent-tiers.json");
}
function readTierModels(): Record<string, string> {
	try {
		const raw = fs.readFileSync(tierConfigPath(), "utf-8");
		const cfg = JSON.parse(raw);
		if (cfg && typeof cfg === "object") {
			const out: Record<string, string> = {};
			for (const k of ["capable", "implement", "lookup"])
				if (typeof cfg[k] === "string" && cfg[k]) out[k] = cfg[k];
			return out;
		}
	} catch {
		/* missing/unreadable — fall back to TIERS defaults */
	}
	return {};
}
// Returns TIERS with each agent's model overridden by the live config (if set).
function activeTiers(): TierAgent[] {
	const overrides = readTierModels();
	if (!Object.keys(overrides).length) return TIERS;
	return TIERS.map((a) =>
		overrides[a.tier] ? { ...a, model: overrides[a.tier] } : a,
	);
}
// human-readable catalog. `agents` is the resolved list (live or defaults), so
// the tool description and the unknown-agent error both reflect current config.
function agentCatalog(agents: TierAgent[]): string {
	const tFor = (tier: "capable" | "implement" | "lookup") =>
		(agents.find((a) => a.tier === tier) || {}).model || "?";
	const names = (tier: "capable" | "implement" | "lookup") =>
		agents
			.filter((a) => a.tier === tier)
			.map((a) => a.name)
			.join("/");
	return [
		"Agents (tier → model):",
		`  capable ${tFor("capable")} (${names("capable")}) — planning, review, debugging`,
		`  implement ${tFor("implement")} (${names("implement")}) — implementation`,
		`  lookup ${tFor("lookup")} (${names("lookup")}) — lookups, summarization`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		// description is built once at load from the defaults (no I/O); execute()
		// re-reads the live config, so a sidebar change routes correctly next call
		// even though this text stays static until reload.
		description: [
			"Delegate a task to a specialized subagent running in an ISOLATED context on a tier-pinned model.",
			"Modes: single (agent + task), parallel (tasks[]), chain (chain[] with {previous} placeholder).",
			agentCatalog(TIERS),
		].join("\n"),
		promptSnippet:
			"Delegate to a subagent for planning, implementation, review, or lookup",
		promptGuidelines: [
			"Use subagent when a task's input is large but the answer is small: reading 3+ files to answer one question (scout/summarizer), tracing a bug across files (debugger), planning a multi-file change (planner), reviewing a diff (reviewer), or implementing a well-specified change (implementer).",
			"Do NOT use subagent for a single read/grep or anything you can answer inline — the subprocess round-trip isn't worth it. Delegate bounded tasks whose result is all you need back.",
			"Prefer context-mode (ctx_execute_file) over subagent when you are deriving a fact from ONE large file/log in-sandbox and want to stay in the loop; use subagent for multi-file exploration, reasoning, or any edit.",
			"Use subagent tasks[] (parallel) for independent lookups and chain[] when one step feeds the next (insert {previous}); a debugger→implementer chain turns a root-cause into an applied fix.",
		],
		parameters: SubagentParams,

		async execute(_id, _params, signal, _onUpdate, ctx) {
			const params = _params as Record<string, any>;
			const onUpdate = _onUpdate as OnUpdateCallback | undefined;
			// resolve the tier list ONCE per call: re-reads the config file so a
			// sidebar change takes effect immediately. Threaded into every runSingle.
			const agents = activeTiers();
			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({ mode, results });

			const hasChain = ((params.chain as any[] | undefined)?.length ?? 0) > 0;
			const hasTasks = ((params.tasks as any[] | undefined)?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);
			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Provide exactly one mode (agent+task | tasks | chain).\n${agentCatalog(agents)}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			// ---- chain ----
			if (params.chain && (params.chain as any[]).length > 0) {
				const results: SingleResult[] = [];
				let prev = "";
				for (let i = 0; i < (params.chain as any[]).length; i++) {
					const s = (params.chain as any[])[i];
					const task = String(s.task || "").replace(/\{previous\}/g, prev);
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const c = firstResult(partial.details);
								if (c)
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")([...results, c]),
									});
							}
						: undefined;
					const r = await runSingle(
						ctx.cwd,
						agents,
						s.agent,
						task,
						s.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(r);
					if (isFailed(r))
						return {
							content: [
								{
									type: "text",
									text: `Chain stopped at step ${i + 1} (${s.agent}): ${getResultOutput(r)}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					prev = getFinalOutput(r.messages);
				}
				const last = results[results.length - 1];
				return {
					content: [
						{
							type: "text",
							text: getFinalOutput(last.messages) || "(no output)",
						},
					],
					details: makeDetails("chain")(results),
				};
			}

			// ---- parallel ----
			if (params.tasks && (params.tasks as any[]).length > 0) {
				const tasks = params.tasks as any[];
				if (tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${tasks.length}). Max ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};
				const all: SingleResult[] = tasks.map((t) => ({
					agent: t.agent,
					task: t.task,
					exitCode: -1,
					messages: [],
					stderr: "",
					usage: {},
					turns: 0,
				}));
				const emitP = () =>
					onUpdate?.({
						content: [
							{
								type: "text",
								text: `Parallel: ${all.filter((r) => r.exitCode !== -1).length}/${all.length} done…`,
							},
						],
						details: makeDetails("parallel")([...all]),
					});
				const results = await mapLimit(
					tasks,
					MAX_CONCURRENCY,
					async (t, index) => {
						const r = await runSingle(
							ctx.cwd,
							agents,
							t.agent,
							t.task,
							t.cwd,
							undefined,
							signal,
							(partial) => {
								const c = firstResult(partial.details);
								if (c) {
									all[index] = c;
									emitP();
								}
							},
							makeDetails("parallel"),
						);
						all[index] = r;
						emitP();
						return r;
					},
				);
				const ok = results.filter((r) => !isFailed(r)).length;
				const sum = results
					.map(
						(r) =>
							`### [${r.agent}] ${isFailed(r) ? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}` : "completed"}\n\n${truncateCap(getResultOutput(r))}`,
					)
					.join("\n\n---\n\n");
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${ok}/${results.length} succeeded\n\n${sum}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			// ---- single ----
			const r = await runSingle(
				ctx.cwd,
				agents,
				params.agent as string,
				params.task as string,
				params.cwd as string | undefined,
				undefined,
				signal,
				onUpdate,
				makeDetails("single"),
			);
			if (isFailed(r))
				return {
					content: [
						{
							type: "text",
							text: `Agent ${r.stopReason || "failed"}: ${getResultOutput(r)}`,
						},
					],
					details: makeDetails("single")([r]),
					isError: true,
				};
			const usage = formatUsage(r.usage, r.model);
			const body = getFinalOutput(r.messages) || "(no output)";
			return {
				content: [
					{ type: "text", text: usage ? `${body}\n\n— _${usage}_` : body },
				],
				details: makeDetails("single")([r]),
			};
		},
	});
}
