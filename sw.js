/* ══ Service Worker METHODS ══
   Incrémenter CACHE_VERSION à chaque déploiement pour invalider l'ancien cache.
*/
const CACHE_VERSION = "v3.1";
const CACHE_NAME = "methods-" + CACHE_VERSION;

const PRECACHE = [
  "./",
  "./index.html",
  "./data.js",
  "./themods_data.js",
  "./common.js",
  "./methods.js",
  "./themods.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

/* ── Install : mise en cache initiale ── */
self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate : supprimer les anciens caches ── */
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith("methods-") && k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── Fetch : cache-first, réseau en fallback ── */
self.addEventListener("fetch", e => {
  // Ignorer les requêtes non-GET et Firebase
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("firestore.googleapis.com")) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === "opaque") return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return resp;
      });
    })
  );
});
