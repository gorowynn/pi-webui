/**
 * broker.js — server-owned pending-approval broker (SDD permission-policy C6;
 * FR-18/19/20). Pure zero-dep CommonJS, server-side only.
 *
 * Every BLOCKING extension-UI request (safeguard select, confirm, input,
 * editor) that server.js relays registers here as a pending approval. The
 * record carries the tool identity (from the most recent tool_execution_start,
 * via setContext) so responses can be validated by toolCallId (FR-24, C7).
 *
 * Invariants:
 *   - first response wins (FR-19): resolve() accepts exactly once; later or
 *     stale ids are rejected (410-class result) and never forwarded to pi.
 *   - resolved entries emit a broadcast event {requestId, toolCallId,
 *     decision} so every tab learns the outcome (FR-19/22).
 *   - clear() empties pending on pi exit / workspace switch (FR-20);
 *     snapshot() returns a copy for /api/snapshot replay (FR-21).
 */

function createBroker() {
	/** @type {Map<string, object>} requestId → pending record */
	const pending = new Map();
	/** last tool_execution_start context (preparation is sequential) */
	let lastContext = null;
	/** last safeguard provenance context (setStatus before the select) */
	let lastProvenance = null;

	function recordFor(requestId, extra) {
		return {
			requestId,
			status: "pending",
			decision: null,
			createdAt: Date.now(),
			toolCallId: lastContext ? lastContext.toolCallId : null,
			toolName: lastContext ? lastContext.toolName : null,
			provenance: lastProvenance ? { ...lastProvenance } : null,
			...extra,
		};
	}

	return {
		/** Record the most recent tool_execution_start identity. */
		setContext(toolCallId, toolName) {
			lastContext = { toolCallId, toolName };
		},
		/** Record the most recent safeguard provenance context (C5 emits it
		 *  right before the select — same ordering guarantee as setContext). */
		setProvenance(provenance) {
			lastProvenance = provenance ? { ...provenance } : null;
		},
		/**
		 * Register a blocking request. Returns the record, or null when the
		 * requestId is already known (duplicate broadcast).
		 */
		register({ requestId, method, title, message, options }) {
			if (!requestId || pending.has(requestId)) return null;
			const rec = recordFor(requestId, {
				method,
				title,
				message,
				options,
			});
			pending.set(requestId, rec);
			return rec;
		},
		/**
		 * Resolve a pending approval. First response wins (FR-19):
		 * @returns {{ok: true, event: {requestId, toolCallId, decision}}}
		 *   on first resolution, or
		 *   {ok: false, reason: "unknown" | "resolved"} otherwise.
		 */
		resolve(requestId, decision) {
			const rec = pending.get(requestId);
			if (!rec) return { ok: false, reason: "unknown" };
			if (rec.status !== "pending")
				return { ok: false, reason: "resolved" };
			rec.status = "resolved";
			rec.decision = decision;
			return {
				ok: true,
				event: {
					requestId,
					toolCallId: rec.toolCallId,
					toolName: rec.toolName,
					decision,
				},
			};
		},
		get(requestId) {
			const rec = pending.get(requestId);
			return rec ? { ...rec } : null;
		},
		/** Drop everything (pi exit / workspace switch). */
		clear() {
			pending.clear();
			lastContext = null;
			lastProvenance = null;
		},
		/** Copy of the pending list (reconnect replay, FR-21). */
		snapshot() {
			return [...pending.values()].map((r) => ({ ...r }));
		},
		size() {
			return pending.size;
		},
	};
}

module.exports = { createBroker };
