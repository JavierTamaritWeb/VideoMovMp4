import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { server } from '../../server.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE_PATH = path.join(__dirname, '..', '..', 'e2e', 'fixtures', 'test-small.mov');

let listener;
let baseUrl;

listener = server.listen(0);
const port = listener.address().port;
baseUrl = `http://localhost:${port}`;

afterAll(() => {
  listener?.close();
});

function buildMultipartBody(fields, filePath, fileField = 'video') {
  const boundary = '----E2ETestBoundary' + Date.now();
  const parts = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`
    );
  }

  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${fileField}"; filename="${fileName}"\r\n` +
    `Content-Type: video/quicktime\r\n\r\n`
  );

  const bodyParts = [
    Buffer.from(parts.join('')),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];

  return {
    body: Buffer.concat(bodyParts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    };

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf-8')); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function waitForJob(jobId, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Job timeout')), timeoutMs);
    const url = new URL(`/api/jobs/${jobId}`, baseUrl);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { Accept: 'text/event-stream' },
    }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'done') {
                clearTimeout(timer);
                res.destroy();
                resolve(event.data);
              } else if (event.type === 'error') {
                clearTimeout(timer);
                res.destroy();
                reject(new Error(event.data?.message || 'Conversion error'));
              }
            } catch {}
          }
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('E2E: Conversión real MOV → MP4', () => {
  const fixtureExists = fs.existsSync(FIXTURE_PATH);

  it.skipIf(!fixtureExists)('convierte test-small.mov con ajustes por defecto', async () => {
    const { body, contentType } = buildMultipartBody(
      { quality: '75', resolution: 'original', preset: 'ultrafast' },
      FIXTURE_PATH
    );

    const res = await request('POST', '/api/convert', body, { 'Content-Type': contentType });
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty('jobId');

    const result = await waitForJob(res.json.jobId);
    expect(result).toHaveProperty('downloadUrl');
    expect(result.outputSize).toBeGreaterThan(0);
    expect(typeof result.savings).toBe('number');
  }, 60000);

  it.skipIf(!fixtureExists)('el MP4 resultante es un archivo válido', async () => {
    const { body, contentType } = buildMultipartBody(
      { quality: '50', resolution: 'original', preset: 'ultrafast' },
      FIXTURE_PATH
    );

    const uploadRes = await request('POST', '/api/convert', body, { 'Content-Type': contentType });
    const result = await waitForJob(uploadRes.json.jobId);

    // Download the MP4
    const dlRes = await request('GET', result.downloadUrl);
    expect(dlRes.status).toBe(200);
    expect(dlRes.headers['content-type']).toBe('video/mp4');
    expect(dlRes.body.length).toBeGreaterThan(1000);

    // Verify with ffprobe
    const tmpPath = path.join(__dirname, '_test_output.mp4');
    fs.writeFileSync(tmpPath, dlRes.body);
    try {
      const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpPath}"`).toString();
      const data = JSON.parse(probe);
      const videoStream = data.streams.find(s => s.codec_type === 'video');
      expect(videoStream).toBeDefined();
      expect(videoStream.codec_name).toBe('h264');
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }, 60000);

  it.skipIf(!fixtureExists)('conversión con filtro sepia produce MP4 válido', async () => {
    const { body, contentType } = buildMultipartBody(
      { quality: '50', preset: 'ultrafast', videoFilter: 'sepia' },
      FIXTURE_PATH
    );

    const res = await request('POST', '/api/convert', body, { 'Content-Type': contentType });
    expect(res.status).toBe(200);

    const result = await waitForJob(res.json.jobId);
    expect(result.outputSize).toBeGreaterThan(0);
  }, 60000);

  it.skipIf(!fixtureExists)('conversión con mute produce MP4 sin audio', async () => {
    const { body, contentType } = buildMultipartBody(
      { quality: '50', preset: 'ultrafast', mute: '1' },
      FIXTURE_PATH
    );

    const res = await request('POST', '/api/convert', body, { 'Content-Type': contentType });
    const result = await waitForJob(res.json.jobId);

    const dlRes = await request('GET', result.downloadUrl);
    const tmpPath = path.join(__dirname, '_test_mute.mp4');
    fs.writeFileSync(tmpPath, dlRes.body);
    try {
      const probe = execSync(`ffprobe -v quiet -print_format json -show_streams "${tmpPath}"`).toString();
      const data = JSON.parse(probe);
      const audioStream = data.streams.find(s => s.codec_type === 'audio');
      expect(audioStream).toBeUndefined();
    } finally {
      fs.unlinkSync(tmpPath);
    }
  }, 60000);

  it.skipIf(!fixtureExists)('conversión con mirror produce MP4 válido', async () => {
    const { body, contentType } = buildMultipartBody(
      { quality: '50', preset: 'ultrafast', mirror: '1' },
      FIXTURE_PATH
    );

    const res = await request('POST', '/api/convert', body, { 'Content-Type': contentType });
    const result = await waitForJob(res.json.jobId);
    expect(result.outputSize).toBeGreaterThan(0);
  }, 60000);
});
