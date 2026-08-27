/*
 * advisor-ux.js — pure browser projections for isolated advisor reviews.
 * Dual-mode: window.advisorUx + CommonJS tests. No DOM or fetch.
 */
((root, factory) => {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.advisorUx = factory();
})(typeof self === "undefined" ? this : self, () => {
	const SOURCE_KINDS = Object.freeze([
		"draft",
		"assistant-turn",
		"request-context",
	]);
	const SOURCE_LABELS = Object.freeze({
		draft: "draft",
		"assistant-turn": "assistant turn",
		"request-context": "request context",
	});
	const STATES = Object.freeze({
		queued: { label: "queued", active: true },
		running: { label: "reviewing…", active: true },
		completed: { label: "review ready", active: false },
		failed: { label: "review failed", active: false },
		cancelled: { label: "review cancelled", active: false },
		expired: { label: "review timed out", active: false },
	});
	const VERDICTS = Object.freeze({
		proceed: { label: "proceed", tone: "ok" },
		revise: { label: "revise", tone: "warn" },
		stop: { label: "stop", tone: "danger" },
		unavailable: { label: "unavailable", tone: "muted" },
	});
	const MAX_CONTEXT_CHARS = 64_000;
	const MAX_RESULT_ITEMS = 8;
	const MAX_ITEM_CHARS = 500;

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
		const value = typeof text === "string" ? text : "";
		const max =
			Number.isInteger(maxChars) && maxChars >= 0
				? maxChars
				: MAX_CONTEXT_CHARS;
		return value.length > max
			? { text: value.slice(0, max), truncated: true }
			: { text: value, truncated: false };
	}

	function normalizeSource(kind, text, id, maxChars) {
		if (!SOURCE_KINDS.includes(kind)) return null;
		const value = typeof text === "string" ? text.trim() : "";
		if (!value) return null;
		const out = bounded(value, maxChars);
		return {
			kind,
			label: SOURCE_LABELS[kind],
			id: typeof id === "string" && id ? id : null,
			text: out.text,
			truncated: out.truncated,
		};
	}

	function sourceFromMessages(messages, kind, maxChars) {
		const list = Array.isArray(messages) ? messages : [];
		if (kind === "assistant-turn") {
			for (let i = list.length - 1; i >= 0; i--) {
				const message = list[i];
				if (!message || message.role !== "assistant") continue;
				const text = contentText(message.content);
				const source = normalizeSource(
					kind,
					text,
					message.id || message.messageId,
					maxChars,
				);
				if (source) return source;
			}
			return null;
		}
		if (kind !== "request-context") return null;
		const rows = [];
		for (const message of list) {
			if (!message || !["user", "assistant", "custom"].includes(message.role))
				continue;
			const text = contentText(message.content).trim();
			if (text) rows.push(`${message.role}: ${text}`);
		}
		return normalizeSource(kind, rows.join("\n\n"), null, maxChars);
	}

	function requestPayload(source, model, requestId) {
		if (!source || !source.kind || !source.text || typeof requestId !== "string")
			return null;
		const body = {
			kind: "advisor",
			requestId,
			sourceKind: source.kind,
			source: { id: source.id || null, text: source.text },
		};
		if (
			model &&
			typeof model.provider === "string" &&
			typeof model.modelId === "string"
		)
			body.model = { provider: model.provider, modelId: model.modelId };
		return body;
	}

	function stateMeta(status) {
		return STATES[status] || { label: "review failed", active: false };
	}

	function verdictMeta(verdict) {
		return VERDICTS[verdict] || VERDICTS.unavailable;
	}

	function normalizeList(value) {
		return Array.isArray(value)
			? value
					.filter((item) => typeof item === "string" && item.trim())
					.slice(0, MAX_RESULT_ITEMS)
					.map((item) => bounded(item.trim(), MAX_ITEM_CHARS).text)
			: [];
	}

	function normalizeResult(result) {
		const source = result && typeof result === "object" ? result : {};
		const verdict = VERDICTS[source.verdict] ? source.verdict : "unavailable";
		const model =
			source.model &&
			typeof source.model.provider === "string" &&
			typeof source.model.modelId === "string"
				? {
						provider: source.model.provider,
						modelId: source.model.modelId,
					}
				: null;
		return {
			verdict,
			summary: typeof source.summary === "string" ? source.summary : "",
			risks: normalizeList(source.risks),
			actions: normalizeList(source.actions),
			model,
			modelSource:
				typeof source.modelSource === "string" ? source.modelSource : "default",
			contextTruncated: source.contextTruncated === true,
			outputTruncated: source.outputTruncated === true,
			retryable: source.retryable === true,
			createdAt: Number.isFinite(source.createdAt) ? source.createdAt : null,
			error:
				source.error && typeof source.error === "object"
					? {
							code: typeof source.error.code === "string" ? source.error.code : "",
							message:
								typeof source.error.message === "string"
									? source.error.message
									: "review unavailable",
						}
					: null,
		};
	}

	function normalizeRun(run) {
		const source = run && typeof run === "object" ? run : {};
		const meta = stateMeta(source.status);
		return {
			id: typeof source.id === "string" ? source.id : "",
			kind: "advisor",
			status: STATES[source.status] ? source.status : "failed",
			label: meta.label,
			active: meta.active,
			result: source.result ? normalizeResult(source.result) : null,
			error: source.error || null,
			inputTruncated: source.inputTruncated === true,
			outputTruncated: source.outputTruncated === true,
		};
	}

	function canReview(source) {
		return !!source && SOURCE_KINDS.includes(source.kind) && !!source.text;
	}

	function canCancel(run) {
		return !!run && !!stateMeta(run.status).active;
	}

	function canRetry(run) {
		return !!run && !canCancel(run) && !!run.result && run.result.retryable === true;
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

	function provenance(result) {
		const normalized = normalizeResult(result);
		return {
			model: normalized.model
				? `${normalized.model.provider}/${normalized.model.modelId}`
				: "configured default",
			context: normalized.contextTruncated ? "context truncated" : "full context",
			completedAt: normalized.createdAt,
		};
	}

	function statusText(run) {
		if (!run) return "ready to review";
		if (run.result && run.result.verdict === "unavailable") {
			const message = run.result.error && run.result.error.message;
			return `${run.label}: ${message || "review unavailable"}${
				run.result.retryable ? " · retry available" : ""
			}`;
		}
		return run.label;
	}

	function materialize(result) {
		const normalized = normalizeResult(result);
		if (!normalized.summary) return "";
		const parts = [normalized.summary];
		if (normalized.risks.length)
			parts.push("Risks:\n" + normalized.risks.map((item) => `- ${item}`).join("\n"));
		if (normalized.actions.length)
			parts.push(
				"Actions:\n" + normalized.actions.map((item) => `- ${item}`).join("\n"),
			);
		return parts.join("\n\n");
	}

	return {
		SOURCE_KINDS,
		SOURCE_LABELS,
		STATES,
		VERDICTS,
		MAX_CONTEXT_CHARS,
		contentText,
		bounded,
		normalizeSource,
		sourceFromMessages,
		requestPayload,
		stateMeta,
		verdictMeta,
		normalizeResult,
		normalizeRun,
		canReview,
		canCancel,
		canRetry,
		shouldApplyRun,
		provenance,
		statusText,
		materialize,
	};
});
