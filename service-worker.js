/* ==========================================================================
   Tuition Manager — service-worker.js
   Caches the app shell for offline use. Uses paths relative to this file's
   own location so the app works correctly under a GitHub Pages subpath
   (e.g. https://username.github.io/tuition-manager/).
   ========================================================================== */

const TM_CACHE_VERSION = "tuition-manager-v5";

// Resolve the scope this service worker was registered under.
const TM_SCOPE = self.registration ? self.registration.scope : self.location.href;

const TM_APP_SHELL = [
  "index.html",
  "login.html",
  "students.html",
  "attendance.html",
  "fees.html",
  "reports.html",
  "settings.html",
  "css/style.css",
  "js/config.js",
  "js/db.js",
  "js/legacy-local-db.js",
  "js/migrate.js",
  "js/utils.js",
  "js/image-processing.js",
  "js/pdf-reports.js",
  "js/app.js",
  "js/students.js",
  "js/attendance.js",
  "js/fees.js",
  "js/reports.js",
  "js/backup.js",
  "js/settings.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
].map((path) => new URL(path, TM_SCOPE).toString());

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(TM_CACHE_VERSION)
      .then((cache) => cache.addAll(TM_APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== TM_CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  // Never cache the Cloudflare Worker API: it's per-account data behind
  // an Authorization header, so a cached response could leak one
  // account's data to a different account signed in later on the same
  // device/browser. Let these go straight to the network — db.js already
  // has its own small offline-read fallback (see js/db.js) for when
  // there's no connection.
  if (request.url.includes("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  const isSameOrigin = request.url.startsWith(self.location.origin);

  if (isSameOrigin) {
    // App shell: cache-first, falling back to network, then caching the response.
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(TM_CACHE_VERSION).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match(new URL("index.html", TM_SCOPE).toString()));
      })
    );
  } else {
    // External resources (fonts, Bootstrap CDN): network-first, cache fallback.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(TM_CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
