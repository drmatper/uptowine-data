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
  var LOGO = 'https://app.uptowine.cl/logo-blanco.png';   // wordmark blanco del kit Crimson (Logos utw/57)
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
      .replace(/\{comuna\}/gi, c.comuna || '')
      .replace(/\{plan\}/gi, c.club_plan || 'tu plan')
      .replace(/\{mes\}/gi, MESES[new Date().getMonth()]);
  }
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

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
        return u ? '<a href="' + u + '" style="color:#F1315B;text-decoration:underline">' + txt + '</a>' : txt;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#ffffff">$1</strong>')
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
          '<a href="' + u + '" style="display:inline-block;padding:15px 30px;font-family:\'Archivo\',Helvetica,Arial,sans-serif;font-size:13px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#ffffff;text-decoration:none">' +
          boton[1].trim() + '</a></td></tr></table>');
        continue;
      }
      if (/^---$/.test(b)) { salida.push('<div style="border-top:2px solid #E0B450;width:56px;margin:24px 0"></div>'); continue; }
      if (/^##\s+/.test(b)) {
        salida.push('<h2 style="margin:0 0 14px;font-family:\'Archivo\',Helvetica,Arial,sans-serif;font-weight:800;font-size:26px;line-height:1.1;letter-spacing:-.5px;color:#ffffff">' + enLinea(b.replace(/^##\s+/, '')) + '</h2>');
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
'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
'<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Jost:wght@400;500;600&display=swap" rel="stylesheet"></head>' +
/* kit Crimson: fondo negro siempre, carmesi solo en botones, dorado para lo que brilla */
'<body style="margin:0;padding:0;background:#0A0708">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0708;padding:26px 12px">' +
'<tr><td align="center">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#140E10;border:1px solid #2A2226;border-radius:16px;overflow:hidden">' +
'<tr><td align="center" style="padding:30px 32px 0">' +
'<img src="' + LOGO + '" alt="Up to Wine" width="170" style="display:block;width:170px;max-width:60%;height:auto">' +
'<div style="margin-top:12px;font-family:\'Archivo\',Helvetica,Arial,sans-serif;font-weight:700;font-size:10px;letter-spacing:2.4px;text-transform:uppercase;color:#F1315B">Vinos de autor boutique</div>' +
'</td></tr>' +
'<tr><td style="padding:28px 32px 6px;font-family:\'Jost\',\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#B5B0B2">' +
cuerpoHtml(personalizar(texto, contacto)) +
'</td></tr>' +
'<tr><td style="padding:10px 32px 28px">' +
'<div style="border-top:1px solid #2A2226;margin-bottom:14px"></div>' +
'<p style="margin:0;font-family:\'Jost\',\'Segoe UI\',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#8A8087">' +
'Up to Wine &middot; Vinos de autor boutique<br>' +
'<a href="https://uptowine.cl" style="color:#F1315B;text-decoration:none">uptowine.cl</a> &middot; Instagram @uptowine &middot; WhatsApp +56 9 3173 7400 &middot; ventas@uptowine.cl<br>' +
'Venta de alcohol solo a mayores de 18 a&ntilde;os. Disfruta con moderaci&oacute;n.<br>' +
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
      .trim() + '\n\n—\nUp to Wine · Vinos de autor boutique\nuptowine.cl · Instagram @uptowine · WhatsApp +56 9 3173 7400 · ventas@uptowine.cl\nVenta de alcohol solo a mayores de 18 años. Disfruta con moderación.\nResponde con la palabra BAJA para no recibir más correos.';
  }

  // --- el mismo marcado, en formato WhatsApp -----------------------------------
  // Una plantilla sirve para los dos canales: por WhatsApp el titulo va en
  // *negrita*, las listas con viñeta, los enlaces como "texto: url" y el boton
  // como una linea con la url. Nada de ##, ** ni corchetes.
  function textoWhatsApp(texto) {
    return String(texto || '')
      .replace(/^##\s+(.+)$/gm, function (_, t) { return '*' + t.trim() + '*'; })
      .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1*$2*')
      .replace(/^[ \t]*[-*][ \t]+/gm, '\u2022 ')   // [ \t] y no \s: \s se tragaba la linea en blanco anterior
      .replace(/^\[\[([^|\]]+)\|([^\]]+)\]\]$/gm, '\ud83d\udc49 $1: $2')
      .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
      .replace(/^---$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // --- club: estado por fecha del ultimo cobro (MP, Payku y PAT) --------------
  // hasta 35 dias al dia, hasta 75 moroso, despues inactivo. Sin fecha: inactivo.
  function estadoPorFecha(ultimoPago, hoy) {
    if (!ultimoPago) return 'inactivo';
    var dias = Math.floor((new Date(hoy || Date.now()).getTime() - new Date(ultimoPago).getTime()) / 86400000);
    return dias <= 35 ? 'al_dia' : dias <= 75 ? 'moroso' : 'inactivo';
  }
  var ESTADO_CLUB = { al_dia: 'Al día', moroso: 'Moroso', inactivo: 'Inactivo', baja: 'Baja' };

  // RUT chileno: 12.345.678-5 -> 12345678-5, o '' si no calza. Se valida el
  // dígito verificador (módulo 11): sin eso un celular de 9 dígitos pasa por RUT.
  function rutNormalizar(raw) {
    var d = String(raw || '').replace(/[^0-9kK]/g, '').toUpperCase();
    if (!/^[0-9]{7,8}[0-9K]$/.test(d)) return '';
    var cuerpo = d.slice(0, -1), dv = d.slice(-1), suma = 0, mult = 2;
    for (var i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mult; mult = mult === 7 ? 2 : mult + 1; }
    var r = 11 - (suma % 11), calc = r === 11 ? '0' : r === 10 ? 'K' : String(r);
    return calc === dv ? cuerpo + '-' + dv : '';
  }

  // Export de Payku: una suscripcion por fila. Estatus manda; si no lo trae, la fecha.
  function paykuFila(f, mapa, hoy) {
    var estatus = String(mapa.estatus >= 0 ? f[mapa.estatus] || '' : '').toLowerCase();
    var ultima = mapa.ultima >= 0 ? String(f[mapa.ultima] || '').slice(0, 10) : '';
    var estado = /activ/.test(estatus) ? 'al_dia'
      : /cancel|inactiv|suspend|baja|anul/.test(estatus) ? 'baja'
      : estadoPorFecha(ultima, hoy);
    return {
      canal: 'payku',
      id_externo: String(mapa.sub >= 0 && f[mapa.sub] ? f[mapa.sub] : (mapa.email >= 0 ? f[mapa.email] : '')).trim(),
      email: mapa.email >= 0 ? String(f[mapa.email] || '').trim().toLowerCase() : '',
      nombre: mapa.nombre >= 0 ? String(f[mapa.nombre] || '').trim() : '',
      celular: mapa.celular >= 0 ? String(f[mapa.celular] || '') : '',
      plan: mapa.plan >= 0 ? String(f[mapa.plan] || '') : '',
      monto: mapa.monto >= 0 ? Number(String(f[mapa.monto] || '').replace(/[^0-9.-]/g, '')) || null : null,
      estado: estado,
      ultimo_pago: ultima || null,
      detalle: [estatus, mapa.frecuencia >= 0 ? f[mapa.frecuencia] : ''].filter(Boolean).join(' · '),
    };
  }

  // Cartola Transbank ya procesada (hoja "Transbank datos"): una fila por cobro.
  // Se agrupan los cobros PAT por RUT: cuota actual = ultimo monto, y el estado
  // lo pone la fecha del ultimo cobro.
  function patAgrupar(filas, mapa, hoy) {
    var socios = {};
    filas.forEach(function (f) {
      var rut = rutNormalizar(mapa.rut >= 0 ? f[mapa.rut] : '');
      if (!rut) return;
      if (mapa.canal >= 0 && !/pat/i.test(String(f[mapa.canal] || ''))) return;
      var fecha = String(mapa.fecha >= 0 ? f[mapa.fecha] || '' : '').slice(0, 10);
      var monto = Number(String(mapa.monto >= 0 ? f[mapa.monto] || 0 : 0).replace(/[^0-9.-]/g, '')) || 0;
      var s = socios[rut] = socios[rut] || { rut: rut, primero: fecha, ultimo: '', monto: 0, cobros: 0 };
      s.cobros++;
      if (fecha && fecha < s.primero) s.primero = fecha;
      if (fecha >= s.ultimo) { s.ultimo = fecha; s.monto = monto; }
    });
    return Object.keys(socios).map(function (rut) {
      var s = socios[rut];
      return { canal: 'pat', id_externo: rut, rut: rut, plan: 'Cuota PAT Transdata', monto: s.monto,
        estado: estadoPorFecha(s.ultimo, hoy), alta: s.primero || null, ultimo_pago: s.ultimo || null,
        detalle: s.cobros + ' cobros en la cartola' };
    });
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
    var m = {
      nombre: busca(['nombre', 'name', 'first']),
      email: busca(['email', 'correo', 'mail']),
      celular: busca(['celular', 'telefono', 'teléfono', 'phone', 'movil', 'móvil', 'whatsapp']),
      etiquetas: busca(['etiqueta', 'tag', 'segmento']),
      rut: busca(['rut']),
      comuna: busca(['comuna', 'municipality', 'ciudad']),
      // Payku
      sub: busca(['suscripción id', 'suscripcion id', 'subscription']),
      estatus: busca(['estatus', 'status', 'estado']),
      plan: busca(['plan']),
      frecuencia: busca(['frecuencia']),
      monto: busca(['monto', 'amount', 'cuota']),
      ultima: busca(['última fecha', 'ultima fecha', 'último cobro', 'ultimo cobro']),
      // Transbank
      canal: busca(['canal']),
      fecha: busca(['fecha']),
    };
    m.tipo = m.sub >= 0 && m.estatus >= 0 ? 'payku'
      : m.rut >= 0 && m.canal >= 0 && m.monto >= 0 ? 'pat'
      : 'contactos';
    return m;
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
      diasDesde: diasDesde, estadoPorFecha: estadoPorFecha, rutNormalizar: rutNormalizar,
      paykuFila: paykuFila, patAgrupar: patAgrupar, textoWhatsApp: textoWhatsApp };
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
    contactos: [], total: 0, q: '', origen: '', etiqueta: '', compras: '', club: '', sel: {}, ficha: null,
    eventos: [],
    segmentos: [], plantillas: [], campanas: [], historial: [], cola: null, metricas: null,
    etiquetas: [],
    campana: null, adjuntos: [], previa: 'escritorio',
    picker: null,   // panel de destinatarios: { todos: [], q: '' }
    nombres: {},    // id -> nombre, para mostrar los destinatarios elegidos
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
    '.utwi .ficha.ancha{width:min(560px,100%)}',
    '.utwi .grupo{display:flex;align-items:center;gap:9px;padding:7px 4px;border-top:1px solid #f0f2f5;font-size:13.5px}',
    '.utwi .grupo input[type=checkbox]{width:16px;height:16px;flex:0 0 auto;accent-color:var(--crim)}',
    '.utwi .grupo>div{flex:1;min-width:0}',
    '.utwi .grupo .n{color:var(--tx2);font-size:12px}',
    '.utwi .grupo .sp{margin-left:auto}',
    '.utwi .pie{position:sticky;bottom:-20px;margin:16px -20px -20px;padding:12px 20px;background:#fff;border-top:1px solid var(--linea);display:flex;gap:8px;align-items:center}',
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

  var COLS = 'id,nombre,email,celular,rut,comuna,origen,etiquetas,notas,n_pedidos,total_gastado,ultima_compra,baja,creado,club_estado,club_canal,club_plan,club_monto,club_alta,club_ultimo_pago,club_baja';

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
    if (f.club === 'socio') sel = sel.in('club_estado', ['al_dia', 'moroso', 'inactivo']);
    else if (f.club === 'nosocio') sel = sel.is('club_estado', null);
    else if (f.club) sel = sel.eq('club_estado', f.club);
    if (f.activos !== false) sel = sel.eq('baja', false);
    return sel;
  }

  function filtroActual() { return { q: S.q, origen: S.origen, etiqueta: S.etiqueta, compras: S.compras, club: S.club }; }

  function cargarContactos() {
    return consulta(filtroActual()).then(function (r) {
      if (r.error) return aviso('No pudimos leer los contactos: ' + r.error.message, 'err');
      S.contactos = r.data || []; recordarNombres(S.contactos); pintar();
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
      sb.from('contactos').select('id', { count: 'exact', head: true }).eq('club_estado', 'al_dia'),
      sb.from('contactos').select('id', { count: 'exact', head: true }).eq('club_estado', 'moroso'),
      sb.from('membresias_eventos').select('id', { count: 'exact', head: true }).gte('fecha', hace30).eq('a', 'al_dia').is('de', null),
      sb.from('membresias_eventos').select('id', { count: 'exact', head: true }).gte('fecha', hace30).eq('a', 'baja'),
      sb.from('membresias_eventos').select('id,canal,de,a,fecha,contacto:contacto_id(id,nombre,email,club_plan)').order('fecha', { ascending: false }).limit(12),
    ]).then(function (rs) {
      S.metricas = {
        total: rs[0].count || 0, conCorreo: rs[1].count || 0, conCelular: rs[2].count || 0,
        bajas: rs[3].count || 0, correos30: rs[4].count || 0, compradores: rs[5].count || 0,
        sociosAlDia: rs[6].count || 0, morosos: rs[7].count || 0, altas30: rs[8].count || 0, bajas30: rs[9].count || 0,
      };
      S.eventos = rs[10].data || [];
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

  // Dos viajes: tienda + app primero, el club despues (Reveniu y Mercado Pago tardan).
  function sincronizar() {
    S.ocupado = true; aviso('Sincronizando tienda y app…');
    sb.functions.invoke('intranet', { body: { accion: 'crm-sync' } }).then(function (r) {
      var d = r.data || {};
      if (r.error || !d.ok) { S.ocupado = false; return aviso(d.error || (r.error && r.error.message) || 'No se pudo sincronizar la tienda.', 'err'); }
      aviso('Tienda: ' + d.jumpseller + ' · app: ' + d.socios + ' · con compras: ' + (d.con_compras || 0) + '. Ahora el club (Reveniu y Mercado Pago)…');
      cargarContactos();
      return sb.functions.invoke('intranet', { body: { accion: 'club-sync' } }).then(function (r2) {
        S.ocupado = false;
        var c = r2.data || {};
        if (r2.error || !c.ok) return aviso(c.error || (r2.error && r2.error.message) || 'El club no se pudo sincronizar.', 'err');
        var rv = c.reveniu || {}, mp = c.mercadopago || {};
        aviso('Club al día: Reveniu ' + (rv.guardadas || 0) + ' suscripciones · Mercado Pago ' + (mp.guardados || 0) + ' suscriptores · ' +
          (c.reclasificados || 0) + ' cambios de estado por fecha.');
        cargarContactos(); cargarMetricas(); cargarEtiquetas();
      });
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
    if (mapa.tipo === 'payku' || mapa.tipo === 'pat') return importarMembresias(filas, mapa);
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
        p_rut: mapa.rut >= 0 ? (f[mapa.rut] || null) : null,
        p_comuna: mapa.comuna >= 0 ? (f[mapa.comuna] || null) : null,
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

  // Payku y PAT no tienen API: entran por su export, como membresias del club.
  function importarMembresias(filas, mapa) {
    var lista = mapa.tipo === 'payku'
      ? filas.map(function (f) { return paykuFila(f, mapa); }).filter(function (m) { return m.id_externo; })
      : patAgrupar(filas, mapa);
    var i = 0, ok = 0, fallos = 0;
    S.ocupado = true;
    function siguiente() {
      if (i >= lista.length) {
        S.ocupado = false; S.importar = null; S.progreso = '';
        aviso((mapa.tipo === 'payku' ? 'Payku: ' : 'PAT Transdata: ') + ok + ' membresía(s) registradas' + (fallos ? ' · ' + fallos + ' sin datos para identificar' : '') + '.');
        cargarContactos(); cargarMetricas();
        return;
      }
      var m = lista[i++];
      S.progreso = i + '/' + lista.length; pintar();
      sb.rpc('crm_membresia', {
        p_canal: m.canal, p_id_externo: m.id_externo, p_email: m.email || null, p_nombre: m.nombre || '',
        p_celular: m.celular || null, p_rut: m.rut || null, p_plan: m.plan || null, p_monto: m.monto,
        p_estado: m.estado, p_alta: m.alta || null, p_ultimo_pago: m.ultimo_pago || null, p_detalle: m.detalle || null,
      }).then(function (r) { if (r.error || !r.data) fallos++; else ok++; siguiente(); });
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
    S.q = f.q || ''; S.origen = f.origen || ''; S.etiqueta = f.etiqueta || ''; S.compras = f.compras || ''; S.club = f.club || '';
    cargarContactos();
  }

  function abrirFicha(id) {
    Promise.all([
      sb.from('contactos').select(COLS).eq('id', id).maybeSingle(),
      sb.from('crm_mensajes').select('*').eq('contacto_id', id).order('creado', { ascending: false }).limit(20),
      sb.from('membresias').select('canal,estado,plan,monto,alta,ultimo_pago').eq('contacto_id', id),
    ]).then(function (rs) {
      if (!rs[0].data) return aviso('No encontramos ese contacto.', 'err');
      S.ficha = rs[0].data;
      S.ficha.mensajes = rs[1].data || [];
      S.ficha.membresias = rs[2].data || [];
      pintar();
    });
  }

  // ---- destinatarios ----
  function abrirPicker() {
    S.picker = { todos: [], q: '', cargando: true }; pintar();
    consulta({ q: '', origen: '', etiqueta: '', compras: '', club: '' }).then(function (r) {
      S.picker.todos = r.data || []; recordarNombres(S.picker.todos); S.picker.cargando = false; pintar();
    });
  }
  function recordarNombres(lista) {
    lista.forEach(function (c) { S.nombres[c.id] = c.nombre || c.email || c.celular || '(sin nombre)'; });
  }
  // campañas del historial traen ids sin nombre: los pedimos una vez
  function completarNombres(ids) {
    var faltan = ids.filter(function (id) { return !S.nombres[id]; });
    if (!faltan.length) return;
    faltan.forEach(function (id) { S.nombres[id] = '…'; });
    sb.from('contactos').select('id,nombre,email,celular').in('id', faltan).then(function (r) {
      recordarNombres(r.data || []); pintar();
    });
  }
  function elegidosSet() {
    var set = {};
    (S.campana.destinatarios || []).forEach(function (id) { set[id] = true; });
    return set;
  }
  function fijarDestinatarios(set) {
    S.campana.destinatarios = Object.keys(set).filter(function (k) { return set[k]; }).map(Number);
    S.campana.segmento_id = null;   // la eleccion a mano manda sobre el segmento
    S.confirmar = false;
  }
  // agrega o quita de golpe un grupo (una etiqueta, un estado del club)
  function alternarGrupo(ids) {
    var set = elegidosSet();
    var todos = ids.length && ids.every(function (id) { return set[id]; });
    ids.forEach(function (id) { set[id] = !todos; });
    fijarDestinatarios(set); pintar();
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
      return consulta(Object.assign({ q: '', origen: '', etiqueta: '', compras: '', club: '' }, (s && s.filtro) || {}))
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
  // El PDF de una campaña de WhatsApp se sube una sola vez al bucket privado;
  // el puente del VPS lo baja con la service key y se lo entrega al bot con el
  // texto como leyenda. Devuelve la ruta dentro del bucket (o null si no hay).
  function subirDocumentoWhatsApp() {
    var a = S.adjuntos[0];
    if (!a || S.campana.canal !== 'whatsapp') return Promise.resolve(null);
    var bytes = Uint8Array.from(atob(a.base64), function (c) { return c.charCodeAt(0); });
    var ruta = 'wa/campana-' + (S.campana.id || 'nueva') + '-' + Date.now() + '.pdf';
    return sb.storage.from('intranet').upload(ruta, bytes, { contentType: 'application/pdf', upsert: false })
      .then(function (r) {
        if (r.error) throw new Error('No se pudo subir el PDF: ' + r.error.message);
        return ruta;
      });
  }

  function enviarCampana() {
    S.confirmar = false; S.ocupado = true; pintar();
    Promise.all([destinatariosDeCampana(), subirDocumentoWhatsApp()]).then(function (rs) {
      var todos = rs[0], rutaPdf = rs[1];
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
            texto: textoWhatsApp(personalizar(S.campana.cuerpo, c)), contacto_id: c.id, por: 'intranet',
            datos: rutaPdf ? { archivo: rutaPdf, nombre: S.adjuntos[0].nombre } : {},
          }).then(function (r) { return r.error ? r.error.message : null; });
        }
        p.then(function (error) {
          if (error) fallos.push((c.nombre || c.email || c.celular) + ': ' + error); else ok++;
          setTimeout(siguiente, S.campana.canal === 'correo' ? 600 : 0);  // Resend: 2 por segundo en el plan gratis
        });
      }
      siguiente();
    }).catch(function (e) {
      S.ocupado = false; S.progreso = '';
      aviso(String(e.message || e), 'err');
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
    var tope = S.campana && S.campana.canal === 'whatsapp' ? 1 : MAX_ADJUNTOS;
    if (tope === 1) S.adjuntos = [];
    Array.prototype.forEach.call(files, function (f) {
      if (S.adjuntos.length >= tope) return aviso(tope === 1 ? 'Por WhatsApp va un solo PDF por mensaje.' : 'Máximo ' + MAX_ADJUNTOS + ' adjuntos.', 'err');
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

    // Repintar borra el DOM y con el el scroll: se guarda y se repone, si no
    // marcar un contacto al final de la lista te devolvia arriba.
    var SCROLLS = '.scroll, .ficha, .panel';
    var scrolls = Array.prototype.map.call(host.querySelectorAll(SCROLLS), function (el) { return el.scrollTop; });
    var scrollY = window.scrollY;

    host.innerHTML = '<div class="utwi">' +
      '<div class="top"><div class="marca"><span class="punto"></span> Intranet Up to Wine</div>' +
      '<div class="sp"><span>' + esc(S.sesion.user.email) + '</span>' +
      '<button class="btn sec mini" id="utwi-salir">Salir</button></div></div>' +
      '<div class="cuerpo"><div class="lado">' + nav + '</div>' +
      '<div class="panel"><p class="msj ' + (S.err ? 'err' : '') + '">' + esc(S.msj) + '</p>' + contenido + '</div></div>' +
      (S.ficha ? fichaContacto() : '') +
      (S.picker && S.vista === 'campana' ? panelDestinatarios() : '') +
      '</div>';
    Array.prototype.forEach.call(host.querySelectorAll(SCROLLS), function (el, i) { if (scrolls[i]) el.scrollTop = scrolls[i]; });
    if (scrollY) window.scrollTo(0, scrollY);
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
    var m = S.metricas || { total: 0, conCorreo: 0, conCelular: 0, bajas: 0, correos30: 0, compradores: 0, sociosAlDia: 0, morosos: 0, altas30: 0, bajas30: 0 };
    var movimientos = (S.eventos || []).map(function (e) {
      var c = e.contacto || {};
      var texto = e.a === 'baja' ? 'se dio de baja' : e.a === 'moroso' ? 'cayó en mora' : e.a === 'inactivo' ? 'quedó inactivo'
        : (!e.de || e.de === 'baja') ? 'se sumó al club' : 'volvió a estar al día';
      var clase = e.a === 'al_dia' ? 'ok' : e.a === 'baja' ? 'gris' : 'warn';
      return '<div class="dato"><span><b style="color:var(--tx)">' + esc(c.nombre || c.email || 'contacto') + '</b> ' + texto +
        ' <span class="mini">· ' + esc(e.canal) + (c.club_plan ? ' · ' + esc(c.club_plan) : '') + '</span></span>' +
        '<span class="pill ' + clase + '">' + fecha(e.fecha) + '</span></div>';
    }).join('') || '<p class="mini">Sin movimientos todavía: sincroniza para traer el club.</p>';
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
      kpi(m.sociosAlDia, 'socios del club al día') +
      kpi(m.morosos, 'socios morosos') +
      kpi(m.correos30, 'correos enviados en 30 días') +
      '</div>' +
      '<div class="grid g4" style="margin-top:12px">' +
      kpi(m.altas30, 'altas al club en 30 días') +
      kpi(m.bajas30, 'bajas del club en 30 días') +
      kpi(m.conCorreo, 'con correo (alcanzables)') +
      kpi(m.conCelular, 'con celular') +
      '</div>' +
      '<div class="grid g2" style="margin-top:12px">' +
      '<div class="card"><h3>Movimientos del club</h3>' + movimientos +
      '<p class="ayuda">Cada cambio de estado de un socio (alta, mora, baja) queda aquí. Se actualiza solo todos los días a las 6:30; "Sincronizar" lo trae al instante.</p></div>' +
      '<div class="card"><h3>Últimas campañas</h3><table class="tabla" style="margin-top:8px">' + ultimas + '</table></div>' +
      '</div><div class="grid g2" style="margin-top:12px">' +
      '<div class="card"><h3>Estado del canal</h3>' +
      '<div class="dato"><span>Compradores registrados</span><b>' + m.compradores + '</b></div>' +
      '<div class="dato"><span>Dados de baja</span><b>' + m.bajas + '</b></div>' +
      (S.cola ? '<div class="dato"><span>WhatsApp por salir</span><b>' + S.cola.pendientes + '</b></div>' +
        '<div class="dato"><span>WhatsApp enviados</span><b>' + S.cola.enviados + '</b></div>' : '') +
      '<p class="ayuda">El correo sale por Resend y el WhatsApp por el bot del servidor. Mientras no estén conectados, los correos fallan y los WhatsApp quedan en la cola.</p>' +
      '</div></div>';
  }

  function kpi(n, txt) { return '<div class="card kpi"><b>' + n + '</b><span>' + txt + '</span></div>'; }

  function pillClub(c) {
    if (!c.club_estado) return '<span class="mini">' + esc((c.origen || []).join(', ') || '—') + '</span>';
    var clase = c.club_estado === 'al_dia' ? 'ok' : c.club_estado === 'moroso' ? 'warn' : c.club_estado === 'baja' ? 'gris' : 'crim';
    return '<span class="pill ' + clase + '">' + ESTADO_CLUB[c.club_estado] + '</span>' +
      '<div class="mini">' + esc(c.club_plan || c.club_canal || '') + (c.club_monto ? ' · ' + plata(c.club_monto) : '') + '</div>';
  }

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
        '<td>' + pillClub(c) + '</td>' +
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
      '<span style="width:12px"></span>' +
      chips('club', [['', 'Club: todos'], ['al_dia', 'Al día'], ['moroso', 'Morosos'], ['inactivo', 'Inactivos'], ['baja', 'Ex socios'], ['nosocio', 'No socios']]) +
      '<select id="utwi-filtro-etiqueta" style="width:auto;min-width:170px;margin-left:8px">' +
      '<option value="">Toda etiqueta</option>' +
      S.etiquetas.map(function (e) {
        return '<option value="' + esc(e.nombre) + '"' + (S.etiqueta === e.nombre ? ' selected' : '') + '>' + esc(e.nombre) + ' (' + e.n + ')</option>';
      }).join('') + '</select>' +
      '</div></div>' +

      '<div class="scroll"><table class="tabla">' +
      '<thead><tr><th><input type="checkbox" id="utwi-todos" aria-label="Marcar todos"></th><th>Contacto</th><th>Club</th><th>Etiquetas</th><th>Compras</th><th>Última</th><th></th></tr></thead>' +
      '<tbody>' + filas + '</tbody></table></div>' +
      '<p class="ayuda">' + S.contactos.length + ' contactos con estos filtros' + (sel.length ? ' · ' + sel.length + ' seleccionados' : '') + '. Guarda el filtro como segmento para reusarlo en una campaña.</p>';
  }

  function panelImportar() {
    var imp = S.importar;
    var cab = imp.cabeceras.map(function (h, i) {
      var mp = imp.mapa;
      var papel = mp.nombre === i ? 'nombre' : mp.email === i ? 'correo' : mp.celular === i ? 'celular' : mp.etiquetas === i ? 'etiquetas'
        : mp.rut === i ? 'rut' : mp.comuna === i ? 'comuna' : mp.sub === i ? 'suscripción' : mp.estatus === i ? 'estado'
        : mp.plan === i ? 'plan' : mp.monto === i ? 'monto' : mp.ultima === i ? 'último cobro' : mp.canal === i ? 'canal' : mp.fecha === i ? 'fecha' : '';
      return '<th>' + esc(h) + (papel ? '<div class="pill crim" style="margin-top:3px">' + papel + '</div>' : '') + '</th>';
    }).join('');
    var muestra = imp.filas.slice(0, 3).map(function (f) {
      return '<tr>' + f.map(function (v) { return '<td class="dim">' + esc(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<div class="card" style="margin-bottom:12px;border-color:var(--crim)">' +
      '<div class="cab" style="margin-bottom:8px"><h3>Importar ' + imp.filas.length + ' filas' +
      (imp.mapa.tipo === 'payku' ? ' · export de Payku (suscripciones del club)' : imp.mapa.tipo === 'pat' ? ' · cartola Transbank (socios PAT por RUT)' : '') + '</h3><div class="sp">' +
      '<button class="btn sec mini" id="utwi-cancelar-import">Cancelar</button>' +
      '<button class="btn mini" id="utwi-confirmar-import"' + (S.ocupado ? ' disabled' : '') + '>' +
      (S.ocupado ? 'Importando ' + S.progreso : 'Importar') + '</button></div></div>' +
      '<div class="scroll" style="max-height:180px"><table class="tabla"><thead><tr>' + cab + '</tr></thead><tbody>' + muestra + '</tbody></table></div>' +
      '<p class="ayuda">Reconocemos las columnas por su nombre. Las filas sin correo ni celular válido se saltan; los repetidos se fusionan con el contacto que ya existe.</p></div>';
  }

  function fichaContacto() {
    var c = S.ficha;
    var mensajes = (c.mensajes || []).map(function (m) {
      var icono = m.canal === 'correo' ? '✉️ ' : m.canal === 'whatsapp' ? '💬 ' : '🍷 ';
      return '<div class="dato"><span>' + icono + esc((m.titulo || '').slice(0, 42)) + '</span><b class="mini">' + fecha(m.creado) + (m.canal === 'club' ? '' : ' · ' + esc(m.estado)) + '</b></div>';
    }).join('') || '<p class="mini">Todavía no le hemos escrito.</p>';

    return '<div class="velo" id="utwi-velo"></div><div class="ficha">' +
      '<div class="cab"><h1>' + esc(c.nombre || '(sin nombre)') + '</h1><div class="sp">' +
      '<button class="btn sec mini" id="utwi-cerrar-ficha">Cerrar</button></div></div>' +
      '<label class="lbl">Nombre</label><input id="utwi-f-nombre" value="' + esc(c.nombre) + '">' +
      '<label class="lbl">Correo</label><input id="utwi-f-email" value="' + esc(c.email || '') + '" inputmode="email">' +
      '<label class="lbl">Celular</label><input id="utwi-f-celular" value="' + esc(c.celular || '') + '" inputmode="tel">' +
      '<div class="grid g2"><div><label class="lbl">RUT</label><input id="utwi-f-rut" value="' + esc(c.rut || '') + '" placeholder="12345678-9"></div>' +
      '<div><label class="lbl">Comuna</label><input id="utwi-f-comuna" value="' + esc(c.comuna || '') + '"></div></div>' +
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
      (c.club_estado ? '<h3 style="margin-top:20px">Club</h3>' +
        '<div class="dato"><span>Estado</span><b>' + pillClub(c).split('<div')[0] + '</b></div>' +
        '<div class="dato"><span>Plan</span><b>' + esc(c.club_plan || '—') + (c.club_monto ? ' · ' + plata(c.club_monto) : '') + '</b></div>' +
        '<div class="dato"><span>Canal de cobro</span><b>' + esc(c.club_canal || '—') + '</b></div>' +
        '<div class="dato"><span>Socio desde</span><b>' + (fecha(c.club_alta) || '—') + '</b></div>' +
        '<div class="dato"><span>Último cobro</span><b>' + (fecha(c.club_ultimo_pago) || '—') + '</b></div>' +
        (c.club_baja ? '<div class="dato"><span>Baja</span><b>' + fecha(c.club_baja) + '</b></div>' : '') +
        ((c.membresias || []).length > 1 ? '<p class="mini" style="margin-top:6px">Tiene ' + c.membresias.length + ' suscripciones registradas: ' +
          c.membresias.map(function (m) { return esc(m.canal) + ' (' + ESTADO_CLUB[m.estado] + ')'; }).join(', ') + '</p>' : '')
        : '') +
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

  // ---------- Panel de destinatarios ----------
  function panelDestinatarios() {
    var pk = S.picker, set = elegidosSet(), todos = pk.todos || [];
    var n = Object.keys(set).length;
    var q = (pk.q || '').toLowerCase().trim();

    // grupos por etiqueta y por estado del club, con sus ids
    var porEtiqueta = {}, porClub = {};
    todos.forEach(function (c) {
      (c.etiquetas || []).forEach(function (e) { (porEtiqueta[e] = porEtiqueta[e] || []).push(c.id); });
      if (c.club_estado) (porClub[c.club_estado] = porClub[c.club_estado] || []).push(c.id);
    });
    var fila = function (clave, nombre, ids, etiqueta) {
      var todosIn = ids.every(function (id) { return set[id]; });
      var algunos = !todosIn && ids.some(function (id) { return set[id]; });
      return '<div class="grupo"><input type="checkbox" data-grupo="' + clave + '"' + (todosIn ? ' checked' : '') + ' aria-label="' + esc(nombre) + '">' +
        (etiqueta ? tag(nombre) : '<b>' + esc(nombre) + '</b>') + '<span class="n">' + ids.length + (algunos ? ' · algunos' : '') + '</span></div>';
    };
    var grupos = Object.keys(porEtiqueta).sort().map(function (e) { return fila('etiqueta:' + e, e, porEtiqueta[e], true); }).join('') ||
      '<p class="mini">Sin etiquetas todavía.</p>';
    var club = ['al_dia', 'moroso', 'inactivo', 'baja'].filter(function (k) { return porClub[k]; })
      .map(function (k) { return fila('club:' + k, ESTADO_CLUB[k], porClub[k]); }).join('') || '<p class="mini">Sin socios del club sincronizados.</p>';

    var visibles = todos.filter(function (c) {
      return !q || (c.nombre || '').toLowerCase().indexOf(q) !== -1 || (c.email || '').toLowerCase().indexOf(q) !== -1 || (c.celular || '').indexOf(q) !== -1;
    });
    var lista = visibles.slice(0, 200).map(function (c) {
      var sinCanal = S.campana.canal === 'correo' ? !c.email : !fonoWhatsApp(c.celular);
      return '<div class="grupo"><input type="checkbox" data-pk-id="' + c.id + '"' + (set[c.id] ? ' checked' : '') + ' aria-label="' + esc(c.nombre) + '">' +
        '<div style="flex:1;min-width:0"><div>' + esc(c.nombre || '(sin nombre)') + (c.club_estado ? ' <span class="mini">· ' + ESTADO_CLUB[c.club_estado] + '</span>' : '') + '</div>' +
        '<div class="mini">' + esc([c.email, c.celular].filter(Boolean).join(' · ')) + (sinCanal ? ' · <span class="err">sin ' + (S.campana.canal === 'correo' ? 'correo' : 'celular') + '</span>' : '') + '</div></div>' +
        ((c.etiquetas || []).slice(0, 2).map(function (e) { return tag(e); }).join('')) + '</div>';
    }).join('') + (visibles.length > 200 ? '<p class="mini">…y ' + (visibles.length - 200) + ' más: afina la búsqueda.</p>' : '');

    return '<div class="velo" id="utwi-velo-pk"></div><div class="ficha ancha">' +
      '<div class="cab"><h1>Destinatarios · ' + n + '</h1><div class="sp"><button class="btn mini" id="utwi-pk-listo">Listo</button></div></div>' +
      (pk.cargando ? '<p class="dim">Cargando contactos…</p>' :
      '<h3>Por etiqueta</h3><p class="mini" style="margin:2px 0 6px">Marca una etiqueta para agregar a todos los que la tienen.</p>' + grupos +
      '<h3 style="margin-top:18px">Por estado en el club</h3>' + club +
      '<h3 style="margin-top:18px">Uno por uno</h3>' +
      '<input id="utwi-pk-buscar" placeholder="Buscar por nombre, correo o celular" value="' + esc(pk.q || '') + '" style="margin:8px 0 4px">' +
      '<div class="row" style="margin:6px 0"><button class="btn sec mini" id="utwi-pk-visibles">Marcar los ' + Math.min(visibles.length, 200) + ' visibles</button>' +
      '<button class="btn sec mini" id="utwi-pk-limpiar">Quitar todos</button></div>' + lista) +
      '<div class="pie"><b>' + n + ' elegidos</b><span class="dim">' + (S.campana.canal === 'correo' ? 'reciben los que tienen correo' : 'reciben los que tienen celular') + '</span>' +
      '<button class="btn" id="utwi-pk-listo2" style="margin-left:auto">Listo</button></div></div>';
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
    if (nSel) completarNombres(c.destinatarios);

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

      '<label class="lbl">Destinatarios</label>' +
      '<div class="row"><button class="btn sec" id="utwi-elegir">Elegir destinatarios</button>' +
      '<span class="dim">' + (c.segmento_id
        ? 'segmento guardado: <b>' + esc((S.segmentos.filter(function (x) { return String(x.id) === String(c.segmento_id); })[0] || {}).nombre || '') + '</b>'
        : nSel ? '<b>' + nSel + '</b> contacto(s) elegidos a mano' : 'nadie todavía') + '</span></div>' +
      (nSel && !c.segmento_id ? '<div style="margin-top:6px">' + c.destinatarios.map(function (id) {
        return '<span class="tag">' + esc(S.nombres[id] || '…') + '<button data-quita-dest="' + id + '" aria-label="Quitar">×</button></span>';
      }).join('') + '</div>' : '') +
      (S.segmentos.length ? '<select id="utwi-destinatarios" style="margin-top:8px"><option value="">…o usar un segmento guardado</option>' + opcionesSeg + '</select>' : '') +

      (esCorreo ? '<label class="lbl" for="utwi-asunto">Asunto</label>' +
        '<input id="utwi-asunto" value="' + esc(c.asunto || '') + '" placeholder="Lo nuevo en Up to Wine, {nombre}">' : '') +

      '<label class="lbl" for="utwi-cuerpo">Mensaje</label>' +
      (esCorreo ? '<div class="barra">' +
        '<button data-marca="titulo">Título</button><button data-marca="negrita">Negrita</button>' +
        '<button data-marca="lista">Lista</button><button data-marca="enlace">Enlace</button>' +
        '<button data-marca="boton">Botón</button><button data-marca="imagen">Imagen</button>' +
        '<button data-marca="separador">Separador</button><button data-marca="nombre">{nombre}</button></div>' : '') +
      '<textarea id="utwi-cuerpo" placeholder="' + (esCorreo ? 'Escribe el correo…' : 'Mensaje corto, como lo escribirías tú por WhatsApp.') + '">' + esc(c.cuerpo) + '</textarea>' +
      '<p class="ayuda">Variables: <code>{nombre}</code> <code>{comuna}</code> <code>{email}</code> <code>{celular}</code> <code>{plan}</code> <code>{mes}</code>' +
      (esCorreo ? ' · Formato: <code>## Título</code> <code>**negrita**</code> <code>- lista</code> <code>[texto](url)</code> <code>[[Botón|url]]</code> <code>![foto](url)</code>' : ' · Por WhatsApp el título va en *negrita*, las listas con viñeta y el botón como enlace: la vista previa muestra cómo queda. Un enlace en su propia línea sale con la tarjeta de la página (imagen y título). Con PDF adjunto, el texto sale como leyenda del documento.') + '</p>' +

      (esCorreo ? '<label class="lbl">Adjuntos (PDF o imagen, hasta ' + MAX_ADJUNTOS + ')</label>' +
        '<input type="file" id="utwi-archivo" accept="application/pdf,image/*" multiple>'
        : '<label class="lbl">PDF adjunto (uno; va como documento y el mensaje como leyenda)</label>' +
        '<input type="file" id="utwi-archivo" accept="application/pdf">') +
      (adjuntos ? '<div style="margin-top:8px">' + adjuntos + '</div>' : '') +

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
      var texto = esc(textoWhatsApp(personalizar(S.campana.cuerpo || 'Escribe el mensaje…', quien)))
        .replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/\n/g, '<br>');
      var doc = S.adjuntos[0]
        ? '<div style="display:flex;align-items:center;gap:10px;margin:-3px -5px 8px;padding:10px 12px;border-radius:9px;background:rgba(0,0,0,.18)">' +
          '<span style="font-size:26px">📄</span><div><div style="font-weight:600;font-size:14px">' + esc(S.adjuntos[0].nombre) + '</div>' +
          '<div style="font-size:11.5px;opacity:.7">' + Math.round(S.adjuntos[0].bytes / 1024) + ' KB · PDF</div></div></div>'
        : '';
      marco.srcdoc = '<!doctype html><html lang="es"><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;background:#0b141a;font-family:Helvetica,Arial,sans-serif;padding:18px">' +
        '<div style="max-width:420px;margin:0 auto"><div style="background:#005c4b;color:#fff;border-radius:12px 12px 4px 12px;padding:11px 13px;font-size:15px;line-height:1.5">' +
        doc + texto + '<div style="text-align:right;font-size:10.5px;color:rgba(255,255,255,.65);margin-top:5px">' +
        new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + ' ✓✓</div></div>' +
        '<p style="color:rgba(255,255,255,.45);font-size:11.5px;margin-top:14px">' + textoWhatsApp(S.campana.cuerpo || '').length + ' caracteres</p></div></body></html>';
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
          if (mapa.tipo === 'contactos' && mapa.email < 0 && mapa.celular < 0 && mapa.rut < 0) return aviso('El CSV necesita una columna de correo, celular o RUT.', 'err');
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
        celular: $('utwi-f-celular').value || null, rut: rutNormalizar($('utwi-f-rut').value) || null,
        comuna: $('utwi-f-comuna').value || null, notas: $('utwi-f-notas').value }, S.ficha.id);
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
      S.campana.segmento_id = this.value ? Number(this.value) : null;
      if (this.value) S.campana.destinatarios = [];
      S.confirmar = false; pintar();
    };
    if ($('utwi-elegir')) $('utwi-elegir').onclick = abrirPicker;
    if (S.picker) {
      var cerrarPk = function () { S.picker = null; pintar(); refrescarPrevia(); };
      ['utwi-velo-pk', 'utwi-pk-listo', 'utwi-pk-listo2'].forEach(function (id) { if ($(id)) $(id).onclick = cerrarPk; });
      var pkBuscar = $('utwi-pk-buscar');
      if (pkBuscar) pkBuscar.oninput = function () { clearTimeout(reloj); reloj = setTimeout(function () { S.picker.q = pkBuscar.value; pintar(); }, 250); };
      cada('[data-grupo]', function (cb) {
        cb.onchange = function () {
          var partes = cb.getAttribute('data-grupo').split(':'), tipo = partes[0], valor = partes.slice(1).join(':');
          var ids = S.picker.todos.filter(function (c) {
            return tipo === 'etiqueta' ? (c.etiquetas || []).indexOf(valor) !== -1 : c.club_estado === valor;
          }).map(function (c) { return c.id; });
          var set = elegidosSet();
          ids.forEach(function (id) { set[id] = cb.checked; });
          fijarDestinatarios(set); pintar();
        };
      });
      cada('[data-pk-id]', function (cb) {
        cb.onchange = function () { var set = elegidosSet(); set[cb.getAttribute('data-pk-id')] = cb.checked; fijarDestinatarios(set); pintar(); };
      });
      if ($('utwi-pk-visibles')) $('utwi-pk-visibles').onclick = function () {
        var q = (S.picker.q || '').toLowerCase().trim();
        var ids = S.picker.todos.filter(function (c) {
          return !q || (c.nombre || '').toLowerCase().indexOf(q) !== -1 || (c.email || '').toLowerCase().indexOf(q) !== -1 || (c.celular || '').indexOf(q) !== -1;
        }).slice(0, 200).map(function (c) { return c.id; });
        var set = elegidosSet(); ids.forEach(function (id) { set[id] = true; }); fijarDestinatarios(set); pintar();
      };
      if ($('utwi-pk-limpiar')) $('utwi-pk-limpiar').onclick = function () { fijarDestinatarios({}); pintar(); };
    }
    if ($('utwi-guardar-campana')) $('utwi-guardar-campana').onclick = function () { guardarCampana(); };
    if ($('utwi-prueba')) $('utwi-prueba').onclick = enviarPrueba;
    if ($('utwi-enviar')) $('utwi-enviar').onclick = function () {
      if (S.confirmar) enviarCampana(); else { S.confirmar = true; pintar(); }
    };
    if ($('utwi-archivo')) $('utwi-archivo').onchange = function () { sumarAdjuntos(this.files); this.value = ''; };
    cada('[data-quita-dest]', function (b) {
      b.onclick = function () {
        var set = elegidosSet(); delete set[b.getAttribute('data-quita-dest')]; fijarDestinatarios(set); pintar();
      };
    });
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
