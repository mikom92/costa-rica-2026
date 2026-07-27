/* Offline support.
   The plan is used in Monteverde and along the Caribbean, where the page itself warns
   that signal disappears — so it has to survive with no network at all. */

const VERSION = 'cr26-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

// Live data must never be served from cache.
const NEVER_CACHE = ['supabase.co', 'api.frankfurter.app'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      // One failed asset must not fail the whole install.
      .then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER_CACHE.some(h => url.hostname.endsWith(h))) return;

  // Documents: network first, so an updated itinerary is never masked by a stale copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Everything else (fonts, icon, CDN bundle): cache first, refresh in the background.
  event.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
