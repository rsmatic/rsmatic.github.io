/* ===========================================================
   JSON-file store for the local Node server.
   The whole database is data/db.json. Writes are serialized
   through one queue and land atomically (temp file + rename),
   so a crash mid-write cannot leave a half-written database.
   =========================================================== */

import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(HERE, 'data', 'db.json');

const emptyDb = () => ({ events: [], slots: [], photos: {} });

function ensureFile() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2), 'utf8');
  }
}

async function readFile() {
  ensureFile();
  const raw = await fsp.readFile(DB_FILE, 'utf8');
  const data = raw.trim() ? JSON.parse(raw) : emptyDb();
  if (!Array.isArray(data.events)) data.events = [];
  if (!Array.isArray(data.slots)) data.slots = [];
  if (!data.photos || typeof data.photos !== 'object') data.photos = {};
  return data;
}

async function writeAtomic(data) {
  ensureFile();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, DB_FILE);
}

/* Seats are stored as text, so "10" sorts before "2" unless compared
   numerically. Matches the ORDER BY in the D1 store. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareSlots = (a, b) =>
  collator.compare(a.table || '', b.table || '') || collator.compare(a.seat || '', b.seat || '');

let queue = Promise.resolve();

/** Run fn(data) exclusively, then persist whatever it mutated. */
function transaction(fn) {
  const run = queue.then(async () => {
    const data = await readFile();
    const result = await fn(data);
    await writeAtomic(data);
    return result;
  });
  queue = run.then(() => {}, () => {});
  return run;
}

export const DB_PATH = DB_FILE;

export const fileStore = {
  async snapshot() {
    const data = await readFile();
    return { events: data.events, slots: [...data.slots].sort(compareSlots) };
  },

  async getEvent(id) {
    const data = await readFile();
    return data.events.find((e) => e.id === id) || null;
  },

  async getEventByCoordinatorKey(key) {
    if (!key) return null;
    const data = await readFile();
    return data.events.find((e) => e.coordinatorKey && e.coordinatorKey === key) || null;
  },

  async createEvent(event) {
    await transaction((data) => { data.events.push(event); });
    return event;
  },

  async updateEvent(id, patch) {
    return transaction((data) => {
      const event = data.events.find((e) => e.id === id);
      if (!event) return null;
      Object.assign(event, patch);
      return event;
    });
  },

  async deleteEvent(id) {
    await transaction((data) => {
      data.events = data.events.filter((e) => e.id !== id);
      data.slots = data.slots.filter((s) => s.eventId !== id);
      delete data.photos[id];
    });
  },

  /* Photos are kept out of snapshot() so the admin's poll stays small. */
  async getPhoto(eventId) {
    const data = await readFile();
    return data.photos[eventId] || null;
  },

  async setPhoto(eventId, photo) {
    await transaction((data) => { data.photos[eventId] = photo; });
  },

  async deletePhoto(eventId) {
    await transaction((data) => { delete data.photos[eventId]; });
  },

  async getSlot(id) {
    const data = await readFile();
    return data.slots.find((s) => s.id === id) || null;
  },

  async getSlotByToken(token) {
    const data = await readFile();
    return data.slots.find((s) => s.token === token) || null;
  },

  async createSlots(slots) {
    await transaction((data) => { data.slots.push(...slots); });
    return slots;
  },

  async updateSlot(id, patch) {
    return transaction((data) => {
      const slot = data.slots.find((s) => s.id === id);
      if (!slot) return null;
      Object.assign(slot, patch);
      return slot;
    });
  },

  async updateSlotByToken(token, patch) {
    return transaction((data) => {
      const slot = data.slots.find((s) => s.token === token);
      if (!slot) return null;
      Object.assign(slot, patch);
      return slot;
    });
  },

  async deleteSlot(id) {
    await transaction((data) => {
      data.slots = data.slots.filter((s) => s.id !== id);
    });
  },

  /** Clears an event's seating without touching the event itself. */
  async deleteSlotsByEvent(eventId) {
    return transaction((data) => {
      const before = data.slots.length;
      data.slots = data.slots.filter((s) => s.eventId !== eventId);
      return before - data.slots.length;
    });
  },
};
