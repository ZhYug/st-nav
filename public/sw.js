const CACHE = "st-nav-shell-v11";
const SHELL = ["/", "/assets/styles.css", "/assets/common.js", "/assets/app.js", "/assets/favicon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;
  // Never let the service worker serve a stale admin page or admin bundle.
  // These files change frequently and contain management logic.
  if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html" || url.pathname === "/assets/admin.js") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/"))));
});
