// Service worker de Up to Wine (sin dependencias).
// - App shell (index, JS, fuentes, iconos): cache-first con actualización en background;
//   el JS va con hash en la URL, así que un index nuevo trae el bundle nuevo en la
//   siguiente apertura.
// - JSON de raw.githubusercontent: network-first con fallback a caché (complementa el
//   SWR de AsyncStorage: este solo cubre el arranque sin red total).
// - Imágenes jumpseller: cache-first con tope de ~100 entradas (se borra la más antigua).
// - Navegación offline: cualquier ruta desconocida sirve el index.html cacheado
//   (mismo rol que cumple 404.html online).
const SHELL = 'utw-shell-v3'; // v3: rediseño Crimson (Archivo/Jost)
const DATA = 'utw-data-v1';
const IMGS = 'utw-imgs-v1';
const OCR = 'utw-ocr-v1';
const BASE = '/uptowine-data/';
const INDEX = BASE + 'index.html';

// El deploy reemplaza PRECACHE con la lista real: index, bundle JS, fuentes usadas y logo.
const PRECACHE = ["/uptowine-data/","/uptowine-data/index.html","/uptowine-data/_expo/static/js/web/entry-84845912b9d7021634f96a3bcfa124de.js","/uptowine-data/assets/assets/brand/logo-horizontal.09c7986ffa88b208c4ebd411d9537892.png","/uptowine-data/assets/node_modules/@expo-google-fonts/archivo/700Bold/Archivo_700Bold.05670a2716518402b517d63a9e8d3413.ttf","/uptowine-data/assets/node_modules/@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.2a3f365320f15aeaa2b006ad720e5a40.ttf","/uptowine-data/assets/node_modules/@expo-google-fonts/instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.4036d1c3db2f215c15e9c022fb4644c8.ttf","/uptowine-data/assets/node_modules/@expo-google-fonts/jost/400Regular/Jost_400Regular.3ccf189874e82464a4233d9dccd41c97.ttf","/uptowine-data/assets/node_modules/@expo-google-fonts/jost/500Medium/Jost_500Medium.090175d88161f36142c3b541783ca73b.ttf","/uptowine-data/assets/node_modules/@expo-google-fonts/jost/600SemiBold/Jost_600SemiBold.50dcc642bc107b54d474ab83800ac187.ttf"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL, DATA, IMGS, OCR].includes(k)).map((k) => caches.delete(k)),
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
    return;
  }
  // Escáner: worker/core/modelo español de tesseract (se bajan una vez, quedan para siempre)
  if (/(cdn\.jsdelivr\.net|unpkg\.com|tessdata\.projectnaptha\.com)$/.test(url.hostname)) {
    e.respondWith(
      caches.open(OCR).then(async (c) => (await c.match(req)) || fetch(req).then((res) => {
        if (res && res.ok) c.put(req, res.clone());
        return res;
      })),
    );
  }
});
