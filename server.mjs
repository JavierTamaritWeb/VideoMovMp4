import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { exec, execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import {
  validateMovExtension,
  validateMovMagicBytes,
  qualityToCRF,
  buildResolutionArgs,
  parseFFprobeOutput,
  sanitizeFilename,
  formatFileSize,
  buildPlatformArgs,
  buildWatermarkFilter,
} from './src/js/converterCore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;

const PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE_MB || 2048) * 1024 * 1024;
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS) || 2;
const CLEANUP_INTERVAL_MS = (parseInt(process.env.CLEANUP_INTERVAL_MIN) || 5) * 60 * 1000;
const JOB_TTL_MS = (parseInt(process.env.JOB_TTL_MIN) || 10) * 60 * 1000;

const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const CONVERTED_DIR = path.join(ROOT_DIR, 'converted');

// Ensure dirs exist
for (const dir of [UPLOADS_DIR, CONVERTED_DIR]) {
  fsSync.mkdirSync(dir, { recursive: true });
}

// ─── Logging ─────────────────────────────────────────────────────────────────
function log(level, msg, jobId) {
  const ts = new Date().toISOString();
  const prefix = jobId ? `Job ${jobId.slice(0, 8)}: ` : '';
  console.log(`[${ts}] [${level}]  ${prefix}${msg}`);
}

// ─── MIME types ──────────────────────────────────────────────────────────────
const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/x-icon'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
]);

// ─── Path traversal prevention ───────────────────────────────────────────────
function safeResolve(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]).split('#')[0];
  const requestPath = decoded === '/' ? '/public/index.html' : decoded;
  const absPath = path.resolve(ROOT_DIR, '.' + requestPath);
  if (!absPath.startsWith(ROOT_DIR)) return null;
  return absPath;
}

