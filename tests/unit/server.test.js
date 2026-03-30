import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import { server } from '../../server.mjs';

let listener;
let baseUrl;

// Start server on random port
listener = server.listen(0);
const port = listener.address().port;
baseUrl = `http://localhost:${port}`;

afterAll(() => {
  listener?.close();
});

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
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: raw, json });
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('Server API', () => {
  it('GET /api/health devuelve status ok', async () => {
    const res = await request('GET', '/api/health');
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('ok');
    expect(res.json.ffmpeg).toBe(true);
    expect(res.json.version).toBe('1.2.2');
  });

  it('POST /api/convert sin archivo → 400', async () => {
    const boundary = '----TestBoundary123';
    const body = `------TestBoundary123\r\nContent-Disposition: form-data; name="quality"\r\n\r\n75\r\n------TestBoundary123--\r\n`;
    const res = await request('POST', '/api/convert', body, {
      'Content-Type': `multipart/form-data; boundary=----TestBoundary123`,
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/jobs/:id con id inexistente → error SSE', async () => {
    const res = await request('GET', '/api/jobs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(200);
    expect(res.body).toContain('NOT_FOUND');
  });

  it('POST /api/jobs/:id/cancel con id inexistente → 404', async () => {
    const res = await request('POST', '/api/jobs/00000000-0000-0000-0000-000000000000/cancel');
    expect(res.status).toBe(404);
  });

  it('archivos estáticos se sirven correctamente', async () => {
    const res = await request('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('VideoMovMp4');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('path traversal bloqueado', async () => {
    // URL-encoded traversal to bypass HTTP client normalization
    const res = await request('GET', '/..%2F..%2F..%2Fetc%2Fpasswd');
    expect([403, 404]).toContain(res.status);
    // Must NOT return 200
    expect(res.status).not.toBe(200);
  });

  it('archivo no existente → 404', async () => {
    const res = await request('GET', '/nonexistent.html');
    expect(res.status).toBe(404);
  });

  it('GET /api/health devuelve version 1.2.2 y campos esperados', async () => {
    const res = await request('GET', '/api/health');
    expect(res.json).toHaveProperty('status');
    expect(res.json).toHaveProperty('ffmpeg');
    expect(res.json).toHaveProperty('uptime');
    expect(res.json).toHaveProperty('activeJobs');
    expect(res.json).toHaveProperty('totalJobs');
    expect(res.json).toHaveProperty('version');
    expect(typeof res.json.uptime).toBe('number');
    expect(typeof res.json.activeJobs).toBe('number');
  });

  it('POST /api/convert con extensión no .mov → 400', async () => {
    const boundary = '----TestBound456';
    const body = [
      `------TestBound456\r\n`,
      `Content-Disposition: form-data; name="video"; filename="test.mp4"\r\n`,
      `Content-Type: video/mp4\r\n`,
      `\r\n`,
      `fake video content\r\n`,
      `------TestBound456--\r\n`,
    ].join('');
    const res = await request('POST', '/api/convert', body, {
      'Content-Type': `multipart/form-data; boundary=----TestBound456`,
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('.mov');
  });

  it('archivos CSS se sirven con content-type correcto', async () => {
    const res = await request('GET', '/src/css/app.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('archivos JS se sirven con content-type correcto', async () => {
    const res = await request('GET', '/src/js/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
  });
});
