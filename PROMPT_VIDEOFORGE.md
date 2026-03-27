# Prompt para Claude Code — VideoForge: Conversor MOV → MP4

Crea una aplicacion web completa llamada "VideoForge" para convertir archivos de video `.mov` a formato `.mp4` optimizado para web. La app usa Node.js en el servidor (FFmpeg nativo) y un frontend vanilla JS con modo oscuro.

**IMPORTANTE:** Todo texto visible al usuario (toasts, labels, botones, mensajes de error, placeholders) DEBE estar en español. El codigo fuente (variables, funciones, comentarios tecnicos) puede estar en ingles.

---

## Seccion 0 — Inicializacion del proyecto

Ejecuta estos comandos ANTES de crear cualquier archivo:

```bash
cd /Users/imac_mini_javi/Documents/WEB/FRONTEND_TOOLS/VideoMobMp4
npm init -y
npm install multer uuid
npm install -D vitest
```

Verifica que FFmpeg esta instalado:

```bash
ffmpeg -version   # Debe devolver version 5+ o 6+
ffprobe -version  # Viene con FFmpeg
```

---

## Seccion 1 — Estructura de archivos

```
VideoMobMp4/
├── .gitignore
├── .env.example                # Variables de entorno documentadas
├── package.json
├── server.mjs                  # Servidor HTTP principal (node:http, SIN Express)
├── run_app.sh                  # Script de arranque con port scanning
├── CLAUDE.md                   # Guia para Claude Code
├── README.md
├── public/
│   └── index.html              # SPA completa — CDN deps + dark theme
├── src/
│   ├── css/
│   │   └── app.css             # Estilos propios (BEM) — dark theme
│   └── js/
│       ├── app.js              # UI controller + logica de conversion
│       └── converterCore.js    # Funciones puras: validacion, CRF, resolucion
├── tests/
│   └── unit/
│       ├── converterCore.test.js   # Tests de funciones puras
│       └── server.test.js          # Tests del API
└── e2e/
    └── fixtures/
        └── generate-fixture.sh     # Genera videos de prueba con FFmpeg
```

---

## Seccion 2 — Requisitos P0 (MUST-HAVE — implementar primero)

### 2.1 Servidor (server.mjs)

Servidor HTTP nativo con `node:http`, **SIN Express ni frameworks**.

Funcionalidades:

- Servir archivos estaticos desde `public/`, `src/` y `node_modules/`
- **Path traversal prevention**: funcion `safeResolve()` que verifica que la ruta resuelta empieza con `ROOT_DIR`. Si no → 403
- MIME types map para: `.html`, `.js`, `.mjs`, `.css`, `.json`, `.wasm`, `.svg`, `.png`, `.jpg`, `.mp4`, `.mov`, `.ico`
- `Cache-Control: no-store` en desarrollo
- Exportar `server` para tests sin arrancar el listener

**Puerto:** `process.env.PORT || 5173`

**Auto-open Chrome en macOS** al arrancar (detectar plataforma y ejecutar `open`).

**Live-reload SSE** en `/api/livereload`:
- Vigilar `src/` y `public/` con `fs.watch({recursive: true})`
- Debounce 150ms para evitar reloads multiples
- Heartbeat SSE cada 30 segundos (`":\n\n"`) para evitar timeout de proxies
- Solo activar watch cuando se ejecuta directamente (`import.meta.url`), no en tests

---

### 2.2 Endpoints API

#### `POST /api/convert`

Recibe `multipart/form-data` con campo `"video"` (archivo MOV).

Campos adicionales (form fields):
- `quality`: numero 1-100 (default 75)
- `resolution`: string (`"original"` | `"1080p"` | `"720p"` | `"480p"`)
- `preset`: string (`"ultrafast"` | `"fast"` | `"medium"` | `"slow"`) — default `"medium"`

**Validaciones (ANTES de aceptar):**

1. **Extension**: solo `.mov` (case-insensitive). Si no → 400
2. **Magic bytes**: leer primeros 16 bytes del archivo subido. Comprobar que `bytes[4..7] === "ftyp"` (hex: `66 74 79 70`). Aceptar subtipos en `bytes[8..11]`: `"qt  "` (MOV puro), `"isom"`, `"mp42"` (MOV modernos). Si no coincide → 400 `"El archivo no es un video MOV valido"`
3. **Tamaño maximo**: 2 GB (configurar en multer). Si excede → 413
4. **Sanitizar filename**: reemplazar todo excepto `[a-zA-Z0-9._-]` por `"_"`. Eliminar `".."` para prevenir path traversal. Truncar a 200 caracteres

**Respuesta 200:**
```json
{ "jobId": "uuid", "statusUrl": "/api/jobs/{jobId}" }
```

