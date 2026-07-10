/* ============================================================
   NEXUS · Service Worker (PWA — instalable + offline)
   ------------------------------------------------------------
   - Precachea el "app shell" (HTML + íconos).
   - Same-origin: HTML network-first (para propagar deploys),
     estáticos stale-while-revalidate (rápido + se actualizan solos).
   - Cross-origin (Firebase gstatic/googleapis): NO se intercepta,
     va directo a la red — auth y Firestore siguen funcionando.
   Para forzar refresco tras un deploy grande: subir CACHE_VERSION.
   ============================================================ */
const CACHE_VERSION = "nexus-cache-v3";
const APP_SHELL = [
  "/index.html",
  "/dashboard.html",
  "/manifest.json",
  "/img/icon-192.png?v=3",
  "/img/icon-512.png?v=3"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Solo same-origin. Firebase (www.gstatic.com, *.googleapis.com, etc.) pasa
  // sin interceptar para que auth/Firestore hablen siempre con la red.
  if (url.origin !== self.location.origin) return;

  // Navegaciones (documentos HTML): network-first con fallback a caché (offline).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Estáticos same-origin (css/js/img): stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
