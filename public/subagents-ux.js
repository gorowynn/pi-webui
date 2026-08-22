/*
 * subagents-ux.js — pure render helpers for the pi-subagents async fleet page
 * + the plugin's custom-message notices (completion / steering / control).
 * Dual-mode (GOTCHAS #20): browser IIFE exposing window.subagentsUx, Node
 * require() for tests. No DOM access, no fetch — strings in, HTML strings out.
 *
 * Data shapes (server projection from the plugin's status.json — see
 * subagents.js): {id, runId, state, mode, description, startedAt, endedAt,
 * error, currentTool, currentPath, turnCount, toolCount, steps:[{index, agent,
 * status, description, phase, label}], stepsTotal, runningSteps,
 * completedSteps, stepsTruncated}.
 *
 * Notices: custom messages with customType "subagent-notify" (details
 * {agent,status,taskInfo,durationMs,resultPreview,sessionLabel,sessionValue}),
 * "subagent_steering_notice", "subagent_control_notice" (content string).
 */
((root, factory) => {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.subagentsUx = factory();
})(typeof self !== "undefined" ? self : this, () => {
	// esc(): window.esc from md.js (loads first in the browser); in Node tests
	// require the shim directly (md.js is require-able by design).
	var esc =
		typeof window !== "undefined" && window.esc
			? window.esc
			: typeof require === "function" && require("./md.js").esc;

	var STATES = {
		queued: { label: "queued", cls: "queued" },
		running: { label: "running", cls: "running" },
		paused: { label: "paused", cls: "paused" },
		complete: { label: "done", cls: "done" },
		failed: { label: "failed", cls: "failed" },
		stopped: { label: "stopped", cls: "stopped" },
		rejected: { label: "rejected", cls: "rejected" },
	};
	var ACTIVE = { queued: 1, running: 1, paused: 1 };

	function stateMeta(state) {
		return STATES[state] || { label: state || "?", cls: "unknown" };
	}
	function isActive(state) {
		return !!ACTIVE[state];
	}

	function fmtDur(ms) {
		if (!ms || ms < 0) return "";
		var s = Math.floor(ms / 1000);
		if (s < 60) return s + "s";
		var m = Math.floor(s / 60);
		if (m < 60) return m + "m" + (s % 60 ? " " + (s % 60) + "s" : "");
		var h = Math.floor(m / 60);
		return h + "h " + (m % 60) + "m";
	}

	var NOTICE_TYPES = {
		"subagent-notify": 1,
		subagent_steering_notice: 1,
		subagent_control_notice: 1,
	};
	function isSubagentNotice(customType) {
		return !!NOTICE_TYPES[customType];
	}

	// ---- notices (custom messages) ----

	// Content fallback, mirroring the plugin's own parseSubagentNotifyContent
	// (notify.ts): details are absent on some delivery paths, so the status has
	// to come from the markdown itself — otherwise every notice paints red.
	function parseNotifyContent(content) {
		if (typeof content !== "string") return null;
		var lines = content.split("\n");
		var head = (lines[0] || "").trim();
		var m = head.match(
			/^(?:Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*(?:\s+\(([^)]*)\))?$/,
		);
		if (m)
			return {
				status: m[1],
				agent: m[2],
				taskInfo: m[3],
				body: bodyLine(lines),
			};
		m = head.match(
			/^Background tasks (completed|failed|paused|stopped) \((\d+)\): (.+)$/,
		);
		if (m) {
			var agents = [];
			var re = /\*\*(.+?)\*\*/g;
			var b;
			while ((b = re.exec(m[3]))) agents.push(b[1]);
			return {
				status: m[1],
				agent: agents.join(", ") || m[3],
				taskInfo: "(" + m[2] + ")",
				body: bodyLine(lines),
			};
		}
		return null;
	}
	function bodyLine(lines) {
		for (var i = 2; i < lines.length; i++) {
			var t = lines[i] ? lines[i].trim() : "";
			if (t && t !== "(no output)") return t;
		}
		return "";
	}

	function notifyHtml(msg) {
		var parsed =
			!msg.details && typeof msg.content === "string"
				? parseNotifyContent(msg.content)
				: null;
		var d = msg.details || parsed || {};
		var icon = "⇄";
		var cls = "none";
		if (d.status === "completed") {
			icon = "✓";
			cls = "ok";
		} else if (d.status === "paused" || d.status === "stopped") {
			icon = "■";
			cls = "warn";
		} else if (d.status === "failed") {
			icon = "✗";
			cls = "err";
		}
		var head = esc(d.agent || "subagent") + " · " + esc(d.status || "?");
		if (d.taskInfo) head += " · " + esc(d.taskInfo);
		if (typeof d.durationMs === "number") head += " · " + fmtDur(d.durationMs);
		var body = "";
		var preview =
			typeof d.resultPreview === "string" ? d.resultPreview.trim() : "";
		if (preview) body = esc(preview.split("\n")[0] || "").slice(0, 200);
		if (!body && d.body) body = esc(String(d.body).slice(0, 200));
		if (!body && !parsed && typeof msg.content === "string")
			body = esc(msg.content.replace(/\*\*/g, "").split("\n")[0] || "").slice(
				0,
				200,
			);
		var foot =
			d.sessionLabel && d.sessionValue
				? '<div class="sa-note-foot">' +
					esc(d.sessionLabel + ": " + d.sessionValue) +
					"</div>"
				: "";
		return (
			'<div class="sa-note sa-note-' +
			cls +
			'"><span class="sa-note-ic">' +
			icon +
			'</span><div><div class="sa-note-head">' +
			head +
			"</div>" +
			(body ? '<div class="sa-note-body">' + body + "</div>" : "") +
			foot +
			"</div></div>"
		);
	}

	function simpleNoticeHtml(msg, cls) {
		var text =
			typeof msg.content === "string" && msg.content.trim()
				? msg.content.trim()
				: "subagent " + (msg.customType || "");
		return (
			'<div class="sa-note sa-note-' +
			cls +
			'"><span class="sa-note-ic">⇄</span><div><div class="sa-note-body">' +
			esc(text.split("\n")[0]) +
			"</div></div></div>"
		);
	}

	// entry point for renderMessage / message_end custom handling
	function noticeHtml(msg) {
		if (!msg || msg.role !== "custom" || !isSubagentNotice(msg.customType))
			return "";
		if (msg.customType === "subagent-notify") return notifyHtml(msg);
		if (msg.customType === "subagent_steering_notice")
			return simpleNoticeHtml(msg, "warn");
		return simpleNoticeHtml(msg, "warn");
	}

	// ---- fleet page ----

	function stepHtml(st, runId, idx) {
		var m = stateMeta(st.status === "completed" ? "complete" : st.status);
		var desc = st.description || st.phase || st.label || "";
		// idx = row-position fallback: workflow steps carry no `index`, and the
		// server correlates the step-log button by POSITION (steps[n]).
		var n = st.index != null ? st.index : idx;
		var out =
			esc((n != null ? n + " " : "") + (st.agent || "?")) +
			' <span class="fl-chip fl-' +
			m.cls +
			'">' +
			m.label +
			"</span>";
		if (desc)
			out +=
				' <span class="fl-step-desc">' + esc(desc).slice(0, 160) + "</span>";
		if (st.status === "running" || st.status === "complete")
			out +=
				' <button class="fl-log-btn" data-id="' +
				esc(runId) +
				'" data-step="' +
				(n != null ? n : 0) +
				'">log</button>';
		return '<div class="fl-step">' + out + "</div>";
	}

	function runRowHtml(run) {
		var steps = run.steps || [];
		var failN = steps.filter(
			(s) =>
				s.status === "failed" ||
				s.status === "stopped" ||
				s.status === "rejected",
		).length;
		// the plugin reports state "complete" even when every child failed (the
		// workflow itself finished) — don't paint that green.
		var allFailed = steps.length > 0 && failN === steps.length;
		var stopping = !!run.stopRequested;
		var m = stopping
			? { label: "stopping", cls: "paused" }
			: allFailed
				? stateMeta("failed")
				: stateMeta(run.state);
		var active = isActive(run.state);
		var agents = steps
			.map((s) => s.agent)
			.filter((v, i, a) => a.indexOf(v) === i)
			.join(" ");
		var elapsed = fmtDur(
			(run.endedAt || Date.now()) - (run.startedAt || Date.now()),
		);
		var meta = [];
		if (run.mode) meta.push(esc(run.mode));
		if (agents) meta.push(esc(agents).slice(0, 120));
		if (elapsed) meta.push(elapsed);
		if (run.turnCount != null) meta.push("⟳ " + run.turnCount);
		if (failN > 0 && !allFailed) meta.push(failN + "✗");
		if (run.currentTool && active) meta.push("⌨ " + esc(run.currentTool));
		var head =
			'<div class="fl-row-head">' +
			'<span class="fl-id" title="' +
			esc(run.runId || run.id) +
			'">' +
			esc((run.description || agents || run.id || "?").slice(0, 80)) +
			"</span>" +
			'<span class="fl-chip fl-' +
			m.cls +
			'">' +
			m.label +
			"</span>" +
			'<span class="fl-meta">' +
			meta.join(" · ") +
			"</span>";
		if (active)
			head +=
				'<span class="fl-actions">' +
				'<button class="fl-stop" data-id="' +
				esc(run.id) +
				'" data-force="' +
				(stopping ? "1" : "") +
				'">' +
				(stopping ? "force stop" : "stop") +
				"</button>" +
				"</span>";
		head += "</div>";
		var body = (run.steps || [])
			.map((st, i) => stepHtml(st, run.id, i))
			.join("");
		if (run.stepsTruncated) body += '<div class="fl-step fl-more">…</div>';
		if (run.error)
			body +=
				'<div class="fl-err">' +
				esc(String(run.error).slice(0, 300)) +
				"</div>";
		if (!active)
			head +=
				'<button class="fl-log-btn fl-log-run" data-id="' +
				esc(run.id) +
				'" data-kind="run">run log</button>';
		return (
			'<div class="fl-row" data-id="' +
			esc(run.id) +
			'">' +
			head +
			(body ? '<div class="fl-steps">' + body + "</div>" : "") +
			'<pre class="fl-log" hidden></pre>' +
			"</div>"
		);
	}

	function fleetHtml(runs, emptyHint) {
		if (!runs || !runs.length)
			return (
				'<div class="fl-empty">' +
				esc(emptyHint || "no background subagent runs") +
				"</div>"
			);
		return runs.map(runRowHtml).join("");
	}

	// ui-density-navigation FR-41..47/49/59: pure prioritized fleet projection —
	// active/stopping first, failed second, completed history behind a
	// disclosure; summary counts, status+text filters (case-insensitive),
	// steering-target reconciliation, and bounded failure text. Never mutates
	// the input runs (the caller renders from the returned view).
	function fleetView(runs, opts) {
		var o = opts || {};
		var list = Array.isArray(runs) ? runs.slice() : [];
		var isStopping = (r) => isActive(r.state) && !!r.stopRequested;
		var counts = { active: 0, stopping: 0, failed: 0, completed: 0 };
		for (var i = 0; i < list.length; i++) {
			var r = list[i];
			if (isStopping(r)) counts.stopping++;
			else if (isActive(r.state)) counts.active++;
			else if (r.state === "failed") counts.failed++;
			else counts.completed++;
		}
		var q = String(o.textFilter || "")
			.trim()
			.toLowerCase();
		var textOf = (r) =>
			[
				r.description,
				r.id,
				r.runId,
				r.error,
				(r.steps || []).map((s) => s.description),
			]
				.filter(Boolean)
				.join(" ")
				.toLowerCase();
		var statusOk = (r) => {
			if (!o.statusFilter || o.statusFilter === "all") return true;
			if (o.statusFilter === "active") return isActive(r.state);
			if (o.statusFilter === "failed") return r.state === "failed";
			return !isActive(r.state) && r.state !== "failed";
		};
		var filtered = list.filter(
			(r) => statusOk(r) && (!q || textOf(r).includes(q)),
		);
		var newestFirst = (a) =>
			a.slice().sort((x, y) => (y.startedAt || 0) - (x.startedAt || 0));
		var stopping = newestFirst(filtered.filter((r) => isStopping(r)));
		var active = newestFirst(
			filtered.filter((r) => isActive(r.state) && !isStopping(r)),
		);
		var failed = newestFirst(filtered.filter((r) => r.state === "failed"));
		var history = newestFirst(
			filtered.filter((r) => !isActive(r.state) && r.state !== "failed"),
		);
		var actives = stopping.concat(active);
		var steerable = null;
		if (o.selectedRunId) {
			if (actives.some((r) => r.id === o.selectedRunId))
				steerable = o.selectedRunId;
		} else if (actives.length === 1) steerable = actives[0].id;
		var now = typeof o.now === "number" ? o.now : Date.now();
		return {
			rows: actives.concat(failed),
			history: history,
			historyExpanded: !!o.historyExpanded,
			counts: counts,
			filteredCounts: {
				active: actives.length,
				failed: failed.length,
				completed: history.length,
			},
			steerableId: steerable,
			empty: list.length === 0,
			stale:
				typeof o.fetchedAt === "number" &&
				now - o.fetchedAt > (o.staleMs || 30000),
		};
	}

	/** FR-45: bounded failure reason — first line, ≤160 chars; empty when the
	 *  run carries no error (the UI shows a generic failed state, not invented
	 *  detail). */
	function failureSummary(run) {
		var e = String((run && run.error) || "").trim();
		if (!e) return "";
		var first = e.split("\n")[0];
		return first.length > 160 ? first.slice(0, 160) + " …" : first;
	}

	return {
		isSubagentNotice: isSubagentNotice,
		noticeHtml: noticeHtml,
		fleetHtml: fleetHtml,
		fleetView: fleetView,
		failureSummary: failureSummary,
		fmtDur: fmtDur,
		isActive: isActive,
		stateMeta: stateMeta,
	};
});
