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
