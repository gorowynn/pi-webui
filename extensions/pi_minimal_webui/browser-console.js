

const { truncateUtf8 } = require("./browser-snapshot.js");

const CONSOLE_SCHEMA = "pi-webui.browser-console/v1";
const MAX_ENTRIES = 50;
const MAX_TEXT_BYTES = 4096;
const MAX_SOURCE_BYTES = 2048;

function remoteText(value) {
	if (value == null) return "";
	if (typeof value !== "object") return String(value);
	if (value.value != null && ["string", "number", "boolean"].includes(value.type)) return String(value.value);
	if (typeof value.unserializableValue === "string") return value.unserializableValue;
	if (typeof value.description === "string") return value.description;
	return value.type ? `[${value.type}]` : "[object]";
}

function eventText(params = {}) {
	if (typeof params.text === "string" && params.text) return params.text;
	if (Array.isArray(params.args)) return params.args.map(remoteText).filter(Boolean).join(" ");
	const exception = params.exceptionDetails || params.exception;
	if (exception && typeof exception === "object") {
		if (typeof exception.text === "string" && exception.text) return exception.text;
		if (exception.exception) return remoteText(exception.exception);
	}
	return "";
}

function location(params = {}, exception = {}) {
	const source = params.url || exception.url;
	const line = params.lineNumber ?? exception.lineNumber;
	const column = params.columnNumber ?? exception.columnNumber;
	const out = {};
	if (typeof source === "string" && source) out.source = truncateUtf8(source, MAX_SOURCE_BYTES);
	if (Number.isInteger(line) && line >= 0) out.line = line + 1;
	if (Number.isInteger(column) && column >= 0) out.column = column + 1;
	const timestamp = params.timestamp;
	if (typeof timestamp === "number" && Number.isFinite(timestamp)) out.timestamp = timestamp;
	return out;
}

function normalizeConsoleEvent(method, params) {
	if (!params || typeof params !== "object") return null;
	let level;
	let exception = {};
	if (method === "Runtime.consoleAPICalled") {
		const type = String(params.type || "").toLowerCase();
		if (type === "error" || type === "assert") level = "error";
		else if (type === "warning" || type === "warn") level = "warning";
		else return null;
	} else if (method === "Log.entryAdded") {
		const type = String(params.entry?.level || "").toLowerCase();
		if (type === "error") level = "error";
		else if (type === "warning" || type === "warn") level = "warning";
		else return null;
		params = params.entry;
	} else if (method === "Runtime.exceptionThrown") {
		level = "error";
		exception = params.exceptionDetails && typeof params.exceptionDetails === "object" ? params.exceptionDetails : {};
	} else {
		return null;
	}
	const text = truncateUtf8(eventText(params), MAX_TEXT_BYTES);
	if (!text) return null;
	return { level, text, ...location(params, exception) };
}

class ConsoleCollector {
	constructor(maxEntries = MAX_ENTRIES) {
		this.maxEntries = Math.max(1, Math.min(MAX_ENTRIES, maxEntries));
		this.entries = [];
		this.unsubscribers = [];
	}

	push(method, params) {
		const entry = normalizeConsoleEvent(method, params);
		if (!entry) return false;
		this.entries.push(entry);
		if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
		return true;
	}

	subscribe(session) {
		this.unsubscribe();
		if (!session || typeof session.on !== "function") return () => undefined;
		for (const method of ["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"]) {
			this.unsubscribers.push(session.on(method, (params) => this.push(method, params)));
		}
		return () => this.unsubscribe();
	}

	unsubscribe() {
		for (const unsubscribe of this.unsubscribers.splice(0)) {
			try {
				unsubscribe?.();
			} catch {
				// Cleanup is best effort and idempotent.
			}
		}
	}

	clear() {
		this.entries = [];
	}

	result(url) {
		return {
			schema: CONSOLE_SCHEMA,
			url: truncateUtf8(url || "", 2048),
			entries: this.entries.map((entry) => ({ ...entry })),
		};
	}
}

module.exports = {
	CONSOLE_SCHEMA,
	MAX_ENTRIES,
	MAX_SOURCE_BYTES,
	MAX_TEXT_BYTES,
	ConsoleCollector,
	normalizeConsoleEvent,
	remoteText,
};
