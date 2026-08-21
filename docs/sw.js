/* Cache-first for the shell. The shell is tiny and static; the data never comes
 * from the network at all (it lives in IndexedDB), so once this is installed the
 * app works permanently offline. Bump VERSION to ship a shell update. */

const VERSION = 'shell-v1';
const ASSETS = [
  './', './index.html', './app.js', './styles.css',
  './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Serve the shell from cache; let everything else go straight to the network
 * without being cached. The shell is fully enumerated above, so opportunistic
 * runtime caching buys nothing and risks pinning a stale copy of some unrelated
 * same-origin file that happened to be fetched once. */
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  const scope = new URL('./', location).pathname;
  if (!url.pathname.startsWith(scope)) return;

  e.respondWith(
    caches.match(request, { ignoreSearch: true })
      .then((hit) => hit || fetch(request))
      /* A navigation to any in-app URL falls back to the shell, so deep links
         still open when there's no network. */
      .catch(() => caches.match('./index.html'))
  );
});