Almacenar archivo con nombre: `{jobId}_{sanitized}.mov`

#### `GET /api/jobs/:jobId`

Respuesta SSE (`text/event-stream`) con progreso en tiempo real.

Eventos emitidos:
```
{ type: "metadata", data: { duration, width, height, codec, fps, size } }
{ type: "progress", data: { percent, fps, speed, elapsed, eta } }
{ type: "done",     data: { downloadUrl, outputSize, duration, savings } }
{ type: "error",    data: { message, code } }
```

- **Heartbeat**: enviar `":\n\n"` cada 15 segundos
- Si `jobId` no existe → evento error + cerrar conexion

#### `POST /api/jobs/:jobId/cancel`

- Cancela la conversion en curso (envia `SIGTERM` al proceso FFmpeg)
- Limpia archivos temporales del job
- Respuesta: `{ ok: true, message: "Conversion cancelada" }`

#### `GET /api/jobs/:jobId/download`

- Sirve el MP4 resultante como descarga
- `Content-Disposition: attachment; filename="{original}_convertido.mp4"`
- Eliminar el archivo temporal despues de servir (o con TTL de 10 minutos)
- Si el archivo ya expiro → 404 `"El archivo ha expirado"`

#### `GET /api/health`

```json
{ "status": "ok", "ffmpeg": true, "uptime": 12345, "activeJobs": 0, "version": "1.0.0" }
```

Verificar que FFmpeg esta disponible con `execSync("ffmpeg -version")`.

---

### 2.3 Sistema de Jobs

```javascript
const jobs = new Map(); // jobId → Job object
```

**Estados:** `"queued"` | `"probing"` | `"converting"` | `"done"` | `"error"` | `"cancelled"`

**Estructura del Job:**

```javascript
{
  id: string,               // uuid
  state: string,            // JobState
  inputPath: string,
  outputPath: string,
  originalFilename: string,
  sanitizedFilename: string,
  quality: number,
  resolution: string,
  preset: string,
  metadata: null | { duration, width, height, codec, fps, fileSize },
  progress: { percent: 0, fps: 0, speed: "", elapsed: 0, eta: 0 },
  ffmpegProcess: null,      // ChildProcess — para cancelacion
  sseClients: new Set(),    // Response objects conectados
  createdAt: Date.now(),
  completedAt: null,
  error: null
}
```

**Limpieza automatica:** cada 5 minutos, eliminar jobs completados/error cuyo `completedAt` sea > 10 minutos. Tambien eliminar archivos temporales asociados.

**Limite de concurrencia:** maximo 2 conversiones simultaneas. Si se excede → 429 `"Servidor ocupado, intenta en unos segundos"`.

---

### 2.4 Conversion FFmpeg

#### Paso 1 — Extraer metadatos con ffprobe

```bash
ffprobe -v quiet -print_format json -show_format -show_streams input.mov
```

Parsear la salida JSON para obtener:
- `duration` (segundos)
- `width`, `height`
- `codec_name` (video y audio)
- `r_frame_rate` → convertir a fps decimal
- `bit_rate`, file size

Guardar metadatos en el job y enviarlos como primer evento SSE: `{ type: "metadata" }`.

#### Paso 2 — Convertir con FFmpeg

Comando base:

```bash
ffmpeg -i input.mov \
  -c:v libx264 \
  -crf {CRF_CALCULADO} \
  -preset {preset} \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  -pix_fmt yuv420p \
  {RESOLUCION_ARGS} \
  -progress pipe:1 \
  -y output.mp4
```

**Flags criticos:**
- **`-movflags +faststart`**: mueve el atomo moov al inicio del MP4, permitiendo reproduccion web inmediata sin descargar el archivo completo. **NO OMITIR.**
- **`-pix_fmt yuv420p`**: maxima compatibilidad con todos los navegadores y dispositivos
- **`-progress pipe:1`**: emite progreso parseable por stdout

#### Mapeo CRF (calidad perceptual, NO lineal)

Exportar desde `converterCore.js`:

```javascript
export function qualityToCRF(quality) {
  // quality: 1-100 del usuario
  // CRF: 0 (lossless) a 51 (peor). Rango util: 18-35
  // Mapeo perceptual con curva: la zona 60-100 tiene mas
  // granularidad (donde el ojo nota diferencias)
  const q = Math.max(1, Math.min(100, quality));
  const normalized = (q - 1) / 99;       // 0.0 a 1.0
  const curved = Math.pow(normalized, 0.7); // curva perceptual
  const crf = Math.round(35 - curved * 17); // 35 → 18
  return crf;
}
```

