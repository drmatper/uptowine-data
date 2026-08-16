// Vuelca la vista catas_resumen de Supabase a ratings.json (objeto por wine_key).
// La app lo usa como respaldo offline de la nota comunitaria (Nota UTW 1-7).
// La llave anon es pública por diseño; la vista solo expone agregados.
const fs = require('fs');

const URL = 'https://oontbdybvewvziamwfcn.supabase.co/rest/v1/catas_resumen?select=*';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbnRiZHlidmV3dnppYW13ZmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTA2MjEsImV4cCI6MjA5OTk4NjYyMX0.tk951I0-1LTCBI7RJGAfZyjB99tHuhY_VgLhdnSLlfw';

(async () => {
  const res = await fetch(URL, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!res.ok) {
    // La vista aún no existe (falta correr cata-utw.sql): no romper el robot
    console.log(`catas_resumen no disponible (HTTP ${res.status}) — ratings.json queda como está`);
    process.exit(0);
  }
  const rows = await res.json();
  // Arranque en frío: con menos de 50 catas válidas en el catálogo, el promedio
  // real es ruido (2 catas de 7 → 7.0) — se ancla en 5.4, igual que la app y la vista
  const total = rows.reduce((sum, r) => sum + (r.n_validas || 0), 0);
  if (total < 50) for (const r of rows) r.promedio_catalogo = 5.4;
  const out = Object.fromEntries(rows.map((r) => [r.wine_key, r]));
  fs.writeFileSync('ratings.json', JSON.stringify(out));
  console.log(`ratings.json: ${rows.length} vinos con catas`);
})();
