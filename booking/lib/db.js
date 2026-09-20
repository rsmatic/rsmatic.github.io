'use strict';

/**
 * JSON-file database.
 * Every write goes through transaction(), which serializes read-modify-write
 * pairs and replaces data/db.json atomically (write temp file, then rename),
 * so a crash mid-write can never leave a half-written database behind.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return { events: [], slots: [] };
}

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(emptyDb(), null, 2), 'utf8');
  }
}

async function read() {
  ensureFile();
  const raw = await fsp.readFile(DB_FILE, 'utf8');
  const data = raw.trim() ? JSON.parse(raw) : emptyDb();
  if (!Array.isArray(data.events)) data.events = [];
  if (!Array.isArray(data.slots)) data.slots = [];
  return data;
}

async function writeAtomic(data) {
  ensureFile();
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, DB_FILE);
}

let queue = Promise.resolve();

/** Run fn(data) exclusively, then persist whatever fn mutated. */
function transaction(fn) {
  const run = queue.then(async () => {
    const data = await read();
    const result = await fn(data);
    await writeAtomic(data);
    return result;
  });
  queue = run.then(() => {}, () => {});
  return run;
}

module.exports = { read, transaction, DB_FILE };
