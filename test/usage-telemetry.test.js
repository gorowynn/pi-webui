const assert = require("node:assert/strict");
const T = require("../public/usage-telemetry.js");

const BASE = 1_000_000;
function sample(timestamp, patch = {}) {
	const out = {
		timestamp,
		counters: {
			inputTokens: 100,
			cacheReadTokens: 50,
			cacheWriteTokens: 2,
			outputTokens: 10,
			cost: 0.1,
			modelCalls: 1,
			toolCalls: 2,
			toolErrors: 0,
		},
		context: { percent: 40, tokens: 400, window: 1000 },
		live: { pendingTools: 0 },
		durations: {
			turnMs: 0,
			timeToFirstTokenMs: 0,
			toolMs: 0,
			turnCount: 0,
			firstTokenCount: 0,
			toolCount: 0,
		},
		derived: { averageTurnCost: 0.1, medianTurnCost: 0.1 },
	};
	return {
		...out,
		...patch,
		counters: { ...out.counters, ...(patch.counters || {}) },
		context: { ...out.context, ...(patch.context || {}) },
		live: { ...out.live, ...(patch.live || {}) },
		durations: { ...out.durations, ...(patch.durations || {}) },
		derived: { ...out.derived, ...(patch.derived || {}) },
	};
}

function fakeStorage(options = {}) {
	let value = options.value == null ? null : options.value;
	return {
		getItem() {
			return value;
		},
		setItem(_key, next) {
			if (options.failSet) throw new Error("quota");
			value = next;
		},
		removeItem() {
			value = null;
		},
		read() {
			return value;
		},
		setRaw(next) {
			value = next;
		},
	};
}

// ===== normalization and initial state =====
{
	const h = T.createHistory();
	assert.equal(h.sessionKey, "standalone");
	assert.deepEqual(h.samples, []);
	assert.equal(h.baselineValid, false);
	assert.equal(h.paused, false);

	const normalized = T.normalizeSample(
		sample(BASE, {
			counters: { cost: "unknown", outputTokens: -1 },
			context: { percent: 101 },
			live: { pendingTools: -1 },
			durations: { turnMs: "later" },
		}),
	);
	assert.equal(normalized.counters.cost, null);
	assert.equal(normalized.counters.outputTokens, null);
	assert.equal(normalized.context.percent, null);
	assert.equal(normalized.live.pendingTools, null);
	assert.equal(normalized.durations.turnMs, null);
	assert(Object.isFrozen(normalized));
	assert(Object.isFrozen(normalized.counters));
	assert.equal(T.normalizeSample({ timestamp: "bad" }), null);
}

// ===== 60-minute / 361-sample bound =====
{
	const h = T.createHistory("session-a");
	for (let i = 0; i < T.MAX_SAMPLES + 1; i++)
		T.appendSample(
			h,
			sample(BASE + i * 10_000, {
				counters: { outputTokens: i, modelCalls: i, toolCalls: i },
			}),
		);
	assert.equal(h.samples.length, T.MAX_SAMPLES);
	assert.equal(h.samples[0].timestamp, BASE + 10_000);
	assert.equal(
		h.samples[h.samples.length - 1].timestamp,
		BASE + T.MAX_SAMPLES * 10_000,
	);
	assert.equal(h.baselineValid, true);
}

// ===== session changes and cumulative resets rebase =====
{
	const h = T.createHistory("session-a");
	T.appendSample(h, sample(BASE, { counters: { outputTokens: 10 } }));
	T.appendSample(h, sample(BASE + 10_000, { counters: { outputTokens: 20 } }));
	assert.equal(h.baselineValid, true);
	T.appendSample(h, sample(BASE + 20_000, { counters: { outputTokens: 5 } }));
	assert.equal(h.samples.length, 1);
	assert.equal(h.samples[0].counters.outputTokens, 5);
	assert.equal(h.baselineValid, false);

	T.appendSample(h, sample(BASE + 30_000, { counters: { outputTokens: 6 } }));
	assert.equal(h.samples.length, 2);
	const other = T.ensureSession(h, "session-b");
	assert.equal(other, h);
	assert.equal(h.sessionKey, "session-b");
	assert.deepEqual(h.samples, []);
	assert.equal(h.baselineValid, false);
}

