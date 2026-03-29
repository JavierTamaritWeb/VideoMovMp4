/**
 * converterCore.js — Pure functions for VideoMovMp4.
 * No DOM or Node.js dependencies. Testable with Vitest.
 */

export function validateMovExtension(filename) {
  if (!filename || typeof filename !== 'string') return false;
  return filename.toLowerCase().endsWith('.mov');
}

export function validateMovMagicBytes(bytes) {
  if (!bytes || bytes.length < 12) {
    return { valid: false, reason: 'Archivo demasiado pequeño para ser un MOV válido' };
  }

  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
  if (ftyp !== 'ftyp') {
    return { valid: false, reason: 'El archivo no contiene la cabecera ftyp de un MOV' };
  }

  const subtype = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  const validSubtypes = ['qt  ', 'isom', 'mp42', 'MSNV', 'M4V '];
  if (!validSubtypes.includes(subtype)) {
    return { valid: false, reason: `Subtipo de contenedor no reconocido: "${subtype.trim()}"` };
  }

  return { valid: true };
}

export function qualityToCRF(quality) {
  const q = Math.max(1, Math.min(100, quality));
  const normalized = (q - 1) / 99;
  const curved = Math.pow(normalized, 0.7);
  const crf = Math.round(35 - curved * 17);
  return crf;
}

export function buildResolutionArgs(target, inputWidth, inputHeight) {
  if (target === 'original') return [];

  const targets = { '1080p': 1920, '720p': 1280, '480p': 854 };
  const targetW = targets[target];
  if (!targetW || inputWidth <= targetW) return [];

  return ['-vf', `scale=${targetW}:-2`];
}

export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i === 0) return `${bytes} B`;
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const s = Math.floor(seconds);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

export function formatETA(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s restantes`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s restantes` : `${mins}m restantes`;
}

export function calculateSavings(originalBytes, convertedBytes) {
  const savedBytes = originalBytes - convertedBytes;
  const savedPercent = originalBytes > 0
    ? Math.round((savedBytes / originalBytes) * 100)
    : 0;
  return {
    savedBytes,
    savedPercent,
    isSmaller: convertedBytes < originalBytes,
  };
}

export function parseFFprobeOutput(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
    const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');
    const format = data.format || {};

    if (!videoStream) return null;

    let fps = 0;
    if (videoStream.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
      fps = den ? Math.round((num / den) * 100) / 100 : 0;
    }

    return {
      duration: parseFloat(format.duration) || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      videoCodec: videoStream.codec_name || 'unknown',
      audioCodec: audioStream ? audioStream.codec_name : 'none',
      fps,
      bitrate: parseInt(format.bit_rate) || 0,
      fileSize: parseInt(format.size) || 0,
    };
  } catch {
    return null;
  }
}

export function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return 'file';
  let safe = name.replace(/\.\./g, '_');
  safe = safe.replace(/[^\w.\-() ]/g, '_');
  if (safe.length > 200) safe = safe.substring(0, 200);
  return safe;
}

// ─── Trim ───────────────────────────────────────────────────────────────────

export function formatTimecode(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00.0';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 10);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
}

export function buildTrimArgs(trimStart, trimEnd, duration) {
  const start = parseFloat(trimStart);
  const end = parseFloat(trimEnd);
  const dur = parseFloat(duration);

  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(dur)) return [];
  if (dur <= 0) return [];

  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(dur, end);
  if (clampedEnd <= clampedStart) return [];
  if (clampedStart <= 0.05 && clampedEnd >= dur - 0.05) return [];
  const trimDuration = clampedEnd - clampedStart;
  if (trimDuration <= 0) return [];

  return ['-ss', formatTimecode(clampedStart), '-t', formatTimecode(trimDuration)];
}

// ─── Platform Presets ───────────────────────────────────────────────────────

