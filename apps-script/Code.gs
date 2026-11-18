/**
 * MoldTech CRM — backend en Google Apps Script.
 * Corre con la cuenta que lo publica (jl.rangel@moldtech.mx): de ahí salen correos e invitaciones.
 * Acceso: usuario y contraseña propios de la app (no requiere cuenta de Google).
 * Datos: Google Sheet "MoldTech CRM · Datos" en la carpeta "MoldTech CRM" del Drive de la cuenta.
 */
const ZONA = 'America/Mexico_City';
const DURACION_MIN = 60;
const SESION_SEG = 8 * 60 * 60;       // la sesión dura 8 horas
const MAX_INTENTOS = 5;               // intentos fallidos antes de bloquear
const BLOQUEO_MIN = 15;               // minutos de bloqueo

// Archivos de instalación (se copian a esta cuenta la primera vez y luego ya no se usan)
const ORIGEN_INDEX = '1K5EX5dIZHlK1jJfI6idbJVqoXb1zeno_';
const ORIGEN_SEED = '1RFxzxmEyPuCUmdBGfXdmiKHZaboilItK';

// Usuarios iniciales: contraseñas temporales guardadas solo como hash; se cambian al primer ingreso.
const USUARIOS_INICIALES = {/* REDACTADO en la copia del repo: ver el proyecto Apps Script */};

const HOJA = 'Prospectos';
const COLS = ['id','creado','editado','editadoPor','etapa','prioridad','estado','nombre','empresa','puesto',
  'tel','email','ubicacion','maquinas','tipoMaquinas','monitoreo','problemas','interes','senal','motivo',
  'accion','mensaje','consentimiento','proximo','reunion','notas','alertas','origen','tamano','historial','cartera'];
const JSONCOLS = ['problemas','historial'];
const P = PropertiesService.getScriptProperties();

/* ---------- instalación ---------- */
function instalado_() { return !!P.getProperty('SHEET_ID'); }

function instalar() {
  if (instalado_()) return 'Ya estaba instalado';
  const carpeta = DriveApp.createFolder('MoldTech CRM');
  const index = DriveApp.getFileById(ORIGEN_INDEX).makeCopy('crm-index.html', carpeta);
  const ss = SpreadsheetApp.create('MoldTech CRM · Datos');
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);
  const sh = ss.getSheets()[0];
  sh.setName(HOJA);
  sh.getRange(1, 1, 2000, COLS.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#263a5e').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  const seed = JSON.parse(DriveApp.getFileById(ORIGEN_SEED).getBlob().getDataAsString('UTF-8'));
  const filas = seed.map(escribir_);
  sh.getRange(2, 1, filas.length, COLS.length).setValues(filas);
  P.setProperties({ SHEET_ID: ss.getId(), INDEX_ID: index.getId(), FOLDER_ID: carpeta.getId(),
    USUARIOS: JSON.stringify(USUARIOS_INICIALES), correoInterno: 'jl.rangel@moldtech.mx' });
  return 'Instalado: ' + filas.length + ' prospectos';
}

