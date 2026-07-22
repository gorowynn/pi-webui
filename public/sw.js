// ponytail: minimal installability SW. Exists ONLY so Chrome/Edge treat pi-webui
// as an installable PWA (requires a registered SW + manifest). It caches nothing
// — server.js serves every asset no-cache, so the edit+refresh dev loop is kept.
// It must never intercept /api/: the /api/events SSE stream buffers/breaks if a
// SW touches it, so those requests fall through to the browser untouched.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
	const u = new URL(e.request.url);
	if (u.pathname.startsWith("/api/")) return; // SSE + commands: never intercept
	e.respondWith(fetch(e.request)); // network-only, no caching
});
