

const SNAPSHOT_SCHEMA = "pi-webui.browser-snapshot/v1";
const MAX_PAGE_TEXT_BYTES = 12 * 1024;
const MAX_ELEMENTS = 200;
const MAX_TITLE_BYTES = 512;
const MAX_FIELD_BYTES = 1024;
const MAX_HREF_BYTES = 2048;

// Fixed, parameter-free DOM inspection. The model never supplies JavaScript.
const SNAPSHOT_SCRIPT = `(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" &&
      rect.width >= 0 && rect.height >= 0;
  };
  const text = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  const role = (el) => el.getAttribute("role") || ({
    A: "link", BUTTON: "button", INPUT: "textbox", TEXTAREA: "textbox",
    SELECT: "combobox", OPTION: "option", SUMMARY: "button"
  })[el.tagName] || (el.isContentEditable ? "textbox" : "generic");
  const name = (el) => el.getAttribute("aria-label") ||
    el.getAttribute("title") || text(el).slice(0, 512);
  const nodes = new Set(document.querySelectorAll(
    "a[href],button,input,textarea,select,option,summary,[contenteditable=\\"true\\"],[role]"
  ));
  const elements = [...nodes].filter(visible).slice(0, 250).map((el, index) => {
    const rect = el.getBoundingClientRect();
    const type = (el.getAttribute("type") || "").toLowerCase();
    return {
      index, role: role(el), name: name(el), text: text(el),
      value: type === "password" ? null : ("value" in el ? String(el.value) : null),
      password: type === "password",
      disabled: Boolean(el.disabled), checked: typeof el.checked === "boolean" ? el.checked : undefined,
      selected: typeof el.selected === "boolean" ? el.selected : undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    };
  });
  return {
    url: location.href, title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    pageText: document.body ? document.body.innerText : "", elements
  };
})()`;

function truncateUtf8(value, maxBytes) {
	const text = String(value ?? "");
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	const suffix = "…";
	const budget = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
	let end = Math.min(text.length, budget);
	while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > budget) end--;
	return text.slice(0, end) + suffix;
}

function boundedString(value, maxBytes) {
	if (value == null) return "";
	return truncateUtf8(value, maxBytes);
}

function finiteRect(rect) {
	if (!rect || typeof rect !== "object") return null;
	const values = [rect.x, rect.y, rect.width, rect.height];
	if (!values.every((value) => Number.isFinite(value)) || rect.width < 0 || rect.height < 0) return null;
	return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function safeHref(value) {
	if (typeof value !== "string" || !value) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
		return truncateUtf8(url.toString(), MAX_HREF_BYTES);
	} catch {
		return undefined;
	}
}

function normalizeElement(raw) {
	if (!raw || typeof raw !== "object" || raw.visible === false) return null;
	const rect = finiteRect(raw.rect);
	if (!rect) return null;
	const type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
	const password = raw.password === true || type === "password";
	const element = {
		role: boundedString(raw.role || "generic", 128),
		name: boundedString(raw.name, MAX_FIELD_BYTES),
		value: password || raw.value == null ? null : boundedString(raw.value, MAX_FIELD_BYTES),
		disabled: raw.disabled === true,
		rect,
	};
	const text = boundedString(raw.text, MAX_FIELD_BYTES);
	if (text) element.text = text;
	if (typeof raw.checked === "boolean") element.checked = raw.checked;
	if (typeof raw.selected === "boolean") element.selected = raw.selected;
	const href = safeHref(raw.href);
	if (href) element.href = href;
	return { element, index: Number.isInteger(raw.index) ? raw.index : null };
}

function fingerprint(elements) {
	return JSON.stringify(elements.map(({ element, index }) => ({ element, index })));
}

class SnapshotRefStore {
	constructor() {
		this.generation = 0;
		this.refs = new Map();
		this.currentRefs = [];
		this.nextRef = 1;
		this.lastFingerprint = "";
	}

	update(elements) {
		const nextFingerprint = fingerprint(elements);
		if (nextFingerprint !== this.lastFingerprint) {
			this.generation++;
			this.refs = new Map();
			this.currentRefs = [];
			this.lastFingerprint = nextFingerprint;
			for (const item of elements) {
				const ref = `e${this.nextRef++}`;
				this.currentRefs.push(ref);
				this.refs.set(ref, item);
			}
		}
		return elements.map(({ element }, index) => ({ ...element, ref: this.currentRefs[index] }));
	}

	invalidate() {
		this.generation++;
		this.refs.clear();
		this.currentRefs = [];
		this.lastFingerprint = "";
	}

	resolve(ref) {
		const found = this.refs.get(String(ref));
		if (!found) {
			const error = new Error("snapshot ref is stale; call browser_snapshot again");
			error.code = "stale-ref";
			throw error;
		}
		return found;
	}
}

function normalizeSnapshot(raw = {}, refs = new SnapshotRefStore()) {
	const source = raw && typeof raw === "object" ? raw : {};
	const elements = Array.isArray(source.elements)
		? source.elements.map(normalizeElement).filter(Boolean).slice(0, MAX_ELEMENTS)
		: [];
	const outputElements = refs.update(elements);
	const viewport = source.viewport && Number.isFinite(source.viewport.width) && Number.isFinite(source.viewport.height)
		? { width: Math.max(0, source.viewport.width), height: Math.max(0, source.viewport.height) }
		: { width: 0, height: 0 };
	return {
		schema: SNAPSHOT_SCHEMA,
		url: boundedString(source.url, 2048),
		title: boundedString(source.title, MAX_TITLE_BYTES),
		viewport,
		pageText: truncateUtf8(source.pageText, MAX_PAGE_TEXT_BYTES),
		elements: outputElements,
	};
}

module.exports = {
	MAX_ELEMENTS,
	MAX_FIELD_BYTES,
	MAX_HREF_BYTES,
	MAX_PAGE_TEXT_BYTES,
	SNAPSHOT_SCHEMA,
	SNAPSHOT_SCRIPT,
	SnapshotRefStore,
	normalizeSnapshot,
	truncateUtf8,
};
