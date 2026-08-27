/*
 * advisor-contract.js — pure request/result normalization for isolated reviews.
 *
 * CommonJS, zero dependencies beyond the existing secondary-run bounds helper.
 * Execution stays in the server; this module only owns the safe contract shared
 * by the future advisor API and its tests.
 */

const { boundedText } = require("./secondary-runs.js");

const ADVISOR_SOURCE_KINDS = Object.freeze([
	"draft",
	"assistant-turn",
	"request-context",
]);
const ADVISOR_VERDICTS = Object.freeze([
	"proceed",
	"revise",
	"stop",
	"unavailable",
]);
const DEFAULT_ADVISOR_LIMITS = Object.freeze({
	contextChars: 64_000,
	summaryChars: 4_000,
	itemChars: 500,
	maxItems: 8,
});
const SOURCE_SET = new Set(ADVISOR_SOURCE_KINDS);
const VERDICT_SET = new Set(ADVISOR_VERDICTS);
const MODEL_PART = /^[A-Za-z0-9._:/@-]{1,256}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

const ERROR_MESSAGES = Object.freeze({
	ADVISOR_NO_MODEL: "no reviewer model is available",
	ADVISOR_CREDENTIAL: "reviewer authentication failed; check Pi login",
	ADVISOR_TIMEOUT: "reviewer timed out",
	ADVISOR_CANCELLED: "reviewer was cancelled",
	ADVISOR_EMPTY_OUTPUT: "reviewer returned no usable output",
	ADVISOR_MALFORMED_OUTPUT: "reviewer returned malformed structured output",
	ADVISOR_UNAVAILABLE: "reviewer is unavailable",
	ADVISOR_FAILED: "reviewer failed",
});

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function positiveLimit(value, fallback, ceiling) {
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.min(Math.floor(value), ceiling);
}

function normalizeAdvisorLimits(input) {
	const source = isObject(input) ? input : {};
	return {
		contextChars: positiveLimit(
			source.contextChars,
			DEFAULT_ADVISOR_LIMITS.contextChars,
			DEFAULT_ADVISOR_LIMITS.contextChars,
		),
		summaryChars: positiveLimit(
			source.summaryChars,
			DEFAULT_ADVISOR_LIMITS.summaryChars,
			DEFAULT_ADVISOR_LIMITS.summaryChars,
		),
		itemChars: positiveLimit(
			source.itemChars,
			DEFAULT_ADVISOR_LIMITS.itemChars,
			DEFAULT_ADVISOR_LIMITS.itemChars,
		),
		maxItems: positiveLimit(
			source.maxItems,
			DEFAULT_ADVISOR_LIMITS.maxItems,
			DEFAULT_ADVISOR_LIMITS.maxItems,
		),
	};
}

function invalid(code, message) {
	return {
		ok: false,
		error: { code, message, retryable: false },
	};
}

function normalizeId(value, code) {
	if (typeof value !== "string") return null;
	const id = value.trim();
	return SAFE_ID.test(id) ? id : invalid(code, "invalid advisor identifier");
}

function normalizeModel(value) {
	if (value == null) return { ok: true, model: null };
	if (!isObject(value))
		return invalid("ADVISOR_MODEL_INVALID", "invalid advisor model");
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	const modelId =
		typeof value.modelId === "string"
			? value.modelId.trim()
			: typeof value.id === "string"
				? value.id.trim()
				: "";
	if (!MODEL_PART.test(provider) || !MODEL_PART.test(modelId))
		return invalid("ADVISOR_MODEL_INVALID", "invalid advisor model");
	return { ok: true, model: { provider, modelId } };
}

function inferSourceKind(input, source) {
	if (typeof input.sourceKind === "string" && input.sourceKind.trim())
		return input.sourceKind.trim();
	if (typeof source.kind === "string" && source.kind.trim())
		return source.kind.trim();
	if (Object.prototype.hasOwnProperty.call(input, "draft")) return "draft";
	if (
		Object.prototype.hasOwnProperty.call(input, "assistantTurn") ||
		Object.prototype.hasOwnProperty.call(input, "turn")
	)
		return "assistant-turn";
	if (
		Object.prototype.hasOwnProperty.call(input, "requestContext") ||
		Object.prototype.hasOwnProperty.call(input, "context")
	)
		return "request-context";
	return "";
}

function sourceValue(input, source, sourceKind) {
	const sourceObject = isObject(source) ? source : {};
	if (typeof sourceObject.text === "string") return sourceObject.text;
	if (typeof sourceObject.content === "string") return sourceObject.content;
	if (typeof source === "string") return source;
	if (sourceKind === "draft") {
		if (typeof input.draft === "string") return input.draft;
	}
	if (sourceKind === "assistant-turn") {
		const turn = isObject(input.assistantTurn)
			? input.assistantTurn
			: isObject(input.turn)
				? input.turn
				: null;
		if (turn && typeof turn.text === "string") return turn.text;
		if (typeof input.assistantTurn === "string") return input.assistantTurn;
		if (typeof input.turn === "string") return input.turn;
	}
	if (sourceKind === "request-context") {
		if (typeof input.requestContext === "string") return input.requestContext;
		if (typeof input.context === "string") return input.context;
	}
	return "";
}