**Valores esperados:**
| quality | CRF |
|---------|-----|
| 100     | 18  |
| 75      | ~21 |
| 50      | ~24 |
| 25      | ~29 |
| 1       | 35  |

#### Resolucion

Exportar desde `converterCore.js`:

```javascript
export function buildResolutionArgs(target, inputWidth, inputHeight) {
  // Solo reducir, NUNCA ampliar
  // -2 asegura altura divisible por 2 (requerido por H.264)
  if (target === 'original') return [];

  const targets = { '1080p': 1920, '720p': 1280, '480p': 854 };
  const targetW = targets[target];
  if (!targetW || inputWidth <= targetW) return [];

  return ['-vf', `scale=${targetW}:-2`];
}
```

#### Parseo de progreso

FFmpeg con `-progress pipe:1` escribe lineas como:

```
frame=120
fps=30.0
total_size=1234567
out_time_us=4000000
out_time=00:00:04.000000
speed=2.5x
progress=continue
```

Calcular:
- `percent = (out_time_us / (duration_total * 1_000_000)) * 100`
- `eta = (elapsed / percent) * (100 - percent)`
- `fps`, `speed` directos del output

Enviar evento SSE `{ type: "progress" }` cada vez que se reciba `progress=continue`.

#### Manejo de errores FFmpeg

- Capturar stderr para mensajes de error
- Si el proceso sale con codigo != 0:
  - Enviar evento SSE `{ type: "error", data: { message, code } }`
  - Limpiar archivos de salida parciales
  - Actualizar estado del job a `"error"`
- Errores comunes a traducir al español:
  - `"No such file"` → `"Archivo no encontrado"`
  - `"Invalid data"` → `"El archivo esta corrupto o no es un MOV valido"`
  - `"codec not found"` → `"Codec no soportado"`
  - Señal SIGTERM (cancelacion) → `"Conversion cancelada por el usuario"`

---

### 2.5 Frontend (index.html + app.js + app.css)

**Stack frontend (sin bundler, sin transpiler):**
- HTML5 semantico
- CSS con BEM y custom properties — dark theme
- JavaScript vanilla con ES modules
- Font Awesome 6 (CDN) para iconos
- Notyf (CDN) para toasts

**CDN en index.html:**
```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.css">
<link rel="stylesheet" href="/src/css/app.css">
<script src="https://cdn.jsdelivr.net/npm/notyf@3/notyf.min.js"></script>
<script type="module" src="/src/js/app.js"></script>
```

#### Paleta dark theme (CSS custom properties)

```css
:root {
  --bg-base: #0D0D0D;
  --bg-surface: #1A1A1A;
  --bg-elevated: #242424;
  --border: #2A2A2A;
  --accent-primary: #7C3AED;     /* violeta */
  --accent-secondary: #06B6D4;   /* cyan */
  --accent-success: #10B981;     /* verde */
  --accent-danger: #EF4444;      /* rojo */
  --text-primary: #F5F5F5;
  --text-secondary: #A0A0A0;
  --text-muted: #666666;
  --radius: 8px;
  --transition: 0.3s ease;
}
```

Tipografia: `Inter` via Google Fonts, fallback `system-ui, -apple-system, sans-serif`.

#### Layout — Pagina unica con estas secciones:

**1. Header (`header`):**
- Logo "VideoForge" con icono SVG inline (simbolo de video/film)
- Subtitulo: "Convierte MOV → MP4 para web y redes sociales"
- Boton "Empezar de nuevo" (resetear todo el estado)

**2. Zona de subida (`upload`):**
- Drag & drop (`upload__dropzone`):
  - Icono `fa-film` grande centrado
  - Texto: "Arrastra y suelta tu archivo MOV aqui"
  - Texto: "o"
  - Boton: "Examinar archivo" (estilo `--accent-primary`)
  - Texto pequeño: "Formato soportado: MOV (QuickTime) — Maximo 2 GB"
  - Input file oculto con `accept=".mov"`
- Tras seleccionar archivo, mostrar:
  - Nombre del archivo (truncado si es largo)
  - Tamaño formateado (ej: "245.3 MB")
  - Preview del video original (elemento `<video>` con `URL.createObjectURL` — los navegadores modernos reproducen MOV)
  - Boton "Cambiar archivo" para seleccionar otro

**3. Panel de opciones (`settings`) — visible solo tras subir archivo:**
- **Calidad de video**: slider range 1-100, default 75
  - Mostrar valor actual y CRF calculado en tiempo real
  - Escala visual debajo: `"Menor tamaño ← → Mayor calidad"`
  - Labels dinamicos:
    - 1-25: "Baja (archivos pequeños)"
    - 26-50: "Media"
    - 51-75: "Alta (recomendado)"
    - 76-100: "Maxima (archivos grandes)"
