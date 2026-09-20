/* ===========================================================
   Cloudflare Worker — the API behind rsmatic.github.io/booking/
   The pages are static on GitHub Pages; this holds the data.
   =========================================================== */

import { createApi, HttpError } from '../../api/core.js';
import { createD1Store } from './d1-store.js';

/** Browsers that may call this API. Add your own origins in wrangler.toml. */
function allowedOrigins(env) {
  const configured = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return configured.length ? configured : ['*'];
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  const value = allowed.includes('*') ? (origin || '*')
    : (allowed.includes(origin) ? origin : '');
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (value) headers['Access-Control-Allow-Origin'] = value;
  return headers;
}

function json(payload, status, extra) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === '/health') {
      return json({ ok: true, service: 'aby41-booking' }, 200, cors);
    }

    if (!pathname.startsWith('/api/')) {
      return json({ error: 'Walang ganitong endpoint.' }, 404, cors);
    }

    if (!env.DB) {
      return json({ error: 'Walang naka-bind na D1 database (DB).' }, 500, cors);
    }
    if (!env.ADMIN_KEY) {
      return json({ error: 'Walang naka-set na ADMIN_KEY secret sa Worker.' }, 500, cors);
    }

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ error: 'Hindi mabasa ang JSON body.' }, 400, cors);
        }
      }
    }

    const handle = createApi({ store: createD1Store(env.DB), adminKey: env.ADMIN_KEY });

    try {
      const result = await handle({
        method: request.method,
        segments: pathname.split('/').filter(Boolean),
        body,
        adminKey: request.headers.get('x-admin-key') || url.searchParams.get('key') || '',
      });
      return json(result.data, result.status, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: err.message || 'May nangyaring mali sa server.' }, status, cors);
    }
  },
};
