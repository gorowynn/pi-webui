/*
 * secondary-runs.js — pure lifecycle and safety helpers for disposable,
 * transcript-free model runs.
 *
 * CommonJS, zero dependencies. The server owns execution; this module owns the
 * small contract shared by the server and its tests.
 */

const SECONDARY_STATES = Object.freeze([
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
	"expired",
]);
const TERMINAL_STATES = new Set([
	"completed",
	"failed",
	"cancelled",
	"expired",
]);
const DEFAULT_LIMITS = Object.freeze({
	contextChars: 64_000,
	outputChars: 16_000,
	timeoutMs: 120_000,
	threadTurns: 8,
});
const TRANSITIONS = Object.freeze({
	queued: new Set(["running", "failed", "cancelled", "expired"]),
	running: new Set(["completed", "failed", "cancelled", "expired"]),
	completed: new Set(),
	failed: new Set(),
	cancelled: new Set(),
	expired: new Set(),
});

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value, maxChars) {
	const text = value == null ? "" : String(value);
	const max = Number.isInteger(maxChars) && maxChars >= 0 ? maxChars : 0;
	return text.length > max
		? { text: text.slice(0, max), truncated: true }
		: { text, truncated: false };
}

function limitValue(value, fallback, ceiling) {
	if (!Number.isFinite(value) || value <= 0) return fallback;
	return Math.min(Math.floor(value), ceiling);
}

function normalizeLimits(input) {
	const source = isObject(input) ? input : {};
	return {
		contextChars: limitValue(
			source.contextChars,
			DEFAULT_LIMITS.contextChars,
			DEFAULT_LIMITS.contextChars,
		),
		outputChars: limitValue(
			source.outputChars,
			DEFAULT_LIMITS.outputChars,
			DEFAULT_LIMITS.outputChars,
		),
		timeoutMs: limitValue(
			source.timeoutMs,
			DEFAULT_LIMITS.timeoutMs,
			DEFAULT_LIMITS.timeoutMs,
		),
		threadTurns: limitValue(
			source.threadTurns,
			DEFAULT_LIMITS.threadTurns,
			DEFAULT_LIMITS.threadTurns,
		),
	};
}

function createRun(input) {
	const source = isObject(input) ? input : {};
	if (typeof source.id !== "string" || !source.id.trim())
		throw new TypeError("secondary run id is required");
	const now = Number.isFinite(source.createdAt)
		? source.createdAt
		: Date.now();
	return {
		id: source.id,
		kind: typeof source.kind === "string" ? source.kind : "side-question",
		status: "queued",
		createdAt: now,
		startedAt: null,
		finishedAt: null,
		inputTruncated: source.inputTruncated === true,
		outputTruncated: false,
		cancelRequested: false,
		result: null,
		error: null,
	};
}

function transitionRun(run, status, patch) {
	if (!isObject(run) || !SECONDARY_STATES.includes(status))
		return { ok: false, reason: "invalid state" };
	if (TERMINAL_STATES.has(run.status))
		return { ok: false, reason: "terminal" };
	if (!TRANSITIONS[run.status] || !TRANSITIONS[run.status].has(status))
		return { ok: false, reason: "invalid transition" };
	const next = Object.assign({}, run, isObject(patch) ? patch : {}, {
		status,
	});
	if (status === "running" && next.startedAt == null)
		next.startedAt = Date.now();
	if (TERMINAL_STATES.has(status) && next.finishedAt == null)
		next.finishedAt = Date.now();
	return { ok: true, run: next };
}

function cancelRun(run, reason) {
	if (!isObject(run) || TERMINAL_STATES.has(run.status))
		return { ok: false, reason: "terminal" };
	return transitionRun(run, "cancelled", {
		cancelRequested: true,
		error: {
			code: "SECONDARY_CANCELLED",
			message: reason || "secondary run cancelled",
		},
	});
}

function safeError(error) {
	const code =
		error && typeof error.code === "string"
			? error.code
			: "SECONDARY_FAILED";
	const known = {
		SECONDARY_CANCELLED: "secondary run cancelled",
		SECONDARY_TIMEOUT: "secondary run timed out",
		SECONDARY_NO_MODEL: "no model is available",
		SECONDARY_MODEL: "the model request failed; check Pi authentication",
		SECONDARY_NO_TEXT: "the model returned no text",
		PI_UNAVAILABLE: "pi is not running",
	};
	let message = known[code] || "secondary run failed";
	if (code === "SECONDARY_MODEL") {
		const detail =
			error && typeof error.message === "string" ? error.message : "";
		if (/not supported|unsupported/i.test(detail))
			message = "selected model is not supported by this account";
		else if (/auth|oauth|token|401|unauthorized/i.test(detail))
			message = "model authentication failed; check Pi login";
	}
	return { code, message };
}

function publicRun(run) {
	if (!isObject(run)) return null;
	const out = {
		id: run.id,
		kind: run.kind,
		status: run.status,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		inputTruncated: run.inputTruncated === true,
		outputTruncated: run.outputTruncated === true,
		cancelRequested: run.cancelRequested === true,
	};
	if (run.result != null) {
		const result = isObject(run.result) ? run.result : { text: run.result };
		out.result = {
			text:
				typeof result.text === "string"
					? result.text.slice(0, DEFAULT_LIMITS.outputChars)
					: "",
			outputTruncated:
				result.outputTruncated === true || out.outputTruncated,
		};
	}
	if (run.error) out.error = safeError(run.error);
	return out;
}

module.exports = {
	SECONDARY_STATES,
	TERMINAL_STATES,
	DEFAULT_LIMITS,
	boundedText,
	normalizeLimits,
	createRun,
	transitionRun,
	cancelRun,
	safeError,
	publicRun,
};
