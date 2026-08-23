/* F&H Golf Course — service worker.
   Network-first so the live site is always fresh online; falls back to a small
   cached shell when offline. Enables "Add to Home Screen" / installability. */
var CACHE = "fh-cache-v336";
var SHELL = ["./", "./index.html", "./css/styles.css", "./js/main.js", "./images/logo.png", "./tournaments.html", "./history.html", "./founders-flights.html", "./founders-calcutta-display.html", "./founders-leaderboard-display.html", "./founders-rules.html", "./founders-recap.html", "./admin-people.html", "./live.html", "./leaderboard.html", "./couples-rules.html", "./recap.html", "./couples-leaderboard-display.html"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // never touch form POSTs, etc.
  e.respondWith(
    fetch(req)
      .then(function (res) {
        try {
          if (new URL(req.url).origin === self.location.origin) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
        } catch (err) {}
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (m) {
          return m || (req.mode === "navigate" ? caches.match("./index.html") : undefined);
        });
      })
  );
});
