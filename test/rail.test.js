// rail.js — pure workspace-tools-rail state (W1 / spec FR-1, FR-4, FR-8)
// Widget table shape, persistence (pi:rail + legacy pi:sddbar migration),
// and open-generation stamps for stale-response ignoring.
const path = require("node:path");
const rail = require(path.join(__dirname, "..", "public", "rail.js"));

function memStorage(initial = {}) {
	const m = new Map(Object.entries(initial));
	return {
		getItem: (k) => (m.has(k) ? m.get(k) : null),
		setItem: (k, v) => void m.set(k, v),
		_dump: () => Object.fromEntries(m),
	};
}

let n = 0;
const ok = (name) => console.log(`  ok - ${name}`);
const check = (cond, name) => {
	if (!cond) throw new Error(name);
	n++;
	ok(name);
};

// ---- FR-1: fixed widget table ----
check(
	Array.isArray(rail.WIDGET_IDS) &&
		Object.isFrozen(rail.WIDGET_IDS) &&
		rail.WIDGET_IDS.join(",") === "sdd,analysis,git,quotas,todos",
	"WIDGET_IDS is the frozen 5-list",
);
check(
	!rail.WIDGET_IDS.includes("permissions"),
	"permissions is NOT a widget (launcher only)",
);

// ---- FR-4: persistence round-trip ----
{
	const st = memStorage();
	const rs = rail.createRailState({ storage: st });
	rs.save({ widget: "git", open: true, width: 320 });
	const rs2 = rail.createRailState({ storage: st });
	const s = rs2.load();
	check(
		s.widget === "git" && s.open === true && s.width === 320,
		"pi:rail round-trips",
	);
}

// ---- FR-4: unknown widget id -> closed panel ----
{
	const st = memStorage({
		"pi:rail": JSON.stringify({ widget: "nope", open: true, width: 300 }),
	});
	const s = rail.createRailState({ storage: st }).load();
	check(
		s.widget === null && s.open === false,
		"unknown widget id falls back to closed",
	);
}

// ---- FR-4: legacy pi:sddbar one-time migration ----
{
	const st = memStorage({
		"pi:sddbar": JSON.stringify({ open: true, rel: "plan_x_1.md" }),
	});
	const rs = rail.createRailState({ storage: st });
	const s = rs.load();
	check(
		s.widget === "sdd" && s.open === true,
		"legacy open sddbar migrates to widget:sdd open",
	);
	// save persists pi:rail; legacy key left in place (harmless)
	rs.save({ widget: "sdd", open: false, width: 300 });
	check(
		st.getItem("pi:rail") !== null && st.getItem("pi:sddbar") !== null,
		"migration writes pi:rail, leaves legacy key",
	);
}
{
	const st = memStorage({
		"pi:sddbar": JSON.stringify({ open: false }),
	});
	const s = rail.createRailState({ storage: st }).load();
	check(s.open === false, "legacy closed sddbar migrates closed");
}
{
	// pi:rail present -> legacy ignored entirely
	const st = memStorage({
		"pi:rail": JSON.stringify({ widget: "todos", open: true, width: 400 }),
		"pi:sddbar": JSON.stringify({ open: true }),
	});
	const s = rail.createRailState({ storage: st }).load();
	check(s.widget === "todos", "pi:rail present -> legacy ignored");
}

// ---- FR-8: open-generation stamps ----
{
	const gen = rail.createGen();
	const g1 = gen.open();
	const g2 = gen.open();
	check(g2 > g1, "open() returns monotonically increasing gen");
	check(!gen.stale(g2), "current gen is not stale");
	check(gen.stale(g1), "gen from a previous open is stale");
}

// ---- sanity: missing/corrupt storage degrades closed ----
{
	const s = rail.createRailState({ storage: memStorage() }).load();
	check(s.widget === null && s.open === false, "empty storage -> closed");
	const st = memStorage({ "pi:rail": "{not json" });
	const s2 = rail.createRailState({ storage: st }).load();
	check(s2.open === false, "corrupt pi:rail -> closed, no throw");
}

console.log(`rail: ${n} checks`);

