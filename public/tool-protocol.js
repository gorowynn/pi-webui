/*
 * tool-protocol.js — robust extraction of tool calls/results from pi's message
 * format. Ported from pi-livecraft's tool-protocol.ts (MIT), vanilla JS.
 *
 * The headline win is toolContentText(): flattens arbitrary tool output to a
 * string, handling nested content arrays ({content:{content:[...]}}) that our
 * old inline .filter().join() silently dropped. Adopted at every result-text
 * extraction site (plan 2.7 / R§2.9).
 *
 * The streaming-tracking functions (toolCallInUpdate / applyToolCallUpdate /
 * interruptToolCallGeneration) are ported as infrastructure for tracking
 * generating tool calls by contentIndex with an 'interrupted' state — NOT yet
 * wired into the SSE path (our tool calls render in their own box via
 * tool_execution_start, never inline), so the smuggle channels are untouched.
 *
 * Require-able in Node (module.exports) for tests, like md.js. Sets
 * window.toolProtocol in the browser. Plan 2.7 / R§2.9 (toolContentText) + 4.2
 * (toolDataLength).
 */
(function () {
	"use strict";

	function isObject(v) {
		return typeof v === "object" && v !== null && !Array.isArray(v);
	}

	// ---- tool calls in a message (replay args source) ----
	function toolCallFromValue(value) {
		if (
			!isObject(value) ||
			value.type !== "toolCall" ||
			typeof value.id !== "string" ||
			typeof value.name !== "string"
		)
			return null;
		return { id: value.id, name: value.name, args: value.arguments };
	}
	// Every tool call embedded in an assistant message's content array.
	function toolCallsInMessage(message) {
		if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content))
			return [];
		var out = [];
		for (var i = 0; i < message.content.length; i++) {
			var call = toolCallFromValue(message.content[i]);
			if (call) out.push(call);
		}
		return out;
	}

	// ---- tool result validation ----
	// Picks out a validated tool result from a toolResult message, or null.
	function toolResultInMessage(message) {
		if (
			!isObject(message) ||
			message.role !== "toolResult" ||
			typeof message.toolCallId !== "string" ||
			typeof message.toolName !== "string"
		)
			return null;
		return {
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content: message.content,
			isError: message.isError === true,
			details: message.details,
		};
	}

	// ---- partial-result validation (tool_execution_update) ----
	function toolExecutionUpdateInEvent(event) {
		if (
			!isObject(event) ||
			event.type !== "tool_execution_update" ||
			typeof event.toolCallId !== "string" ||
			typeof event.toolName !== "string"
		)
			return null;
		var partial = event.partialResult;
		if (!isObject(partial)) return null;
		return {
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			partialResult: {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				content: partial.content,
				isError: false,
				details: isObject(partial.details) ? partial.details : undefined,
			},
		};
	}

	// ---- THE headline: flatten arbitrary tool output to text ----
	// Handles string content, {content: X} nesting, and [text parts] arrays.
	// Our old inline extraction assumed content was always an array and dropped
	// nested shapes; this is robust to both.
	function toolContentText(content) {
		if (content == null) return "";
		if (typeof content === "string") return content;
		if (isObject(content) && "content" in content)
			return toolContentText(content.content);
		if (!Array.isArray(content)) return "";
		var parts = [];
		for (var i = 0; i < content.length; i++) {
			var part = content[i];
			if (isObject(part) && part.type === "text" && typeof part.text === "string")
				parts.push(part.text);
		}
		return parts.join("\n");
	}

	// ---- streaming tool-call tracking (infrastructure; not yet wired) ----
	// Tracks generating tool calls by contentIndex across toolcall_start/delta/
	// end, marking 'interrupted' when generation ends with no end event. Kept for
	// a future inline-render mode; the current box renderer uses
	// tool_execution_start, so these are dormant.
	function toolCallFromPartial(value, contentIndex) {
		if (!isObject(value) || !Array.isArray(value.content)) return null;
		return toolCallFromValue(value.content[contentIndex]);
	}
	function toolCallInUpdate(event) {
		if (!isObject(event) || event.type !== "message_update" || !isObject(event.assistantMessageEvent))
			return null;
		var update = event.assistantMessageEvent;
		if (
			update.type !== "toolcall_start" &&
			update.type !== "toolcall_delta" &&
			update.type !== "toolcall_end"
		)
			return null;
		if (!Number.isSafeInteger(update.contentIndex) || update.contentIndex < 0) return null;
		var call =
			update.type === "toolcall_end"
				? toolCallFromValue(update.toolCall)
				: toolCallFromPartial(update.partial, update.contentIndex);
		if (!call) return null;
		return {
			call: call,
			contentIndex: update.contentIndex,
			delta:
				update.type === "toolcall_delta" && typeof update.delta === "string"
					? update.delta
					: "",
			phase:
				update.type === "toolcall_start"
					? "start"
					: update.type === "toolcall_delta"
						? "delta"
						: "end",
		};
	}

	// Length of a tool call's arguments (serialized) — a size proxy for analysis.
	function toolDataLength(value) {
		try {
			var s = JSON.stringify(value);
			return s != null ? s.length : String(value).length;
		} catch (e) {
			return String(value).length;
		}
	}

	var api = {
		toolCallsInMessage: toolCallsInMessage,
		toolResultInMessage: toolResultInMessage,
		toolExecutionUpdateInEvent: toolExecutionUpdateInEvent,
		toolContentText: toolContentText,
		toolDataLength: toolDataLength,
		toolCallInUpdate: toolCallInUpdate,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.toolProtocol = api;
})();
