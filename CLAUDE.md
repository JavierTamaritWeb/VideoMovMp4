# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- `./run_app.sh` — Start server with auto port scanning (checks deps, finds free port from 5173)
- `npm start` — Start server on default port (5173)
- `npm run dev` — Start with `--watch` for auto-restart on file changes
- `npm test` — Run all tests (Vitest)
- `npm run test:watch` — Tests in watch mode
- `npm run create-fixture` — Generate test MOV files with FFmpeg (`e2e/fixtures/generate-fixture.sh`)

## Prerequisites
- Node.js 18+
- FFmpeg + ffprobe installed (`brew install ffmpeg` on macOS)

## Architecture

**No build step.** The frontend is served as raw ES modules by the Node server. No bundler, no transpilation.

| File | Role |
|------|------|
| `server.mjs` | HTTP server (native `node:http`), API endpoints, job lifecycle, FFmpeg orchestration, static file serving, live-reload SSE |
| `src/js/converterCore.js` | Pure functions (no DOM/Node deps): validation, CRF mapping, format helpers, filename sanitization, ffprobe parsing, platform presets, video filter chain building, image watermark filter, text watermark filter (drawtext) |
| `src/fonts/` | Montserrat Alternates Regular + Bold TTF (for FFmpeg drawtext) |
| `src/js/app.js` | Browser UI controller: state machine (idle → configuring → converting → done/error), SSE client, drag-and-drop, download |
| `public/index.html` | Single HTML page with CDN deps (Font Awesome, Notyf, Inter, Montserrat Alternates) |
| `src/css/app.css` | Dark theme, BEM naming, desktop-optimized (max-width 1400px) |

### Key patterns

- **Shared code:** `converterCore.js` is imported by both `server.mjs` (Node) and `app.js` (browser) — keep it free of platform-specific APIs.
- **Job system:** In-memory `Map` of jobs keyed by UUID. Jobs transition through states: `queued → probing → converting → done|error|cancelled`. Jobs auto-cleanup after `JOB_TTL_MIN` (default 10 min).
- **Real-time progress:** Server pushes FFmpeg progress via SSE (`/api/jobs/:id`). Client reconnects with exponential backoff (max 5 retries).
- **File validation:** Two-step — extension check (`.mov`) then magic bytes (`ftyp` header + valid subtype like `qt`, `isom`, `mp42`).
- **Concurrency:** Rate limiter (5 req/min per IP) + max concurrent jobs (default 2). Configurable via env vars.
- **Multipart parsing:** Custom implementation in `server.mjs` supporting multiple files keyed by field name (video + watermark). Returns `{ fields, files, fileData, fileFilename }`.
- **Graceful shutdown:** SIGTERM/SIGINT kill active FFmpeg processes, close SSE clients, clean temp files.
- **Platform presets:** `PLATFORM_PRESETS` in `converterCore.js` defines per-platform FFmpeg settings (web, tiktok, instagram, whatsapp, youtube). `buildPlatformArgs()` returns the full FFmpeg args array; `buildVideoFilterChain()` handles aspect ratio crop + scale. When a platform is selected, resolution/encoding-preset controls are hidden and the preset drives those values.
- **Trim (recorte):** Toggle + dual-range slider para seleccionar inicio/fin del vídeo. `formatTimecode()` y `buildTrimArgs()` en `converterCore.js`. FFmpeg usa `-ss`/`-t` antes de `-i` (input seeking). El cálculo de progreso usa la duración recortada.
- **Mirror (hflip):** Toggle in the settings panel. The `hflip` filter is injected into the `-vf` chain in `server.mjs` after args are built (works with both custom and platform paths).
- **Back button:** "Atrás" button in the result panel returns to `configuring` state with all settings preserved (file, platform, quality, watermarks, mirror, etc.) for re-conversion without re-uploading.
- **Comparison preview:** Side-by-side Original vs Resultado panels (grid `1fr 1fr`). Original shows the unmodified video frame. Resultado shows all effects applied (filters, mirror, watermarks). Visible whenever a video is loaded. First frame decoded via `currentTime = 0.001` + `seeked` event.
- **Video filters:** `VIDEO_FILTERS` in `converterCore.js` — 12 filters (B/N, sepia, invert, vintage, vignette, blur, sharpen, bright, contrast, saturate, desaturate). Each has `filter` (FFmpeg) and `css` (canvas preview). `getVideoFilter()` for lookup. Selector buttons in UI.
- **Mute audio:** Toggle to strip audio (`-an` replaces `-c:a/-b:a` in FFmpeg args).
- **Target size:** Input for max MB (presets 8/16/25/50). `buildTargetSizeArgs()` calculates video bitrate from target. Replaces CRF with `-b:v/-maxrate/-bufsize`.
- **Speed:** Slider 0.25x-4x. `buildSpeedFilter()` returns `setpts` + chained `atempo`. Progress duration adjusted by speed factor.
- **Image watermark:** Image overlay with position (5 presets + custom drag), size (5-50%), opacity (10-100%). Uses `-filter_complex` with `overlay`. Custom drag coords sent as `custom:X:Y`. `parseWatermarkPosition()` in `converterCore.js`. Placeholder SVG (`src/img/image.svg`).
- **Text watermark:** Text overlay via FFmpeg `drawtext`. Font (Montserrat Alternates regular/bold, Arial, Courier, Times), size (12-200px), color (hex), opacity (10-100%), position (5 presets + custom drag). `WATERMARK_FONTS`, `escapeDrawtext()`, `buildTextWatermarkFilter()` in `converterCore.js`. Font TTFs in `src/fonts/`.
- **Active chips:** Bar of chips above the "Convertir" button showing all active changes (platform, filter, mirror, mute, speed, trim, target size, watermarks). Each chip has a ✕ button to deactivate that specific setting independently, in any order.
- **Conversion history:** localStorage-persisted list (max 20) of past conversions showing filename, platform, savings, and date. Rendered in a scrollable panel.
- **User presets:** Save/load named presets (platform, quality, filter, speed, mirror, mute, etc.) to localStorage. Apply button restores all settings at once.
- **Preview play/pause:** Button to animate the comparison preview — plays the video and redraws both canvases in a rAF loop with all effects applied in real-time.
- **Capture frame:** Button to export the result canvas (with all effects) as a downloadable PNG file.