// ---- W1 chunk 3: widget table contract + SDD visibility/badge (pure) ----
{
	const REQUIRED = [
		"id",
		"label",
		"icon",
		"badge",
		"render",
		"",
		"onOpen",
		"onClose",
		"commandId",
		"refresh",
	].filter((k) => k !== "");
	const good = {
		id: "git",
		label: "Git",
		icon: "⑂",
		badge: () => ({ text: "", tone: "none" }),
		render: () => {},
		onOpen: () => {},
		onClose: () => {},
		commandId: "git",
		refresh: "on-open",
	};
	check(
		rail.validWidgetEntry(good) === true,
		"validWidgetEntry accepts a full entry",
	);
	for (const k of REQUIRED) {
		const bad = { ...good };
		delete bad[k];
		check(
			rail.validWidgetEntry(bad) === false,
			`validWidgetEntry rejects missing ${k}`,
		);
	}
	check(
		rail.validWidgetEntry({ ...good, id: "permissions" }) === false,
		"validWidgetEntry rejects non-registered id",
	);
	check(
		rail.validWidgetEntry({ ...good, refresh: "sometimes" }) === false,
		"validWidgetEntry rejects unknown refresh policy",
	);

	// SDD visibility (# FR-11): hidden with no set; shown while active; hidden
	// once the set reaches verify (archive hides the rail entry)
	check(rail.sddVisibility(null) === false, "sdd hidden with no active set");
	check(
		rail.sddVisibility({ phase: "tasks", finished: false }) === true,
		"sdd shown while set active",
	);
	check(
		rail.sddVisibility({ phase: "verify", finished: false }) === false,
		"sdd hidden at verify (archive point)",
	);
	check(
		rail.sddVisibility({ phase: "plan", finished: true }) === false,
		"sdd hidden when finished",
	);

	// SDD badge (# FR-6 partial): phase text + meta, tone none (informational)
	check(
		JSON.stringify(rail.sddBadge({ phase: "spec", done: 2, total: 9 })) ===
			JSON.stringify({ text: "spec 2/9", tone: "none" }),
		"sdd badge maps phase + chunk progress",
	);
	check(
		JSON.stringify(rail.sddBadge(null)) ===
			JSON.stringify({ text: "", tone: "none" }),
		"sdd badge empty when no set",
	);
}

// app.js string contract: all five widgets registered + table wiring (# FR-1)
{
	const fs = require("node:fs");
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);
	for (const id of rail.WIDGET_IDS) {
		check(app.includes(`id: "${id}"`), `app.js registers widget '${id}'`);
	}
	check(
		app.includes("validWidgetEntry"),
		"app.js validates table entries through rail.js",
	);
	check(app.includes("openRailWidget"), "app.js has the generic widget opener");
	check(app.includes('"pi:rail:sdd"'), "sdd doc pointer moved to pi:rail:sdd");
}

// ---- W1 chunk 4: pure badge builders (# FR-6, FR-7) ----
{
	const N = JSON.stringify({ text: "", tone: "none" });
	check(
		JSON.stringify(rail.gitBadge({ changed: 3 })) ===
			JSON.stringify({ text: "3 changed", tone: "warn" }),
		"gitBadge: dirty tree -> warn",
	);
	check(
		JSON.stringify(rail.gitBadge({ changed: 0 })) === N,
		"gitBadge: clean -> none",
	);
	check(
		JSON.stringify(rail.gitBadge(null)) === N,
		"gitBadge: no snapshot -> none",
	);

	check(
		JSON.stringify(
			rail.todosBadge([
				{ status: "open" },
				{ status: "started" },
				{ status: "finished" },
			]),
		) === JSON.stringify({ text: "2 open", tone: "none" }),
		"todosBadge: open count",
	);
	check(
		JSON.stringify(rail.todosBadge([{ status: "finished" }])) === N,
		"todosBadge: all done -> none (hide-when-done parity)",
	);
	check(JSON.stringify(rail.todosBadge([])) === N, "todosBadge: empty -> none");

	check(
		JSON.stringify(rail.approvalsBadge(1)) ===
			JSON.stringify({ text: "1 pending", tone: "err" }),
		"approvalsBadge: pending -> err",
	);
	check(JSON.stringify(rail.approvalsBadge(0)) === N, "approvalsBadge: none");

	check(
		JSON.stringify(rail.quotaBadge(92)) ===
			JSON.stringify({ text: "92%", tone: "err" }),
		"quotaBadge: >=90 err",
	);
	check(
		JSON.stringify(rail.quotaBadge(80)) ===
			JSON.stringify({ text: "80%", tone: "warn" }),
		"quotaBadge: >=75 warn",
	);
	check(
		JSON.stringify(rail.quotaBadge(40)) === N,
		"quotaBadge: healthy -> none",
	);
}
{
	// app.js wiring: permissions launcher in the rail, outside the widget table
	const fs = require("node:fs");
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);
	check(
		app.includes("rail-perm") && app.includes('"#permissions"'),
		"permissions launcher routes to the dedicated page (# FR-7)",
	);
	check(
		app.includes("approvalsBadge"),
		"launcher badge uses the pure approvalsBadge (# FR-7)",
	);
}