// ===== nullable provider fields do not reset unrelated counters =====
{
	const h = T.createHistory("session-a");
	T.appendSample(h, sample(BASE));
	T.appendSample(
		h,
		sample(BASE + 10_000, {
			counters: { cost: null, outputTokens: 20 },
			context: { percent: null },
		}),
	);
	assert.equal(h.samples.length, 2);
	assert.equal(h.samples[1].counters.cost, null);
	assert.equal(h.samples[1].counters.outputTokens, 20);
	assert.equal(h.samples[1].context.percent, null);
	assert.equal(h.baselineValid, true);
}

// ===== hidden/reload gaps establish a new rate baseline =====
{
	const h = T.createHistory("session-a");
	T.appendSample(h, sample(BASE));
	T.appendSample(h, sample(BASE + 10_000, { counters: { outputTokens: 20 } }));
	T.pauseHistory(h);
	T.resumeHistory(h);
	T.appendSample(h, sample(BASE + 20_000, { counters: { outputTokens: 30 } }));
	assert.equal(h.baselineValid, false);
	T.appendSample(h, sample(BASE + 30_000, { counters: { outputTokens: 40 } }));
	assert.equal(h.baselineValid, true);
}

// ===== browser-local persistence is bounded, keyed, and failure-safe =====
{
	const storage = fakeStorage();
	const h = T.createHistory("session-a");
	T.appendSample(h, sample(BASE));
	T.appendSample(h, sample(BASE + 10_000));
	assert.equal(T.saveHistory(storage, h, BASE + 10_000), true);
	assert.doesNotMatch(storage.read(), /prompt|tool argument|tool result/i);

	const restored = T.loadHistory(storage, "session-a", BASE + 10_000);
	assert.equal(restored.sessionKey, "session-a");
	assert.equal(restored.samples.length, 2);
	assert.equal(restored.paused, true);
	assert.equal(restored.baselineValid, false);
	assert.equal(
		T.loadHistory(storage, "session-b", BASE + 10_000).samples.length,
		0,
	);

	const second = T.createHistory("session-b");
	T.appendSample(second, sample(BASE + 20_000));
	T.appendSample(second, sample(BASE + 30_000));
	assert.equal(T.saveHistory(storage, second, BASE + 30_000), true);
	assert.equal(
		T.loadHistory(storage, "session-a", BASE + 30_000).samples.length,
		2,
	);
	assert.equal(
		T.loadHistory(storage, "session-b", BASE + 30_000).samples.length,
		2,
	);
	const savedPayload = JSON.parse(storage.read());
	assert.equal(savedPayload.version, T.STORAGE_VERSION);
	assert.deepEqual(
		savedPayload.sessions.map((entry) => entry.sessionKey).sort(),
		["session-a", "session-b"],
	);

	T.appendSample(restored, sample(BASE + 20_000));
	assert.equal(restored.baselineValid, false);
	T.appendSample(restored, sample(BASE + 30_000));
	assert.equal(restored.baselineValid, true);

	storage.setRaw(
		JSON.stringify({
			version: 1,
			sessionKey: "legacy",
			samples: [sample(BASE)],
			savedAt: BASE,
		}),
	);
	assert.equal(T.loadHistory(storage, "legacy", BASE).samples.length, 1);
	const migrated = T.createHistory("migrated");
	T.appendSample(migrated, sample(BASE + 10_000));
	assert.equal(T.saveHistory(storage, migrated, BASE + 10_000), true);
	assert.equal(
		T.loadHistory(storage, "legacy", BASE + 10_000).samples.length,
		1,
	);
	assert.equal(
		T.loadHistory(storage, "migrated", BASE + 10_000).samples.length,
		1,
	);
	assert.equal(JSON.parse(storage.read()).version, T.STORAGE_VERSION);

	const capStorage = fakeStorage();
	for (let i = 0; i < T.MAX_STORED_SESSIONS + 2; i++) {
		const session = T.createHistory(`session-${i}`);
		T.appendSample(session, sample(BASE + i * 1_000));
		assert.equal(T.saveHistory(capStorage, session, BASE + i * 1_000), true);
	}
	assert.equal(
		T.loadHistory(capStorage, "session-0", BASE + 20_000).samples.length,
		0,
	);
	assert.equal(
		T.loadHistory(capStorage, "session-1", BASE + 20_000).samples.length,
		0,
	);
	assert.equal(
		T.loadHistory(capStorage, "session-2", BASE + 20_000).samples.length,
		1,
	);

	storage.setRaw("not json");
	assert.equal(T.loadHistory(storage, "session-a", BASE).samples.length, 0);
	assert.equal(T.saveHistory(fakeStorage({ failSet: true }), h, BASE), false);
	assert.equal(T.loadHistory(null, "session-a", BASE).samples.length, 0);
	assert.equal(T.clearStoredHistory(storage), true);
	assert.equal(storage.read(), null);
}

