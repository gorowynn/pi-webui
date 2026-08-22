// sidebar-ux.js — pure workspace/session view projections.
// Dual-mode: browser global for app.js and CommonJS for focused tests.
((root, factory) => {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.sidebarUx = factory();
})(typeof self !== "undefined" ? self : this, () => {
	function sidebarState() {
		return { expanded: false, query: "" };
	}

	function workspaceView(workspaces, state) {
		const rows = Array.isArray(workspaces) ? workspaces.slice() : [];
		const active = rows.find((w) => w && w.active) || null;
		const expanded = !active || Boolean(state && state.expanded);
		return {
			rows: expanded ? rows : [active],
			activePath: active && active.path ? active.path : null,
			expanded,
			canExpand: rows.some((w) => w && !w.active),
			status:
				state && state.status === "error"
					? "error"
					: rows.length
						? "ready"
						: "empty",
		};
	}

	function sessionText(session) {
		return [
			session && session.name,
			session && session.preview,
			session && session.firstPrompt,
		]
			.filter((value) => value != null)
			.join(" ")
			.toLocaleLowerCase();
	}

	function sessionView(sessions, query) {
		const rows = Array.isArray(sessions) ? sessions.slice() : [];
		const q = String(query || "")
			.trim()
			.toLocaleLowerCase();
		const filtered = q
			? rows.filter((session) => sessionText(session).includes(q))
			: rows;
		return {
			rows: filtered,
			query: String(query || ""),
			total: rows.length,
			count: filtered.length,
			empty: filtered.length === 0,
		};
	}

	function resetState() {
		return sidebarState();
	}

	return { sidebarState, workspaceView, sessionText, sessionView, resetState };
});
