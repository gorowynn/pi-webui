/*
 * diff-view.js — pure side-by-side diff logic for the editable diff
 * (plan A5 / U5). LCS row alignment (ported verbatim from app.js's
 * mountSideBySide helpers — ponytail: O(n*m) Uint32Array DP table; swap for
 * Myers if huge files start lagging the UI), the monotonic gutter reserve,
 * the dirty helper, and the large-hunk cell guard. Dual-mode vanilla module
 * (module.exports in Node, window.diffView in the browser), zero-dep, loaded
 * before app.js. Render/escaping stays in app.js (single escaper, GOTCHAS
 * #12) — this module never touches the DOM.
 */
(() => {
	// diffLines: LCS token stream over old/new line arrays. Tokens are
	// {t:"ctx"|"del"|"add", s} in left-to-right order.
	function diffLines(a, b) {
		const A = a == null || a === "" ? [] : String(a).split("\n");
		const B = b == null || b === "" ? [] : String(b).split("\n");
		const n = A.length,
			m = B.length;
		const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
		for (let i = n - 1; i >= 0; i--)
			for (let j = m - 1; j >= 0; j--)
				dp[i][j] =
					A[i] === B[j]
						? dp[i + 1][j + 1] + 1
						: Math.max(dp[i + 1][j], dp[i][j + 1]);
		const res = [];
		let i = 0,
			j = 0;
		while (i < n && j < m) {
			if (A[i] === B[j]) {
				res.push({ t: "ctx", s: A[i] });
				i++;
				j++;
			} else if (dp[i + 1][j] >= dp[i][j + 1]) {
				res.push({ t: "del", s: A[i] });
				i++;
			} else {
				res.push({ t: "add", s: B[j] });
				j++;
			}
		}
		while (i < n) {
			res.push({ t: "del", s: A[i] });
			i++;
		}
		while (j < m) {
			res.push({ t: "add", s: B[j] });
			j++;
		}
		return res;
	}

	// diffRows: align the LCS token stream into paired left/right rows so
	// both columns share exactly one row per line. A contiguous change run
	// (dels then adds) is zipped into rows: matched del+add = 'mod' (shows
	// old on the left, new on the right); a lone del/add leaves the opposite
	// side null (rendered as an empty placeholder so the row still exists).
	function diffRows(a, b) {
		const toks = diffLines(a, b);
		const rows = [];
		let i = 0;
		while (i < toks.length) {
			if (toks[i].t === "ctx") {
				rows.push({ kind: "ctx", left: toks[i].s, right: toks[i].s });
				i++;
			} else {
				const dels = [],
					adds = [];
				while (i < toks.length && toks[i].t !== "ctx") {
					if (toks[i].t === "del") dels.push(toks[i].s);
					else adds.push(toks[i].s);
					i++;
				}
				const n = Math.max(dels.length, adds.length);
				for (let k = 0; k < n; k++) {
					const d = dels[k],
						a2 = adds[k];
					rows.push({
						kind: d != null && a2 != null ? "mod" : d != null ? "del" : "add",
						left: d != null ? d : null,
						right: a2 != null ? a2 : null,
					});
				}
			}
		}
		return rows;
	}

	// gutterReserveCh: monotonic gutter width in ch. (digits+1)ch of the max
	// line count seen, minimum 2ch; grows when line counts grow and NEVER
	// shrinks, so async line-number updates can't shift the text origin.
	// `currentCh` is the previous numeric reserve (undefined at first mount).
	function gutterReserveCh(lineCount, currentCh) {
		const digits = String(Math.max(lineCount || 0, 1)).length;
		const want = Math.max(digits + 1, 2);
		return currentCh && currentCh >= want ? currentCh : want;
	}

	// dirty: has the proposal drifted from its baseline? Strict comparison —
	// mirrors the textarea value check (null base vs "" is dirty).
	function dirty(base, current) {
		return base !== current;
	}

	// largeHunkExceeds: the O(n*m) cell guard — mirror of mountSideBySide's
	// compute `on * nn > DIFF_CELL_LIMIT` decision (GOTCHAS #6). Exactly-at-
	// limit still renders.
	function largeHunkExceeds(on, nn, limit) {
		return (on || 0) * (nn || 0) > (limit || 4_000_000);
	}

	// lineCountOf: mirrors compute's on/nn derivation (null and "" → 0).
	function lineCountOf(text) {
		return text ? text.split("\n").length : 0;
	}

	const api = {
		diffLines,
		diffRows,
		gutterReserveCh,
		dirty,
		largeHunkExceeds,
		lineCountOf,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.diffView = api;
})();
