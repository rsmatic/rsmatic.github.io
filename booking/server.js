'use strict';

/**
 * Aby's 41st — seat reservation + RSVP server.
 * No dependencies: `node server.js` and you are running.
 *
 *   /admin          admin console (event, slots, guest names, invite links)
 *   /i/<token>      the page a guest opens from Messenger / Viber
 *   data/db.json    the database
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const db = require('./lib/db');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'aby1025';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

/* ------------------------------------------------------------------ utils */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
        reject(new HttpError(413, 'Masyadong malaki ang request.'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Hindi mabasa ang JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

const newId = (prefix) => prefix + '_' + crypto.randomBytes(5).toString('hex');
const newToken = () => crypto.randomBytes(9).toString('base64url');
const str = (v) => (typeof v === 'string' ? v.trim() : '');

function requireAdmin(req, url) {
  const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
  if (key !== ADMIN_KEY) throw new HttpError(401, 'Maling admin key.');
}

/** What a guest is allowed to see about their own slot. */
function publicSlotView(slot, event) {
  return {
    id: slot.id,
    label: slot.label,
    table: slot.table,
    seat: slot.seat,
    guestName: slot.guestName,
    status: slot.status,
    reason: slot.reason,
    message: slot.message,
    respondedAt: slot.respondedAt,
    event: {
      title: event.title,
      celebrant: event.celebrant,
      nickname: event.nickname,
      birthDate: event.birthDate,
      eventDate: event.eventDate,
      startTime: event.startTime,
      venue: event.venue,
      dressCode: event.dressCode,
      note: event.note,
      rsvpDeadline: event.rsvpDeadline,
      hostName: event.hostName,
    },
  };
}

/* ------------------------------------------------------------ static files */

async function serveFile(res, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Wala ang hinahanap mong page.');
  }
}

function serveStatic(res, pathname) {
  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return Promise.resolve();
  }
  return serveFile(res, filePath);
}

/* ---------------------------------------------------------------- handlers */

