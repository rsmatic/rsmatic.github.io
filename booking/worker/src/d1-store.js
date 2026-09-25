/* ===========================================================
   D1 (SQLite) store for the Cloudflare Worker.
   Same interface as server/file-store.js, so api/core.js does
   not know or care which one it is talking to.

   Every guest answer is one UPDATE ... WHERE token = ?, so two
   guests replying at the same moment cannot overwrite each other.
   =========================================================== */

// `table` is a reserved word in SQL, so the column is tableName.
const SLOT_COLUMNS = {
  id: 'id',
  eventId: 'eventId',
  table: 'tableName',
  seat: 'seat',
  label: 'label',
  guestName: 'guestName',
  guestContact: 'guestContact',
  token: 'token',
  status: 'status',
  reason: 'reason',
  message: 'message',
  respondedAt: 'respondedAt',
  createdAt: 'createdAt',
};

const EVENT_COLUMNS = ['id', 'title', 'celebrant', 'nickname', 'birthDate', 'eventDate',
  'startTime', 'venue', 'venueMapUrl', 'dressCode', 'note', 'rsvpDeadline', 'hostName',
  'theme', 'ageDisplay', 'ageLabel', 'seatDisplay', 'inviteStatus', 'pausedMessage',
  'photoShape', 'photoSize', 'borderStyle', 'cardCorners', 'cardAlign',
  'accentColor', 'borderColor', 'photoUpdatedAt', 'coordinatorKey', 'createdAt'];

const slotFromRow = (row) => (row ? {
  id: row.id,
  eventId: row.eventId,
  table: row.tableName,
  seat: row.seat,
  label: row.label,
  guestName: row.guestName || '',
  guestContact: row.guestContact || '',
  token: row.token,
  status: row.status,
  reason: row.reason,
  message: row.message,
  respondedAt: row.respondedAt,
  createdAt: row.createdAt,
} : null);

const eventFromRow = (row) => {
  if (!row) return null;
  const event = {};
  for (const key of EVENT_COLUMNS) event[key] = row[key] == null ? '' : row[key];
  event.createdAt = row.createdAt;
  return event;
};