- **Resolucion**: dropdown select
  - "Original (mantener)" — default
  - "1080p (Full HD)"
  - "720p (HD)"
  - "480p (SD)"
  - Junto al dropdown mostrar resolucion actual: "(actual: 3840x2160)"
  - Si la resolucion seleccionada es >= la del video, indicar "(se mantendra original)"
- **Preset de velocidad**: dropdown
  - "Ultrarapido" (ultrafast)
  - "Rapido" (fast)
  - "Equilibrado" (medium) — default
  - "Maxima calidad" (slow)
  - Tooltip: "Presets mas lentos producen mejor compresion"
- **Boton de conversion** grande: "Convertir a MP4" (icono `fa-exchange-alt`)
  - Deshabilitado hasta que haya archivo seleccionado
  - Al pulsar: sube el archivo y lanza la conversion

**4. Panel de progreso (`progress`) — visible durante conversion:**
- Info del video original (de ffprobe):
  - Duracion, resolucion, codec, FPS, tamaño
  - Mostrado en tarjetas mini con iconos
- Barra de progreso:
  - Porcentaje con animacion suave (`transition`)
  - Color progresivo: azul (0-50%), verde (50-99%), verde brillante (100%)
  - Texto del porcentaje centrado en la barra
- Stats en tiempo real debajo de la barra:
  - FPS actual de codificacion
  - Velocidad (ej: "2.3x")
  - Tiempo transcurrido
  - Tiempo estimado restante (ETA)
- Boton "Cancelar conversion" (estilo `--accent-danger`, outline)
  - Confirmacion antes de cancelar: dialogo `confirm("¿Seguro que deseas cancelar?")`

**5. Panel de resultado (`result`) — visible tras conversion exitosa:**
- Preview del video convertido (elemento `<video>` con controles, autoload)
- Comparativa de tamaños en tarjetas:
  - Original: X MB
  - Convertido: Y MB
  - Ahorro: Z% (con icono check verde si hay ahorro, icono warning si creció)
- Boton grande: "Descargar MP4" (icono `fa-download`, estilo `--accent-primary`)
  - Usar `showSaveFilePicker` si disponible en el navegador
  - Fallback: descarga directa con `<a download>`
- Boton secundario: "Convertir otro video" (resetear al estado inicial)

**6. Footer (`footer`):**
- "VideoForge — Herramienta de conversion de video"
- "v1.0.0"

#### Accesibilidad

- Semantica HTML5: `<main>`, `<section>`, `<form>`, `<label>`, `<fieldset>`
- Todos los controles con `aria-label` o `<label>` asociado
- Focus visible con anillo de color acento (`outline: 2px solid var(--accent-primary)`)
- Mensajes de estado con `aria-live="polite"`
- Contraste minimo WCAG AA
- Navegable 100% con teclado (tab order logico)

#### Responsividad

- Mobile first
- Breakpoints: `480px`, `768px`, `1024px`, `1280px`
- Movil: layout una columna, botones de ancho completo, zona de drop mas grande
- Tablet+: panel de ajustes al lado de la zona de subida (grid 2 columnas)
- En pantallas < 480px: ocultar preview de video para ahorrar memoria

#### SSE de conversion — Reconexion robusta

```javascript
// Reconexion con backoff exponencial
let retries = 0;
const MAX_RETRIES = 5;

function connectSSE(jobId) {
  const evtSource = new EventSource(`/api/jobs/${jobId}`);

  evtSource.onmessage = (e) => {
    retries = 0; // reset on success
    const event = JSON.parse(e.data);
    handleEvent(event);
  };

  evtSource.onerror = () => {
    evtSource.close();
    if (retries < MAX_RETRIES) {
      const delay = Math.pow(2, retries) * 1000; // 1s, 2s, 4s, 8s, 16s
      retries++;
      setTimeout(() => connectSSE(jobId), delay);
    }
  };
}
```

#### Recuperacion tras refresh del navegador

- Al iniciar conversion: guardar `jobId` en `sessionStorage`
- Al cargar la pagina: comprobar si hay `jobId` en `sessionStorage`
- Si existe: reconectar al SSE de ese job para recuperar el estado actual

#### Live-reload (desarrollo)

```javascript
const evtSource = new EventSource('/api/livereload');
evtSource.onmessage = (e) => {
  if (e.data === 'reload') location.reload();
};
evtSource.onerror = () => {
  evtSource.close();
  setTimeout(() => { /* recrear EventSource */ }, 3000);
};
```

#### Maquina de estados de la UI

```
idle → uploading → configuring → converting → done | error
```

Cada estado muestra/oculta los paneles correspondientes. Transiciones invalidas deben ser ignoradas (no crashear).

