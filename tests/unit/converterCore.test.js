import { describe, it, expect } from 'vitest';
import {
  validateMovExtension,
  validateMovMagicBytes,
  qualityToCRF,
  buildResolutionArgs,
  formatFileSize,
  formatDuration,
  formatETA,
  calculateSavings,
  parseFFprobeOutput,
  sanitizeFilename,
  PLATFORM_PRESETS,
  getPlatformPreset,
  buildVideoFilterChain,
  buildPlatformArgs,
  WATERMARK_POSITIONS,
  WATERMARK_SIZES,
  buildWatermarkFilter,
} from '../../src/js/converterCore.js';

// Helper: build fake magic bytes
function fakeBytes(subtype = 'qt  ') {
  const arr = new Uint8Array(16);
  // bytes 4-7: "ftyp"
  arr[4] = 0x66; arr[5] = 0x74; arr[6] = 0x79; arr[7] = 0x70;
  // bytes 8-11: subtype
  for (let i = 0; i < 4; i++) arr[8 + i] = subtype.charCodeAt(i);
  return arr;
}

describe('validateMovExtension', () => {
  it('acepta .mov', () => {
    expect(validateMovExtension('video.mov')).toBe(true);
  });
  it('acepta .MOV (case-insensitive)', () => {
    expect(validateMovExtension('VIDEO.MOV')).toBe(true);
  });
  it('rechaza .mp4', () => {
    expect(validateMovExtension('video.mp4')).toBe(false);
  });
  it('rechaza .avi', () => {
    expect(validateMovExtension('video.avi')).toBe(false);
  });
  it('rechaza string vacío', () => {
    expect(validateMovExtension('')).toBe(false);
  });
  it('rechaza null/undefined', () => {
    expect(validateMovExtension(null)).toBe(false);
    expect(validateMovExtension(undefined)).toBe(false);
  });
});

describe('validateMovMagicBytes', () => {
  it('acepta magic bytes ftyp+qt', () => {
    expect(validateMovMagicBytes(fakeBytes('qt  '))).toEqual({ valid: true });
  });
  it('acepta magic bytes ftyp+isom', () => {
    expect(validateMovMagicBytes(fakeBytes('isom'))).toEqual({ valid: true });
  });
  it('acepta magic bytes ftyp+mp42', () => {
    expect(validateMovMagicBytes(fakeBytes('mp42'))).toEqual({ valid: true });
  });
  it('rechaza bytes aleatorios', () => {
    const random = new Uint8Array(16).fill(0xAB);
    const result = validateMovMagicBytes(random);
    expect(result.valid).toBe(false);
  });
  it('rechaza array vacío', () => {
    const result = validateMovMagicBytes(new Uint8Array(0));
    expect(result.valid).toBe(false);
  });
  it('rechaza null', () => {
    const result = validateMovMagicBytes(null);
    expect(result.valid).toBe(false);
  });
});

describe('qualityToCRF', () => {
  it('quality 100 → CRF 18', () => {
    expect(qualityToCRF(100)).toBe(18);
  });
  it('quality 75 → CRF entre 20 y 23', () => {
    const crf = qualityToCRF(75);
    expect(crf).toBeGreaterThanOrEqual(20);
    expect(crf).toBeLessThanOrEqual(23);
  });
  it('quality 50 → CRF entre 23 y 26', () => {
    const crf = qualityToCRF(50);
    expect(crf).toBeGreaterThanOrEqual(23);
    expect(crf).toBeLessThanOrEqual(26);
  });
  it('quality 25 → CRF entre 28 y 31', () => {
    const crf = qualityToCRF(25);
    expect(crf).toBeGreaterThanOrEqual(28);
    expect(crf).toBeLessThanOrEqual(31);
  });
  it('quality 1 → CRF 35', () => {
    expect(qualityToCRF(1)).toBe(35);
  });
  it('clamps valores fuera de rango (0 → 35, 150 → 18)', () => {
    expect(qualityToCRF(0)).toBe(35);
    expect(qualityToCRF(150)).toBe(18);
  });
  it('siempre devuelve entero', () => {
    for (let q = 1; q <= 100; q++) {
      expect(Number.isInteger(qualityToCRF(q))).toBe(true);
    }
  });
});

