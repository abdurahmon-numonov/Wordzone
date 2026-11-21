/* Offline support and fast repeat visits (v2.46).
   - Versioned files (…?v=2.46), fonts, icons and vendor libraries never change under the same URL: they come
     straight from the cache, so a repeat visit doesn't wait for a slow network at all.
   - The page itself and the course files go to the network first, so updates arrive at once; on a slow
     connection the saved page is shown after 3.5 s and the fresh one is stored for next time.
   - API calls are never cached. */
const V = '2.56.4';
const CACHE = 'vm-v' + V;
const SHELL = ['./', 'index.html', 'app.min.css?v=' + V, 'core.min.js?v=' + V, 'arcade.min.js?v=' + V,
  'course/catalog.json', 'course/en.json', 'course/de.json', 'course/es.json', 'course/fr.json', 'course/it.json', 'course/ko.json',
  'vendor/qrcode/qrcode.js', 'vendor/lottie_light.min.js', 'motion/editorial-achievement.js', 'manifest.webmanifest',
  'vendor/fonts/fonts.css?v=' + V, 'icons/icon-192.png'];
const PAGE_WAIT = 3500;

// Files without a version in the URL (course texts, libraries, icons) rarely change between releases: an update
// copies them from the previous cache instead of downloading ~4 MB again; using them online still refreshes them.
const REUSE = url => !/[?&]v=/.test(url) && /^(course|vendor|motion|icons)\//.test(url);
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(url =>
    (REUSE(url) ? caches.match(url) : Promise.resolve(null)).then(hit => hit ? c.put(url, hit) : c.add(url))
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function store(request, res) {
  if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(request, copy)); }
  return res;
}
function immutable(url) {
  return url.searchParams.has('v') || /^\/(vendor|icons|motion)\//.test(url.pathname);
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (immutable(url)) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => store(e.request, res))));
    return;
  }
  const network = fetch(e.request).then(res => store(e.request, res));
  const saved = () => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined));
  if (e.request.mode === 'navigate') {
    // the fresh page if it comes within 3.5 s, otherwise the saved one (the fresh one still lands in the cache)
    e.respondWith(new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => saved().then(r => { if (r && !done) { done = true; resolve(r); } }), PAGE_WAIT);
      network.then(res => { if (!done) { done = true; clearTimeout(timer); resolve(res); } })
        .catch(() => saved().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
    }));
    e.waitUntil(network.catch(() => {}));
    return;
  }
  e.respondWith(network.catch(() => saved().then(r => r || Response.error())));
});