function doGet() {
  if (!instalado_()) instalar();
  const html = DriveApp.getFileById(P.getProperty('INDEX_ID')).getBlob().getDataAsString('UTF-8');
  return HtmlService.createHtmlOutput(html)
    .setTitle('MoldTech CRM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/** API para la pantalla publicada en GitHub Pages (POST con JSON {fn, args}). */
function doPost(e) {
  const API = { login: login, salir: salir, cambiarPassword: cambiarPassword, guardarMiCorreo: guardarMiCorreo, init: init,
    guardarConfig: guardarConfig, guardar: guardar, borrar: borrar, registrarNuevo: registrarNuevo, agendar: agendar, enviarCorreo: enviarCorreo };
  let out;
  try {
    const b = JSON.parse(e.postData.contents);
    const f = API[b.fn];
    if (!f) throw new Error('Función no permitida');
    out = { result: f.apply(null, Array.isArray(b.args) ? b.args : []) };
  } catch (err) { out = { error: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- usuarios y sesiones ---------- */
function hash_(salt, pw) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw, Utilities.Charset.UTF_8)
    .map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}
function usuarios_() { return JSON.parse(P.getProperty('USUARIOS') || '{}'); }
function guardarUsuarios_(u) { P.setProperty('USUARIOS', JSON.stringify(u)); }
function sesion_(token) {
  const u = token && CacheService.getScriptCache().get('s_' + token);
  if (!u) throw new Error('AUTH');
  CacheService.getScriptCache().put('s_' + token, u, SESION_SEG);
  return u;
}
function equipo_() {
  const u = usuarios_();
  return Object.keys(u).map(k => ({ usuario: k, nombre: u[k].nombre, email: u[k].email || '' }));
}

function login(usuario, pw) {
  return conLock_(() => {
    usuario = String(usuario || '').trim().toLowerCase();
    const us = usuarios_(), u = us[usuario];
    const ahora = Date.now();
    if (!u) { Utilities.sleep(800); throw new Error('Usuario o contraseña incorrectos.'); }
    if (u.bloqueado && u.bloqueado > ahora) throw new Error('Demasiados intentos. Espera ' + Math.ceil((u.bloqueado - ahora) / 60000) + ' min e inténtalo de nuevo.');
    if (hash_(u.salt, String(pw || '')) !== u.hash) {
      u.fallos = (u.fallos || 0) + 1;
      if (u.fallos >= MAX_INTENTOS) { u.bloqueado = ahora + BLOQUEO_MIN * 60000; u.fallos = 0; }
      guardarUsuarios_(us); Utilities.sleep(800);
      throw new Error('Usuario o contraseña incorrectos.');
    }
    u.fallos = 0; u.bloqueado = 0; u.ultimo = new Date().toISOString(); guardarUsuarios_(us);
    const token = Utilities.getUuid() + Utilities.getUuid();
    CacheService.getScriptCache().put('s_' + token, usuario, SESION_SEG);
    return { token: token, usuario: usuario, nombre: u.nombre, cambiar: !!u.cambiar, email: u.email || '' };
  });
}

function salir(token) { if (token) CacheService.getScriptCache().remove('s_' + token); return true; }

function cambiarPassword(token, actual, nueva) {
  const yo = sesion_(token);
  return conLock_(() => {
    const us = usuarios_(), u = us[yo];
    if (hash_(u.salt, String(actual || '')) !== u.hash) throw new Error('La contraseña actual no es correcta.');
    nueva = String(nueva || '');
    if (nueva.length < 8) throw new Error('La nueva contraseña debe tener al menos 8 caracteres.');
    u.salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    u.hash = hash_(u.salt, nueva);
    u.cambiar = false;
    guardarUsuarios_(us);
    return true;
  });
}

function guardarMiCorreo(token, correo) {
  const yo = sesion_(token);
  return conLock_(() => { const us = usuarios_(); us[yo].email = String(correo || '').trim(); guardarUsuarios_(us); return true; });
}

/** Solo para el administrador (se corre desde el editor): restablece la contraseña de un usuario. */
function restablecerPassword(usuario, temporal) {
  const us = usuarios_(); const u = us[usuario];
  if (!u) throw new Error('No existe ' + usuario);
  u.salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16); u.hash = hash_(u.salt, temporal); u.cambiar = true; u.fallos = 0; u.bloqueado = 0;
  guardarUsuarios_(us); return 'Listo';
}

/* ---------- datos ---------- */
function hoja_() {
  const sh = SpreadsheetApp.openById(P.getProperty('SHEET_ID')).getSheetByName(HOJA);
  if (sh.getLastColumn() < COLS.length) sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#263a5e').setFontColor('#ffffff');
  return sh;
}

function leer_(fila) {
  const o = {};
  COLS.forEach((k, i) => {
    let v = fila[i];
    if (v instanceof Date) v = Utilities.formatDate(v, ZONA, 'yyyy-MM-dd');
    v = v == null ? '' : String(v);
    if (JSONCOLS.includes(k)) { try { v = v ? JSON.parse(v) : []; } catch (e) { v = []; } }
    o[k] = v;
  });
  return o;
}
function escribir_(r) {
  return COLS.map(k => JSONCOLS.includes(k) ? JSON.stringify(r[k] || []) : (r[k] == null ? '' : String(r[k])));
}
function fila_(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < n; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}
function conLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function nombre_(usuario) { const u = usuarios_()[usuario]; return u ? u.nombre : usuario; }

function init(token) {
  const yo = sesion_(token);
  const sh = hoja_();
  const datos = sh.getDataRange().getValues();
  datos.shift();
  return {
    registros: datos.filter(f => f[0]).map(leer_),
    correoInterno: P.getProperty('correoInterno') || '',
    usuario: yo, nombre: nombre_(yo), equipo: equipo_(), remitentes: remitentes_(), firmas: firmas_()
  };
}

function guardarConfig(token, correo) {
  sesion_(token);
  P.setProperty('correoInterno', String(correo || '').trim());
  return true;
}

function guardar_(r, nota, quien) {
  return conLock_(() => {
    const sh = hoja_();
    let row = fila_(sh, r.id);
    const ahora = new Date().toISOString();
    r.editado = ahora;
    r.editadoPor = quien;
    r.historial = r.historial || [];
    if (nota) r.historial.push({ t: ahora, quien: quien, txt: nota });
    if (row === -1) row = sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, COLS.length).setNumberFormat('@').setValues([escribir_(r)]);
    return r;
  });
}
function guardar(token, r, nota) { return guardar_(r, nota, nombre_(sesion_(token))); }

function borrar(token, id) {
  sesion_(token);
  return conLock_(() => { const sh = hoja_(); const row = fila_(sh, id); if (row > 0) sh.deleteRow(row); return true; });
}

function registrarNuevo(token, r, resumen) {
  const quien = nombre_(sesion_(token));
  const res = { interno: null };
  const correo = P.getProperty('correoInterno') || '';
  if (correo) {
    try { MailApp.sendEmail({ to: correo, subject: 'Nuevo prospecto: ' + r.empresa, body: resumen + '\n\nRegistrado por: ' + quien, name: 'MoldTech CRM' }); res.interno = { ok: true }; }
    catch (e) { res.interno = { ok: false, error: e.message }; }
  }
  res.registro = guardar_(r, 'Registrado en la app', quien);
  return res;
}

/** Cuentas desde las que se puede enviar: la cuenta dueña y sus alias "Enviar como" de Gmail. */
function remitentes_() {
  const c = CacheService.getScriptCache(); const k = c.get('remitentes');
  if (k) return JSON.parse(k);
  let lista = ['jl.rangel@moldtech.mx'];
  try { lista = lista.concat(GmailApp.getAliases()); } catch (e) {}
  c.put('remitentes', JSON.stringify(lista), 3600);
  return lista;
}

/** Envía un correo al prospecto desde la cuenta MoldTech (o un alias) y lo deja en el historial. */
function enviarCorreo(token, id, asunto, cuerpo, desde, copiaMi, firma) {
  const yo = sesion_(token), quien = nombre_(yo);
  const sh = hoja_();
  const row = fila_(sh, id);
  if (row < 0) throw new Error('No encontré el registro.');
  const r = leer_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  if (!r.email) throw new Error('Este prospecto no tiene correo.');
  asunto = String(asunto || 'MoldTech · seguimiento').slice(0, 200);
  cuerpo = String(cuerpo || '').slice(0, 20000);
  if (!cuerpo.trim()) throw new Error('El mensaje está vacío.');
  const original = cuerpo;
  const miCorreo = (usuarios_()[yo] || {}).email || '';
  const dueno = 'jl.rangel@moldtech.mx';
  const opts = { name: 'MoldTech' };
  if (miCorreo) opts.replyTo = miCorreo;
  if (copiaMi && miCorreo) opts.cc = miCorreo;
  if (desde && desde !== dueno) {
    if (GmailApp.getAliases().indexOf(desde) < 0) throw new Error('La cuenta ' + desde + ' no está configurada para enviar.');
    opts.from = desde;
  }
  const ids = JSON.parse(P.getProperty('FIRMAS_IDS') || '{}');
  if (firma && ids[firma]) {
    const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    opts.htmlBody = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">' +
      esc(cuerpo).split(/\n/).map(l => l.trim() ? '<p style="margin:0 0 10px">' + l + '</p>' : '').join('') +
      '</div><br><img src="' + firmaUrl_(ids[firma]) + '" width="600" alt="' + esc(FIRMAS_DEF[firma].n) + ' · MoldTech" style="width:100%;max-width:600px;height:auto;display:block;border:0">';
    opts.name = FIRMAS_DEF[firma].corto + ' | MoldTech';
    cuerpo = cuerpo + '\n\n' + FIRMAS_DEF[firma].n + '\nMoldTech · www.moldtech.mx';
  }
  GmailApp.sendEmail(r.email, asunto, cuerpo, opts);
  r.mensaje = original;
  if (r.estado === 'Nuevo') r.estado = 'Contactado';
  return guardar_(r, 'Correo enviado a ' + r.email + ' desde ' + (opts.from || dueno) + ' · "' + asunto + '"', quien);
}

/**
 * Agenda en el calendario de jl.rangel, siempre con cliente y Google Meet.
 * Los parámetros antiguos se conservan por compatibilidad; no permiten omitir invitación ni Meet.
 */
function agendar(token, id, fecha, hora, tipo, invitarProspecto, invitados, conMeet) {
  const yo = sesion_(token), quien = nombre_(yo);
  const sh = hoja_();
  const row = fila_(sh, id);
  if (row < 0) throw new Error('No encontré el registro.');
  const r = leer_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  const cliente = String(r.email || '').trim().toLowerCase();
  if (!cliente) throw new Error('Falta el correo del cliente');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente)) throw new Error('El correo del cliente no es válido.');
  const calendario = 'jl.rangel@moldtech.mx';
  if (String(Calendar.Calendars.get('primary').id || '').toLowerCase() !== calendario) {
    throw new Error('La app debe ejecutarse con la cuenta jl.rangel@moldtech.mx.');
  }
  const inicio = Utilities.parseDate(fecha + ' ' + hora, ZONA, 'yyyy-MM-dd HH:mm');
  const fin = new Date(inicio.getTime() + DURACION_MIN * 60000);
  const lista = [...new Set([cliente].concat(Array.isArray(invitados) ? invitados : [])
    .map(e => String(e || '').trim().toLowerCase()).filter(Boolean))];
  const firma = (FIRMAS_DEF[yo] && FIRMAS_DEF[yo].n) || quien;
  const ev = {
    summary: 'Reunión MoldTech – ' + (r.empresa || '') + ' (' + (r.nombre || '') + ')',
    description: 'Hola' + (r.nombre ? ' ' + r.nombre : '') + ', te comparto el enlace para nuestra reunión. Cualquier cambio me avisas.\n\n' + firma + '\nMoldTech',
    location: tipo === 'Visita a planta' ? r.ubicacion : '',
    start: { dateTime: inicio.toISOString(), timeZone: ZONA },
    end: { dateTime: fin.toISOString(), timeZone: ZONA },
    attendees: lista.map(email => ({ email: email })),
    guestsCanModify: false,
    guestsCanSeeOtherGuests: true,
    conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  };
  let creado = Calendar.Events.insert(ev, calendario, { conferenceDataVersion: 1, sendUpdates: 'all' });
  const eventoId = creado.id;
  // Meet puede generarse de forma asíncrona. Consultar el mismo evento sin volver a crearlo.
  try {
    for (let intento = 0; !creado.hangoutLink && intento < 3; intento++) {
      const solicitud = creado.conferenceData && creado.conferenceData.createRequest;
      if (solicitud && solicitud.status && solicitud.status.statusCode === 'failure') break;
      Utilities.sleep((intento + 1) * 1000);
      creado = Calendar.Events.get(calendario, eventoId);
    }
    if (!(creado.attendees || []).some(a => String(a.email || '').trim().toLowerCase() === cliente)) {
      throw new Error('No se confirmó al cliente entre los invitados.');
    }
    if (!creado.hangoutLink) throw new Error('No se confirmó el enlace de Google Meet.');
    if (String((creado.organizer || {}).email || '').toLowerCase() !== calendario) {
      throw new Error('El organizador no es jl.rangel@moldtech.mx.');
    }
  } catch (e) {
    throw new Error((e.message || String(e)) + ' El evento puede existir en Calendar; revísalo antes de volver a agendar. Referencia: ' + eventoId);
  }
  const meet = creado.hangoutLink;
  r.reunion = fecha + ' ' + hora + ' · ' + tipo + ' · ' + meet;
  r.etapa = 'Reunión';
  r.estado = 'Reunión agendada';
  return guardar_(r, tipo + ' agendada para ' + fecha + ' ' + hora + ' · invitados: ' + lista.join(', ') + ' · Meet: ' + meet, quien);
}