// ---- W1 chunk 5: palette parity routing (# FR-10) ----
{
	const railFn = () => "rail";
	const modalFn = () => "modal";
	check(
		rail.paletteRoute(true, railFn, modalFn) === railFn,
		"paletteRoute: parity true -> rail widget",
	);
	check(
		rail.paletteRoute(false, railFn, modalFn) === modalFn,
		"paletteRoute: parity false -> legacy modal",
	);
}
{
	const fs = require("node:fs");
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);
	check(
		app.includes("const PARITY"),
		"PARITY flags defined (FR-10 migration gates)",
	);
	check(
		/paletteRoute\(\s*PARITY\.analysis/.test(app),
		"session usage command routes through parity (# FR-10)",
	);
	check(
		app.includes("function analysisBody"),
		"analysis body extracted (shared modal/rail renderer)",
	);
}

// ---- W1 chunk 6: git widget wiring contract (# FR-8, FR-10, FR-11) ----
{
	const fs = require("node:fs");
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);
	check(
		app.includes("railGen.stale(g)"),
		"git fetch is gen-stamped; stale responses dropped (# FR-8)",
	);
	check(
		app.includes("gitBadgeSnap"),
		"git badge fed from the fetched snapshot (# FR-6)",
	);
	check(
		app.includes("paletteRoute(PARITY.git"),
		"git command routes through parity (# FR-10)",
	);
	check(
		app.includes("gitConfirm(action") &&
			app.includes("window.confirm(question)"),
		"mutations keep confirm gates (unchanged handlers) (# FR-11)",
	);
}

// ---- W1 chunk 7: quotas + todos wiring contract (# FR-8, FR-10, FR-11) ----
{
	const fs = require("node:fs");
	const app = fs.readFileSync(
		path.join(__dirname, "..", "public", "app.js"),
		"utf8",
	);
	check(
		/quotasRender[\s\S]{0,500}railGen\.stale/.test(app),
		"quota fetch gen-stamped (# FR-8)",
	);
	check(
		app.includes("function todosRender") &&
			app.includes("function todoRowHtml"),
		"todos rail render shares the row builder with the in-flow panel (# FR-11)",
	);
	check(
		app.includes('() => openRailWidget("quotas")') &&
			app.includes('() => openRailWidget("todos")'),
		"quotas + todos palette commands open the rail widget directly (W1)",
	);
	check(
		!app.includes("todopanel") &&
			app.includes("function renderTodos") &&
			/railWidget && railWidget\.id === "todos"/.test(app),
		"todos moved fully to the rail widget (no in-flow panel) (W1)",
	);
	check(
		!app.includes("usageBar.style") &&
			/refreshUsageBar[\s\S]{0,400}quotaBadgePct/.test(app),
		"quota state feeds the rail badge/panel, no header element (W1)",
	);
	check(
		/setInterval\(\(\) => \{[\s\S]{0,300}railRenderDue/.test(app) &&
			/interval:60000/.test(app) &&
			/interval:10000/.test(app),
		"open rail widget auto-refreshes on its declared cadence (FR-8)",
	);
	check(
		app.includes("renderUsage(provider)"),
		"quota detail reuses renderUsage (dashboard note for no-API providers) (# FR-11)",
	);
}

console.log(`rail: ${n} checks (chunks 3-7 included)`);
