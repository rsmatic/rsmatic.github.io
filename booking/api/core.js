/* ===========================================================
   Shared API logic.
   Runs unchanged on Cloudflare Workers (D1 store) and on the
   local Node server (JSON file store). Everything that touches
   storage goes through the store interface, never directly.
   =========================================================== */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const EVENT_FIELDS = ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate',
  'startTime', 'venue', 'venueMapUrl', 'dressCode', 'note', 'rsvpDeadline', 'hostName',
  'theme', 'ageDisplay', 'ageLabel'];

/** What stands above the celebrant's name on the invitation. */
export const AGE_DISPLAYS = ['number', 'custom', 'hidden'];
export const DEFAULT_AGE_DISPLAY = 'number';

/** Keep in sync with app/themes.js — the ids are the same list. */
export const THEMES = ['rose-gold', 'midnight', 'emerald', 'burgundy', 'noir',
  'tropical', 'ivory', 'blush', 'sage', 'lavender'];
export const DEFAULT_THEME = 'rose-gold';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function normalizeAgeDisplay(value) {
  const mode = str(value);
  if (!mode) return DEFAULT_AGE_DISPLAY;
  if (!AGE_DISPLAYS.includes(mode)) throw new HttpError(400, 'Unknown age display: ' + mode);
  return mode;
}

function normalizeTheme(value) {
  const theme = str(value);
  if (!theme) return DEFAULT_THEME;
  if (!THEMES.includes(theme)) throw new HttpError(400, 'Unknown theme: ' + theme);
  return theme;
}

/**
 * The map link becomes an href on the guest page, so only http(s) may be
 * stored — never javascript: or data:. A bare "maps.app.goo.gl/..." is
 * treated as https rather than rejected.
 */
function normalizeUrl(value) {
  const raw = str(value);
  if (!raw) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : 'https://' + raw;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpError(400, 'That map link is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'The map link must start with http:// or https://');
  }
  return parsed.toString();
}

const HEX = '0123456789abcdef';
const TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomBytes(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function newId(prefix) {
  let s = '';
  for (const b of randomBytes(5)) s += HEX[b >> 4] + HEX[b & 15];
  return prefix + '_' + s;
}

/** 13 chars out of a 57-char alphabet ≈ 75 bits — not guessable. */
export function newToken() {
  let s = '';
  for (const b of randomBytes(13)) s += TOKEN_CHARS[b % TOKEN_CHARS.length];
  return s;
}

/** What a guest is allowed to see about their own seat. */
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
      venueMapUrl: event.venueMapUrl,
      theme: event.theme,
      ageDisplay: event.ageDisplay,
      ageLabel: event.ageLabel,
      dressCode: event.dressCode,
      note: event.note,
      rsvpDeadline: event.rsvpDeadline,
      hostName: event.hostName,
    },
  };
}

/**
 * @param {object} opts
 * @param {object} opts.store    storage adapter (see server/file-store.js)
 * @param {string} opts.adminKey secret that guards every /api/events and /api/slots route
 * @returns {(req: {method, segments, body, adminKey}) => Promise<{status, data}>}
 */