const FIRMAS_DEF = {
  emiliano: { n: 'Carlos Emiliano Meneses Segura', corto: 'Emiliano Meneses', email: 'jl.rangel@moldtech.mx' },
  joseluis: { n: 'José Luis Rangel Guerrero', corto: 'José Luis Rangel', email: 'jl.rangel@moldtech.mx' },
  patrick: { n: "Patrick Liam O'Leary Rosas", corto: "Patrick O'Leary", email: 'jl.rangel@moldtech.mx' },
  enrique: { n: 'Luis Enrique Rosas Torres', corto: 'Luis Enrique Rosas', email: 'le.rosas@moldtech.mx' }
};
/** URL pública de la imagen de firma (se ve en celular y en cualquier correo). */
function firmaUrl_(id) {
  const f = DriveApp.getFileById(id);
  if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1200';
}
function firmas_() {
  const ids = JSON.parse(P.getProperty('FIRMAS_IDS') || '{}');
  return Object.keys(FIRMAS_DEF).filter(k => ids[k]).map(k => ({ k: k, n: FIRMAS_DEF[k].n, email: FIRMAS_DEF[k].email }));
}
/** Copia a la carpeta del CRM las imágenes de firma compartidas (firma-<usuario>.jpg). */
function instalarFirmas_() {
  const carpeta = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  const ids = JSON.parse(P.getProperty('FIRMAS_IDS') || '{}');
  Object.keys(FIRMAS_DEF).forEach(k => {
    if (ids[k]) return;
    const it = DriveApp.searchFiles('title = "firma-' + k + '.jpg" and sharedWithMe');
    if (it.hasNext()) ids[k] = it.next().makeCopy('firma-' + k + '.jpg', carpeta).getId();
  });
  P.setProperty('FIRMAS_IDS', JSON.stringify(ids));
  return Object.keys(ids).join(', ');
}

