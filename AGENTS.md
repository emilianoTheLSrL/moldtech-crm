# MoldTech CRM — contexto para agentes (Codex, Claude, etc.)

Responde en español. El dueño (Emiliano) prefiere respuestas cortas y directas.

## Qué es
CRM interno de MoldTech para dar seguimiento a ~69 prospectos de la expo Plastimagen 2026.
Lo usan 4 personas con usuario y contraseña propios (no necesitan cuenta de Google):
`emiliano`, `patrick`, `joseluis` (José Luis Rangel, CTO), `enrique` (Luis Enrique Rosas, CEO).

## Arquitectura
```
GitHub Pages (este repo)                Google Apps Script (cuenta jl.rangel@moldtech.mx)
index.html  ── fetch POST JSON ──▶  doPost(e)  →  Google Sheet "MoldTech CRM · Datos"
                {fn, args}                       →  GmailApp (correos a prospectos)
            ◀── {result} | {error} ──            →  Calendar API (reuniones con Meet)
```
- **App:** https://emilianothelsrl.github.io/moldtech-crm/ (GitHub Pages, rama `main`, raíz).
- **API:** `const API` en `index.html` → `https://script.google.com/macros/s/AKfycbzipZWKE5zs1webZFRQR06cWPmoTcQ6V1J3nCj1l4vHdMZXSPoAudPcWb6LTE982z4/exec`
- El POST usa `Content-Type: text/plain` a propósito (evita el preflight CORS; Apps Script no lo soporta).
- `apps-script/Code.gs` y `apps-script/appsscript.json` son **una copia de referencia** del backend. La versión que corre está en el proyecto Apps Script `1PSxa-8MqvI9hBglpcpUycVaLdExCEGhqfSQUi2jHMxgvhSm9R7LR6cf2` (cuenta jl.rangel). En la copia está REDACTADO `USUARIOS_INICIALES` (hashes de contraseñas): nunca subas hashes, contraseñas ni datos de prospectos a este repo (es público).

## Cómo publicar cambios
- **Pantalla (`index.html`):** commit + push a `main`. GitHub Pages se actualiza en 1–2 min.
- **Backend:** pegar el código en el editor de Apps Script (con la cuenta jl.rangel) → Guardar → Implementar → Administrar implementaciones → ✏️ Editar → Versión: *Nueva versión* → Implementar. El URL `/exec` NO cambia. Si se agregan permisos (scopes) nuevos hay que correr una función desde el editor y aprobarlos marcando todas las casillas.
- Mantén `apps-script/Code.gs` sincronizado con lo que se publique.

## API (funciones permitidas en doPost)
Todas, salvo `login`, reciben `token` como primer argumento. Sesión de 8 h en CacheService; error `"AUTH"` → la pantalla vuelve al login.
| fn | args después del token | qué hace |
|---|---|---|
| `login` | `usuario, pw` (sin token) | → `{token, usuario, nombre, cambiar, email}`; bloquea 15 min tras 5 fallos |
| `salir` | — | cierra sesión |
| `cambiarPassword` | `actual, nueva` | mínimo 8 caracteres |
| `guardarMiCorreo` | `correo` | correo personal del usuario (replyTo/cc e invitaciones) |
| `init` | — | `{registros, correoInterno, usuario, nombre, equipo, remitentes, firmas}` |
| `guardarConfig` | `correo` | correo interno para avisos de prospectos nuevos |
| `guardar` | `registro, nota` | crea/actualiza fila; agrega nota al historial |
| `borrar` | `id` | elimina fila |
| `registrarNuevo` | `registro, resumen` | guarda y avisa por correo interno |
| `agendar` | `id, fecha(YYYY-MM-DD), hora(HH:mm), tipo, invitarProspecto, invitados[], conMeet` | evento en Calendar con Meet y `sendUpdates:'all'` |
| `enviarCorreo` | `id, asunto, cuerpo, desde, copiaMi, firma` | Gmail desde jl.rangel o un alias "Enviar como"; `firma` = clave de usuario → HTML con imagen de firma |

## Modelo de datos (columnas de la hoja "Prospectos")
`id, creado, editado, editadoPor, etapa, prioridad, estado, nombre, empresa, puesto, tel, email, ubicacion, maquinas, tipoMaquinas, monitoreo, problemas(JSON), interes, senal, motivo, accion, mensaje, consentimiento, proximo, reunion, notas, alertas, origen, tamano, historial(JSON), cartera`
- `etapa`: Urgente · Interesado · Mensaje · Reunión · Cliente · Sin ajuste
- `estado`: Nuevo · Contactado · Respondió · Reunión agendada · Propuesta enviada · Ganado · Perdido · Archivado
- `cartera`: `Dirección` (la atienden los jefes) · `Equipo` (Emiliano y Patrick) · `Alianzas` (colaboraciones, prensa, marketing y socios; no son clientes) · vacío = sin asignar. No usar nombres como "ultra importantes".
- Para agregar columnas: añadir al final de `COLS` en el backend (la hoja agrega el encabezado sola).