async function handleApi(req, res, segments, url) {
  const resource = segments[1];
  const rest = segments.slice(2);
  const method = req.method;

  /* ---- admin key check ------------------------------------------------- */
  if (resource === 'session' && method === 'POST') {
    const body = await readBody(req);
    if (str(body.key) !== ADMIN_KEY) throw new HttpError(401, 'Maling admin key.');
    return sendJson(res, 200, { ok: true });
  }

  /* ---- guest-facing, no key needed ------------------------------------- */
  if (resource === 'invite') {
    const token = rest[0];
    if (!token) throw new HttpError(404, 'Walang token.');

    if (method === 'GET') {
      const data = await db.read();
      const slot = data.slots.find((s) => s.token === token);
      if (!slot) throw new HttpError(404, 'Hindi valid ang imbitasyon na ito.');
      const event = data.events.find((e) => e.id === slot.eventId);
      if (!event) throw new HttpError(404, 'Wala na ang event na ito.');
      return sendJson(res, 200, publicSlotView(slot, event));
    }

    if (method === 'POST') {
      const body = await readBody(req);
      if (typeof body.attending !== 'boolean') {
        throw new HttpError(400, 'Kailangan pumili ng sagot.');
      }
      const reason = str(body.reason);
      if (!body.attending && !reason) {
        throw new HttpError(400, 'Pakilagay ang dahilan kung bakit hindi makakarating.');
      }
      const result = await db.transaction((data) => {
        const slot = data.slots.find((s) => s.token === token);
        if (!slot) throw new HttpError(404, 'Hindi valid ang imbitasyon na ito.');
        const event = data.events.find((e) => e.id === slot.eventId);
        if (!event) throw new HttpError(404, 'Wala na ang event na ito.');

        slot.status = body.attending ? 'confirmed' : 'declined';
        slot.reason = body.attending ? null : reason.slice(0, 500);
        slot.message = str(body.message).slice(0, 500) || null;
        slot.respondedAt = new Date().toISOString();
        return publicSlotView(slot, event);
      });
      return sendJson(res, 200, result);
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  /* ---- everything below needs the admin key ---------------------------- */
  requireAdmin(req, url);

  if (resource === 'events') {
    const eventId = rest[0];

    if (!eventId && method === 'GET') {
      const data = await db.read();
      return sendJson(res, 200, { events: data.events, slots: data.slots });
    }

    if (!eventId && method === 'POST') {
      const body = await readBody(req);
      if (!str(body.title)) throw new HttpError(400, 'Kailangan ng pamagat ng event.');
      if (!str(body.eventDate)) throw new HttpError(400, 'Kailangan ng petsa ng event.');
      const event = {
        id: newId('evt'),
        title: str(body.title),
        celebrant: str(body.celebrant),
        nickname: str(body.nickname),
        birthDate: str(body.birthDate) || null,
        eventDate: str(body.eventDate),
        startTime: str(body.startTime),
        venue: str(body.venue),
        dressCode: str(body.dressCode),
        note: str(body.note),
        rsvpDeadline: str(body.rsvpDeadline) || null,
        hostName: str(body.hostName),
        createdAt: new Date().toISOString(),
      };
      await db.transaction((data) => data.events.push(event));
      return sendJson(res, 201, event);
    }

    if (eventId && rest[1] === 'slots' && method === 'POST') {
      const body = await readBody(req);
      const created = await db.transaction((data) => {
        const event = data.events.find((e) => e.id === eventId);
        if (!event) throw new HttpError(404, 'Wala ang event.');

        const table = str(body.table) || 'Table 1';
        const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);
        const startAt = Math.max(parseInt(body.startAt, 10) || 1, 1);
        const made = [];
        for (let i = 0; i < count; i += 1) {
          const seat = String(startAt + i);
          made.push({
            id: newId('slt'),
            eventId: eventId,
            table: table,
            seat: seat,
            label: table + ' · Seat ' + seat,
            guestName: '',
            guestContact: '',
            token: newToken(),
            status: 'open',
            reason: null,
            message: null,
            respondedAt: null,
            createdAt: new Date().toISOString(),
          });
        }
        data.slots.push(...made);
        return made;
      });
      return sendJson(res, 201, { created });
    }

    if (eventId && !rest[1] && method === 'PATCH') {
      const body = await readBody(req);
      const fields = ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate',
        'startTime', 'venue', 'dressCode', 'note', 'rsvpDeadline', 'hostName'];
      const updated = await db.transaction((data) => {
        const event = data.events.find((e) => e.id === eventId);
        if (!event) throw new HttpError(404, 'Wala ang event.');
        for (const field of fields) {
          if (field in body) event[field] = str(body[field]);
        }
        return event;
      });
      return sendJson(res, 200, updated);
    }

    if (eventId && !rest[1] && method === 'DELETE') {
      await db.transaction((data) => {
        data.events = data.events.filter((e) => e.id !== eventId);
        data.slots = data.slots.filter((s) => s.eventId !== eventId);
      });
      return sendJson(res, 200, { ok: true });
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  if (resource === 'slots') {
    const slotId = rest[0];
    if (!slotId) throw new HttpError(404, 'Walang slot id.');

    if (rest[1] === 'token' && method === 'POST') {
      const slot = await db.transaction((data) => {
        const found = data.slots.find((s) => s.id === slotId);
        if (!found) throw new HttpError(404, 'Wala ang slot.');
        found.token = newToken();
        return found;
      });
      return sendJson(res, 200, slot);
    }

    if (rest[1] === 'reset' && method === 'POST') {
      const slot = await db.transaction((data) => {
        const found = data.slots.find((s) => s.id === slotId);
        if (!found) throw new HttpError(404, 'Wala ang slot.');
        found.status = found.guestName ? 'invited' : 'open';
        found.reason = null;
        found.message = null;
        found.respondedAt = null;
        return found;
      });
      return sendJson(res, 200, slot);
    }

    if (!rest[1] && method === 'PATCH') {
      const body = await readBody(req);
      const slot = await db.transaction((data) => {
        const found = data.slots.find((s) => s.id === slotId);
        if (!found) throw new HttpError(404, 'Wala ang slot.');

        if ('guestName' in body) {
          const name = str(body.guestName);
          const hadName = Boolean(found.guestName);
          found.guestName = name;
          if (!name) {
            // Seat freed: forget the previous guest's answer with them.
            found.status = 'open';
            found.reason = null;
            found.message = null;
            found.respondedAt = null;
          } else if (!hadName || found.status === 'open') {
            found.status = 'invited';
          }
        }
        if ('guestContact' in body) found.guestContact = str(body.guestContact);
        if ('table' in body) found.table = str(body.table);
        if ('seat' in body) found.seat = str(body.seat);
        if ('label' in body) found.label = str(body.label);
        if (!str(found.label)) found.label = found.table + ' · Seat ' + found.seat;
        return found;
      });
      return sendJson(res, 200, slot);
    }

    if (!rest[1] && method === 'DELETE') {
      await db.transaction((data) => {
        data.slots = data.slots.filter((s) => s.id !== slotId);
      });
      return sendJson(res, 200, { ok: true });
    }

    throw new HttpError(405, 'Method not allowed.');
  }

  throw new HttpError(404, 'Walang ganitong endpoint.');
}

/* ------------------------------------------------------------------ server */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (pathname === '/') {
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    if (pathname === '/admin') {
      return await serveFile(res, path.join(PUBLIC_DIR, 'admin.html'));
    }
    if (pathname.startsWith('/i/')) {
      return await serveFile(res, path.join(PUBLIC_DIR, 'invite.html'));
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments[0] === 'api') return await handleApi(req, res, segments, url);

    return await serveStatic(res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    sendJson(res, status, { error: err.message || 'May nangyaring mali sa server.' });
  }
});

server.listen(PORT, () => {
  const usingDefault = process.env.ADMIN_KEY ? '' : '   (default - palitan gamit ang ADMIN_KEY env var)';
  console.log('');
  console.log('  Aby 41st - Booking System');
  console.log('  -------------------------');
  console.log('  Admin    : http://localhost:' + PORT + '/admin');
  console.log('  Database : ' + db.DB_FILE);
  console.log('  Admin key: ' + ADMIN_KEY + usingDefault);
  console.log('');
});
