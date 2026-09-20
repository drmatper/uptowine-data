/* Intranet Up to Wine — CRM propio: contactos, correos y WhatsApp.
 *
 * Se sirve desde https://app.uptowine.cl/intranet.js y lo carga un bloque de tres
 * líneas en el tema de Jumpseller (página uptowine.cl/intranet). Editar aquí y
 * publicar con `bash deploy-intranet.sh`: nada de pegar código en el admin.
 *
 * Entra solo quien tenga sesión de Supabase y profiles.admin = true; sin eso la
 * base no devuelve nada (RLS) y la función 'intranet' responde 403. La llave de
 * abajo es la ANON, pública por diseño: las de verdad (Resend, service role)
 * viven en el servidor.
 */
(function () {
  'use strict';

  var AQUI = typeof document !== 'undefined' ? document.currentScript : null;  // el bloque, en su lugar de la página
  var SB_URL = 'https://oontbdybvewvziamwfcn.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbnRiZHlidmV3dnppYW13ZmNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0MTA2MjEsImV4cCI6MjA5OTk4NjYyMX0.tk951I0-1LTCBI7RJGAfZyjB99tHuhY_VgLhdnSLlfw';
  var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
  var LOGO = 'https://app.uptowine.cl/og-logo.png';
  var MAX_ADJUNTO = 8 * 1024 * 1024;   // el mismo tope que valida la función
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

  // Todo lo que viene de la base se pinta escapado: los nombres los escriben
  // clientes y no son HTML.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Variables del mensaje. {nombre} es el de pila; el resto, tal cual.
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
    var d = new Date(iso);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Marcado de la intranet → HTML del correo. Se escapa ANTES de marcar, así que
  // nada de lo que se escriba puede inyectar etiquetas.
  //   ## titulo      **negrita**     *cursiva*
  //   - lista        [texto](url)    ![alt](url)
  //   [[Boton|url]]  (botón grande, centrado)
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

  // El correo completo, con la marca. Tablas y estilos en línea: es lo único que
  // respetan Gmail, Outlook y compañía.
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

  // Versión en texto plano (los clientes de correo la usan como respaldo y ayuda
  // a no caer en spam).
  function correoTexto(texto, contacto) {
    return personalizar(texto, contacto)
      .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$1: $2')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/!\[[^\]]*\]\(([^)]+)\)/g, '')
      .replace(/^##\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim() + '\n\n—\nUp to Wine · uptowine.cl · ventas@uptowine.cl\nResponde con la palabra BAJA para no recibir más correos.';
  }

  if (typeof module !== 'undefined' && module.exports) {   // solo para los tests
    module.exports = { fonoWhatsApp: fonoWhatsApp, esc: esc, personalizar: personalizar,
      plata: plata, cuerpoHtml: cuerpoHtml, correoHtml: correoHtml, correoTexto: correoTexto,
      enlaceSeguro: enlaceSeguro };
    return;
  }

  // ==========================================================================
  // 2) Estado y estilos
  // ==========================================================================

  var sb = null;
  var S = {
    sesion: null, admin: false, listo: false,
    vista: 'contactos',                 // contactos | redactar | plantillas | historial
    contactos: [], q: '', origen: '', sel: {},
    canal: 'correo',
    asunto: '', cuerpo: '', adjuntos: [], plantillaId: null,
    plantillas: [], historial: [],
    cola: null, msj: '', err: false, ocupado: false, confirmar: false, progreso: '',
  };

  var CSS = [
    '@import url("https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800&family=Jost:wght@400;500;600&display=swap");',
    '.utwi{--bg:#0A0708;--surf:#140E10;--surf2:#171013;--crim:#E2123F;--crimT:#F1315B;--gold:#E0B450;--tx:#fff;--body:rgba(255,255,255,.70);--dim:rgba(255,255,255,.55);--bd:rgba(255,255,255,.16);--hair:rgba(255,255,255,.10);',
    '  width:min(1240px,calc(100% - 20px));margin:26px auto;padding:clamp(16px,2.4vw,30px);color:var(--tx);font-family:"Jost",Arial,sans-serif;-webkit-font-smoothing:antialiased;background:var(--bg);border:1px solid var(--hair);border-radius:22px;box-shadow:0 26px 70px rgba(0,0,0,.3)}',
    '.utwi *{box-sizing:border-box}',
    '.utwi h2{margin:8px 0 0;color:var(--tx)!important;font-family:"Archivo",sans-serif;font-weight:800;font-size:clamp(26px,3.4vw,38px);line-height:1;letter-spacing:-1px;text-transform:uppercase}',
    '.utwi .kick{display:inline-flex;align-items:center;gap:8px;font-family:"Archivo",sans-serif;font-weight:700;font-size:10.5px;letter-spacing:2.4px;text-transform:uppercase;color:var(--crimT)}',
    '.utwi .kick:before{content:"";width:20px;height:1px;background:var(--crim)}',
    '.utwi label,.utwi .eyebrow{display:block;margin:14px 0 6px;font-family:"Archivo",sans-serif;font-weight:700;font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:var(--gold)}',
    '.utwi .eyebrow{margin:0}',
    '.utwi input,.utwi textarea,.utwi select{width:100%;padding:11px 13px;border:1px solid var(--bd);border-radius:12px;background:var(--surf2);color:var(--tx);font-family:"Jost",sans-serif;font-size:15px}',
    '.utwi input:focus,.utwi textarea:focus,.utwi select:focus{outline:none;border-color:var(--crim)}',
    '.utwi textarea{min-height:230px;resize:vertical;line-height:1.55;font-size:14.5px}',
    '.utwi .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 20px;border:0;border-radius:999px;background:var(--crim);color:#fff;cursor:pointer;font-family:"Archivo",sans-serif;font-weight:700;font-size:11.5px;letter-spacing:1.1px;text-transform:uppercase;box-shadow:0 10px 24px rgba(226,18,63,.32)}',
    '.utwi .btn[disabled]{opacity:.4;cursor:not-allowed;box-shadow:none}',
    '.utwi .btn.ghost{background:transparent;border:1px solid var(--bd);box-shadow:none;color:var(--body)}',
    '.utwi .btn.warn{background:#8A0F2A}',
    '.utwi .btn.mini{padding:7px 13px;font-size:9.5px}',
    '.utwi .tabs{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0 4px;border-bottom:1px solid var(--hair);padding-bottom:12px}',
    '.utwi .tab{padding:9px 16px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--dim);cursor:pointer;font-family:"Archivo",sans-serif;font-weight:700;font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase}',
    '.utwi .tab.on{background:#fff;color:#0A0708}',
    '.utwi .tab .n{opacity:.6;margin-left:6px}',
    '.utwi .box{margin-top:16px;padding:16px;border:1px solid var(--bd);border-radius:18px;background:var(--surf)}',
    '.utwi .row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}',
    '.utwi .row.sp{justify-content:space-between}',
    '.utwi .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}',
    '.utwi .chip{padding:7px 13px;border:1px solid var(--hair);border-radius:999px;background:var(--surf2);color:var(--body);cursor:pointer;font-family:"Archivo",sans-serif;font-weight:700;font-size:9.5px;letter-spacing:1.1px;text-transform:uppercase}',
    '.utwi .chip.on{background:#fff;border-color:#fff;color:#0A0708}',
    '.utwi .lista{max-height:430px;overflow:auto;margin-top:10px}',
    '.utwi .ct{display:flex;align-items:center;gap:11px;padding:10px 6px;border-top:1px solid var(--hair);cursor:pointer}',
    '.utwi .ct:hover{background:rgba(255,255,255,.03)}',
    '.utwi .ct.on{background:rgba(226,18,63,.10)}',
    '.utwi .ct input{width:17px;height:17px;flex:0 0 auto;accent-color:var(--crim)}',
    '.utwi .ct b{display:block;font-family:"Archivo",sans-serif;font-weight:600;font-size:13.5px}',
    '.utwi .ct small,.utwi .dim{display:block;color:var(--dim);font-size:12.5px}',
    '.utwi .tag{display:inline-block;margin-top:3px;margin-right:6px;font-family:"Archivo",sans-serif;font-weight:700;font-size:8.5px;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold)}',
    '.utwi .msj{margin:10px 0 0;min-height:18px;color:var(--gold);font-size:13.5px}',
    '.utwi .err{color:var(--crimT)}',
    '.utwi .ok{color:#7FCB9A}',
    '.utwi .ayuda{margin:8px 0 0;color:var(--dim);font-size:12px;line-height:1.7}',
    '.utwi .ayuda code{background:var(--surf2);border:1px solid var(--hair);border-radius:5px;padding:1px 5px;font-size:11.5px;color:var(--body)}',
    '.utwi .previa{width:100%;height:520px;border:1px solid var(--bd);border-radius:14px;background:#f4efec}',
    '.utwi .adj{display:flex;align-items:center;gap:8px;margin-top:6px;padding:8px 11px;border:1px solid var(--hair);border-radius:10px;background:var(--surf2);font-size:12.5px;color:var(--body)}',
    '.utwi .x{margin-left:auto;border:0;background:transparent;color:var(--crimT);cursor:pointer;font-size:16px;line-height:1}',
    '.utwi .pl{display:flex;align-items:center;gap:10px;padding:11px 6px;border-top:1px solid var(--hair)}',
    '.utwi .pl b{font-family:"Archivo",sans-serif;font-weight:600;font-size:13.5px}',
    '@media(max-width:900px){.utwi .cols{grid-template-columns:1fr}.utwi{padding:14px;border-radius:16px}.utwi .previa{height:420px}}',
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
  host.innerHTML = '<div class="utwi"><span class="kick">Up to Wine &middot; uso interno</span><h2>Intranet</h2><p class="dim" style="margin-top:14px">Cargando&hellip;</p></div>';

  var cdn = document.createElement('script');
  cdn.src = CDN;
  cdn.onerror = function () {
    host.innerHTML = '<div class="utwi"><p class="msj err">No se pudo cargar la librería de la base de datos. Recarga la página.</p></div>';
  };
  cdn.onload = function () {
    sb = window.supabase.createClient(SB_URL, SB_ANON, { auth: { persistSession: true, autoRefreshToken: true } });
    sb.auth.getSession().then(function (r) { entrar(r.data.session); });
    sb.auth.onAuthStateChange(function (_e, ses) { entrar(ses); });
  };
  document.head.appendChild(cdn);

  function entrar(sesion) {
    S.sesion = sesion;
    S.listo = true;
    if (!sesion) { S.admin = false; pintar(); return; }
    sb.from('profiles').select('admin').eq('id', sesion.user.id).maybeSingle().then(function (r) {
      S.admin = !!(r.data && r.data.admin);
      pintar();
      if (S.admin) { cargarContactos(); cargarPlantillas(); cargarCola(); }
    });
  }

  function aviso(t, tipo) { S.msj = t; S.err = tipo === 'err'; pintar(); }

  // ==========================================================================
  // 4) Datos
  // ==========================================================================

  function cargarContactos() {
    var sel = sb.from('contactos')
      .select('id,nombre,email,celular,origen,etiquetas,n_pedidos,total_gastado,ultima_compra,baja')
      .order('actualizado', { ascending: false }).limit(400);
    if (S.q.trim()) sel = sel.or('nombre.ilike.%' + S.q.trim() + '%,email.ilike.%' + S.q.trim() + '%,celular.ilike.%' + S.q.trim() + '%');
    if (S.origen) sel = sel.contains('origen', [S.origen]);
    return sel.then(function (r) {
      if (r.error) return aviso('No pudimos leer los contactos: ' + r.error.message, 'err');
      S.contactos = r.data || []; pintar();
    });
  }

  function cargarPlantillas() {
    return sb.from('plantillas').select('*').eq('archivada', false).order('nombre').then(function (r) {
      S.plantillas = r.error ? [] : (r.data || []);
      pintar();
    });
  }

  function cargarHistorial() {
    return sb.from('crm_mensajes').select('*').order('creado', { ascending: false }).limit(120).then(function (r) {
      S.historial = r.error ? [] : (r.data || []);
      pintar();
    });
  }

  function cargarCola() {
    return sb.from('whatsapp_outbox').select('estado').order('id', { ascending: false }).limit(200).then(function (r) {
      var f = r.data || [], n = function (e) { return f.filter(function (x) { return x.estado === e; }).length; };
      S.cola = { pendientes: n('pendiente'), encolados: n('encolado'), enviados: n('enviado'), fallidos: n('fallido') + n('rechazado') };
      pintar();
    });
  }

  function elegidos() { return S.contactos.filter(function (c) { return S.sel[c.id] && !c.baja; }); }
  function alcanzables() {
    return elegidos().filter(function (c) { return S.canal === 'correo' ? c.email : fonoWhatsApp(c.celular); });
  }

  function sincronizar() {
    S.ocupado = true; aviso('Sincronizando con la tienda…');
    sb.functions.invoke('intranet', { body: { accion: 'crm-sync' } }).then(function (r) {
      S.ocupado = false;
      var d = r.data || {};
      if (r.error || !d.ok) return aviso(d.error || (r.error && r.error.message) || 'No se pudo sincronizar.', 'err');
      aviso('Tienda: ' + d.jumpseller + ' · socios: ' + d.socios + ' · con compras: ' + (d.con_compras || 0));
      cargarContactos();
    });
  }

  function guardarPlantilla(nombre) {
    var fila = { nombre: nombre, canal: S.canal, asunto: S.canal === 'correo' ? S.asunto : null, cuerpo: S.cuerpo, actualizado: new Date().toISOString() };
    var p = S.plantillaId
      ? sb.from('plantillas').update(fila).eq('id', S.plantillaId)
      : sb.from('plantillas').insert(fila);
    return p.then(function (r) {
      if (r.error) return aviso(/duplicate|unique/i.test(r.error.message) ? 'Ya existe una plantilla con ese nombre en este canal.' : r.error.message, 'err');
      aviso('Plantilla guardada ✓');
      cargarPlantillas();
    });
  }

  function borrarPlantilla(id) {
    return sb.from('plantillas').update({ archivada: true }).eq('id', id).then(function (r) {
      if (r.error) return aviso(r.error.message, 'err');
      if (S.plantillaId === id) S.plantillaId = null;
      aviso('Plantilla archivada.');
      cargarPlantillas();
    });
  }

  // Envío en lote: uno por uno, con el nombre de cada quien y un ritmo tranquilo.
  function enviar() {
    var lista = alcanzables(), i = 0, ok = 0, fallos = [];
    S.confirmar = false; S.ocupado = true; S.progreso = '0/' + lista.length; pintar();

    function siguiente() {
      if (i >= lista.length) {
        S.ocupado = false; S.progreso = ''; S.sel = {};
        aviso(S.canal === 'correo'
          ? ok + ' correo(s) enviado(s).' + (fallos.length ? ' Fallaron: ' + fallos.join(' · ') : '')
          : ok + ' mensaje(s) en la cola — el bot los manda con su propio ritmo.' + (fallos.length ? ' Quedaron fuera: ' + fallos.join(' · ') : ''),
          fallos.length ? 'err' : 'ok');
        cargarCola();
        return;
      }
      var c = lista[i++];
      S.progreso = i + '/' + lista.length; pintar();
      var p;
      if (S.canal === 'correo') {
        p = sb.functions.invoke('intranet', { body: {
          accion: 'correo', para: c.email, asunto: personalizar(S.asunto, c),
          html: correoHtml(S.cuerpo, c), texto: correoTexto(S.cuerpo, c),
          adjuntos: S.adjuntos.map(function (a) { return { filename: a.nombre, content: a.base64 }; }),
          contacto_id: c.id } })
          .then(function (r) { return (r.data && r.data.ok) ? null : ((r.data && r.data.error) || (r.error && r.error.message) || 'falló el envío'); });
      } else {
        // La tienda nunca habla con el VPS: deja la fila y el puente sale a buscarla.
        p = sb.from('whatsapp_outbox').insert({
          numero: fonoWhatsApp(c.celular), nombre: c.nombre || '?',
          texto: personalizar(S.cuerpo, c), contacto_id: c.id, por: 'intranet',
        }).then(function (r) { return r.error ? r.error.message : null; });
      }
      p.then(function (error) {
        if (error) fallos.push((c.nombre || c.email || c.celular) + ': ' + error); else ok++;
        setTimeout(siguiente, S.canal === 'correo' ? 600 : 0);   // Resend: 2 por segundo en el plan gratis
      });
    }
    siguiente();
  }

  // ==========================================================================
  // 5) Vistas
  // ==========================================================================

  function pintar() {
    if (!S.listo) return;
    if (!S.sesion) return vistaLogin();
    if (!S.admin) {
      host.innerHTML = '<div class="utwi"><span class="kick">Acceso restringido</span><h2>Solo administración</h2>' +
        '<p class="dim" style="margin-top:12px">Esta sección es para el equipo de Up to Wine.</p>' +
        '<div class="row" style="margin-top:16px"><button class="btn ghost" id="utwi-salir">Salir</button></div></div>';
      document.getElementById('utwi-salir').onclick = function () { sb.auth.signOut(); };
      return;
    }
    vistaPanel();
  }

  function vistaLogin() {
    host.innerHTML = '<div class="utwi"><span class="kick">Up to Wine &middot; uso interno</span><h2>Intranet</h2>' +
      '<form class="box" id="utwi-login" style="max-width:420px">' +
      '<label for="utwi-email">Correo</label><input id="utwi-email" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="utwi-clave">Contraseña</label><input id="utwi-clave" type="password" autocomplete="current-password" required>' +
      '<div class="row" style="margin-top:18px"><button class="btn" type="submit" id="utwi-entrar">Entrar</button></div>' +
      '<p class="msj" id="utwi-login-msj"></p></form></div>';
    var email = document.getElementById('utwi-email'), clave = document.getElementById('utwi-clave');
    var boton = document.getElementById('utwi-entrar'), salida = document.getElementById('utwi-login-msj');
    document.getElementById('utwi-login').onsubmit = function (ev) {
      ev.preventDefault();
      boton.disabled = true; salida.className = 'msj'; salida.textContent = 'Entrando…';
      sb.auth.signInWithPassword({ email: email.value.trim(), password: clave.value }).then(function (r) {
        boton.disabled = false;
        // el error se escribe en su nodo, no repintando: no se pierde lo tecleado
        if (r.error) { salida.className = 'msj err'; salida.textContent = 'No pudimos entrar: revisa el correo y la contraseña.'; }
      }, function () {
        boton.disabled = false;
        salida.className = 'msj err'; salida.textContent = 'Sin conexión con el servidor. Reintenta.';
      });
    };
  }

  var VISTAS = [['contactos', 'Contactos'], ['redactar', 'Redactar'], ['plantillas', 'Plantillas'], ['historial', 'Historial']];

  function vistaPanel() {
    var sel = elegidos();
    var tabs = VISTAS.map(function (v) {
      var n = v[0] === 'contactos' ? S.contactos.length : v[0] === 'plantillas' ? S.plantillas.length : 0;
      return '<button class="tab' + (S.vista === v[0] ? ' on' : '') + '" data-vista="' + v[0] + '">' + v[1] +
        (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('');

    host.innerHTML = '<div class="utwi">' +
      '<div class="row sp"><div><span class="kick">Up to Wine &middot; uso interno</span><h2>Intranet</h2></div>' +
      '<div class="row"><span class="dim">' + esc(S.sesion.user.email) + '</span>' +
      '<button class="btn ghost mini" id="utwi-salir">Salir</button></div></div>' +
      '<div class="tabs">' + tabs +
      '<span class="dim" style="margin-left:auto;align-self:center">' + sel.length + ' seleccionado(s)</span></div>' +
      '<p class="msj ' + (S.err ? 'err' : '') + '" id="utwi-msj">' + esc(S.msj) + '</p>' +
      (S.vista === 'contactos' ? panelContactos()
        : S.vista === 'redactar' ? panelRedactar()
        : S.vista === 'plantillas' ? panelPlantillas()
        : panelHistorial()) +
      '</div>';
    conectar();
    if (S.vista === 'redactar') refrescarPrevia();
  }

  // ---------- Contactos ----------
  function panelContactos() {
    var filtros = [['', 'Todos'], ['app', 'Socios'], ['jumpseller', 'Tienda'], ['manual', 'A mano']].map(function (f) {
      return '<button class="chip' + (S.origen === f[0] ? ' on' : '') + '" data-origen="' + f[0] + '">' + f[1] + '</button>';
    }).join('');

    var filas = S.contactos.map(function (c) {
      var datos = [c.email, c.celular].filter(Boolean).map(esc).join(' · ') || 'sin correo ni celular';
      var compras = c.n_pedidos ? ' · ' + c.n_pedidos + ' compra(s) ' + plata(c.total_gastado) : '';
      var ultima = c.ultima_compra ? ' · última ' + fecha(c.ultima_compra) : '';
      return '<div class="ct' + (S.sel[c.id] ? ' on' : '') + '" data-id="' + c.id + '">' +
        '<input type="checkbox"' + (S.sel[c.id] ? ' checked' : '') + ' aria-label="Seleccionar ' + esc(c.nombre || datos) + '">' +
        '<div style="flex:1;min-width:0"><b>' + esc(c.nombre || '(sin nombre)') + (c.baja ? ' <span class="err">· DE BAJA</span>' : '') + '</b>' +
        '<small>' + datos + esc(compras + ultima) + '</small>' +
        '<span class="tag">' + esc((c.origen || []).join(' + ')) + '</span></div>' +
        '<button class="chip" data-baja="' + c.id + '">' + (c.baja ? 'Reactivar' : 'Dar de baja') + '</button></div>';
    }).join('') || '<p class="dim" style="margin-top:14px">Sin contactos todavía: aprieta SINCRONIZAR.</p>';

    return '<div class="cols">' +
      '<div class="box"><div class="row sp"><span class="eyebrow">Contactos (' + S.contactos.length + ')</span>' +
      '<div class="row"><button class="btn ghost mini" id="utwi-todos">Marcar todos</button>' +
      '<button class="btn ghost mini" id="utwi-ninguno">Ninguno</button>' +
      '<button class="btn mini" id="utwi-sync"' + (S.ocupado ? ' disabled' : '') + '>Sincronizar</button></div></div>' +
      '<input id="utwi-buscar" placeholder="Buscar por nombre, correo o celular" value="' + esc(S.q) + '" style="margin-top:12px">' +
      '<div class="row" style="margin-top:10px">' + filtros + '</div>' +
      '<div class="lista">' + filas + '</div></div>' +

      '<div><div class="box"><span class="eyebrow">Agregar contacto</span>' +
      '<input id="utwi-n" placeholder="Nombre" style="margin-top:10px">' +
      '<input id="utwi-e" placeholder="Correo" inputmode="email" style="margin-top:8px">' +
      '<input id="utwi-t" placeholder="Celular (9 1234 5678)" inputmode="tel" style="margin-top:8px">' +
      '<div class="row" style="margin-top:12px"><button class="btn ghost" id="utwi-agregar">Guardar contacto</button></div></div>' +
      (S.cola ? '<div class="box"><span class="eyebrow">Cola de WhatsApp</span>' +
        '<p class="dim" style="margin-top:8px">' + S.cola.pendientes + ' por salir · ' + S.cola.encolados + ' en el bot · ' +
        S.cola.enviados + ' enviados · ' + S.cola.fallidos + ' con problema</p>' +
        (S.cola.pendientes > 0 && S.cola.encolados + S.cola.enviados === 0
          ? '<p class="msj err">Nada ha pasado al bot: revisa que el puente esté corriendo en el servidor.</p>' : '') +
        '</div>' : '') +
      '</div></div>';
  }

  // ---------- Redactar ----------
  function panelRedactar() {
    var sel = elegidos(), listos = alcanzables(), fuera = sel.length - listos.length;
    var esCorreo = S.canal === 'correo';
    var opciones = S.plantillas.filter(function (p) { return p.canal === S.canal; })
      .map(function (p) { return '<option value="' + p.id + '"' + (S.plantillaId === p.id ? ' selected' : '') + '>' + esc(p.nombre) + '</option>'; }).join('');

    var adjuntos = S.adjuntos.map(function (a, i) {
      return '<div class="adj">📎 ' + esc(a.nombre) + ' <span class="dim" style="display:inline">· ' + Math.round(a.bytes / 1024) + ' KB</span>' +
        '<button class="x" data-quita="' + i + '" aria-label="Quitar adjunto">×</button></div>';
    }).join('');

    return '<div class="cols">' +
      /* ---- columna izquierda: el mensaje ---- */
      '<div class="box">' +
      '<div class="row">' +
      '<button class="chip' + (esCorreo ? ' on' : '') + '" data-canal="correo">Correo</button>' +
      '<button class="chip' + (!esCorreo ? ' on' : '') + '" data-canal="whatsapp">WhatsApp</button>' +
      '<span class="dim" style="display:inline;margin-left:auto">' + listos.length + ' destinatario(s)</span></div>' +

      '<label for="utwi-plantilla">Plantilla</label>' +
      '<div class="row"><select id="utwi-plantilla" style="flex:1"><option value="">— sin plantilla —</option>' + opciones + '</select>' +
      '<button class="btn ghost mini" id="utwi-guardar-plantilla">Guardar</button></div>' +

      (esCorreo ? '<label for="utwi-asunto">Asunto</label><input id="utwi-asunto" value="' + esc(S.asunto) + '" placeholder="Lo nuevo en Up to Wine, {nombre}">' : '') +

      '<label for="utwi-cuerpo">Mensaje</label>' +
      '<textarea id="utwi-cuerpo" placeholder="' + (esCorreo ? 'Escribe aquí. Usa ## para un título, **negrita**, - para listas y [[Botón|https://…]] para el botón.' : 'Mensaje corto, como lo escribirías tú por WhatsApp.') + '">' + esc(S.cuerpo) + '</textarea>' +
      (esCorreo
        ? '<p class="ayuda"><code>{nombre}</code> <code>{comuna}</code> · <code>## Título</code> · <code>**negrita**</code> · <code>- lista</code> · <code>[texto](url)</code> · <code>[[Botón|url]]</code> · <code>![foto](url)</code></p>'
        : '<p class="ayuda"><code>{nombre}</code> <code>{comuna}</code> · sin formato: WhatsApp lo manda tal cual.</p>') +

      (esCorreo ? '<label>Adjuntos (PDF, hasta ' + MAX_ADJUNTOS + ')</label>' +
        '<input type="file" id="utwi-archivo" accept="application/pdf,image/*" multiple>' + adjuntos : '') +

      '<div class="row" style="margin-top:18px">' +
      '<button class="btn' + (S.confirmar ? ' warn' : '') + '" id="utwi-enviar"' +
        (S.ocupado || !listos.length || !S.cuerpo.trim() || (esCorreo && !S.asunto.trim()) ? ' disabled' : '') + '>' +
      (S.ocupado ? 'Enviando ' + S.progreso
        : S.confirmar ? 'Sí, ' + (esCorreo ? 'enviar' : 'encolar') + ' a ' + listos.length
        : (esCorreo ? 'Enviar correo' : 'Enviar WhatsApp') + ' a ' + listos.length) + '</button>' +
      (S.confirmar ? '<button class="btn ghost" id="utwi-cancelar">Cancelar</button>' : '') +
      '<button class="btn ghost mini" data-vista="contactos">Elegir destinatarios</button></div>' +
      (S.confirmar ? '<p class="dim" style="margin-top:8px">Toca otra vez para confirmar. No se puede deshacer.</p>' : '') +
      (fuera > 0 ? '<p class="msj err">' + fuera + ' sin ' + (esCorreo ? 'correo' : 'celular') + ': quedan fuera.</p>' : '') +
      '</div>' +

      /* ---- columna derecha: cómo lo recibe ---- */
      '<div class="box"><div class="row sp"><span class="eyebrow">Así lo recibe ' +
      esc(listos[0] ? (listos[0].nombre || listos[0].email || listos[0].celular) : 'el destinatario') + '</span>' +
      '<button class="btn ghost mini" id="utwi-refrescar">Actualizar</button></div>' +
      '<iframe class="previa" id="utwi-previa" title="Vista previa del mensaje" style="margin-top:10px"></iframe>' +
      '</div></div>';
  }

  var ejemploContacto = { nombre: 'María Soledad Rojas', email: 'cliente@ejemplo.cl', celular: '56912345678', comuna: 'Providencia' };

  function refrescarPrevia() {
    var marco = document.getElementById('utwi-previa');
    if (!marco) return;
    var quien = alcanzables()[0] || ejemploContacto;
    if (S.canal === 'correo') {
      marco.srcdoc = correoHtml(S.cuerpo || '_Escribe el mensaje y aquí lo verás tal cual le llega._', quien);
      return;
    }
    // WhatsApp: la burbuja, para ver largo y saltos de línea reales
    var texto = esc(personalizar(S.cuerpo || 'Escribe el mensaje…', quien)).replace(/\n/g, '<br>');
    marco.srcdoc = '<!doctype html><html lang="es"><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#0b141a;font-family:Helvetica,Arial,sans-serif;padding:18px">' +
      '<div style="max-width:420px;margin:0 auto">' +
      '<div style="background:#005c4b;color:#fff;border-radius:12px 12px 4px 12px;padding:11px 13px;font-size:15px;line-height:1.5;white-space:normal">' + texto +
      '<div style="text-align:right;font-size:10.5px;color:rgba(255,255,255,.65);margin-top:5px">' +
      new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) + ' ✓✓</div></div>' +
      '<p style="color:rgba(255,255,255,.45);font-size:11.5px;margin-top:14px">' +
      (S.cuerpo || '').length + ' caracteres · sale desde el número del bot</p></div></body></html>';
  }

  // ---------- Plantillas ----------
  function panelPlantillas() {
    var filas = S.plantillas.map(function (p) {
      return '<div class="pl"><div style="flex:1;min-width:0"><b>' + esc(p.nombre) + '</b>' +
        '<small class="dim">' + (p.canal === 'correo' ? 'Correo · ' + esc(p.asunto || '(sin asunto)') : 'WhatsApp') +
        ' · ' + fecha(p.actualizado) + '</small></div>' +
        '<button class="btn ghost mini" data-usar="' + p.id + '">Usar</button>' +
        '<button class="chip" data-borrar="' + p.id + '">Archivar</button></div>';
    }).join('') || '<p class="dim" style="margin-top:12px">Sin plantillas. Escribe un mensaje en Redactar y apriétale Guardar.</p>';

    return '<div class="box"><span class="eyebrow">Plantillas guardadas</span>' + filas +
      '<p class="ayuda">Las plantillas guardan asunto y cuerpo con sus variables. Al usarlas, cada destinatario recibe su propia versión.</p></div>';
  }

  // ---------- Historial ----------
  function panelHistorial() {
    var filas = S.historial.map(function (m) {
      var color = m.estado === 'enviado' ? 'ok' : (m.estado === 'fallido' || m.estado === 'rechazado') ? 'err' : 'dim';
      return '<div class="pl"><div style="flex:1;min-width:0"><b>' + (m.canal === 'correo' ? '✉️ ' : '💬 ') + esc(m.titulo || '(sin asunto)') + '</b>' +
        '<small class="dim">' + fecha(m.creado) + ' · contacto ' + (m.contacto_id || '—') + '</small></div>' +
        '<span class="' + color + '" style="font-size:12px">' + esc(m.estado) + '</span></div>';
    }).join('') || '<p class="dim" style="margin-top:12px">Todavía no se ha enviado nada desde la intranet.</p>';

    return '<div class="box"><div class="row sp"><span class="eyebrow">Últimos mensajes</span>' +
      '<button class="btn ghost mini" id="utwi-recargar-historial">Actualizar</button></div>' + filas + '</div>';
  }

  // ==========================================================================
  // 6) Eventos
  // ==========================================================================

  var $ = function (id) { return document.getElementById(id); };
  var cada = function (sel, fn) { Array.prototype.forEach.call(host.querySelectorAll(sel), fn); };
  var reloj = null;

  function conectar() {
    $('utwi-salir').onclick = function () { S.sel = {}; S.msj = ''; sb.auth.signOut(); };

    cada('[data-vista]', function (b) {
      b.onclick = function () {
        S.vista = b.getAttribute('data-vista'); S.confirmar = false;
        if (S.vista === 'historial') cargarHistorial(); else pintar();
      };
    });

    // ---- contactos ----
    var buscar = $('utwi-buscar');
    if (buscar) {
      buscar.oninput = function () { clearTimeout(reloj); reloj = setTimeout(function () { S.q = buscar.value; cargarContactos(); }, 350); };
      buscar.onkeydown = function (ev) { if (ev.key === 'Enter') { clearTimeout(reloj); S.q = buscar.value; cargarContactos(); } };
    }
    cada('[data-origen]', function (b) {
      b.onclick = function () { S.origen = b.getAttribute('data-origen'); cargarContactos(); };
    });
    cada('.ct', function (f) {
      f.onclick = function (ev) {
        if (ev.target.hasAttribute('data-baja')) return;
        var id = f.getAttribute('data-id');
        S.sel[id] = !S.sel[id]; S.confirmar = false; pintar();
      };
    });
    cada('[data-baja]', function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-baja');
        var c = S.contactos.filter(function (x) { return String(x.id) === String(id); })[0];
        sb.from('contactos').update({ baja: !c.baja, actualizado: new Date().toISOString() }).eq('id', id).then(cargarContactos);
      };
    });
    if ($('utwi-todos')) $('utwi-todos').onclick = function () {
      S.contactos.forEach(function (c) { if (!c.baja) S.sel[c.id] = true; }); pintar();
    };
    if ($('utwi-ninguno')) $('utwi-ninguno').onclick = function () { S.sel = {}; pintar(); };
    if ($('utwi-sync')) $('utwi-sync').onclick = sincronizar;
    if ($('utwi-agregar')) $('utwi-agregar').onclick = function () {
      sb.rpc('crm_guardar_contacto', {
        p_nombre: $('utwi-n').value, p_email: $('utwi-e').value || null,
        p_celular: $('utwi-t').value || null, p_origen: 'manual',
      }).then(function (r) {
        if (r.error) return aviso(r.error.message, 'err');
        if (!r.data) return aviso('Falta un correo o un celular válido.', 'err');
        aviso('Contacto guardado ✓'); cargarContactos();
      });
    };

    // ---- redactar ----
    cada('[data-canal]', function (b) {
      b.onclick = function () {
        S.canal = b.getAttribute('data-canal');
        S.confirmar = false; S.plantillaId = null; pintar();
      };
    });
    var asunto = $('utwi-asunto');
    if (asunto) asunto.oninput = function () { S.asunto = asunto.value; };
    var cuerpo = $('utwi-cuerpo');
    if (cuerpo) cuerpo.oninput = function () {
      S.cuerpo = cuerpo.value;                  // sin repintar: se perdería el cursor
      clearTimeout(reloj); reloj = setTimeout(refrescarPrevia, 450);
    };
    if ($('utwi-refrescar')) $('utwi-refrescar').onclick = refrescarPrevia;

    var plantilla = $('utwi-plantilla');
    if (plantilla) plantilla.onchange = function () { usarPlantilla(plantilla.value); };
    if ($('utwi-guardar-plantilla')) $('utwi-guardar-plantilla').onclick = function () {
      if (!S.cuerpo.trim()) return aviso('Escribe el mensaje antes de guardarlo como plantilla.', 'err');
      var actual = S.plantillas.filter(function (p) { return p.id === S.plantillaId; })[0];
      var nombre = window.prompt('Nombre de la plantilla', actual ? actual.nombre : '');
      if (!nombre || !nombre.trim()) return;
      if (actual && nombre.trim() !== actual.nombre) S.plantillaId = null;   // "guardar como"
      guardarPlantilla(nombre.trim());
    };

    var archivo = $('utwi-archivo');
    if (archivo) archivo.onchange = function () { sumarAdjuntos(archivo.files); archivo.value = ''; };
    cada('[data-quita]', function (b) {
      b.onclick = function () { S.adjuntos.splice(Number(b.getAttribute('data-quita')), 1); pintar(); };
    });

    var envio = $('utwi-enviar');
    if (envio) envio.onclick = function () { if (S.confirmar) enviar(); else { S.confirmar = true; pintar(); } };
    if ($('utwi-cancelar')) $('utwi-cancelar').onclick = function () { S.confirmar = false; pintar(); };

    // ---- plantillas ----
    cada('[data-usar]', function (b) {
      b.onclick = function () { usarPlantilla(b.getAttribute('data-usar')); S.vista = 'redactar'; pintar(); };
    });
    cada('[data-borrar]', function (b) {
      b.onclick = function () {
        var p = S.plantillas.filter(function (x) { return String(x.id) === String(b.getAttribute('data-borrar')); })[0];
        if (p && window.confirm('¿Archivar la plantilla "' + p.nombre + '"?')) borrarPlantilla(p.id);
      };
    });

    // ---- historial ----
    if ($('utwi-recargar-historial')) $('utwi-recargar-historial').onclick = cargarHistorial;
  }

  function usarPlantilla(id) {
    var p = S.plantillas.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p) { S.plantillaId = null; return; }
    S.plantillaId = p.id;
    S.canal = p.canal;
    S.asunto = p.asunto || '';
    S.cuerpo = p.cuerpo || '';
    pintar();
  }

  function sumarAdjuntos(files) {
    Array.prototype.forEach.call(files, function (f) {
      if (S.adjuntos.length >= MAX_ADJUNTOS) return aviso('Máximo ' + MAX_ADJUNTOS + ' adjuntos por correo.', 'err');
      if (f.size > MAX_ADJUNTO) return aviso(f.name + ' pesa más de 8 MB y no se puede adjuntar.', 'err');
      var lector = new FileReader();
      lector.onload = function () {
        S.adjuntos.push({ nombre: f.name, bytes: f.size, base64: String(lector.result).split(',')[1] || '' });
        pintar();
      };
      lector.readAsDataURL(f);
    });
  }
})();