function sourceId(input, source, sourceKind) {
	if (typeof source.id === "string") return source.id;
	if (typeof input.sourceId === "string") return input.sourceId;
	if (sourceKind === "assistant-turn") {
		const turn = isObject(input.assistantTurn)
			? input.assistantTurn
			: isObject(input.turn)
				? input.turn
				: null;
		if (turn && typeof turn.id === "string") return turn.id;
		if (typeof input.turnId === "string") return input.turnId;
	}
	return null;
}

function normalizeAdvisorRequest(input, limitsInput) {
	if (!isObject(input)) return invalid("ADVISOR_INVALID_REQUEST", "invalid advisor request");
	const requestId = normalizeId(input.requestId, "ADVISOR_REQUEST_ID");
	if (requestId && requestId.ok === false) return requestId;
	if (!requestId) return invalid("ADVISOR_REQUEST_ID", "advisor request id is required");

	const source = input.source;
	const sourceObject = isObject(source) ? source : {};
	const sourceKind = inferSourceKind(input, sourceObject);
	if (!SOURCE_SET.has(sourceKind))
		return invalid("ADVISOR_SOURCE_UNSUPPORTED", "unsupported advisor source");
	if (
		typeof input.sourceKind === "string" &&
		typeof sourceObject.kind === "string" &&
		input.sourceKind.trim() !== sourceObject.kind.trim()
	)
		return invalid("ADVISOR_SOURCE_MISMATCH", "advisor source kind does not match");

	const rawSourceId = sourceId(input, sourceObject, sourceKind);
	let normalizedSourceId = null;
	if (rawSourceId != null) {
		const value = normalizeId(rawSourceId, "ADVISOR_SOURCE_ID");
		if (value && value.ok === false) return value;
		normalizedSourceId = value;
	}
	const text = sourceValue(input, source, sourceKind).trim();
	if (!text) return invalid("ADVISOR_SOURCE_EMPTY", "advisor source context is required");
	const limits = normalizeAdvisorLimits(limitsInput);
	const bounded = boundedText(text, limits.contextChars);

	const normalizedModel = normalizeModel(
		Object.prototype.hasOwnProperty.call(input, "model")
			? input.model
			: input.reviewerModel,
	);
	if (!normalizedModel.ok) return normalizedModel;
	const modelSource =
		input.modelSource === "selected" || input.modelSource === "default"
			? input.modelSource
			: normalizedModel.model
				? "selected"
				: "default";

	return {
		ok: true,
		request: {
			requestId,
			sourceKind,
			source: { id: normalizedSourceId, text: bounded.text },
			model: normalizedModel.model,
			modelSource,
			contextTruncated: bounded.truncated,
			cancelRequested: input.cancelRequested === true,
			createdAt: finiteNumber(input.createdAt, Date.now()),
		},
	};
}

function normalizedMetadata(metadata) {
	const meta = isObject(metadata) ? metadata : {};
	const request = isObject(meta.request) ? meta.request : meta;
	const requestId =
		typeof meta.requestId === "string"
			? meta.requestId
			: typeof request.requestId === "string"
				? request.requestId
				: null;
	const sourceKind = SOURCE_SET.has(request.sourceKind)
		? request.sourceKind
		: null;
	const hasResolvedModel = Object.prototype.hasOwnProperty.call(meta, "resolvedModel");
	const rawModel = hasResolvedModel
		? meta.resolvedModel
		: Object.prototype.hasOwnProperty.call(meta, "model")
			? meta.model
			: request.model;
	const modelResult = normalizeModel(rawModel);
	const model = modelResult.ok ? modelResult.model : null;
	const modelSource =
		meta.modelSource === "selected" ||
		meta.modelSource === "default" ||
		meta.modelSource === "resolved"
			? meta.modelSource
			: hasResolvedModel
				? "resolved"
				: request.modelSource === "selected" || request.modelSource === "default"
					? request.modelSource
					: model
						? "resolved"
						: "default";
	const limits = normalizeAdvisorLimits(meta.limits);
	const completedAt = finiteNumber(
		meta.completedAt,
		finiteNumber(meta.createdAt, Date.now()),
	);
	return {
		requestId,
		sourceKind,
		model,
		modelSource,
		contextTruncated:
			meta.contextTruncated === true || request.contextTruncated === true,
		outputTruncated: meta.outputTruncated === true,
		createdAt: completedAt,
		limits,
		usage: normalizeUsage(meta.usage),
	};
}

function normalizeUsage(value) {
	if (!isObject(value)) return null;
	const out = {};
	for (const key of [
		"inputTokens",
		"outputTokens",
		"cacheRead",
		"cacheWrite",
		"totalTokens",
		"cost",
	]) {
		if (Number.isFinite(value[key]) && value[key] >= 0) out[key] = value[key];
	}
	return Object.keys(out).length ? out : null;
}

