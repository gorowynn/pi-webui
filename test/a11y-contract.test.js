// test/a11y-contract.test.js — source-level a11y audit (FR-4/5, FR-6..12).
// Zero-dep. Scans the REAL public files, same pattern as diff-contract.test.js.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public", "style.css"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

// ---- helpers ----------------------------------------------------------------

function openingTags(src, tag) {
	const re = new RegExp(`<${tag}\\b[^>]*>`, "g");
	const out = [];
	let m;
	while ((m = re.exec(src))) out.push(m[0]);
	return out;
}

function tagClasses(tag) {
	// quote/plus-tolerant: chunked template strings (class="an-bar' + …)
	for (const m of tag.matchAll(/class="([^"]*)/g)) {
		const parts = m[1].split(/['"\s+]/);
		if (parts.some((p) => p)) return parts.filter(Boolean);
	}
	const m = tag.match(/class='([^']*)/);
	return m ? m[1].split(/['"\s+]/).filter(Boolean) : [];
}

/** Class names appearing in markup class attributes in a source file. */
function liveClasses(src) {
	const out = new Set();
	// quote-tolerant: template chunks can split the attr mid-string
	// (e.g. `class="an-bar' + cond + '"`), so don't require a closing quote
	for (const m of src.matchAll(/class="([^"]*)/g)) {
		for (const c of m[1].split(/['"\s+]/)) if (c) out.add(c);
	}
	for (const m of src.matchAll(/class='([^']*)/g)) {
		for (const c of m[1].split(/['"\s+]/)) if (c) out.add(c);
	}
	// className assignments built via createElement paths
	for (const m of src.matchAll(/\.className\s*=\s*"([^"]+)"/g)) {
		out.add(m[1]);
	}
	return [...out];
}

/** True when a class appears inside a native <button>/<summary> opening tag. */
function inNativeTag(src, cls) {
	for (const tag of [
		...openingTags(src, "button"),
		...openingTags(src, "summary"),
	]) {
		if (tagClasses(tag).includes(cls)) return true;
	}
	return false;
}

/** True when a class appears inside a <div>/<span> opening tag. */
function inDivTag(src, cls) {
	for (const tag of [...openingTags(src, "div"), ...openingTags(src, "span")]) {
		if (tagClasses(tag).includes(cls)) return true;
	}
	return false;
}

/** Selector strings of rules containing `:hover`, from a CSS text. */
function hoverRules(css) {
	const out = [];
	const re = /:hover/g;
	let m;
	while ((m = re.exec(css))) {
		// selector runs from after the previous `{`/`}` to the rule's own `{`
		const start =
			Math.max(css.lastIndexOf("{", m.index), css.lastIndexOf("}", m.index)) +
			1;
		const end = css.indexOf("{", m.index);
		if (end === -1 || end < m.index) continue;
		const sel = css.slice(start, end).replace(/\s+/g, " ").trim();
		if (sel && !sel.startsWith("@media")) out.push(sel);
	}
	return out;
}

assert.deepEqual(
	hoverRules(
		".a:hover { color: red; } .b:hover, .b:focus-visible { } @media (hover: none) { .c:hover { } }",
	),
	[".a:hover", ".b:hover, .b:focus-visible", ".c:hover"],
	"hoverRules: rule selectors only (media-nested hover rules are auditable too)",
);

// ---- FR-7 smoke: index.html carries accessible labels ------------------------

assert.ok(html.includes("aria-label"), "index.html carries aria-labels");

// ---- FR-4: disclosures are native buttons / summaries ------------------------

// Tool card heads: native <button>, not <div role="button"> (was the only
// role="button" in the app). Enter/Space activation is native on <button>.
assert.ok(
	app.includes('<button type="button" class="head" aria-expanded='),
	"tool card head is a native <button> with aria-expanded",
);
assert.ok(!app.includes('<div class="head"'), "no <div class=head> remains");
assert.ok(!app.includes('role="button"'), 'no role="button" remains anywhere');
assert.ok(
	inNativeTag(app, "head"),
	"head is inside a native button/summary tag",
);
assert.ok(!inDivTag(app, "head"), "head is NOT inside a div/span tag");
assert.ok(
	css.includes(".tool .head:focus-visible"),
	"tool head has a visible focus ring",
);

// Thinking block: native <details>/<summary> pair.
assert.ok(
	app.includes('document.createElement("details")'),
	"think block is <details>",
);
assert.ok(
	app.includes('createElement("summary")'),
	"compaction marker is a native <summary>",
);

// um-raw + cmd disclosures: native <details class=…><summary>.
assert.ok(
	app.includes('<details class="um-raw"><summary>'),
	"um-raw is native details/summary",
);
assert.ok(
	app.includes("<details class='cmd'"),
	"cmd disclosure is native details/summary",
);

// Diff tabs + analysis bars: already native buttons (evidence).
assert.ok(
	app.includes('document.createElement("button")'),
	"diff tabs are created as <button>",
);
assert.ok(
	app.includes('<button type="button" class="an-bar'),
	"analysis bars are native buttons",
);
assert.ok(
	app.includes('<button type="button" class="an-item"'),
	"analysis items are native buttons",
);

// ---- FR-5: icon controls are native buttons with accessible names -----------

/** Opening tag containing cls, or a synthetic window for createElement+
 *  className paths (e.g. toast-x). Returns { tag, window, markup } or null. */
function nativeTagFor(src, cls) {
	for (const tag of [
		...openingTags(src, "button"),
		...openingTags(src, "summary"),
	]) {
		if (tagClasses(tag).includes(cls))
			return { tag, window: tag, markup: true };
	}
	const re = new RegExp(`\\.className\\s*=\\s*["']${cls}["']`);
	const cm = src.match(re);
	if (cm) {
		const win = src.slice(Math.max(0, cm.index - 400), cm.index + 60);
		if (win.includes('createElement("button")')) {
			return { tag: win, window: win, markup: false };
		}
	}
	return null;
}

/** Accessible name: aria-label in the tag/window, or visible text right after a
 *  real markup tag (never after a synthetic window — that's JS, not content). */
function hasAccessibleName(src, info) {
	if (/aria-label/.test(info.window)) return true;
	if (!info.markup) return false;
	const start = src.indexOf(info.tag) + info.tag.length;
	const after = src.slice(start, start + 40);
	return /[A-Za-z]/.test(after);
}

const ICON_BUTTONS = [
	"modal-x",
	"ws-x",
	"ws-mini",
	"set-x",
	"sdd-close",
	"toast-x",
	"um-refresh",
];
const sources = app + "\n" + html;
for (const cls of ICON_BUTTONS) {
	const info = nativeTagFor(sources, cls);
	assert.ok(info, `${cls} is a native <button>/<summary>`);
	assert.ok(!inDivTag(sources, cls), `${cls} is NOT in a div/span tag`);
	assert.ok(
		hasAccessibleName(sources, info),
		`${cls} has an accessible name (aria-label or visible text)`,
	);
}

// ---- FR-6: splitter is focusable + keyboard-operable with WAI metadata ------

assert.ok(
	app.includes('className = "rail-resize"'),
	"rail-resize handle is created",
);
assert.ok(app.includes('role", "separator"'), "rail-resize is role=separator");
assert.ok(app.includes("aria-valuenow"), "rail-resize carries aria-valuenow");
assert.ok(app.includes("aria-valuemin"), "rail-resize carries aria-valuemin");
assert.ok(app.includes("aria-valuemax"), "rail-resize carries aria-valuemax");
assert.ok(
	app.includes("handle.tabIndex = 0"),
	"rail-resize is focusable (tabindex=0)",
);
assert.ok(app.includes('"ArrowLeft"'), "keyboard resize handles ArrowLeft");
assert.ok(app.includes('"ArrowRight"'), "keyboard resize handles ArrowRight");
assert.ok(
	app.includes("window.a11yContrast") &&
		app.includes("a11y && a11y.resizeStep"),
	"keyboard resize delegates to the pure resizeStep math (rail-resize.test.js)",
);

// ---- FR-7: labelled regions ---------------------------------------------------

for (const [needle, label] of [
	['role="feed" aria-label="conversation"', "conversation feed"],
	['aria-label="message composer"', "composer input"],
	['aria-label="workspaces and sessions"', "wsbar"],
	['aria-label="spec-driven development phases"', "sddbar"],
	['aria-label="slash commands"', "palette"],
	['aria-label="pi dialog"', "modal"],
]) {
	assert.ok(html.includes(needle), `index.html labels ${label}`);
}

// ---- FR-8: turns are semantic articles in a feed ------------------------------

assert.ok(app.includes('role="feed"'), "transcript feed wrapper exists");
assert.ok(
	app.includes('document.createElement("article")'),
	"turns are created as <article>",
);
assert.ok(
	app.includes('className = "msg"'),
	"article turns keep the .msg class",
);
assert.ok(
	app.includes("aria-labelledby"),
	"turn articles reference their role label",
);
assert.ok(
	app.includes('turn-" + ++turnId.n + "-role"'),
	"role ids are generated per turn",
);
assert.ok(
	!app.includes('document.createElement("div");\n\tm.className = "msg"'),
	"no div.msg remains",
);
assert.ok(
	!app.includes("transcript.appendChild"),
	"no message appends bypass the feed",
);
// regression guard (bug found post-slice): clearing <main> destroys the feed
// (it's a child of it), detaching every replayed message — the three clear
// sites must target the FEED, and message indexing must read feedEl.lastChild
assert.ok(!app.includes("setSafeHtml(transcript,"), "no clear targets <main>");
assert.ok(
	(app.match(/setSafeHtml\(feedEl, ""\)/g) || []).length >= 3,
	"all clear sites (applyMessages, workspace_changed, resumeSession) target the feed",
);
assert.ok(
	app.includes("const el = feedEl.lastChild"),
	"message indexing reads the feed",
);

// ---- FR-9: coarse status + busy state -----------------------------------------

assert.ok(
	html.includes('class="sr-only" role="status"'),
	"index.html carries a visually-hidden role=status element",
);
assert.ok(css.includes(".sr-only"), "style.css defines .sr-only");
assert.ok(
	app.includes('announceStatus("agent_start")'),
	"agent_start announces",
);
assert.ok(app.includes('announceStatus("agent_end")'), "agent_end announces");
assert.ok(
	app.includes('announceStatus("auto_retry_start")'),
	"auto_retry_start announces",
);
assert.ok(
	app.includes('announceStatus("compaction_start")'),
	"compaction_start announces",
);
assert.ok(
	app.includes('feedEl.setAttribute("aria-busy", "true")') &&
		app.includes('feedEl.setAttribute("aria-busy", "false")'),
	"applyMessages brackets the mutation with aria-busy",
);

// ---- liveClasses helper sanity (used by the T8 hover audit) ------------------

const live = liveClasses(app + "\n" + html);
for (const cls of [
	"head",
	"sx-tab",
	"an-bar",
	"an-item",
	"modal-x",
	"toast-x",
]) {
	assert.ok(live.includes(cls), `liveClasses finds ${cls}`);
}

// ---- FR-10/FR-12: hover-only affordances have focus twins ---------------------
// For every LIVE class with a :hover rule, style.css must also style it via
// :focus-visible/:focus-within — unless the control is a native element
// (button/a/summary/input/select/textarea get a browser focus ring by
// default). Dead classes (CSS without markup) are out of scope.

function escRe(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hoverSelFor(cls) {
	// same simple selector as :hover (no spaces/combinators in between) AND
	// the class is a full identifier — `.git-file:hover` must not flag `git`
	const re = new RegExp(
		"\\." + escRe(cls) + "(?=[:.#[]|$)(?=[^{}\\s,]*:hover)",
	);
	return hoverRules(css).filter((sel) => re.test(sel));
}
function hasFocusTwin(cls) {
	// twin = the class itself carries :focus-visible/:focus-within (e.g.
	// `.cls:hover, .cls:focus-visible`), or it's a descendant of a
	// focus-within ancestor (`:focus-within .cls`)
	const direct = new RegExp(
		"\\." + escRe(cls) + ":(?:focus-visible|focus-within)",
	);
	const via = new RegExp(
		":(?:focus-visible|focus-within)[^{}]*\\." +
			escRe(cls) +
			"(?=[:.#[]|\\s|[>+~,{]|$)",
	);
	return direct.test(css) || via.test(css);
}
const NATIVE = ["button", "a", "summary", "input", "select", "textarea"];
function isNativeClass(cls) {
	// markup path + createElement/className path (e.g. toast-x, sx-tab)
	for (const tag of NATIVE) {
		for (const t of openingTags(sources, tag)) {
			if (tagClasses(t).includes(cls)) return true;
		}
	}
	const re = new RegExp(`\\.className\\s*=\\s*["']${cls}["']`);
	const cm = sources.match(re);
	if (cm) {
		const win = sources.slice(Math.max(0, cm.index - 400), cm.index);
		if (NATIVE.some((t) => win.includes(`createElement("${t}")`))) return true;
	}
	return false;
}

const hoverCls = live.filter((cls) => hoverSelFor(cls).length > 0);
// document-backed exemptions: controls whose keyboard affordance is NOT a
// focus ring (listbox options are never focused — roving aria-activedescendant)
const HOVER_EXEMPT = {
	item: 'palette listbox option (role="option", aria-activedescendant) — the keyboard highlight is .item.sel, which shares the rule with .item:hover (style.css:1655)',
};
const violations = hoverCls.filter(
	(cls) =>
		!hasFocusTwin(cls) &&
		!isNativeClass(cls) &&
		!Object.hasOwn(HOVER_EXEMPT, cls),
);
assert.deepEqual(
	violations,
	[],
	"hover-only classes must have a :focus-visible/:focus-within twin " +
		`(flagged: ${violations.join(", ") || "none"})`,
);
// the exemption list must stay accurate: every exempt class is still live
for (const cls of Object.keys(HOVER_EXEMPT)) {
	assert.ok(live.includes(cls), `exempt class ${cls} is still live`);
}
assert.ok(
	css.includes("#palette .item:hover,") && css.includes("#palette .item.sel"),
	"palette item hover + sel share a rule (keyboard highlight evidence)",
);

// sticky chrome: focus/scrollIntoView must not land under sticky bars
assert.ok(
	css.includes("scroll-padding-top"),
	"scroll-padding-top exists for sticky chrome",
);

// ---- FR-11: touch targets ≥24×24 or reserved hit zones ------------------------

const SIZE_RULES = [
	["modal-x", "width: 24px"],
	["ws-x", "width: 24px"],
	["ws-mini", "min-height: 24px"],
	["set-x", "min-width: 24px"],
	["sdd-close", "min-width: 24px"],
	["toast-x", "min-width: 24px"],
	["um-refresh", "min-height: 24px"],
	["imgthumb-x", "min-width: 24px"],
	["ws-open", "width: 24px"],
	["sx-conflict-btn", "min-height: 24px"],
	["sx-mode-btn", "min-height: 24px"],
	["sx-ctx-btn", "min-width: 24px"],
	["sx-reset", "min-height: 24px"],
];
for (const [cls, rule] of SIZE_RULES) {
	assert.ok(
		new RegExp(
			`(?:#|\\.)${cls}[^{]*\\{[^}]*${rule.replace(/[/[\]^$*+?{}|\\]/g, "\\$&")}`,
		).test(css),
		`${cls} carries a 24px size rule (${rule})`,
	);
}
// rail-resize: 6px visual strip, 24px hit zone via ::after + reserved rail padding
assert.ok(
	css.includes("#sddbar > .rail-resize::after") && css.includes("width: 24px;"),
	"rail-resize has a 24px hit area",
);
assert.ok(
	css.includes(
		"padding-left: 24px; /* a11y FR-11: reserves the resize handle's hit zone */",
	),
	"the rail's left padding reserves the handle's hit zone",
);

console.log("a11y-contract.test.js — FR-4 + helpers passed");