export function createD1Store(d1) {
  async function updateSlotWhere(column, value, patch) {
    const sets = [];
    const binds = [];
    for (const [field, val] of Object.entries(patch)) {
      const col = SLOT_COLUMNS[field];
      if (!col || col === 'id') continue;
      sets.push(`${col} = ?`);
      binds.push(val === undefined ? null : val);
    }
    if (sets.length) {
      await d1.prepare(`UPDATE slots SET ${sets.join(', ')} WHERE ${column} = ?`)
        .bind(...binds, value).run();
    }
    const row = await d1.prepare(`SELECT * FROM slots WHERE ${column} = ?`).bind(value).first();
    return slotFromRow(row);
  }

  return {
    async snapshot() {
      const [events, slots] = await Promise.all([
        d1.prepare('SELECT * FROM events ORDER BY createdAt').all(),
        // seat is TEXT, so cast before ordering or "10" lands before "2".
        d1.prepare('SELECT * FROM slots ORDER BY tableName, CAST(seat AS INTEGER), seat').all(),
      ]);
      return {
        events: (events.results || []).map(eventFromRow),
        slots: (slots.results || []).map(slotFromRow),
      };
    },

    async getEvent(id) {
      return eventFromRow(await d1.prepare('SELECT * FROM events WHERE id = ?').bind(id).first());
    },

    async getEventByCoordinatorKey(key) {
      if (!key) return null;
      return eventFromRow(await d1.prepare(
        "SELECT * FROM events WHERE coordinatorKey = ? AND coordinatorKey != ''",
      ).bind(key).first());
    },

    async createEvent(event) {
      const cols = EVENT_COLUMNS.join(', ');
      const marks = EVENT_COLUMNS.map(() => '?').join(', ');
      await d1.prepare(`INSERT INTO events (${cols}) VALUES (${marks})`)
        .bind(...EVENT_COLUMNS.map((c) => event[c] ?? '')).run();
      return event;
    },

    async updateEvent(id, patch) {
      const entries = Object.entries(patch).filter(([k]) => EVENT_COLUMNS.includes(k) && k !== 'id');
      if (entries.length) {
        await d1.prepare(`UPDATE events SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
          .bind(...entries.map(([, v]) => (v === undefined ? null : v)), id).run();
      }
      return this.getEvent(id);
    },

    async deleteEvent(id) {
      await d1.batch([
        d1.prepare('DELETE FROM event_photos WHERE eventId = ?').bind(id),
        d1.prepare('DELETE FROM slots WHERE eventId = ?').bind(id),
        d1.prepare('DELETE FROM events WHERE id = ?').bind(id),
      ]);
    },

    /* Photos live in their own table so the admin's 15-second poll never
       drags a few hundred kilobytes of image along with the seat list. */
    async getPhoto(eventId) {
      const row = await d1.prepare('SELECT mime, data, updatedAt FROM event_photos WHERE eventId = ?')
        .bind(eventId).first();
      return row ? { mime: row.mime, base64: row.data, updatedAt: row.updatedAt } : null;
    },

    async setPhoto(eventId, photo) {
      await d1.prepare(
        'INSERT INTO event_photos (eventId, mime, data, updatedAt) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(eventId) DO UPDATE SET mime = excluded.mime, data = excluded.data, ' +
        'updatedAt = excluded.updatedAt',
      ).bind(eventId, photo.mime, photo.base64, photo.updatedAt).run();
    },

    async deletePhoto(eventId) {
      await d1.prepare('DELETE FROM event_photos WHERE eventId = ?').bind(eventId).run();
    },

    async getSlot(id) {
      return slotFromRow(await d1.prepare('SELECT * FROM slots WHERE id = ?').bind(id).first());
    },

    /* A name may hold several seats. Matching is done in SQL so the update
       is still one statement, and still cannot lose a concurrent answer. */
    async listSlotsByGuest(eventId, nameKey) {
      if (!nameKey) return [];
      const res = await d1.prepare(
        "SELECT * FROM slots WHERE eventId = ? AND guestName != '' " +
        'AND lower(trim(guestName)) = ? ORDER BY tableName, CAST(seat AS INTEGER), seat',
      ).bind(eventId, nameKey).all();
      return (res.results || []).map(slotFromRow);
    },

    async updateSlotsByGuest(eventId, nameKey, patch) {
      if (!nameKey) return 0;
      const sets = [];
      const binds = [];
      for (const [field, val] of Object.entries(patch)) {
        const col = SLOT_COLUMNS[field];
        if (!col || col === 'id') continue;
        sets.push(col + ' = ?');
        binds.push(val === undefined ? null : val);
      }
      if (!sets.length) return 0;
      const res = await d1.prepare(
        'UPDATE slots SET ' + sets.join(', ') +
        " WHERE eventId = ? AND guestName != '' AND lower(trim(guestName)) = ?",
      ).bind(...binds, eventId, nameKey).run();
      return (res.meta && res.meta.changes) || 0;
    },

    async getSlotByToken(token) {
      return slotFromRow(await d1.prepare('SELECT * FROM slots WHERE token = ?').bind(token).first());
    },

    async createSlots(slots) {
      const fields = Object.keys(SLOT_COLUMNS);
      const cols = fields.map((f) => SLOT_COLUMNS[f]).join(', ');
      const marks = fields.map(() => '?').join(', ');
      const stmt = d1.prepare(`INSERT INTO slots (${cols}) VALUES (${marks})`);
      await d1.batch(slots.map((s) => stmt.bind(...fields.map((f) => (s[f] === undefined ? null : s[f])))));
      return slots;
    },

    updateSlot(id, patch) {
      return updateSlotWhere('id', id, patch);
    },

    updateSlotByToken(token, patch) {
      return updateSlotWhere('token', token, patch);
    },

    async deleteSlot(id) {
      await d1.prepare('DELETE FROM slots WHERE id = ?').bind(id).run();
    },

    /** Clears an event's seating without touching the event itself. */
    async deleteSlotsByEvent(eventId) {
      const res = await d1.prepare('DELETE FROM slots WHERE eventId = ?').bind(eventId).run();
      return (res.meta && res.meta.changes) || 0;
    },
  };
}
