/*
 * csv-preview.js — allocation-bounded CSV parser for tool-output previews.
 *
 * Zero-dep. Scans only the first 64KB and materializes at most 8 columns × 20
 * rows × 160 chars/cell, so a 5MB CSV never enters the DOM. Handles quoted
 * fields, escaped "" and \r\n. Beyond any limit -> truncated:true (the UI shows
 * a "Preview limited" notice + a "view source" toggle for the first 20KB).
 *
 * Require-able in Node (module.exports) for unit tests, like md.js; sets
 * window.csvPreview in the browser. Plan 2.3 / R§2.3.
 */
(function () {
	"use strict";

	var SCAN_CAP = 65536; // scan at most this many chars
	var MAX_ROWS = 20; // incl. header row
	var MAX_COLS = 8;
	var CELL_CAP = 160; // truncate a single field's text
	var SRC_CAP = 20480; // "view source" shows at most 20KB

	function truncateCell(s) {
		return s.length > CELL_CAP ? s.slice(0, CELL_CAP) + "\u2026" : s;
	}
	// cap a parsed row to MAX_COLS columns
	function capCols(row) {
		return row.length > MAX_COLS ? row.slice(0, MAX_COLS) : row;
	}

	// Returns { headers:[...], rows:[[...]], truncated:bool }.
	// headers = first row; rows = the rest (up to MAX_ROWS-1).
	function parse(content) {
		content = content == null ? "" : String(content);
		var src = content.slice(0, SCAN_CAP);
		var truncated = content.length > SCAN_CAP;
		var rows = [];
		var row = [];
		var field = "";
		var inQuotes = false;
		var i = 0;
		var n = src.length;

		while (i < n) {
			if (rows.length >= MAX_ROWS) {
				truncated = true;
				break;
			}
			var ch = src[i];
			if (inQuotes) {
				if (ch === '"') {
					if (src[i + 1] === '"') {
						field += '"';
						i += 2;
						continue;
					}
					inQuotes = false;
					i++;
					continue;
				}
				field += ch;
				i++;
				continue;
			}
			if (ch === '"') {
				inQuotes = true;
				i++;
				continue;
			}
			if (ch === ",") {
				row.push(truncateCell(field));
				field = "";
				i++;
				continue;
			}
			if (ch === "\r") {
				// collapse \r\n and lone \r into a row break
				if (src[i + 1] === "\n") i++;
				row.push(truncateCell(field));
				field = "";
				rows.push(capCols(row));
				row = [];
				i++;
				continue;
			}
			if (ch === "\n") {
				row.push(truncateCell(field));
				field = "";
				rows.push(capCols(row));
				row = [];
				i++;
				continue;
			}
			field += ch;
			i++;
		}
		// flush a trailing field/row with no newline
		if (rows.length < MAX_ROWS && (field !== "" || row.length > 0)) {
			row.push(truncateCell(field));
			rows.push(capCols(row));
		}
		if (rows.length >= MAX_ROWS && i < n) truncated = true;

		var headers = rows.length ? rows[0] : [];
		var body = rows.slice(1, MAX_ROWS);
		return {
			headers: headers,
			rows: body,
			truncated: truncated,
		};
	}

	// the raw (first 20KB) text for the "view source" fallback
	function source(content) {
		return (content == null ? "" : String(content)).slice(0, SRC_CAP);
	}

	var api = { parse: parse, source: source };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.csvPreview = api;
})();
