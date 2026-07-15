// Scrapea fichas de uptowine.cl y arma wines-new.json
const fs = require('fs');

const decode = (s) => {
  if (!s) return '';
  let t = s;
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
      .replace(/&aacute;/gi, (m) => m[1] === 'A' ? 'Á' : 'á')
      .replace(/&eacute;/gi, (m) => m[1] === 'E' ? 'É' : 'é')
      .replace(/&iacute;/gi, (m) => m[1] === 'I' ? 'Í' : 'í')
      .replace(/&oacute;/gi, (m) => m[1] === 'O' ? 'Ó' : 'ó')
      .replace(/&uacute;/gi, (m) => m[1] === 'U' ? 'Ú' : 'ú')
      .replace(/&ntilde;/gi, (m) => m[1] === 'N' ? 'Ñ' : 'ñ')
      .replace(/&iquest;/g, '¿').replace(/&iexcl;/g, '¡')
      .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
      .replace(/&#8505;|&#65039;/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }
  return t;
};
const stripTags = (s) => decode(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function parseTables(desc) {
  // formato: <h4>Añada 2020</h4><table>...</table> ... <h3>¿Qué opina...</h3><p>..</p>
  const anadas = [];
  const re = /<h4>\s*A(?:&ntilde;|ñ)ada\s*(\d{4})?[^<]*<\/h4>\s*<table>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(desc))) {
    const year = m[1] || '';
    const body = m[2];
    const fields = {};
    const rowRe = /<tr><td><b>([\s\S]*?)<\/b><\/td><td>([\s\S]*?)<\/td><\/tr>/gi;
    let r;
    while ((r = rowRe.exec(body))) {
      const label = stripTags(r[1]).toLowerCase();
      const rawVal = r[2];
      if (label.startsWith('cepa')) fields.cepa = stripTags(rawVal);
      else if (label.startsWith('valle')) fields.valle = stripTags(rawVal);
      else if (label.startsWith('graduaci')) fields.grad = stripTags(rawVal);
      else if (label.startsWith('crianza')) fields.crianza = stripTags(rawVal);
      else if (label.startsWith('nota')) fields.nota = stripTags(rawVal);
      else if (label.startsWith('premios')) fields.premios = stripTags(rawVal);
      else if (label.includes('revista')) {
        const href = /href=["']?([^"'\s>]+)/i.exec(decode(rawVal));
        if (href) fields.revista = href[1];
      }
    }
    anadas.push({ anada: year, ...fields });
  }
  const opinaM = /<h3>[^<]*opina[^<]*<\/h3>\s*<p>([\s\S]*?)<\/p>/i.exec(decode(desc));
  const sugiereM = /<h3>[^<]*sugiere[^<]*<\/h3>\s*<p>([\s\S]*?)<\/p>/i.exec(decode(desc));
  return { anadas, opina: opinaM ? stripTags(opinaM[1]) : '', sugiere: sugiereM ? stripTags(sugiereM[1]) : '' };
}

function parseTabs(desc) {
  // formato 3: pestañas CSS <div class='panel pNOMBREAAAA'> con pares <p class='lb'>/<p class='vl'>
  if (!/class=['"]panel /.test(desc)) return null;
  const anadas = [];
  const chunks = desc.split(/<div class=['"]panel /).slice(1);
  for (const ch of chunks) {
    const yearM = /^[a-z0-9_-]*?(\d{4})?['"]/.exec(ch);
    const year = (yearM && yearM[1]) || '';
    const fields = {};
    for (const f of ch.matchAll(/<p class=['"]lb['"]>([\s\S]*?)<\/p>\s*<p class=['"]vl['"]>([\s\S]*?)<\/p>/g)) {
      const label = stripTags(f[1]).toLowerCase();
      const rawVal = f[2];
      if (label.startsWith('cepa')) fields.cepa = stripTags(rawVal);
      else if (label.startsWith('valle')) fields.valle = stripTags(rawVal);
      else if (label.startsWith('graduaci')) fields.grad = stripTags(rawVal);
      else if (label.startsWith('crianza')) fields.crianza = stripTags(rawVal);
      else if (label.startsWith('nota')) fields.nota = stripTags(rawVal);
      else if (label.startsWith('premios')) fields.premios = stripTags(rawVal);
      else if (label.includes('revista')) {
        const href = /href=["']?([^"'\s>]+)/i.exec(decode(rawVal));
        if (href) fields.revista = href[1];
      }
    }
    if (Object.keys(fields).length) anadas.push({ anada: year, ...fields });
  }
  if (!anadas.length) return null;
  const un = decode(desc);
  const opinaM = /<h3>[^<]*opina[^<]*<\/h3>\s*<p>([\s\S]*?)<\/p>/i.exec(un);
  const sugiereM = /<h3>[^<]*sugiere[^<]*<\/h3>\s*<p>([\s\S]*?)<\/p>/i.exec(un);
  return { anadas, opina: opinaM ? stripTags(opinaM[1]) : '', sugiere: sugiereM ? stripTags(sugiereM[1]) : '' };
}

function parseIframe(desc) {
  // formato nuevo: iframe srcdoc con const DATA={...};
  const un = decode(desc);
  const m = /const DATA\s*=\s*(\{[\s\S]*?\});/.exec(un);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    return {
      anadas: (data.anadas || []).map((a) => ({
        anada: a.anada, cepa: a.cepa, valle: a.valle, grad: a.grad,
        crianza: a.crianza, nota: a.nota, premios: a.premios, revista: a.revista,
      })),
      opina: data.opina || '', sugiere: data.sugiere || '',
    };
  } catch (e) { return null; }
}

async function fetchPage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      if (!res.ok) return { status: res.status };
      return { status: 200, html: await res.text() };
    } catch (e) { if (i === 2) return { status: 0, err: String(e) }; }
  }
}

function extractProduct(url, html) {
  // JSON-LD Product
  const ldMatches = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  let prod = null;
  for (const lm of ldMatches) {
    try {
      const obj = JSON.parse(lm[1]);
      const arr = Array.isArray(obj) ? obj : [obj];
      for (const o of arr) if (o['@type'] === 'Product') prod = o;
    } catch (e) {}
  }
  if (!prod) return null;
  const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
  const image = Array.isArray(prod.image) ? prod.image[0] : prod.image;
  // ficha: usar el HTML completo de la página (el description está renderizado dentro)
  const parsed = parseIframe(html) || parseTabs(html) || parseTables(html);
  return {
    name: stripTags(prod.name || ''),
    winery: stripTags((prod.brand && (prod.brand.name || prod.brand)) || ''),
    image: image || '',
    url,
    price: offers ? Number(offers.price) : null,
    available: offers ? /InStock/i.test(String(offers.availability || '')) : null,
    anadas: parsed ? parsed.anadas : [],
    opina: parsed ? parsed.opina : '',
    sugiere: parsed ? parsed.sugiere : '',
  };
}

// --- Fuente preferida: API de Jumpseller (ve productos ocultos/deshabilitados) ---
async function fetchViaApi() {
  const login = process.env.JUMPSELLER_LOGIN;
  const token = process.env.JUMPSELLER_AUTHTOKEN;
  if (!login || !token) return null;
  const auth = 'Basic ' + Buffer.from(`${login}:${token}`).toString('base64');
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`https://api.jumpseller.com/v1/products.json?limit=100&page=${page}`, {
      headers: { Authorization: auth }, signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error('API Jumpseller HTTP ' + res.status);
    const batch = await res.json();
    if (!batch.length) break;
    for (const { product } of batch) {
      const desc = product.description || '';
      const parsed = parseIframe(desc) || parseTabs(desc) || parseTables(desc);
      if (!parsed || !parsed.anadas.length || !parsed.opina) continue;
      out.push({
        name: stripTags(product.name || ''),
        winery: stripTags(product.brand || ''),
        image: (product.images && product.images[0] && product.images[0].url) || '',
        url: 'https://uptowine.cl/' + product.permalink,
        price: product.price != null ? Number(product.price) : null,
        available: product.status === 'available' && (product.stock_unlimited || product.stock > 0),
        status: product.status,
        anadas: parsed.anadas, opina: parsed.opina, sugiere: parsed.sugiere,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

(async () => {
  const smRes = await fetch('https://uptowine.cl/sitemap.xml', { signal: AbortSignal.timeout(30000) });
  if (!smRes.ok) throw new Error('sitemap HTTP ' + smRes.status);
  const sitemap = await smRes.text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    .filter((u) => u !== 'https://uptowine.cl' && !/\/contact$/.test(u));
  let out = []; const failed = [];
  let viaApi = false;
  try {
    const apiWines = await fetchViaApi();
    if (apiWines && apiWines.length) { out = apiWines; viaApi = true; console.log('Fuente: API Jumpseller —', out.length, 'fichas'); }
  } catch (e) {
    console.log('API falló (' + e.message + '), usando scraping de páginas');
  }
  if (!viaApi) {
    console.log('URLs a revisar:', urls.length);
    const queue = [...urls];
    const workers = Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const url = queue.shift();
        const page = await fetchPage(url);
        if (!page || page.status !== 200) { failed.push({ url, status: page && page.status }); continue; }
        const p = extractProduct(url, page.html);
        if (p) out.push(p);
      }
    });
    await Promise.all(workers);
  }
  const wines = out.filter((x) => x.anadas.length && x.opina).map((x) => ({
    name: x.name, winery: x.winery, image: x.image, url: x.url,
    price: x.price, available: x.available === true,
    anadas: [...x.anadas].sort((a, b) => (b.anada || '0').localeCompare(a.anada || '0')).map((a) => ({
      anada: a.anada || '', cepa: a.cepa || '', valle: a.valle || '', grad: a.grad || '',
      crianza: a.crianza || '', nota: a.nota || '', premios: a.premios || '', revista: a.revista || '',
    })),
    opina: x.opina, sugiere: x.sugiere,
  })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  console.log('Vinos con ficha completa:', wines.length, '| fallidas:', failed.length);
  // --- Recetas del sommelier: enlazar platos del 'sugiere' con el catalogo de recetas ---
  const recetas = JSON.parse(fs.readFileSync(__dirname + '/recetas.json', 'utf8'));
  const alias = JSON.parse(fs.readFileSync(__dirname + '/alias-platos.json', 'utf8'));
  const normKey = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const recipeWords = recetas.map((r) => ({ slug: r.slug, words: new Set(normKey(r.nombre).split(/\W+/).filter((w) => w.length > 3)) }));
  const fuzzyMatch = (dish) => {
    const words = normKey(dish).split(/\W+/).filter((w) => w.length > 3);
    if (!words.length) return null;
    let best = null;
    for (const rw of recipeWords) {
      const hits = words.filter((w) => rw.words.has(w)).length;
      const ratio = hits / Math.max(words.length, 1);
      if (ratio >= 0.5 && (!best || hits > best.hits)) best = { slug: rw.slug, hits };
    }
    return best && best.slug;
  };
  const platosPorVino = {};
  const sinReceta = new Set();
  for (const wine of wines) {
    const permalink = (wine.url || '').split('/').filter(Boolean).pop();
    const first = (wine.sugiere || '').split('.')[0];
    const dishes = first.split(',').map((x) => x.trim()).filter((x) => x.length > 3);
    const linked = [];
    for (const dish of dishes) {
      const slug = alias[normKey(dish)] || fuzzyMatch(dish);
      if (slug) {
        linked.push({ plato: dish, receta_slug: slug });
        if (!alias[normKey(dish)]) alias[normKey(dish)] = slug; // aprender alias nuevo
      } else sinReceta.add(dish);
    }
    if (linked.length) platosPorVino[permalink] = linked;
  }
  fs.writeFileSync(__dirname + '/recipes.json', JSON.stringify({ recetas, platosPorVino }) + '\n');
  fs.writeFileSync(__dirname + '/alias-platos.json', JSON.stringify(alias, null, 1) + '\n');
  console.log('Recetas enlazadas a', Object.keys(platosPorVino).length, 'vinos | platos sin receta:', sinReceta.size);
  if (sinReceta.size) [...sinReceta].slice(0, 10).forEach((d) => console.log('  SIN RECETA:', d));

  // ponytail: si el scrape se degrada (sitio caido/redisenado), no publicar un JSON roto
  if (wines.length < 100) throw new Error('Solo ' + wines.length + ' vinos: aborto para no publicar datos incompletos');
  fs.writeFileSync(__dirname + '/wines.json', JSON.stringify(wines, null, 2) + '\n');

  // --- Revistas: paginas /revistas* con JSON embebido {y,m,u,s} ---
  const revPages = urls.filter((u) => /\/revistas/.test(u));
  const bySlug = new Map();
  for (const rp of revPages) {
    const page = await fetchPage(rp);
    if (!page || page.status !== 200) continue;
    for (const m of page.html.matchAll(/\{"y":\s*(\d{4}),\s*"m":\s*"([^"]+)",\s*"u":\s*"([^"]+)",\s*"s":\s*"([^"]+)"\}/g)) {
      const [, y, mes, u, s] = m;
      if (!bySlug.has(s)) bySlug.set(s, { year: y, month: mes, slug: s, title: mes + ' ' + y, url: u, cover: 'https://online.fliphtml5.com/votjo/' + s + '/files/shot.jpg?v=2' });
    }
  }
  const mags = [...bySlug.values()];
  console.log('Revistas encontradas:', mags.length);
  if (mags.length >= 50) {
    fs.writeFileSync(__dirname + '/magazines.json', JSON.stringify(mags, null, 2) + '\n');
  } else {
    console.log('Muy pocas revistas: mantengo magazines.json anterior');
  }
})();
