/* ══ Service Worker METHODS — network-first v3.38 ══ */
const CACHE_NAME = "methods-v41";

/* ── Install : prendre le contrôle immédiatement ── */
self.addEventListener("install", e => {
  e.waitUntil(self.skipWaiting());
});

/* ── Activate : vider TOUT le cache, prendre le contrôle de toutes les pages ── */
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch : network-first ── */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (e.request.url.includes("firestore.googleapis.com")) return;

  // Pour les navigations HTML : bypasser le cache HTTP du navigateur
  // afin que index.html soit toujours servi frais depuis le serveur.
  const req = e.request.mode === "navigate"
    ? new Request(e.request, { cache: "no-store" })
    : e.request;

  e.respondWith(
    fetch(req)
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
