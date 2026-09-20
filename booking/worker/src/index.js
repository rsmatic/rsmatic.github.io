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
    // Every method the pages use. A missing one is invisible to curl and
    // fatal in a browser: the preflight simply refuses the request.
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (value) headers['Access-Control-Allow-Origin'] = value;
  return headers;
}

/* A photo is cached forever: the page asks for it with ?v=<updatedAt>, so a
   new upload is a new URL rather than a stale hit. */
function image(photo, extra) {
  const binary = atob(photo.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': photo.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...extra,
    },
  });
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
      return json({ error: 'No such endpoint.' }, 404, cors);
    }

    if (!env.DB) {
      return json({ error: 'No D1 database bound (DB).' }, 500, cors);
    }
    if (!env.ADMIN_KEY) {
      return json({ error: 'No ADMIN_KEY secret set on the Worker.' }, 500, cors);
    }

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const raw = await request.text();
      if (raw.trim()) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json({ error: 'Could not read the JSON body.' }, 400, cors);
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
      if (result.binary) return image(result.binary, cors);
      return json(result.data, result.status, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: err.message || 'Something went wrong on the server.' }, status, cors);
    }
  },
};
