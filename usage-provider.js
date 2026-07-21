((global) => {
	function usageViewKind(provider) {
		if (provider === "zai") return "zai-quota";
		if (provider === "openai-codex") return "codex-quota";
		return "session";
	}

	global.usageViewKind = usageViewKind;
	if (typeof module !== "undefined") module.exports = { usageViewKind };
})(globalThis);