## "¿En qué va?" (pantalla)
La pantalla ya no muestra Etapa y Estado por separado: un solo campo **¿En qué va?** (Por contactar · Ya le escribimos · Respondió · Reunión · Propuesta enviada · Cliente · No le interesa) más la casilla **⚡ Es urgente**. Se calcula y se guarda con `avance(r)` / `setAvance(r, a)` sobre las columnas `etapa` y `estado` (el backend no cambió). Pestañas: Hoy · Avance · Todos.

## Pantalla (`index.html`)
Un solo archivo (HTML + CSS + JS, sin build). Estilo Apple (HIG, skill ehmo/platform-design-skills web+iOS): letra del sistema (SF), barra translúcida, controles segmentados, modo claro/oscuro automático; en celular, pestañas abajo y ficha como hoja de iPhone. Instalable como app (manifest.json + apple-touch-icon.png).
Vistas: Hoy, Pipeline (kanban con drag & drop), Tabla; barra de Cartera (Todas/Dirección/Equipo/Alianzas/Sin asignar, en localStorage `mt_cartera`); ficha lateral con datos, mensaje (enviar correo con remitente y firma, WhatsApp, abrir en mi correo), agendar reunión e historial. Token en localStorage `mt_token`.

## Firmas de correo
Imágenes `firma-<usuario>.jpg` (1200×400) copiadas en la carpeta "MoldTech CRM" del Drive de jl.rangel, públicas por link; IDs en la propiedad `FIRMAS_IDS`. Se insertan como `<img src="https://lh3.googleusercontent.com/d/<id>=w1200">` (las imágenes `cid:` no se ven en Outlook móvil). Nombres y correos en `FIRMAS_DEF`.

## Respaldo
Activador diario (12–1 am) que corre `respaldoDiario`: copia la hoja a la carpeta "MoldTech CRM/Respaldos" y deja 30 días. No necesita redesplegar la app.

## Cómo trabajar (puedes modificar y mover lo que haga falta)
Tienes permiso de cambiar, reorganizar y publicar en `main`, siempre que todo se pueda **rebobinar**:
1. **Antes de tocar nada**, crea un punto de regreso y súbelo:
   `git tag antes-$(date +%Y%m%d-%H%M) && git push origin --tags`
2. Haz **commits pequeños**, uno por cambio, con mensaje claro en español.
3. Prueba que la página cargue sin errores en la consola antes de hacer push.
4. Al terminar, di en tu respuesta el nombre del tag creado y qué cambiaste.
**Para rebobinar:** `git revert <commit>` (deshace un cambio) o volver todo al punto de regreso:
`git checkout <tag> -- . && git commit -m "Regreso a <tag>" && git push` (sin borrar historial; nunca uses `push --force`).
Los tags no ocupan espacio extra (solo marcan un commit).
Si el cambio toca `apps-script/Code.gs`, avisa que hay que publicarlo en Apps Script (no se publica solo).

## Reglas
- No tocar nada de la organización de GitHub `moldtech-ai` sin autorización explícita. Este repo es de la cuenta personal `emilianoTheLSrL`.
- Nunca modificar la Google Sheet "Maquinas--- V2--Pendientes" (solo lectura).
- Cambios reversibles: punto de regreso (tag) antes de empezar y commits pequeños. Nunca `push --force` ni borrar tags o ramas ajenas.
- No meter datos personales ni contraseñas en el repo.
- Si sirves HTML desde Apps Script (`HtmlService`), escapa `//` dentro de strings de JS (`'https:\/\/…'`): HtmlService puede cortar esas líneas y romper la página. En GitHub Pages no pasa.

## Pendientes conocidos
1. Dominio propio gratis: `crm.moldtech.mx` (CNAME a `emilianothelsrl.github.io` + archivo `CNAME` en el repo) o Vercel/Netlify/Cloudflare Pages.
2. Spam: configurar SPF (`v=spf1 include:_spf.google.com ~all`), DKIM (Google Admin → Gmail → Autenticar correo) y DMARC (`_dmarc`: `v=DMARC1; p=none; rua=mailto:jl.rangel@moldtech.mx`) en el DNS de moldtech.mx.
3. Alias "Enviar como" `le.rosas@moldtech.mx` en la Gmail de jl.rangel (lo confirma le.rosas). Aparece solo en "Enviar desde" (caché de 1 h).
4. Ideas: respaldo nocturno de la hoja, panel de administrador para José Luis, guardar solo campos modificados.
