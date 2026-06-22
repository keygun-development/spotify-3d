/* Service worker — makes the app installable + gives an offline app shell.
 *
 * The app itself is online-first (Spotify API, OAuth, fonts), so this SW does
 * NOT try to cache everything. It:
 *   - precaches the app shell so the PWA opens instantly / offline,
 *   - serves same-origin static assets stale-while-revalidate,
 *   - never touches Spotify / OAuth / /api requests (always live network).
 */

const VERSION = "v1";
const SHELL_CACHE = `shell-${VERSION}`;
const ASSET_CACHE = `assets-${VERSION}`;

// Bump VERSION above to invalidate all caches on the next deploy.
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
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
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Requests we must never intercept — they need the live network every time.
function isBypassed(url, request) {
  if (request.method !== "GET") return true;
  const host = url.hostname;
  if (host.endsWith("spotify.com")) return true; // api + accounts + open
  if (host.endsWith("scdn.co")) return true; // album art / audio CDNs
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return true; // netlify functions
    if (url.pathname.startsWith("/.netlify/")) return true;
    if (url.pathname.startsWith("/callback")) return true; // OAuth return
  }
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isBypassed(url, request)) return; // let the browser handle it

  // Navigations: network-first, fall back to the cached app shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/index.html", { ignoreSearch: true })
      )
    );
    return;
  }

  // Same-origin static assets (Vite-hashed /assets/*, icons, css…):
  // stale-while-revalidate — instant from cache, refreshed in the background.
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }

  // Google Fonts (cross-origin): cache-first, they're immutable.
  if (url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
});

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}
