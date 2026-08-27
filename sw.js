/* =====================================================================
   ErgonSite service worker

   Its main job is to exist. Chrome only offers the automatic "Install
   app" prompt when the page is controlled by a service worker that has
   a fetch handler. The manifest alone gets you the manual "Add to Home
   screen" menu item, but not the prompt.

   The strategy is deliberately conservative: network first, cache only
   as a fallback. An aggressive cache-first worker is how sites end up
   serving yesterday's CSS to people who have already refreshed twice,
   which is a far worse bug than a missing offline page.
   ===================================================================== */

const CACHE = 'ergonsite-v1';

/* Only the shell: enough to show something sensible with no signal. */
const PRECACHE = [
  '/',
  '/styles.css',
  '/assets/logo.png',
  '/assets/icon-192.png',
  '/site.webmanifest'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .catch(function () {})       // a failed precache must not block install
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                               .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* Never touch anything but same-origin GETs. Form posts to Web3Forms,
     analytics beacons and EmailJS calls go straight to the network. */
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) { return hit || caches.match('/'); });
      })
  );
});
