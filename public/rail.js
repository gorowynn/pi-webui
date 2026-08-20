// rail.js — workspace-tools rail pure state (W1 / spec FR-1, FR-4, FR-8).
// Zero-dep, dual-mode: window.rail in the browser (loaded before app.js),
// require-able in Node for tests. NO DOM here — app.js owns rendering.
//
// FR-1: the widget table is FIXED — five entries, no runtime registration
// (permissions is a dedicated launcher button, not a widget).
// FR-4: rail state persists as {widget, open, width} in localStorage
// "pi:rail"; a legacy "pi:sddbar" {open} migrates once (widget:"sdd").
// FR-8: every panel open stamps a generation; responses issued under an
// older generation are stale and must be ignored by the fetcher.
((root) => {
	var WIDGET_IDS = Object.freeze(["sdd", "analysis", "git", "quotas", "todos"]);

	var LEGACY_KEY = "pi:sddbar";
	var STATE_KEY = "pi:rail";

	function isWidgetId(id) {
		return WIDGET_IDS.indexOf(id) >= 0;
	}

	/** FR-4: load rail state, migrating legacy pi:sddbar once. Pure-ish:
	 * storage is injected ({getItem,setItem}) so tests need no jsdom. */
	function createRailState(opts) {
		var storage =
			opts && opts.storage
				? opts.storage
				: root && root.localStorage
					? root.localStorage
					: null;
		var get = (k) => {
			try {
				return storage ? storage.getItem(k) : null;
			} catch {
				return null;
			}
		};
		var set = (k, v) => {
			try {
				if (storage) storage.setItem(k, v);
			} catch {
				/* quota/private-mode — degrade silently */
			}
		};

		function load() {
			var raw = get(STATE_KEY);
			if (raw) {
				try {
					var s = JSON.parse(raw);
					var widget = isWidgetId(s.widget) ? s.widget : null;
					return {
						widget: widget,
						open: widget ? !!s.open : false,
						width: typeof s.width === "number" ? s.width : undefined,
					};
				} catch {
					// corrupt — fall through to legacy/closed
				}
			}
			// one-time legacy migration: an open sddbar meant the SDD pane
			var lraw = get(LEGACY_KEY);
			if (lraw) {
				try {
					var l = JSON.parse(lraw);
					return {
						widget: l.open ? "sdd" : null,
						open: !!l.open,
						width: typeof l.width === "number" ? l.width : undefined,
					};
				} catch {
					/* corrupt legacy — closed */
				}
			}
			return { widget: null, open: false, width: undefined };
		}

		function save(state) {
			set(
				STATE_KEY,
				JSON.stringify({
					widget: isWidgetId(state.widget) ? state.widget : null,
					open: !!state.open,
					width: typeof state.width === "number" ? state.width : undefined,
				}),
			);
		}

		return { load: load, save: save };
	}

	/** FR-8: generation stamps — open() invalidates everything earlier. */
	function createGen() {
		var n = 0;
		return {
			open: () => ++n,
			cur: () => n,
			stale: (g) => g !== n,
		};
	}

	/** FR-1: shape guard for the fixed widget table (app.js owns the table;
	 * this validates entries defensively at registration). */
	var REFRESH_POLICIES = ["on-open", "manual", /^interval:\d+$/];
	function validRefresh(r) {
		return REFRESH_POLICIES.some((p) =>
			typeof p === "string" ? p === r : p.test(r),
		);
	}
	function validWidgetEntry(e) {
		return (
			!!e &&
			isWidgetId(e.id) &&
			typeof e.label === "string" &&
			typeof e.icon === "string" &&
			typeof e.badge === "function" &&
			typeof e.render === "function" &&
			typeof e.onOpen === "function" &&
			typeof e.onClose === "function" &&
			typeof e.commandId === "string" &&
			validRefresh(e.refresh)
		);
	}

	/** FR-11 (SDD parity): the SDD tab shows only while a set is mid-flight.
	 * summary = activeSet() projection {phase, finished} or null. At `verify`
	 * the skill archives the set — the entry disappears (unchanged behavior). */
	function sddVisibility(summary) {
		if (!summary || summary.finished) return false;
		return summary.phase !== "verify";
	}

	/** FR-6 (partial): informational badge for the SDD tab. */
	function sddBadge(summary) {
		if (!summary || summary.finished) return { text: "", tone: "none" };
		var meta =
			typeof summary.done === "number" && summary.total
				? " " + summary.done + "/" + summary.total
				: "";
		return { text: summary.phase + meta, tone: "none" };
	}

	/** FR-6: pure badge builders over existing client state. Every badge
	 * carries text (never color alone); empty state = {text:"", tone:"none"}. */
	var NO_BADGE = { text: "", tone: "none" };
	function gitBadge(snap) {
		if (!snap || !snap.changed) return { text: "", tone: "none" };
		return { text: snap.changed + " changed", tone: "warn" };
	}
	function todosBadge(list) {
		if (!list || !list.length) return NO_BADGE;
		var open = list.filter((t) => t.status !== "finished").length;
		// hide-when-all-done parity (FR-11): a finished list has no badge
		return open ? { text: open + " open", tone: "none" } : NO_BADGE;
	}
	function approvalsBadge(pending) {
		return pending > 0 ? { text: pending + " pending", tone: "err" } : NO_BADGE;
	}
	function quotaBadge(pct) {
		if (typeof pct !== "number") return NO_BADGE;
		if (pct >= 90) return { text: Math.round(pct) + "%", tone: "err" };
		if (pct >= 75) return { text: Math.round(pct) + "%", tone: "warn" };
		return NO_BADGE;
	}

	/** FR-10: palette command routing under a per-widget parity flag —
	 * rail version once smokes pass, legacy modal until then. */
	function paletteRoute(parity, railFn, modalFn) {
		return parity ? railFn : modalFn;
	}

	var api = {
		WIDGET_IDS: WIDGET_IDS,
		isWidgetId: isWidgetId,
		createRailState: createRailState,
		createGen: createGen,
		validWidgetEntry: validWidgetEntry,
		sddVisibility: sddVisibility,
		sddBadge: sddBadge,
		gitBadge: gitBadge,
		todosBadge: todosBadge,
		approvalsBadge: approvalsBadge,
		quotaBadge: quotaBadge,
		paletteRoute: paletteRoute,
	};

	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else root.rail = api;
})(typeof window !== "undefined" ? window : globalThis);
