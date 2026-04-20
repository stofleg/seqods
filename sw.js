/* ══ Service Worker METHODS — network-first v3.16 ══ */
const CACHE_NAME = "methods-v16";

/* ── Install : prendre le contrôle immédiatement ── */
self.addEventListener("install", e => {
  e.waitUntil(self.skipWaiting());
});

/* ── Activate : vider TOUT le cache, prendre le contrôle de toutes les pages ── */
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k)))) // purge totale
      .then(() => self.clients.claim())
  );
});

/* ── Fetch : network-first ── */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("firestore.googleapis.com")) return;

  e.respondWith(
    fetch(e.request)
      .then(resp => {
        if (resp && resp.status === 200 && resp.type !== "opaque") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