---

### 2.6 Funciones puras (converterCore.js)

Este archivo **NO debe tener dependencias de DOM ni de Node.js**. Solo funciones puras exportadas, testables con Vitest.

**Funciones a exportar:**

```javascript
validateMovExtension(filename)
// Verifica extension .mov (case-insensitive)
// Devuelve: boolean

validateMovMagicBytes(uint8Array)
// Verifica primeros 16 bytes: bytes[4..7] === "ftyp"
// Acepta subtipos: "qt  ", "isom", "mp42"
// Devuelve: { valid: boolean, reason?: string }

qualityToCRF(quality)
// Mapeo perceptual descrito en seccion 2.4

buildResolutionArgs(target, inputWidth, inputHeight)
// Descrito en seccion 2.4

formatFileSize(bytes)
// 0 → "0 B", 1024 → "1.0 KB", 1048576 → "1.0 MB", etc.
// Usar 1024 como base (no 1000)

formatDuration(seconds)
// 30 → "00:30", 90 → "01:30", 3661 → "1:01:01"
// NaN → "00:00"

formatETA(seconds)
// < 60: "45s restantes", >= 60: "2m 30s restantes"

calculateSavings(originalBytes, convertedBytes)
// Devuelve: { savedBytes, savedPercent, isSmaller }

parseFFprobeOutput(jsonString)
// Parsea JSON de ffprobe → { duration, width, height, videoCodec, audioCodec, fps, bitrate }
// Devuelve null si JSON invalido

sanitizeFilename(name)
// Reemplaza caracteres no seguros por "_"
// Elimina ".." para prevenir path traversal
// Trunca a 200 caracteres
```

---

### 2.7 Script de arranque (run_app.sh)

```bash
#!/usr/bin/env bash
set -euo pipefail

# Verificar dependencias
command -v node >/dev/null 2>&1 || { echo "Error: node no encontrado. Instala Node.js 18+"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "Error: npm no encontrado"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || { echo "Error: ffmpeg no encontrado. Instala con: brew install ffmpeg"; exit 1; }

# Instalar dependencias si no existen
[ -d node_modules ] || npm install

# Buscar puerto libre empezando en 5173
is_port_in_use() { lsof -i :"$1" >/dev/null 2>&1; }

PORT_TO_USE=5173
while is_port_in_use "$PORT_TO_USE"; do
  PORT_TO_USE=$((PORT_TO_USE + 1))
done

echo "Arrancando VideoForge en http://localhost:$PORT_TO_USE"
exec env PORT="$PORT_TO_USE" node server.mjs
```

`chmod +x run_app.sh`

---

### 2.8 Archivos de configuracion

#### .gitignore

```
node_modules/
npm-debug.log*
coverage/
.DS_Store
.env
.env.*
.vscode/
.idea/
*.log
# VideoForge temporal
uploads/
converted/
*.mp4
*.mov
!e2e/fixtures/*.mov
```

#### .env.example

```
PORT=5173
MAX_FILE_SIZE_MB=2048
MAX_CONCURRENT_JOBS=2
CLEANUP_INTERVAL_MIN=5
JOB_TTL_MIN=10
```

#### CLAUDE.md

```markdown
# VideoForge

## Commands
- `./run_app.sh` — Arrancar servidor con port scanning automatico
- `npm test` — Ejecutar todos los tests (Vitest)
- `npm run test:watch` — Tests en modo watch
- `bash e2e/fixtures/generate-fixture.sh` — Generar videos de prueba

## Architecture
| Archivo | Descripcion |
|---------|-------------|
| server.mjs | Servidor HTTP nativo, endpoints API, sistema de jobs |
| src/js/app.js | UI controller, SSE, upload, estados |
| src/js/converterCore.js | Funciones puras: validacion, CRF, formato |
| src/css/app.css | Dark theme, BEM, responsive |
| public/index.html | SPA con CDN deps |

## Endpoints
- POST /api/convert — Subir MOV y crear job
- GET /api/jobs/:id — SSE con progreso
- POST /api/jobs/:id/cancel — Cancelar conversion
- GET /api/jobs/:id/download — Descargar MP4
- GET /api/health — Estado del servidor
- GET /api/livereload — SSE para live-reload (dev)

## Pipeline de conversion
1. Upload MOV → validar extension + magic bytes
2. ffprobe → extraer metadatos (duracion, resolucion, codec)
3. ffmpeg → convertir a MP4 (H.264 + AAC, -movflags +faststart)
4. Emitir progreso via SSE → download disponible

## Testing
Tests unitarios en tests/unit/ con Vitest. Fixtures generados con generate-fixture.sh.
```

---