describe('buildResolutionArgs', () => {
  it('original → array vacío', () => {
    expect(buildResolutionArgs('original', 1920, 1080)).toEqual([]);
  });
  it('1080p con input 3840x2160 → scale=1920:-2', () => {
    expect(buildResolutionArgs('1080p', 3840, 2160)).toEqual(['-vf', 'scale=1920:-2']);
  });
  it('720p con input 1920x1080 → scale=1280:-2', () => {
    expect(buildResolutionArgs('720p', 1920, 1080)).toEqual(['-vf', 'scale=1280:-2']);
  });
  it('1080p con input 720p → array vacío (no ampliar)', () => {
    expect(buildResolutionArgs('1080p', 1280, 720)).toEqual([]);
  });
  it('480p con input 480p → array vacío (ya es la resolución)', () => {
    expect(buildResolutionArgs('480p', 854, 480)).toEqual([]);
  });
});

describe('formatFileSize', () => {
  it('0 → "0 B"', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
  it('1023 → "1023 B"', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
  });
  it('1024 → "1.0 KB"', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });
  it('1536 → "1.5 KB"', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });
  it('1048576 → "1.0 MB"', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });
  it('1073741824 → "1.0 GB"', () => {
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
  });
});

describe('formatDuration', () => {
  it('30 → "00:30"', () => {
    expect(formatDuration(30)).toBe('00:30');
  });
  it('90 → "01:30"', () => {
    expect(formatDuration(90)).toBe('01:30');
  });
  it('3661 → "1:01:01"', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });
  it('0 → "00:00"', () => {
    expect(formatDuration(0)).toBe('00:00');
  });
  it('NaN → "00:00"', () => {
    expect(formatDuration(NaN)).toBe('00:00');
  });
});