/** Mantenimiento: reemplaza la pantalla vieja (respaldo en script.google.com) con el crm-index-v*.html compartido más reciente. */
function actualizarPantalla() {
  const it = DriveApp.searchFiles('title contains "crm-index-v" and sharedWithMe'); let f = null;
  while (it.hasNext()) { const x = it.next(); if (!f || x.getDateCreated() > f.getDateCreated()) f = x; }
  const html = f.getBlob().getDataAsString('UTF-8');
  if (html.indexOf('MoldTech') < 0) throw new Error('Archivo incorrecto');
  DriveApp.getFileById(P.getProperty('INDEX_ID')).setContent(html);
  CacheService.getScriptCache().remove('remitentes');
  const fs = instalarFirmas_();
  return 'Pantalla actualizada · firmas: ' + fs + ' · remitentes: ' + remitentes_().join(', ');
}

/** Correr una vez desde el editor para dar permiso de Gmail. */
function permisoGmail() { return 'Gmail OK · remitentes: ' + [ 'jl.rangel@moldtech.mx' ].concat(GmailApp.getAliases()).join(', '); }

/** Correr desde el editor para revisar las firmas. */
function probarFirmas() { const ids = JSON.parse(P.getProperty('FIRMAS_IDS') || '{}'); const r = Object.keys(ids).map(k => k + ': ' + firmaUrl_(ids[k])).join(' | '); console.log(r); return r; }
