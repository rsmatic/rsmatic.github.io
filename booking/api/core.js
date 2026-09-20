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
  'theme', 'ageDisplay', 'ageLabel',
  'photoShape', 'photoSize', 'borderStyle', 'cardCorners', 'cardAlign',
  'accentColor', 'borderColor'];

/** Look of the invitation card. Anything outside these lists is refused. */
export const DESIGN_OPTIONS = {
  photoShape: ['circle', 'rounded', 'square', 'arch'],
  photoSize: ['small', 'medium', 'large'],
  borderStyle: ['none', 'thin', 'double', 'dashed'],
  cardCorners: ['sharp', 'soft', 'round'],
  cardAlign: ['center', 'left'],
};
export const DESIGN_DEFAULTS = {
  photoShape: 'circle',
  photoSize: 'medium',
  borderStyle: 'double',
  cardCorners: 'soft',
  cardAlign: 'center',
};

/** Base64 for a photo, before the ~33% encoding overhead: about 450 KB. */
const MAX_PHOTO_BASE64 = 620000;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** What stands above the celebrant's name on the invitation. */
export const AGE_DISPLAYS = ['number', 'custom', 'hidden'];
export const DEFAULT_AGE_DISPLAY = 'number';

/** Keep in sync with app/themes.js — the ids are the same list. */
export const THEMES = ['rose-gold', 'midnight', 'emerald', 'burgundy', 'noir',
  'tropical', 'ivory', 'blush', 'sage', 'lavender',
  'kids-carnival', 'kids-pastel', 'debut-rose', 'debut-pearl',
  'anniversary-gold', 'anniversary-silver', 'christmas-classic', 'christmas-frost',
  'christening', 'fiesta'];
export const DEFAULT_THEME = 'rose-gold';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function normalizeChoice(field, value) {
  const choice = str(value);
  if (!choice) return DESIGN_DEFAULTS[field];
  if (!DESIGN_OPTIONS[field].includes(choice)) {
    throw new HttpError(400, 'Unknown ' + field + ': ' + choice);
  }
  return choice;
}

/** '' hands the colour back to the theme; anything else must be #rrggbb. */
function normalizeColor(value) {
  const color = str(value);
  if (!color) return '';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new HttpError(400, 'A colour must look like #rrggbb.');
  }
  return color.toLowerCase();
}

