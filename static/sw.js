var CACHE_VERSION = 'iasds-v1';
var PRECACHE = [
  '/',
  '/fonts/SeasonCollectionVF-subset.woff2',
  '/fonts/linux-libertine-subset-regular.woff2',
  '/fonts/linux-libertine-subset-italic.woff2',
  '/fonts/linux-libertine-subset-bold.woff2',
  '/favicon.svg'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  var isStatic = /\.(woff2|webp|png|svg|css|js|asc)$/.test(url.pathname);

  if (isStatic) {
    e.respondWith(
      caches.match(req).then(function(hit) {
        return hit || fetch(req).then(function(res) {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, copy); });
          return res;
        });
      })
    );
  } else if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function(res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, copy); });
        return res;
      }).catch(function() {
        return caches.match(req).then(function(hit) {
          return hit || caches.match('/');
        });
      })
    );
  }
});
