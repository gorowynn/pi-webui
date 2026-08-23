/*
 * secondary-ux.js — pure browser helpers for transcript-free side questions.
 * Dual-mode: window.secondaryUx + CommonJS tests. No DOM or fetch.
 */
((root, factory) => {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.secondaryUx = factory();
})(typeof self === "undefined" ? this : self, () => {
	const STATES = Object.freeze({
		queued: { label: "queued", active: true },
		running: { label: "thinking…", active: true },
		completed: { label: "ready", active: false },
		failed: { label: "failed", active: false },
		cancelled: { label: "cancelled", active: false },
		expired: { label: "timed out", active: false },
	});
	const MAX_CONTEXT_CHARS = 64_000;
	const MAX_THREAD_TURNS = 8;

	function contentText(content) {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.filter(
				(part) => part && part.type === "text" && typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("");
	}

	function bounded(text, maxChars) {
		const value = String(text || "");
		const max =
			Number.isInteger(maxChars) && maxChars >= 0 ? maxChars : MAX_CONTEXT_CHARS;
		return value.length > max
			? { text: value.slice(0, max), truncated: true }
			: { text: value, truncated: false };
	}

	function contextSnapshot(messages, maxChars) {
		const rows = [];
		for (const message of Array.isArray(messages) ? messages : []) {
			if (!message || !["user", "assistant", "custom"].includes(message.role))
				continue;
			const text = contentText(message.content).trim();
			if (text) rows.push(`${message.role}: ${text}`);
		}
		return bounded(rows.join("\n\n"), maxChars);
	}

	function addTurn(thread, role, text, maxTurns) {
		const value = typeof text === "string" ? text.trim() : "";
		if (!value) return Array.isArray(thread) ? thread.slice() : [];
		const turns = Array.isArray(thread) ? thread.slice() : [];
		turns.push({
			role: role === "assistant" ? "assistant" : "user",
			text: value,
		});
		const max =
			Number.isInteger(maxTurns) && maxTurns > 0 ? maxTurns : MAX_THREAD_TURNS;
		return turns.slice(-max);
	}

	function stateMeta(status) {
		return STATES[status] || { label: status || "unknown", active: false };
	}

	function normalizeRun(run) {
		const source = run && typeof run === "object" ? run : {};
		const meta = stateMeta(source.status);
		return {
			id: typeof source.id === "string" ? source.id : "",
			kind: source.kind === "side-question" ? source.kind : "side-question",
			status: source.status in STATES ? source.status : "failed",
			label: meta.label,
			active: meta.active,
			result: source.result || null,
			error: source.error || null,
			inputTruncated: source.inputTruncated === true,
			outputTruncated: source.outputTruncated === true,
		};
	}

	function canCancel(run) {
		return !!run && !!stateMeta(run.status).active;
	}

	function canSubmit(run) {
		return !run || !stateMeta(run.status).active;
	}

	function shouldApplyRun(current, incoming) {
		const currentId = current && typeof current.id === "string" ? current.id : "";
		const incomingId =
			incoming && typeof incoming.id === "string" ? incoming.id : "";
		return (
			!currentId ||
			currentId === "pending" ||
			currentId === incomingId ||
			!canCancel(current)
		);
	}

	return {
		STATES,
		MAX_CONTEXT_CHARS,
		MAX_THREAD_TURNS,
		contentText,
		bounded,
		contextSnapshot,
		addTurn,
		stateMeta,
		normalizeRun,
		canCancel,
		canSubmit,
		shouldApplyRun,
	};
});