describe('formatETA', () => {
  it('45 → "45s restantes"', () => {
    expect(formatETA(45)).toBe('45s restantes');
  });
  it('150 → "2m 30s restantes"', () => {
    expect(formatETA(150)).toBe('2m 30s restantes');
  });
  it('0 → ""', () => {
    expect(formatETA(0)).toBe('');
  });
  it('NaN → ""', () => {
    expect(formatETA(NaN)).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('reemplaza caracteres especiales por _', () => {
    expect(sanitizeFilename('vídeo<test>$.mov')).toBe('v_deo_test__.mov');
  });
  it('mantiene letras, números, punto, guión', () => {
    expect(sanitizeFilename('video-2024.mov')).toBe('video-2024.mov');
  });
  it('elimina .. (path traversal)', () => {
    const result = sanitizeFilename('../../etc/passwd');
    expect(result).not.toContain('..');
  });
  it('trunca a 200 caracteres', () => {
    const long = 'a'.repeat(300) + '.mov';
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
  });
  it('devuelve "file" para null/undefined', () => {
    expect(sanitizeFilename(null)).toBe('file');
    expect(sanitizeFilename(undefined)).toBe('file');
  });
});

describe('calculateSavings', () => {
  it('calcula porcentaje correcto', () => {
    const result = calculateSavings(1000, 700);
    expect(result.savedBytes).toBe(300);
    expect(result.savedPercent).toBe(30);
  });
  it('isSmaller true cuando output < input', () => {
    expect(calculateSavings(1000, 700).isSmaller).toBe(true);
  });
  it('isSmaller false cuando output >= input', () => {
    expect(calculateSavings(1000, 1200).isSmaller).toBe(false);
    expect(calculateSavings(1000, 1000).isSmaller).toBe(false);
  });
});

describe('parseFFprobeOutput', () => {
  const validJSON = JSON.stringify({
    streams: [
      {
        codec_type: 'video',
        codec_name: 'prores',
        width: 1920,
        height: 1080,
        r_frame_rate: '30/1',
      },
      {
        codec_type: 'audio',
        codec_name: 'pcm_s16le',
      },
    ],
    format: {
      duration: '10.5',
      bit_rate: '5000000',
      size: '6500000',
    },
  });

  it('parsea JSON de ffprobe válido', () => {
    const result = parseFFprobeOutput(validJSON);
    expect(result).not.toBeNull();
    expect(result.videoCodec).toBe('prores');
    expect(result.audioCodec).toBe('pcm_s16le');
    expect(result.fps).toBe(30);
  });
  it('devuelve null para JSON inválido', () => {
    expect(parseFFprobeOutput('not json')).toBeNull();
  });
  it('extrae width, height, duration correctamente', () => {
    const result = parseFFprobeOutput(validJSON);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.duration).toBe(10.5);
  });
  it('devuelve null si no hay video stream', () => {
    const noVideo = JSON.stringify({
      streams: [{ codec_type: 'audio', codec_name: 'aac' }],
      format: { duration: '10' },
    });
    expect(parseFFprobeOutput(noVideo)).toBeNull();
  });
});

// ─── Platform Presets ───────────────────────────────────────────────────────

describe('PLATFORM_PRESETS', () => {
  it('contiene todas las plataformas esperadas', () => {
    expect(Object.keys(PLATFORM_PRESETS)).toEqual(
      expect.arrayContaining(['custom', 'web', 'tiktok', 'instagram', 'youtube'])
    );
  });
  it('cada preset tiene las propiedades requeridas', () => {
    for (const preset of Object.values(PLATFORM_PRESETS)) {
      expect(preset).toHaveProperty('id');
      expect(preset).toHaveProperty('label');
      expect(preset).toHaveProperty('audioBitrateKbps');
    }
  });
  it('custom tiene maxWidth null', () => {
    expect(PLATFORM_PRESETS.custom.maxWidth).toBeNull();
  });
});

describe('getPlatformPreset', () => {
  it('devuelve el preset correcto por id', () => {
    expect(getPlatformPreset('tiktok').id).toBe('tiktok');
    expect(getPlatformPreset('youtube').id).toBe('youtube');
  });
  it('devuelve custom para id desconocido', () => {
    expect(getPlatformPreset('unknown').id).toBe('custom');
    expect(getPlatformPreset(null).id).toBe('custom');
    expect(getPlatformPreset(undefined).id).toBe('custom');
  });
});

describe('buildVideoFilterChain', () => {
  const tiktokPreset = PLATFORM_PRESETS.tiktok;
  const webPreset = PLATFORM_PRESETS.web;
  const igPreset = PLATFORM_PRESETS.instagram;
  const ytPreset = PLATFORM_PRESETS.youtube;

  it('landscape 1920×1080 con TikTok → crop a 9:16 + scale', () => {
    const vf = buildVideoFilterChain(tiktokPreset, 1920, 1080);
    expect(vf).toContain('crop=');
    // Cropped width should be 9/16 * 1080 ≈ 608 (even)
    expect(vf).toMatch(/crop=60[68]:1080/);
  });

  it('portrait 1080×1920 con TikTok → sin filtro (ya encaja)', () => {
    const vf = buildVideoFilterChain(tiktokPreset, 1080, 1920);
    expect(vf).toBe('');
  });

  it('portrait pequeño 720×1280 con TikTok → sin scale (no ampliar)', () => {
    const vf = buildVideoFilterChain(tiktokPreset, 720, 1280);
    expect(vf).toBe('');
  });

  it('landscape 1920×1080 con Instagram Feed → crop 1:1', () => {
    const vf = buildVideoFilterChain(igPreset, 1920, 1080, 'feed');
    expect(vf).toContain('crop=1080:1080');
  });

  it('cuadrado 1080×1080 con Instagram Feed → sin filtro', () => {
    const vf = buildVideoFilterChain(igPreset, 1080, 1080, 'feed');
    expect(vf).toBe('');
  });

  it('4K landscape con Web → scale a 1920', () => {
    const vf = buildVideoFilterChain(webPreset, 3840, 2160);
    expect(vf).toContain('scale=1920:-2');
  });

  it('720p con Web → sin filtro (no excede 1920×1080)', () => {
    const vf = buildVideoFilterChain(webPreset, 1280, 720);
    expect(vf).toBe('');
  });

  it('4K con YouTube → sin filtro (no excede 3840×2160)', () => {
    const vf = buildVideoFilterChain(ytPreset, 3840, 2160);
    expect(vf).toBe('');
  });

  it('input 0×0 → string vacío', () => {
    expect(buildVideoFilterChain(tiktokPreset, 0, 0)).toBe('');
  });
});

describe('buildPlatformArgs', () => {
  it('custom → null', () => {
    expect(buildPlatformArgs('custom', 75, 1920, 1080, 30)).toBeNull();
  });

  it('web → contiene -profile:v main, -level 4.0', () => {
    const args = buildPlatformArgs('web', 75, 1920, 1080, 30);
    expect(args).toContain('-profile:v');
    expect(args[args.indexOf('-profile:v') + 1]).toBe('main');
    expect(args).toContain('-level');
    expect(args[args.indexOf('-level') + 1]).toBe('4.0');
  });

  it('tiktok con 60fps → incluye -r 30', () => {
    const args = buildPlatformArgs('tiktok', 75, 1080, 1920, 60);
    expect(args).toContain('-r');
    expect(args[args.indexOf('-r') + 1]).toBe('30');
  });

  it('tiktok con 24fps → no incluye -r', () => {
    const args = buildPlatformArgs('tiktok', 75, 1080, 1920, 24);
    expect(args).not.toContain('-r');
  });

  it('tiktok → incluye -maxrate 2500k', () => {
    const args = buildPlatformArgs('tiktok', 75, 1080, 1920, 30);
    expect(args).toContain('-maxrate');
    expect(args[args.indexOf('-maxrate') + 1]).toBe('2500k');
  });

  it('youtube → incluye -profile:v high, -bf 2, -b:a 192k', () => {
    const args = buildPlatformArgs('youtube', 75, 1920, 1080, 30);
    expect(args[args.indexOf('-profile:v') + 1]).toBe('high');
    expect(args).toContain('-bf');
    expect(args[args.indexOf('-bf') + 1]).toBe('2');
    expect(args).toContain('-b:a');
    expect(args[args.indexOf('-b:a') + 1]).toBe('192k');
  });

  it('calidad variable produce CRF diferente', () => {
    const argsLow = buildPlatformArgs('web', 25, 1920, 1080, 30);
    const argsHigh = buildPlatformArgs('web', 100, 1920, 1080, 30);
    const crfLow = argsLow[argsLow.indexOf('-crf') + 1];
    const crfHigh = argsHigh[argsHigh.indexOf('-crf') + 1];
    expect(Number(crfLow)).toBeGreaterThan(Number(crfHigh));
  });

  it('siempre incluye -c:v libx264 y -c:a aac', () => {
    for (const platform of ['web', 'tiktok', 'instagram', 'youtube']) {
      const args = buildPlatformArgs(platform, 75, 1920, 1080, 30);
      expect(args).toContain('-c:v');
      expect(args).toContain('-c:a');
    }
  });
});

// ─── Watermark ──────────────────────────────────────────────────────────────

describe('WATERMARK_POSITIONS', () => {
  it('contiene exactamente las 5 posiciones', () => {
    const keys = Object.keys(WATERMARK_POSITIONS);
    expect(keys).toHaveLength(5);
    expect(keys).toEqual(
      expect.arrayContaining(['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'])
    );
  });
  it('cada posición tiene label, x e y como strings no vacíos', () => {
    for (const [key, pos] of Object.entries(WATERMARK_POSITIONS)) {
      expect(typeof pos.label).toBe('string');
      expect(pos.label.length).toBeGreaterThan(0);
      expect(typeof pos.x).toBe('string');
      expect(pos.x.length).toBeGreaterThan(0);
      expect(typeof pos.y).toBe('string');
      expect(pos.y.length).toBeGreaterThan(0);
    }
  });
  it('top-left usa coordenadas fijas 10:10', () => {
    expect(WATERMARK_POSITIONS['top-left'].x).toBe('10');
    expect(WATERMARK_POSITIONS['top-left'].y).toBe('10');
  });
  it('top-right usa W-w-10 para x', () => {
    expect(WATERMARK_POSITIONS['top-right'].x).toBe('W-w-10');
    expect(WATERMARK_POSITIONS['top-right'].y).toBe('10');
  });
  it('bottom-left usa H-h-10 para y', () => {
    expect(WATERMARK_POSITIONS['bottom-left'].x).toBe('10');
    expect(WATERMARK_POSITIONS['bottom-left'].y).toBe('H-h-10');
  });
  it('bottom-right usa W-w-10 y H-h-10', () => {
    expect(WATERMARK_POSITIONS['bottom-right'].x).toBe('W-w-10');
    expect(WATERMARK_POSITIONS['bottom-right'].y).toBe('H-h-10');
  });
  it('center usa (W-w)/2 y (H-h)/2', () => {
    expect(WATERMARK_POSITIONS['center'].x).toBe('(W-w)/2');
    expect(WATERMARK_POSITIONS['center'].y).toBe('(H-h)/2');
  });
});

describe('WATERMARK_SIZES', () => {
  it('contiene los 5 tamaños de 10 a 30 en incrementos de 5', () => {
    const keys = Object.keys(WATERMARK_SIZES).map(Number);
    expect(keys).toEqual([10, 15, 20, 25, 30]);
  });
  it('cada tamaño tiene un label con %', () => {
    for (const size of Object.values(WATERMARK_SIZES)) {
      expect(size.label).toMatch(/^\d+%$/);
    }
  });
});

describe('buildWatermarkFilter', () => {
  // ── Estructura de retorno ──────────────────────────────────────────────
  it('retorna un objeto con scaleFilter y overlayFilter', () => {
    const result = buildWatermarkFilter('center', 20);
    expect(result).toHaveProperty('scaleFilter');
    expect(result).toHaveProperty('overlayFilter');
    expect(typeof result.scaleFilter).toBe('string');
    expect(typeof result.overlayFilter).toBe('string');
  });

  // ── scaleFilter ────────────────────────────────────────────────────────
  it('scaleFilter empieza con [1:v] y termina con [wm]', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20);
    expect(scaleFilter).toMatch(/^\[1:v\].*\[wm\]$/);
  });
  it('scaleFilter contiene scale= con el porcentaje correcto', () => {
    expect(buildWatermarkFilter('center', 10).scaleFilter).toBe('[1:v]scale=iw*10/100:-1[wm]');
    expect(buildWatermarkFilter('center', 25).scaleFilter).toBe('[1:v]scale=iw*25/100:-1[wm]');
    expect(buildWatermarkFilter('center', 50).scaleFilter).toBe('[1:v]scale=iw*50/100:-1[wm]');
  });
  it('scaleFilter usa -1 para mantener aspect ratio de la imagen', () => {
    const { scaleFilter } = buildWatermarkFilter('top-left', 20);
    expect(scaleFilter).toContain(':-1[wm]');
  });

  // ── overlayFilter ─────────────────────────────────────────────────────
  it('overlayFilter empieza con [0:v][wm]overlay=', () => {
    const { overlayFilter } = buildWatermarkFilter('top-left', 20);
    expect(overlayFilter).toMatch(/^\[0:v\]\[wm\]overlay=/);
  });

  // ── Cada posición produce las coordenadas correctas ────────────────────
  it('top-left → overlay=10:10', () => {
    const { overlayFilter } = buildWatermarkFilter('top-left', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=10:10');
  });
  it('top-right → overlay=W-w-10:10', () => {
    const { overlayFilter } = buildWatermarkFilter('top-right', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:10');
  });
  it('bottom-left → overlay=10:H-h-10', () => {
    const { overlayFilter } = buildWatermarkFilter('bottom-left', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=10:H-h-10');
  });
  it('bottom-right → overlay=W-w-10:H-h-10', () => {
    const { overlayFilter } = buildWatermarkFilter('bottom-right', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });
  it('center → overlay=(W-w)/2:(H-h)/2', () => {
    const { overlayFilter } = buildWatermarkFilter('center', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=(W-w)/2:(H-h)/2');
  });

  // ── Tamaños válidos ───────────────────────────────────────────────────
  it('cada tamaño predefinido (10,15,20,25,30) genera el valor correcto', () => {
    for (const pct of [10, 15, 20, 25, 30]) {
      const { scaleFilter } = buildWatermarkFilter('center', pct);
      expect(scaleFilter).toBe(`[1:v]scale=iw*${pct}/100:-1[wm]`);
    }
  });
  it('tamaños intermedios (7, 33, 45) se pasan correctamente', () => {
    expect(buildWatermarkFilter('center', 7).scaleFilter).toContain('iw*7/100');
    expect(buildWatermarkFilter('center', 33).scaleFilter).toContain('iw*33/100');
    expect(buildWatermarkFilter('center', 45).scaleFilter).toContain('iw*45/100');
  });

  // ── Clamping de tamaño ────────────────────────────────────────────────
  it('tamaño < 5 se clampea a 5', () => {
    expect(buildWatermarkFilter('center', 1).scaleFilter).toContain('iw*5/100');
    expect(buildWatermarkFilter('center', 0).scaleFilter).toContain('iw*5/100');
    expect(buildWatermarkFilter('center', -10).scaleFilter).toContain('iw*5/100');
  });
  it('tamaño > 50 se clampea a 50', () => {
    expect(buildWatermarkFilter('center', 51).scaleFilter).toContain('iw*50/100');
    expect(buildWatermarkFilter('center', 100).scaleFilter).toContain('iw*50/100');
    expect(buildWatermarkFilter('center', 999).scaleFilter).toContain('iw*50/100');
  });
  it('tamaño = 5 (límite inferior) se acepta', () => {
    expect(buildWatermarkFilter('center', 5).scaleFilter).toContain('iw*5/100');
  });
  it('tamaño = 50 (límite superior) se acepta', () => {
    expect(buildWatermarkFilter('center', 50).scaleFilter).toContain('iw*50/100');
  });

  // ── Entradas inválidas para tamaño ────────────────────────────────────
  it('tamaño no numérico (string) → default 20', () => {
    expect(buildWatermarkFilter('center', 'abc').scaleFilter).toContain('iw*20/100');
  });
  it('tamaño undefined → default 20', () => {
    expect(buildWatermarkFilter('center', undefined).scaleFilter).toContain('iw*20/100');
  });
  it('tamaño null → default 20', () => {
    expect(buildWatermarkFilter('center', null).scaleFilter).toContain('iw*20/100');
  });
  it('tamaño NaN → default 20', () => {
    expect(buildWatermarkFilter('center', NaN).scaleFilter).toContain('iw*20/100');
  });
  it('tamaño string numérico "25" → se parsea como 25', () => {
    expect(buildWatermarkFilter('center', '25').scaleFilter).toContain('iw*25/100');
  });
  it('tamaño float 20.7 → se trunca a 20 (parseInt)', () => {
    expect(buildWatermarkFilter('center', 20.7).scaleFilter).toContain('iw*20/100');
  });

  // ── Posición inválida ─────────────────────────────────────────────────
  it('posición desconocida → fallback a bottom-right', () => {
    const { overlayFilter } = buildWatermarkFilter('unknown', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });
  it('posición vacía → fallback a bottom-right', () => {
    const { overlayFilter } = buildWatermarkFilter('', 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });
  it('posición null → fallback a bottom-right', () => {
    const { overlayFilter } = buildWatermarkFilter(null, 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });
  it('posición undefined → fallback a bottom-right', () => {
    const { overlayFilter } = buildWatermarkFilter(undefined, 20);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });

  // ── Combinaciones posición + tamaño ───────────────────────────────────
  it('todas las posiciones con tamaño mínimo (5) generan filtros válidos', () => {
    for (const pos of Object.keys(WATERMARK_POSITIONS)) {
      const { scaleFilter, overlayFilter } = buildWatermarkFilter(pos, 5);
      expect(scaleFilter).toContain('iw*5/100');
      expect(overlayFilter).toContain('overlay=');
      expect(overlayFilter).toContain(WATERMARK_POSITIONS[pos].x);
      expect(overlayFilter).toContain(WATERMARK_POSITIONS[pos].y);
    }
  });
  it('todas las posiciones con tamaño máximo (50) generan filtros válidos', () => {
    for (const pos of Object.keys(WATERMARK_POSITIONS)) {
      const { scaleFilter, overlayFilter } = buildWatermarkFilter(pos, 50);
      expect(scaleFilter).toContain('iw*50/100');
      expect(overlayFilter).toContain('overlay=');
    }
  });

  // ── Formato de la cadena de filtro para FFmpeg ────────────────────────
  it('scaleFilter no contiene espacios (válido para FFmpeg)', () => {
    for (const pos of Object.keys(WATERMARK_POSITIONS)) {
      const { scaleFilter } = buildWatermarkFilter(pos, 20);
      expect(scaleFilter).not.toContain(' ');
    }
  });
  it('overlayFilter no contiene espacios (válido para FFmpeg)', () => {
    for (const pos of Object.keys(WATERMARK_POSITIONS)) {
      const { overlayFilter } = buildWatermarkFilter(pos, 20);
      expect(overlayFilter).not.toContain(' ');
    }
  });

  // ── Opacidad ──────────────────────────────────────────────────────────
  it('opacidad 1 (default) → sin format/colorchannelmixer', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 1);
    expect(scaleFilter).toBe('[1:v]scale=iw*20/100:-1[wm]');
    expect(scaleFilter).not.toContain('colorchannelmixer');
  });
  it('sin tercer argumento → opacidad 1 (sin alpha step)', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20);
    expect(scaleFilter).not.toContain('colorchannelmixer');
  });
  it('opacidad 0.5 → incluye format=rgba,colorchannelmixer=aa=0.5', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0.5);
    expect(scaleFilter).toBe('[1:v]scale=iw*20/100:-1,format=rgba,colorchannelmixer=aa=0.5[wm]');
  });
  it('opacidad 0.3 → aa=0.3', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0.3);
    expect(scaleFilter).toContain('colorchannelmixer=aa=0.3');
  });
  it('opacidad 0.1 (mínimo) → aa=0.1', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0.1);
    expect(scaleFilter).toContain('aa=0.1');
  });
  it('opacidad < 0.1 se clampea a 0.1', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0.01);
    expect(scaleFilter).toContain('aa=0.1');
  });
  it('opacidad > 1 se clampea a 1 (sin alpha step)', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 1.5);
    expect(scaleFilter).not.toContain('colorchannelmixer');
  });
  it('opacidad 0 se clampea a 0.1', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0);
    expect(scaleFilter).toContain('aa=0.1');
  });
  it('opacidad NaN → default 1 (sin alpha step)', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, NaN);
    expect(scaleFilter).not.toContain('colorchannelmixer');
  });
  it('opacidad undefined → default 1', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, undefined);
    expect(scaleFilter).not.toContain('colorchannelmixer');
  });
  it('opacidad string "0.7" → se parsea como 0.7', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, '0.7');
    expect(scaleFilter).toContain('aa=0.7');
  });
  it('opacidad no afecta al overlayFilter', () => {
    const { overlayFilter } = buildWatermarkFilter('bottom-right', 20, 0.5);
    expect(overlayFilter).toBe('[0:v][wm]overlay=W-w-10:H-h-10');
  });
  it('opacidad se redondea a 2 decimales', () => {
    const { scaleFilter } = buildWatermarkFilter('center', 20, 0.333);
    expect(scaleFilter).toContain('aa=0.33');
    expect(scaleFilter).not.toContain('aa=0.333');
  });

  // ── Integración: filter_complex graph assembly ────────────────────────
  it('scaleFilter + overlayFilter se pueden ensamblar en un filter_complex válido', () => {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter('bottom-right', 20);
    // Simula lo que hace server.mjs: [0:v]{vf}[main]; {scaleFilter}; [main][wm]overlay[v]
    const videoFilters = 'scale=1920:-2,hflip';
    const mainChain = `[0:v]${videoFilters}[main]`;
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    // Verificar estructura del grafo
    expect(filterComplex).toBe(
      '[0:v]scale=1920:-2,hflip[main];[1:v]scale=iw*20/100:-1[wm];[main][wm]overlay=W-w-10:H-h-10[v]'
    );
  });
  it('filter_complex sin filtros previos usa copy para [0:v]', () => {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter('top-left', 15);
    const mainChain = '[0:v]copy[main]';
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    expect(filterComplex).toBe(
      '[0:v]copy[main];[1:v]scale=iw*15/100:-1[wm];[main][wm]overlay=10:10[v]'
    );
  });
  it('filter_complex con solo hflip se ensambla correctamente', () => {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter('center', 25);
    const mainChain = '[0:v]hflip[main]';
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    expect(filterComplex).toBe(
      '[0:v]hflip[main];[1:v]scale=iw*25/100:-1[wm];[main][wm]overlay=(W-w)/2:(H-h)/2[v]'
    );
  });
  it('filter_complex con opacidad incluye colorchannelmixer', () => {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter('bottom-right', 20, 0.5);
    const mainChain = '[0:v]copy[main]';
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    expect(filterComplex).toBe(
      '[0:v]copy[main];[1:v]scale=iw*20/100:-1,format=rgba,colorchannelmixer=aa=0.5[wm];[main][wm]overlay=W-w-10:H-h-10[v]'
    );
  });
  it('filter_complex con crop + scale de plataforma se ensambla correctamente', () => {
    const { scaleFilter, overlayFilter } = buildWatermarkFilter('bottom-left', 10);
    const videoFilters = 'crop=608:1080,scale=608:-2';
    const mainChain = `[0:v]${videoFilters}[main]`;
    const overlay = overlayFilter.replace('[0:v]', '[main]');
    const filterComplex = `${mainChain};${scaleFilter};${overlay}[v]`;

    expect(filterComplex).toContain('[0:v]crop=608:1080,scale=608:-2[main]');
    expect(filterComplex).toContain('[1:v]scale=iw*10/100:-1[wm]');
    expect(filterComplex).toContain('[main][wm]overlay=10:H-h-10[v]');
  });
});
