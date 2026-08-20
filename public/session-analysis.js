/*
 * session-analysis.js — reconstructs cost/tool/token metrics from a message list.
 * Ported from pi-livecraft's session-analysis.ts + message-usage.ts (MIT), as a
 * dual-mode vanilla module (module.exports in Node, window.sessionAnalysis in the
 * browser) loaded before app.js. Plan 4.2 / F§4.2.
 *
 * The math is pure: given pi's public message contract (role/content/usage/
 * toolCallId) + the aggregate get_session_stats, it rebuilds requests (user→
 * assistant turns), per-turn usage, tool calls (with input/output sizes, error/
 * pending flags), per-tool rollups, and totals (total/average/median turn cost,
 * token & cache breakdown, context %). No UI here — that's the 4.3 widget.
 *
 * Telemetry (per-request/per-tool measured durations, in-flight tool executions)
 * is optional and currently passed as {} — the analysis degrades gracefully
 * (durations undefined). Wiring live durations is a later enhancement.
 */
(() => {
	// tool-protocol helpers (toolCallsInMessage / toolResultInMessage /
	// toolContentText / toolDataLength) — required in Node, global in browser.
	var tp =
		typeof require === "function"
			? require("./tool-protocol.js")
			: typeof window !== "undefined" && window.toolProtocol
				? window.toolProtocol
				: null;
	function calls(message) {
		return tp ? tp.toolCallsInMessage(message) : [];
	}
	function resultIn(message) {
		return tp ? tp.toolResultInMessage(message) : null;
	}
	function contentText(content) {
		return tp ? tp.toolContentText(content) : "";
	}
	function dataLength(value) {
		return tp ? tp.toolDataLength(value) : 0;
	}

	function isObject(v) {
		return typeof v === "object" && v !== null && !Array.isArray(v);
	}
	function isNumber(v) {
		return typeof v === "number" && Number.isFinite(v);
	}
	function finiteNumber(v) {
		return isNumber(v) ? v : undefined;
	}

	// ---- usage records ----
	function emptyUsage() {
		return { cacheMiss: 0, cacheRead: 0, cacheWrite: 0, cost: 0, output: 0 };
	}
	// Extracts the billed counters from a pi response/toolResult message, or null.
	// cacheMiss = usage.input (tokens NOT served from cache); cacheRead = cached.
	function messageUsage(message) {
		var usage =
			isObject(message) && isObject(message.usage) ? message.usage : null;
		var cost = usage && isObject(usage.cost) ? usage.cost : null;
		if (
			!usage ||
			!cost ||
			!isNumber(usage.input) ||
			!isNumber(usage.cacheRead) ||
			!isNumber(usage.output) ||
			!isNumber(cost.total)
		)
			return null;
		return {
			cacheMiss: usage.input,
			cacheRead: usage.cacheRead,
			cacheWrite: isNumber(usage.cacheWrite) ? usage.cacheWrite : 0,
			cost: cost.total,
			output: usage.output,
		};
	}
	function addUsage(target, usage) {
		target.cacheMiss += usage.cacheMiss;
		target.cacheRead += usage.cacheRead;
		target.cacheWrite += usage.cacheWrite;
		target.cost += usage.cost;
		target.output += usage.output;
		return target;
	}
	// Aggregate stats.tokens → MessageUsage, or null when unavailable.
	function statsUsage(stats) {
		if (!stats) return null;
		var tokens = isObject(stats.tokens) ? stats.tokens : null;
		if (!tokens) return null;
		var cacheMiss = finiteNumber(tokens.input);
		var cacheRead = finiteNumber(tokens.cacheRead);
		var cacheWrite = finiteNumber(tokens.cacheWrite);
		var output = finiteNumber(tokens.output);
		if (
			cacheMiss === undefined ||
			cacheRead === undefined ||
			cacheWrite === undefined ||
			output === undefined
		)
			return null;
		return {
			cacheMiss: cacheMiss,
			cacheRead: cacheRead,
			cacheWrite: cacheWrite,
			cost: finiteNumber(stats.cost) || 0,
			output: output,
		};
	}
	// Each assistant turn → its billed usage (used for the per-turn cost series).
	function turnUsageByMessage(messages) {
		var out = new Map();
		for (var i = 0; i < messages.length; i++) {
			var m = messages[i];
			if (m.role !== "assistant") continue;
			var usage = messageUsage(m);
			if (usage) out.set(i, usage);
		}
		return out;
	}

	function messageTitle(message) {
		var content = message.content;
		var text = "";
		if (typeof content === "string") text = content;
		else if (Array.isArray(content)) {
			var parts = [];
			for (var i = 0; i < content.length; i++) {
				var part = content[i];
				if (
					isObject(part) &&
					part.type === "text" &&
					typeof part.text === "string"
				)
					parts.push(part.text);
			}
			text = parts.join(" ");
		}
		var normalized = text.replace(/\s+/g, " ").trim();
		return normalized.length > 90
			? normalized.slice(0, 89) + "…"
			: normalized || "Untitled request";
	}

	function quantile(sortedValues, proportion) {
		if (sortedValues.length === 0) return 0;
		var idx = Math.max(0, Math.ceil(sortedValues.length * proportion) - 1);
		return sortedValues[idx] || 0;
	}

	function summarizeTools(toolCalls) {
		var summaries = new Map();
		for (var i = 0; i < toolCalls.length; i++) {
			var call = toolCalls[i];
			var summary = summaries.get(call.name);
			if (!summary) {
				summary = {
					name: call.name,
					count: 0,
					failed: 0,
					inputLength: 0,
					outputLength: 0,
					durationMs: 0,
					measuredDurationCount: 0,
				};
				summaries.set(call.name, summary);
			}
			summary.count += 1;
			summary.failed += call.isError ? 1 : 0;
			summary.inputLength += call.inputLength;
			summary.outputLength += call.outputLength;
			if (call.durationMs !== undefined) {
				summary.durationMs += call.durationMs;
				summary.measuredDurationCount += 1;
			}
		}
		var arr = [];
		summaries.forEach((s) => {
			arr.push(s);
		});
		arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
		return arr;
	}

	// Reconstructs assistant turns, user cycles, and tool calls from pi's contract.
	// messages: [{role, content, usage?, toolCallId?, ...}]. stats: get_session_stats
	// output. running: agent currently active (last request not yet complete).
	// telemetry: optional {requestDurations:Map, toolDurations:Map, toolExecutions:[]}.
	function analyzeSession(messages, stats, running, telemetry) {
		telemetry = telemetry || {};
		var requestDurations = telemetry.requestDurations; // Map<msgTimestampMs, ms>
		var toolDurations = telemetry.toolDurations; // Map<callId, ms>
		var toolExecutions = telemetry.toolExecutions || [];

		// index tool results by callId for output-length / error lookups
		var resultsByCallId = new Map();
		for (var ri = 0; ri < messages.length; ri++) {
			var result = resultIn(messages[ri]);
			if (result) resultsByCallId.set(result.toolCallId, result);
		}
		var executionsByCallId = new Map();
		for (var ei = 0; ei < toolExecutions.length; ei++) {
			executionsByCallId.set(toolExecutions[ei].id, toolExecutions[ei]);
		}

		var requests = [];
		var seenToolCallIds = new Set();
		var currentRequest;

		for (var i = 0; i < messages.length; i++) {
			var message = messages[i];
			if (message.role === "user") {
				currentRequest = {
					messageIndex: i,
					title: messageTitle(message),
					cost: 0,
					usage: emptyUsage(),
					modelCallCount: 0,
					toolCalls: [],
					failedToolCalls: 0,
					complete: true,
					durationMs:
						typeof message.timestamp === "number"
							? requestDurations
								? requestDurations.get(message.timestamp)
								: undefined
							: undefined,
				};
				requests.push(currentRequest);
				continue;
			}
			if (!currentRequest) continue;

			if (message.role === "assistant") {
				var usage = messageUsage(message);
				if (usage) {
					addUsage(currentRequest.usage, usage);
					currentRequest.modelCallCount += 1;
				}
				var callsIn = calls(message);
				for (var ci = 0; ci < callsIn.length; ci++) {
					var call = callsIn[ci];
					var execution = executionsByCallId.get(call.id);
					var result =
						resultsByCallId.get(call.id) ||
						(execution ? execution.result : undefined);
					currentRequest.toolCalls.push({
						id: call.id,
						name: call.name,
						requestMessageIndex: currentRequest.messageIndex,
						turnMessageIndex: i,
						inputLength: dataLength(call.args),
						outputLength: result ? contentText(result.content).length : 0,
						isError: result ? result.isError === true : false,
						pending: result === undefined,
						durationMs: toolDurations ? toolDurations.get(call.id) : undefined,
					});
					seenToolCallIds.add(call.id);
				}
				continue;
			}

			if (message.role === "toolResult") {
				var tu = messageUsage(message);
				if (tu) addUsage(currentRequest.usage, tu);
			}
		}

		// in-flight tool calls not yet in any assistant message (live turn)
		var activeRequest = requests.length ? requests[requests.length - 1] : null;
		if (!activeRequest) {
			activeRequest = {
				messageIndex: -1,
				title: "Request in progress",
				cost: 0,
				usage: emptyUsage(),
				modelCallCount: 0,
				toolCalls: [],
				failedToolCalls: 0,
				complete: false,
			};
		}
		for (var tx = 0; tx < toolExecutions.length; tx++) {
			var ex = toolExecutions[tx];
			if (seenToolCallIds.has(ex.id)) continue;
			activeRequest.toolCalls.push({
				id: ex.id,
				name: ex.name,
				requestMessageIndex: activeRequest.messageIndex,
				inputLength: dataLength(ex.args),
				outputLength: ex.result ? contentText(ex.result.content).length : 0,
				isError: ex.result ? ex.result.isError === true : false,
				pending: ex.result === undefined,
				durationMs: toolDurations ? toolDurations.get(ex.id) : undefined,
			});
			seenToolCallIds.add(ex.id);
		}
		if (
			activeRequest.messageIndex === -1 &&
			activeRequest.toolCalls.length > 0
		) {
			requests.push(activeRequest);
		}

		// finalize per-request cost/flags
		for (var fi = 0; fi < requests.length; fi++) {
			var req = requests[fi];
			req.cost = req.usage.cost;
			req.failedToolCalls = 0;
			for (var tc = 0; tc < req.toolCalls.length; tc++) {
				if (req.toolCalls[tc].isError) req.failedToolCalls++;
			}
			req.complete = fi < requests.length - 1 || !running;
		}

		var toolCalls = [];
		for (var r = 0; r < requests.length; r++) {
			for (var t = 0; t < requests[r].toolCalls.length; t++) {
				toolCalls.push(requests[r].toolCalls[t]);
			}
		}
		var attributedCost = 0;
		for (var ac = 0; ac < requests.length; ac++)
			attributedCost += requests[ac].cost;

		var statsCost = finiteNumber(stats ? stats.cost : undefined);
		var attributionAvailable = false;
		for (var aa = 0; aa < requests.length; aa++) {
			if (requests[aa].modelCallCount > 0) {
				attributionAvailable = true;
				break;
			}
		}
		var totalCost = statsCost !== undefined ? statsCost : attributedCost;

		// per-turn series
		var turnMap = turnUsageByMessage(messages);
		var turns = [];
		var turnIdx = 0;
		turnMap.forEach((usage, messageIndex) => {
			turnIdx++;
			turns.push({
				messageIndex: messageIndex,
				number: turnIdx,
				cost: usage.cost,
				usage: usage,
				toolCallCount: calls(messages[messageIndex] || {}).length,
			});
		});
		var turnCosts = turns.map((turn) => turn.cost).sort((a, b) => a - b);

		var parsedUsage = emptyUsage();
		for (var pu = 0; pu < requests.length; pu++)
			addUsage(parsedUsage, requests[pu].usage);
		var sTokens = statsUsage(stats);
		var tokens = sTokens || parsedUsage;

		var totalToolCalls = Math.max(
			stats && stats.toolCalls ? stats.toolCalls : 0,
			toolCalls.length,
		);

		return {
			requests: requests,
			turns: turns,
			toolCalls: toolCalls,
			tools: summarizeTools(toolCalls),
			totalCost: totalCost,
			costAvailable: statsCost !== undefined || attributionAvailable,
			attributedCost: attributedCost,
			attributionAvailable: attributionAvailable,
			unattributedCost:
				statsCost !== undefined && attributionAvailable
					? Math.max(0, totalCost - attributedCost)
					: 0,
			averageTurnCost: turnCosts.length
				? turnCosts.reduce((t, c) => t + c, 0) / turnCosts.length
				: 0,
			medianTurnCost: quantile(turnCosts, 0.5),
			turnCount: turnCosts.length,
			averageToolCallsPerTurn: turnCosts.length
				? totalToolCalls / turnCosts.length
				: 0,
			totalToolCalls: totalToolCalls,
			failedToolCalls: toolCalls.filter((c) => c.isError).length,
			contextPercent:
				stats && stats.contextUsage
					? finiteNumber(stats.contextUsage.percent)
					: undefined,
			tokens: tokens,
			tokensAvailable: sTokens !== null || attributionAvailable,
		};
	}

	// ---- formatters (UI-facing; navigator guarded for Node) ----
	function formatTurnCost(value) {
		var digits = value < 0.01 ? 4 : 2;
		var s = Number(value).toFixed(digits);
		return "$" + s;
	}
	function formatTokens(value) {
		if (!isNumber(value)) return "0";
		var abs = Math.abs(value);
		if (abs >= 1000000000) return Math.round(value / 1000000000) + "B";
		if (abs >= 1000000) return Math.round(value / 1000000) + "M";
		if (abs >= 1000) return Math.round(value / 1000) + "k";
		return String(Math.round(value));
	}
	function formatDuration(value) {
		if (value < 1000) return Math.round(value) + " ms";
		var locale =
			typeof navigator !== "undefined" && navigator.language
				? navigator.language
				: "en-US";
		return (
			(value / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }) + " s"
		);
	}

	var api = {
		analyzeSession: analyzeSession,
		messageUsage: messageUsage,
		turnUsageByMessage: turnUsageByMessage,
		statsUsage: statsUsage,
		formatTurnCost: formatTurnCost,
		formatTokens: formatTokens,
		formatDuration: formatDuration,
		emptyUsage: emptyUsage,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.sessionAnalysis = api;
})();
