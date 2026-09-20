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
  'startTime', 'venue', 'dressCode', 'note', 'rsvpDeadline', 'hostName', 'createdAt'];

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
        d1.prepare('SELECT * FROM slots ORDER BY createdAt, seat').all(),
      ]);
      return {
        events: (events.results || []).map(eventFromRow),
        slots: (slots.results || []).map(slotFromRow),
      };
    },

    async getEvent(id) {
      return eventFromRow(await d1.prepare('SELECT * FROM events WHERE id = ?').bind(id).first());
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
        d1.prepare('DELETE FROM slots WHERE eventId = ?').bind(id),
        d1.prepare('DELETE FROM events WHERE id = ?').bind(id),
      ]);
    },

    async getSlot(id) {
      return slotFromRow(await d1.prepare('SELECT * FROM slots WHERE id = ?').bind(id).first());
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
  };
}