export const PLATFORM_PRESETS = {
  custom: {
    id: 'custom',
    label: 'Personalizado',
    description: 'Controla todos los ajustes manualmente',
    icon: 'fa-solid fa-sliders',
    maxWidth: null,
    maxHeight: null,
    maxFps: null,
    maxBitrateKbps: null,
    audioBitrateKbps: 128,
    profile: null,
    level: null,
    bframes: null,
    aspectRatio: null,
  },
  web: {
    id: 'web',
    label: 'Web',
    description: 'Optimizado para sitios web y carga rápida',
    icon: 'fa-solid fa-globe',
    maxWidth: 1920,
    maxHeight: 1080,
    maxFps: null,
    maxBitrateKbps: null,
    audioBitrateKbps: 128,
    profile: 'main',
    level: '4.0',
    bframes: null,
    aspectRatio: null,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    description: 'Vertical 9:16, máx. 1080×1920, 30 fps',
    icon: 'fa-brands fa-tiktok',
    maxWidth: 1080,
    maxHeight: 1920,
    maxFps: 30,
    maxBitrateKbps: 2500,
    audioBitrateKbps: 128,
    profile: 'main',
    level: '4.0',
    bframes: null,
    aspectRatio: '9:16',
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    description: 'Reels, Stories, Feed (1:1, 4:5, 16:9), máx. 1080p, 30 fps',
    icon: 'fa-brands fa-instagram',
    maxWidth: 1080,
    maxHeight: 1920,
    maxFps: 30,
    maxBitrateKbps: 3500,
    audioBitrateKbps: 128,
    profile: 'main',
    level: '4.0',
    bframes: null,
    aspectRatio: '9:16',
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    description: 'Optimizado para envío por WhatsApp, máx. 960×540, 30 fps',
    icon: 'fa-brands fa-whatsapp',
    maxWidth: 960,
    maxHeight: 540,
    maxFps: 30,
    maxBitrateKbps: 1500,
    audioBitrateKbps: 96,
    profile: 'baseline',
    level: '3.1',
    bframes: null,
    aspectRatio: null,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    description: 'Alta calidad, H.264 High, hasta 4K',
    icon: 'fa-brands fa-youtube',
    maxWidth: 3840,
    maxHeight: 2160,
    maxFps: null,
    maxBitrateKbps: 8000,
    audioBitrateKbps: 192,
    profile: 'high',
    level: '4.1',
    bframes: 2,
    aspectRatio: null,
  },
};

export function getPlatformPreset(platformId) {
  return PLATFORM_PRESETS[platformId] || PLATFORM_PRESETS.custom;
}

function makeEven(n) {
  return 2 * Math.floor(n / 2);
}

export function buildVideoFilterChain(preset, inputWidth, inputHeight, igFormat) {
  if (!inputWidth || !inputHeight) return '';

  let targetAR = null;
  let maxW = preset.maxWidth;
  let maxH = preset.maxHeight;

  // Instagram format overrides
  if (preset.id === 'instagram') {
    switch (igFormat) {
      case 'feed':
        targetAR = 1; maxW = 1080; maxH = 1080; break;
      case 'feed-vertical':
        targetAR = 4 / 5; maxW = 1080; maxH = 1350; break;
      case 'feed-horizontal':
        targetAR = 16 / 9; maxW = 1080; maxH = 608; break;
      case 'story':
        targetAR = 9 / 16; maxW = 1080; maxH = 1920; break;
      default: // reels — uses preset.aspectRatio (9:16)
        break;
    }
  }
  if (targetAR === null && preset.aspectRatio) {
    const [arW, arH] = preset.aspectRatio.split(':').map(Number);
    targetAR = arW / arH;
  }

  const filters = [];

  let currentW = inputWidth;
  let currentH = inputHeight;

  // Crop to target aspect ratio if needed
  if (targetAR !== null) {
    const inputAR = inputWidth / inputHeight;
    if (Math.abs(inputAR - targetAR) > 0.01) {
      let cropW, cropH;
      if (inputAR > targetAR) {
        // Input is wider → crop width
        cropH = inputHeight;
        cropW = makeEven(Math.round(inputHeight * targetAR));
      } else {
        // Input is taller → crop height
        cropW = inputWidth;
        cropH = makeEven(Math.round(inputWidth / targetAR));
      }
      filters.push(`crop=${cropW}:${cropH}`);
      currentW = cropW;
      currentH = cropH;
    }
  }

  // Scale down if exceeds max dimensions (never upscale)
  if (maxW && maxH) {
    if (currentW > maxW || currentH > maxH) {
      const scaleByW = maxW / currentW;
      const scaleByH = maxH / currentH;
      const scaleFactor = Math.min(scaleByW, scaleByH);
      const newW = makeEven(Math.round(currentW * scaleFactor));
      filters.push(`scale=${newW}:-2`);
    }
  }

  return filters.join(',');
}

export function buildPlatformArgs(platformId, quality, inputWidth, inputHeight, inputFps, igFormat) {
  const preset = getPlatformPreset(platformId);
  if (preset.id === 'custom') return null;

  const crf = qualityToCRF(quality);
  const args = [];

  // Video codec
  args.push('-c:v', 'libx264');
  args.push('-crf', String(crf));
  args.push('-preset', 'medium');

  // Profile and level
  if (preset.profile) args.push('-profile:v', preset.profile);
  if (preset.level) args.push('-level', preset.level);
  if (preset.bframes != null) args.push('-bf', String(preset.bframes));

  // Video filter chain
  const vf = buildVideoFilterChain(preset, inputWidth, inputHeight, igFormat);
  if (vf) args.push('-vf', vf);

  // FPS cap
  if (preset.maxFps && inputFps > preset.maxFps) {
    args.push('-r', String(preset.maxFps));
  }

  // Bitrate cap (VBV)
  if (preset.maxBitrateKbps) {
    args.push('-maxrate', `${preset.maxBitrateKbps}k`);
    args.push('-bufsize', `${preset.maxBitrateKbps * 2}k`);
  }

  // Audio
  args.push('-c:a', 'aac', '-b:a', `${preset.audioBitrateKbps}k`);

  return args;
}

