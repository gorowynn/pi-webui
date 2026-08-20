

const { truncateUtf8 } = require("./browser-snapshot.js");

const MAX_SCREENSHOT_BYTES = 300 * 1024;
const DEFAULT_JPEG_QUALITY = 70;
const MIN_JPEG_QUALITY = 40;
const QUALITY_STEP = 10;
const MAX_VIEWPORT_DIMENSION = 4096;

function screenshotError(code, message) {
	const error = new Error(message);
	error.code = code;
	return error;
}

function viewportSize(viewport = {}) {
	const width = Number.isFinite(viewport.width) ? Math.max(0, Math.min(MAX_VIEWPORT_DIMENSION, Math.floor(viewport.width))) : 0;
	const height = Number.isFinite(viewport.height) ? Math.max(0, Math.min(MAX_VIEWPORT_DIMENSION, Math.floor(viewport.height))) : 0;
	return { width, height };
}

function decodeImage(data) {
	if (typeof data !== "string" || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
		throw screenshotError("cdp-protocol", "CDP returned invalid screenshot data");
	}
	const bytes = Buffer.from(data, "base64");
	if (!bytes.length) throw screenshotError("cdp-protocol", "CDP returned an empty screenshot");
	return bytes;
}

function screenshotText(url, imageIncluded) {
	return imageIncluded
		? `Screenshot of ${truncateUtf8(url || "", 2048)}`
		: `Screenshot unavailable for this text-only model. Use browser_snapshot for ${truncateUtf8(url || "the page", 2048)}.`;
}

async function captureScreenshot(session, options = {}) {
	const url = options.url || "";
	const viewport = viewportSize(options.viewport);
	const details = { url: truncateUtf8(url, 2048), width: viewport.width, height: viewport.height, bytes: 0, imageIncluded: false };
	if (options.imageSupported !== true) {
		return { content: [{ type: "text", text: screenshotText(url, false) }], details };
	}
	if (!session || typeof session.command !== "function") throw screenshotError("target-unavailable", "browser screenshot target is unavailable");
	const signal = options.signal;
	const commandOptions = options.commandOptions || {};
	const requestedQuality = Number.isFinite(options.quality) ? Math.floor(options.quality) : DEFAULT_JPEG_QUALITY;
	for (let quality = Math.max(MIN_JPEG_QUALITY, Math.min(100, requestedQuality)); quality >= MIN_JPEG_QUALITY; quality -= QUALITY_STEP) {
		const response = await session.command(
			"Page.captureScreenshot",
			{ format: "jpeg", quality, captureBeyondViewport: false },
			signal,
			commandOptions,
		);
		const bytes = decodeImage(response && response.data);
		if (bytes.length > MAX_SCREENSHOT_BYTES) continue;
		details.bytes = bytes.length;
		details.imageIncluded = true;
		return {
			content: [
				{ type: "text", text: screenshotText(url, true) },
				{ type: "image", data: bytes.toString("base64"), mimeType: "image/jpeg" },
			],
			details,
		};
	}
	throw screenshotError("output-limit", "browser screenshot exceeds its size limit");
}

module.exports = {
	DEFAULT_JPEG_QUALITY,
	MAX_SCREENSHOT_BYTES,
	MAX_VIEWPORT_DIMENSION,
	MIN_JPEG_QUALITY,
	captureScreenshot,
	decodeImage,
	screenshotError,
	viewportSize,
};
