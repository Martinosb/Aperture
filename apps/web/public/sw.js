/*
 * Service worker for Aperture (PRD §8).
 *
 * It caches the app shell and nothing else. Telemetry is deliberately never
 * cached: stale readings displayed as live are worse than no readings at all,
 * because the whole point of this product is telling the truth about what the
 * window is actually doing.
 */

const CACHE = "aperture-shell-v1";

const SHELL = [
  "/",
  "/automation",
  "/activity",
  "/device",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // A single missing entry must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** Hosts that carry live device state and must always go to the network. */
function isLiveData(url) {
  return (
    url.hostname.endsWith("firebaseio.com") ||
    url.hostname.endsWith("firebasedatabase.app") ||
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("firebaseapp.com") ||
    url.pathname.endsWith(".json")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isLiveData(url)) return; // straight to the network, never cached

  // Navigations: network first so a running app is always current, with the
  // cached shell as the offline answer.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))),
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Static assets: cache first, they are content-hashed by the build.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
