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
    guardarConfig: guardarConfig, guardar: guardar, borrar: borrar, registrarNuevo: registrarNuevo, agendar: agendar, reagendar: reagendar, enviarCorreo: enviarCorreo };
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
    usuario: yo, nombre: nombre_(yo), equipo: equipo_(), remitentes: remitentes_(), firmas: firmas_(), presentacion: !!P.getProperty('PRESENTACION_ID')
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
function enviarCorreo(token, id, asunto, cuerpo, desde, copiaMi, firma, adjuntar) {
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
  const pdfId = P.getProperty('PRESENTACION_ID');
  if (adjuntar && pdfId) {
    opts.attachments = [DriveApp.getFileById(pdfId).getBlob().setName('MoldTech - Presentación comercial 2026.pdf')];
    if (!/presentaci[oó]n/i.test(cuerpo)) cuerpo = cuerpo.replace(/\s*Saludos\.?\s*$/i, '') + '\n\nTe comparto nuestra presentación comercial (PDF adjunto), donde viene a detalle la plataforma y la demo gratuita de 15 días.\n\nSaludos.';
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
 * Agenda en el calendario de jl.rangel. Invitar al cliente y Google Meet son opcionales
 * (sin cliente sirve como recordatorio interno en el calendario).
 */
/** Mueve la reunión que ya existe (mismo evento y mismo Meet) y avisa a los invitados. */
function reagendar(token, id, fecha, hora) {
  const yo = sesion_(token), quien = nombre_(yo);
  const sh = hoja_();
  const row = fila_(sh, id);
  if (row < 0) throw new Error('No encontré el registro.');
  const r = leer_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  const partes = String(r.reunion || '').split(' · ');
  const m = partes[0].match(/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/);
  if (!m) throw new Error('Este prospecto no tiene una reunión con fecha para mover. Usa "Agendar".');
  const tipo = partes[1] || 'Reunión', meet = partes.slice(2).join(' · ');
  const calendario = 'jl.rangel@moldtech.mx';
  const antes = Utilities.parseDate(m[1] + ' ' + (m[2] || '00:00'), ZONA, 'yyyy-MM-dd HH:mm');
  const buscar = (desde, hasta, q) => (Calendar.Events.list(calendario, { timeMin: desde.toISOString(), timeMax: hasta.toISOString(), singleEvents: true, q: q, maxResults: 50 }).items || []);
  const empresa = String(r.empresa || '').trim();
  const coincide = ev => (meet && ev.hangoutLink && meet.indexOf(ev.hangoutLink) >= 0) || (empresa && String(ev.summary || '').indexOf(empresa) >= 0);
  const dia = 24 * 3600 * 1000;
  let cands = buscar(new Date(antes.getTime() - dia), new Date(antes.getTime() + 2 * dia)).filter(coincide);
  if (!cands.length && empresa) cands = buscar(new Date(antes.getTime() - 30 * dia), new Date(antes.getTime() + 60 * dia), empresa).filter(coincide);
  if (!cands.length) throw new Error('No encontré la reunión de ' + empresa + ' en el calendario. Muévela en Google Calendar o usa "Agendar".');
  cands.sort((a, b) => Math.abs(new Date(a.start.dateTime || a.start.date) - antes) - Math.abs(new Date(b.start.dateTime || b.start.date) - antes));
  const ev = cands[0];
  const dur = ev.start.dateTime && ev.end.dateTime ? new Date(ev.end.dateTime) - new Date(ev.start.dateTime) : DURACION_MIN * 60000;
  const inicio = Utilities.parseDate(fecha + ' ' + hora, ZONA, 'yyyy-MM-dd HH:mm');
  const fin = new Date(inicio.getTime() + dur);
  Calendar.Events.patch({ start: { dateTime: inicio.toISOString(), timeZone: ZONA }, end: { dateTime: fin.toISOString(), timeZone: ZONA } },
    calendario, ev.id, { sendUpdates: (ev.attendees || []).length ? 'all' : 'none' });
  const link = ev.hangoutLink || meet;
  r.reunion = fecha + ' ' + hora + ' · ' + tipo + (link ? ' · ' + link : '');
  r.etapa = 'Reunión';
  r.estado = 'Reunión agendada';
  return guardar_(r, 'Reunión movida: de ' + m[1] + ' ' + (m[2] || '') + ' a ' + fecha + ' ' + hora + ((ev.attendees || []).length ? ' · se avisó a los invitados' : '') + (link ? ' · mismo Meet' : ''), quien);
}

function agendar(token, id, fecha, hora, tipo, invitarProspecto, invitados, conMeet) {
  const yo = sesion_(token), quien = nombre_(yo);
  const sh = hoja_();
  const row = fila_(sh, id);
  if (row < 0) throw new Error('No encontré el registro.');
  const r = leer_(sh.getRange(row, 1, 1, COLS.length).getValues()[0]);
  const invitar = invitarProspecto !== false, meetOn = conMeet !== false;
  const cliente = String(r.email || '').trim().toLowerCase();
  if (invitar) {
    if (!cliente) throw new Error('Falta el correo del cliente. Agrégalo en Datos o desmarca "Invitar al prospecto".');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cliente)) throw new Error('El correo del cliente no es válido.');
  }
  const calendario = 'jl.rangel@moldtech.mx';
  if (String(Calendar.Calendars.get('primary').id || '').toLowerCase() !== calendario) {
    throw new Error('La app debe ejecutarse con la cuenta jl.rangel@moldtech.mx.');
  }
  const inicio = Utilities.parseDate(fecha + ' ' + hora, ZONA, 'yyyy-MM-dd HH:mm');
  const fin = new Date(inicio.getTime() + DURACION_MIN * 60000);
  const lista = [...new Set((invitar ? [cliente] : []).concat(Array.isArray(invitados) ? invitados : [])
    .map(e => String(e || '').trim().toLowerCase()).filter(e => e && e !== calendario))];
  const firma = (FIRMAS_DEF[yo] && FIRMAS_DEF[yo].n) || quien;
  const ev = {
    summary: (invitar ? 'Reunión MoldTech – ' : tipo + ' (recordatorio) – ') + (r.empresa || '') + ' (' + (r.nombre || '') + ')',
    description: invitar
      ? 'Hola' + (r.nombre ? ' ' + r.nombre : '') + ', te comparto ' + (meetOn ? 'el enlace para ' : 'los datos de ') + 'nuestra reunión. Cualquier cambio me avisas.\n\n' + firma + '\nMoldTech'
      : 'Recordatorio interno de MoldTech CRM (el cliente no fue invitado). Agendado por ' + quien + '.',
    location: tipo === 'Visita a planta' ? r.ubicacion : '',
    start: { dateTime: inicio.toISOString(), timeZone: ZONA },
    end: { dateTime: fin.toISOString(), timeZone: ZONA },
    attendees: lista.map(email => ({ email: email })),
    guestsCanModify: false,
    guestsCanSeeOtherGuests: true
  };
  if (meetOn) ev.conferenceData = { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  let creado = Calendar.Events.insert(ev, calendario, { conferenceDataVersion: meetOn ? 1 : 0, sendUpdates: lista.length ? 'all' : 'none' });
  const eventoId = creado.id;
  try {
    for (let intento = 0; meetOn && !creado.hangoutLink && intento < 3; intento++) {
      const solicitud = creado.conferenceData && creado.conferenceData.createRequest;
      if (solicitud && solicitud.status && solicitud.status.statusCode === 'failure') break;
      Utilities.sleep((intento + 1) * 1000);
      creado = Calendar.Events.get(calendario, eventoId);
    }
    if (invitar && !(creado.attendees || []).some(a => String(a.email || '').trim().toLowerCase() === cliente)) {
      throw new Error('No se confirmó al cliente entre los invitados.');
    }
    if (meetOn && !creado.hangoutLink) throw new Error('No se confirmó el enlace de Google Meet.');
  } catch (e) {
    throw new Error((e.message || String(e)) + ' El evento puede existir en Calendar; revísalo antes de volver a agendar. Referencia: ' + eventoId);
  }
  const meet = creado.hangoutLink || '';
  r.reunion = fecha + ' ' + hora + ' · ' + tipo + (meet ? ' · ' + meet : '');
  r.etapa = 'Reunión';
  r.estado = 'Reunión agendada';
  return guardar_(r, tipo + ' agendada para ' + fecha + ' ' + hora + (lista.length ? ' · invitados: ' + lista.join(', ') : ' · solo recordatorio en calendario') + (meet ? ' · Meet: ' + meet : ''), quien);
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

/**
 * Respaldo diario: copia la hoja de datos a "MoldTech CRM/Respaldos" y conserva los últimos 30 días.
 * Lo corre un activador diario (12-1 am, creado desde Activadores en el editor). No toca la hoja original ni la app.
 */
function respaldoDiario() {
  const carpeta = DriveApp.getFolderById(P.getProperty('FOLDER_ID'));
  const it = carpeta.getFoldersByName('Respaldos');
  const resp = it.hasNext() ? it.next() : carpeta.createFolder('Respaldos');
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  if (!resp.getFilesByName('Respaldo CRM ' + hoy).hasNext()) DriveApp.getFileById(P.getProperty('SHEET_ID')).makeCopy('Respaldo CRM ' + hoy, resp);
  const limite = Date.now() - 30 * 24 * 3600 * 1000;
  const fs = resp.getFiles();
  while (fs.hasNext()) { const f = fs.next(); if (f.getName().indexOf('Respaldo CRM ') === 0 && f.getDateCreated().getTime() < limite) f.setTrashed(true); }
  return 'Respaldo ' + hoy + ' listo';
}
/** Arma un mensaje personalizado según lo que sabemos (y lo que falta) del prospecto. */
function armarMensaje_(r) {
  const vacio = v => { const s = String(v == null ? '' : v).trim().toLowerCase(); return !s || /^(pendiente|indefinido|por identificar|por confirmar|n\/?a|sin dato|-|0|000)/.test(s); };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const titulo = s => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(])([a-záéíóúñ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(S\.?a\.?|De|C\.?v\.?|Srl|Sa)\b/gi, w => w.toUpperCase()) : s);
  const nom = vacio(r.nombre) ? '' : cap(String(r.nombre).trim().split(/\s+/)[0]);
  const emp = vacio(r.empresa) ? 'tu empresa' : titulo(String(r.empresa).trim());
  const tipo = String(r.tipoMaquinas || '').trim(), tipoOk = /inyec|extru|sopl|termof|rotomol|compres|tornos|cnc/i.test(tipo);
  const maq = String(r.maquinas || '').trim(), maqOk = !vacio(maq);
  const ubiOk = !vacio(r.ubicacion);
  const telOk = String(r.tel || '').replace(/\D/g, '').length >= 10;
  const probs = (Array.isArray(r.problemas) ? r.problemas : []).filter(Boolean);
  const sinPromo = r.consentimiento === 'No';
  const puesto = String(r.puesto || '').toLowerCase(), notas = (String(r.notas || '') + ' ' + String(r.accion || '')).toLowerCase();
  const compras = /compra|adquisic|abasto/.test(puesto), decisor = /director|gerente|dueñ|owner|ceo|coo|plant manager|jefe de planta/.test(puesto);
  const kit = /kit/.test(notas), visita = /visita/.test(notas);
  const reunion = r.etapa === 'Reunión' || r.estado === 'Reunión agendada';
  const p = [];
  p.push('Hola' + (nom ? ' ' + nom : '') + ',');
  p.push(String(r.origen || '').indexOf('Plastimagen') >= 0
    ? 'Te escribo de MoldTech; fue un gusto saludarte en Plastimagen 2026.'
    : 'Te escribo de parte del equipo de MoldTech.');
  if (tipoOk && maqOk) p.push('Nos quedamos con el dato de que en ' + emp + ' operan ' + (/^\d+$/.test(maq) ? maq + ' máquinas (' + tipo.toLowerCase() + ')' : maq.charAt(0).toLowerCase() + maq.slice(1)) + '. Con MoldTech pueden ver en tiempo real la producción, los paros y la eficiencia de cada una, sin cambiar su forma de trabajar.');
  else if (tipoOk) p.push('Vimos que en ' + emp + ' trabajan con ' + tipo.toLowerCase() + '. Con MoldTech pueden ver en tiempo real la producción, los paros y la eficiencia de cada máquina, sin cambiar su forma de trabajar.');
  else p.push('En MoldTech conectamos las máquinas de planta para ver en tiempo real la producción, los paros y la eficiencia, sin cambiar la forma de trabajar.');
  if (compras) p.push('Sé que tu área es compras, así que si nos ayudas a contactar a la persona de producción o mantenimiento, con gusto le presentamos la propuesta.');
  else if (decisor) p.push('Como responsable en ' + emp + ', creo que te puede interesar ver cuánto tiempo de máquina se pierde hoy por paros y ajustes.');
  if (probs.length) p.push('Nos comentaste que les interesa mejorar: ' + probs.join(', ').toLowerCase() + '.');
  if (String(r.monitoreo).trim() === 'No') p.push('Como hoy no monitorean sus máquinas en línea, es un buen punto para empezar.');
  const q = [];
  if (!tipoOk) q.push('¿Qué tipo de planta tienen (inyección, extrusión, soplado u otro proceso)' + (maqOk ? '?' : ' y cuántas máquinas, aproximadamente?'));
  else if (!maqOk) q.push('¿Cuántas máquinas tienen, aproximadamente?');
  if (!ubiOk) q.push('¿En qué ciudad está su planta?');
  if (!telOk) q.push('¿Te podemos contactar por WhatsApp? Si sí, compártenos tu número.');
  if (q.length) p.push('Para preparar algo a la medida, me ayudarías con unos datos:\n' + q.map(x => '• ' + x).join('\n'));
  if (reunion) p.push('Quedo atento para nuestra reunión; si necesitas moverla, con gusto la reagendamos.');
  else if (sinPromo) p.push('Solo te escribo para dar seguimiento a lo que platicamos en el stand; quedo atento a lo que necesites.');
  else if (kit) p.push('Si te parece, podemos ir a instalar un kit de prueba en una de sus máquinas para que vean los datos en vivo. ¿Qué día les acomoda?');
  else if (visita) p.push('¿Te parece si agendamos una visita a planta para conocer sus máquinas y mostrarte la plataforma?');
  else p.push('¿Te parece si agendamos 15 minutos esta semana para mostrarte una demo?');
  p.push('Saludos.');
  return p.join('\n\n');
}

/** Mantenimiento: reescribe con mensaje personalizado a los prospectos que nadie ha contactado (estado "Nuevo"). */
function personalizarMensajes() {
  return conLock_(() => {
    const sh = hoja_(), n = sh.getLastRow() - 1; if (n < 1) return 0;
    const rg = sh.getRange(2, 1, n, COLS.length), v = rg.getValues(), cm = COLS.indexOf('mensaje');
    let k = 0;
    v.forEach(f => { const r = leer_(f); if (r.id && r.estado === 'Nuevo') { f[cm] = armarMensaje_(r); k++; } });
    sh.getRange(2, cm + 1, n, 1).setValues(v.map(f => [f[cm]]));
    console.log(k + ' mensajes personalizados'); return k;
  });
}

/** Mantenimiento: vuelve a leer los alias "Enviar como" de Gmail (por ejemplo le.rosas). */
function refrescarRemitentes() { CacheService.getScriptCache().remove('remitentes'); const r = remitentes_(); console.log('Remitentes: ' + r.join(', ')); return r; }

/** Mantenimiento: copia a la carpeta del CRM la presentación comercial compartida (PDF) para adjuntarla en los correos. */
function instalarPresentacion() {
  const it = DriveApp.searchFiles('title = "MoldTech_Presentacion_Comercial_2026.pdf" and sharedWithMe');
  if (!it.hasNext()) throw new Error('No encontré el PDF compartido');
  const f = it.next().makeCopy('MoldTech - Presentación comercial 2026.pdf', DriveApp.getFolderById(P.getProperty('FOLDER_ID')));
  P.setProperty('PRESENTACION_ID', f.getId());
  return f.getId();
}
