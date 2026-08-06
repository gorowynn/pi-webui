((global) => {
	function usageViewKind(provider) {
		if (provider === "zai") return "zai-quota";
		if (provider === "openai-codex") return "codex-quota";
		if (provider === "opencode-go") return "opencode-go-quota";
		return "session";
	}

	// OpenCode Go has no public quota API. The dashboard page
	// (opencode.ai/workspace/<id>/go) embeds the three subscription usage
	// windows as serialized props inside <script> blocks. This is a port of
	// opencode-bar's parser: normalize HTML/JSON escaping, then regex the flat
	// {status,resetInSec,usagePercent} object after each window key. Handles
	// both the __next_f.push JSON-stringified shape and SolidStart's
	// $R[n]={...} references. Missing windows are omitted from the result.
	// Used by server.js (require'd, like md.js) to decode the dashboard fetch;
	// loaded in the browser for the quota classifier.
	function opencodeGoWindows(html) {
		const text = String(html || "")
			.replace(/&quot;|&#34;/g, '"')
			.replace(/&#x27;|&#39;/g, "'")
			.replace(/&amp;/g, "&")
			.replace(/\\"/g, '"')
			.replace(/\\u0022/g, '"');
		const out = {};
		for (const name of ["rollingUsage", "weeklyUsage", "monthlyUsage"]) {
			const found = findWindow(name);
			if (found) out[name] = found;
		}
		return out;

		// ponytail: the page can embed DECOY objects with the same key names
		// before the real subscription data (e.g. referral previews with
		// {beforePercent, afterPercent, resetInSec} and no usagePercent). A
		// first-match-only parser would drop the real window — scan every
		// occurrence and keep the first one that has both numbers.
		function findWindow(name) {
			const re = new RegExp(
				"[\"']?" + name + "[\"']?\\s*:\\s*(?:\\$R\\[\\d+\\]\\s*=\\s*)?\\{",
				"g",
			);
			let m;
			while ((m = re.exec(text)) !== null) {
				const open = m.index + m[0].length - 1; // the matched "{"
				let depth = 0;
				let end = -1;
				for (let i = open; i < text.length; i++) {
					if (text[i] === "{") depth++;
					else if (text[i] === "}") {
						depth--;
						if (depth === 0) {
							end = i;
							break;
						}
					}
				}
				if (end < 0) continue;
				const body = text.slice(open, end + 1);
				const num = (field) => {
					const mv = body.match(
						new RegExp(
							"[\"']?" + field + '["\']?\\s*:\\s*"?(-?\\d+(?:\\.\\d+)?)"?',
						),
					);
					return mv ? Number(mv[1]) : null;
				};
				const usagePercent = num("usagePercent");
				const resetInSec = num("resetInSec");
				if (usagePercent != null && resetInSec != null)
					return { usagePercent, resetInSec };
			}
			return null;
		}
	}

	global.usageViewKind = usageViewKind;
	global.opencodeGoWindows = opencodeGoWindows;
	if (typeof module !== "undefined")
		module.exports = { usageViewKind, opencodeGoWindows };
})(globalThis);
