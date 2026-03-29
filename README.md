<div align="center">

# VideoMovMp4

**Conversor MOV → MP4 optimizado para web y redes sociales**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-required-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![Vitest](https://img.shields.io/badge/Tests-222%20passed-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

<br>

Sube un archivo `.mov`, elige la plataforma de destino (Web, TikTok, Instagram, YouTube), ajusta calidad, y descarga un `.mp4` optimizado.
Todo el procesamiento se realiza en tu maquina con FFmpeg — ningun archivo sale de tu equipo.

</div>

---

## Tabla de contenidos

- [Caracteristicas](#caracteristicas)
- [Requisitos previos](#requisitos-previos)
- [Inicio rapido](#inicio-rapido)
- [Configuracion](#configuracion)
- [Uso de la interfaz](#uso-de-la-interfaz)
- [Atajos de teclado](#atajos-de-teclado)
- [API](#api)
- [Pipeline de conversion](#pipeline-de-conversion)
- [Calidad y CRF](#calidad-y-crf)
- [Arquitectura](#arquitectura)
- [Tests](#tests)
- [Seguridad](#seguridad)
- [Referencia de comandos](#referencia-de-comandos)
- [Solucion de problemas](#solucion-de-problemas)
- [Documentacion completa](#documentacion-completa)
- [Licencia](#licencia)

---

## Caracteristicas

### Conversion

- **MOV a MP4** con codecs H.264 (libx264) + AAC
- **Presets por plataforma** — Web, TikTok, Instagram (Reels, Story, Feed 1:1/4:5/16:9), WhatsApp, YouTube. Cada preset ajusta automaticamente resolucion, aspect ratio, fps, bitrate y perfil H.264
- **Recorte de vídeo (trim)** — selecciona punto de inicio y fin con un dual-range slider antes de convertir. FFmpeg usa `-ss`/`-t` con input seeking para recorte instantaneo
- **Espejo horizontal** — opcion para invertir el video horizontalmente (filtro `hflip`)
- **Marca de agua (imagen)** — superpone una imagen (PNG, JPG, WebP, SVG) con posicion (5 presets + arrastre libre), tamaño (5-50%) y opacidad (10-100%)
- **Marca de agua (texto)** — superpone texto con fuente configurable (Montserrat Alternates, Arial, Courier, Times), tamaño (12-200px), color (selector hex), opacidad (10-100%) y posicion (5 presets + arrastre libre)
- **Preview unificado** — una sola previsualizacion donde imagen y texto se ven superpuestos sobre el video, cada uno arrastrable independientemente. Refleja el espejo horizontal en tiempo real
- **`-movflags +faststart`** — el MP4 se reproduce en el navegador sin descargar completo
- **`-pix_fmt yuv420p`** — compatibilidad maxima con reproductores y dispositivos
- **Calidad ajustable** — slider de 1 a 100 con mapeo CRF perceptual (no lineal)
- **Resolucion** — Original, 1080p, 720p o 480p (solo reduce, nunca amplia)
- **Presets de velocidad** — Ultrarapido, Rapido, Equilibrado o Maxima calidad

### Interfaz

- **Drag & drop** — arrastra tu archivo MOV directamente al navegador
- **Preview** — previsualiza el video original antes de convertir
- **Progreso en tiempo real** — barra de progreso via SSE con FPS, velocidad y ETA
- **Comparativa de tamaños** — muestra original vs convertido con porcentaje de ahorro
- **Preview del resultado** — reproduce el MP4 convertido antes de descargar
- **Dark theme** — estetica cinematografica con paleta violeta/cyan sobre fondo oscuro
- **Responsive** — funciona en movil, tablet y escritorio (mobile first)
- **Accesible** — WCAG AA, navegacion completa con teclado, `aria-live` para estados

### Resiliencia

- **Reconexion SSE automatica** — backoff exponencial (1s, 2s, 4s, 8s, 16s), 5 reintentos
- **Recuperacion de sesion** — si refrescas el navegador durante una conversion, reconecta automaticamente al job en curso (via `sessionStorage`)
- **Cancelacion** — deten una conversion en cualquier momento (envia `SIGTERM` a FFmpeg)
- **Descarga inteligente** — usa `showSaveFilePicker` (Chrome/Edge) con fallback a `<a download>`
- **Notificaciones** — toast, sonido (Web Audio API) y notificacion del sistema al completar

### Servidor

- **Sin frameworks** — servidor HTTP nativo (`node:http`), sin Express
- **Conversiones concurrentes** — hasta 2 jobs simultaneos (configurable)
- **Rate limiting** — 5 subidas por minuto por IP
- **Limpieza automatica** — jobs expirados y archivos temporales se eliminan cada 5 minutos
- **Graceful shutdown** — `SIGTERM`/`SIGINT` cierra limpiamente todos los jobs activos, notifica a los clientes SSE y limpia archivos temporales
- **Live-reload** — en desarrollo, editar CSS/JS/HTML recarga el navegador automaticamente

---

## Requisitos previos

| Dependencia | Version minima | Verificacion | Instalacion (macOS) |
|-------------|:--------------:|:-------------|---------------------|
| **Node.js** | 18+ | `node --version` | `brew install node` |
| **FFmpeg** | 5+ | `ffmpeg -version` | `brew install ffmpeg` |
| **ffprobe** | (incluido) | `ffprobe -version` | (viene con FFmpeg) |

> **Nota:** FFmpeg debe estar disponible en el PATH del sistema. En Ubuntu/Debian: `sudo apt install ffmpeg`.

---

## Inicio rapido

```bash
# 1. Instalar dependencias
cd VideoMobMp4
npm install

# 2. Arrancar (busca puerto libre + abre Chrome)
./run_app.sh
```

El script `run_app.sh` realiza estas acciones:

1. Verifica que `node`, `npm` y `ffmpeg` estan disponibles
2. Ejecuta `npm install` si `node_modules/` no existe
3. Busca un puerto libre a partir del 5173 (usando `lsof`)
4. Arranca el servidor y abre Chrome automaticamente

### Arranque alternativo

```bash
npm start              # Puerto 5173 (o el definido en PORT)
npm run dev            # Con --watch (reinicia al guardar server.mjs)
PORT=8080 npm start    # Puerto personalizado
NO_OPEN=1 npm start    # Sin abrir navegador
```

---

## Configuracion

Copia `.env.example` a `.env` y ajusta los valores:

```env
PORT=5173                 # Puerto del servidor
MAX_FILE_SIZE_MB=2048     # Tamaño maximo de subida en MB (default: 2 GB)
MAX_CONCURRENT_JOBS=2     # Conversiones simultaneas permitidas
CLEANUP_INTERVAL_MIN=5    # Cada cuantos minutos limpiar jobs expirados
JOB_TTL_MIN=10            # Minutos que un job completado permanece disponible
```

> **Nota:** los valores por defecto se aplican si no existe archivo `.env`.

---

## Uso de la interfaz

### 1. Subir archivo

- Arrastra un archivo `.mov` a la zona de drop, o haz clic en "Examinar archivo"
- El archivo se valida localmente: extension, tamaño (max 2 GB) y magic bytes (`ftyp`)
- Se muestra una preview del video, el nombre y el tamaño

### 2. Ajustar opciones

- **Plataforma** — selecciona el destino: Personalizado, Web, TikTok, Instagram, WhatsApp o YouTube. Cada plataforma aplica automaticamente los ajustes optimos (resolucion, aspect ratio, fps, bitrate, perfil H.264)
  - **Instagram** ofrece sub-selector: Reels (9:16), Story (9:16), Feed cuadrado (1:1), Feed vertical (4:5), Feed horizontal (16:9)
  - **Personalizado** permite controlar todos los ajustes manualmente (comportamiento clasico)
- **Calidad** — slider de 1 a 100 (default 75). Muestra el valor CRF calculado en tiempo real. Disponible en todos los modos
- **Recortar** — toggle para activar, dual-range slider con inicio/fin y duracion seleccionada en formato MM:SS
- **Espejo horizontal** — toggle para invertir el video horizontalmente
- **Marca de agua (imagen)** — toggle, selector de imagen, posicion (5 presets o arrastre libre en el preview), slider de tamaño (5-50%), slider de opacidad (10-100%)
- **Marca de agua (texto)** — toggle, campo de texto, selector de fuente (Montserrat Alternates regular/bold, Arial, Courier, Times), color picker, slider de tamaño (12-200px), slider de opacidad (10-100%), posicion (5 presets o arrastre libre en el preview)
- Ambas marcas se visualizan en un **preview unificado** donde se pueden arrastrar independientemente
- **Resolucion** — dropdown (solo visible en modo Personalizado). Si seleccionas una resolucion mayor a la del video, se mantiene la original
- **Preset de velocidad** — velocidad de codificacion (solo visible en modo Personalizado). "Equilibrado" es el default

### 3. Convertir

- Pulsa "Convertir a MP4" o `Ctrl+Enter`
- Se muestran los metadatos del video original (duracion, resolucion, codec, FPS, tamaño)
- La barra de progreso avanza en tiempo real con estadisticas: FPS, velocidad, tiempo transcurrido y ETA
- Puedes cancelar en cualquier momento con el boton o `Escape`

### 4. Descargar

- Al completar, se muestra la preview del video convertido
- Comparativa de tamaños: original vs convertido con porcentaje de ahorro
- Pulsa "Descargar MP4" o `Ctrl+S`
- "Atrás" vuelve al panel de opciones con todos los ajustes intactos para reconvertir con otros parametros
- "Convertir otro video" reinicia al estado inicial

---

## Atajos de teclado

| Atajo | Accion | Disponible en |
|-------|--------|:-------------:|
| `Ctrl/Cmd + Enter` | Iniciar conversion | Panel de opciones |
| `Escape` | Cancelar conversion (con confirmacion) | Panel de progreso |
| `Ctrl/Cmd + S` | Descargar MP4 | Panel de resultado |

---

## API

### Endpoints

| Metodo | Endpoint | Descripcion |
|:------:|----------|-------------|
| `GET` | `/api/health` | Estado del servidor, FFmpeg y jobs activos |
| `POST` | `/api/convert` | Subir `.mov` y crear job de conversion |
| `GET` | `/api/jobs/:id` | SSE con progreso en tiempo real |
| `POST` | `/api/jobs/:id/cancel` | Cancelar conversion activa (SIGTERM) |
| `GET` | `/api/jobs/:id/download` | Descargar el `.mp4` resultante |
| `GET` | `/api/livereload` | SSE para live-reload en desarrollo |

### Ejemplos con curl

#### Health check

```bash
curl http://localhost:5173/api/health
```

```json
{
  "status": "ok",
  "ffmpeg": true,
  "uptime": 120,
  "activeJobs": 0,
  "totalJobs": 3,
  "version": "1.1.2"
}
```

#### Subir y convertir un archivo

```bash
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "resolution=720p" \
  -F "preset=medium" \
  -F "platform=custom" \
  -F "mirror=0"

# Con preset de plataforma (TikTok)
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "platform=tiktok" \
  -F "mirror=0"

# Instagram Feed vertical (4:5)
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "platform=instagram" \
  -F "igFormat=feed-vertical"

# Instagram Story (9:16)
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "platform=instagram" \
  -F "igFormat=story"

# Con recorte (del segundo 5 al 15)
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "trimStart=5" \
  -F "trimEnd=15" \
  -F "trimDuration=30"

# Con marca de agua (abajo derecha, 20% del ancho)
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "platform=youtube" \
  -F "watermark=@logo.png" \
  -F "watermarkPosition=bottom-right" \
  -F "watermarkSize=20" \
  -F "watermarkOpacity=0.5"

# Con marca de agua de texto
curl -X POST http://localhost:5173/api/convert \
  -F "video=@mi_video.mov" \
  -F "quality=75" \
  -F "platform=web" \
  -F "textWm=Mi Logo" \
  -F "textWmFont=montserrat" \
  -F "textWmSize=64" \
  -F "textWmColor=#ff0000" \
  -F "textWmOpacity=0.7" \
  -F "textWmPosition=bottom-right"
```

```json
{
  "jobId": "184cc753-a227-4fbd-b369-fd92bafe0124",
  "statusUrl": "/api/jobs/184cc753-a227-4fbd-b369-fd92bafe0124"
}
```

#### Seguir progreso (SSE)

```bash
curl -N http://localhost:5173/api/jobs/184cc753-a227-4fbd-b369-fd92bafe0124
```

Eventos recibidos:

```
data: {"type":"metadata","data":{"duration":10.5,"width":1920,"height":1080,"videoCodec":"prores","audioCodec":"pcm_s16le","fps":30,"bitrate":5000000,"fileSize":6500000}}

data: {"type":"progress","data":{"percent":45,"fps":120.5,"speed":"4.0x","elapsed":12,"eta":15}}

data: {"type":"done","data":{"downloadUrl":"/api/jobs/184cc753.../download","outputSize":77198,"outputSizeFormatted":"75.4 KB","duration":10.5,"savings":95}}
```

#### Cancelar conversion

```bash
curl -X POST http://localhost:5173/api/jobs/184cc753.../cancel
```

```json
{ "ok": true, "message": "Conversión cancelada" }
```

#### Descargar resultado

```bash
curl -o video_convertido.mp4 http://localhost:5173/api/jobs/184cc753.../download
```

### Codigos de respuesta

| Codigo | Significado | Cuando |
|:------:|-------------|--------|
| `200` | Exito | Operacion completada |
| `400` | Error de validacion | Extension invalida, magic bytes invalidos, sin archivo |
| `403` | Prohibido | Path traversal detectado |
| `404` | No encontrado | Job inexistente o archivo expirado |
| `413` | Archivo muy grande | Excede el limite de 2 GB |
| `429` | Limite excedido | Rate limit (5/min/IP) o concurrencia maxima (2 jobs) |
| `500` | Error interno | Error inesperado del servidor |

---

## Pipeline de conversion

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Upload  │───>│ Validar  │───>│ ffprobe  │───>│  ffmpeg  │───>│ Descarga │
│   MOV    │    │ ext+ftyp │    │ metadata │    │ H.264+AAC│    │   MP4    │
└─────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                     │
                                                SSE progress
                                              (%, fps, speed, eta)
```

### Paso a paso

1. **Upload** — el archivo se sube via `POST /api/convert` (multipart/form-data)
2. **Validacion** — extension `.mov` (case-insensitive) + magic bytes (`ftyp` en offset 4-7, subtipo valido en offset 8-11)
3. **ffprobe** — extrae duracion, resolucion, codec de video/audio, FPS y tamaño del archivo
4. **ffmpeg** — convierte a MP4. Dos modos:

**Modo Personalizado** (ajustes manuales):
```bash
ffmpeg -i input.mov \
  -c:v libx264 -crf 21 -preset medium \
  -c:a aac -b:a 128k \
  -movflags +faststart -pix_fmt yuv420p \
  [-vf scale=1280:-2[,hflip]] \
  -progress pipe:1 -y output.mp4
```

**Modo Plataforma** (ej. TikTok):
```bash
ffmpeg -i input.mov \
  -c:v libx264 -crf 21 -preset medium \
  -profile:v main -level 4.0 \
  -vf crop=608:1080,hflip \      # Crop 9:16 + espejo si activado
  -r 30 \                        # FPS cap
  -maxrate 2500k -bufsize 5000k \ # Bitrate cap
  -c:a aac -b:a 128k \
  -movflags +faststart -pix_fmt yuv420p \
  -progress pipe:1 -y output.mp4
```

**Con marca de agua de imagen** (se usa `-filter_complex` en lugar de `-vf`):
```bash
ffmpeg -i input.mov -i logo.png \
  -filter_complex "[0:v]scale=1920:-2[main];[1:v]scale=iw*20/100:-1,format=rgba,colorchannelmixer=aa=0.5[wm];[main][wm]overlay=W-w-10:H-h-10[v]" \
  -map "[v]" -map 0:a? \
  -c:v libx264 -crf 21 ... -y output.mp4
```

**Con marca de agua de texto** (filtro `drawtext`):
```bash
ffmpeg -i input.mov \
  -vf "drawtext=fontfile=/ruta/MontserratAlternates-Regular.ttf:text='Mi Logo':fontsize=64:fontcolor=#ff0000@0xb3:x=W-w-10:y=H-h-10" \
  -c:v libx264 -crf 21 ... -y output.mp4
```

| Plataforma | Resolucion max | Aspect Ratio | FPS max | Bitrate max | Perfil H.264 | Audio |
|---|---|---|---|---|---|---|
| Web | 1920x1080 | original | original | CRF only | main L4.0 | 128k |
| TikTok | 1080x1920 | 9:16 (crop) | 30 | 2500k | main L4.0 | 128k |
| Instagram Reels | 1080x1920 | 9:16 (crop) | 30 | 3500k | main L4.0 | 128k |
| Instagram Story | 1080x1920 | 9:16 (crop) | 30 | 3500k | main L4.0 | 128k |
| Instagram Feed cuadrado | 1080x1080 | 1:1 (crop) | 30 | 3500k | main L4.0 | 128k |
| Instagram Feed vertical | 1080x1350 | 4:5 (crop) | 30 | 3500k | main L4.0 | 128k |
| Instagram Feed horizontal | 1080x608 | 16:9 (crop) | 30 | 3500k | main L4.0 | 128k |
| WhatsApp | 960x540 | original | 30 | 1500k | baseline L3.1 | 96k |
| YouTube | 3840x2160 | original | original | 8000k | high L4.1 | 192k |

5. **Descarga** — el MP4 queda disponible en `/api/jobs/:id/download` con `Content-Disposition: attachment`

---

## Calidad y CRF

El slider de calidad (1-100) se convierte a CRF de FFmpeg usando una **curva perceptual**, no un mapeo lineal. Esto se debe a que la percepcion humana de calidad no es lineal: la diferencia entre CRF 18 y 20 es imperceptible, pero entre CRF 28 y 30 es notable.

### Formula

```javascript
const normalized = (quality - 1) / 99;         // 0.0 a 1.0
const curved = Math.pow(normalized, 0.7);       // curva perceptual
const crf = Math.round(35 - curved * 17);       // 35 → 18
```

### Tabla de referencia

| Slider | CRF | Calidad percibida | Uso recomendado |
|:------:|:---:|-------------------|-----------------|
| **100** | 18 | Maxima (visualmente lossless) | Archivos master, edicion posterior |
| **75** | ~21 | Alta | Web, YouTube, redes sociales |
| **50** | ~24 | Media | Email, mensajeria, ancho de banda limitado |
| **25** | ~29 | Baja | Previews rapidos, minimo tamaño |
| **1** | 35 | Minima | Thumbnails, pruebas |

> **Nota:** CRF menores producen archivos mas grandes pero con mejor calidad. El rango util de CRF para H.264 es 18-28 para la mayoria del contenido.

### Resolucion — sin ampliacion

La conversion solo reduce la resolucion, nunca la amplia. Si el video original es 720p y seleccionas 1080p, se mantiene 720p. El valor `-2` en `scale=W:-2` asegura que la altura sea divisible por 2 (requisito de H.264).

| Preset | Ancho objetivo |
|--------|:--------------:|
| Original | sin cambio |
| 1080p | 1920 px |
| 720p | 1280 px |
| 480p | 854 px |

---

## Arquitectura

```
VideoMobMp4/
├── server.mjs              # Servidor HTTP nativo (node:http), API, jobs, FFmpeg
├── run_app.sh              # Arranque con port scanning
├── package.json            # Scripts y dependencias
├── .env.example            # Variables de entorno documentadas
│
├── public/
│   └── index.html          # SPA (Font Awesome, Notyf, Inter via CDN)
│
├── src/
│   ├── js/
│   │   ├── app.js          # UI: upload, SSE, progreso, descarga, estados
│   │   └── converterCore.js # Funciones puras (validacion, CRF, formato, presets, watermark, drawtext)
│   ├── img/
│   │   └── image.svg          # Placeholder SVG para marca de agua
│   └── fonts/
│       ├── MontserratAlternates-Regular.ttf
│       └── MontserratAlternates-Bold.ttf
│   └── css/
│       └── app.css         # Dark theme, BEM, responsive (mobile first)
│
├── tests/unit/
│   ├── converterCore.test.js  # 186 tests de funciones puras, presets, watermark y drawtext
│   └── server.test.js         # 7 tests de endpoints API
│
├── e2e/fixtures/           # Videos de prueba generados con FFmpeg
├── uploads/                # MOV subidos (temporal, en .gitignore)
└── converted/              # MP4 resultantes (temporal, en .gitignore)
```

### Stack

| Capa | Tecnologia | Razon |
|------|------------|-------|
| **Servidor** | `node:http` nativo | Sin dependencias, control total, minima superficie de ataque |
| **Procesamiento** | FFmpeg + ffprobe (CLI) | Estandar de la industria para conversion de video |
| **Frontend** | HTML5 + CSS BEM + JS vanilla | Sin build step, sin transpilacion, carga instantanea |
| **Comunicacion** | Server-Sent Events (SSE) | Ideal para progreso unidireccional servidor → cliente |
| **Tests** | Vitest | Rapido, compatible con ES modules, API limpia |

### Diagrama de flujo

```
                          NAVEGADOR
  ┌──────────────────────────────────────────────────┐
  │                                                  │
  │  ┌────────┐  ┌──────────┐  ┌────────┐  ┌──────┐ │
  │  │ Upload │─>│ Settings │─>│Progress│─>│Result│ │
  │  └────────┘  └──────────┘  └────────┘  └──────┘ │
  │       │            │           ▲           │     │
  └───────┼────────────┼───────────┼───────────┼─────┘
          │        FormData     SSE stream     │
          │          POST     (EventSource)  fetch GET
  ════════╪════════════╪═══════════╪═══════════╪══════
          │            ▼           │           ▼
  ┌───────┼────────────────────────┼─────────────────┐
  │       │      SERVIDOR         │                  │
  │       │                       │                  │
  │  Validacion ──> ffprobe ──> ffmpeg ──> MP4 listo │
  │  (ext + ftyp)   (metadata)   (H.264)   (descarga)│
  │                       │                          │
  │                  SSE broadcast ───────────────>   │
  │                                                  │
  │  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
  │  │ Rate Limit │  │ Cleanup  │  │  Heartbeat   │ │
  │  │ 5 req/min  │  │ cada 5m  │  │  cada 15s    │ │
  │  └────────────┘  └──────────┘  └──────────────┘ │
  └──────────────────────────────────────────────────┘
```

### Maquina de estados del job

```
POST /api/convert
       │
       ▼
  ┌─────────┐    ┌─────────┐    ┌───────────┐
  │ queued  │───>│ probing │───>│converting │
  └─────────┘    └─────────┘    └─────┬─────┘
                                 ┌────┼────┐
                              exito cancel error
                                 │    │    │
                                 ▼    ▼    ▼
                            ┌────┐ ┌────┐ ┌─────┐
                            │done│ │canc│ │error│
                            └────┘ └────┘ └─────┘
```

---

## Tests

```bash
npm test              # Ejecutar los 222 tests
npm run test:watch    # Tests en modo watch
npm run create-fixture # Generar videos de prueba con FFmpeg
```

### Cobertura

| Archivo | Tests | Que verifica |
|---------|:-----:|-------------|
| `converterCore.test.js` | 215 | `validateMovExtension` (6), `validateMovMagicBytes` (6), `qualityToCRF` (7), `buildResolutionArgs` (5), `formatFileSize` (6), `formatDuration` (5), `formatETA` (4), `sanitizeFilename` (5), `calculateSavings` (3), `parseFFprobeOutput` (4), `PLATFORM_PRESETS` (3), `getPlatformPreset` (2), `buildVideoFilterChain` (9), `buildPlatformArgs` (8), `WATERMARK_POSITIONS` (7), `WATERMARK_SIZES` (2), `buildWatermarkFilter` (46), `parseWatermarkPosition` (15), `buildWatermarkFilter custom` (5), `WATERMARK_FONTS` (4), `escapeDrawtext` (9), `buildTextWatermarkFilter` (24), `formatTimecode` (9), `buildTrimArgs` (11) |
| `server.test.js` | 7 | Health check, upload sin archivo, job inexistente, cancel inexistente, archivos estaticos, path traversal, 404 |

### Fixtures de prueba

El script `generate-fixture.sh` crea 4 archivos de prueba con FFmpeg:

| Fixture | Resolucion | Duracion | Codec | Tamaño |
|---------|:----------:|:--------:|:-----:|:------:|
| `test-small.mov` | 320x240 | 2s | ProRes + PCM | ~1.4 MB |
| `test-720p.mov` | 1280x720 | 3s | ProRes + PCM | ~9.9 MB |
| `test-1080p.mov` | 1920x1080 | 3s | ProRes + PCM | ~16 MB |
| `test-not-mov.mp4` | 320x240 | 1s | H.264 | ~8 KB |

---

## Seguridad

| Mecanismo | Descripcion |
|-----------|-------------|
| **Validacion doble** | Extension `.mov` + magic bytes (`ftyp` header en offset 4-7) |
| **Sanitizacion** | Nombres de archivo limpiados: elimina `..`, caracteres especiales, trunca a 200 chars |
| **Path traversal** | `safeResolve()` verifica que toda ruta resuelta empiece con `ROOT_DIR` |
| **Rate limiting** | 5 peticiones POST por minuto por IP (ventana deslizante) |
| **Concurrencia** | Maximo 2 conversiones simultaneas (configurable) |
| **Tamaño** | Limite de 2 GB por archivo (configurable) |
| **Limpieza** | Jobs expirados y archivos temporales se eliminan cada 5 minutos |
| **Procesamiento local** | Todo se ejecuta en tu maquina — ningun archivo se sube a servicios externos |

---

## Referencia de comandos

| Comando | Descripcion |
|---------|-------------|
| `./run_app.sh` | Arranca servidor con verificacion de dependencias y port scanning |
| `npm start` | Servidor en puerto por defecto (5173) |
| `npm run dev` | Servidor con `--watch` (reinicia al guardar) |
| `npm test` | Ejecutar 222 tests (Vitest) |
| `npm run test:watch` | Tests en modo watch |
| `npm run create-fixture` | Generar videos MOV de prueba |
| `NO_OPEN=1 npm start` | Arrancar sin abrir el navegador |
| `PORT=8080 npm start` | Arrancar en puerto personalizado |

---

## Solucion de problemas

### FFmpeg no encontrado

```
Error: ffmpeg no encontrado. Instala con: brew install ffmpeg
```

FFmpeg debe estar en el PATH. Verifica con `ffmpeg -version`. En macOS: `brew install ffmpeg`. En Ubuntu: `sudo apt install ffmpeg`.

### Puerto ocupado

`run_app.sh` busca automaticamente un puerto libre a partir del 5173. Si usas `npm start` y el puerto esta ocupado, define otro con `PORT=8080 npm start`.

### Archivo rechazado aunque es .mov

VideoMovMp4 valida los magic bytes del archivo, no solo la extension. Algunos archivos `.mov` generados por software no convencional pueden usar subtipos no reconocidos. Los subtipos aceptados son: `qt  ` (QuickTime), `isom`, `mp42`, `MSNV`, `M4V `.

Para verificar los magic bytes de tu archivo:

```bash
xxd -l 16 tu_archivo.mov
```

Busca `ftyp` en los bytes 4-7 y el subtipo en los bytes 8-11.

### La conversion tarda mucho

- Usa el preset "Ultrarapido" en lugar de "Equilibrado" — sacrifica algo de compresion por velocidad
- Reduce la resolucion (720p o 480p en lugar de Original)
- Los archivos ProRes de Apple son especialmente grandes; el ahorro en la conversion sera mayor pero tomara mas tiempo

### El MP4 no se reproduce en el navegador

Esto no deberia ocurrir gracias a `-movflags +faststart` y `-pix_fmt yuv420p`. Si ocurre, verifica que el MP4 sea valido:

```bash
ffprobe -v quiet -print_format json -show_format archivo_convertido.mp4
```

### Error "Servidor ocupado"

El limite de concurrencia por defecto es de 2 conversiones simultaneas. Espera a que termine una conversion o aumenta `MAX_CONCURRENT_JOBS` en `.env`.

### Error "Demasiadas solicitudes"

El rate limiting permite 5 subidas por minuto por IP. Espera 60 segundos antes de intentar de nuevo.

### La sesion no se recupera al refrescar

La recuperacion de sesion usa `sessionStorage`, que solo persiste mientras la pestaña esta abierta. Si cierras la pestaña y abres una nueva, el jobId se pierde. Sin embargo, el job sigue ejecutandose en el servidor y se limpiara automaticamente tras el TTL.

---

## Documentacion completa

Para documentacion tecnica detallada (arquitectura interna, diagramas de flujo, referencia de todas las funciones, eventos SSE, manejo de errores, etc.), consulta:

**[DOCUMENTACION.md](DOCUMENTACION.md)** — 18 secciones, ~1200 lineas de referencia tecnica completa.

---

## Licencia

ISC