## Endpoints
- `POST /api/convert` — Upload MOV + start conversion job (fields: video, quality, resolution, preset, platform, igFormat, mirror, mute, speed, targetSizeMB, videoFilter, trimStart, trimEnd, trimDuration, watermark, watermarkPosition, watermarkSize, watermarkOpacity, textWm, textWmFont, textWmSize, textWmColor, textWmOpacity, textWmPosition)
- `GET /api/jobs/:id` — SSE stream with progress events (metadata → progress → done/error)
- `POST /api/jobs/:id/cancel` — Cancel conversion (sends SIGTERM to FFmpeg)
- `GET /api/jobs/:id/download` — Download converted MP4
- `GET /api/health` — Server status + FFmpeg availability
- `GET /api/livereload` — SSE for dev live-reload

## Conversion pipeline
1. Upload MOV → validate extension + magic bytes (ftyp)
2. `ffprobe` → extract metadata (duration, resolution, codec, fps)
3. `ffmpeg` → convert to MP4. Two paths:
   - **Custom:** libx264, user-selected CRF/resolution/preset (legacy path)
   - **Platform:** `buildPlatformArgs()` sets codec, profile, level, bitrate cap, aspect ratio crop, fps cap per platform
   - If trim enabled: `-ss HH:MM:SS.s -t HH:MM:SS.s` inserted before `-i` (input seeking)
   - If video filter selected: filter injected into `-vf` chain (e.g. `colorchannelmixer`, `negate`, `eq=`)
   - If mirror enabled: `hflip` filter appended to `-vf` chain
   - If mute enabled: `-an` replaces audio codec args
   - If target size set: `-b:v/-maxrate/-bufsize` replaces `-crf`
   - If speed != 1: `setpts` in `-vf` + `-af atempo` chain. Progress duration adjusted
   - If image watermark enabled: switches from `-vf` to `-filter_complex` with `[0:v]{filters}[main]; [1:v]scale[wm]; [main][wm]overlay[v]`
   - If text watermark enabled: appends `drawtext=fontfile=...:text=...:fontsize=...:fontcolor=...` to `-vf` or `-filter_complex`
4. Stream progress via SSE → download available on completion

## Testing

Tests use Vitest with no config file (defaults from `package.json`). Test files live in `tests/unit/`.

- `converterCore.test.js` — Unit tests for all pure functions in `converterCore.js`
- `server.test.js` — API integration tests: starts the real server on a random port, tests endpoints with raw `http.request`
- `e2e.test.js` — End-to-end tests: uploads real MOV fixtures, converts with FFmpeg, verifies MP4 output with ffprobe (H.264 codec, no audio when muted, etc.)

Test fixtures in `e2e/fixtures/` (`.mov` files generated by FFmpeg via `npm run create-fixture`).

## Environment variables (see `.env.example`)
- `PORT` — Server port (default 5173)
- `MAX_FILE_SIZE_MB` — Upload limit in MB (default 2048)
- `MAX_CONCURRENT_JOBS` — Parallel FFmpeg processes (default 2)
- `JOB_TTL_MIN` — Minutes before completed jobs are cleaned up (default 10)
- `NO_OPEN=1` — Suppress auto-opening browser on start

## Language
UI strings and log messages are in Spanish. Keep this consistent.
