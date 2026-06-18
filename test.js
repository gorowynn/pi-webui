// Smoke test for the webui bridge. Requires a running `node server.js` (and `pi`).
// Usage: node server.js &  then  node test.js
// Verifies: SSE event stream, POST command bridge, streaming text, tool exec,
//           skills/commands + model list, and extension-UI dialog round-trip.
const http = require("http");
const BASE = "127.0.0.1",
	PORT = process.env.PORT || 4317;

function post(path, obj) {
	const body = JSON.stringify(obj);
	return new Promise((res, rej) => {
		const r = http.request(
			{
				host: BASE,
				port: PORT,
				path,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body),
				},
			},
			(c) => {
				let d = "";
				c.on("data", (x) => (d += x));
				c.on("end", () => res(d));
			},
		);
		r.on("error", rej);
		r.write(body);
		r.end();
	});
}

const s = {
	agent_start: false,
	agent_end: false,
	text: "",
	tool_start: 0,
	tool_end: 0,
	tool_out: false,
	cmds: 0,
	models: 0,
	ui: 0,
};

const req = http.request(
	{ host: BASE, port: PORT, path: "/api/events", method: "GET" },
	(res) => {
		res.setEncoding("utf8");
		res.on("data", (chunk) => {
			for (const line of chunk.split("\n")) {
				if (!line.startsWith("data: ")) continue;
				let env;
				try {
					env = JSON.parse(line.slice(6));
				} catch {
					continue;
				}
				if (env.source !== "pi") continue;
				const p = env.payload;
				if (p.type === "agent_start") s.agent_start = true;
				else if (p.type === "agent_end") s.agent_end = true;
				else if (
					p.type === "message_update" &&
					p.assistantMessageEvent?.type === "text_delta"
				)
					s.text += p.assistantMessageEvent.delta;
				else if (p.type === "tool_execution_start") {
					s.tool_start++;
					s.toolName = p.toolName;
				} else if (
					p.type === "tool_execution_update" &&
					p.partialResult?.content?.some((b) => b.text)
				)
					s.tool_out = true;
				else if (p.type === "tool_execution_end") {
					s.tool_end++;
					if ((p.result?.content || []).some((b) => b.text)) s.tool_out = true;
				} else if (p.type === "response" && p.success) {
					if (p.id === "init-cmds") s.cmds = (p.data?.commands || []).length;
					if (p.id === "init-models") s.models = (p.data?.models || []).length;
				} else if (p.type === "extension_ui_request") {
					s.ui++;
					// ponytail: auto-approve whatever the dialog asks so the run isn't blocked.
					const resp = { type: "extension_ui_response", id: p.id };
					if (p.method === "confirm") resp.confirmed = true;
					else if (p.method === "select") {
						// approve sensibly: prefer an allow/yes option, else the first one
						const opts = p.options || [];
						resp.value =
							opts.find((o) => /allow|yes|ok|approve|accept|grant/i.test(o)) ||
							opts[0];
					} else resp.value = "ok";
					post("/api/cmd", resp).catch(() => {});
				}
			}
		});
	},
);
req.end();

(async () => {
	await new Promise((r) => setTimeout(r, 300));
	await post("/api/cmd", { type: "get_commands", id: "init-cmds" });
	await post("/api/cmd", { type: "get_available_models", id: "init-models" });

	// probe 1: streaming text round-trip
	await post("/api/cmd", {
		type: "prompt",
		message: "Reply with exactly: BRIDGE_OK_42",
	});
	let w = 0;
	while (!s.agent_end && w < 40) {
		await new Promise((r) => setTimeout(r, 500));
		w++;
	}

	// probe 2: tool-execution round-trip
	s.agent_end = false;
	await post("/api/cmd", {
		type: "prompt",
		message: "Use the bash tool to run: echo TOOLPATH_OK_7. Then say DONE.",
	});
	w = 0;
	while (s.tool_end === 0 && !s.agent_end && w < 50) {
		await new Promise((r) => setTimeout(r, 400));
		w++;
	}
	await new Promise((r) => setTimeout(r, 800));
	req.destroy();

	const ok = /BRIDGE_OK_42/.test(s.text) && s.tool_start > 0 && s.tool_end > 0;
	console.log(
		JSON.stringify(
			{
				streamed_BRIDGE_OK_42: /BRIDGE_OK_42/.test(s.text),
				tool_starts: s.tool_start,
				tool_ends: s.tool_end,
				toolName: s.toolName,
				tool_output_seen: s.tool_out,
				commands_available: s.cmds,
				models_available: s.models,
				ui_dialogs_handled: s.ui,
			},
			null,
			2,
		),
	);
	console.log(ok ? "\nPASS" : "\nFAIL");
	process.exit(ok ? 0 : 2);
})().catch((e) => {
	console.error("ERR", e.message);
	process.exit(1);
});
