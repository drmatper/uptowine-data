// Scrapea fichas de uptowine.cl y arma wines-new.json
const fs = require('fs');

const decode = (s) => {
  if (!s) return '';
  let t = s;
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
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
  const parsed = parseIframe(html) || parseTables(html);
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

(async () => {
  const smRes = await fetch('https://uptowine.cl/sitemap.xml', { signal: AbortSignal.timeout(30000) });
  if (!smRes.ok) throw new Error('sitemap HTTP ' + smRes.status);
  const sitemap = await smRes.text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    .filter((u) => u !== 'https://uptowine.cl' && !/\/contact$/.test(u));
  console.log('URLs a revisar:', urls.length);
  const out = []; const failed = [];
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
  // ponytail: si el scrape se degrada (sitio caido/redisenado), no publicar un JSON roto
  if (wines.length < 100) throw new Error('Solo ' + wines.length + ' vinos: aborto para no publicar datos incompletos');
  fs.writeFileSync(__dirname + '/wines.json', JSON.stringify(wines, null, 2) + '\n');
})();