export function createApi({ store, adminKey }) {
  function requireAdmin(key) {
    if (!adminKey || key !== adminKey) throw new HttpError(401, 'Wrong admin key.');
  }

  return async function handle({ method, segments, body = {}, adminKey: givenKey = '' }) {
    const resource = segments[1];
    const rest = segments.slice(2);

    /* ---- admin key check ----------------------------------------------- */
    if (resource === 'session' && method === 'POST') {
      requireAdmin(str(body.key));
      return { status: 200, data: { ok: true } };
    }

    /* ---- guest-facing, no key needed ----------------------------------- */
    if (resource === 'invite') {
      const token = rest[0];
      if (!token) throw new HttpError(404, 'Missing token.');

      const slot = await store.getSlotByToken(token);
      if (!slot) throw new HttpError(404, 'This invitation is not valid.');
      const event = await store.getEvent(slot.eventId);
      if (!event) throw new HttpError(404, 'This event no longer exists.');

      if (method === 'GET') {
        return { status: 200, data: publicSlotView(slot, event) };
      }

      if (method === 'POST') {
        if (typeof body.attending !== 'boolean') {
          throw new HttpError(400, 'Please choose an answer.');
        }
        const reason = str(body.reason);
        if (!body.attending && !reason) {
          throw new HttpError(400, 'Please give a reason for not being able to come.');
        }
        // Every field is decided by the request alone, so this is a single
        // atomic write — two guests answering at once cannot clobber each other.
        const updated = await store.updateSlotByToken(token, {
          status: body.attending ? 'confirmed' : 'declined',
          reason: body.attending ? null : reason.slice(0, 500),
          message: str(body.message).slice(0, 500) || null,
          respondedAt: new Date().toISOString(),
        });
        if (!updated) throw new HttpError(404, 'This invitation is not valid.');
        return { status: 200, data: publicSlotView(updated, event) };
      }

      throw new HttpError(405, 'Method not allowed.');
    }

    /* ---- everything below needs the admin key -------------------------- */
    requireAdmin(givenKey);

    if (resource === 'export' && method === 'GET') {
      return { status: 200, data: await store.snapshot() };
    }

    if (resource === 'events') {
      const eventId = rest[0];

      if (!eventId && method === 'GET') {
        return { status: 200, data: await store.snapshot() };
      }

      if (!eventId && method === 'POST') {
        if (!str(body.title)) throw new HttpError(400, 'The event needs a title.');
        if (!str(body.eventDate)) throw new HttpError(400, 'The event needs a date.');
        const event = { id: newId('evt'), createdAt: new Date().toISOString() };
        for (const field of EVENT_FIELDS) event[field] = str(body[field]);
        event.theme = normalizeTheme(body.theme);
        event.venueMapUrl = normalizeUrl(body.venueMapUrl);
        event.ageDisplay = normalizeAgeDisplay(body.ageDisplay);
        event.ageLabel = str(body.ageLabel).slice(0, 40);
        await store.createEvent(event);
        return { status: 201, data: event };
      }

      if (eventId && rest[1] === 'slots' && method === 'POST') {
        const event = await store.getEvent(eventId);
        if (!event) throw new HttpError(404, 'Event not found.');

        const table = str(body.table) || 'Table 1';
        const count = Math.min(Math.max(parseInt(body.count, 10) || 1, 1), 100);
        const startAt = Math.max(parseInt(body.startAt, 10) || 1, 1);
        const now = new Date().toISOString();
        const made = [];
        for (let i = 0; i < count; i += 1) {
          const seat = String(startAt + i);
          made.push({
            id: newId('slt'),
            eventId,
            table,
            seat,
            label: `${table} · Seat ${seat}`,
            guestName: '',
            guestContact: '',
            token: newToken(),
            status: 'open',
            reason: null,
            message: null,
            respondedAt: null,
            createdAt: now,
          });
        }
        await store.createSlots(made);
        return { status: 201, data: { created: made } };
      }

      if (eventId && rest[1] === 'slots' && method === 'DELETE') {
        const event = await store.getEvent(eventId);
        if (!event) throw new HttpError(404, 'Event not found.');
        const removed = await store.deleteSlotsByEvent(eventId);
        return { status: 200, data: { ok: true, removed } };
      }

      if (eventId && !rest[1] && method === 'PATCH') {
        const patch = {};
        for (const field of EVENT_FIELDS) {
          if (field in body) patch[field] = str(body[field]);
        }
        if ('theme' in body) patch.theme = normalizeTheme(body.theme);
        if ('venueMapUrl' in body) patch.venueMapUrl = normalizeUrl(body.venueMapUrl);
        if ('ageDisplay' in body) patch.ageDisplay = normalizeAgeDisplay(body.ageDisplay);
        if ('ageLabel' in body) patch.ageLabel = str(body.ageLabel).slice(0, 40);
        const updated = await store.updateEvent(eventId, patch);
        if (!updated) throw new HttpError(404, 'Event not found.');
        return { status: 200, data: updated };
      }

      if (eventId && !rest[1] && method === 'DELETE') {
        await store.deleteEvent(eventId);
        return { status: 200, data: { ok: true } };
      }

      throw new HttpError(405, 'Method not allowed.');
    }

    if (resource === 'slots') {
      const slotId = rest[0];
      if (!slotId) throw new HttpError(404, 'Missing seat id.');

      const slot = await store.getSlot(slotId);
      if (!slot) throw new HttpError(404, 'Seat not found.');

      if (rest[1] === 'token' && method === 'POST') {
        return { status: 200, data: await store.updateSlot(slotId, { token: newToken() }) };
      }

      if (rest[1] === 'reset' && method === 'POST') {
        return {
          status: 200,
          data: await store.updateSlot(slotId, {
            status: slot.guestName ? 'invited' : 'open',
            reason: null,
            message: null,
            respondedAt: null,
          }),
        };
      }

      if (!rest[1] && method === 'PATCH') {
        const patch = {};

        if ('guestName' in body) {
          const name = str(body.guestName);
          patch.guestName = name;
          if (!name) {
            // Seat freed: the previous guest's answer goes with them.
            patch.status = 'open';
            patch.reason = null;
            patch.message = null;
            patch.respondedAt = null;
          } else if (!slot.guestName || slot.status === 'open') {
            patch.status = 'invited';
          }
        }
        if ('guestContact' in body) patch.guestContact = str(body.guestContact);
        if ('table' in body) patch.table = str(body.table);
        if ('seat' in body) patch.seat = str(body.seat);
        if ('label' in body) patch.label = str(body.label);

        const table = 'table' in patch ? patch.table : slot.table;
        const seat = 'seat' in patch ? patch.seat : slot.seat;
        if (!str('label' in patch ? patch.label : slot.label)) {
          patch.label = `${table} · Seat ${seat}`;
        }

        return { status: 200, data: await store.updateSlot(slotId, patch) };
      }

      if (!rest[1] && method === 'DELETE') {
        await store.deleteSlot(slotId);
        return { status: 200, data: { ok: true } };
      }

      throw new HttpError(405, 'Method not allowed.');
    }

    throw new HttpError(404, 'No such endpoint.');
  };
}
