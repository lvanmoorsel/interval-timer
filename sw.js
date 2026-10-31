// Offline-first: de app werkt ook zonder verbinding. Verhoog VERSION na een wijziging.
const VERSION = "v13";
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(file => new Request(file, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^v\d+$/.test(k) && k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(cache => cache.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