// ===== replay-safe turn and tool telemetry =====
{
	const ledger = T.createEventLedger();
	assert.equal(ledger.startTurn("turn-1", 1_000), true);
	assert.equal(ledger.startTurn("turn-1", 1_000), false);
	assert.equal(ledger.markFirstToken(null, 1_100), true);
	assert.equal(ledger.markFirstToken(null, 1_200), false);
	assert.equal(ledger.endTurn("turn-1", 1_600), true);
	assert.equal(ledger.endTurn("turn-1", 1_600), false);
	assert.equal(ledger.startTurn("turn-1", 2_000), false);
	let view = ledger.snapshot();
	assert.deepEqual(view.durations, {
		turnMs: 600,
		timeToFirstTokenMs: 100,
		toolMs: 0,
		turnCount: 1,
		firstTokenCount: 1,
		toolCount: 0,
	});

	assert.equal(ledger.startTurn("turn-2", 2_000), true);
	assert.equal(ledger.startTool("tool-1", "bash", 2_100), true);
	assert.equal(ledger.startTool("tool-1", "bash", 2_100), false);
	assert.equal(ledger.pauseTool("tool-1", 2_200), true);
	assert.equal(ledger.pauseTool("tool-1", 2_300), false);
	assert.equal(ledger.resumeTool("tool-1", 3_200), true);
	assert.equal(ledger.resumeTool("tool-1", 3_300), false);
	view = ledger.snapshot();
	assert.equal(view.pendingTools, 1);
	assert.equal(view.durations.toolCount, 0);
	assert.equal(ledger.endTool("tool-1", 3_600, true), true);
	assert.equal(ledger.endTool("tool-1", 3_600, true), false);
	view = ledger.snapshot();
	assert.equal(view.pendingTools, 0);
	assert.equal(view.durations.toolMs, 500);
	assert.equal(view.durations.toolCount, 1);
	assert.equal(view.toolErrors, 1);
	assert.equal(ledger.endTurn("turn-2", 4_000), true);

	const endedWhilePaused = T.createEventLedger();
	endedWhilePaused.startTool("prompted", "bash", 5_000);
	endedWhilePaused.pauseTool("prompted", 5_100);
	endedWhilePaused.endTool("prompted", 6_100);
	assert.equal(endedWhilePaused.snapshot().durations.toolMs, 100);

	assert.equal(ledger.startTool(null, "read", 4_100), false);
	assert.equal(ledger.endTool(null, 3_200, false), false);
	assert.equal(ledger.startTurn(null, 4_000), true);
	assert.equal(ledger.endTurn("guess", 4_100), false);
	assert.equal(ledger.endTurn(null, 4_100), true);

	const seeded = T.createEventLedger({
		toolErrors: 2,
		durations: {
			turnMs: 10,
			timeToFirstTokenMs: 4,
			toolMs: 8,
			turnCount: 1,
			firstTokenCount: 1,
			toolCount: 2,
		},
	});
	assert.equal(seeded.snapshot().toolErrors, 2);
	assert.equal(seeded.snapshot().durations.toolMs, 8);
	seeded.startTool("pending", "bash", 5_000);
	seeded.reset();
	assert.deepEqual(seeded.snapshot(), {
		pendingTools: 0,
		activeTurn: false,
		toolErrors: 0,
		durations: {
			turnMs: 0,
			timeToFirstTokenMs: 0,
			toolMs: 0,
			turnCount: 0,
			firstTokenCount: 0,
			toolCount: 0,
		},
	});
}

