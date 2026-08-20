/*
 * composer-images.js — client-side image prep for the composer.
 * Ported from pi-livecraft's composer-images.ts (MIT), vanilla JS, zero-dep
 * (canvas + FileReader + Image). Plan 4.10 / R§3.1.
 *
 * prepareImage(file) → {type:"image", data:<raw base64>, mimeType:"image/jpeg"}
 * or null (decode failure / uncompressible). The algorithm:
 *   1. decode the File into an HTMLImageElement via createObjectURL (revoke after)
 *   2. cap the longest dimension at 1600px (preserve useful model resolution)
 *   3. draw to a canvas with a WHITE background first (flattens PNG transparency
 *      so JPEG encode doesn't black-out the alpha)
 *   4. encode as JPEG at descending quality [0.84, 0.72, 0.6, 0.5] until ≤350 KB
 *   5. if still too big, shrink 80% and repeat; give up below 640px (best-effort)
 *   6. strip the data: prefix → raw base64 (pi's ImageContent expects raw base64)
 *
 * Always-JPEG so a pasted PNG screenshot gets compressed (huge savings). All
 * client-side — bounds both the HTTP body and the model context (token ≈ res).
 *
 * Dual-mode: module.exports in Node (for tests of the size/quality logic via a
 * canvas shim — not included here), window.composerImages in the browser.
 */
(function () {
	"use strict";

	var MAX_DIM = 1600;
	var TARGET_BYTES = 350 * 1024;
	var QUALITIES = [0.84, 0.72, 0.6, 0.5];
	var MIN_DIM = 640;

	function loadImage(url) {
		return new Promise(function (resolve, reject) {
			var img = new Image();
			img.onload = function () {
				resolve(img);
			};
			img.onerror = reject;
			img.src = url;
		});
	}

	// Draw img at w×h on a white-bg canvas, then pick the lowest quality that
	// fits TARGET_BYTES. Returns the best blob (may exceed target — caller shrinks).
	function encodeJpeg(img, w, h) {
		var canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		var ctx = canvas.getContext("2d");
		// white background flattens alpha so JPEG doesn't black-out transparent PNGs
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, w, h);
		ctx.drawImage(img, 0, 0, w, h);
		var best = null;
		var i = 0;
		return new Promise(function (resolve) {
			function step() {
				if (i >= QUALITIES.length) {
					resolve(best);
					return;
				}
				var q = QUALITIES[i++];
				canvas.toBlob(
					function (blob) {
						if (blob) {
							if (!best || blob.size < best.size) best = blob;
							if (blob.size <= TARGET_BYTES) {
								resolve(blob);
								return;
							}
						}
						step();
					},
					"image/jpeg",
					q,
				);
			}
			step();
		});
	}

	function blobToBase64(blob) {
		return new Promise(function (resolve, reject) {
			var r = new FileReader();
			r.onload = function () {
				var s = String(r.result || "");
				var idx = s.indexOf(",");
				// strip the "data:image/jpeg;base64," prefix → raw base64
				resolve(idx >= 0 ? s.slice(idx + 1) : s);
			};
			r.onerror = reject;
			r.readAsDataURL(blob);
		});
	}

	async function prepareImage(file) {
		if (!file || !file.type || file.type.indexOf("image/") !== 0) return null;
		var url = URL.createObjectURL(file);
		try {
			var img = await loadImage(url);
			var w = img.naturalWidth || img.width || 0;
			var h = img.naturalHeight || img.height || 0;
			if (!w || !h) return null;
			// cap longest dimension at MAX_DIM
			var scale = Math.min(1, MAX_DIM / Math.max(w, h));
			w = Math.round(w * scale);
			h = Math.round(h * scale);
			for (var attempt = 0; attempt < 5; attempt++) {
				var blob = await encodeJpeg(img, w, h);
				if (blob && blob.size <= TARGET_BYTES) {
					return { type: "image", data: await blobToBase64(blob), mimeType: "image/jpeg" };
				}
				// still too big → shrink 80%; stop at MIN_DIM (best-effort return)
				if (Math.max(w, h) * 0.8 < MIN_DIM) {
					return blob
						? { type: "image", data: await blobToBase64(blob), mimeType: "image/jpeg" }
						: null;
				}
				w = Math.round(w * 0.8);
				h = Math.round(h * 0.8);
			}
			return null;
		} catch (e) {
			return null;
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	var api = {
		prepareImage: prepareImage,
		MAX_DIM: MAX_DIM,
		TARGET_BYTES: TARGET_BYTES,
		MAX_IMAGES: 4,
	};
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	if (typeof window !== "undefined") window.composerImages = api;
})();