## Seccion 3 — Requisitos P1 (SHOULD-HAVE — implementar despues de P0)

### 3.1 Logging estructurado

Formato a stdout:
```
[2026-03-27T14:30:00.000Z] [INFO]  Job abc123: Conversion iniciada (1080p, CRF 21)
[2026-03-27T14:30:05.000Z] [WARN]  Job abc123: FFmpeg tardando mas de lo esperado
[2026-03-27T14:30:10.000Z] [ERROR] Job abc123: FFmpeg exit code 1: Invalid data
```

Niveles: `INFO`, `WARN`, `ERROR`. Incluir siempre: timestamp ISO, nivel, jobId (si aplica), mensaje.

### 3.2 Graceful shutdown

Al recibir `SIGTERM` o `SIGINT`:
1. Dejar de aceptar nuevas conexiones
2. Para cada job `"converting"`: enviar `SIGTERM` al proceso FFmpeg
3. Notificar a todos los clientes SSE: `{ type: "error", data: { message: "Servidor reiniciandose", code: "SERVER_SHUTDOWN" } }`
4. Esperar hasta 10 segundos para que los procesos terminen
5. Limpiar archivos temporales
6. `process.exit(0)`

### 3.3 Rate limiting simple

- Maximo 5 uploads por minuto por IP (`Map` con contadores y TTL)
- Si se excede → 429 `"Demasiadas solicitudes. Espera un momento."`
- Implementar inline, sin middleware externo

### 3.4 Notificacion de completado

Cuando la conversion termina:
- Toast de Notyf (verde, exito): `"¡Conversion completada! Tamaño: X MB (Y% menos)"`
- Si el navegador soporta Notification API y el usuario lo permite:
  - Notificacion del sistema cuando la pestaña no esta activa
  - `"VideoForge: Tu video esta listo para descargar"`
- Sonido de completado con Web Audio API (no cargar archivo externo):
```javascript
function playCompletionSound() {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain).connect(ctx.destination);
  osc.frequency.value = 800;
  gain.gain.value = 0.3;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
  osc.stop(ctx.currentTime + 0.3);
}
```

### 3.5 Atajos de teclado

- `Ctrl/Cmd + Enter`: Iniciar conversion (si hay archivo cargado)
- `Escape`: Cancelar conversion (con confirmacion)
- `Ctrl/Cmd + S`: Descargar archivo (si conversion completada)
- Mostrar atajos en tooltip del boton correspondiente

### 3.6 Mejoras moviles

- Boton de subida mas grande en pantallas < 768px
- Ocultar preview de video en pantallas < 480px para ahorrar memoria
- Touch feedback en la zona de drag & drop (`:active` state visible)
- Barra de progreso con mayor grosor en movil

---

## Seccion 4 — Requisitos P2 (NICE-TO-HAVE — solo si hay tiempo)

- 4.1 Historial de conversiones recientes (`sessionStorage`, ultimas 10)
- 4.2 Dark/light theme toggle
- 4.3 Estimacion de tamaño de salida ANTES de convertir (heuristica basada en CRF y resolucion)
- 4.4 Drag & drop de multiples archivos (cola visual, conversion secuencial)
- 4.5 Vista previa de 5 segundos del MP4 resultante antes de descargar

---

## Seccion 5 — Tests (Vitest)

### package.json scripts

```json
{
  "scripts": {
    "start": "node server.mjs",
    "dev": "node --watch server.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "create-fixture": "bash e2e/fixtures/generate-fixture.sh"
  }
}
```

### 5.1 tests/unit/converterCore.test.js

```javascript
import { describe, it, expect } from 'vitest';
```

**Tests requeridos:**

**`describe('validateMovExtension')`**
- "acepta .mov"
- "acepta .MOV (case-insensitive)"
- "rechaza .mp4"
- "rechaza .avi"
- "rechaza string vacio"
- "rechaza null/undefined"

**`describe('validateMovMagicBytes')`**
- Crear helper `fakeBytes(ftypSubtype)` que genera Uint8Array con magic bytes
- "acepta magic bytes ftyp+qt"
- "acepta magic bytes ftyp+isom"
- "rechaza bytes aleatorios"
- "rechaza array vacio"

**`describe('qualityToCRF')`**
- "quality 100 → CRF 18"
- "quality 75 → CRF entre 20 y 23"
- "quality 50 → CRF entre 23 y 26"
- "quality 25 → CRF entre 28 y 31"
- "quality 1 → CRF 35"
- "clamps valores fuera de rango (0 → 35, 150 → 18)"
- "siempre devuelve entero"

**`describe('buildResolutionArgs')`**
- "original → array vacio"
- "1080p con input 3840x2160 → scale=1920:-2"
- "720p con input 1920x1080 → scale=1280:-2"
- "1080p con input 720p → array vacio (no ampliar)"
- "480p con input 480p → array vacio (ya es la resolucion)"

