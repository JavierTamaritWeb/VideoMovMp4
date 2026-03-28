# VideoMovMp4 v1.0.0 — Documentacion tecnica completa

---

## Tabla de contenidos

1. [Descripcion general](#1-descripcion-general)
2. [Requisitos del sistema](#2-requisitos-del-sistema)
3. [Instalacion y arranque](#3-instalacion-y-arranque)
4. [Estructura del proyecto](#4-estructura-del-proyecto)
5. [Arquitectura del sistema](#5-arquitectura-del-sistema)
6. [Backend — server.mjs](#6-backend--servermjs)
   - 6.1 Servidor HTTP nativo
   - 6.2 Sistema de archivos estaticos
   - 6.3 Prevencion de path traversal
   - 6.4 API REST — Endpoints
   - 6.5 Sistema de Jobs
   - 6.6 Pipeline de conversion FFmpeg
   - 6.7 Parser multipart
   - 6.8 Server-Sent Events (SSE)
   - 6.9 Live-reload (desarrollo)
   - 6.10 Rate limiting
   - 6.11 Logging estructurado
   - 6.12 Graceful shutdown
7. [Funciones puras — converterCore.js](#7-funciones-puras--convertercorejs)
8. [Frontend — interfaz de usuario](#8-frontend--interfaz-de-usuario)
   - 8.1 HTML (index.html)
   - 8.2 CSS (app.css)
   - 8.3 JavaScript (app.js)
   - 8.4 Maquina de estados de la UI
   - 8.5 Gestion de archivos y validacion
   - 8.6 Conexion SSE y reconexion
   - 8.7 Sistema de descarga
   - 8.8 Recuperacion de sesion
   - 8.9 Atajos de teclado
   - 8.10 Notificaciones
9. [Seguridad](#9-seguridad)
10. [Tests](#10-tests)
11. [Scripts auxiliares](#11-scripts-auxiliares)
12. [Configuracion mediante variables de entorno](#12-configuracion-mediante-variables-de-entorno)
13. [Referencia de la API](#13-referencia-de-la-api)
14. [Flujo completo de conversion](#14-flujo-completo-de-conversion)
15. [Manejo de errores](#15-manejo-de-errores)
16. [Rendimiento y limites](#16-rendimiento-y-limites)
17. [Dependencias](#17-dependencias)
18. [Preguntas frecuentes](#18-preguntas-frecuentes)

---

## 1. Descripcion general

VideoMovMp4 es una aplicacion web de una sola pagina (SPA) que convierte archivos de video en formato MOV (QuickTime) a MP4 (H.264 + AAC) optimizado para reproduccion web. Esta diseñada para ser una herramienta profesional con interfaz dark theme, progreso en tiempo real y foco en seguridad y resiliencia.

**Caracteristicas principales:**

- Conversion MOV a MP4 con codec H.264 (libx264) + AAC
- Flag `-movflags +faststart` para reproduccion web inmediata sin descarga completa
- Progreso de conversion en tiempo real via Server-Sent Events (SSE)
- Validacion de archivos por extension Y magic bytes (doble verificacion)
- Ajuste de calidad con mapeo CRF perceptual (no lineal)
- Seleccion de resolucion (Original, 1080p, 720p, 480p) con proteccion contra ampliacion
- Seleccion de preset de velocidad (ultrafast, fast, medium, slow)
- Presets por plataforma: Web, TikTok (9:16), Instagram (Reels 9:16 / Feed 1:1), YouTube (H.264 High) con ajustes automaticos de resolucion, aspect ratio, fps, bitrate y perfil H.264
- Espejo horizontal (filtro `hflip` de FFmpeg)
- Marca de agua de imagen: superpuesta con posicion (5 presets + arrastre libre), tamaño (5-50%), opacidad (10-100%). Usa `-filter_complex` con `overlay`
- Marca de agua de texto: texto con fuente configurable (Montserrat Alternates regular/bold, Arial, Courier, Times), tamaño (12-200px), color (hex), opacidad, posicion (5 presets + arrastre libre). Usa FFmpeg `drawtext`
- Preview unificado: una sola previsualizacion donde imagen y texto se ven superpuestos sobre el video, cada uno arrastrable independientemente. Refleja espejo horizontal (hflip) en tiempo real
- Cancelacion de conversiones en curso
- Recuperacion automatica de sesion tras refresh del navegador
- Reconexion SSE automatica con backoff exponencial
- Rate limiting por IP (5 peticiones/minuto)
- Limite de concurrencia (maximo 2 conversiones simultaneas)
- Limpieza automatica de archivos temporales con TTL
- Graceful shutdown con terminacion limpia de procesos FFmpeg
- Descarga con `showSaveFilePicker` (File System Access API) y fallback
- Notificaciones del sistema y sonido de completado
- Atajos de teclado (Ctrl+Enter, Escape, Ctrl+S)
- Interfaz responsive y accesible (WCAG AA)
- Live-reload en desarrollo

**Stack tecnologico:**

| Capa | Tecnologia |
|------|-----------|
| Servidor | Node.js con `node:http` nativo (sin frameworks) |
| Conversion | FFmpeg nativo (CLI) via `child_process.spawn` |
| Analisis | ffprobe para extraccion de metadatos |
| Frontend | HTML5 + CSS (BEM) + JavaScript vanilla (ES modules) |
| Iconos | Font Awesome 6 (CDN) |
| Toasts | Notyf (CDN) |
| Tipografia | Inter (Google Fonts) |
| Tests | Vitest |

---

## 2. Requisitos del sistema

| Requisito | Version minima | Verificacion |
|-----------|---------------|-------------|
| Node.js | 18.0+ | `node --version` |
| npm | 9.0+ | `npm --version` |
| FFmpeg | 5.0+ | `ffmpeg -version` |
| ffprobe | (incluido con FFmpeg) | `ffprobe -version` |

**Instalacion de FFmpeg en macOS:**

```bash
brew install ffmpeg
```

**Instalacion de FFmpeg en Ubuntu/Debian:**

```bash
sudo apt update && sudo apt install ffmpeg
```

**Espacio en disco recomendado:** minimo 5 GB libres. Los archivos MOV de entrada pueden ocupar varios GB y los archivos temporales (entrada + salida) requieren el doble del tamaño del archivo original durante la conversion.

---

## 3. Instalacion y arranque

### 3.1 Instalacion

```bash
cd /Users/imac_mini_javi/Documents/WEB/FRONTEND_TOOLS/VideoMobMp4
npm install
```

Este comando instala las dependencias listadas en `package.json`:
- `multer` v2.1.1 — declarada pero no usada directamente (el servidor usa un parser multipart propio)
- `uuid` v13.0.0 — generacion de identificadores UUID v4 para los jobs

### 3.2 Arranque con script automatico (recomendado)

```bash
./run_app.sh
```

El script `run_app.sh` realiza las siguientes verificaciones y acciones:

1. Verifica que `node`, `npm` y `ffmpeg` estan instalados
2. Instala dependencias si `node_modules/` no existe
3. Busca un puerto libre empezando en 5173 (usando `lsof`)
4. Arranca el servidor con `node server.mjs`
5. Muestra banner con la URL del servidor

### 3.3 Arranque manual

```bash
npm start           # Puerto por defecto: 5173
PORT=8080 npm start # Puerto personalizado
```

### 3.4 Modo desarrollo (con auto-restart)

```bash
npm run dev
```

Usa `node --watch` para reiniciar el servidor automaticamente cuando cambian archivos `.mjs`.

### 3.5 Desactivar apertura automatica del navegador

```bash
NO_OPEN=1 npm start
```

---

## 4. Estructura del proyecto

```
VideoMobMp4/
├── server.mjs                     # Servidor HTTP + API + Jobs + FFmpeg
├── package.json                   # Configuracion npm y scripts
├── package-lock.json              # Lockfile de dependencias
├── run_app.sh                     # Script de arranque con port scanning
├── .gitignore                     # Exclusiones de git
├── .env.example                   # Variables de entorno documentadas
├── CLAUDE.md                      # Guia rapida para Claude Code
├── README.md                      # Documentacion basica
├── DOCUMENTACION.md               # (este archivo)
├── PROMPT_VIDEOFORGE.md           # Prompt original de especificacion
│
├── public/
│   └── index.html                 # SPA — HTML5 con CDN deps
│
├── src/
│   ├── css/
│   │   └── app.css                # Dark theme, BEM, responsive
│   └── js/
│       ├── app.js                 # Logica UI: upload, SSE, estados, descarga
│       └── converterCore.js       # Funciones puras + presets + watermark + drawtext
│   ├── img/
│   │   └── image.svg             # Placeholder SVG para marca de agua
│   └── fonts/
│       ├── MontserratAlternates-Regular.ttf
│       └── MontserratAlternates-Bold.ttf
│
├── tests/
│   └── unit/
│       ├── converterCore.test.js  # 186 tests (funciones puras, presets, watermark, drawtext)
│       └── server.test.js         # 7 tests de integracion de la API
│
├── e2e/
│   └── fixtures/
│       ├── generate-fixture.sh    # Script para generar videos de prueba
│       ├── test-small.mov         # 320x240, 2s (~1.4 MB)
│       ├── test-720p.mov          # 1280x720, 3s (~9.9 MB)
│       ├── test-1080p.mov         # 1920x1080, 3s (~16 MB)
│       └── test-not-mov.mp4       # Archivo MP4 para test de rechazo
│
├── uploads/                       # (temporal) Archivos MOV subidos
├── converted/                     # (temporal) Archivos MP4 generados
└── node_modules/                  # Dependencias npm
```

### Relacion entre archivos

```
index.html
  ├── carga → /src/css/app.css           (estilos)
  ├── carga → /src/js/app.js             (logica UI)
  │             └── importa → converterCore.js  (funciones puras)
  └── carga → CDNs: Font Awesome, Notyf, Inter

app.js
  ├── POST /api/convert    → server.mjs  (subida + creacion de job)
  ├── GET  /api/jobs/:id   → server.mjs  (SSE progreso)
  ├── POST /api/jobs/:id/cancel          (cancelacion)
  └── GET  /api/jobs/:id/download        (descarga MP4)

server.mjs
  ├── importa → converterCore.js         (validacion, CRF, formato)
  ├── ejecuta → ffprobe                  (metadatos del video)
  └── ejecuta → ffmpeg                   (conversion MOV → MP4)
```

---

## 5. Arquitectura del sistema

### 5.1 Diagrama de flujo

```
 ┌──────────────────────────────────────────────────────────────┐
 │                        NAVEGADOR                             │
 │                                                              │
 │  index.html + app.css + app.js                               │
 │                                                              │
 │  ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌───────────┐ │
 │  │  Upload  │ → │ Settings │ → │ Progress │ → │  Result   │ │
 │  │  Panel   │   │  Panel   │   │  Panel   │   │  Panel    │ │
 │  └────┬─────┘   └────┬─────┘   └────┬─────┘   └─────┬─────┘ │
 │       │              │              │               │        │
 └───────┼──────────────┼──────────────┼───────────────┼────────┘
         │              │              │               │
    drag & drop    FormData POST   EventSource     fetch GET
         │              │           (SSE)              │
 ════════╪══════════════╪══════════════╪═══════════════╪════════
         │              │              │               │
 ┌───────┼──────────────┼──────────────┼───────────────┼────────┐
 │       ▼              ▼              ▼               ▼        │
 │                    SERVIDOR (server.mjs)                      │
 │                                                              │
 │  ┌──────────────────────────────────────────────────────┐    │
 │  │  HTTP Server (node:http)                              │    │
 │  │                                                       │    │
 │  │  Rutas:                                               │    │
 │  │  - Archivos estaticos (public/, src/, node_modules/)  │    │
 │  │  - POST /api/convert      → parseMultipart + createJob│    │
 │  │  - GET  /api/jobs/:id     → SSE progress stream       │    │
 │  │  - POST /api/jobs/:id/cancel  → kill FFmpeg           │    │
 │  │  - GET  /api/jobs/:id/download → stream MP4           │    │
 │  │  - GET  /api/health       → status check              │    │
 │  │  - GET  /api/livereload   → SSE dev reload            │    │
 │  └──────────────────────────────────────────────────────┘    │
 │                                                              │
 │  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐   │
 │  │  Jobs Map    │    │   FFprobe    │    │    FFmpeg     │   │
 │  │              │    │              │    │               │   │
 │  │  id → {      │ →  │  Analizar    │ → │  Convertir    │   │
 │  │    state,    │    │  metadatos   │    │  MOV → MP4    │   │
 │  │    progress, │    │  del video   │    │  (libx264     │   │
 │  │    metadata, │    │              │    │   + AAC +     │   │
 │  │    ...       │    │              │    │   faststart)  │   │
 │  │  }           │    │              │    │               │   │
 │  └──────────────┘    └──────────────┘    └───────────────┘   │
 │                                                              │
 │  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐   │
 │  │  Rate Limit  │    │  Cleanup     │    │  Heartbeat    │   │
 │  │  (por IP)    │    │  Timer       │    │  Timer        │   │
 │  │  5 req/min   │    │  cada 5 min  │    │  cada 15s     │   │
 │  └──────────────┘    └──────────────┘    └───────────────┘   │
 │                                                              │
 └──────────────────────────────────────────────────────────────┘
         │                                         │
         ▼                                         ▼
   ┌──────────┐                              ┌──────────┐
   │ uploads/ │                              │converted/│
   │ (MOV)    │                              │ (MP4)    │
   └──────────┘                              └──────────┘
```

### 5.2 Principios de diseño

1. **Sin frameworks**: servidor HTTP nativo (`node:http`), JavaScript vanilla en frontend, CSS puro con BEM. Esto minimiza dependencias, reduce la superficie de ataque y maximiza el control.

2. **Funciones puras separadas**: toda la logica de validacion, calculo y formato esta en `converterCore.js`, un modulo sin dependencias de DOM ni de Node.js. Esto permite reutilizarlo en ambos lados (servidor y navegador) y testearlo facilmente con Vitest.

3. **Arquitectura basada en Jobs**: cada conversion es un "job" con un ciclo de vida definido (`queued` → `probing` → `converting` → `done`|`error`|`cancelled`). Los jobs se almacenan en un `Map` en memoria con limpieza automatica por TTL.

4. **Comunicacion por SSE**: el progreso se transmite en tiempo real mediante Server-Sent Events, con heartbeat para evitar timeout de proxies y reconexion automatica con backoff exponencial en el cliente.

---

## 6. Backend — server.mjs

### 6.1 Servidor HTTP nativo

El servidor usa `node:http` directamente, sin Express ni ningun framework. Se crea en la linea 445:

```javascript
export const server = http.createServer(async (req, res) => { ... });
```

El servidor se exporta como `export const server` para que los tests puedan importarlo y arrancarlo en un puerto aleatorio sin necesidad de ejecutar el proceso principal.

La logica de arranque (lineas 736-759) solo se ejecuta cuando el archivo se ejecuta directamente (no cuando se importa en tests):

```javascript
const __isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
if (__isMain) {
  // Arrancar watchers, timers, listener
}
```

**Puerto:** configurable via `process.env.PORT`, por defecto `5173`.

**Auto-open Chrome:** al arrancar, el servidor intenta abrir Chrome automaticamente en macOS (`open -a "Google Chrome"`), Windows (`start Chrome`) o Linux (`xdg-open`). Desactivable con `NO_OPEN=1`.

### 6.2 Sistema de archivos estaticos

El servidor sirve archivos estaticos desde tres directorios:
- `public/` — HTML principal
- `src/` — CSS y JavaScript del frontend
- `node_modules/` — dependencias del frontend (si las hubiera)

La ruta raiz `/` se mapea automaticamente a `/public/index.html`.

Los MIME types soportados se definen en un `Map` (lineas 46-61):

| Extension | MIME type |
|-----------|----------|
| `.html` | `text/html; charset=utf-8` |
| `.js`, `.mjs` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.wasm` | `application/wasm` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.ico` | `image/x-icon` |
| `.mp4` | `video/mp4` |
| `.mov` | `video/quicktime` |
| `.webm` | `video/webm` |

Extensiones no reconocidas se sirven como `application/octet-stream`.

Todos los archivos estaticos se sirven con `Cache-Control: no-store` para evitar problemas de cache en desarrollo.

### 6.3 Prevencion de path traversal

La funcion `safeResolve()` (lineas 64-70) previene ataques de directory traversal:

```javascript
function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]).split('#')[0];
  const requestPath = decoded === '/' ? '/public/index.html' : decoded;
  const absPath = path.resolve(ROOT_DIR, '.' + requestPath);
  if (!absPath.startsWith(ROOT_DIR)) return null;  // BLOQUEADO
  return absPath;
}
```

**Funcionamiento:**
1. Decodifica la URL (`%2F` → `/`, etc.)
2. Elimina query strings y fragmentos hash
3. Resuelve la ruta absoluta relativa a `ROOT_DIR`
4. Verifica que la ruta resuelta empieza con `ROOT_DIR`
5. Si la ruta escapa del directorio raiz → devuelve `null` → respuesta 403 Forbidden

Esto previene ataques como `/../../../etc/passwd` o `/%2e%2e%2f%2e%2e%2fetc%2fpasswd`.

### 6.4 API REST — Endpoints

#### `POST /api/convert`

**Proposito:** recibir un archivo MOV, validarlo, crear un job y comenzar la conversion.

**Request:**
- Content-Type: `multipart/form-data`
- Campos:
  - `video` (file, requerido): archivo MOV a convertir
  - `quality` (string, opcional): numero 1-100, default "75"
  - `resolution` (string, opcional): "original"|"1080p"|"720p"|"480p", default "original"
  - `preset` (string, opcional): "ultrafast"|"fast"|"medium"|"slow", default "medium"
  - `platform` (string, opcional): "custom"|"web"|"tiktok"|"instagram"|"youtube", default "custom"
  - `igFormat` (string, opcional): "reels"|"feed", default "reels" (solo aplica si platform="instagram")
  - `mirror` (string, opcional): "0"|"1", default "0" (espejo horizontal)
  - `watermark` (file, opcional): imagen para marca de agua (PNG, JPG, WebP, SVG)
  - `watermarkPosition` (string, opcional): "top-left"|"top-right"|"bottom-left"|"bottom-right"|"center", default "bottom-right"
  - `watermarkSize` (string, opcional): porcentaje del ancho del video (5-50), default "20"
  - `watermarkOpacity` (string, opcional): opacidad de la marca de agua (0.1-1.0), default "1"
  - `textWm` (string, opcional): texto para marca de agua de texto
  - `textWmFont` (string, opcional): "montserrat"|"montserrat-bold"|"arial"|"courier"|"times", default "arial"
  - `textWmSize` (string, opcional): tamaño en pixels (12-200), default "48"
  - `textWmColor` (string, opcional): color hex (#rrggbb), default "#ffffff"
  - `textWmOpacity` (string, opcional): opacidad (0.1-1.0), default "1"
  - `textWmPosition` (string, opcional): posicion (mismos valores que watermarkPosition + "custom:X:Y"), default "bottom-right"

**Validaciones en orden:**
1. Rate limiting por IP (5 req/min) → 429 si excedido
2. Limite de concurrencia (max 2 jobs activos) → 429 si excedido
3. Parseo multipart del body
4. Existencia del archivo → 400 si no hay archivo
5. Extension `.mov` (case-insensitive) → 400 si invalida
6. Magic bytes: `ftyp` en offset 4-7, subtipo valido en offset 8-11 → 400 si invalido
7. Tamaño maximo: 2 GB → 413 si excedido

**Response exitosa (200):**
```json
{
  "jobId": "184cc753-a227-4fbd-b369-fd92bafe0124",
  "statusUrl": "/api/jobs/184cc753-a227-4fbd-b369-fd92bafe0124"
}
```

**Respuestas de error:**

| Codigo | Condicion | Body |
|--------|-----------|------|
| 400 | Sin archivo | `{"error": "No se recibió ningún archivo."}` |
| 400 | Extension invalida | `{"error": "Solo se aceptan archivos .mov"}` |
| 400 | Magic bytes invalidos | `{"error": "El archivo no es un vídeo MOV válido"}` |
| 413 | Archivo > 2 GB | `{"error": "Archivo demasiado grande. Máximo: 2.0 GB"}` |
| 429 | Rate limit excedido | `{"error": "Demasiadas solicitudes. Espera un momento."}` |
| 429 | Servidor ocupado | `{"error": "Servidor ocupado, intenta en unos segundos."}` |

---

#### `GET /api/jobs/:jobId`

**Proposito:** stream SSE con el progreso de conversion en tiempo real.

**Response:** `text/event-stream` con eventos JSON.

**Eventos emitidos:**

1. **`metadata`** — inmediatamente tras completar ffprobe:
```json
{
  "type": "metadata",
  "data": {
    "duration": 10.5,
    "width": 1920,
    "height": 1080,
    "videoCodec": "prores",
    "audioCodec": "pcm_s16le",
    "fps": 30,
    "bitrate": 5000000,
    "fileSize": 6500000
  }
}
```

2. **`progress`** — cada vez que FFmpeg emite un bloque de progreso:
```json
{
  "type": "progress",
  "data": {
    "percent": 45,
    "fps": 120.5,
    "speed": "4.0x",
    "elapsed": 12,
    "eta": 15
  }
}
```

3. **`done`** — cuando la conversion termina exitosamente:
```json
{
  "type": "done",
  "data": {
    "downloadUrl": "/api/jobs/abc123/download",
    "outputSize": 77198,
    "outputSizeFormatted": "75.4 KB",
    "duration": 10.5,
    "savings": 95
  }
}
```

4. **`error`** — si ocurre un error:
```json
{
  "type": "error",
  "data": {
    "message": "El archivo está corrupto o no es un MOV válido",
    "code": "FFMPEG_ERROR"
  }
}
```

**Codigos de error posibles:** `NOT_FOUND`, `PROBE_ERROR`, `FFMPEG_ERROR`, `OUTPUT_ERROR`, `CANCELLED`, `SERVER_SHUTDOWN`.

**Reconexion:** si el cliente se reconecta a un job en curso, el servidor envia inmediatamente el estado actual (metadata + ultimo progreso o resultado final).

**Heartbeat:** cada 15 segundos se envia `:\n\n` (comentario SSE) para mantener la conexion viva a traves de proxies y balanceadores.

---

#### `POST /api/jobs/:jobId/cancel`

**Proposito:** cancelar una conversion en curso.

**Funcionamiento:**
1. Si el job tiene un proceso FFmpeg activo → envia `SIGTERM`
2. El handler `close` del proceso detecta la señal y limpia archivos parciales
3. Se emite evento SSE `{ type: "error", code: "CANCELLED" }` a todos los clientes

**Response exitosa (200):**
```json
{ "ok": true, "message": "Conversión cancelada" }
```

**Error (404):** si el jobId no existe.

---

#### `GET /api/jobs/:jobId/download`

**Proposito:** descargar el archivo MP4 resultante.

**Response exitosa (200):**
- Content-Type: `video/mp4`
- Content-Length: tamaño del archivo
- Content-Disposition: `attachment; filename="nombre_original_convertido.mp4"`
- Body: stream del archivo MP4

**Errores:**

| Codigo | Condicion |
|--------|-----------|
| 404 | Job no existe o no esta en estado `done` |
| 404 | Archivo ha expirado (eliminado por cleanup) |

El nombre del archivo descargado se construye como: nombre original sin `.mov` + `_convertido.mp4`. El nombre se sanitiza con `sanitizeFilename()` antes de enviarlo en el header.

---

#### `GET /api/health`

**Proposito:** verificar el estado del servidor y la disponibilidad de FFmpeg.

**Response (200):**
```json
{
  "status": "ok",
  "ffmpeg": true,
  "uptime": 12345,
  "activeJobs": 1,
  "totalJobs": 5,
  "version": "1.0.0"
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `status` | string | Siempre `"ok"` |
| `ffmpeg` | boolean | `true` si `ffmpeg -version` se ejecuta sin error |
| `uptime` | number | Segundos desde el arranque del proceso |
| `activeJobs` | number | Jobs en estado `probing` o `converting` |
| `totalJobs` | number | Total de jobs en memoria (incluye completados) |
| `version` | string | Version de la aplicacion |

---

#### `GET /api/livereload`

**Proposito:** SSE para recarga automatica del navegador en desarrollo.

**Funcionamiento:**
- El servidor vigila los directorios `src/` y `public/` con `fs.watch({recursive: true})`
- Cuando detecta un cambio en un archivo (con debounce de 150ms), envia `data: reload\n\n` a todos los clientes conectados
- Solo se activa cuando el servidor se ejecuta directamente (no en tests)
- El cliente (app.js) escucha este evento y ejecuta `location.reload()`

---

### 6.5 Sistema de Jobs

Cada conversion se gestiona como un "job" almacenado en un `Map` en memoria.

**Estructura completa de un Job:**

```javascript
{
  id: "184cc753-a227-4fbd-b369-fd92bafe0124",  // UUID v4
  state: "converting",         // Estado actual
  inputPath: "/ruta/uploads/184cc753_video.mov",
  outputPath: "/ruta/converted/184cc753.mp4",
  originalFilename: "Mi Video.mov",
  sanitizedFilename: "Mi_Video.mov",
  quality: 75,                 // 1-100
  resolution: "1080p",         // "original"|"1080p"|"720p"|"480p"
  preset: "medium",            // "ultrafast"|"fast"|"medium"|"slow"
  platform: "custom",          // "custom"|"web"|"tiktok"|"instagram"|"youtube"
  igFormat: "reels",           // "reels"|"feed" (solo para Instagram)
  mirror: false,               // true = aplicar espejo horizontal (hflip)
  watermarkPath: null,         // Ruta al archivo de imagen (null si no hay)
  watermarkPosition: "bottom-right",  // Posición de la marca de agua
  watermarkSize: 20,           // Porcentaje del ancho del video (5-50)
  watermarkOpacity: 1,         // Opacidad de la marca de agua (0.1-1.0)
  textWm: {                    // Marca de agua de texto (null si no hay)
    text: "Mi Logo",
    font: "montserrat",
    size: "64",
    color: "#ff0000",
    opacity: "0.7",
    position: "bottom-right"   // O "custom:X:Y"
  },
  metadata: {                  // De ffprobe (null hasta que complete)
    duration: 10.5,
    width: 1920,
    height: 1080,
    videoCodec: "prores",
    audioCodec: "pcm_s16le",
    fps: 30,
    bitrate: 5000000,
    fileSize: 6500000
  },
  progress: {                  // Ultimo progreso reportado
    percent: 45,
    fps: 120.5,
    speed: "4.0x",
    elapsed: 12,
    eta: 15
  },
  ffmpegProcess: ChildProcess,  // Referencia al proceso FFmpeg (para cancelacion)
  sseClients: Set<Response>,    // Clientes SSE conectados a este job
  createdAt: 1711543822105,     // Date.now() al crear
  completedAt: null,            // Date.now() al completar/error/cancelar
  error: null                   // Mensaje de error (string) o null
}
```

**Diagrama de estados:**

```
            POST /api/convert
                  │
                  ▼
             ┌─────────┐
             │ queued   │
             └────┬─────┘
                  │ processJob()
                  ▼
             ┌─────────┐
             │ probing  │ ← ffprobe extrae metadatos
             └────┬─────┘
                  │ exito
                  ▼
             ┌───────────┐        POST /cancel
             │converting │ ─────────────────────► ┌───────────┐
             └─────┬─────┘                        │ cancelled │
                   │                              └───────────┘
            ┌──────┼──────┐
            │             │
         exito          error
            │             │
            ▼             ▼
       ┌─────────┐  ┌─────────┐
       │  done   │  │  error  │
       └─────────┘  └─────────┘
```

**Limpieza automatica:**
- Un `setInterval` cada 5 minutos (configurable via `CLEANUP_INTERVAL_MIN`)
- Elimina jobs en estado terminal (`done`, `error`, `cancelled`) cuyo `completedAt` sea mayor a 10 minutos (configurable via `JOB_TTL_MIN`)
- Elimina los archivos temporales asociados (`inputPath` y `outputPath`)

**Limite de concurrencia:**
- Maximo 2 jobs activos simultaneamente (configurable via `MAX_CONCURRENT_JOBS`)
- Un job se considera "activo" si su estado es `probing` o `converting`
- Si se excede el limite → respuesta 429

### 6.6 Pipeline de conversion FFmpeg

La conversion se ejecuta en dos pasos secuenciales:

#### Paso 1: Analisis con ffprobe

```bash
ffprobe -v quiet -print_format json -show_format -show_streams input.mov
```

La funcion `probeFile()` (lineas 195-210) ejecuta ffprobe como proceso hijo, captura stdout, y parsea la salida JSON con `parseFFprobeOutput()` para extraer:

- `duration`: duracion en segundos
- `width`, `height`: resolucion
- `videoCodec`, `audioCodec`: nombres de codecs
- `fps`: frames por segundo (calculado desde `r_frame_rate`, ej: "30000/1001" → 29.97)
- `bitrate`: bitrate total
- `fileSize`: tamaño del archivo

Estos metadatos se almacenan en `job.metadata` y se envian al cliente como primer evento SSE `{ type: "metadata" }`.

#### Paso 2: Conversion con FFmpeg

La funcion `startConversion()` construye y ejecuta el comando FFmpeg. Hay dos paths:

**Path Personalizado** (platform = "custom"):
```bash
ffmpeg -i input.mov \
  -c:v libx264 -crf 21 -preset medium \
  -c:a aac -b:a 128k \
  -movflags +faststart -pix_fmt yuv420p \
  [-vf scale=1920:-2[,hflip]] \
  -progress pipe:1 -y output.mp4
```

**Path Plataforma** (platform = "web"|"tiktok"|"instagram"|"youtube"):
Los args se generan con `buildPlatformArgs()` de `converterCore.js`, que aplica automaticamente profile, level, bitrate cap, fps cap, crop de aspect ratio y scale segun la plataforma seleccionada.

```bash
# Ejemplo: TikTok con espejo
ffmpeg -i input.mov \
  -c:v libx264 -crf 21 -preset medium \
  -profile:v main -level 4.0 \
  -vf crop=608:1080,hflip -r 30 \
  -maxrate 2500k -bufsize 5000k \
  -c:a aac -b:a 128k \
  -movflags +faststart -pix_fmt yuv420p \
  -progress pipe:1 -y output.mp4
```

Si `mirror=true`, el filtro `hflip` se inyecta en la cadena `-vf` (en ambos paths).

**Con marca de agua** (si `watermarkPath` presente):

Cuando hay marca de agua, se usa `-filter_complex` en lugar de `-vf` para manejar dos inputs:

```bash
ffmpeg -i input.mov -i logo.png \
  -filter_complex "[0:v]{filtros previos}[main];[1:v]scale=iw*20/100:-1[wm];[main][wm]overlay=W-w-10:H-h-10[v]" \
  -map "[v]" -map 0:a? \
  -c:v libx264 -crf 21 ... -y output.mp4
```

La cadena `-vf` existente (scale, crop, hflip) se integra como primer paso del grafo `filter_complex`. Las posiciones disponibles son (iguales para imagen y texto, incluyendo formato `custom:X:Y` con pixels absolutos):

La posicion tambien acepta formato `custom:X:Y` con coordenadas absolutas en pixels del video, generadas al arrastrar la marca de agua en el preview interactivo.

| Posicion | Coordenadas overlay |
|----------|-------------------|
| Arriba izquierda | `10:10` |
| Arriba derecha | `W-w-10:10` |
| Abajo izquierda | `10:H-h-10` |
| Abajo derecha | `W-w-10:H-h-10` |
| Centro | `(W-w)/2:(H-h)/2` |
| Personalizado | `X:Y` (pixels absolutos, desde drag) |

**Con marca de agua de texto** (si `textWm` presente):

El texto se renderiza con el filtro `drawtext` de FFmpeg. Se añade a la cadena `-vf` o al final del `-filter_complex` si hay marca de agua de imagen activa:

```bash
# Solo texto
ffmpeg -i input.mov \
  -vf "drawtext=fontfile=/ruta/fonts/MontserratAlternates-Regular.ttf:text='Mi Logo':fontsize=64:fontcolor=#ff0000@0xb3:x=W-w-10:y=H-h-10" \
  -c:v libx264 ... -y output.mp4

# Texto + imagen watermark (encadenado en filter_complex)
... [main][wm]overlay=...[v2];[v2]drawtext=...[v]
```

Fuentes disponibles: Montserrat Alternates (regular/bold) via `fontfile=` con TTF embebido en `src/fonts/`, o Arial/Courier/Times via `font=` (fuentes del sistema). El color incluye opacidad como hex alpha: `#rrggbb@0xAA`.

**Flags explicados:**

| Flag | Valor | Proposito |
|------|-------|----------|
| `-c:v` | `libx264` | Codec de video H.264, el mas compatible |
| `-crf` | 18-35 | Constant Rate Factor: controla calidad (menor = mejor) |
| `-preset` | `ultrafast`/`fast`/`medium`/`slow` | Velocidad vs compresion |
| `-c:a` | `aac` | Codec de audio AAC |
| `-b:a` | `128k` | Bitrate de audio fijo: 128 kbps |
| `-movflags` | `+faststart` | Mueve el atomo moov al inicio del MP4 para reproduccion web inmediata |
| `-pix_fmt` | `yuv420p` | Formato de pixel mas compatible (requerido por muchos reproductores) |
| `-vf` | `scale=W:-2` | Redimensionar manteniendo aspect ratio. `-2` asegura altura par |
| `-progress` | `pipe:1` | Emitir progreso parseable por stdout |
| `-y` | | Sobrescribir archivo de salida sin preguntar |

**Mapeo de calidad (CRF perceptual):**

La funcion `qualityToCRF()` convierte el valor del slider (1-100) a CRF de FFmpeg (35-18) usando una curva perceptual:

```javascript
const normalized = (q - 1) / 99;       // 0.0 a 1.0
const curved = Math.pow(normalized, 0.7); // curva perceptual
const crf = Math.round(35 - curved * 17); // 35 → 18
```

Justificacion: un mapeo lineal (1→51, 100→0) desperdicia la mayor parte del rango, ya que CRF < 18 es visualmente indistinguible de lossless y CRF > 35 produce artefactos severos. La curva `pow(0.7)` da mas granularidad en la zona 60-100 (CRF 18-23) donde el ojo humano es mas sensible a diferencias de calidad.

| Slider | CRF | Calidad percibida |
|--------|-----|-------------------|
| 100 | 18 | Maxima (visualmente lossless) |
| 75 | ~21 | Alta (recomendado para web) |
| 50 | ~24 | Media (buen balance tamaño/calidad) |
| 25 | ~29 | Baja (archivos muy pequeños) |
| 1 | 35 | Minima (artefactos visibles) |

**Resolucion — proteccion contra ampliacion:**

La funcion `buildResolutionArgs()` solo reduce la resolucion, nunca la amplia. Si el video de entrada es 720p y se selecciona 1080p, se mantiene la resolucion original:

```javascript
if (!targetW || inputWidth <= targetW) return [];  // No ampliar
return ['-vf', `scale=${targetW}:-2`];
```

El valor `-2` en la escala asegura que la altura resultante sea divisible por 2, requisito del codec H.264.

**Parseo de progreso:**

FFmpeg con `-progress pipe:1` escribe bloques de texto en stdout:

```
frame=120
fps=30.0
total_size=1234567
out_time_us=4000000
speed=2.5x
progress=continue
```

El servidor parsea estos bloques linea a linea, acumulando pares clave=valor hasta encontrar `progress=continue` (o `progress=end`). En ese punto calcula:

- `percent = (out_time_us / (duracion_total * 1_000_000)) * 100`
- `eta = (elapsed / percent) * (100 - percent)`

Y emite un evento SSE `{ type: "progress" }` con los datos actualizados.

### 6.7 Parser multipart

El servidor incluye un parser multipart propio en lugar de usar `multer`. Este parser:

1. Extrae el boundary del header `Content-Type`
2. Acumula chunks del body verificando que no excedan `MAX_FILE_SIZE`
3. Divide el buffer por boundaries
4. Para cada parte, separa headers del body por `\r\n\r\n`
5. Identifica campos de formulario (por `name="..."`) y archivos (por `filename="..."`)
6. Retorna `{ fields, files, fileData, fileFilename }` — `files` es un objeto keyed por nombre de campo (soporta multiples archivos: `video` + `watermark`)

Si el tamaño total excede `MAX_FILE_SIZE`, destruye la conexion y devuelve error `FILE_TOO_LARGE`.

### 6.8 Server-Sent Events (SSE)

El servidor implementa SSE en dos endpoints:

1. **`/api/jobs/:id`** — progreso de conversion
2. **`/api/livereload`** — recarga automatica en desarrollo

Cada respuesta SSE se configura con estos headers:
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Los clientes SSE se almacenan en un `Set` por job (`job.sseClients`) o globalmente (`liveReloadClients`). Se eliminan automaticamente cuando la conexion se cierra (`req.on('close', ...)`).

**Heartbeat:** un `setInterval` cada 15 segundos envia `:\n\n` (comentario SSE, ignorado por el navegador) a todos los clientes conectados. Esto previene que proxies, balanceadores o firewalls cierren la conexion por inactividad.

### 6.9 Live-reload (desarrollo)

El sistema de live-reload (lineas 83-96) funciona asi:

1. `fs.watch()` vigila `src/` y `public/` recursivamente
2. Cuando detecta un cambio, llama a `debouncedReload()`
3. `debouncedReload()` espera 150ms de inactividad (debounce) para evitar multiples reloads por guardados rapidos
4. Tras el debounce, `notifyLiveReload()` envia `data: reload\n\n` a todos los clientes SSE conectados en `/api/livereload`
5. El cliente (app.js linea 496-505) recibe el evento y ejecuta `location.reload()`

Solo se activa cuando el servidor se ejecuta directamente (`__isMain`), no cuando se importa en tests.

### 6.10 Rate limiting

Implementacion inline sin dependencias externas (lineas 98-112):

```javascript
const rateLimits = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000; // 1 minuto
```

Cada IP puede hacer un maximo de 5 peticiones POST a `/api/convert` por minuto. La ventana se resetea automaticamente. Si se excede → 429.

### 6.11 Logging estructurado

La funcion `log()` (lineas 39-43) escribe a stdout con formato:

```
[2026-03-27T14:30:00.000Z] [INFO]  Job 184cc753: Conversión iniciada (1080p, CRF 21)
[2026-03-27T14:30:10.000Z] [ERROR] Job 184cc753: FFmpeg exit code 1: Invalid data
```

Formato: `[ISO timestamp] [NIVEL]  [Job ID (8 chars):] mensaje`

Niveles usados:
- `INFO`: operaciones normales (upload recibido, conversion iniciada/completada, cleanup)
- `WARN`: (reservado para uso futuro)
- `ERROR`: fallos de ffprobe, ffmpeg, o errores del servidor

### 6.12 Graceful shutdown

La funcion `gracefulShutdown()` (lineas 694-733) se ejecuta al recibir `SIGTERM` o `SIGINT`:

1. Deja de aceptar nuevas conexiones (`server.close()`)
2. Para cada job activo con proceso FFmpeg:
   - Notifica a los clientes SSE: `{ type: "error", code: "SERVER_SHUTDOWN" }`
   - Envia `SIGTERM` al proceso FFmpeg
3. Cierra todas las conexiones SSE (jobs y live-reload)
4. Cancela los timers de cleanup y heartbeat
5. Espera 2 segundos para que los procesos terminen
6. Limpia archivos temporales de jobs no completados
7. Ejecuta `process.exit(0)`

---

## 7. Funciones puras — converterCore.js

Archivo: `src/js/converterCore.js`

Este modulo contiene funciones puras y constantes sin dependencias de DOM ni de Node.js. Se importa tanto en el servidor (`server.mjs`) como en el cliente (`app.js`). Incluye funciones de validacion, formato, mapeo de calidad, y el sistema de presets por plataforma.

### 7.1 `validateMovExtension(filename)`

**Proposito:** verificar que el nombre de archivo tiene extension `.mov`.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `filename` | string | Nombre del archivo |
| **Retorno** | boolean | `true` si termina en `.mov` (case-insensitive) |

Devuelve `false` para `null`, `undefined` o string vacio.

### 7.2 `validateMovMagicBytes(bytes)`

**Proposito:** verificar los magic bytes del archivo para confirmar que es un contenedor MOV/QuickTime valido.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `bytes` | Uint8Array | Primeros 12-16 bytes del archivo |
| **Retorno** | `{ valid: boolean, reason?: string }` | Resultado de validacion |

**Logica:**
- Verifica que `bytes[4..7]` sea `"ftyp"` (hex: `66 74 79 70`)
- Verifica que `bytes[8..11]` sea uno de los subtipos validos:
  - `"qt  "` — MOV puro (QuickTime)
  - `"isom"` — ISO Base Media File Format
  - `"mp42"` — MP4 v2
  - `"MSNV"` — Sony MOV
  - `"M4V "` — Apple M4V

### 7.3 `qualityToCRF(quality)`

**Proposito:** convertir valor del slider de calidad (1-100) a CRF de FFmpeg.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `quality` | number | Valor 1-100 (se clampea al rango) |
| **Retorno** | number | Valor CRF entero (18-35) |

Usa curva perceptual `pow(0.7)`. Valores fuera de rango se clampean: `quality <= 0` → CRF 35, `quality >= 101` → CRF 18.

### 7.4 `buildResolutionArgs(target, inputWidth, inputHeight)`

**Proposito:** generar argumentos FFmpeg para reescalar el video.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `target` | string | `"original"`, `"1080p"`, `"720p"`, `"480p"` |
| `inputWidth` | number | Ancho del video original |
| `inputHeight` | number | Alto del video original |
| **Retorno** | string[] | Array de args FFmpeg, ej: `["-vf", "scale=1280:-2"]` o `[]` |

Mapeo de resoluciones:
| Target | Ancho objetivo |
|--------|---------------|
| `"1080p"` | 1920 |
| `"720p"` | 1280 |
| `"480p"` | 854 |

Proteccion: si `inputWidth <= targetWidth`, devuelve `[]` (no ampliar).

### 7.5 `formatFileSize(bytes)`

**Proposito:** formatear bytes a string legible.

| Entrada | Salida |
|---------|--------|
| `0` | `"0 B"` |
| `1023` | `"1023 B"` |
| `1024` | `"1.0 KB"` |
| `1536` | `"1.5 KB"` |
| `1048576` | `"1.0 MB"` |
| `1073741824` | `"1.0 GB"` |

Usa base 1024 (no 1000). Unidades: B, KB, MB, GB, TB.

### 7.6 `formatDuration(seconds)`

**Proposito:** formatear segundos a `MM:SS` o `H:MM:SS`.

| Entrada | Salida |
|---------|--------|
| `30` | `"00:30"` |
| `90` | `"01:30"` |
| `3661` | `"1:01:01"` |
| `0` | `"00:00"` |
| `NaN` | `"00:00"` |

### 7.7 `formatETA(seconds)`

**Proposito:** formatear tiempo restante estimado en español.

| Entrada | Salida |
|---------|--------|
| `45` | `"45s restantes"` |
| `150` | `"2m 30s restantes"` |
| `60` | `"1m restantes"` |
| `0` | `""` |
| `NaN` | `""` |

### 7.8 `calculateSavings(originalBytes, convertedBytes)`

**Proposito:** calcular el ahorro de tamaño tras la conversion.

**Retorno:** `{ savedBytes: number, savedPercent: number, isSmaller: boolean }`

Ejemplo: `calculateSavings(1000, 700)` → `{ savedBytes: 300, savedPercent: 30, isSmaller: true }`

### 7.9 `parseFFprobeOutput(jsonString)`

**Proposito:** parsear la salida JSON de ffprobe y extraer metadatos relevantes.

**Retorno:** `{ duration, width, height, videoCodec, audioCodec, fps, bitrate, fileSize }` o `null` si el JSON es invalido o no contiene video stream.

Calculo de FPS: convierte `r_frame_rate` (ej: `"30000/1001"`) a decimal (ej: `29.97`).

### 7.10 `sanitizeFilename(name)`

**Proposito:** limpiar nombres de archivo para uso seguro.

**Operaciones:**
1. Reemplaza `..` por `_` (previene path traversal)
2. Reemplaza caracteres no seguros por `_` (mantiene `[a-zA-Z0-9._\-() ]`)
3. Trunca a 200 caracteres

Devuelve `"file"` para `null`/`undefined`.

### 7.11 `PLATFORM_PRESETS`

**Tipo:** objeto exportado (constante).

Define los presets de conversion por plataforma. Cada clave es un ID de plataforma (`custom`, `web`, `tiktok`, `instagram`, `youtube`) y su valor es un objeto con:

| Propiedad | Tipo | Descripcion |
|-----------|------|-------------|
| `id` | string | Identificador del preset |
| `label` | string | Nombre visible (en español) |
| `description` | string | Descripcion corta |
| `icon` | string | Clase Font Awesome |
| `maxWidth` | number\|null | Ancho maximo de salida |
| `maxHeight` | number\|null | Alto maximo de salida |
| `maxFps` | number\|null | FPS maximo (null = mantener original) |
| `maxBitrateKbps` | number\|null | Bitrate maximo en kbps (null = solo CRF) |
| `audioBitrateKbps` | number | Bitrate de audio en kbps |
| `profile` | string\|null | Perfil H.264 (`main`, `high`) |
| `level` | string\|null | Nivel H.264 (`4.0`, `4.1`) |
| `bframes` | number\|null | Valor `-bf` |
| `aspectRatio` | string\|null | Aspect ratio destino (`9:16`, null = mantener) |

El preset `custom` tiene todos los overrides a `null` (modo manual).

### 7.12 `getPlatformPreset(platformId)`

**Proposito:** lookup de preset con fallback a `custom` para IDs desconocidos.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `platformId` | string | ID del preset |
| **Retorno** | object | Objeto preset de `PLATFORM_PRESETS` |

### 7.13 `buildVideoFilterChain(preset, inputWidth, inputHeight, igFormat)`

**Proposito:** construir la cadena de filtros `-vf` para un preset de plataforma.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `preset` | object | Objeto de `PLATFORM_PRESETS` |
| `inputWidth` | number | Ancho del video original |
| `inputHeight` | number | Alto del video original |
| `igFormat` | string | `"reels"` o `"feed"` (solo para Instagram) |
| **Retorno** | string | Cadena de filtros (ej: `"crop=608:1080,scale=1080:-2"`) o `""` |

**Logica:**
1. Si Instagram Feed → fuerza aspect ratio 1:1 y max 1080x1080
2. Si el preset tiene `aspectRatio` → calcula crop centrado al aspect ratio destino
3. Si las dimensiones resultantes exceden `maxWidth`/`maxHeight` → añade scale (solo reduce, nunca amplia)
4. Todas las dimensiones se redondean a numeros pares (requisito H.264)

### 7.14 `buildPlatformArgs(platformId, quality, inputWidth, inputHeight, inputFps, igFormat)`

**Proposito:** generar el array completo de argumentos FFmpeg para un preset de plataforma.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `platformId` | string | ID del preset |
| `quality` | number | Valor del slider (1-100) |
| `inputWidth` | number | Ancho del video original |
| `inputHeight` | number | Alto del video original |
| `inputFps` | number | FPS del video original |
| `igFormat` | string | `"reels"` o `"feed"` |
| **Retorno** | string[]\|null | Array de args FFmpeg, o `null` si platformId es `"custom"` |

**Args generados:**
- `-c:v libx264 -crf {CRF} -preset medium`
- `-profile:v`, `-level`, `-bf` (si aplican)
- `-vf` con la cadena de `buildVideoFilterChain()` (si no vacia)
- `-r {maxFps}` (si FPS de entrada excede el limite)
- `-maxrate {kbps}k -bufsize {2x}k` (si el preset tiene bitrate cap)
- `-c:a aac -b:a {audioBitrate}k`

### 7.15 `WATERMARK_POSITIONS`

**Tipo:** objeto exportado (constante).

Define las 5 posiciones disponibles para la marca de agua:

| Clave | Label | Coordenada X | Coordenada Y |
|-------|-------|:------------:|:------------:|
| `top-left` | Arriba izquierda | `10` | `10` |
| `top-right` | Arriba derecha | `W-w-10` | `10` |
| `bottom-left` | Abajo izquierda | `10` | `H-h-10` |
| `bottom-right` | Abajo derecha | `W-w-10` | `H-h-10` |
| `center` | Centro | `(W-w)/2` | `(H-h)/2` |

Las coordenadas usan expresiones FFmpeg: `W` = ancho del video, `H` = alto del video, `w` = ancho de la marca, `h` = alto de la marca.

### 7.16 `WATERMARK_SIZES`

**Tipo:** objeto exportado (constante).

Define los tamaños predefinidos para la marca de agua (porcentaje del ancho del video): 10%, 15%, 20%, 25%, 30%. El slider de la UI permite valores de 5 a 50.

### 7.17 `buildWatermarkFilter(position, sizePct, opacity)`

**Proposito:** generar los dos fragmentos de filtro FFmpeg necesarios para aplicar la marca de agua.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `position` | string | Clave de `WATERMARK_POSITIONS` (fallback a `"bottom-right"`) |
| `sizePct` | number\|string | Porcentaje del ancho del video (clamped 5-50, default 20) |
| `opacity` | number\|string | Opacidad 0.1-1.0 (default 1). Valores < 1 aplican transparencia |
| **Retorno** | `{ scaleFilter: string, overlayFilter: string }` | Fragmentos para `-filter_complex` |

**Retorno:**
- `scaleFilter`: cadena de filtros para el stream de la marca de agua `[1:v]`:
  - Opacidad 1 (100%): `"[1:v]scale=iw*{pct}/100:-1[wm]"`
  - Opacidad < 1: `"[1:v]scale=iw*{pct}/100:-1,format=rgba,colorchannelmixer=aa={opacity}[wm]"`
- `overlayFilter`: `"[0:v][wm]overlay={x}:{y}"` — superpone la marca de agua en la posicion indicada

**Manejo de entradas invalidas:**
- Posicion desconocida/null/undefined → fallback a `bottom-right`
- Tamaño no numerico/NaN/undefined/null → default 20
- Tamaño fuera de rango → clamped a 5 (min) o 50 (max)
- Opacidad no numerica/NaN/undefined/null → default 1 (100%, sin alpha step)
- Opacidad fuera de rango → clamped a 0.1 (min) o 1.0 (max)
- Opacidad se redondea a 2 decimales

### 7.18 `parseWatermarkPosition(position)`

**Proposito:** parsear posicion de marca de agua, soportando presets y formato custom.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `position` | string | Clave de preset (`"top-left"`, etc.) o formato `"custom:X:Y"` (pixels absolutos) |
| **Retorno** | `{ x: string, y: string }` | Coordenadas para FFmpeg overlay/drawtext |

Logica: si empieza con `custom:`, parsea X e Y como enteros no negativos. Si invalido o preset desconocido, fallback a `bottom-right`.

### 7.19 `WATERMARK_FONTS`

**Tipo:** objeto exportado (constante).

| Clave | Label | Archivo TTF | CSS (preview) |
|-------|-------|:-----------:|---------------|
| `montserrat` | Montserrat Alternates | `MontserratAlternates-Regular.ttf` | `'Montserrat Alternates', sans-serif` |
| `montserrat-bold` | Montserrat Alternates Bold | `MontserratAlternates-Bold.ttf` | `'Montserrat Alternates', sans-serif` |
| `arial` | Arial | (sistema) | `Arial, sans-serif` |
| `courier` | Courier | (sistema) | `'Courier New', Courier, monospace` |
| `times` | Times New Roman | (sistema) | `'Times New Roman', Times, serif` |

Fuentes con `file` usan `fontfile=` en FFmpeg (ruta al TTF). Fuentes del sistema (`file: null`) usan `font=` (fontconfig).

### 7.20 `escapeDrawtext(text)`

**Proposito:** escapar texto para el filtro `drawtext` de FFmpeg.

| Entrada | Salida |
|---------|--------|
| `Hello World` | `Hello World` |
| `10:30` | `10\:30` |
| `50%` | `50%%` |
| `it's` | `it\u2019s` |
| `null` / `undefined` | `""` |

### 7.21 `buildTextWatermarkFilter(text, fontSize, fontColor, fontFamily, position, opacity)`

**Proposito:** generar la cadena de filtro `drawtext` de FFmpeg para marca de agua de texto.

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `text` | string | Texto a superponer (se escapa automaticamente) |
| `fontSize` | number\|string | Tamaño en pixels (clamped 12-200, default 48) |
| `fontColor` | string | Color hex `#rrggbb` (fallback `#ffffff`) |
| `fontFamily` | string | Clave de `WATERMARK_FONTS` (fallback `arial`) |
| `position` | string | Preset o `custom:X:Y` (via `parseWatermarkPosition`) |
| `opacity` | number\|string | Opacidad 0.1-1.0 (default 1). Se codifica como hex alpha en el color |
| **Retorno** | string | Filtro drawtext completo, o `""` si texto vacio/null |

**Formato de salida:**
```
drawtext=fontfile=FONTDIR/MontserratAlternates-Regular.ttf:text='Mi Logo':fontsize=64:fontcolor=#ff0000@0xb3:x=W-w-10:y=H-h-10
```

El placeholder `FONTDIR/` es reemplazado por la ruta real en `server.mjs`. La opacidad se convierte a hex alpha (`0xff` = 100%, `0x80` = 50%).

---

## 8. Frontend — interfaz de usuario

### 8.1 HTML (public/index.html)

Archivo de 237 lineas. SPA (Single Page Application) con estructura semantica HTML5.

**Dependencias externas (CDN):**

| Recurso | URL | Proposito |
|---------|-----|----------|
| Inter font | Google Fonts | Tipografia principal |
| Font Awesome 6.4.0 | cdnjs.cloudflare.com | Iconos |
| Notyf 3 (CSS) | cdn.jsdelivr.net | Estilos de toasts |
| Notyf 3 (JS) | cdn.jsdelivr.net | Libreria de toasts |

**Secciones del DOM:**

| ID | Seccion | Visible cuando |
|----|---------|---------------|
| `panelUpload` | Zona de subida (drag & drop + file info) | `idle`, `configuring` |
| `panelSettings` | Opciones de conversion (plataforma, calidad, espejo, marca de agua imagen, marca de agua texto, preview unificado, resolucion, preset) | `configuring` |
| `panelProgress` | Barra de progreso + stats en tiempo real | `converting` |
| `panelResult` | Preview + comparativa + descarga | `done` |
| `panelError` | Mensaje de error + boton reintentar | `error` |

**Accesibilidad:**
- Atributo `lang="es"` en `<html>`
- Semantica: `<header>`, `<main>`, `<section>`, `<footer>`, `<fieldset>`, `<legend>`
- `aria-label` en todas las secciones
- `aria-live="polite"` en el panel de progreso
- `aria-live="assertive"` en el panel de error
- `role="progressbar"` con `aria-valuenow/min/max` en la barra
- `role="button"` y `tabindex="0"` en la zona de drag & drop
- `aria-hidden="true"` en el input file oculto
- `aria-label` en todos los controles (slider, selects)

**Logo SVG inline:**
```svg
<svg viewBox="0 0 40 40" width="40" height="40">
  <rect x="2" y="6" width="36" height="28" rx="4" stroke="currentColor" stroke-width="2.5"/>
  <polygon points="16,14 28,20 16,26" fill="currentColor"/>
</svg>
```
Representa un rectangulo de video con boton play.

### 8.2 CSS (src/css/app.css)

Archivo de 670 lineas. Dark theme con metodologia BEM.

**Paleta de colores:**

| Variable | Valor | Uso |
|----------|-------|-----|
| `--bg-base` | `#0D0D0D` | Fondo de pagina |
| `--bg-surface` | `#1A1A1A` | Fondo de paneles y header |
| `--bg-elevated` | `#242424` | Fondo de elementos elevados (cards, inputs) |
| `--border` | `#2A2A2A` | Bordes por defecto |
| `--border-hover` | `#3A3A3A` | Bordes al hacer hover |
| `--accent-primary` | `#7C3AED` | Color principal (violeta) — botones, slider, focus |
| `--accent-primary-hover` | `#6D28D9` | Hover del color principal |
| `--accent-secondary` | `#06B6D4` | Color secundario (cyan) — stats, meta cards |
| `--accent-success` | `#10B981` | Exito (verde) — resultado positivo |
| `--accent-danger` | `#EF4444` | Peligro (rojo) — errores, cancelar |
| `--accent-warning` | `#F59E0B` | Advertencia (amarillo) — archivo mas grande |
| `--text-primary` | `#F5F5F5` | Texto principal |
| `--text-secondary` | `#A0A0A0` | Texto secundario |
| `--text-muted` | `#666666` | Texto atenuado (hints, labels) |

**Tipografia:** `'Inter', system-ui, -apple-system, sans-serif`

**Breakpoints responsive:**

| Breakpoint | Cambios |
|------------|---------|
| `max-width: 480px` | Layout 1 columna, oculta preview y subtitulo, stats en grid 2x2, botones full-width |
| `min-width: 768px` | Settings en grid 2 columnas (calidad ocupa fila completa) |
| `min-width: 1024px` | Mas padding en main |

**Animaciones:**
- `fadeIn` (0.3s): paneles aparecen con fade + slide-up de 8px
- `transition: 0.3s ease`: todos los elementos interactivos
- `transition: width 0.5s ease`: barra de progreso suave
- `fa-spin`: icono de engranaje girando durante la conversion

**Barra de progreso:** gradiente de `--accent-primary` a `--accent-secondary`. Al completar, cambia a gradiente de `--accent-success` a `#34D399` (clase `progress__bar--done`).

### 8.3 JavaScript (src/js/app.js)

Archivo de 511 lineas. ES module vanilla.

**Importaciones:**
```javascript
import {
  validateMovExtension, validateMovMagicBytes, qualityToCRF,
  formatFileSize, formatDuration, formatETA, PLATFORM_PRESETS
} from './converterCore.js';
```

**Variables de estado globales:**

| Variable | Tipo | Proposito |
|----------|------|----------|
| `currentFile` | File\|null | Archivo MOV seleccionado actualmente |
| `currentJobId` | string\|null | UUID del job activo |
| `sseSource` | EventSource\|null | Conexion SSE activa |
| `downloadUrl` | string\|null | URL de descarga del resultado |
| `sseRetries` | number | Contador de reintentos SSE |
| `uiState` | string | Estado actual de la UI |
| `selectedPlatform` | string | Plataforma seleccionada (`"custom"`, `"web"`, `"tiktok"`, `"instagram"`, `"youtube"`) |
| `watermarkFile` | File\|null | Archivo de imagen para marca de agua |
| `watermarkCustomX/Y` | number\|null | Posicion relativa (0-1) de la marca de agua imagen (drag) |
| `textWmCustomX/Y` | number\|null | Posicion relativa (0-1) de la marca de agua texto (drag) |
| `isDraggingWm` | boolean | Flag de arrastre activo (imagen o texto) |
| `dragWmTarget` | Element\|null | Elemento que se esta arrastrando (`wmPreviewImg` o `wmPreviewText`) |

### 8.4 Maquina de estados de la UI

```
idle → configuring → converting → done
            ↑     ↘               ↗  │
            │       ←── error ──←    │
            └────────── Atrás ───────┘
```

La funcion `setState(state)` (lineas 67-95) controla la visibilidad de los paneles:

| Estado | Paneles visibles | Descripcion |
|--------|-----------------|-------------|
| `idle` | Upload (con dropzone) | Estado inicial, esperando archivo |
| `configuring` | Upload (con file info) + Settings | Archivo seleccionado, ajustando opciones |
| `converting` | Progress | Conversion en curso |
| `done` | Result | Conversion completada, descarga disponible |
| `error` | Error | Error ocurrido, opcion de reintentar |

### 8.5 Gestion de archivos y validacion

La funcion `handleFile(file)` (lineas 113-155) valida el archivo en tres pasos:

1. **Extension:** `validateMovExtension(file.name)` — rechaza si no es `.mov`
2. **Tamaño:** compara con 2 GB — rechaza con mensaje si excede
3. **Magic bytes:** lee los primeros 16 bytes con `file.slice(0, 16).arrayBuffer()` y llama a `validateMovMagicBytes()` — rechaza si no es un MOV valido

Si las tres validaciones pasan:
- Almacena el archivo en `currentFile`
- Muestra nombre y tamaño formateado
- Crea preview con `URL.createObjectURL(file)` en un elemento `<video>`
- Cambia al estado `configuring`
- Intenta leer la resolucion del video desde el elemento `<video>` (`loadedmetadata`)

**Drag & drop:**
- `dragover`: previene default y añade clase visual
- `dragleave`: quita clase visual
- `drop`: previene default, extrae `e.dataTransfer.files[0]`, llama a `handleFile()`

**Click:** el dropzone y el boton "Examinar" disparan `fileInput.click()`. El dropzone tambien responde a Enter y Space (accesibilidad).

### 8.6 Conexion SSE y reconexion

La funcion `connectSSE(jobId)` (lineas 230-252) establece la conexion:

```javascript
sseSource = new EventSource(`/api/jobs/${jobId}`);
```

**Eventos manejados:**
- `onmessage`: parsea JSON y despacha a `handleSSEEvent()`
- `onerror`: cierra la conexion e intenta reconectar

**Reconexion con backoff exponencial:**

```
Intento 1: espera 1 segundo
Intento 2: espera 2 segundos
Intento 3: espera 4 segundos
Intento 4: espera 8 segundos
Intento 5: espera 16 segundos
Sin mas reintentos tras 5 intentos
```

El contador `sseRetries` se resetea a 0 cuando se recibe un mensaje exitoso.

### 8.7 Sistema de descarga

El boton "Descargar MP4" (lineas 367-397) intenta dos metodos:

1. **`showSaveFilePicker`** (File System Access API):
   - Solo disponible en Chrome/Edge
   - Permite al usuario elegir ubicacion y nombre del archivo
   - Descarga el MP4 via `fetch()` → `blob` → `writable.write()`
   - Si el usuario cancela el dialogo (`AbortError`), no hace nada

2. **Fallback con `<a download>`:**
   - Crea un enlace temporal con `href=downloadUrl` y `download="nombre_convertido.mp4"`
   - Lo añade al DOM, hace click y lo elimina

### 8.8 Recuperacion de sesion

La funcion `tryRecoverSession()` (lineas 481-493) se ejecuta al cargar la pagina:

1. Busca `videomovmp4_jobId` en `sessionStorage`
2. Si existe, asume que habia una conversion en curso
3. Cambia al estado `converting` con texto "Reconectando..."
4. Conecta al SSE de ese jobId para recuperar el estado actual

El jobId se guarda en `sessionStorage` al iniciar una conversion y se elimina al completar, cancelar o producirse un error. Esto permite al usuario refrescar la pagina sin perder el seguimiento de la conversion.

### 8.9 Atajos de teclado

Registrados en el listener `keydown` del `document` (lineas 427-447):

| Atajo | Accion | Condicion |
|-------|--------|-----------|
| `Ctrl/Cmd + Enter` | Iniciar conversion | Estado `configuring` y archivo cargado |
| `Escape` | Cancelar conversion (con confirmacion) | Estado `converting` |
| `Ctrl/Cmd + S` | Descargar MP4 | Estado `done` y URL de descarga disponible |

Los atajos se muestran como tooltips en los botones correspondientes.

### 8.10 Notificaciones

**Toast (Notyf):**
- Exito: fondo verde `#10B981`, al completar conversion
- Error: fondo rojo `#EF4444`, al fallar validacion o conversion
- Posicion: esquina superior derecha
- Duracion: 4 segundos

**Notificacion del sistema:**

La funcion `notifyIfHidden()` (lineas 465-478) usa la Notification API del navegador:
- Solo se muestra si la pestaña no esta visible (`document.visibilityState === 'hidden'`)
- Si el permiso no ha sido solicitado, lo pide automaticamente
- Titulo: "VideoMovMp4"
- Mensaje: "Tu video esta listo para descargar"

**Sonido de completado:**

La funcion `playCompletionSound()` (lineas 450-462) genera un beep con Web Audio API:
- Frecuencia: 800 Hz
- Duracion: 0.3 segundos
- Volumen: 30% (0.3)
- Fade out exponencial
- No requiere ningun archivo de audio externo

---

## 9. Seguridad

### 9.1 Validacion de archivos (doble verificacion)

VideoMovMp4 no se fia solo de la extension del archivo. Implementa dos niveles de validacion:

1. **Extension:** verifica que el nombre termina en `.mov` (case-insensitive)
2. **Magic bytes:** lee los primeros 12+ bytes del archivo y verifica:
   - Offset 4-7: `"ftyp"` (66 74 79 70) — cabecera comun de contenedores ISO BMFF
   - Offset 8-11: subtipo valido (`"qt  "`, `"isom"`, `"mp42"`, `"MSNV"`, `"M4V "`)

Esto previene que un archivo malicioso renombrado a `.mov` sea procesado por FFmpeg.

### 9.2 Sanitizacion de nombres de archivo

Todos los nombres de archivo pasan por `sanitizeFilename()` antes de usarse en el sistema de archivos:
- Se eliminan secuencias `..` (path traversal)
- Se reemplazan caracteres no alfanumericos (excepto `.`, `-`, `_`, `()`, espacio) por `_`
- Se truncan a 200 caracteres

### 9.3 Prevencion de path traversal

La funcion `safeResolve()` verifica que cualquier ruta resuelta empiece con `ROOT_DIR`. Rutas como `/../../../etc/passwd` se bloquean con respuesta 403.

### 9.4 Rate limiting

Maximo 5 peticiones POST a `/api/convert` por IP por minuto. Previene abuso y ataques de denegacion de servicio a nivel de aplicacion.

### 9.5 Limite de concurrencia

Maximo 2 conversiones simultaneas. Previene el agotamiento de recursos del servidor (CPU, memoria, disco).

### 9.6 Limite de tamaño

Archivos mayores a 2 GB se rechazan durante el parseo multipart (la conexion se destruye si se excede).

### 9.7 Archivos temporales

- Los archivos subidos se almacenan con nombre `{uuid}_sanitized.mov`, no con el nombre original
- Los archivos convertidos se nombran `{uuid}.mp4`
- La limpieza automatica elimina archivos tras 10 minutos de completarse el job
- El graceful shutdown limpia archivos de jobs no completados

---

## 10. Tests

### 10.1 Framework y ejecucion

Framework: **Vitest** v4.1.2

```bash
npm test              # Ejecutar todos los tests (vitest run)
npm run test:watch    # Modo watch (vitest)
```

### 10.2 Tests de funciones puras (converterCore.test.js)

Archivo: `tests/unit/converterCore.test.js` — 186 tests.

| Grupo `describe` | Tests | Que verifica |
|-------------------|-------|-------------|
| `validateMovExtension` | 6 | Acepta `.mov`/`.MOV`, rechaza `.mp4`/`.avi`/vacío/null |
| `validateMovMagicBytes` | 6 | Acepta `ftyp+qt`/`isom`/`mp42`, rechaza bytes aleatorios/vacío/null |
| `qualityToCRF` | 7 | Mapeo perceptual correcto, clamping, siempre entero |
| `buildResolutionArgs` | 5 | Original → vacío, downscale correcto, no ampliar |
| `formatFileSize` | 6 | 0 B, bytes, KB, MB, GB |
| `formatDuration` | 5 | MM:SS, H:MM:SS, 0, NaN |
| `formatETA` | 4 | Segundos, minutos+segundos, 0, NaN |
| `sanitizeFilename` | 5 | Caracteres especiales, path traversal, truncar, null |
| `calculateSavings` | 3 | Porcentaje, isSmaller true/false |
| `parseFFprobeOutput` | 4 | JSON valido, invalido, extraccion de campos, sin video stream |
| `PLATFORM_PRESETS` | 3 | Claves esperadas, propiedades requeridas, custom.maxWidth null |
| `getPlatformPreset` | 2 | Lookup correcto, fallback a custom |
| `buildVideoFilterChain` | 9 | Crop 9:16 desde landscape, sin filtro para vertical nativo, no upscale, crop 1:1 Instagram Feed, scale Web 4K, sin filtro para dimensiones que encajan |
| `buildPlatformArgs` | 8 | Null para custom, profile/level por plataforma, fps cap, maxrate, YouTube bf/audio, calidad variable, codecs presentes |
| `WATERMARK_POSITIONS` | 7 | 5 posiciones presentes, propiedades label/x/y, coordenadas exactas por posicion |
| `WATERMARK_SIZES` | 2 | 5 tamaños de 10 a 30, labels con formato `N%` |
| `buildWatermarkFilter` | 46 | Estructura de retorno, formato scaleFilter/overlayFilter, cada posicion genera coordenadas correctas, tamaños predefinidos e intermedios, clamping min/max, entradas invalidas (null/undefined/NaN/string), posicion desconocida, combinaciones posicion+tamaño, formato FFmpeg sin espacios, ensamblaje filter_complex con filtros previos, opacidad (valores validos 0.1-1.0, clamping, default, entradas invalidas, redondeo 2 decimales, format=rgba+colorchannelmixer, integracion filter_complex con opacidad) |
| `parseWatermarkPosition` | 15 | Presets conocidos (top-left, bottom-right, center), custom valido (350:200, 0:0, 1920:1080), custom invalido (abc, incompleto, negativo, vacio), entradas invalidas (null, undefined, numero) |
| `buildWatermarkFilter custom` | 5 | Custom overlay coords, custom:0:0, preserva scaleFilter+opacidad, custom invalido fallback, filter_complex con custom |
| `WATERMARK_FONTS` | 4 | 5 fuentes presentes, label+css en cada una, TTF para Montserrat, null para sistema |
| `escapeDrawtext` | 9 | Texto normal, escape dos puntos, escape porcentaje, comillas unicode, null/undefined/vacio/numero, multiples especiales |
| `buildTextWatermarkFilter` | 24 | Drawtext valido, font= vs fontfile=, posiciones, fontsize clamp, color valido/invalido, opacidad hex, fuente desconocida, texto vacio/null/undefined/espacios, escapado, integracion con filter chain |

**Helper de test:**
```javascript
function fakeBytes(subtype = 'qt  ') {
  const arr = new Uint8Array(16);
  arr[4] = 0x66; arr[5] = 0x74; arr[6] = 0x79; arr[7] = 0x70; // "ftyp"
  for (let i = 0; i < 4; i++) arr[8 + i] = subtype.charCodeAt(i);
  return arr;
}
```

### 10.3 Tests del servidor (server.test.js)

Archivo: `tests/unit/server.test.js` — 94 lineas, 7 tests.

El servidor se importa y arranca en un puerto aleatorio (`server.listen(0)`) para evitar conflictos. Se cierra en `afterAll()`.

| Test | Que verifica |
|------|-------------|
| `GET /api/health devuelve status ok` | Status 200, campos `status`, `ffmpeg`, `version` |
| `POST /api/convert sin archivo → 400` | Rechazo de multipart sin campo `video` |
| `GET /api/jobs/:id con id inexistente → error SSE` | Evento SSE con code `NOT_FOUND` |
| `POST /api/jobs/:id/cancel con id inexistente → 404` | Respuesta 404 |
| `archivos estaticos se sirven correctamente` | GET `/` devuelve HTML con "VideoMovMp4" |
| `path traversal bloqueado` | URL con `%2F..` no devuelve 200 |
| `archivo no existente → 404` | GET a ruta inexistente devuelve 404 |

### 10.4 Fixtures de test

Script: `e2e/fixtures/generate-fixture.sh`

Genera 4 archivos de prueba usando FFmpeg con fuentes sinteticas (`testsrc` para video, `sine` para audio):

| Archivo | Resolucion | Duracion | Codec video | Codec audio | Tamaño aprox |
|---------|-----------|----------|-------------|-------------|-------------|
| `test-small.mov` | 320x240 | 2s | ProRes | PCM S16LE | ~1.4 MB |
| `test-720p.mov` | 1280x720 | 3s | ProRes | PCM S16LE | ~9.9 MB |
| `test-1080p.mov` | 1920x1080 | 3s | ProRes | PCM S16LE | ~16 MB |
| `test-not-mov.mp4` | 320x240 | 1s | H.264 | ninguno | ~8 KB |

Se usa ProRes como codec de video porque es el codec nativo de MOV en equipos Apple y genera archivos de gran tamaño (ideal para verificar la compresion).

---

## 11. Scripts auxiliares

### 11.1 package.json scripts

| Script | Comando | Proposito |
|--------|---------|----------|
| `start` | `node server.mjs` | Arrancar servidor en produccion |
| `dev` | `node --watch server.mjs` | Arrancar con auto-restart |
| `test` | `vitest run` | Ejecutar todos los tests |
| `test:watch` | `vitest` | Tests en modo watch |
| `create-fixture` | `bash e2e/fixtures/generate-fixture.sh` | Generar videos de prueba |

### 11.2 run_app.sh

Script de arranque con las siguientes funcionalidades:

1. `set -euo pipefail` — sale al primer error, variables no definidas son error, errores en pipes se propagan
2. Verifica `node`, `npm`, `ffmpeg` — muestra mensaje de error descriptivo si falta alguno
3. `cd` al directorio del script — funciona independientemente de donde se ejecute
4. `npm install` si `node_modules/` no existe
5. Busca puerto libre desde 5173 usando `lsof -i :PORT`
6. Muestra banner ASCII con URL
7. `exec env PORT=XXXX node server.mjs` — reemplaza el shell por el proceso Node

---

## 12. Configuracion mediante variables de entorno

Archivo de referencia: `.env.example`

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `PORT` | `5173` | Puerto del servidor HTTP |
| `MAX_FILE_SIZE_MB` | `2048` | Tamaño maximo de archivo en MB |
| `MAX_CONCURRENT_JOBS` | `2` | Conversiones simultaneas permitidas |
| `CLEANUP_INTERVAL_MIN` | `5` | Intervalo de limpieza en minutos |
| `JOB_TTL_MIN` | `10` | Tiempo de vida de jobs completados en minutos |
| `NO_OPEN` | (no definida) | Si es `"1"`, no abre el navegador automaticamente |

---

## 13. Referencia de la API

### Resumen rapido

| Metodo | Ruta | Proposito | Auth |
|--------|------|----------|------|
| `POST` | `/api/convert` | Subir MOV y crear job | Rate limit |
| `GET` | `/api/jobs/:id` | Stream SSE de progreso | - |
| `POST` | `/api/jobs/:id/cancel` | Cancelar conversion | - |
| `GET` | `/api/jobs/:id/download` | Descargar MP4 | - |
| `GET` | `/api/health` | Estado del servidor | - |
| `GET` | `/api/livereload` | SSE para live-reload (dev) | - |

### Codigos de respuesta usados

| Codigo | Significado | Usado en |
|--------|-------------|---------|
| 200 | Exito | Todos los endpoints exitosos |
| 400 | Error del cliente | Validacion fallida (extension, magic bytes, sin archivo) |
| 403 | Prohibido | Path traversal detectado |
| 404 | No encontrado | Archivo/job inexistente o expirado |
| 413 | Payload demasiado grande | Archivo > 2 GB |
| 429 | Demasiadas solicitudes | Rate limit o concurrencia excedida |
| 500 | Error interno | Errores inesperados del servidor |

---

## 14. Flujo completo de conversion

Descripcion paso a paso de una conversion exitosa:

```
1. USUARIO arrastra un archivo MOV a la zona de drop
     ↓
2. FRONTEND (app.js) valida:
   a. Extension: ¿termina en .mov? → Si
   b. Tamaño: ¿< 2 GB? → Si
   c. Magic bytes: ¿ftyp + subtipo valido? → Si
     ↓
3. FRONTEND muestra preview del video y panel de opciones
     ↓
4. USUARIO selecciona plataforma (ej. TikTok) o "Personalizado"
   - Si plataforma seleccionada: controles de resolucion/preset se ocultan
   - Ajusta calidad (75), opcionalmente activa espejo horizontal
   - Opcionalmente activa marca de agua imagen y/o texto
   - Ambas se muestran en un preview unificado donde se pueden arrastrar independientemente
   - El preview refleja el espejo horizontal en tiempo real
     ↓
5. USUARIO pulsa "Convertir a MP4" (o Ctrl+Enter)
     ↓
6. FRONTEND envia POST /api/convert con FormData:
   - video: archivo MOV
   - quality: "75"
   - resolution: "720p" (solo en modo Personalizado)
   - preset: "medium" (solo en modo Personalizado)
   - platform: "tiktok"
   - mirror: "0"
   - watermark: imagen (si activada)
   - watermarkPosition: "bottom-right"
   - watermarkSize: "20"
   - watermarkOpacity: "0.5" (50% de opacidad)
   - textWm: "Mi Logo" (si activado)
   - textWmFont: "montserrat"
   - textWmSize: "64"
   - textWmColor: "#ff0000"
   - textWmOpacity: "0.7"
   - textWmPosition: "bottom-right" (o "custom:X:Y" si arrastrado)
     ↓
7. SERVIDOR (server.mjs) recibe la peticion:
   a. Rate limit: ¿< 5 req/min para esta IP? → Si
   b. Concurrencia: ¿< 2 jobs activos? → Si
   c. Parsea multipart
   d. Valida extension → .mov OK
   e. Valida magic bytes → ftyp + qt OK
   f. Sanitiza filename → "Mi_Video.mov"
   g. Guarda en uploads/{uuid}_Mi_Video.mov
   h. Crea job en el Map
   i. Responde: { jobId, statusUrl }
   j. Inicia processJob() asincrono
     ↓
8. FRONTEND recibe jobId, guarda en sessionStorage, conecta SSE a /api/jobs/{id}
     ↓
9. SERVIDOR ejecuta ffprobe en el archivo:
   - Extrae: duracion=10.5s, 1920x1080, ProRes, PCM, 30fps
   - Emite SSE: { type: "metadata", data: {...} }
     ↓
10. FRONTEND recibe metadata, muestra tarjetas informativas
      ↓
11. SERVIDOR ejecuta ffmpeg (segun plataforma o modo personalizado):
    # Ejemplo TikTok:
    ffmpeg -i input.mov -c:v libx264 -crf 21 -preset medium
           -profile:v main -level 4.0 -vf crop=608:1080 -r 30
           -maxrate 2500k -bufsize 5000k -c:a aac -b:a 128k
           -movflags +faststart -pix_fmt yuv420p -progress pipe:1 -y output.mp4
    # Si mirror activado, se añade hflip a la cadena -vf
    # Si watermark imagen activado, se usa -filter_complex con overlay en lugar de -vf
    # Si textWm activado, se añade drawtext al final de -vf o -filter_complex
      ↓
12. SERVIDOR parsea progreso de stdout (cada bloque "progress=continue"):
    - Calcula percent, fps, speed, elapsed, eta
    - Emite SSE: { type: "progress", data: {...} }
      ↓
13. FRONTEND actualiza barra de progreso y stats en tiempo real
      ↓
14. SERVIDOR detecta fin del proceso FFmpeg (exit code 0):
    - Lee tamaño del archivo de salida
    - Calcula ahorro: (1 - output/input) * 100 = 95%
    - Emite SSE: { type: "done", data: { downloadUrl, outputSize, savings } }
    - Log: "Conversión completada: 75.4 KB (95% ahorro)"
      ↓
15. FRONTEND recibe evento "done":
    - Barra de progreso → 100% con color verde
    - Cambia a estado "done"
    - Muestra preview del video convertido
    - Muestra comparativa: Original 1.4 MB → Convertido 75.4 KB (95% menos)
    - Muestra toast verde: "¡Conversión completada!"
    - Reproduce sonido de completado (beep 800Hz, 0.3s)
    - Si la pestaña no esta activa → notificacion del sistema
    - Elimina jobId de sessionStorage
      ↓
16. USUARIO tiene 3 opciones:
    a. "Descargar MP4" (o Ctrl+S) → descarga el archivo convertido
    b. "Atrás" → vuelve al panel de opciones con todos los ajustes intactos para reconvertir
    c. "Convertir otro vídeo" → reinicia al estado inicial
      ↓
17. Si descarga: SERVIDOR sirve el MP4 via GET /api/jobs/{id}/download:
    - Content-Type: video/mp4
    - Content-Disposition: attachment; filename="Mi_Video_convertido.mp4"
    - Stream del archivo
      ↓
18. LIMPIEZA automatica (5 min despues):
    - Job marcado como expirado
    - Elimina archivo MOV de uploads/
    - Elimina archivo MP4 de converted/
    - Elimina job del Map
```

---

## 15. Manejo de errores

### Tabla de escenarios

| Escenario | Donde se detecta | Respuesta/Accion | UI |
|-----------|------------------|-----------------|-----|
| Archivo no es .mov (extension) | Frontend + Backend | 400 | Toast rojo |
| Archivo no es MOV (magic bytes) | Frontend + Backend | 400 | Toast rojo |
| Archivo > 2 GB | Frontend + Backend | 413 | Toast rojo |
| FFmpeg no instalado | Backend (health) | Health check `ffmpeg: false` | (detectar via health) |
| FFmpeg crash mid-conversion | Backend (proc close) | SSE `error` | Panel error + "Reintentar" |
| ffprobe falla | Backend (probeFile) | SSE `error` code `PROBE_ERROR` | Panel error |
| Usuario cancela conversion | Backend (cancel endpoint) | SSE `error` code `CANCELLED` | Vuelve a `configuring` |
| Conexion SSE perdida | Frontend (EventSource error) | Auto-reconectar (5 intentos, backoff) | Transparente |
| Browser refresh durante conversion | Frontend (sessionStorage) | Reconectar al job | Muestra "Reconectando..." |
| Servidor se reinicia con jobs | Backend (graceful shutdown) | SSE `error` code `SERVER_SHUTDOWN` | Toast "Servidor reiniciandose" |
| Rate limit excedido | Backend | 429 | Toast "Espera un momento" |
| Concurrencia maxima | Backend | 429 | Toast "Servidor ocupado" |
| Disco lleno | Backend (fs.writeFile falla) | 500 | Toast error |
| Archivo de salida no encontrado | Backend (stat falla post-conversion) | SSE `error` code `OUTPUT_ERROR` | Panel error |

### Traduccion de errores FFmpeg

| Error FFmpeg (stderr) | Mensaje al usuario |
|----------------------|-------------------|
| `No such file` | "Archivo no encontrado" |
| `Invalid data` | "El archivo esta corrupto o no es un MOV valido" |
| `codec not found` | "Codec no soportado" |
| SIGTERM (cancelacion) | "Conversion cancelada por el usuario" |
| Otros | "Error durante la conversion" |

---

## 16. Rendimiento y limites

### Limites configurados

| Parametro | Valor por defecto | Configurable |
|-----------|------------------|-------------|
| Tamaño maximo de archivo | 2 GB | `MAX_FILE_SIZE_MB` |
| Conversiones simultaneas | 2 | `MAX_CONCURRENT_JOBS` |
| Uploads por IP/minuto | 5 | Hardcoded |
| TTL de jobs completados | 10 min | `JOB_TTL_MIN` |
| Intervalo de limpieza | 5 min | `CLEANUP_INTERVAL_MIN` |
| Heartbeat SSE | 15 s | Hardcoded |
| Debounce live-reload | 150 ms | Hardcoded |
| Reintentos SSE | 5 | Hardcoded |

### Uso de recursos

- **CPU:** el consumo depende del preset de FFmpeg. `ultrafast` usa menos CPU pero genera archivos mas grandes. `slow` usa mas CPU pero produce archivos mas pequeños.
- **Memoria:** el archivo MOV completo se almacena en memoria durante el parseo multipart antes de escribirse a disco. Para archivos de 2 GB, se necesitan al menos 2 GB de RAM libre.
- **Disco:** se necesita espacio para el archivo de entrada (uploads/) + el archivo de salida (converted/). En el peor caso: 2x el tamaño del archivo original.

---

## 17. Dependencias

### Produccion

| Paquete | Version | Proposito | Tamaño |
|---------|---------|----------|--------|
| `uuid` | ^13.0.0 | Generacion de UUID v4 para IDs de jobs | ~40 KB |
| `multer` | ^2.1.1 | Declarado pero no usado directamente (el servidor usa parser multipart propio) | ~100 KB |

### Desarrollo

| Paquete | Version | Proposito |
|---------|---------|----------|
| `vitest` | ^4.1.2 | Framework de tests |

### Externas (CDN, no npm)

| Recurso | Version | URL |
|---------|---------|-----|
| Font Awesome | 6.4.0 | cdnjs.cloudflare.com |
| Notyf | 3 | cdn.jsdelivr.net |
| Inter font | latest | fonts.googleapis.com |

### Sistema (requerido en PATH)

| Binario | Version minima | Proposito |
|---------|---------------|----------|
| `ffmpeg` | 5.0+ | Conversion de video |
| `ffprobe` | (incluido con FFmpeg) | Analisis de metadatos |
| `node` | 18.0+ | Runtime del servidor |

---

## 18. Preguntas frecuentes

**P: ¿Por que no se usa Express?**
R: Para minimizar dependencias y mantener control total. El servidor HTTP nativo de Node.js es suficiente para esta aplicacion y reduce la superficie de ataque. El patron esta tomado del proyecto `sound_fix` del mismo autor.

**P: ¿Que hace `-movflags +faststart`?**
R: Mueve el atomo `moov` (metadatos del contenedor MP4) al inicio del archivo. Sin este flag, el navegador debe descargar el archivo completo antes de poder reproducirlo. Con `+faststart`, la reproduccion puede comenzar inmediatamente (streaming progresivo).

**P: ¿Por que el mapeo CRF no es lineal?**
R: Porque la percepcion humana de calidad no es lineal. CRF 18 y 20 son practicamente indistinguibles para la mayoria del contenido, pero CRF 28 y 30 tienen una diferencia notable. La curva `pow(0.7)` da mas granularidad en la zona de alta calidad (60-100 en el slider) donde los cambios son mas perceptibles.

**P: ¿Por que se validan los magic bytes ademas de la extension?**
R: Un archivo renombrado de `.txt` a `.mov` pasaria la validacion de extension pero causaria errores en FFmpeg. Los magic bytes verifican que el contenido binario del archivo realmente corresponde a un contenedor QuickTime/MOV.

**P: ¿Que pasa si el navegador se refresca durante una conversion?**
R: El `jobId` se almacena en `sessionStorage`. Al recargar, `tryRecoverSession()` detecta el jobId guardado, reconecta al stream SSE y recupera el estado actual del job (metadatos, progreso, o resultado final).

**P: ¿Por que no se usa WebSocket en lugar de SSE?**
R: SSE es mas simple para comunicacion unidireccional (servidor → cliente). La cancelacion se maneja con un POST separado. WebSocket añadiria complejidad sin beneficio para este caso de uso.

**P: ¿Como se previene que el servidor se quede sin disco?**
R: La limpieza automatica elimina archivos temporales de jobs completados cada 5 minutos (TTL de 10 minutos). El graceful shutdown limpia archivos de jobs incompletos. El limite de concurrencia (2 jobs) limita la acumulacion de archivos temporales.

**P: ¿Se puede usar en produccion?**
R: La arquitectura actual esta diseñada para uso local o en entornos controlados. Para produccion se recomiendaria: almacenamiento persistente de jobs, autenticacion, HTTPS, limite de tamaño ajustado, monitoreo y un proceso de FFmpeg aislado (contenedor).

**P: ¿Que codecs de entrada soporta?**
R: FFmpeg acepta cualquier codec que pueda decodificar dentro de un contenedor MOV, incluyendo: ProRes, H.264, H.265/HEVC, MJPEG, Apple Intermediate, y mas. La validacion solo verifica que el contenedor es MOV (magic bytes), no el codec interno.

**P: ¿Que navegadores estan soportados?**
R: Todos los navegadores modernos que soporten ES modules, EventSource (SSE), y HTML5 video. Chrome, Firefox, Safari y Edge en sus ultimas 2 versiones principales. `showSaveFilePicker` solo esta disponible en Chrome/Edge; en otros navegadores se usa descarga directa como fallback.
