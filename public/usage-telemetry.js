/*
 * usage-telemetry.js — bounded browser-local Usage history primitives.
 * Dual-mode and dependency-free: the browser gets window.usageTelemetry;
 * Node tests get module.exports. No transcript or tool content belongs here.
 */
(() => {
	const WINDOW_MS = 60 * 60 * 1000;
	const MAX_SAMPLES = 361;
	const MAX_SPARK_POINTS = 100;
	const MAX_STORED_SESSIONS = 12;
	const STORAGE_VERSION = 2;
	const STORAGE_KEY = "pi:usage-telemetry:v1";
	const COUNTER_FIELDS = [
		"inputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"outputTokens",
		"cost",
		"modelCalls",
		"toolCalls",
		"toolErrors",
	];
	const DURATION_FIELDS = [
		"turnMs",
		"timeToFirstTokenMs",
		"toolMs",
		"turnCount",
		"firstTokenCount",
		"toolCount",
	];

	function finite(value) {
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	}
	function nonNegative(value) {
		const n = finite(value);
		return n == null || n < 0 ? null : n;
	}
	function count(value) {
		const n = nonNegative(value);
		return n == null ? null : Math.trunc(n);
	}
	function percent(value) {
		const n = finite(value);
		return n == null || n < 0 || n > 100 ? null : n;
	}
	function sessionKey(value) {
		return typeof value === "string" && value.trim() ? value : "standalone";
	}
	function freezeDeep(value) {
		if (!value || typeof value !== "object" || Object.isFrozen(value))
			return value;
		for (const child of Object.values(value)) freezeDeep(child);
		return Object.freeze(value);
	}
	function field(source, name, normalizer) {
		return normalizer(source && source[name]);
	}

	function normalizeSample(raw) {
		if (!raw || typeof raw !== "object") return null;
		const timestamp = finite(raw.timestamp);
		if (timestamp == null) return null;
		const sourceCounters =
			raw.counters && typeof raw.counters === "object" ? raw.counters : {};
		const sourceContext =
			raw.context && typeof raw.context === "object" ? raw.context : {};
		const sourceLive = raw.live && typeof raw.live === "object" ? raw.live : {};
		const sourceDurations =
			raw.durations && typeof raw.durations === "object" ? raw.durations : {};
		const sourceDerived =
			raw.derived && typeof raw.derived === "object" ? raw.derived : {};
		const counters = {};
		for (const name of COUNTER_FIELDS)
			counters[name] = field(sourceCounters, name, nonNegative);
		const durations = {};
		for (const name of DURATION_FIELDS)
			durations[name] = field(
				sourceDurations,
				name,
				name.endsWith("Count") ? count : nonNegative,
			);
		return freezeDeep({
			timestamp: Math.trunc(timestamp),
			counters,
			context: {
				percent: field(sourceContext, "percent", percent),
				tokens: field(sourceContext, "tokens", nonNegative),
				window: field(sourceContext, "window", nonNegative),
			},
			live: {
				pendingTools: field(sourceLive, "pendingTools", count),
			},
			durations,
			derived: {
				averageTurnCost: field(sourceDerived, "averageTurnCost", nonNegative),
				medianTurnCost: field(sourceDerived, "medianTurnCost", nonNegative),
			},
		});
	}

	function createHistory(key) {
		return {
			sessionKey: sessionKey(key),
			samples: [],
			baselineValid: false,
			paused: false,
			_segmentStart: null,
			_breakBeforeNext: false,
		};
	}
	function resetHistory(history, key) {
		const nextKey = sessionKey(
			key == null ? history && history.sessionKey : key,
		);
		if (!history || typeof history !== "object") return createHistory(nextKey);
		history.sessionKey = nextKey;
		history.samples = [];
		history.baselineValid = false;
		history.paused = false;
		history._segmentStart = null;
		history._breakBeforeNext = false;
		return history;
	}
	function ensureSession(history, key) {
		const nextKey = sessionKey(key);
		if (!history || history.sessionKey !== nextKey)
			return resetHistory(history || createHistory(nextKey), nextKey);
		return history;
	}
	function pauseHistory(history) {
		if (!history || typeof history !== "object") return history;
		history.paused = true;
		history.baselineValid = false;
		history._breakBeforeNext = true;
		return history;
	}
	function resumeHistory(history) {
		if (!history || typeof history !== "object") return history;
		history.paused = false;
		history.baselineValid = false;
		history._breakBeforeNext = true;
		return history;
	}

	function counterReset(previous, next) {
		if (!previous || !next) return false;
		for (const name of COUNTER_FIELDS.concat(DURATION_FIELDS)) {
			const a =
				name in previous.counters
					? previous.counters[name]
					: previous.durations[name];
			const b =
				name in next.counters ? next.counters[name] : next.durations[name];
			if (a != null && b != null && b < a) return true;
		}
		return false;
	}
	function segmentCount(history) {
		if (history._segmentStart == null || !history.samples.length) return 0;
		return history.samples.filter(
			(sample) => sample.timestamp >= history._segmentStart,
		).length;
	}
	function trimHistory(history, now) {
		const latest = history.samples[history.samples.length - 1];
		if (!latest) return history;
		const cutoff =
			finite(now) == null ? latest.timestamp - WINDOW_MS : now - WINDOW_MS;
		while (
			history.samples.length &&
			(history.samples.length > MAX_SAMPLES ||
				history.samples[0].timestamp < cutoff)
		)
			history.samples.shift();
		if (
			history._segmentStart != null &&
			history.samples.length &&
			history.samples[history.samples.length - 1].timestamp <
				history._segmentStart
		)
			history._segmentStart = history.samples[0].timestamp;
		history.baselineValid = !history.paused && segmentCount(history) > 1;
		return history;
	}

	function appendSample(history, raw) {
		if (!history || typeof history !== "object") return null;
		const sample = normalizeSample(raw);
		if (!sample) return null;
		const last = history.samples[history.samples.length - 1];
		if (last && sample.timestamp < last.timestamp) return null;
		if (last && sample.timestamp === last.timestamp) {
			history.samples[history.samples.length - 1] = sample;
			history.baselineValid = !history.paused && segmentCount(history) > 1;
			return sample;
		}

		if (history.paused) {
			history.paused = false;
			history.baselineValid = false;
			history._breakBeforeNext = true;
		}
		if (last && counterReset(last, sample)) resetHistory(history);
		if (!history.samples.length || history._breakBeforeNext) {
			history._segmentStart = sample.timestamp;
			history.baselineValid = false;
			history._breakBeforeNext = false;
		}
		history.samples.push(sample);
		trimHistory(history, sample.timestamp);
		history.baselineValid = !history.paused && segmentCount(history) > 1;
		return sample;
	}

	function storageObject(storage) {
		if (storage && typeof storage.getItem === "function") return storage;
		try {
			return typeof localStorage !== "undefined" ? localStorage : null;
		} catch {
			return null;
		}
	}
	function storagePayload(sessions) {
		return {
			version: STORAGE_VERSION,
			sessions: sessions.map((entry) => ({
				sessionKey: entry.sessionKey,
				samples: entry.samples,
				savedAt: entry.savedAt,
			})),
		};
	}
	function storedSessions(storage, now) {
		if (!storage || typeof storage.getItem !== "function") return [];
		let payload;
		try {
			const text = storage.getItem(STORAGE_KEY);
			if (!text) return [];
			payload = JSON.parse(text);
		} catch {
			return [];
		}
		let rawSessions;
		if (
			payload &&
			payload.version === STORAGE_VERSION &&
			Array.isArray(payload.sessions)
		)
			rawSessions = payload.sessions;
		else if (payload && payload.version === 1 && Array.isArray(payload.samples))
			rawSessions = [payload];
		else return [];
		const current = finite(now) == null ? Date.now() : Math.trunc(now);
		const entries = [];
		for (const raw of rawSessions) {
			if (!raw || typeof raw !== "object" || !Array.isArray(raw.samples))
				continue;
			const history = createHistory(raw.sessionKey);
			let valid = true;
			for (const sample of raw.samples) {
				if (!appendSample(history, sample)) {
					valid = false;
					break;
				}
			}
			trimHistory(history, current);
			if (!valid || !history.samples.length) continue;
			const last = history.samples[history.samples.length - 1];
			const savedAt = finite(raw.savedAt);
			entries.push({
				sessionKey: history.sessionKey,
				samples: history.samples,
				savedAt: Math.trunc(savedAt == null ? last.timestamp : savedAt),
			});
		}
		return entries;
	}
	function saveHistory(storage, history, now) {
		const target = storageObject(storage);
		if (!target || !history || typeof target.setItem !== "function")
			return false;
		try {
			const current = finite(now) == null ? Date.now() : Math.trunc(now);
			trimHistory(history, current);
			const sessions = storedSessions(target, current).filter(
				(entry) => entry.sessionKey !== history.sessionKey,
			);
			sessions.push({
				sessionKey: history.sessionKey,
				samples: history.samples,
				savedAt: current,
			});
			sessions.sort((a, b) => b.savedAt - a.savedAt);
			target.setItem(
				STORAGE_KEY,
				JSON.stringify(storagePayload(sessions.slice(0, MAX_STORED_SESSIONS))),
			);
			return true;
		} catch {
			return false;
		}
	}
	function loadHistory(storage, key, now) {
		const history = createHistory(key);
		const target = storageObject(storage);
		const stored = storedSessions(
			target,
			finite(now) == null ? Date.now() : now,
		).find((entry) => entry.sessionKey === history.sessionKey);
		if (!stored) return history;
		for (const raw of stored.samples) {
			if (!appendSample(history, raw)) return createHistory(key);
		}
		trimHistory(history, finite(now) == null ? Date.now() : now);
		if (!history.samples.length) return createHistory(key);
		// A page reload has an elapsed gap and no active event identities. Keep the
		// old samples for the visual window, but make the next sample a baseline.
		history.paused = true;
		history.baselineValid = false;
		history._breakBeforeNext = true;
		history._segmentStart =
			history.samples[history.samples.length - 1].timestamp;
		return history;
	}
	function clearStoredHistory(storage) {
		const target = storageObject(storage);
		if (!target || typeof target.removeItem !== "function") return false;
		try {
			target.removeItem(STORAGE_KEY);
			return true;
		} catch {
			return false;
		}
	}

	function pickNumber(...values) {
		for (const value of values) {
			const n = nonNegative(value);
			if (n != null) return n;
		}
		return null;
	}
	function sampleFromAnalysis(timestamp, analysis, stats, telemetry) {
		const a = analysis && typeof analysis === "object" ? analysis : {};
		const s = stats && typeof stats === "object" ? stats : {};
		const tokens = a.tokens && typeof a.tokens === "object" ? a.tokens : {};
		const statsTokens =
			s.tokens && typeof s.tokens === "object" ? s.tokens : {};
		const contextUsage =
			s.contextUsage && typeof s.contextUsage === "object"
				? s.contextUsage
				: {};
		const live = telemetry && typeof telemetry === "object" ? telemetry : {};
		const pendingFromMessages = Array.isArray(a.toolCalls)
			? a.toolCalls.filter((call) => call && call.pending).length
			: null;
		const errorValues = [a.failedToolCalls, live.toolErrors, s.toolErrors]
			.map(nonNegative)
			.filter((value) => value != null);
		const durations =
			live.durations && typeof live.durations === "object"
				? live.durations
				: null;
		return normalizeSample({
			timestamp,
			counters: {
				inputTokens: pickNumber(
					tokens.cacheMiss,
					tokens.input,
					statsTokens.input,
				),
				cacheReadTokens: pickNumber(tokens.cacheRead, statsTokens.cacheRead),
				cacheWriteTokens: pickNumber(tokens.cacheWrite, statsTokens.cacheWrite),
				outputTokens: pickNumber(tokens.output, statsTokens.output),
				cost: pickNumber(a.costAvailable === true ? a.totalCost : null, s.cost),
				modelCalls: pickNumber(a.turnCount, s.modelCalls),
				toolCalls: pickNumber(a.totalToolCalls, s.toolCalls),
				toolErrors: errorValues.length ? Math.max(...errorValues) : null,
			},
			context: {
				percent: pickNumber(a.contextPercent, contextUsage.percent),
				tokens: pickNumber(contextUsage.tokens),
				window: pickNumber(contextUsage.contextWindow, contextUsage.window),
			},
			live: {
				pendingTools: pickNumber(live.pendingTools, pendingFromMessages),
			},
			durations: durations
				? {
						turnMs: pickNumber(durations.turnMs),
						timeToFirstTokenMs: pickNumber(durations.timeToFirstTokenMs),
						toolMs: pickNumber(durations.toolMs),
						turnCount: pickNumber(durations.turnCount),
						firstTokenCount: pickNumber(durations.firstTokenCount),
						toolCount: pickNumber(durations.toolCount),
					}
				: {},
			derived: {
				averageTurnCost: pickNumber(a.averageTurnCost),
				medianTurnCost: pickNumber(a.medianTurnCost),
			},
		});
	}
	function activeSamples(history) {
		if (!history || !Array.isArray(history.samples)) return [];
		return history.samples.filter(
			(sample) =>
				history._segmentStart == null ||
				sample.timestamp >= history._segmentStart,
		);
	}
	function sampleSeries(history, read) {
		return (
			history && Array.isArray(history.samples) ? history.samples : []
		).map((sample) => ({
			timestamp: sample.timestamp,
			value: read(sample),
		}));
	}
	function rateSeries(history, read, calculate) {
		const samples =
			history && Array.isArray(history.samples) ? history.samples : [];
		const start = history ? history._segmentStart : null;
		let baseline = null;
		return samples.map((sample) => {
			if (start != null && sample.timestamp < start) {
				return { timestamp: sample.timestamp, value: null };
			}
			const after = read(sample);
			if (after == null) {
				baseline = null;
				return { timestamp: sample.timestamp, value: null };
			}
			if (!baseline) {
				baseline = sample;
				return { timestamp: sample.timestamp, value: null };
			}
			const elapsed = (sample.timestamp - baseline.timestamp) / 1000;
			const before = read(baseline);
			if (
				!Number.isFinite(elapsed) ||
				elapsed <= 0 ||
				before == null ||
				after < before
			) {
				baseline = sample;
				return { timestamp: sample.timestamp, value: null };
			}
			return {
				timestamp: sample.timestamp,
				value: calculate(after - before, elapsed, baseline, sample),
			};
		});
	}
	function comparable(history, read) {
		const samples = activeSamples(history);
		if (samples.length < 2 || typeof read !== "function") return null;
		const current = samples[samples.length - 1];
		let index = samples.length - 2;
		let previousIndex;
		if (read(current) == null) {
			while (index >= 0 && read(samples[index]) == null) index--;
			previousIndex = index;
		} else {
			if (index < 0 || read(samples[index]) == null) return null;
			while (index >= 0 && read(samples[index]) != null) index--;
			previousIndex = index + 1;
		}
		const previous = samples[previousIndex];
		if (!previous || previous === current) return null;
		const seconds = (current.timestamp - previous.timestamp) / 1000;
		return {
			previous,
			current,
			seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
		};
	}
	function delta(previous, current, read) {
		const before = read(previous);
		const after = read(current);
		return before == null || after == null || after < before
			? null
			: after - before;
	}
	function formatMetricValue(id, value) {
		if (!Number.isFinite(value)) return "—";
		if (id === "cost-minute" || id === "total")
			return "$" + value.toFixed(id === "total" ? 3 : 4);
		if (
			id === "cache-hit" ||
			id === "tool-error" ||
			id === "context" ||
			id === "headroom"
		)
			return Math.round(value) + "%";
		if (id === "output-tps") return value.toFixed(1) + " tok/s";
		if (id === "avg-output-call") return Math.round(value) + " tok/call";
		if (id === "tool-calls-minute") return value.toFixed(1) + "/min";
		if (id === "turn-duration" || id === "first-token" || id === "tool-latency")
			return value < 1000
				? Math.round(value) + " ms"
				: (value / 1000).toFixed(1) + " s";
		return id === "turns" || id === "pending-tools"
			? String(Math.round(value))
			: value.toFixed(2);
	}
	function metricView(id, label, value, series, reason, direction) {
		const available = Number.isFinite(value);
		return {
			id,
			label,
			valueText: available ? formatMetricValue(id, value) : "—",
			series,
			available,
			reason: available ? undefined : reason,
			direction: direction || "neutral",
		};
	}
	function rateView(
		history,
		id,
		label,
		read,
		calculate,
		reason,
		direction,
		missing,
	) {
		const pair = comparable(history, read);
		const series = rateSeries(history, read, calculate);
		if (!pair || pair.seconds == null)
			return metricView(id, label, null, series, "not-initialized", direction);
		const deltaValue = delta(pair.previous, pair.current, read);
		const value = calculate(
			deltaValue,
			pair.seconds,
			pair.previous,
			pair.current,
		);
		const isMissing = missing
			? missing(pair.previous, pair.current, deltaValue)
			: deltaValue == null;
		return metricView(
			id,
			label,
			value,
			series,
			value == null
				? isMissing
					? "missing-provider-data"
					: reason
				: undefined,
			direction,
		);
	}
	function metricViews(history) {
		const latest = activeSamples(history).slice(-1)[0];
		const currentView = (id, label, read, reason, direction) =>
			metricView(
				id,
				label,
				latest ? read(latest) : null,
				sampleSeries(history, read),
				latest ? reason : "not-initialized",
				direction,
			);
		const rate = (id, label, read, calculate, reason, direction, missing) =>
			rateView(history, id, label, read, calculate, reason, direction, missing);
		const views = [
			currentView(
				"total",
				"total",
				(sample) => sample.counters.cost,
				"missing-provider-data",
			),
			currentView(
				"turns",
				"turns",
				(sample) => sample.counters.modelCalls,
				"missing-provider-data",
			),
			currentView(
				"avg-turn",
				"avg/turn",
				(sample) => sample.derived.averageTurnCost,
				"missing-provider-data",
			),
			currentView(
				"median-turn",
				"median",
				(sample) => sample.derived.medianTurnCost,
				"missing-provider-data",
			),
			rate(
				"output-tps",
				"output tok/s",
				(sample) => sample.counters.outputTokens,
				(deltaValue, seconds) =>
					deltaValue == null ? null : deltaValue / seconds,
				"missing-provider-data",
				"higher-is-better",
			),
			rate(
				"avg-output-call",
				"avg output/call",
				(sample) => sample.counters.outputTokens,
				(deltaValue, _seconds, previous, current) => {
					const calls = delta(previous, current, (s) => s.counters.modelCalls);
					return deltaValue == null
						? null
						: calls > 0
							? deltaValue / calls
							: null;
				},
				"no-completed-calls",
				"neutral",
				(previous, current, outputDelta) =>
					outputDelta == null ||
					delta(previous, current, (sample) => sample.counters.modelCalls) ==
						null,
			),
			rate(
				"cost-minute",
				"cost/min",
				(sample) => sample.counters.cost,
				(deltaValue, seconds) =>
					deltaValue == null ? null : deltaValue / (seconds / 60),
				"missing-provider-data",
				"lower-is-better",
			),
			rate(
				"cache-hit",
				"cache hit",
				(sample) => sample.counters.cacheReadTokens,
				(deltaValue, _seconds, previous, current) => {
					const fresh = delta(
						previous,
						current,
						(sample) => sample.counters.inputTokens,
					);
					const total =
						deltaValue == null || fresh == null ? null : deltaValue + fresh;
					return total > 0 ? (deltaValue / total) * 100 : null;
				},
				"idle",
				"higher-is-better",
				(previous, current, cacheDelta) =>
					cacheDelta == null ||
					delta(previous, current, (sample) => sample.counters.inputTokens) ==
						null,
			),
			rate(
				"tool-error",
				"tool error",
				(sample) => sample.counters.toolErrors,
				(deltaValue, _seconds, previous, current) => {
					const calls = delta(previous, current, (s) => s.counters.toolCalls);
					return deltaValue == null
						? null
						: calls > 0
							? (deltaValue / calls) * 100
							: null;
				},
				"no-completed-calls",
				"lower-is-better",
				(previous, current, errorDelta) =>
					errorDelta == null ||
					delta(previous, current, (sample) => sample.counters.toolCalls) ==
						null,
			),
			rate(
				"tool-calls-minute",
				"tool calls/min",
				(sample) => sample.counters.toolCalls,
				(deltaValue, seconds) =>
					deltaValue == null || deltaValue <= 0
						? null
						: deltaValue / (seconds / 60),
				"no-completed-calls",
				"neutral",
			),
			currentView(
				"pending-tools",
				"pending tools",
				(sample) => sample.live.pendingTools,
				"missing-provider-data",
				"lower-is-better",
			),
			currentView(
				"context",
				"context",
				(sample) => sample.context.percent,
				"missing-provider-data",
				"lower-is-better",
			),
			currentView(
				"headroom",
				"headroom",
				(sample) =>
					sample.context.percent == null ? null : 100 - sample.context.percent,
				"missing-provider-data",
				"higher-is-better",
			),
		];
		const duration = (id, label, total, countName) => {
			const read = (sample) => sample.durations[total];
			const series = rateSeries(
				history,
				read,
				(deltaValue, _seconds, previous, current) => {
					const countDelta = delta(
						previous,
						current,
						(sample) => sample.durations[countName],
					);
					return countDelta > 0 ? deltaValue / countDelta : null;
				},
			);
			const pair = comparable(history, read);
			let value = null;
			let reason = "not-initialized";
			if (pair && pair.seconds != null) {
				const totalDelta = delta(pair.previous, pair.current, read);
				const countDelta = delta(
					pair.previous,
					pair.current,
					(sample) => sample.durations[countName],
				);
				if (totalDelta == null || countDelta == null)
					reason = "no-duration-data";
				else if (countDelta > 0) {
					value = totalDelta / countDelta;
					reason = undefined;
				} else reason = "no-duration-data";
			}
			return metricView(id, label, value, series, reason, "lower-is-better");
		};
		views.push(
			duration("turn-duration", "turn duration", "turnMs", "turnCount"),
			duration(
				"first-token",
				"time to first token",
				"timeToFirstTokenMs",
				"firstTokenCount",
			),
			duration("tool-latency", "tool latency", "toolMs", "toolCount"),
		);
		return views;
	}
	function downsampleSeries(series, limit) {
		const entries = Array.isArray(series) ? series : [];
		const maxPoints =
			Number.isFinite(limit) && limit > 0
				? Math.trunc(limit)
				: MAX_SPARK_POINTS;
		if (entries.length <= maxPoints) return entries.slice();
		const readValue = (entry) =>
			typeof entry === "number" ? entry : entry && entry.value;
		const timestamps = entries.map((entry) =>
			entry && typeof entry === "object" ? finite(entry.timestamp) : null,
		);
		const finiteTimes = timestamps.filter((value) => Number.isFinite(value));
		const timeMin = finiteTimes.length ? Math.min(...finiteTimes) : null;
		const timeMax = finiteTimes.length ? Math.max(...finiteTimes) : null;
		const timeSpan =
			timeMin != null && timeMax != null && timeMax > timeMin
				? timeMax - timeMin
				: null;
		const bucketCount = Math.min(maxPoints, entries.length);
		const buckets = Array.from({ length: bucketCount }, () => []);
		for (let index = 0; index < entries.length; index++) {
			const slot =
				timeSpan != null && Number.isFinite(timestamps[index])
					? Math.min(
							bucketCount - 1,
							Math.max(
								0,
								Math.floor(
									((timestamps[index] - timeMin) / timeSpan) * bucketCount,
								),
							),
						)
					: Math.floor((index * bucketCount) / entries.length);
			buckets[slot].push(entries[index]);
		}
		return buckets.map((bucket, index) => {
			const numeric = bucket
				.map(readValue)
				.filter((value) => Number.isFinite(value));
			const hasMissing =
				bucket.length === 0 ||
				bucket.some((entry) => !Number.isFinite(readValue(entry)));
			const bucketTimes = bucket
				.map((entry) =>
					entry && typeof entry === "object" ? finite(entry.timestamp) : null,
				)
				.filter((value) => Number.isFinite(value));
			const timestamp = bucketTimes.length
				? bucketTimes.reduce((sum, value) => sum + value, 0) /
					bucketTimes.length
				: timeSpan != null
					? timeMin + ((index + 0.5) * timeSpan) / bucketCount
					: index;
			return {
				timestamp,
				value: hasMissing
					? null
					: numeric.reduce((sum, value) => sum + value, 0) / numeric.length,
			};
		});
	}
	function sparklineGeometry(series, width, height) {
		const w = Number.isFinite(width) && width > 0 ? width : 100;
		const h = Number.isFinite(height) && height > 0 ? height : 24;
		const entries = downsampleSeries(series, MAX_SPARK_POINTS);
		const values = entries.map((entry) =>
			typeof entry === "number" ? entry : entry && entry.value,
		);
		const timestamps = entries.map((entry) =>
			entry && typeof entry === "object" ? finite(entry.timestamp) : null,
		);
		const finiteValues = values.filter((value) => Number.isFinite(value));
		const validCount = finiteValues.length;
		if (validCount < 2)
			return {
				width: w,
				height: h,
				validCount,
				flat: false,
				points: [],
				segments: [],
				path: "",
			};
		const min = Math.min(...finiteValues);
		const max = Math.max(...finiteValues);
		const flat = min === max;
		const finiteTimes = timestamps.filter((value) => Number.isFinite(value));
		const timeMin = finiteTimes.length ? Math.min(...finiteTimes) : null;
		const timeMax = finiteTimes.length ? Math.max(...finiteTimes) : null;
		const timeSpan =
			timeMin != null && timeMax != null && timeMax > timeMin
				? timeMax - timeMin
				: null;
		const points = values.map((value, index) => {
			if (!Number.isFinite(value)) return null;
			const x =
				timeSpan != null && Number.isFinite(timestamps[index])
					? ((timestamps[index] - timeMin) / timeSpan) * w
					: values.length > 1
						? (index / (values.length - 1)) * w
						: 0;
			const y = flat ? h / 2 : h - ((value - min) / (max - min)) * h;
			return { x, y, value };
		});
		const segments = [];
		let segment = [];
		for (const point of points) {
			if (point) segment.push(point);
			else if (segment.length) {
				segments.push(segment);
				segment = [];
			}
		}
		if (segment.length) segments.push(segment);
		const path = segments
			.map((part) =>
				part
					.map(
						(point, index) =>
							(index ? "L" : "M") +
							point.x.toFixed(2) +
							"," +
							point.y.toFixed(2),
					)
					.join(" "),
			)
			.join(" ");
		return { width: w, height: h, validCount, flat, points, segments, path };
	}
	function sparklineSvg(series, width, height) {
		const geometry = sparklineGeometry(series, width, height);
		if (geometry.validCount < 2 || !geometry.path) return "";
		return (
			'<svg class="an-spark" viewBox="0 0 ' +
			geometry.width +
			" " +
			geometry.height +
			'" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d="' +
			geometry.path +
			'" /></svg>'
		);
	}
	function reasonText(reason) {
		return (
			{
				idle: "idle",
				"missing-provider-data": "data unavailable",
				"no-completed-calls": "no completed calls",
				"no-duration-data": "no duration data",
				"not-initialized": "waiting for baseline",
			}[reason] || "unavailable"
		);
	}
	function metricCardParts(view) {
		const item = view && typeof view === "object" ? view : {};
		const available = item.available === true;
		return {
			id: typeof item.id === "string" ? item.id : "metric",
			label: typeof item.label === "string" ? item.label : "metric",
			valueText: typeof item.valueText === "string" ? item.valueText : "—",
			stateText: available ? "" : reasonText(item.reason),
			trendHtml: sparklineSvg(item.series),
		};
	}

	const EVENT_ID_LIMIT = 2048;
	function eventId(value) {
		if (typeof value === "string" && value) return value;
		if (typeof value === "number" && Number.isFinite(value))
			return String(value);
		return null;
	}
	function eventTime(value) {
		return finite(value);
	}
	function seedValue(source, name, normalizer) {
		return normalizer(source && source[name]) || 0;
	}
	function createEventLedger(seed) {
		const seedDurations =
			seed && seed.durations && typeof seed.durations === "object"
				? seed.durations
				: {};
		const state = {
			activeTurn: null,
			activeTools: new Map(),
			completedTurnIds: new Set(),
			completedToolIds: new Set(),
			completedTurnQueue: [],
			completedToolQueue: [],
			durations: {
				turnMs: seedValue(seedDurations, "turnMs", nonNegative),
				timeToFirstTokenMs: seedValue(
					seedDurations,
					"timeToFirstTokenMs",
					nonNegative,
				),
				toolMs: seedValue(seedDurations, "toolMs", nonNegative),
				turnCount: seedValue(seedDurations, "turnCount", count),
				firstTokenCount: seedValue(seedDurations, "firstTokenCount", count),
				toolCount: seedValue(seedDurations, "toolCount", count),
			},
			toolErrors: seedValue(seed, "toolErrors", count),
		};

		function remember(set, queue, id) {
			if (id == null || set.has(id)) return;
			set.add(id);
			queue.push(id);
			while (queue.length > EVENT_ID_LIMIT) set.delete(queue.shift());
		}
		function matches(active, supplied) {
			const key = eventId(supplied);
			return key == null ? true : active && active.id === key;
		}
		function startTurn(id, at) {
			const when = eventTime(at);
			const key = eventId(id);
			if (when == null || state.activeTurn) return false;
			if (key != null && state.completedTurnIds.has(key)) return false;
			state.activeTurn = { id: key, startAt: when, firstAt: null };
			return true;
		}
		function markFirstToken(id, at) {
			const when = eventTime(at);
			const active = state.activeTurn;
			if (
				when == null ||
				!active ||
				!matches(active, id) ||
				active.firstAt != null ||
				when < active.startAt
			)
				return false;
			active.firstAt = when;
			return true;
		}
		function endTurn(id, at) {
			const when = eventTime(at);
			const active = state.activeTurn;
			if (
				when == null ||
				!active ||
				!matches(active, id) ||
				when < active.startAt
			)
				return false;
			state.durations.turnMs += when - active.startAt;
			state.durations.turnCount += 1;
			if (active.firstAt != null) {
				state.durations.timeToFirstTokenMs += active.firstAt - active.startAt;
				state.durations.firstTokenCount += 1;
			}
			if (active.id != null)
				remember(state.completedTurnIds, state.completedTurnQueue, active.id);
			state.activeTurn = null;
			return true;
		}
		function startTool(id, name, at) {
			const when = eventTime(at);
			const key = eventId(id);
			if (
				when == null ||
				key == null ||
				state.activeTools.has(key) ||
				state.completedToolIds.has(key)
			)
				return false;
			state.activeTools.set(key, {
				id: key,
				name: name || "tool",
				startAt: when,
				pausedAt: null,
				pausedMs: 0,
			});
			return true;
		}
		function pauseTool(id, at) {
			const when = eventTime(at);
			const key = eventId(id);
			const active = key == null ? null : state.activeTools.get(key);
			if (
				!active ||
				when == null ||
				when < active.startAt ||
				active.pausedAt != null
			)
				return false;
			active.pausedAt = when;
			return true;
		}
		function resumeTool(id, at) {
			const when = eventTime(at);
			const key = eventId(id);
			const active = key == null ? null : state.activeTools.get(key);
			if (
				!active ||
				when == null ||
				active.pausedAt == null ||
				when < active.pausedAt
			)
				return false;
			active.pausedMs += when - active.pausedAt;
			active.pausedAt = null;
			return true;
		}
		function endTool(id, at, isError) {
			const when = eventTime(at);
			const key = eventId(id);
			const active = key == null ? null : state.activeTools.get(key);
			if (!active || when == null || when < active.startAt) return false;
			const pausedMs =
				active.pausedMs +
				(active.pausedAt == null ? 0 : when - active.pausedAt);
			state.activeTools.delete(key);
			state.durations.toolMs += Math.max(0, when - active.startAt - pausedMs);
			state.durations.toolCount += 1;
			if (isError === true) state.toolErrors += 1;
			remember(state.completedToolIds, state.completedToolQueue, key);
			return true;
		}
		function snapshot() {
			return {
				pendingTools: state.activeTools.size,
				activeTurn: !!state.activeTurn,
				toolErrors: state.toolErrors,
				durations: { ...state.durations },
			};
		}
		function reset(nextSeed) {
			const fresh = createEventLedger(nextSeed);
			state.activeTurn = fresh._state.activeTurn;
			state.activeTools = fresh._state.activeTools;
			state.completedTurnIds = fresh._state.completedTurnIds;
			state.completedToolIds = fresh._state.completedToolIds;
			state.completedTurnQueue = fresh._state.completedTurnQueue;
			state.completedToolQueue = fresh._state.completedToolQueue;
			state.durations = fresh._state.durations;
			state.toolErrors = fresh._state.toolErrors;
			return api;
		}
		const api = {
			startTurn,
			markFirstToken,
			endTurn,
			startTool,
			pauseTool,
			resumeTool,
			endTool,
			snapshot,
			reset,
			_state: state,
		};
		return api;
	}

	const api = {
		WINDOW_MS,
		MAX_SAMPLES,
		MAX_SPARK_POINTS,
		MAX_STORED_SESSIONS,
		STORAGE_VERSION,
		STORAGE_KEY,
		normalizeSample,
		createHistory,
		resetHistory,
		ensureSession,
		pauseHistory,
		resumeHistory,
		appendSample,
		trimHistory,
		saveHistory,
		loadHistory,
		clearStoredHistory,
		sampleFromAnalysis,
		metricViews,
		formatMetricValue,
		metricCardParts,
		downsampleSeries,
		sparklineGeometry,
		sparklineSvg,
		EVENT_ID_LIMIT,
		createEventLedger,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.usageTelemetry = api;
})();