// ===== authoritative sample mapping =====
{
	const mapped = T.sampleFromAnalysis(
		BASE,
		{
			tokens: { cacheMiss: 100, cacheRead: 40, cacheWrite: 2, output: 20 },
			costAvailable: true,
			totalCost: 0.4,
			turnCount: 2,
			totalToolCalls: 3,
			failedToolCalls: 1,
			contextPercent: 55,
			toolCalls: [{ pending: true }],
			averageTurnCost: 0.2,
			medianTurnCost: 0.15,
		},
		{ cost: 0.9, contextUsage: { tokens: 550, contextWindow: 1000 } },
		{
			pendingTools: 2,
			toolErrors: 2,
			durations: {
				turnMs: 1000,
				timeToFirstTokenMs: 200,
				toolMs: 500,
				turnCount: 2,
				firstTokenCount: 2,
				toolCount: 1,
			},
		},
	);
	assert.equal(mapped.counters.inputTokens, 100);
	assert.equal(mapped.counters.cacheReadTokens, 40);
	assert.equal(mapped.counters.outputTokens, 20);
	assert.equal(mapped.counters.cost, 0.4);
	assert.equal(mapped.counters.modelCalls, 2);
	assert.equal(mapped.counters.toolCalls, 3);
	assert.equal(mapped.counters.toolErrors, 2);
	assert.equal(mapped.context.percent, 55);
	assert.equal(mapped.context.tokens, 550);
	assert.equal(mapped.context.window, 1000);
	assert.equal(mapped.live.pendingTools, 2);
	assert.equal(mapped.durations.toolCount, 1);

	const missingCost = T.sampleFromAnalysis(
		BASE,
		{ tokens: { output: 1 }, costAvailable: false },
		{ tokens: { input: 2, output: 3 } },
		{},
	);
	assert.equal(missingCost.counters.cost, null);
	assert.equal(missingCost.counters.inputTokens, 2);
	assert.equal(missingCost.counters.outputTokens, 1);
}