**`describe('formatFileSize')`**
- "0 → '0 B'"
- "1023 → '1023 B'"
- "1024 → '1.0 KB'"
- "1536 → '1.5 KB'"
- "1048576 → '1.0 MB'"
- "1073741824 → '1.0 GB'"

**`describe('formatDuration')`**
- "30 → '00:30'"
- "90 → '01:30'"
- "3661 → '1:01:01'"
- "0 → '00:00'"
- "NaN → '00:00'"

**`describe('sanitizeFilename')`**
- "reemplaza caracteres especiales por _"
- "mantiene letras, numeros, punto, guion"
- "elimina .. (path traversal)"
- "trunca a 200 caracteres"

**`describe('calculateSavings')`**
- "calcula porcentaje correcto"
- "isSmaller true cuando output < input"
- "isSmaller false cuando output >= input"

**`describe('parseFFprobeOutput')`**
- "parsea JSON de ffprobe valido"
- "devuelve null para JSON invalido"
- "extrae width, height, duration correctamente"

### 5.2 tests/unit/server.test.js

```javascript
import { describe, it, expect, afterAll } from 'vitest';
// Importar server, arrancar en puerto random: server.listen(0)
// Helper: request(method, path, body)
// afterAll(() => listener?.close())
```

**Tests requeridos:**
- "GET /api/health devuelve status ok"
- "POST /api/convert sin archivo → 400"
- "GET /api/jobs/:id con id inexistente → 404 o error SSE"
- "POST /api/jobs/:id/cancel con id inexistente → 404"
- "archivos estaticos se sirven correctamente"
- "path traversal bloqueado (/../etc/passwd → 403)"

### 5.3 e2e/fixtures/generate-fixture.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Generando fixtures de video..."

# Fixture 1: MOV pequeño (2s, 320x240, ~100KB)
ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=24 \
  -f lavfi -i sine=frequency=440:duration=2 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-small.mov"

# Fixture 2: MOV mediano (5s, 1280x720)
ffmpeg -y -f lavfi -i testsrc=duration=5:size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:duration=5 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-720p.mov"

# Fixture 3: MOV grande (5s, 1920x1080)
ffmpeg -y -f lavfi -i testsrc=duration=5:size=1920x1080:rate=30 \
  -f lavfi -i sine=frequency=440:duration=5 \
  -c:v prores -c:a pcm_s16le \
  "$SCRIPT_DIR/test-1080p.mov"

# Fixture 4: Archivo NO-MOV (para test de rechazo)
ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=24 \
  -c:v libx264 \
  "$SCRIPT_DIR/test-not-mov.mp4"

