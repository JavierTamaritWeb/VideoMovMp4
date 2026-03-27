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