/** Splits "data:image/jpeg;base64,AAA" and refuses anything else. */
function readPhoto(dataUrl) {
  const raw = str(dataUrl);
  const match = raw.match(/^data:([a-z]+\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new HttpError(400, 'The photo must be a base64 data URL.');
  const [, mime, base64] = match;
  if (!PHOTO_TYPES.includes(mime.toLowerCase())) {
    throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP.');
  }
  if (base64.length > MAX_PHOTO_BASE64) {
    throw new HttpError(413, 'That photo is too large. Try a smaller one.');
  }
  return { mime: mime.toLowerCase(), base64 };
}

function applyDesign(target, body, always) {
  for (const field of Object.keys(DESIGN_OPTIONS)) {
    if (always || field in body) target[field] = normalizeChoice(field, body[field]);
  }
  for (const field of ['accentColor', 'borderColor']) {
    if (always || field in body) target[field] = normalizeColor(body[field]);
  }
}

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

/** Grouped so it can be read aloud or retyped without losing your place. */
export function newCoordinatorKey() {
  let s = '';
  for (const b of randomBytes(16)) s += TOKEN_CHARS[b % TOKEN_CHARS.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
}

/**
 * What a coordinator sees of a seat. No token: a read-only coordinator has
 * no reason to hold the link that answers on a guest's behalf.
 */
function coordinatorSlotView(slot) {
  return {
    id: slot.id,
    eventId: slot.eventId,
    table: slot.table,
    seat: slot.seat,
    label: slot.label,
    guestName: slot.guestName,
    guestContact: slot.guestContact,
    status: slot.status,
    reason: slot.reason,
    message: slot.message,
    respondedAt: slot.respondedAt,
  };
}

/**
 * What a coordinator sees of the event. Deliberately not the whole row:
 * no coordinator key, no design, nothing they cannot change anyway.
 */
function coordinatorEventView(event) {
  return {
    id: event.id,
    title: event.title,
    celebrant: event.celebrant,
    nickname: event.nickname,
    eventDate: event.eventDate,
    startTime: event.startTime,
    venue: event.venue,
    dressCode: event.dressCode,
    rsvpDeadline: event.rsvpDeadline,
    theme: event.theme,
  };
}

/** Naming a seat invites someone; clearing it takes the invitation back. */
function guestNamePatch(slot, body) {
  const patch = {};
  if ('guestName' in body) {
    const name = str(body.guestName);
    patch.guestName = name;
    if (!name) {
      patch.status = 'open';
      patch.reason = null;
      patch.message = null;
      patch.respondedAt = null;
    } else if (!slot.guestName || slot.status === 'open') {
      patch.status = 'invited';
    }
  }
  if ('guestContact' in body) patch.guestContact = str(body.guestContact);
  return patch;
}

/** One person's name may hold several seats; they are one invitation. */
const guestKey = (name) => str(name).toLowerCase();

/** What a guest is allowed to see about their own seat. */
function publicSlotView(slot, event, seats) {
  const held = (seats && seats.length ? seats : [slot])
    .map((s) => ({ table: s.table, seat: s.seat, label: s.label }));
  return {
    id: slot.id,
    label: slot.label,
    table: slot.table,
    seat: slot.seat,
    seats: held,
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
      photoShape: event.photoShape,
      photoSize: event.photoSize,
      borderStyle: event.borderStyle,
      cardCorners: event.cardCorners,
      cardAlign: event.cardAlign,
      accentColor: event.accentColor,
      borderColor: event.borderColor,
      photoUpdatedAt: event.photoUpdatedAt || null,
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
async function findByCoordinatorKey(store, value) {
  const key = str(value);
  // An empty key must never match an event that simply has none set.
  if (!key) throw new HttpError(401, 'Wrong coordinator key.');
  const event = await store.getEventByCoordinatorKey(key);
  if (!event) throw new HttpError(401, 'Wrong coordinator key.');
  return event;
}

export function createApi({ store, adminKey }) {
  function requireAdmin(key) {
    if (!adminKey || key !== adminKey) throw new HttpError(401, 'Wrong admin key.');
  }

  return async function handle({
    method, segments, body = {}, adminKey: givenKey = '', coordinatorKey = '',
  }) {
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

      // Everything this guest holds, so the invitation can show it as one.
      const seatsHeld = slot.guestName
        ? await store.listSlotsByGuest(slot.eventId, guestKey(slot.guestName))
        : [slot];

      if (rest[1] === 'photo' && method === 'GET') {
        const photo = await store.getPhoto(event.id);
        if (!photo) throw new HttpError(404, 'This event has no photo.');
        return { status: 200, binary: photo };
      }

      if (method === 'GET') {
        return { status: 200, data: publicSlotView(slot, event, seatsHeld) };
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
        const patch = {
          status: body.attending ? 'confirmed' : 'declined',
          reason: body.attending ? null : reason.slice(0, 500),
          message: str(body.message).slice(0, 500) || null,
          respondedAt: new Date().toISOString(),
        };

        // A guest holding several seats answers for all of them at once, so
        // the board never shows one of their seats confirmed and another not.
        if (slot.guestName) {
          await store.updateSlotsByGuest(slot.eventId, guestKey(slot.guestName), patch);
        } else {
          await store.updateSlotByToken(token, patch);
        }

        const updated = await store.getSlotByToken(token);
        if (!updated) throw new HttpError(404, 'This invitation is not valid.');
        const after = updated.guestName
          ? await store.listSlotsByGuest(updated.eventId, guestKey(updated.guestName))
          : [updated];
        return { status: 200, data: publicSlotView(updated, event, after) };
      }

      throw new HttpError(405, 'Method not allowed.');
    }

    /* ---- coordinator: its own key, a much smaller door ----------------- */
    if (resource === 'coordinator') {
      const action = rest[0];

      if (action === 'session' && method === 'POST') {
        const event = await findByCoordinatorKey(store, body.key);
        return { status: 200, data: { eventId: event.id, title: event.title } };
      }

      const event = await findByCoordinatorKey(store, coordinatorKey);

      if (action === 'board' && method === 'GET') {
        const all = await store.snapshot();
        return {
          status: 200,
          data: {
            event: coordinatorEventView(event),
            slots: all.slots.filter((s) => s.eventId === event.id).map(coordinatorSlotView),
          },
        };
      }

      // Reading is all a coordinator does. Anything else falls through to 404
      // rather than being refused by the page alone.
      throw new HttpError(404, 'No such endpoint.');
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
        event.photoUpdatedAt = '';
        applyDesign(event, body, true);
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

      if (eventId && rest[1] === 'coordinator') {
        const event = await store.getEvent(eventId);
        if (!event) throw new HttpError(404, 'Event not found.');

        if (method === 'POST') {
          const key = newCoordinatorKey();
          await store.updateEvent(eventId, { coordinatorKey: key });
          return { status: 200, data: { coordinatorKey: key } };
        }

        if (method === 'DELETE') {
          await store.updateEvent(eventId, { coordinatorKey: '' });
          return { status: 200, data: { ok: true } };
        }

        throw new HttpError(405, 'Method not allowed.');
      }

      if (eventId && rest[1] === 'photo') {
        const event = await store.getEvent(eventId);
        if (!event) throw new HttpError(404, 'Event not found.');

        if (method === 'GET') {
          const photo = await store.getPhoto(eventId);
          if (!photo) throw new HttpError(404, 'This event has no photo.');
          return { status: 200, binary: photo };
        }

        if (method === 'PUT' || method === 'POST') {
          const { mime, base64 } = readPhoto(body.dataUrl);
          const updatedAt = new Date().toISOString();
          await store.setPhoto(eventId, { mime, base64, updatedAt });
          await store.updateEvent(eventId, { photoUpdatedAt: updatedAt });
          return { status: 200, data: { ok: true, photoUpdatedAt: updatedAt } };
        }

        if (method === 'DELETE') {
          await store.deletePhoto(eventId);
          await store.updateEvent(eventId, { photoUpdatedAt: '' });
          return { status: 200, data: { ok: true } };
        }

        throw new HttpError(405, 'Method not allowed.');
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
        applyDesign(patch, body, false);
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
        // Same naming rules the coordinator gets, plus the seat's own labelling.
        const patch = guestNamePatch(slot, body);
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