echo "Fixtures generados en $SCRIPT_DIR"
```

---

## Seccion 6 — Manejo de errores

| Escenario | Respuesta API | UI |
|-----------|---------------|-----|
| Archivo no es MOV (extension) | 400 + mensaje | Toast error rojo |
| Archivo no es MOV (magic bytes) | 400 + mensaje | Toast error rojo |
| Archivo > 2 GB | 413 "Archivo muy grande" | Toast error con limite |
| FFmpeg no instalado | health check lo detecta | Banner de error persistente |
| FFmpeg crash mid-conversion | SSE event error | Mostrar error + boton "Reintentar" |
| Usuario cancela conversion | 200 ok | Volver a estado "configuring" |
| Conexion SSE perdida | N/A | Reconectar automatico (5 intentos) |
| Browser refresh durante conversion | N/A | Recuperar estado via sessionStorage |
| Servidor se reinicia con jobs | graceful shutdown | SSE error "servidor reiniciandose" |
| Demasiadas solicitudes | 429 | Toast "Espera un momento" |
| Disco lleno | 500 "Sin espacio" | Toast error descriptivo |

---

## Seccion 7 — Definicion de "Done" (Checklist)

La implementacion esta completa cuando:

- [ ] `./run_app.sh` arranca el servidor sin errores
- [ ] Se puede subir un archivo .mov y convertirlo a .mp4
- [ ] La barra de progreso avanza en tiempo real durante la conversion
- [ ] Se muestran metadatos del video original (duracion, resolucion, codec, fps)
- [ ] El MP4 resultante se reproduce correctamente en el navegador (gracias a `-movflags +faststart`)
- [ ] Se puede descargar el MP4 con nombre descriptivo
- [ ] Se muestra la comparativa de tamaños (original vs convertido con % ahorro)
- [ ] La cancelacion funciona (mata el proceso FFmpeg)
- [ ] Archivos no-MOV son rechazados (tanto por extension como por magic bytes)
- [ ] `npm test` pasa todos los tests sin errores
- [ ] El live-reload funciona (editar app.css → recarga automatica)
- [ ] La UI es responsiva (funciona en movil y desktop)
- [ ] Todos los textos visibles al usuario estan en español
- [ ] .gitignore excluye node_modules, uploads, converted, .env
- [ ] CLAUDE.md documenta la arquitectura y comandos
- [ ] `GET /api/health` devuelve estado correcto con deteccion de FFmpeg

---

## Seccion 8 — Requisitos de rendimiento

- La conversion debe INICIAR (primer evento SSE de metadata) en menos de 3 segundos tras el upload
- ffprobe debe completar en menos de 2 segundos para archivos < 1 GB
- El frontend debe cargar (`DOMContentLoaded`) en menos de 1 segundo
- La barra de progreso debe actualizarse al menos cada 2 segundos
- Los archivos temporales deben eliminarse en maximo 15 minutos tras completar

---

## Seccion 9 — Referencias a proyectos existentes

Estos proyectos contienen patrones probados que DEBEN usarse como referencia directa:

**SOUND_FIX (`../sound_fix/`):**
- `server.mjs`: servidor HTTP nativo, `safeResolve()`, export API con tokens, live-reload SSE, `openBrowser()`, MIME map
- `src/js/editorCore.js`: `validateFile()` con magic bytes, funciones puras sin DOM, `getSaveHandler` con `showSaveFilePicker`
- `run_app.sh`: `pick_free_port`, verificacion de node/npm, `exec` con PORT
- `tests/unit/editorCore.test.js`: estructura Vitest, helper `fakeFile` con magic bytes
- `CLAUDE.md`: formato de documentacion
- `.gitignore`: exclusiones estandar

**AUDIO_FUSION (`../audio_fusion/`):**
- `backend/app.py`: sistema de Jobs con estados, progress tracking, job cleanup con TTL, concurrent job handling

**VIDEOTR (`../VideoTR/`):**
- `app.py`: `process_transcription` con threading, progress updates, `secure_filename`, `task_id` con uuid, cleanup de temporales

---

## Seccion 10 — Orden de implementacion

Seguir este orden estrictamente. Verificar cada paso antes de avanzar al siguiente:

| Paso | Que hacer | Verificacion |
|------|-----------|-------------|
| 1 | Crear estructura de archivos, `package.json`, `.gitignore`, `.env.example` | `ls -la` muestra la estructura |
| 2 | `converterCore.js` (funciones puras) + `converterCore.test.js` | `npm test` — todos los tests pasan |
| 3 | `server.mjs` (estaticos + health + live-reload) | `curl http://localhost:5173/api/health` devuelve JSON |
| 4 | `public/index.html` + `src/css/app.css` (layout completo) | La pagina carga con dark theme correcto |
| 5 | `POST /api/convert` + sistema de jobs + ffprobe | Subir un MOV → ver metadatos en respuesta |
| 6 | Conversion FFmpeg con progreso SSE | Barra de progreso avanza en tiempo real |
| 7 | Descarga del resultado + comparativa de tamaños | Descargar MP4 → se reproduce correctamente |
| 8 | `src/js/app.js` (toda la logica UI: upload, SSE, progress, download) | Flujo completo end-to-end funciona |
| 9 | Cancelacion + reconexion SSE + sessionStorage recovery | Cancelar mid-conversion → FFmpeg muere, UI se resetea |
| 10 | `server.test.js` + verificar todos los tests | `npm test` — todos pasan |
| 11 | `run_app.sh` + `CLAUDE.md` + `README.md` | `./run_app.sh` arranca sin errores |
| 12 | `generate-fixture.sh` + test manual end-to-end | Conversion completa con fixture generado |
| 13 | Requisitos P1 (logging, graceful shutdown, rate limiting, notificaciones, atajos) | Funcionalidades P1 operativas |

---

## Instrucciones adicionales

1. **NO uses frameworks CSS ni JS.** Todo vanilla. BEM para las clases CSS.
2. **NO uses Express, Koa, Fastify ni ningun framework HTTP.** Solo `node:http` nativo.
3. **Prioridad absoluta**: que funcione la conversion. El MP4 debe generarse correctamente y reproducirse en el navegador. Si hay dudas, prioriza funcionalidad sobre diseño.
4. **Verificacion final**: despues de crear todo, ejecuta los tests y confirma que la conversion MOV → MP4 funciona end-to-end. Si algo falla, corrigelo antes de dar por terminado.
5. **README.md** debe incluir: descripcion del proyecto, requisitos previos (Node.js 18+, FFmpeg), instrucciones de instalacion y arranque, como ejecutar tests.
