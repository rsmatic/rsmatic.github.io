/* ===========================================================
   Local Node server — the offline twin of the Cloudflare Worker.
   Same API (api/core.js), but the database is a JSON file you
   can open, read and back up: server/data/db.json.

     node server/server.js
     ADMIN_KEY="secret" PORT=8080 node server/server.js
   =========================================================== */

import http from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, HttpError } from '../api/core.js';
import { fileStore, DB_PATH } from './file-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(HERE, '..');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'aby1025';

const handle = createApi({ store: fileStore, adminKey: ADMIN_KEY });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

/** Only these may be served. Nothing under server/ or worker/ is reachable. */
function resolveStatic(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 'index.html';
  if (pathname === '/i.html') return 'i.html';
  if (/^\/app\/[A-Za-z0-9._-]+$/.test(pathname)) return pathname.slice(1);
  return null;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1000000) {
        req.destroy();
        reject(new HttpError(413, 'Request too large.'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Could not read the JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname.startsWith('/api/')) {
      const result = await handle({
        method: req.method,
        segments: pathname.split('/').filter(Boolean),
        body: await readBody(req),
        adminKey: req.headers['x-admin-key'] || url.searchParams.get('key') || '',
      });
      return sendJson(res, result.status, result.data);
    }

    // Links from the first version of this app: /i/<token>. Send them to the
    // real page rather than serving it from a path where app/… would 404.
    const legacy = pathname.match(/^\/i\/([^/]+)\/?$/);
    if (legacy) {
      res.writeHead(302, { Location: '/i.html?t=' + encodeURIComponent(legacy[1]) });
      return res.end();
    }

    const rel = resolveStatic(pathname);
    if (!rel) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - Page not found.');
    }
    const file = path.join(SITE_DIR, rel);
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    return res.end(data);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return sendJson(res, status, { error: err.message || 'Something went wrong on the server.' });
  }
});

server.listen(PORT, () => {
  const note = process.env.ADMIN_KEY ? '' : '   (default - override with the ADMIN_KEY env var)';
  console.log('');
  console.log('  Aby 41st - Booking System (local)');
  console.log('  ---------------------------------');
  console.log('  Admin    : http://localhost:' + PORT + '/');
  console.log('  Database : ' + DB_PATH);
  console.log('  Admin key: ' + ADMIN_KEY + note);
  console.log('');
});
