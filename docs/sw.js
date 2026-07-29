// Service worker de Up to Wine (sin dependencias).
// - App shell (index, JS, fuentes, iconos): cache-first con actualización en background;
//   el JS va con hash en la URL, así que un index nuevo trae el bundle nuevo en la
//   siguiente apertura.
// - JSON de raw.githubusercontent: network-first con fallback a caché (complementa el
//   SWR de AsyncStorage: este solo cubre el arranque sin red total).
// - Imágenes jumpseller: cache-first con tope de ~100 entradas (se borra la más antigua).
// - Navegación offline: cualquier ruta desconocida sirve el index.html cacheado
//   (mismo rol que cumple 404.html online).
const SHELL = 'utw-shell-v1';
const DATA = 'utw-data-v1';
const IMGS = 'utw-imgs-v1';
const BASE = '/uptowine-data/';
const INDEX = BASE + 'index.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([BASE, INDEX, '/uptowine-data/_expo/static/js/web/entry-7fda5c53d102c1ba92a8f3cc8c23abf3.js'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL, DATA, IMGS].includes(k)).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

// cache-first + refresco en background (stale-while-revalidate)
const swr = async (cacheName, req) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || refresh.then((res) => res || Response.error());
};

const networkFirst = async (cacheName, req) => {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
};

const imageCacheFirst = async (req) => {
  const cache = await caches.open(IMGS);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) {
    await cache.put(req, res.clone());
    // ponytail: tope simple — keys() viene en orden de inserción, borramos la más vieja
    const keys = await cache.keys();
    if (keys.length > 100) await cache.delete(keys[0]);
  }
  return res;
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navegación (incluye rutas /vino/..., /fichas...): offline sirve el index cacheado
  if (req.mode === 'navigate') {
    e.respondWith(
      swr(SHELL, INDEX).catch(() => caches.match(INDEX)),
    );
    return;
  }
  // App shell: JS con hash, fuentes, iconos, manifest
  if (url.origin === self.location.origin) {
    e.respondWith(swr(SHELL, req));
    return;
  }
  // Datos del robot
  if (url.hostname === 'raw.githubusercontent.com') {
    e.respondWith(networkFirst(DATA, req));
    return;
  }
  // Fotos de vinos y portadas
  if (/jumpseller\.com$/.test(url.hostname) || url.hostname === 'online.fliphtml5.com') {
    e.respondWith(imageCacheFirst(req));
  }
});
