/* Offline cache for Rep Counter.
 *
 * Strategy: cache-first with a quiet background refresh.
 *   - Every launch is served straight from Cache Storage, so the app opens
 *     instantly and works with no network at all (the point of this file).
 *   - In the background it re-fetches each file and updates the cache, so the
 *     next launch picks up any changes. You never wait on the network, and you
 *     are never more than one launch behind.
 *
 * Bump CACHE_VERSION whenever the app files change. Old caches are deleted on
 * activate, so storage doesn't grow over time.
 *
 * Note: Cache Storage is a real, explicit store — unlike the HTTP cache, which
 * is best-effort, revalidation-based, and evicted at the browser's discretion.
 * That difference is exactly why a service worker is needed for offline.
 */
var CACHE_VERSION = 'repcounter-v9';

var SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/fonts.css',
  'css/theme.css',
  'css/app.css',
  'js/store.js',
  'js/themes.js',
  'js/timer.js',
  'js/ui.js',
  'js/screens.js',
  'js/app.js',
  'fonts/archivo-latin.woff2',
  'fonts/bebas-neue-latin.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      /* addAll is atomic — if any file 404s nothing is cached, which would
       * leave the app half-installed. Add them individually so one missing
       * optional file can't sink the whole install. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' }))['catch'](function () {
          console.log('sw: could not cache', url);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches['delete'](k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Tapping the "REST DONE" notification should bring the workout back up, not
 * open a second copy of the app. Focus an existing window if one is still
 * alive; otherwise launch one. */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* only handle same-origin GETs; anything else goes straight to the network */
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      })['catch'](function () {
        /* offline: fall back to whatever we have. For a page navigation that
         * means the cached shell, so launching still works. */
        return cached || caches.match('index.html');
      });

      return cached || network;
    })
  );
});