function resultBase(meta, values) {
	const out = {
		requestId: meta.requestId,
		sourceKind: meta.sourceKind,
		verdict: values.verdict,
		summary: values.summary,
		risks: values.risks,
		actions: values.actions,
		model: meta.model,
		modelSource: meta.modelSource,
		contextTruncated: meta.contextTruncated,
		outputTruncated: values.outputTruncated === true,
		retryable: values.retryable === true,
		createdAt: meta.createdAt,
	};
	if (meta.usage) out.usage = meta.usage;
	if (values.error) out.error = values.error;
	return out;
}

function normalizeList(value, limits) {
	if (value == null) return { items: [], truncated: false };
	if (!Array.isArray(value)) return { error: true };
	const items = [];
	let truncated = false;
	for (const item of value) {
		if (typeof item !== "string") return { error: true };
		const text = item.trim();
		if (!text) continue;
		if (items.length >= limits.maxItems) {
			truncated = true;
			continue;
		}
		const bounded = boundedText(text, limits.itemChars);
		items.push(bounded.text);
		truncated = truncated || bounded.truncated;
	}
	return { items, truncated };
}

function parseStructuredOutput(value) {
	if (isObject(value)) return { value };
	if (typeof value !== "string") return { error: "ADVISOR_MALFORMED_OUTPUT" };
	const text = value.trim();
	if (!text) return { error: "ADVISOR_EMPTY_OUTPUT" };
	const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	try {
		const parsed = JSON.parse(fenced ? fenced[1] : text);
		return isObject(parsed)
			? { value: parsed }
			: { error: "ADVISOR_MALFORMED_OUTPUT" };
	} catch {
		return { error: "ADVISOR_MALFORMED_OUTPUT" };
	}
}

function mapFailureCode(error) {
	const code = error && typeof error.code === "string" ? error.code : "";
	if (code === "SECONDARY_NO_MODEL") return "ADVISOR_NO_MODEL";
	if (code === "SECONDARY_MODEL") return "ADVISOR_CREDENTIAL";
	if (code === "SECONDARY_TIMEOUT") return "ADVISOR_TIMEOUT";
	if (code === "SECONDARY_CANCELLED" || code === "ABORT_ERR")
		return "ADVISOR_CANCELLED";
	if (code === "SECONDARY_NO_TEXT") return "ADVISOR_EMPTY_OUTPUT";
	if (code.startsWith("ADVISOR_") && ERROR_MESSAGES[code]) return code;
	if (error && error.name === "AbortError") return "ADVISOR_CANCELLED";
	return "ADVISOR_FAILED";
}

function advisorFailure(error, metadata) {
	const meta = normalizedMetadata(metadata);
	const code = mapFailureCode(error);
	const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.ADVISOR_FAILED;
	return resultBase(meta, {
		verdict: "unavailable",
		summary: message,
		risks: [],
		actions: [],
		outputTruncated: false,
		retryable: true,
		error: { code, message },
	});
}

function normalizeAdvisorResult(value, metadata) {
	const meta = normalizedMetadata(metadata);
	if (isObject(value) && value.error)
		return advisorFailure(value.error, metadata);
	const parsed = parseStructuredOutput(value);
	if (parsed.error) return advisorFailure({ code: parsed.error }, metadata);
	const output = parsed.value;
	const verdict =
		typeof output.verdict === "string"
			? output.verdict.trim().toLowerCase()
			: "";
	if (!VERDICT_SET.has(verdict))
		return advisorFailure({ code: "ADVISOR_MALFORMED_OUTPUT" }, metadata);

	const risks = normalizeList(output.risks, meta.limits);
	const actions = normalizeList(output.actions, meta.limits);
	if (risks.error || actions.error)
		return advisorFailure({ code: "ADVISOR_MALFORMED_OUTPUT" }, metadata);
	let summary = typeof output.summary === "string" ? output.summary.trim() : "";
	if (verdict !== "unavailable" && !summary)
		return advisorFailure({ code: "ADVISOR_EMPTY_OUTPUT" }, metadata);
	if (verdict === "unavailable" && !summary)
		summary = ERROR_MESSAGES.ADVISOR_UNAVAILABLE;
	const boundedSummary = boundedText(summary, meta.limits.summaryChars);
	const outputTruncated =
		meta.outputTruncated ||
		boundedSummary.truncated ||
		risks.truncated ||
		actions.truncated;
	if (verdict === "unavailable") {
		const message = boundedSummary.text || ERROR_MESSAGES.ADVISOR_UNAVAILABLE;
		return resultBase(meta, {
			verdict,
			summary: message,
			risks: risks.items,
			actions: actions.items,
			outputTruncated,
			retryable: true,
			error: { code: "ADVISOR_UNAVAILABLE", message },
		});
	}
	return resultBase(meta, {
		verdict,
		summary: boundedSummary.text,
		risks: risks.items,
		actions: actions.items,
		outputTruncated,
		retryable: false,
	});
}

module.exports = {
	ADVISOR_SOURCE_KINDS,
	ADVISOR_VERDICTS,
	DEFAULT_ADVISOR_LIMITS,
	normalizeAdvisorLimits,
	normalizeAdvisorRequest,
	normalizeAdvisorResult,
	advisorFailure,
};