function metric(history, id) {
	return T.metricViews(history).find((view) => view.id === id);
}
function close(actual, expected, epsilon = 1e-9) {
	assert(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

// ===== rolling rates, current values, gaps, and zero denominators =====
{
	const h = T.createHistory("session-a");
	T.appendSample(h, sample(BASE));
	T.appendSample(
		h,
		sample(BASE + 60_000, {
			counters: {
				inputTokens: 200,
				cacheReadTokens: 100,
				outputTokens: 70,
				cost: 0.7,
				modelCalls: 3,
				toolCalls: 6,
				toolErrors: 1,
			},
			context: { percent: 60, tokens: 900, window: 2_000 },
			live: { pendingTools: 2 },
			durations: {
				turnMs: 1_000,
				timeToFirstTokenMs: 200,
				toolMs: 500,
				turnCount: 2,
				firstTokenCount: 2,
				toolCount: 1,
			},
			derived: { averageTurnCost: 0.23, medianTurnCost: 0.2 },
		}),
	);
	const output = metric(h, "output-tps");
	assert.equal(output.available, true);
	close(output.valueText === "1.0 tok/s" ? 1 : 0, 1);
	close(output.series[1].value, 1);
	close(metric(h, "avg-output-call").valueText === "30 tok/call" ? 1 : 0, 1);
	close(metric(h, "avg-output-call").series[1].value, 30);
	close(metric(h, "cost-minute").series[1].value, 0.6);
	close(metric(h, "cache-hit").series[1].value, 100 / 3);
	close(metric(h, "tool-error").series[1].value, 25);
	close(metric(h, "tool-calls-minute").series[1].value, 4);
	assert.equal(metric(h, "pending-tools").valueText, "2");
	assert.equal(metric(h, "context").valueText, "60%");
	assert.equal(metric(h, "headroom").valueText, "40%");
	close(metric(h, "turn-duration").series[1].value, 500);
	close(metric(h, "first-token").series[1].value, 100);
	close(metric(h, "tool-latency").series[1].value, 500);
	assert.equal(metric(h, "total").valueText, "$0.700");
	assert.equal(metric(h, "turns").valueText, "3");
	assert.equal(metric(h, "avg-turn").valueText, "0.23");
	assert.equal(metric(h, "median-turn").valueText, "0.20");
	assert.equal(metric(h, "output-tps").reason, undefined);

	// Current values and trend points use the active rolling window, not just
	// the immediately preceding 10-second sample. Idle samples stay readable.
	T.appendSample(
		h,
		sample(BASE + 120_000, {
			counters: {
				inputTokens: 200,
				cacheReadTokens: 100,
				outputTokens: 70,
				cost: 0.7,
				modelCalls: 3,
				toolCalls: 6,
				toolErrors: 1,
			},
			durations: {
				turnMs: 1_000,
				timeToFirstTokenMs: 200,
				toolMs: 500,
				turnCount: 2,
				firstTokenCount: 2,
				toolCount: 1,
			},
			context: { percent: 60, tokens: 900, window: 2_000 },
			live: { pendingTools: 0 },
		}),
	);
	close(metric(h, "output-tps").series[2].value, 0.5);
	close(metric(h, "avg-output-call").series[2].value, 30);
	close(metric(h, "tool-error").series[2].value, 25);
	close(metric(h, "tool-calls-minute").series[2].value, 2);
	close(metric(h, "turn-duration").series[2].value, 500);
	close(metric(h, "first-token").series[2].value, 100);
	close(metric(h, "tool-latency").series[2].value, 500);
	assert.equal(metric(h, "avg-output-call").valueText, "30 tok/call");
	assert.equal(metric(h, "tool-error").valueText, "25%");
	assert.equal(metric(h, "tool-calls-minute").valueText, "2.0/min");
	assert.equal(metric(h, "turn-duration").valueText, "500 ms");
}

// ===== idle, missing, no-call, duration, and first-baseline states =====
{
	const first = T.createHistory("session-a");
	T.appendSample(first, sample(BASE));
	assert.equal(metric(first, "output-tps").available, false);
	assert.equal(metric(first, "output-tps").reason, "not-initialized");
	assert.equal(metric(first, "output-tps").valueText, "—");

	const idle = T.createHistory("session-a");
	T.appendSample(idle, sample(BASE));
	T.appendSample(
		idle,
		sample(BASE + 60_000, {
			counters: { outputTokens: 10, cost: 0.1, modelCalls: 1, toolCalls: 2 },
		}),
	);
	assert.equal(metric(idle, "output-tps").valueText, "0.0 tok/s");
	assert.equal(metric(idle, "avg-output-call").reason, "no-completed-calls");
	assert.equal(metric(idle, "tool-calls-minute").reason, "no-completed-calls");
	assert.equal(metric(idle, "cache-hit").reason, "idle");
	assert.equal(metric(idle, "turn-duration").reason, "no-duration-data");

	const missing = T.createHistory("session-a");
	T.appendSample(missing, sample(BASE));
	T.appendSample(
		missing,
		sample(BASE + 60_000, {
			counters: { cost: null, outputTokens: 20 },
		}),
	);
	assert.equal(metric(missing, "cost-minute").reason, "missing-provider-data");
	assert.equal(metric(missing, "output-tps").available, true);
	assert.equal(metric(missing, "context").available, true);

	const noContext = T.createHistory("session-a");
	T.appendSample(noContext, sample(BASE, { context: { percent: null } }));
	T.appendSample(
		noContext,
		sample(BASE + 60_000, { context: { percent: null, window: 2000 } }),
	);
	assert.equal(metric(noContext, "context").reason, "missing-provider-data");
	assert.equal(metric(noContext, "headroom").reason, "missing-provider-data");

	const malformed = T.metricViews(null);
	assert(Array.isArray(malformed));
	assert(malformed.every((view) => view.available === false));
}

// ===== sparkline geometry and accessible card contract =====
{
	const flat = T.sparklineGeometry(
		[
			{ timestamp: 1, value: 5 },
			{ timestamp: 2, value: 5 },
			{ timestamp: 3, value: 5 },
		],
		100,
		20,
	);
	assert.equal(flat.validCount, 3);
	assert.equal(flat.flat, true);
	assert.equal(flat.points[0].y, 10);
	assert.equal(flat.points[1].y, 10);
	assert.match(flat.path, /^M/);
	assert.match(flat.path, /L/);
	assert.doesNotMatch(flat.path, /NaN|Infinity/);

	const scaled = T.sparklineGeometry([{ value: 10 }, { value: 20 }], 100, 20);
	const scaledAgain = T.sparklineGeometry(
		[{ value: 100 }, { value: 200 }],
		100,
		20,
	);
	assert.equal(scaled.points[0].y, scaledAgain.points[0].y);
	assert.equal(scaled.points[1].y, scaledAgain.points[1].y);
	const timed = T.sparklineGeometry(
		[
			{ timestamp: 0, value: 1 },
			{ timestamp: 10_000, value: 2 },
			{ timestamp: 60_000, value: 3 },
		],
		100,
		20,
	);
	close(timed.points[0].x, 0);
	close(timed.points[1].x, 100 / 6);
	close(timed.points[2].x, 100);

	const raw = Array.from({ length: 200 }, (_, index) => ({
		timestamp: index * 1_000,
		value: index,
	}));
	const reduced = T.downsampleSeries(raw, T.MAX_SPARK_POINTS);
	assert.equal(reduced.length, 100);
	close(reduced[0].value, 0.5);
	close(reduced[reduced.length - 1].value, 198.5);
	assert(T.sparklineGeometry(raw, 100, 20).points.length <= 100);
	const withGap = raw.map((entry, index) =>
		index === 50 ? { ...entry, value: null } : entry,
	);
	assert(reduced.every((entry) => Number.isFinite(entry.value)));
	assert(T.downsampleSeries(withGap, 100).some((entry) => entry.value == null));

	const gap = T.sparklineGeometry(
		[{ value: 1 }, { value: null }, { value: 3 }],
		100,
		20,
	);
	assert.equal(gap.validCount, 2);
	assert.equal(gap.segments.length, 2);
	assert.equal(gap.segments[0].length, 1);
	assert.equal(gap.segments[1].length, 1);
	assert.doesNotMatch(gap.path, /L/);
	assert.equal(T.sparklineGeometry([{ value: 1 }]).path, "");
	assert.equal(T.sparklineSvg([{ value: 1 }]), "");

	const unavailable = T.metricCardParts({
		id: "avg-output-call",
		label: "avg output/call",
		valueText: "—",
		available: false,
		reason: "no-completed-calls",
		series: [{ value: 1 }, { value: 2 }],
	});
	assert.equal(unavailable.label, "avg output/call");
	assert.equal(unavailable.valueText, "—");
	assert.equal(unavailable.stateText, "no completed calls");
	assert.match(unavailable.trendHtml, /aria-hidden="true"/);
	assert.match(unavailable.trendHtml, /focusable="false"/);
	const available = T.metricCardParts({
		id: "output-tps",
		label: "output tok/s",
		valueText: "1.0 tok/s",
		available: true,
		series: [{ value: 1 }, { value: 2 }],
	});
	assert.equal(available.stateText, "");
}

console.log("usage telemetry history: pass");