// ─── Browser auto-open ───────────────────────────────────────────────────────
function openBrowser(url) {
  if (process.env.NO_OPEN === '1') return;
  const cmd = process.platform === 'darwin'
    ? `open -a "Google Chrome" "${url}"`
    : process.platform === 'win32'
      ? `start Chrome "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

// ─── Live-reload SSE ─────────────────────────────────────────────────────────
const liveReloadClients = new Set();

function notifyLiveReload() {
  for (const res of liveReloadClients) {
    res.write('data: reload\n\n');
  }
}

let liveReloadTimer = null;
function debouncedReload() {
  if (liveReloadTimer) clearTimeout(liveReloadTimer);
  liveReloadTimer = setTimeout(() => { liveReloadTimer = null; notifyLiveReload(); }, 150);
}

// ─── Rate limiter ────────────────────────────────────────────────────────────
const rateLimits = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 60_000;

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// ─── Jobs system ─────────────────────────────────────────────────────────────
const jobs = new Map();

function createJob(inputPath, originalFilename, sanitized, quality, resolution, preset, platform, igFormat, mirror, watermarkPath, watermarkPosition, watermarkSize, watermarkOpacity) {
  const id = uuidv4();
  const outputPath = path.join(CONVERTED_DIR, `${id}.mp4`);
  const job = {
    id,
    state: 'queued',
    inputPath,
    outputPath,
    originalFilename,
    sanitizedFilename: sanitized,
    quality: parseInt(quality) || 75,
    resolution: resolution || 'original',
    preset: preset || 'medium',
    platform: platform || 'custom',
    igFormat: igFormat || 'reels',
    mirror: mirror === '1' || mirror === true,
    watermarkPath: watermarkPath || null,
    watermarkPosition: watermarkPosition || 'bottom-right',
    watermarkSize: parseInt(watermarkSize) || 20,
    watermarkOpacity: parseFloat(watermarkOpacity) || 1,
    metadata: null,
    progress: { percent: 0, fps: 0, speed: '', elapsed: 0, eta: 0 },
    ffmpegProcess: null,
    sseClients: new Set(),
    createdAt: Date.now(),
    completedAt: null,
    error: null,
  };
  jobs.set(id, job);
  return job;
}

function getActiveJobCount() {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.state === 'converting' || job.state === 'probing') count++;
  }
  return count;
}

function broadcastSSE(job, event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of job.sseClients) {
    try { client.write(data); } catch { /* client gone */ }
  }
}

async function cleanupJob(job) {
  try { await fs.unlink(job.inputPath).catch(() => {}); } catch {}
  try { await fs.unlink(job.outputPath).catch(() => {}); } catch {}
  if (job.watermarkPath) {
    try { await fs.unlink(job.watermarkPath).catch(() => {}); } catch {}
  }
}

// Periodic cleanup of completed/errored jobs
let cleanupInterval;
function startCleanupTimer() {
  cleanupInterval = setInterval(async () => {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if ((job.state === 'done' || job.state === 'error' || job.state === 'cancelled') &&
          job.completedAt && (now - job.completedAt > JOB_TTL_MS)) {
        await cleanupJob(job);
        jobs.delete(id);
        log('INFO', `Limpiado job expirado`, id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// SSE heartbeat for all active job clients
let heartbeatInterval;
function startHeartbeatTimer() {
  heartbeatInterval = setInterval(() => {
    for (const job of jobs.values()) {
      for (const client of job.sseClients) {
        try { client.write(':\n\n'); } catch {}
      }
    }
    // Also heartbeat live-reload clients
    for (const client of liveReloadClients) {
      try { client.write(':\n\n'); } catch {}
    }
  }, 15_000);
}

// ─── FFprobe ─────────────────────────────────────────────────────────────────
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath];
    const proc = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(stderr || `ffprobe exit code ${code}`));
      const parsed = parseFFprobeOutput(stdout);
      if (!parsed) return reject(new Error('No se pudo parsear la salida de ffprobe'));
      resolve(parsed);
    });
  });
}

// ─── FFmpeg conversion ───────────────────────────────────────────────────────
function startConversion(job) {
  let args;
  const platformArgs = (job.platform && job.platform !== 'custom')
    ? buildPlatformArgs(
        job.platform,
        job.quality,
        job.metadata?.width || 0,
        job.metadata?.height || 0,
        job.metadata?.fps || 0,
        job.igFormat,
      )
    : null;

  if (platformArgs) {
    args = [
      '-i', job.inputPath,
      ...platformArgs,
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      '-progress', 'pipe:1',
      '-y',
      job.outputPath,
    ];
    log('INFO', `Iniciando conversión [${job.platform}]: calidad ${job.quality}`, job.id);
  } else {
    const crf = qualityToCRF(job.quality);
    const resArgs = job.metadata
      ? buildResolutionArgs(job.resolution, job.metadata.width, job.metadata.height)
      : [];
    args = [
      '-i', job.inputPath,
      '-c:v', 'libx264',
      '-crf', String(crf),
      '-preset', job.preset,
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-pix_fmt', 'yuv420p',
      ...resArgs,
      '-progress', 'pipe:1',
      '-y',
      job.outputPath,
    ];
    log('INFO', `Iniciando conversión: CRF ${qualityToCRF(job.quality)}, ${job.resolution}, preset ${job.preset}`, job.id);
  }

  // Inject hflip filter for mirror mode
  if (job.mirror) {
    const vfIdx = args.indexOf('-vf');
    if (vfIdx !== -1) {
      args[vfIdx + 1] += ',hflip';
    } else {
      const progIdx = args.indexOf('-progress');
      args.splice(progIdx, 0, '-vf', 'hflip');
    }
  }

  // Inject watermark overlay (requires -filter_complex instead of -vf)
  if (job.watermarkPath) {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter(job.watermarkPosition, job.watermarkSize, job.watermarkOpacity);

    // Add watermark as second input right after the first -i
    const firstInputIdx = args.indexOf('-i');
    args.splice(firstInputIdx + 2, 0, '-i', job.watermarkPath);

    // Extract and remove any existing -vf filter
    const vfIdx = args.indexOf('-vf');
    let videoFilters = '';
    if (vfIdx !== -1) {
      videoFilters = args[vfIdx + 1];
      args.splice(vfIdx, 2);
    }

    // Build filter_complex graph:
    //   [0:v]{existing filters}[main]; {watermark scale}; [main][wm]overlay=x:y[v]
    const mainChain = videoFilters
      ? `[0:v]${videoFilters}[main]`
      : '[0:v]copy[main]';
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    const progIdx = args.indexOf('-progress');
    args.splice(progIdx, 0, '-filter_complex', filterComplex, '-map', '[v]', '-map', '0:a?');

    log('INFO', `Marca de agua: pos=${job.watermarkPosition}, tamaño=${job.watermarkSize}%`, job.id);
  }

  const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.ffmpegProcess = proc;
  job.state = 'converting';

  const totalDurationUs = (job.metadata?.duration || 0) * 1_000_000;
  const startTime = Date.now();
  let progressData = {};

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const [key, ...valParts] = line.split('=');
      if (key && valParts.length) {
        progressData[key.trim()] = valParts.join('=').trim();
      }

      if (key?.trim() === 'progress') {
        const outTimeUs = parseInt(progressData.out_time_us) || 0;
        const percent = totalDurationUs > 0
          ? Math.min(99, Math.round((outTimeUs / totalDurationUs) * 100))
          : 0;
        const elapsed = (Date.now() - startTime) / 1000;
        const eta = percent > 0 ? (elapsed / percent) * (100 - percent) : 0;

        job.progress = {
          percent,
          fps: parseFloat(progressData.fps) || 0,
          speed: progressData.speed || '',
          elapsed: Math.round(elapsed),
          eta: Math.round(eta),
        };

        broadcastSSE(job, { type: 'progress', data: job.progress });
        progressData = {};
      }
    }
  });

  let stderrBuf = '';
  proc.stderr.on('data', d => stderrBuf += d);

  proc.on('close', async (code, signal) => {
    job.ffmpegProcess = null;

    if (signal === 'SIGTERM' || job.state === 'cancelled') {
      job.state = 'cancelled';
      job.completedAt = Date.now();
      broadcastSSE(job, { type: 'error', data: { message: 'Conversión cancelada por el usuario', code: 'CANCELLED' } });
      await fs.unlink(job.outputPath).catch(() => {});
      log('INFO', 'Conversión cancelada', job.id);
      return;
    }

    if (code !== 0) {
      job.state = 'error';
      job.completedAt = Date.now();
      let msg = 'Error durante la conversión';
      if (stderrBuf.includes('No such file')) msg = 'Archivo no encontrado';
      else if (stderrBuf.includes('Invalid data')) msg = 'El archivo está corrupto o no es un MOV válido';
      else if (stderrBuf.includes('codec not found')) msg = 'Códec no soportado';
      job.error = msg;
      broadcastSSE(job, { type: 'error', data: { message: msg, code: 'FFMPEG_ERROR' } });
      await fs.unlink(job.outputPath).catch(() => {});
      log('ERROR', `FFmpeg exit code ${code}: ${stderrBuf.slice(-200)}`, job.id);
      return;
    }

    // Success
    try {
      const stat = await fs.stat(job.outputPath);
      job.progress.percent = 100;
      job.state = 'done';
      job.completedAt = Date.now();

      const savings = job.metadata?.fileSize
        ? Math.round((1 - stat.size / job.metadata.fileSize) * 100)
        : 0;

      broadcastSSE(job, {
        type: 'done',
        data: {
          downloadUrl: `/api/jobs/${job.id}/download`,
          outputSize: stat.size,
          outputSizeFormatted: formatFileSize(stat.size),
          duration: job.metadata?.duration || 0,
          savings,
        },
      });
      log('INFO', `Conversión completada: ${formatFileSize(stat.size)} (${savings}% ahorro)`, job.id);
    } catch (err) {
      job.state = 'error';
      job.completedAt = Date.now();
      job.error = 'Error al verificar archivo de salida';
      broadcastSSE(job, { type: 'error', data: { message: job.error, code: 'OUTPUT_ERROR' } });
    }
  });
}

async function processJob(job) {
  try {
    // Step 1: Probe
    job.state = 'probing';
    log('INFO', 'Ejecutando ffprobe...', job.id);
    const metadata = await probeFile(job.inputPath);
    job.metadata = metadata;
    broadcastSSE(job, { type: 'metadata', data: metadata });

    // Step 2: Convert
    startConversion(job);
  } catch (err) {
    job.state = 'error';
    job.completedAt = Date.now();
    job.error = err.message;
    broadcastSSE(job, { type: 'error', data: { message: err.message, code: 'PROBE_ERROR' } });
    log('ERROR', `Probe failed: ${err.message}`, job.id);
  }
}

// ─── Multipart parser (simple, for multer-free approach) ─────────────────────
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!boundaryMatch) return reject(new Error('No boundary in content-type'));

    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_FILE_SIZE) {
        req.destroy();
        reject(new Error('FILE_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const boundaryBuf = Buffer.from(`--${boundary}`);

      const fields = {};
      const files = {};

      // Split by boundary
      let start = 0;
      const parts = [];
      while (true) {
        const idx = buffer.indexOf(boundaryBuf, start);
        if (idx === -1) break;
        if (start > 0) {
          parts.push(buffer.subarray(start, idx));
        }
        start = idx + boundaryBuf.length;
        // Skip \r\n after boundary
        if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
        // Check for closing --
        if (buffer[start] === 0x2d && buffer[start + 1] === 0x2d) break;
      }

      for (const part of parts) {
        // Find header/body separator (\r\n\r\n)
        const sepIdx = part.indexOf('\r\n\r\n');
        if (sepIdx === -1) continue;

        const headerStr = part.subarray(0, sepIdx).toString('utf-8');
        let body = part.subarray(sepIdx + 4);
        // Remove trailing \r\n
        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
          body = body.subarray(0, body.length - 2);
        }

        const nameMatch = headerStr.match(/name="([^"]+)"/);
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);

        if (filenameMatch && nameMatch) {
          files[nameMatch[1]] = { data: body, filename: filenameMatch[1] };
        } else if (nameMatch) {
          fields[nameMatch[1]] = body.toString('utf-8');
        }
      }

      // Backward-compatible: expose main video file as fileData/fileFilename
      const videoFile = files.video || Object.values(files)[0];
      const fileData = videoFile?.data || null;
      const fileFilename = videoFile?.filename || '';

      resolve({ fields, files, fileData, fileFilename });
    });

    req.on('error', reject);
  });
}

// ─── Check FFmpeg availability ───────────────────────────────────────────────
function isFFmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ─── JSON response helper ────────────────────────────────────────────────────
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────
export const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const urlPath = req.url.split('?')[0];
    const clientIP = req.socket.remoteAddress || 'unknown';

    // ── API: Health ────────────────────────────────────────────────────────
    if (urlPath === '/api/health' && req.method === 'GET') {
      const uptime = Math.round(process.uptime());
      sendJSON(res, 200, {
        status: 'ok',
        ffmpeg: isFFmpegAvailable(),
        uptime,
        activeJobs: getActiveJobCount(),
        totalJobs: jobs.size,
        version: '1.0.0',
      });
      return;
    }

    // ── API: Live-reload SSE ───────────────────────────────────────────────
    if (urlPath === '/api/livereload' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: connected\n\n');
      liveReloadClients.add(res);
      req.on('close', () => liveReloadClients.delete(res));
      return;
    }

    // ── API: Convert (upload + start) ──────────────────────────────────────
    if (urlPath === '/api/convert' && req.method === 'POST') {
      // Rate limiting
      if (!checkRateLimit(clientIP)) {
        sendJSON(res, 429, { error: 'Demasiadas solicitudes. Espera un momento.' });
        return;
      }

      // Concurrency limit
      if (getActiveJobCount() >= MAX_CONCURRENT_JOBS) {
        sendJSON(res, 429, { error: 'Servidor ocupado, intenta en unos segundos.' });
        return;
      }

      // Parse multipart
      let parsed;
      try {
        parsed = await parseMultipart(req);
      } catch (err) {
        if (err.message === 'FILE_TOO_LARGE') {
          sendJSON(res, 413, { error: `Archivo demasiado grande. Máximo: ${formatFileSize(MAX_FILE_SIZE)}` });
        } else {
          sendJSON(res, 400, { error: 'Error al procesar la subida: ' + err.message });
        }
        return;
      }

      const { fields, files, fileData, fileFilename } = parsed;

      if (!fileData || fileData.length === 0) {
        sendJSON(res, 400, { error: 'No se recibió ningún archivo.' });
        return;
      }

      // Validate extension
      if (!validateMovExtension(fileFilename)) {
        sendJSON(res, 400, { error: 'Solo se aceptan archivos .mov' });
        return;
      }

      // Validate magic bytes
      const magicResult = validateMovMagicBytes(new Uint8Array(fileData.subarray(0, 16)));
      if (!magicResult.valid) {
        sendJSON(res, 400, { error: magicResult.reason || 'El archivo no es un vídeo MOV válido' });
        return;
      }

      // Save video file
      const sanitized = sanitizeFilename(fileFilename);
      const jobId = uuidv4();
      const inputPath = path.join(UPLOADS_DIR, `${jobId}_${sanitized}`);
      await fs.writeFile(inputPath, fileData);

      // Save watermark file if present
      let watermarkPath = null;
      if (files.watermark && files.watermark.data.length > 0) {
        const wmExt = path.extname(files.watermark.filename).toLowerCase() || '.png';
        const allowedWmExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
        if (allowedWmExts.includes(wmExt)) {
          watermarkPath = path.join(UPLOADS_DIR, `${jobId}_watermark${wmExt}`);
          await fs.writeFile(watermarkPath, files.watermark.data);
        }
      }

      // Create job
      const job = createJob(
        inputPath,
        fileFilename,
        sanitized,
        fields.quality || '75',
        fields.resolution || 'original',
        fields.preset || 'medium',
        fields.platform || 'custom',
        fields.igFormat || 'reels',
        fields.mirror || '0',
        watermarkPath,
        fields.watermarkPosition || 'bottom-right',
        fields.watermarkSize || '20',
        fields.watermarkOpacity || '1',
      );
      // Override the job id to match the one used for the file
      jobs.delete(job.id);
      job.id = jobId;
      job.outputPath = path.join(CONVERTED_DIR, `${jobId}.mp4`);
      jobs.set(jobId, job);

      log('INFO', `Upload recibido: ${fileFilename} (${formatFileSize(fileData.length)})`, jobId);

      // Start processing async
      processJob(job);

      sendJSON(res, 200, { jobId, statusUrl: `/api/jobs/${jobId}` });
      return;
    }

    // ── API: Job SSE progress ──────────────────────────────────────────────
    const jobSSEMatch = urlPath.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
    if (jobSSEMatch && req.method === 'GET') {
      const job = jobs.get(jobSSEMatch[1]);
      if (!job) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: 'Job no encontrado', code: 'NOT_FOUND' } })}\n\n`);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      job.sseClients.add(res);
      req.on('close', () => job.sseClients.delete(res));

      // Send current state immediately
      if (job.metadata) {
        res.write(`data: ${JSON.stringify({ type: 'metadata', data: job.metadata })}\n\n`);
      }
      if (job.state === 'converting' && job.progress.percent > 0) {
        res.write(`data: ${JSON.stringify({ type: 'progress', data: job.progress })}\n\n`);
      }
      if (job.state === 'done') {
        const stat = await fs.stat(job.outputPath).catch(() => null);
        const savings = job.metadata?.fileSize && stat
          ? Math.round((1 - stat.size / job.metadata.fileSize) * 100) : 0;
        res.write(`data: ${JSON.stringify({
          type: 'done',
          data: {
            downloadUrl: `/api/jobs/${job.id}/download`,
            outputSize: stat?.size || 0,
            outputSizeFormatted: stat ? formatFileSize(stat.size) : '0 B',
            duration: job.metadata?.duration || 0,
            savings,
          },
        })}\n\n`);
      }
      if (job.state === 'error') {
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: job.error, code: 'FFMPEG_ERROR' } })}\n\n`);
      }
      if (job.state === 'cancelled') {
        res.write(`data: ${JSON.stringify({ type: 'error', data: { message: 'Conversión cancelada', code: 'CANCELLED' } })}\n\n`);
      }

      return;
    }

    // ── API: Cancel job ────────────────────────────────────────────────────
    const cancelMatch = urlPath.match(/^\/api\/jobs\/([a-f0-9-]+)\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const job = jobs.get(cancelMatch[1]);
      if (!job) {
        sendJSON(res, 404, { error: 'Job no encontrado' });
        return;
      }
      if (job.ffmpegProcess) {
        job.state = 'cancelled';
        job.ffmpegProcess.kill('SIGTERM');
      } else {
        job.state = 'cancelled';
        job.completedAt = Date.now();
      }
      sendJSON(res, 200, { ok: true, message: 'Conversión cancelada' });
      return;
    }

    // ── API: Download result ───────────────────────────────────────────────
    const downloadMatch = urlPath.match(/^\/api\/jobs\/([a-f0-9-]+)\/download$/);
    if (downloadMatch && req.method === 'GET') {
      const job = jobs.get(downloadMatch[1]);
      if (!job || job.state !== 'done') {
        sendJSON(res, 404, { error: 'El archivo no está disponible o ha expirado' });
        return;
      }

      const stat = await fs.stat(job.outputPath).catch(() => null);
      if (!stat) {
        sendJSON(res, 404, { error: 'El archivo ha expirado' });
        return;
      }

      const baseName = path.basename(job.originalFilename, '.mov') || 'video';
      const safeName = sanitizeFilename(baseName);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${safeName}_convertido.mp4"`,
      });

      const stream = fsSync.createReadStream(job.outputPath);
      stream.pipe(res);
      return;
    }

    // ── Static files ───────────────────────────────────────────────────────
    const filePath = safeResolve(req.url);
    if (!filePath) {
      res.statusCode = 403;
      res.end('Forbidden');
      return;
    }

    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath);
    res.setHeader('Content-Type', MIME.get(ext) ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');

    const data = await fs.readFile(filePath);
    res.statusCode = 200;
    res.end(data);
  } catch (err) {
    log('ERROR', `Server error: ${err.message}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  }
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
async function gracefulShutdown(signal) {
  log('INFO', `${signal} recibido, cerrando servidor...`);

  // Stop accepting connections
  server.close();

  // Kill active FFmpeg processes
  for (const job of jobs.values()) {
    if (job.ffmpegProcess) {
      broadcastSSE(job, { type: 'error', data: { message: 'Servidor reiniciándose', code: 'SERVER_SHUTDOWN' } });
      job.ffmpegProcess.kill('SIGTERM');
    }
    // Close SSE clients
    for (const client of job.sseClients) {
      try { client.end(); } catch {}
    }
  }

  // Close live-reload clients
  for (const client of liveReloadClients) {
    try { client.end(); } catch {}
  }

  clearInterval(cleanupInterval);
  clearInterval(heartbeatInterval);

  // Wait for processes to finish (max 10s)
  await new Promise(r => setTimeout(r, 2000));

  // Cleanup temp files from active jobs
  for (const job of jobs.values()) {
    if (job.state !== 'done') {
      await cleanupJob(job);
    }
  }

  log('INFO', 'Servidor cerrado');
  process.exit(0);
}

// ─── Start server ────────────────────────────────────────────────────────────
const __isMain = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
if (__isMain) {
  // Watch for live-reload
  for (const dir of ['src', 'public']) {
    const watchPath = path.join(ROOT_DIR, dir);
    try {
      fsSync.watch(watchPath, { recursive: true }, (_event, filename) => {
        if (filename && !filename.startsWith('.')) debouncedReload();
      });
    } catch {}
  }

  startCleanupTimer();
  startHeartbeatTimer();

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  server.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    log('INFO', `VideoMovMp4 corriendo en ${url}`);
    openBrowser(url);
  });
}
