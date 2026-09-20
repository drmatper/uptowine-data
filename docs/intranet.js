/* Intranet Up to Wine — CRM propio: contactos, campañas, plantillas e historial.
 *
 * Se sirve desde https://app.uptowine.cl/intranet.js y lo carga un bloque de tres
 * líneas en el tema de Jumpseller (página uptowine.cl/intranet). Editar aquí y
 * publicar con `bash deploy-intranet.sh`: nada de pegar código en el admin.
 *
 * Entra solo quien tenga sesión de Supabase y profiles.admin = true; sin eso la
 * base no devuelve nada (RLS) y la función 'intranet' responde 403. La llave de
 * abajo es la ANON, pública por diseño: las de verdad (Resend, service role)
 * viven en el servidor.
 *
 * La interfaz es clara a propósito (se trabaja de día y muchas horas); los
 * correos que se ARMAN aquí llevan la marca oscura de Up to Wine.
 */
(function () {
  'use strict';

  var AQUI = typeof document !== 'undefined' ? document.currentScript : null;
  var SB_URL = 'https://oontbdybvewvziamwfcn.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbnRiZHlidmV3dnppYW13ZmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTA2MjEsImV4cCI6MjA5OTk4NjYyMX0.tk951I0-1LTCBI7RJGAfZyjB99tHuhY_VgLhdnSLlfw';
  var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var LOGO = 'https://app.uptowine.cl/og-logo.png';
  var MAX_ADJUNTO = 8 * 1024 * 1024;
  var MAX_ADJUNTOS = 3;

  // ==========================================================================
  // 1) Piezas puras (las prueba scripts/test-intranet.js)
  // ==========================================================================

  // 569XXXXXXXX, o '' si no se puede con certeza: un WhatsApp al número
  // equivocado no se deshace.
  function fonoWhatsApp(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 9 && d.charAt(0) === '9') return '56' + d;
    if (d.length === 11 && d.indexOf('569') === 0) return d;
    return '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function personalizar(texto, c) {
    c = c || {};
    var pila = (c.nombre || '').trim().split(/\s+/)[0] || 'hola';
    return String(texto || '')
      .replace(/\{nombre\}/gi, pila)
      .replace(/\{nombre_completo\}/gi, c.nombre || pila)
      .replace(/\{email\}/gi, c.email || '')
      .replace(/\{celular\}/gi, c.celular || '')
      .replace(/\{comuna\}/gi, c.comuna || '');
  }

  function plata(n) {
    return n == null ? '' : '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function fecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function diasDesde(iso) {
    if (!iso) return null;
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  // --- marcado del correo -----------------------------------------------------
  var URL_OK = /^https?:\/\/[^\s"'<>]+$/i;
  function enlaceSeguro(url) { return URL_OK.test(String(url || '').trim()) ? String(url).trim() : ''; }

  function enLinea(t) {
    return t
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
        var u = enlaceSeguro(url);
        return u ? '<img src="' + u + '" alt="' + alt + '" style="max-width:100%;border-radius:10px;margin:6px 0">' : '';
      })
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, txt, url) {
        var u = enlaceSeguro(url);
        return u ? '<a href="' + u + '" style="color:#E2123F;text-decoration:underline">' + txt + '</a>' : txt;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  function cuerpoHtml(texto) {
    var bloques = esc(texto || '').split(/\n{2,}/);
    var salida = [];
    for (var i = 0; i < bloques.length; i++) {
      var b = bloques[i].trim();
      if (!b) continue;
      var boton = b.match(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/);
      if (boton) {
        var u = enlaceSeguro(boton[2]);
        if (!u) continue;
        salida.push(
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px auto"><tr><td style="border-radius:999px;background:#E2123F">' +
          '<a href="' + u + '" style="display:inline-block;padding:14px 30px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:bold;letter-spacing:.6px;color:#ffffff;text-decoration:none">' +
          boton[1].trim() + '</a></td></tr></table>');
        continue;
      }
      if (/^---$/.test(b)) { salida.push('<div style="border-top:1px solid #ece2dc;margin:24px 0"></div>'); continue; }
      if (/^##\s+/.test(b)) {
        salida.push('<h2 style="margin:0 0 14px;font-family:Georgia,serif;font-size:23px;line-height:1.25;color:#2a1a1f">' + enLinea(b.replace(/^##\s+/, '')) + '</h2>');
        continue;
      }
      if (/^[-*]\s+/m.test(b) && b.split('\n').every(function (l) { return /^[-*]\s+/.test(l.trim()) || !l.trim(); })) {
        var items = b.split('\n').filter(function (l) { return l.trim(); })
          .map(function (l) { return '<li style="margin:0 0 7px">' + enLinea(l.replace(/^\s*[-*]\s+/, '')) + '</li>'; }).join('');
        salida.push('<ul style="margin:0 0 16px;padding-left:20px">' + items + '</ul>');
        continue;
      }
      salida.push('<p style="margin:0 0 15px">' + enLinea(b).replace(/\n/g, '<br>') + '</p>');
    }
    return salida.join('\n');
  }

  function correoHtml(texto, contacto) {
    return '' +
'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
'<body style="margin:0;padding:0;background:#f4efec">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efec;padding:26px 12px">' +
'<tr><td align="center">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)">' +
'<tr><td align="center" style="background:#0A0708;padding:22px">' +
'<img src="' + LOGO + '" alt="Up to Wine" width="150" style="display:block;width:150px;max-width:60%;height:auto">' +
'</td></tr>' +
'<tr><td style="padding:30px 32px 6px;font-family:Georgia,\'Times New Roman\',serif;font-size:16px;line-height:1.65;color:#2a1a1f">' +
cuerpoHtml(personalizar(texto, contacto)) +
'</td></tr>' +
'<tr><td style="padding:10px 32px 28px">' +
'<div style="border-top:1px solid #ece2dc;margin-bottom:14px"></div>' +
'<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8d7b80">' +
'Up to Wine &middot; Vinos de autor de Chile<br>' +
'<a href="https://uptowine.cl" style="color:#E2123F;text-decoration:none">uptowine.cl</a> &middot; ventas@uptowine.cl &middot; +56 9 3173 7400<br>' +
'Si no quieres seguir recibiendo estos correos, responde con la palabra BAJA y te sacamos de la lista.' +
'</p></td></tr>' +
'</table></td></tr></table></body></html>';
  }

  function correoTexto(texto, contacto) {
    return personalizar(texto, contacto)
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$1: $2')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')
      .replace(/^##\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim() + '\n\n—\nUp to Wine · uptowine.cl · ventas@uptowine.cl\nResponde con la palabra BAJA para no recibir más correos.';
  }

  // --- CSV: importar contactos de otra herramienta ---------------------------
  // Acepta coma o punto y coma, comillas y BOM. Devuelve {cabeceras, filas}.
  function csvLeer(texto) {
    var t = String(texto || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
    if (!t) return { cabeceras: [], filas: [] };
    var sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    var filas = [], campo = '', fila = [], comillas = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (comillas) {
        if (ch === '"' && t[i + 1] === '"') { campo += '"'; i++; }
        else if (ch === '"') comillas = false;
        else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) { fila.push(campo.trim()); campo = ''; }
      else if (ch === '\n') { fila.push(campo.trim()); filas.push(fila); fila = []; campo = ''; }
      else campo += ch;
    }
    fila.push(campo.trim());
    filas.push(fila);
    var cabeceras = filas.shift().map(function (h) { return h.toLowerCase(); });
    return { cabeceras: cabeceras, filas: filas.filter(function (f) { return f.join('').trim(); }) };
  }

  // Reconoce las columnas venga de donde venga (Brevo, Mailchimp, Excel a mano).
  function csvMapear(cabeceras) {
    var busca = function (opciones) {
      for (var i = 0; i < cabeceras.length; i++) {
        for (var j = 0; j < opciones.length; j++) if (cabeceras[i].indexOf(opciones[j]) !== -1) return i;
      }
      return -1;
    };
    return {
      nombre: busca(['nombre', 'name', 'first']),
      email: busca(['email', 'correo', 'mail']),
      celular: busca(['celular', 'telefono', 'teléfono', 'phone', 'movil', 'móvil', 'whatsapp']),
      etiquetas: busca(['etiqueta', 'tag', 'segmento']),
    };
  }

  function csvSalida(contactos) {
    var cab = 'nombre,email,celular,origen,etiquetas,compras,total,ultima_compra,baja';
    var comilla = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    return cab + '\n' + contactos.map(function (c) {
      return [c.nombre, c.email, c.celular, (c.origen || []).join(' '), (c.etiquetas || []).join(' '),
        c.n_pedidos, c.total_gastado, c.ultima_compra, c.baja ? 'si' : 'no'].map(comilla).join(',');
    }).join('\n');
  }

  if (typeof module !== 'undefined' && module.exports) {   // solo para los tests
    module.exports = { fonoWhatsApp: fonoWhatsApp, esc: esc, personalizar: personalizar,
      plata: plata, cuerpoHtml: cuerpoHtml, correoHtml: correoHtml, correoTexto: correoTexto,
      enlaceSeguro: enlaceSeguro, csvLeer: csvLeer, csvMapear: csvMapear, csvSalida: csvSalida,
      diasDesde: diasDesde };
    return;
  }

  // ==========================================================================
  // 2) Estado
  // ==========================================================================

  var sb = null;
  var VACIA = { id: null, nombre: '', canal: 'correo', asunto: '', cuerpo: '', segmento_id: null, destinatarios: [], estado: 'borrador' };
  var S = {
    sesion: null, admin: false, listo: false,
    vista: 'resumen',
    contactos: [], total: 0, q: '', origen: '', etiqueta: '', compras: '', sel: {}, ficha: null,
    segmentos: [], plantillas: [], campanas: [], historial: [], cola: null, metricas: null,
    etiquetas: [],
    campana: null, adjuntos: [], previa: 'escritorio',
    importar: null,
    msj: '', err: false, ocupado: false, confirmar: false, progreso: '',
  };

  // Diseños de arranque, como la galería de plantillas de Brevo/Mailchimp.
  var GALERIA = [
    { nombre: 'Novedades del mes', asunto: 'Lo nuevo en Up to Wine, {nombre}',
      cuerpo: '## Hola {nombre}\n\nEste mes sumamos vinos que nos tienen entusiasmados. Te dejamos tres que vale la pena probar.\n\n- **Vino uno** — una línea de por qué\n- **Vino dos** — una línea de por qué\n- **Vino tres** — una línea de por qué\n\n[[Ver el catálogo|https://uptowine.cl]]\n\nSalud,\nEquipo Up to Wine' },
    { nombre: 'Oferta con fecha', asunto: 'Solo hasta el domingo: {nombre}, esto te interesa',
      cuerpo: '## Tres días, seis botellas\n\nHola {nombre}, armamos una caja especial a precio de socio y la dejamos disponible hasta el domingo.\n\n**Qué trae**\n\n- Dos tintos de guarda\n- Dos de entrada, para la semana\n- Dos blancos frescos\n\n[[Quiero la caja|https://uptowine.cl]]\n\nSi te quedan dudas, respóndenos este correo y te ayudamos a elegir.' },
    { nombre: 'Bienvenida', asunto: 'Bienvenido al club, {nombre}',
      cuerpo: '## Qué bueno tenerte, {nombre}\n\nDesde hoy eres parte del club. Esto es lo que ganas:\n\n- Precios de socio en todo el catálogo\n- La revista mensual con las fichas de cada vino\n- Acceso a las botellas que llegan en poca cantidad\n\n[[Entrar a mi cuenta|https://app.uptowine.cl]]\n\nCualquier cosa, escríbenos por aquí mismo.' },
    { nombre: 'Recuperar cliente', asunto: '{nombre}, hace rato que no nos vemos',
      cuerpo: '## Te echamos de menos\n\nHola {nombre}: revisando nuestras notas vimos que hace un tiempo no pides nada. Nos gustaría saber si fue algo nuestro.\n\nSi quieres retomar, responde este correo con lo que sueles tomar y te armamos una selección a tu medida.\n\n[[Ver lo nuevo|https://uptowine.cl]]' },
  ];

  var CSS = [
    '.utwi{--bg:#f6f7f9;--panel:#fff;--linea:#e6e8ec;--tx:#111827;--tx2:#6b7280;--tx3:#9aa1ad;--crim:#E2123F;--crimSoft:#fdeef1;--ok:#0b7a4b;--okSoft:#e8f6ef;--warn:#9a5b00;--warnSoft:#fdf3e3;',
    '  width:min(1320px,calc(100% - 16px));margin:22px auto;color:var(--tx);font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;background:var(--bg);border:1px solid var(--linea);border-radius:16px;overflow:hidden}',
    '.utwi *{box-sizing:border-box}',
    '.utwi h1,.utwi h2,.utwi h3{margin:0;color:var(--tx)!important;font-family:inherit;letter-spacing:-.2px}',
    '.utwi h1{font-size:19px;font-weight:650}',
    '.utwi h3{font-size:15px;font-weight:620}',
    '.utwi a{color:var(--crim)}',
    /* cabecera */
    '.utwi .top{display:flex;align-items:center;gap:12px;padding:13px 16px;background:var(--panel);border-bottom:1px solid var(--linea)}',
    '.utwi .marca{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.3px}',
    '.utwi .punto{width:9px;height:9px;border-radius:50%;background:var(--crim)}',
    '.utwi .top .sp{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--tx2);font-size:12.5px}',
    /* estructura */
    '.utwi .cuerpo{display:grid;grid-template-columns:196px 1fr;min-height:560px}',
    '.utwi .lado{padding:12px 10px;background:var(--panel);border-right:1px solid var(--linea)}',
    '.utwi .nav{display:flex;align-items:center;gap:9px;width:100%;padding:9px 11px;margin-bottom:2px;border:0;border-radius:9px;background:transparent;color:var(--tx2);cursor:pointer;font:inherit;font-size:13.5px;text-align:left}',
    '.utwi .nav:hover{background:#f2f4f7;color:var(--tx)}',
    '.utwi .nav.on{background:var(--crimSoft);color:var(--crim);font-weight:600}',
    '.utwi .nav .n{margin-left:auto;font-size:11.5px;color:var(--tx3)}',
    '.utwi .panel{padding:18px;overflow:auto}',
    '.utwi .cab{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}',
    '.utwi .cab .sp{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}',
    /* tarjetas */
    '.utwi .card{padding:15px;background:var(--panel);border:1px solid var(--linea);border-radius:13px}',
    '.utwi .grid{display:grid;gap:12px}',
    '.utwi .g4{grid-template-columns:repeat(4,1fr)}',
    '.utwi .g3{grid-template-columns:repeat(3,1fr)}',
    '.utwi .g2{grid-template-columns:1fr 1fr}',
    '.utwi .kpi b{display:block;font-size:26px;font-weight:680;letter-spacing:-.5px}',
    '.utwi .kpi span{color:var(--tx2);font-size:12.5px}',
    /* controles */
    '.utwi input,.utwi textarea,.utwi select{width:100%;padding:9px 11px;border:1px solid var(--linea);border-radius:9px;background:#fff;color:var(--tx);font:inherit}',
    '.utwi input:focus,.utwi textarea:focus,.utwi select:focus{outline:2px solid var(--crimSoft);border-color:var(--crim)}',
    '.utwi textarea{min-height:260px;resize:vertical;font-size:13.5px;line-height:1.6}',
    '.utwi .lbl{display:block;margin:12px 0 5px;color:var(--tx2);font-size:12px;font-weight:600}',
    '.utwi .btn{display:inline-flex;align-items:center;gap:7px;padding:9px 15px;border:1px solid var(--crim);border-radius:9px;background:var(--crim);color:#fff;cursor:pointer;font:inherit;font-size:13px;font-weight:600;white-space:nowrap}',
    '.utwi .btn:hover{filter:brightness(1.05)}',
    '.utwi .btn[disabled]{opacity:.45;cursor:not-allowed}',
    '.utwi .btn.sec{background:#fff;color:var(--tx);border-color:var(--linea)}',
    '.utwi .btn.sec:hover{background:#f7f8fa}',
    '.utwi .btn.peligro{background:#8A0F2A;border-color:#8A0F2A}',
    '.utwi .btn.mini{padding:6px 11px;font-size:12px}',
    '.utwi .chip{padding:6px 11px;border:1px solid var(--linea);border-radius:999px;background:#fff;color:var(--tx2);cursor:pointer;font:inherit;font-size:12.5px}',
    '.utwi .chip.on{background:var(--tx);border-color:var(--tx);color:#fff}',
    '.utwi .tag{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;margin:2px 4px 2px 0;border-radius:999px;background:#eef1f5;color:#48505c;font-size:11.5px}',
    '.utwi .tag button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0}',
    '.utwi .tag.vino{background:#fdeef1;color:#a1102f}',
    '.utwi .tag.dorado{background:#fdf3e3;color:#8a5b00}',
    '.utwi .tag.verde{background:#e8f6ef;color:#0b7a4b}',
    '.utwi .tag.azul{background:#e8f1fd;color:#13538f}',
    '.utwi .tag.morado{background:#f1ecfd;color:#5b3aa8}',
    '.utwi .tag.naranjo{background:#fdf0e8;color:#9a4a12}',
    '.utwi .acciones{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 13px;border:1px solid var(--crim);border-radius:11px;background:var(--crimSoft)}',
    '.utwi .acciones select{width:auto;min-width:170px}',
    '.utwi .punto-color{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:7px;vertical-align:-1px}',
    '.utwi .pill{display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:600}',
    '.utwi .pill.ok{background:var(--okSoft);color:var(--ok)}',
    '.utwi .pill.warn{background:var(--warnSoft);color:var(--warn)}',
    '.utwi .pill.gris{background:#eef1f5;color:#5b6472}',
    '.utwi .pill.crim{background:var(--crimSoft);color:var(--crim)}',
    /* tablas y listas */
    '.utwi .tabla{width:100%;border-collapse:collapse;font-size:13.5px}',
    '.utwi .tabla th{padding:9px 8px;border-bottom:1px solid var(--linea);color:var(--tx2);font-size:11.5px;font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.4px}',
    '.utwi .tabla td{padding:10px 8px;border-bottom:1px solid #f0f2f5;vertical-align:middle}',
    '.utwi .tabla tr:hover td{background:#fafbfc}',
    '.utwi .tabla tr.on td{background:var(--crimSoft)}',
    '.utwi .tabla input[type=checkbox]{width:16px;height:16px;accent-color:var(--crim)}',
    '.utwi .scroll{max-height:460px;overflow:auto;border:1px solid var(--linea);border-radius:12px;background:var(--panel)}',
    '.utwi .dim{color:var(--tx2);font-size:12.5px}',
    '.utwi .mini{color:var(--tx3);font-size:11.5px}',
    /* mensajes */
    '.utwi .msj{margin:0 0 12px;padding:10px 13px;border-radius:10px;background:var(--okSoft);color:var(--ok);font-size:13px}',
    '.utwi .msj.err{background:#fdeef1;color:#a1102f}',
    '.utwi .msj:empty{display:none}',
    /* previa */
    '.utwi .previa{width:100%;height:600px;border:1px solid var(--linea);border-radius:12px;background:#f4efec}',
    '.utwi .previa.movil{width:390px;max-width:100%;margin:0 auto;display:block}',
    '.utwi .ayuda{margin:8px 0 0;color:var(--tx2);font-size:12px;line-height:1.8}',
    '.utwi .ayuda code{padding:2px 6px;border:1px solid var(--linea);border-radius:5px;background:#fff;font-size:11.5px;color:#374151}',
    '.utwi .barra{display:flex;flex-wrap:wrap;gap:5px;margin:0 0 6px}',
    '.utwi .barra button{padding:5px 10px;border:1px solid var(--linea);border-radius:7px;background:#fff;color:var(--tx2);cursor:pointer;font:inherit;font-size:12px}',
    '.utwi .barra button:hover{background:#f2f4f7;color:var(--tx)}',
    /* ficha lateral */
    '.utwi .velo{position:fixed;inset:0;z-index:99998;background:rgba(17,24,39,.35)}',
    '.utwi .ficha{position:fixed;top:0;right:0;bottom:0;z-index:99999;width:min(430px,100%);padding:20px;overflow:auto;background:#fff;box-shadow:-10px 0 40px rgba(0,0,0,.18)}',
    '.utwi .dato{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #f0f2f5;font-size:13.5px}',
    '.utwi .dato span{color:var(--tx2)}',
    '@media(max-width:1000px){.utwi .cuerpo{grid-template-columns:1fr}.utwi .lado{display:flex;gap:6px;overflow:auto;border-right:0;border-bottom:1px solid var(--linea)}.utwi .nav{width:auto;margin:0;white-space:nowrap}.utwi .nav .n{margin-left:6px}.utwi .g4,.utwi .g3,.utwi .g2{grid-template-columns:1fr 1fr}}',
    '@media(max-width:620px){.utwi .g4,.utwi .g3,.utwi .g2{grid-template-columns:1fr}.utwi .previa{height:460px}}',
  ].join('\n');

  // ==========================================================================
  // 3) Arranque
  // ==========================================================================

  var host = document.getElementById('utw-intranet');
  if (!host) {
    host = document.createElement('div');
    host.id = 'utw-intranet';
    (AQUI && AQUI.parentNode ? AQUI.parentNode : document.body).appendChild(host);
  }
  var estilo = document.createElement('style');
  estilo.textContent = CSS;
  document.head.appendChild(estilo);
  host.innerHTML = '<div class="utwi"><div class="panel"><p class="dim">Cargando la intranet…</p></div></div>';

  var cdn = document.createElement('script');
  cdn.src = CDN;
  cdn.onerror = function () {
    host.innerHTML = '<div class="utwi"><div class="panel"><p class="msj err">No se pudo cargar la librería de la base de datos. Recarga la página.</p></div></div>';
  };
  cdn.onload = function () {
    sb = window.supabase.createClient(SB_URL, SB_ANON, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.getSession().then(function (r) { entrar(r.data.session); });
    sb.auth.onAuthStateChange(function (_e, ses) { entrar(ses); });
  };
  document.head.appendChild(cdn);

  function entrar(sesion) {
    S.sesion = sesion; S.listo = true;
    if (!sesion) { S.admin = false; pintar(); return; }
    sb.from('profiles').select('admin').eq('id', sesion.user.id).maybeSingle().then(function (r) {
      S.admin = !!(r.data && r.data.admin);
      pintar();
      if (S.admin) { cargarContactos(); cargarPlantillas(); cargarSegmentos(); cargarCampanas(); cargarMetricas(); cargarCola(); cargarEtiquetas(); }
    });
  }

  function aviso(t, tipo) { S.msj = t; S.err = tipo === 'err'; pintar(); }

  // ==========================================================================
  // 4) Datos
  // ==========================================================================

  var COLS = 'id,nombre,email,celular,origen,etiquetas,notas,n_pedidos,total_gastado,ultima_compra,baja,creado';

  // Una sola función arma la consulta: la usan la lista, los segmentos y el envío.
  function consulta(f) {
    var sel = sb.from('contactos').select(COLS).order('actualizado', { ascending: false }).limit(1000);
    if (f.q && f.q.trim()) sel = sel.or('nombre.ilike.%' + f.q.trim() + '%,email.ilike.%' + f.q.trim() + '%,celular.ilike.%' + f.q.trim() + '%');
    if (f.origen) sel = sel.contains('origen', [f.origen]);
    if (f.etiqueta) sel = sel.contains('etiquetas', [f.etiqueta]);
    if (f.compras === 'con') sel = sel.gt('n_pedidos', 0);
    if (f.compras === 'sin') sel = sel.eq('n_pedidos', 0);
    if (f.compras === 'dormidos') {
      var hace90 = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      sel = sel.gt('n_pedidos', 0).lt('ultima_compra', hace90);
    }
    if (f.activos !== false) sel = sel.eq('baja', false);
    return sel;
  }

  function filtroActual() { return { q: S.q, origen: S.origen, etiqueta: S.etiqueta, compras: S.compras }; }

  function cargarContactos() {
    return consulta(filtroActual()).then(function (r) {
      if (r.error) return aviso('No pudimos leer los contactos: ' + r.error.message, 'err');
      S.contactos = r.data || []; pintar();
    });
  }

  function cargarMetricas() {
    var hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    return Promise.all([
      sb.from('contactos').select('id', { count: 'exact', head: true }),
      sb.from('contactos').select('id', { count: 'exact', head: true }).not('email', 'is', null).eq('baja', false),
      sb.from('contactos').select('id', { count: 'exact', head: true }).not('celular', 'is', null).eq('baja', false),
      sb.from('contactos').select('id', { count: 'exact', head: true }).eq('baja', true),
      sb.from('correos_enviados').select('id', { count: 'exact', head: true }).gte('creado', hace30).eq('estado', 'enviado'),
      sb.from('contactos').select('id', { count: 'exact', head: true }).gt('n_pedidos', 0),
    ]).then(function (rs) {
      S.metricas = {
        total: rs[0].count || 0, conCorreo: rs[1].count || 0, conCelular: rs[2].count || 0,
        bajas: rs[3].count || 0, correos30: rs[4].count || 0, compradores: rs[5].count || 0,
      };
      pintar();
    });
  }

  function cargarPlantillas() {
    return sb.from('plantillas').select('*').eq('archivada', false).order('nombre').then(function (r) {
      S.plantillas = r.error ? [] : (r.data || []); pintar();
    });
  }

  function cargarSegmentos() {
    return sb.from('segmentos').select('*').order('nombre').then(function (r) {
      S.segmentos = r.error ? [] : (r.data || []); pintar();
    });
  }

  function cargarCampanas() {
    return sb.from('campanas').select('*').order('actualizado', { ascending: false }).limit(60).then(function (r) {
      S.campanas = r.error ? [] : (r.data || []); pintar();
    });
  }

  function cargarHistorial() {
    return sb.from('crm_mensajes').select('*').order('creado', { ascending: false }).limit(150).then(function (r) {
      S.historial = r.error ? [] : (r.data || []); pintar();
    });
  }

  function cargarCola() {
    return sb.from('whatsapp_outbox').select('estado').order('id', { ascending: false }).limit(200).then(function (r) {
      var f = r.data || [], n = function (e) { return f.filter(function (x) { return x.estado === e; }).length; };
      S.cola = { pendientes: n('pendiente'), encolados: n('encolado'), enviados: n('enviado'), fallidos: n('fallido') + n('rechazado') };
      pintar();
    });
  }

  function cargarEtiquetas() {
    return sb.rpc('crm_etiquetas').then(function (r) {
      S.etiquetas = r.error ? [] : (r.data || []);
      pintar();
    });
  }

  function colorDe(nombre) {
    var e = S.etiquetas.filter(function (x) { return x.nombre === nombre; })[0];
    return (e && e.color) || 'gris';
  }

  function tag(nombre, extra) {
    return '<span class="tag ' + colorDe(nombre) + '">' + esc(nombre) + (extra || '') + '</span>';
  }

  // Etiquetar o desetiquetar todo lo seleccionado de una vez.
  function etiquetarSeleccion(etiqueta, quitar) {
    var ids = Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number);
    if (!ids.length || !etiqueta) return;
    sb.rpc('crm_etiquetar', { p_ids: ids, p_etiqueta: etiqueta, p_quitar: !!quitar }).then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      aviso((quitar ? 'Quitamos' : 'Pusimos') + ' "' + etiqueta + '" en ' + r.data + ' contacto(s).');
      cargarContactos(); cargarEtiquetas();
    });
  }

  function renombrarEtiqueta(vieja) {
    var nueva = window.prompt('Nuevo nombre para "' + vieja + '" (cambia en todos los contactos)', vieja);
    if (!nueva || !nueva.trim() || nueva.trim() === vieja) return;
    sb.rpc('crm_renombrar_etiqueta', { p_vieja: vieja, p_nueva: nueva.trim() }).then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      aviso('Renombrada en ' + r.data + ' contacto(s).');
      if (S.etiqueta === vieja) S.etiqueta = nueva.trim();
      cargarContactos(); cargarEtiquetas();
    });
  }

  function borrarEtiqueta(nombre, cuantos) {
    if (!window.confirm('¿Eliminar la etiqueta "' + nombre + '"?\n\nSe la quitamos a ' + cuantos + ' contacto(s). Los contactos NO se borran.')) return;
    sb.rpc('crm_borrar_etiqueta', { p_nombre: nombre }).then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      aviso('Etiqueta eliminada de ' + r.data + ' contacto(s).');
      if (S.etiqueta === nombre) S.etiqueta = '';
      cargarContactos(); cargarEtiquetas();
    });
  }

  function colorEtiqueta(nombre, color) {
    sb.rpc('crm_color_etiqueta', { p_nombre: nombre, p_color: color }).then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      cargarEtiquetas();
    });
  }

  function crearEtiqueta(nombre, color) {
    return sb.from('etiquetas').insert({ nombre: nombre, color: color || 'gris' }).then(function (r) {
      if (r.error) return aviso(/duplicate|unique/i.test(r.error.message) ? 'Esa etiqueta ya existe.' : r.error.message, 'err');
      aviso('Etiqueta "' + nombre + '" creada. Ya puedes ponérsela a los contactos.');
      cargarEtiquetas();
    });
  }

  // ==========================================================================
  // 5) Acciones
  // ==========================================================================

  function sincronizar() {
    S.ocupado = true; aviso('Sincronizando con la tienda…');
    sb.functions.invoke('intranet', { body: { accion: 'crm-sync' } }).then(function (r) {
      S.ocupado = false;
      var d = r.data || {};
      if (r.error || !d.ok) return aviso(d.error || (r.error && r.error.message) || 'No se pudo sincronizar.', 'err');
      aviso('Listo: ' + d.jumpseller + ' de la tienda, ' + d.socios + ' socios, ' + (d.con_compras || 0) + ' con compras al día.');
      cargarContactos(); cargarMetricas();
    });
  }

  function guardarContacto(campos, id) {
    var p = id
      ? sb.from('contactos').update(Object.assign({ actualizado: new Date().toISOString() }, campos)).eq('id', id)
      : sb.rpc('crm_guardar_contacto', { p_nombre: campos.nombre || '', p_email: campos.email || null, p_celular: campos.celular || null, p_origen: 'manual' });
    return p.then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      if (!id && !r.data) return aviso('Falta un correo o un celular válido.', 'err');
      aviso('Contacto guardado.');
      cargarContactos();
      if (S.ficha && id === S.ficha.id) abrirFicha(id);
    });
  }

  function importarCSV(filas, mapa) {
    var i = 0, ok = 0, fallos = 0;
    S.ocupado = true;
    function siguiente() {
      if (i >= filas.length) {
        S.ocupado = false; S.importar = null; S.progreso = '';
        aviso('Importados ' + ok + ' contactos' + (fallos ? ' · ' + fallos + ' sin correo ni celular válido' : '') + '.');
        cargarContactos(); cargarMetricas();
        return;
      }
      var f = filas[i++];
      S.progreso = i + '/' + filas.length; pintar();
      var etiquetas = mapa.etiquetas >= 0 ? String(f[mapa.etiquetas] || '').split(/[;,|]/).map(function (t) { return t.trim(); }).filter(Boolean) : [];
      sb.rpc('crm_guardar_contacto', {
        p_nombre: mapa.nombre >= 0 ? f[mapa.nombre] : '',
        p_email: mapa.email >= 0 ? (f[mapa.email] || null) : null,
        p_celular: mapa.celular >= 0 ? (f[mapa.celular] || null) : null,
        p_origen: 'manual',
      }).then(function (r) {
        if (r.error || !r.data) { fallos++; return siguiente(); }
        ok++;
        if (etiquetas.length) {
          sb.from('contactos').select('etiquetas').eq('id', r.data).maybeSingle().then(function (q) {
            var ya = (q.data && q.data.etiquetas) || [];
            var todas = ya.concat(etiquetas.filter(function (e) { return ya.indexOf(e) === -1; }));
            sb.from('contactos').update({ etiquetas: todas }).eq('id', r.data).then(siguiente);
          });
        } else siguiente();
      });
    }
    siguiente();
  }

  function exportarCSV() {
    var csv = csvSalida(S.contactos);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'contactos-uptowine-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    aviso(S.contactos.length + ' contactos exportados a CSV.');
  }

  function guardarSegmento(nombre) {
    return sb.from('segmentos').insert({ nombre: nombre, filtro: filtroActual() }).then(function (r) {
      if (r.error) return aviso(/duplicate|unique/i.test(r.error.message) ? 'Ya existe un segmento con ese nombre.' : r.error.message, 'err');
      aviso('Segmento "' + nombre + '" guardado.');
      cargarSegmentos();
    });
  }

  function aplicarSegmento(id) {
    var s = S.segmentos.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!s) return;
    var f = s.filtro || {};
    S.q = f.q || ''; S.origen = f.origen || ''; S.etiqueta = f.etiqueta || ''; S.compras = f.compras || '';
    cargarContactos();
  }

  function abrirFicha(id) {
    Promise.all([
      sb.from('contactos').select(COLS).eq('id', id).maybeSingle(),
      sb.from('crm_mensajes').select('*').eq('contacto_id', id).order('creado', { ascending: false }).limit(20),
    ]).then(function (rs) {
      if (!rs[0].data) return aviso('No encontramos ese contacto.', 'err');
      S.ficha = rs[0].data;
      S.ficha.mensajes = rs[1].data || [];
      pintar();
    });
  }

  // ---- campañas ----
  function nuevaCampana(base) {
    S.campana = Object.assign({}, VACIA, base || {});
    S.adjuntos = []; S.confirmar = false; S.vista = 'campana'; pintar();
  }

  function guardarCampana(silencioso) {
    var c = S.campana;
    if (!c) return Promise.resolve();
    var fila = {
      nombre: c.nombre || 'Sin nombre', canal: c.canal, asunto: c.asunto || null, cuerpo: c.cuerpo || '',
      segmento_id: c.segmento_id || null, destinatarios: c.destinatarios || [],
      estado: c.estado || 'borrador', programada_para: c.programada_para || null,
      actualizado: new Date().toISOString(),
    };
    var p = c.id ? sb.from('campanas').update(fila).eq('id', c.id).select().maybeSingle()
                 : sb.from('campanas').insert(fila).select().maybeSingle();
    return p.then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      if (r.data) S.campana.id = r.data.id;
      if (!silencioso) aviso('Campaña guardada como borrador.');
      cargarCampanas();
    });
  }

  function destinatariosDeCampana() {
    var c = S.campana;
    if (c.segmento_id) {
      var s = S.segmentos.filter(function (x) { return String(x.id) === String(c.segmento_id); })[0];
      return consulta(Object.assign({ q: '', origen: '', etiqueta: '', compras: '' }, (s && s.filtro) || {}))
        .then(function (r) { return r.data || []; });
    }
    if (c.destinatarios && c.destinatarios.length) {
      return sb.from('contactos').select(COLS).in('id', c.destinatarios).eq('baja', false)
        .then(function (r) { return r.data || []; });
    }
    return Promise.resolve([]);
  }

  function alcanzables(lista) {
    return lista.filter(function (c) { return S.campana.canal === 'correo' ? c.email : fonoWhatsApp(c.celular); });
  }

  function enviarPrueba() {
    var yo = S.sesion.user.email;
    var quien = { nombre: 'Prueba', email: yo, comuna: 'Santiago' };
    aviso('Enviando la prueba a ' + yo + '…');
    sb.functions.invoke('intranet', { body: {
      accion: 'correo', para: yo, asunto: '[PRUEBA] ' + personalizar(S.campana.asunto || '(sin asunto)', quien),
      html: correoHtml(S.campana.cuerpo, quien), texto: correoTexto(S.campana.cuerpo, quien),
      adjuntos: S.adjuntos.map(function (a) { return { filename: a.nombre, content: a.base64 }; }),
    } }).then(function (r) {
      var d = r.data || {};
      if (r.error || !d.ok) return aviso('La prueba no salió: ' + (d.error || (r.error && r.error.message)), 'err');
      aviso('Prueba enviada a ' + yo + '. Revisa cómo se ve antes de mandarla a todos.');
    });
  }

  // Envío en lote: uno por uno, con el nombre de cada quien y un ritmo tranquilo.
  function enviarCampana() {
    S.confirmar = false; S.ocupado = true; pintar();
    destinatariosDeCampana().then(function (todos) {
      var lista = alcanzables(todos), i = 0, ok = 0, fallos = [];
      if (!lista.length) { S.ocupado = false; return aviso('No hay destinatarios alcanzables.', 'err'); }
      S.campana.estado = 'enviando';
      guardarCampana(true);

      function siguiente() {
        if (i >= lista.length) {
          S.ocupado = false; S.progreso = '';
          S.campana.estado = 'enviada';
          sb.from('campanas').update({ estado: 'enviada', enviados: ok, fallidos: fallos.length, enviada_at: new Date().toISOString() })
            .eq('id', S.campana.id).then(function () { cargarCampanas(); });
          aviso(S.campana.canal === 'correo'
            ? ok + ' correo(s) enviado(s).' + (fallos.length ? ' Fallaron ' + fallos.length + ': ' + fallos.slice(0, 3).join(' · ') : '')
            : ok + ' mensaje(s) en la cola — el bot los manda con su ritmo.' + (fallos.length ? ' Quedaron fuera ' + fallos.length : ''),
            fallos.length ? 'err' : 'ok');
          cargarCola(); cargarMetricas();
          return;
        }
        var c = lista[i++];
        S.progreso = i + '/' + lista.length; pintar();
        var p;
        if (S.campana.canal === 'correo') {
          p = sb.functions.invoke('intranet', { body: {
            accion: 'correo', para: c.email, asunto: personalizar(S.campana.asunto, c),
            html: correoHtml(S.campana.cuerpo, c), texto: correoTexto(S.campana.cuerpo, c),
            adjuntos: S.adjuntos.map(function (a) { return { filename: a.nombre, content: a.base64 }; }),
            contacto_id: c.id } })
            .then(function (r) { return (r.data && r.data.ok) ? null : ((r.data && r.data.error) || (r.error && r.error.message) || 'falló el envío'); });
        } else {
          // La tienda nunca habla con el VPS: deja la fila y el puente sale a buscarla.
          p = sb.from('whatsapp_outbox').insert({
            numero: fonoWhatsApp(c.celular), nombre: c.nombre || '?',
            texto: personalizar(S.campana.cuerpo, c), contacto_id: c.id, por: 'intranet',
          }).then(function (r) { return r.error ? r.error.message : null; });
        }
        p.then(function (error) {
          if (error) fallos.push((c.nombre || c.email || c.celular) + ': ' + error); else ok++;
          setTimeout(siguiente, S.campana.canal === 'correo' ? 600 : 0);  // Resend: 2 por segundo en el plan gratis
        });
      }
      siguiente();
    });
  }

  function guardarPlantillaDesdeCampana(nombre) {
    return sb.from('plantillas').insert({
      nombre: nombre, canal: S.campana.canal,
      asunto: S.campana.canal === 'correo' ? S.campana.asunto : null, cuerpo: S.campana.cuerpo,
    }).then(function (r) {
      if (r.error) return aviso(/duplicate|unique/i.test(r.error.message) ? 'Ya existe una plantilla con ese nombre.' : r.error.message, 'err');
      aviso('Guardada como plantilla.');
      cargarPlantillas();
    });
  }

  function sumarAdjuntos(files) {
    Array.prototype.forEach.call(files, function (f) {
      if (S.adjuntos.length >= MAX_ADJUNTOS) return aviso('Máximo ' + MAX_ADJUNTOS + ' adjuntos.', 'err');
      if (f.size > MAX_ADJUNTO) return aviso(f.name + ' pesa más de 8 MB.', 'err');
      var lector = new FileReader();
      lector.onload = function () {
        S.adjuntos.push({ nombre: f.name, bytes: f.size, base64: String(lector.result).split(',')[1] || '' });
        pintar();
      };
      lector.readAsDataURL(f);
    });
  }

  // ==========================================================================
  // 6) Vistas
  // ==========================================================================

  var MENU = [
    ['resumen', 'Resumen'], ['contactos', 'Contactos'], ['etiquetas', 'Etiquetas'],
    ['campanas', 'Campañas'], ['plantillas', 'Plantillas'], ['historial', 'Historial'],
  ];
  var COLORES = ['gris', 'vino', 'dorado', 'verde', 'azul', 'morado', 'naranjo'];

  function pintar() {
    if (!S.listo) return;
    if (!S.sesion) return vistaLogin();
    if (!S.admin) {
      host.innerHTML = '<div class="utwi"><div class="panel"><h1>Solo administración</h1>' +
        '<p class="dim" style="margin:10px 0 16px">Esta sección es para el equipo de Up to Wine.</p>' +
        '<button class="btn sec" id="utwi-salir">Salir</button></div></div>';
      document.getElementById('utwi-salir').onclick = function () { sb.auth.signOut(); };
      return;
    }

    var nav = MENU.map(function (m) {
      var n = m[0] === 'contactos' ? (S.metricas ? S.metricas.total : S.contactos.length)
        : m[0] === 'campanas' ? S.campanas.length
        : m[0] === 'etiquetas' ? S.etiquetas.length
        : m[0] === 'plantillas' ? S.plantillas.length : '';
      return '<button class="nav' + (S.vista === m[0] || (S.vista === 'campana' && m[0] === 'campanas') ? ' on' : '') + '" data-vista="' + m[0] + '">' +
        m[1] + (n !== '' ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('');

    var contenido = S.vista === 'resumen' ? vistaResumen()
      : S.vista === 'etiquetas' ? vistaEtiquetas()
      : S.vista === 'contactos' ? vistaContactos()
      : S.vista === 'campanas' ? vistaCampanas()
      : S.vista === 'campana' ? vistaEditor()
      : S.vista === 'plantillas' ? vistaPlantillas()
      : vistaHistorial();

    host.innerHTML = '<div class="utwi">' +
      '<div class="top"><div class="marca"><span class="punto"></span> Intranet Up to Wine</div>' +
      '<div class="sp"><span>' + esc(S.sesion.user.email) + '</span>' +
      '<button class="btn sec mini" id="utwi-salir">Salir</button></div></div>' +
      '<div class="cuerpo"><div class="lado">' + nav + '</div>' +
      '<div class="panel"><p class="msj ' + (S.err ? 'err' : '') + '">' + esc(S.msj) + '</p>' + contenido + '</div></div>' +
      (S.ficha ? fichaContacto() : '') +
      '</div>';
    conectar();
    if (S.vista === 'campana') refrescarPrevia();
  }

  function vistaLogin() {
    host.innerHTML = '<div class="utwi"><div class="panel" style="max-width:420px;margin:26px auto">' +
      '<h1>Intranet Up to Wine</h1><p class="dim" style="margin:6px 0 4px">Uso interno del equipo.</p>' +
      '<form class="card" id="utwi-login" style="margin-top:14px">' +
      '<label class="lbl" for="utwi-email">Correo</label><input id="utwi-email" type="email" autocomplete="username" inputmode="email" required>' +
      '<label class="lbl" for="utwi-clave">Contraseña</label><input id="utwi-clave" type="password" autocomplete="current-password" required>' +
      '<div style="margin-top:16px"><button class="btn" type="submit" id="utwi-entrar">Entrar</button></div>' +
      '<p class="msj" id="utwi-login-msj" style="margin-top:12px"></p></form></div></div>';
    var email = document.getElementById('utwi-email'), clave = document.getElementById('utwi-clave');
    var boton = document.getElementById('utwi-entrar'), salida = document.getElementById('utwi-login-msj');
    document.getElementById('utwi-login').onsubmit = function (ev) {
      ev.preventDefault();
      boton.disabled = true; salida.className = 'msj'; salida.textContent = 'Entrando…';
      sb.auth.signInWithPassword({ email: email.value.trim(), password: clave.value }).then(function (r) {
        boton.disabled = false;
        if (r.error) { salida.className = 'msj err'; salida.textContent = 'No pudimos entrar: revisa el correo y la contraseña.'; }
      }, function () {
        boton.disabled = false;
        salida.className = 'msj err'; salida.textContent = 'Sin conexión con el servidor. Reintenta.';
      });
    };
  }

  // ---------- Resumen ----------
  function vistaResumen() {
    var m = S.metricas || { total: 0, conCorreo: 0, conCelular: 0, bajas: 0, correos30: 0, compradores: 0 };
    var ultimas = S.campanas.slice(0, 5).map(function (c) {
      return '<tr><td><b>' + esc(c.nombre) + '</b><div class="mini">' + (c.canal === 'correo' ? 'Correo' : 'WhatsApp') + ' · ' + fecha(c.actualizado) + '</div></td>' +
        '<td>' + pillEstado(c.estado) + '</td><td class="dim">' + (c.enviados || 0) + ' enviados</td>' +
        '<td style="text-align:right"><button class="btn sec mini" data-campana="' + c.id + '">Abrir</button></td></tr>';
    }).join('') || '<tr><td class="dim">Todavía no has creado campañas.</td></tr>';

    return '<div class="cab"><h1>Resumen</h1><div class="sp">' +
      '<button class="btn sec" id="utwi-sync"' + (S.ocupado ? ' disabled' : '') + '>Sincronizar tienda</button>' +
      '<button class="btn" data-nueva="1">Nueva campaña</button></div></div>' +
      '<div class="grid g4">' +
      kpi(m.total, 'contactos en total') +
      kpi(m.conCorreo, 'con correo (alcanzables)') +
      kpi(m.conCelular, 'con celular') +
      kpi(m.correos30, 'correos enviados en 30 días') +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px">' +
      '<div class="card"><h3>Últimas campañas</h3><table class="tabla" style="margin-top:8px">' + ultimas + '</table></div>' +
      '<div class="card"><h3>Estado del canal</h3>' +
      '<div class="dato"><span>Compradores registrados</span><b>' + m.compradores + '</b></div>' +
      '<div class="dato"><span>Dados de baja</span><b>' + m.bajas + '</b></div>' +
      (S.cola ? '<div class="dato"><span>WhatsApp por salir</span><b>' + S.cola.pendientes + '</b></div>' +
        '<div class="dato"><span>WhatsApp enviados</span><b>' + S.cola.enviados + '</b></div>' : '') +
      '<p class="ayuda">El correo sale por Resend y el WhatsApp por el bot del servidor. Mientras no estén conectados, los correos fallan y los WhatsApp quedan en la cola.</p>' +
      '</div></div>';
  }

  function kpi(n, txt) { return '<div class="card kpi"><b>' + n + '</b><span>' + txt + '</span></div>'; }

  function pillEstado(e) {
    var clase = e === 'enviada' ? 'ok' : e === 'enviando' ? 'crim' : e === 'programada' ? 'warn' : 'gris';
    return '<span class="pill ' + clase + '">' + e + '</span>';
  }

  // ---------- Contactos ----------
  function vistaContactos() {
    var sel = Object.keys(S.sel).filter(function (k) { return S.sel[k]; });
    var chips = function (campo, opciones) {
      return opciones.map(function (o) {
        return '<button class="chip' + (S[campo] === o[0] ? ' on' : '') + '" data-filtro="' + campo + '" data-valor="' + o[0] + '">' + o[1] + '</button>';
      }).join('');
    };

    var filas = S.contactos.map(function (c) {
      var dias = diasDesde(c.ultima_compra);
      return '<tr class="' + (S.sel[c.id] ? 'on' : '') + '" data-id="' + c.id + '">' +
        '<td><input type="checkbox"' + (S.sel[c.id] ? ' checked' : '') + ' data-marca="' + c.id + '" aria-label="Seleccionar"></td>' +
        '<td><b>' + esc(c.nombre || '(sin nombre)') + '</b>' +
        (c.baja ? ' <span class="pill warn">baja</span>' : '') +
        '<div class="mini">' + esc([c.email, c.celular].filter(Boolean).join(' · ') || 'sin correo ni celular') + '</div></td>' +
        '<td class="dim">' + (c.origen || []).join(', ') + '</td>' +
        '<td>' + ((c.etiquetas || []).map(function (e) { return tag(e); }).join('') || '<span class="mini">—</span>') + '</td>' +
        '<td class="dim">' + (c.n_pedidos ? c.n_pedidos + ' · ' + plata(c.total_gastado) : '—') + '</td>' +
        '<td class="dim">' + (dias == null ? '—' : dias + ' días') + '</td>' +
        '<td style="text-align:right"><button class="btn sec mini" data-ficha="' + c.id + '">Ver</button></td></tr>';
    }).join('') || '<tr><td colspan="7" class="dim" style="padding:18px">Sin contactos con estos filtros.</td></tr>';

    var opcionesEtiqueta = S.etiquetas.map(function (e) {
      return '<option value="' + esc(e.nombre) + '">' + esc(e.nombre) + ' (' + e.n + ')</option>';
    }).join('');

    return '<div class="cab"><h1>Contactos</h1><div class="sp">' +
      '<button class="btn sec" id="utwi-importar">Importar CSV</button>' +
      '<button class="btn sec" id="utwi-exportar">Exportar</button>' +
      '<button class="btn sec" id="utwi-sync"' + (S.ocupado ? ' disabled' : '') + '>Sincronizar tienda</button>' +
      '<button class="btn" id="utwi-campana-sel"' + (sel.length ? '' : ' disabled') + '>Escribir a ' + sel.length + '</button>' +
      '</div></div>' +

      (S.importar ? panelImportar() : '') +

      /* acciones sobre lo seleccionado: etiquetar es lo que más se usa */
      (sel.length ? '<div class="acciones"><b>' + sel.length + ' seleccionados</b>' +
        '<select id="utwi-poner-etiqueta"><option value="">Poner etiqueta…</option>' + opcionesEtiqueta +
        '<option value="__nueva__">+ Etiqueta nueva…</option></select>' +
        '<select id="utwi-quitar-etiqueta"><option value="">Quitar etiqueta…</option>' + opcionesEtiqueta + '</select>' +
        '<button class="btn sec mini" id="utwi-limpiar-sel">Quitar selección</button></div>' : '') +

      '<div class="card" style="margin-bottom:12px">' +
      '<div class="grid g2"><input id="utwi-buscar" placeholder="Buscar por nombre, correo o celular" value="' + esc(S.q) + '">' +
      '<div style="display:flex;gap:8px">' +
      '<select id="utwi-segmento" style="flex:1"><option value="">Segmentos guardados…</option>' +
      S.segmentos.map(function (s) { return '<option value="' + s.id + '">' + esc(s.nombre) + '</option>'; }).join('') + '</select>' +
      '<button class="btn sec" id="utwi-guardar-segmento">Guardar filtro</button></div></div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">' +
      chips('origen', [['', 'Todos'], ['app', 'Socios'], ['jumpseller', 'Tienda'], ['manual', 'A mano']]) +
      '<span style="width:12px"></span>' +
      chips('compras', [['', 'Compren o no'], ['con', 'Con compras'], ['sin', 'Sin compras'], ['dormidos', 'Dormidos 90 días']]) +
      '<select id="utwi-filtro-etiqueta" style="width:auto;min-width:170px;margin-left:8px">' +
      '<option value="">Toda etiqueta</option>' +
      S.etiquetas.map(function (e) {
        return '<option value="' + esc(e.nombre) + '"' + (S.etiqueta === e.nombre ? ' selected' : '') + '>' + esc(e.nombre) + ' (' + e.n + ')</option>';
      }).join('') + '</select>' +
      '</div></div>' +

      '<div class="scroll"><table class="tabla">' +
      '<thead><tr><th><input type="checkbox" id="utwi-todos" aria-label="Marcar todos"></th><th>Contacto</th><th>Origen</th><th>Etiquetas</th><th>Compras</th><th>Última</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<p class="ayuda">' + S.contactos.length + ' contactos con estos filtros' + (sel.length ? ' · ' + sel.length + ' seleccionados' : '') + '. Guarda el filtro como segmento para reusarlo en una campaña.</p>';
  }

  function panelImportar() {
    var imp = S.importar;
    var cab = imp.cabeceras.map(function (h, i) {
      var papel = imp.mapa.nombre === i ? 'nombre' : imp.mapa.email === i ? 'correo' : imp.mapa.celular === i ? 'celular' : imp.mapa.etiquetas === i ? 'etiquetas' : '';
      return '<th>' + esc(h) + (papel ? '<div class="pill crim" style="margin-top:3px">' + papel + '</div>' : '') + '</th>';
    }).join('');
    var muestra = imp.filas.slice(0, 3).map(function (f) {
      return '<tr>' + f.map(function (v) { return '<td class="dim">' + esc(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="card" style="margin-bottom:12px;border-color:var(--crim)">' +
      '<div class="cab" style="margin-bottom:8px"><h3>Importar ' + imp.filas.length + ' filas</h3><div class="sp">' +
      '<button class="btn sec mini" id="utwi-cancelar-import">Cancelar</button>' +
      '<button class="btn mini" id="utwi-confirmar-import"' + (S.ocupado ? ' disabled' : '') + '>' +
      (S.ocupado ? 'Importando ' + S.progreso : 'Importar') + '</button></div></div>' +
      '<div class="scroll" style="max-height:180px"><table class="tabla"><thead><tr>' + cab + '</tr></thead><tbody>' + muestra + '</tbody></table></div>' +
      '<p class="ayuda">Reconocemos las columnas por su nombre. Las filas sin correo ni celular válido se saltan; los repetidos se fusionan con el contacto que ya existe.</p></div>';
  }

  function fichaContacto() {
    var c = S.ficha;
    var mensajes = (c.mensajes || []).map(function (m) {
      return '<div class="dato"><span>' + (m.canal === 'correo' ? '✉️ ' : '💬 ') + esc((m.titulo || '').slice(0, 42)) + '</span><b class="mini">' + fecha(m.creado) + ' · ' + esc(m.estado) + '</b></div>';
    }).join('') || '<p class="mini">Todavía no le hemos escrito.</p>';

    return '<div class="velo" id="utwi-velo"></div><div class="ficha">' +
      '<div class="cab"><h1>' + esc(c.nombre || '(sin nombre)') + '</h1><div class="sp">' +
      '<button class="btn sec mini" id="utwi-cerrar-ficha">Cerrar</button></div></div>' +
      '<label class="lbl">Nombre</label><input id="utwi-f-nombre" value="' + esc(c.nombre) + '">' +
      '<label class="lbl">Correo</label><input id="utwi-f-email" value="' + esc(c.email || '') + '" inputmode="email">' +
      '<label class="lbl">Celular</label><input id="utwi-f-celular" value="' + esc(c.celular || '') + '" inputmode="tel">' +
      '<label class="lbl">Etiquetas</label><div>' +
      ((c.etiquetas || []).map(function (e) { return tag(e, '<button data-quita-etiqueta="' + esc(e) + '" aria-label="Quitar">×</button>'); }).join('') || '<span class="mini">Sin etiquetas</span>') +
      '</div><div style="display:flex;gap:8px;margin-top:8px"><input id="utwi-f-etiqueta" list="utwi-lista-etiquetas" placeholder="club, mayorista, vip…" style="flex:1">' +
      '<datalist id="utwi-lista-etiquetas">' + S.etiquetas.map(function (e) { return '<option value="' + esc(e.nombre) + '">'; }).join('') + '</datalist>' +
      '<button class="btn sec mini" id="utwi-add-etiqueta">Agregar</button></div>' +
      '<label class="lbl">Notas internas</label><textarea id="utwi-f-notas" style="min-height:90px">' + esc(c.notas || '') + '</textarea>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn" id="utwi-f-guardar">Guardar</button>' +
      '<button class="btn sec" id="utwi-f-baja">' + (c.baja ? 'Reactivar' : 'Dar de baja') + '</button>' +
      '<button class="btn sec" id="utwi-f-escribir">Escribirle</button></div>' +
      '<h3 style="margin-top:20px">Compras</h3>' +
      '<div class="dato"><span>Pedidos</span><b>' + (c.n_pedidos || 0) + '</b></div>' +
      '<div class="dato"><span>Total gastado</span><b>' + (plata(c.total_gastado) || '$0') + '</b></div>' +
      '<div class="dato"><span>Última compra</span><b>' + (fecha(c.ultima_compra) || '—') + '</b></div>' +
      '<div class="dato"><span>Origen</span><b>' + (c.origen || []).join(', ') + '</b></div>' +
      '<h3 style="margin-top:20px">Mensajes</h3>' + mensajes +
      '</div>';
  }

  // ---------- Etiquetas ----------
  function vistaEtiquetas() {
    var filas = S.etiquetas.map(function (e) {
      var opciones = COLORES.map(function (c) {
        return '<option value="' + c + '"' + (e.color === c ? ' selected' : '') + '>' + c + '</option>';
      }).join('');
      return '<tr><td>' + tag(e.nombre) + '</td>' +
        '<td><select data-color="' + esc(e.nombre) + '" style="width:auto">' + opciones + '</select></td>' +
        '<td><b>' + e.n + '</b> <span class="dim">contacto(s)</span></td>' +
        '<td style="text-align:right">' +
        '<button class="btn sec mini" data-ver-etiqueta="' + esc(e.nombre) + '">Ver contactos</button> ' +
        '<button class="btn sec mini" data-escribir-etiqueta="' + esc(e.nombre) + '"' + (e.n ? '' : ' disabled') + '>Escribirles</button> ' +
        '<button class="btn sec mini" data-renombrar="' + esc(e.nombre) + '">Renombrar</button> ' +
        '<button class="btn sec mini" data-borrar-etiqueta="' + esc(e.nombre) + '" data-n="' + e.n + '">Eliminar</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="dim" style="padding:18px">Sin etiquetas todavía. Crea la primera aquí abajo.</td></tr>';

    var sinUsar = S.etiquetas.filter(function (e) { return !e.n; }).length;

    return '<div class="cab"><h1>Etiquetas</h1><div class="sp">' +
      '<button class="btn sec" data-vista="contactos">Ir a contactos</button></div></div>' +
      '<div class="scroll"><table class="tabla">' +
      '<thead><tr><th>Etiqueta</th><th>Color</th><th>Uso</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<p class="ayuda">Renombrar cambia la etiqueta en todos los contactos de una vez. Eliminar se la quita a todos, pero no borra ningún contacto.' +
      (sinUsar ? ' Hay ' + sinUsar + ' etiqueta(s) sin usar.' : '') + '</p>' +

      '<div class="card" style="margin-top:14px;max-width:520px"><h3>Nueva etiqueta</h3>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<input id="utwi-nueva-etiqueta" placeholder="club, mayorista, horeca, vip…" style="flex:1">' +
      '<select id="utwi-nuevo-color" style="width:auto">' + COLORES.map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('') + '</select>' +
      '<button class="btn" id="utwi-crear-etiqueta">Crear</button></div>' +
      '<p class="ayuda">También puedes crear etiquetas sobre la marcha: selecciona contactos y usa "Poner etiqueta → + Etiqueta nueva".</p></div>';
  }

  // ---------- Campañas ----------
  function vistaCampanas() {
    var filas = S.campanas.map(function (c) {
      return '<tr><td><b>' + esc(c.nombre) + '</b><div class="mini">' + esc(c.asunto || (c.canal === 'whatsapp' ? 'WhatsApp' : 'sin asunto')) + '</div></td>' +
        '<td>' + (c.canal === 'correo' ? '✉️ Correo' : '💬 WhatsApp') + '</td>' +
        '<td>' + pillEstado(c.estado) + '</td>' +
        '<td class="dim">' + (c.estado === 'enviada' ? c.enviados + ' enviados' + (c.fallidos ? ' · ' + c.fallidos + ' fallidos' : '') : '—') + '</td>' +
        '<td class="dim">' + fecha(c.actualizado) + '</td>' +
        '<td style="text-align:right"><button class="btn sec mini" data-campana="' + c.id + '">Abrir</button> ' +
        '<button class="btn sec mini" data-duplicar="' + c.id + '">Duplicar</button></td></tr>';
    }).join('') || '<tr><td colspan="6" class="dim" style="padding:18px">Todavía no hay campañas. Crea la primera desde una plantilla.</td></tr>';

    return '<div class="cab"><h1>Campañas</h1><div class="sp"><button class="btn" data-nueva="1">Nueva campaña</button></div></div>' +
      '<div class="scroll"><table class="tabla"><thead><tr><th>Campaña</th><th>Canal</th><th>Estado</th><th>Resultado</th><th>Modificada</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<h3 style="margin:18px 0 10px">Empezar desde un diseño</h3>' +
      '<div class="grid g4">' + GALERIA.map(function (g, i) {
        return '<div class="card"><h3>' + esc(g.nombre) + '</h3><p class="mini" style="margin:6px 0 12px">' + esc(g.asunto) + '</p>' +
          '<button class="btn sec mini" data-galeria="' + i + '">Usar este</button></div>';
      }).join('') + '</div>';
  }

  function vistaEditor() {
    var c = S.campana, esCorreo = c.canal === 'correo';
    var opcionesSeg = S.segmentos.map(function (s) {
      return '<option value="' + s.id + '"' + (String(c.segmento_id) === String(s.id) ? ' selected' : '') + '>' + esc(s.nombre) + '</option>';
    }).join('');
    var nSel = (c.destinatarios || []).length;

    var adjuntos = S.adjuntos.map(function (a, i) {
      return '<span class="tag">📎 ' + esc(a.nombre) + ' · ' + Math.round(a.bytes / 1024) + ' KB<button data-quita="' + i + '" aria-label="Quitar">×</button></span>';
    }).join('');

    return '<div class="cab"><h1>' + (c.id ? 'Editar campaña' : 'Nueva campaña') + '</h1><div class="sp">' +
      '<button class="btn sec" data-vista="campanas">Volver</button>' +
      '<button class="btn sec" id="utwi-guardar-campana">Guardar borrador</button>' +
      (esCorreo ? '<button class="btn sec" id="utwi-prueba">Enviar prueba a mí</button>' : '') +
      '<button class="btn' + (S.confirmar ? ' peligro' : '') + '" id="utwi-enviar"' +
        (S.ocupado || !c.cuerpo.trim() || (esCorreo && !(c.asunto || '').trim()) ? ' disabled' : '') + '>' +
      (S.ocupado ? 'Enviando ' + S.progreso : S.confirmar ? 'Confirmar envío' : esCorreo ? 'Enviar campaña' : 'Encolar WhatsApp') +
      '</button></div></div>' +

      '<div class="grid g2">' +
      /* --- columna de edición --- */
      '<div class="card">' +
      '<div class="grid g2"><div><label class="lbl" for="utwi-nombre">Nombre interno</label>' +
      '<input id="utwi-nombre" value="' + esc(c.nombre) + '" placeholder="Novedades septiembre"></div>' +
      '<div><label class="lbl">Canal</label><div style="display:flex;gap:6px">' +
      '<button class="chip' + (esCorreo ? ' on' : '') + '" data-canal="correo">Correo</button>' +
      '<button class="chip' + (!esCorreo ? ' on' : '') + '" data-canal="whatsapp">WhatsApp</button></div></div></div>' +

      '<label class="lbl" for="utwi-destinatarios">Destinatarios</label>' +
      '<select id="utwi-destinatarios"><option value="">— elegir —</option>' +
      (nSel ? '<option value="sel"' + (!c.segmento_id ? ' selected' : '') + '>Selección manual (' + nSel + ' contactos)</option>' : '') +
      opcionesSeg + '</select>' +
      '<p class="mini" style="margin-top:5px">Los segmentos se crean en Contactos, guardando un filtro.</p>' +

      (esCorreo ? '<label class="lbl" for="utwi-asunto">Asunto</label>' +
        '<input id="utwi-asunto" value="' + esc(c.asunto || '') + '" placeholder="Lo nuevo en Up to Wine, {nombre}">' : '') +

      '<label class="lbl" for="utwi-cuerpo">Mensaje</label>' +
      (esCorreo ? '<div class="barra">' +
        '<button data-marca="titulo">Título</button><button data-marca="negrita">Negrita</button>' +
        '<button data-marca="lista">Lista</button><button data-marca="enlace">Enlace</button>' +
        '<button data-marca="boton">Botón</button><button data-marca="imagen">Imagen</button>' +
        '<button data-marca="separador">Separador</button><button data-marca="nombre">{nombre}</button></div>' : '') +
      '<textarea id="utwi-cuerpo" placeholder="' + (esCorreo ? 'Escribe el correo…' : 'Mensaje corto, como lo escribirías tú por WhatsApp.') + '">' + esc(c.cuerpo) + '</textarea>' +
      '<p class="ayuda">Variables: <code>{nombre}</code> <code>{comuna}</code> <code>{email}</code> <code>{celular}</code>' +
      (esCorreo ? ' · Formato: <code>## Título</code> <code>**negrita**</code> <code>- lista</code> <code>[texto](url)</code> <code>[[Botón|url]]</code> <code>![foto](url)</code>' : ' · WhatsApp va sin formato.') + '</p>' +

      (esCorreo ? '<label class="lbl">Adjuntos (PDF o imagen, hasta ' + MAX_ADJUNTOS + ')</label>' +
        '<input type="file" id="utwi-archivo" accept="application/pdf,image/*" multiple>' +
        (adjuntos ? '<div style="margin-top:8px">' + adjuntos + '</div>' : '') : '') +

      '<div style="display:flex;gap:8px;margin-top:14px">' +
      '<button class="btn sec mini" id="utwi-guardar-plantilla">Guardar como plantilla</button>' +
      '<select id="utwi-usar-plantilla" style="flex:1"><option value="">Cargar una plantilla…</option>' +
      S.plantillas.filter(function (p) { return p.canal === c.canal; })
        .map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('') +
      '</select></div>' +
      (S.confirmar ? '<p class="msj err" style="margin-top:12px">Vas a enviar de verdad. Toca "Confirmar envío" otra vez para hacerlo, o cambia de pestaña para cancelar.</p>' : '') +
      '</div>' +

      /* --- columna de previa --- */
      '<div class="card"><div class="cab" style="margin-bottom:8px"><h3>Vista previa</h3><div class="sp">' +
      '<button class="chip' + (S.previa === 'escritorio' ? ' on' : '') + '" data-previa="escritorio">Escritorio</button>' +
      '<button class="chip' + (S.previa === 'movil' ? ' on' : '') + '" data-previa="movil">Móvil</button></div></div>' +
      '<iframe class="previa' + (S.previa === 'movil' ? ' movil' : '') + '" id="utwi-previa" title="Vista previa"></iframe>' +
      '<p class="ayuda" id="utwi-resumen-envio">Calculando destinatarios…</p>' +
      '</div></div>';
  }

  function refrescarPrevia() {
    var marco = document.getElementById('utwi-previa');
    if (!marco || !S.campana) return;
    var quien = { nombre: 'María Soledad Rojas', email: 'cliente@ejemplo.cl', celular: '56912345678', comuna: 'Providencia' };
    if (S.campana.canal === 'correo') {
      marco.srcdoc = correoHtml(S.campana.cuerpo || '_Escribe el mensaje y aquí lo verás tal cual le llega._', quien);
    } else {
      var texto = esc(personalizar(S.campana.cuerpo || 'Escribe el mensaje…', quien)).replace(/\n/g, '<br>');
      marco.srcdoc = '<!doctype html><html lang="es"><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;background:#0b141a;font-family:Helvetica,Arial,sans-serif;padding:18px">' +
        '<div style="max-width:420px;margin:0 auto"><div style="background:#005c4b;color:#fff;border-radius:12px 12px 4px 12px;padding:11px 13px;font-size:15px;line-height:1.5">' +
        texto + '<div style="text-align:right;font-size:10.5px;color:rgba(255,255,255,.65);margin-top:5px">' +
        new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + ' ✓✓</div></div>' +
        '<p style="color:rgba(255,255,255,.45);font-size:11.5px;margin-top:14px">' + (S.campana.cuerpo || '').length + ' caracteres</p></div></body></html>';
    }
    // cuántos van a recibirlo de verdad
    var resumen = document.getElementById('utwi-resumen-envio');
    if (!resumen) return;
    destinatariosDeCampana().then(function (todos) {
      var listos = alcanzables(todos);
      resumen.innerHTML = todos.length
        ? '<b>' + listos.length + '</b> de ' + todos.length + ' destinatarios lo recibirán' +
          (todos.length - listos.length ? ' · ' + (todos.length - listos.length) + ' sin ' + (S.campana.canal === 'correo' ? 'correo' : 'celular') : '') + '.'
        : 'Elige un segmento o selecciona contactos en la pestaña Contactos.';
    });
  }

  // ---------- Plantillas ----------
  function vistaPlantillas() {
    var filas = S.plantillas.map(function (p) {
      return '<tr><td><b>' + esc(p.nombre) + '</b><div class="mini">' + esc((p.cuerpo || '').slice(0, 70).replace(/\n/g, ' ')) + '…</div></td>' +
        '<td>' + (p.canal === 'correo' ? '✉️ Correo' : '💬 WhatsApp') + '</td>' +
        '<td class="dim">' + esc(p.asunto || '—') + '</td><td class="dim">' + fecha(p.actualizado) + '</td>' +
        '<td style="text-align:right"><button class="btn sec mini" data-plantilla-usar="' + p.id + '">Usar</button> ' +
        '<button class="btn sec mini" data-plantilla-borrar="' + p.id + '">Archivar</button></td></tr>';
    }).join('') || '<tr><td colspan="5" class="dim" style="padding:18px">Sin plantillas guardadas.</td></tr>';

    return '<div class="cab"><h1>Plantillas</h1><div class="sp"><button class="btn" data-nueva="1">Nueva campaña</button></div></div>' +
      '<div class="scroll"><table class="tabla"><thead><tr><th>Plantilla</th><th>Canal</th><th>Asunto</th><th>Modificada</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<h3 style="margin:18px 0 10px">Diseños listos para usar</h3>' +
      '<div class="grid g4">' + GALERIA.map(function (g, i) {
        return '<div class="card"><h3>' + esc(g.nombre) + '</h3><p class="mini" style="margin:6px 0 12px">' + esc(g.asunto) + '</p>' +
          '<button class="btn sec mini" data-galeria="' + i + '">Usar este</button></div>';
      }).join('') + '</div>';
  }

  // ---------- Historial ----------
  function vistaHistorial() {
    var filas = S.historial.map(function (m) {
      var clase = m.estado === 'enviado' ? 'ok' : (m.estado === 'fallido' || m.estado === 'rechazado') ? 'warn' : 'gris';
      return '<tr><td>' + (m.canal === 'correo' ? '✉️' : '💬') + '</td>' +
        '<td><b>' + esc(m.titulo || '(sin asunto)') + '</b><div class="mini">' + esc((m.cuerpo || '').replace(/<[^>]*>/g, ' ').slice(0, 80)) + '</div></td>' +
        '<td><span class="pill ' + clase + '">' + esc(m.estado) + '</span></td>' +
        '<td class="dim">' + fecha(m.creado) + '</td>' +
        '<td style="text-align:right">' + (m.contacto_id ? '<button class="btn sec mini" data-ficha="' + m.contacto_id + '">Contacto</button>' : '') + '</td></tr>';
    }).join('') || '<tr><td colspan="5" class="dim" style="padding:18px">Todavía no se ha enviado nada.</td></tr>';

    return '<div class="cab"><h1>Historial</h1><div class="sp"><button class="btn sec" id="utwi-recargar">Actualizar</button></div></div>' +
      '<div class="scroll"><table class="tabla"><thead><tr><th></th><th>Mensaje</th><th>Estado</th><th>Fecha</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>';
  }

  // ==========================================================================
  // 7) Eventos
  // ==========================================================================

  var $ = function (id) { return document.getElementById(id); };
  var cada = function (sel, fn) { Array.prototype.forEach.call(host.querySelectorAll(sel), fn); };
  var reloj = null;

  var MARCAS = {
    titulo: ['## ', ''], negrita: ['**', '**'], lista: ['- ', ''],
    enlace: ['[texto](', 'https://uptowine.cl)'], boton: ['[[Ver el catálogo|', 'https://uptowine.cl]]'],
    imagen: ['![foto](', 'https://…jpg)'], separador: ['\n---\n', ''], nombre: ['{nombre}', ''],
  };

  var BLOQUES = { titulo: 1, lista: 1, boton: 1, imagen: 1, separador: 1 };

  function insertarMarca(clave) {
    var t = $('utwi-cuerpo'); if (!t) return;
    var m = MARCAS[clave], ini = t.selectionStart, fin = t.selectionEnd;
    var medio = t.value.slice(ini, fin);
    // un título o un botón empiezan en su propia línea: pegados al párrafo anterior
    // no se ven como bloque
    var antes = '';
    if (BLOQUES[clave] && ini > 0) {
      var cola = t.value.slice(0, ini);
      antes = /\n\n$/.test(cola) ? '' : /\n$/.test(cola) ? '\n' : '\n\n';
    }
    t.value = t.value.slice(0, ini) + antes + m[0] + medio + m[1] + t.value.slice(fin);
    S.campana.cuerpo = t.value;
    t.focus();
    t.selectionStart = t.selectionEnd = ini + antes.length + m[0].length + medio.length + m[1].length;
    refrescarPrevia();
  }

  function conectar() {
    if ($('utwi-salir')) $('utwi-salir').onclick = function () { S.sel = {}; S.msj = ''; sb.auth.signOut(); };

    cada('[data-vista]', function (b) {
      b.onclick = function () {
        S.vista = b.getAttribute('data-vista'); S.confirmar = false;
        if (S.vista === 'historial') cargarHistorial(); else pintar();
      };
    });
    cada('[data-nueva]', function (b) { b.onclick = function () { nuevaCampana(); }; });
    cada('[data-galeria]', function (b) {
      b.onclick = function () {
        var g = GALERIA[Number(b.getAttribute('data-galeria'))];
        nuevaCampana({ nombre: g.nombre, asunto: g.asunto, cuerpo: g.cuerpo, canal: 'correo',
          destinatarios: Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number) });
      };
    });
    if ($('utwi-sync')) $('utwi-sync').onclick = sincronizar;
    if ($('utwi-recargar')) $('utwi-recargar').onclick = cargarHistorial;

    // ---- contactos ----
    var buscar = $('utwi-buscar');
    if (buscar) {
      buscar.oninput = function () { clearTimeout(reloj); reloj = setTimeout(function () { S.q = buscar.value; cargarContactos(); }, 350); };
      buscar.onkeydown = function (ev) { if (ev.key === 'Enter') { clearTimeout(reloj); S.q = buscar.value; cargarContactos(); } };
    }
    cada('[data-filtro]', function (b) {
      b.onclick = function () { S[b.getAttribute('data-filtro')] = b.getAttribute('data-valor'); cargarContactos(); };
    });
    cada('[data-marca]', function (b) {
      if (b.tagName === 'INPUT') {
        b.onclick = function (ev) { ev.stopPropagation(); S.sel[b.getAttribute('data-marca')] = b.checked; pintar(); };
      } else {
        b.onclick = function () { insertarMarca(b.getAttribute('data-marca')); };
      }
    });
    if ($('utwi-todos')) $('utwi-todos').onclick = function () {
      var marcar = $('utwi-todos').checked;
      S.contactos.forEach(function (c) { S.sel[c.id] = marcar && !c.baja; });
      pintar();
    };
    cada('[data-ficha]', function (b) { b.onclick = function (ev) { ev.stopPropagation(); abrirFicha(b.getAttribute('data-ficha')); }; });
    if ($('utwi-campana-sel')) $('utwi-campana-sel').onclick = function () {
      nuevaCampana({ destinatarios: Object.keys(S.sel).filter(function (k) { return S.sel[k]; }).map(Number) });
    };
    if ($('utwi-exportar')) $('utwi-exportar').onclick = exportarCSV;
    if ($('utwi-importar')) $('utwi-importar').onclick = function () {
      var entrada = document.createElement('input');
      entrada.type = 'file'; entrada.accept = '.csv,text/csv';
      entrada.onchange = function () {
        var f = entrada.files[0]; if (!f) return;
        var lector = new FileReader();
        lector.onload = function () {
          var datos = csvLeer(String(lector.result));
          if (!datos.filas.length) return aviso('Ese CSV no trae filas.', 'err');
          var mapa = csvMapear(datos.cabeceras);
          if (mapa.email < 0 && mapa.celular < 0) return aviso('El CSV necesita una columna de correo o de celular.', 'err');
          S.importar = { cabeceras: datos.cabeceras, filas: datos.filas, mapa: mapa };
          pintar();
        };
        lector.readAsText(f);
      };
      entrada.click();
    };
    if ($('utwi-cancelar-import')) $('utwi-cancelar-import').onclick = function () { S.importar = null; pintar(); };
    if ($('utwi-confirmar-import')) $('utwi-confirmar-import').onclick = function () { importarCSV(S.importar.filas, S.importar.mapa); };
    if ($('utwi-guardar-segmento')) $('utwi-guardar-segmento').onclick = function () {
      var nombre = window.prompt('Nombre del segmento (queda guardado con los filtros actuales)');
      if (nombre && nombre.trim()) guardarSegmento(nombre.trim());
    };
    if ($('utwi-segmento')) $('utwi-segmento').onchange = function () { if (this.value) aplicarSegmento(this.value); };

    // ---- ficha ----
    if ($('utwi-velo')) $('utwi-velo').onclick = function () { S.ficha = null; pintar(); };
    if ($('utwi-cerrar-ficha')) $('utwi-cerrar-ficha').onclick = function () { S.ficha = null; pintar(); };
    if ($('utwi-f-guardar')) $('utwi-f-guardar').onclick = function () {
      guardarContacto({ nombre: $('utwi-f-nombre').value, email: $('utwi-f-email').value || null,
        celular: $('utwi-f-celular').value || null, notas: $('utwi-f-notas').value }, S.ficha.id);
    };
    if ($('utwi-f-baja')) $('utwi-f-baja').onclick = function () {
      guardarContacto({ baja: !S.ficha.baja }, S.ficha.id);
    };
    if ($('utwi-f-escribir')) $('utwi-f-escribir').onclick = function () {
      var id = S.ficha.id; S.ficha = null;
      nuevaCampana({ destinatarios: [Number(id)], nombre: 'Mensaje directo' });
    };
    if ($('utwi-add-etiqueta')) $('utwi-add-etiqueta').onclick = function () {
      var e = ($('utwi-f-etiqueta').value || '').trim(); if (!e) return;
      var ya = S.ficha.etiquetas || [];
      if (ya.indexOf(e) === -1) guardarContacto({ etiquetas: ya.concat([e]) }, S.ficha.id);
    };
    cada('[data-quita-etiqueta]', function (b) {
      b.onclick = function () {
        var e = b.getAttribute('data-quita-etiqueta');
        guardarContacto({ etiquetas: (S.ficha.etiquetas || []).filter(function (x) { return x !== e; }) }, S.ficha.id);
      };
    });

    // ---- etiquetas ----
    if ($('utwi-filtro-etiqueta')) $('utwi-filtro-etiqueta').onchange = function () {
      S.etiqueta = this.value; cargarContactos();
    };
    if ($('utwi-poner-etiqueta')) $('utwi-poner-etiqueta').onchange = function () {
      var v = this.value; this.value = '';
      if (v === '__nueva__') {
        var nueva = window.prompt('Nombre de la etiqueta nueva');
        if (nueva && nueva.trim()) etiquetarSeleccion(nueva.trim(), false);
        return;
      }
      if (v) etiquetarSeleccion(v, false);
    };
    if ($('utwi-quitar-etiqueta')) $('utwi-quitar-etiqueta').onchange = function () {
      var v = this.value; this.value = '';
      if (v) etiquetarSeleccion(v, true);
    };
    if ($('utwi-limpiar-sel')) $('utwi-limpiar-sel').onclick = function () { S.sel = {}; pintar(); };
    if ($('utwi-crear-etiqueta')) $('utwi-crear-etiqueta').onclick = function () {
      var n = ($('utwi-nueva-etiqueta').value || '').trim();
      if (!n) return aviso('Escribe el nombre de la etiqueta.', 'err');
      crearEtiqueta(n, $('utwi-nuevo-color').value);
    };
    cada('[data-color]', function (sel) {
      sel.onchange = function () { colorEtiqueta(sel.getAttribute('data-color'), sel.value); };
    });
    cada('[data-ver-etiqueta]', function (b) {
      b.onclick = function () {
        S.etiqueta = b.getAttribute('data-ver-etiqueta'); S.vista = 'contactos';
        cargarContactos();
      };
    });
    cada('[data-escribir-etiqueta]', function (b) {
      b.onclick = function () {
        var e = b.getAttribute('data-escribir-etiqueta');
        consulta({ etiqueta: e }).then(function (r) {
          nuevaCampana({ nombre: 'A los de ' + e, destinatarios: (r.data || []).map(function (c) { return c.id; }) });
        });
      };
    });
    cada('[data-renombrar]', function (b) {
      b.onclick = function () { renombrarEtiqueta(b.getAttribute('data-renombrar')); };
    });
    cada('[data-borrar-etiqueta]', function (b) {
      b.onclick = function () { borrarEtiqueta(b.getAttribute('data-borrar-etiqueta'), b.getAttribute('data-n')); };
    });

    // ---- campañas ----
    cada('[data-campana]', function (b) {
      b.onclick = function () {
        var c = S.campanas.filter(function (x) { return String(x.id) === String(b.getAttribute('data-campana')); })[0];
        if (c) { S.campana = Object.assign({}, c); S.adjuntos = []; S.confirmar = false; S.vista = 'campana'; pintar(); }
      };
    });
    cada('[data-duplicar]', function (b) {
      b.onclick = function () {
        var c = S.campanas.filter(function (x) { return String(x.id) === String(b.getAttribute('data-duplicar')); })[0];
        if (c) nuevaCampana({ nombre: c.nombre + ' (copia)', canal: c.canal, asunto: c.asunto, cuerpo: c.cuerpo, segmento_id: c.segmento_id, destinatarios: c.destinatarios });
      };
    });
    cada('[data-canal]', function (b) {
      b.onclick = function () { S.campana.canal = b.getAttribute('data-canal'); S.confirmar = false; pintar(); };
    });
    cada('[data-previa]', function (b) {
      b.onclick = function () { S.previa = b.getAttribute('data-previa'); pintar(); };
    });
    if ($('utwi-nombre')) $('utwi-nombre').oninput = function () { S.campana.nombre = this.value; };
    if ($('utwi-asunto')) $('utwi-asunto').oninput = function () { S.campana.asunto = this.value; };
    var cuerpo = $('utwi-cuerpo');
    if (cuerpo) cuerpo.oninput = function () {
      S.campana.cuerpo = cuerpo.value;          // sin repintar: se perdería el cursor
      clearTimeout(reloj); reloj = setTimeout(refrescarPrevia, 450);
    };
    if ($('utwi-destinatarios')) $('utwi-destinatarios').onchange = function () {
      if (this.value === 'sel') { S.campana.segmento_id = null; }
      else if (this.value) { S.campana.segmento_id = Number(this.value); S.campana.destinatarios = []; }
      else { S.campana.segmento_id = null; }
      pintar();
    };
    if ($('utwi-guardar-campana')) $('utwi-guardar-campana').onclick = function () { guardarCampana(); };
    if ($('utwi-prueba')) $('utwi-prueba').onclick = enviarPrueba;
    if ($('utwi-enviar')) $('utwi-enviar').onclick = function () {
      if (S.confirmar) enviarCampana(); else { S.confirmar = true; pintar(); }
    };
    if ($('utwi-archivo')) $('utwi-archivo').onchange = function () { sumarAdjuntos(this.files); this.value = ''; };
    cada('[data-quita]', function (b) {
      b.onclick = function () { S.adjuntos.splice(Number(b.getAttribute('data-quita')), 1); pintar(); };
    });
    if ($('utwi-guardar-plantilla')) $('utwi-guardar-plantilla').onclick = function () {
      if (!S.campana.cuerpo.trim()) return aviso('Escribe el mensaje antes de guardarlo como plantilla.', 'err');
      var nombre = window.prompt('Nombre de la plantilla', S.campana.nombre || '');
      if (nombre && nombre.trim()) guardarPlantillaDesdeCampana(nombre.trim());
    };
    if ($('utwi-usar-plantilla')) $('utwi-usar-plantilla').onchange = function () {
      var p = S.plantillas.filter(function (x) { return String(x.id) === String(this.value); }.bind(this))[0];
      if (!p) return;
      S.campana.asunto = p.asunto || ''; S.campana.cuerpo = p.cuerpo || '';
      if (!S.campana.nombre) S.campana.nombre = p.nombre;
      pintar();
    };

    // ---- plantillas ----
    cada('[data-plantilla-usar]', function (b) {
      b.onclick = function () {
        var p = S.plantillas.filter(function (x) { return String(x.id) === String(b.getAttribute('data-plantilla-usar')); })[0];
        if (p) nuevaCampana({ nombre: p.nombre, canal: p.canal, asunto: p.asunto || '', cuerpo: p.cuerpo });
      };
    });
    cada('[data-plantilla-borrar]', function (b) {
      b.onclick = function () {
        var p = S.plantillas.filter(function (x) { return String(x.id) === String(b.getAttribute('data-plantilla-borrar')); })[0];
        if (p && window.confirm('¿Archivar la plantilla "' + p.nombre + '"?')) {
          sb.from('plantillas').update({ archivada: true }).eq('id', p.id).then(function () {
            aviso('Plantilla archivada.'); cargarPlantillas();
          });
        }
      };
    });
  }
})();