// ─── Watermark ──────────────────────────────────────────────────────────────

export const WATERMARK_POSITIONS = {
  'top-left':     { label: 'Arriba izquierda', x: '10', y: '10' },
  'top-right':    { label: 'Arriba derecha',   x: 'W-w-10', y: '10' },
  'bottom-left':  { label: 'Abajo izquierda',  x: '10', y: 'H-h-10' },
  'bottom-right': { label: 'Abajo derecha',    x: 'W-w-10', y: 'H-h-10' },
  'center':       { label: 'Centro',           x: '(W-w)/2', y: '(H-h)/2' },
};

export const WATERMARK_SIZES = {
  10:  { label: '10%' },
  15:  { label: '15%' },
  20:  { label: '20%' },
  25:  { label: '25%' },
  30:  { label: '30%' },
};

export function parseWatermarkPosition(position) {
  if (typeof position === 'string' && position.startsWith('custom:')) {
    const parts = position.split(':');
    const x = parseInt(parts[1]);
    const y = parseInt(parts[2]);
    if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0) {
      return { x: String(x), y: String(y) };
    }
  }
  return WATERMARK_POSITIONS[position] || WATERMARK_POSITIONS['bottom-right'];
}

export function buildWatermarkFilter(position, sizePct, opacity) {
  const pos = parseWatermarkPosition(position);
  const parsedSize = parseInt(sizePct);
  const pct = Math.max(5, Math.min(50, Number.isFinite(parsedSize) ? parsedSize : 20));

  const parsedOpacity = parseFloat(opacity);
  const alpha = Math.max(0.1, Math.min(1, Number.isFinite(parsedOpacity) ? parsedOpacity : 1));
  const alphaRounded = Math.round(alpha * 100) / 100;

  // [1:v] is the watermark input; scale it relative to main video width
  const scaleStep = `scale=iw*${pct}/100:-1`;
  const alphaStep = alphaRounded < 1 ? `,format=rgba,colorchannelmixer=aa=${alphaRounded}` : '';
  const scaleFilter = `[1:v]${scaleStep}${alphaStep}[wm]`;
  const overlayFilter = `[0:v][wm]overlay=${pos.x}:${pos.y}`;

  return { scaleFilter, overlayFilter };
}

// ─── Text Watermark ─────────────────────────────────────────────────────────

export const WATERMARK_FONTS = {
  'montserrat':      { label: 'Montserrat Alternates', file: 'MontserratAlternates-Regular.ttf', css: "'Montserrat Alternates', sans-serif" },
  'montserrat-bold': { label: 'Montserrat Alternates Bold', file: 'MontserratAlternates-Bold.ttf', css: "'Montserrat Alternates', sans-serif" },
  'arial':           { label: 'Arial', file: null, css: 'Arial, sans-serif' },
  'courier':         { label: 'Courier', file: null, css: "'Courier New', Courier, monospace" },
  'times':           { label: 'Times New Roman', file: null, css: "'Times New Roman', Times, serif" },
};

export function escapeDrawtext(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "\u2019")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');
}

export function buildTextWatermarkFilter(text, fontSize, fontColor, fontFamily, position, opacity) {
  if (!text || typeof text !== 'string' || !text.trim()) return '';

  const pos = parseWatermarkPosition(position);

  const parsedSize = parseInt(fontSize);
  const size = Math.max(12, Math.min(200, Number.isFinite(parsedSize) ? parsedSize : 48));

  const color = (typeof fontColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(fontColor))
    ? fontColor
    : '#ffffff';

  const parsedOpacity = parseFloat(opacity);
  const alpha = Math.max(0.1, Math.min(1, Number.isFinite(parsedOpacity) ? parsedOpacity : 1));
  const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
  const fullColor = `${color}@0x${alphaHex}`;

  const font = WATERMARK_FONTS[fontFamily] || WATERMARK_FONTS['arial'];
  const fontParam = font.file
    ? `fontfile=FONTDIR/${font.file}`
    : `font='${font.label}'`;

  const escaped = escapeDrawtext(text.trim());

  return `drawtext=${fontParam}:text='${escaped}':fontsize=${size}:fontcolor=${fullColor}:x=${pos.x}:y=${pos.y}`;
}
