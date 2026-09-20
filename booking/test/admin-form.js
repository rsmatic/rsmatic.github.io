/* ===========================================================
   Regression test for the admin console's event form.

   The board reloads every 15 seconds and refills the form from
   the server. That quietly reverted any edit not yet saved —
   pick "Hide it" for the age, wait, and Save wrote "number".

   Runs app/admin.js against a DOM small enough to fit in this
   file, so it needs no browser and no server.

     node test/admin-form.js
   =========================================================== */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app');

let passed = 0;
let failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed += 1; console.log('  PASS  ' + label); }
  else { failed += 1; console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
};

/* ------------------------------------------------------------- tiny DOM */

function makeElement(id) {
  const listeners = {};
  const classes = new Set();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: false,
    files: [],
    href: '',
    style: { setProperty() {}, removeProperty() {} },
    listeners,
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c))
        : (on ? classes.add(c) : classes.delete(c))),
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeAttribute: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    querySelector: () => makeElement('inner'),
    querySelectorAll: () => [],
    appendChild: () => {},
    removeChild: () => {},
    select: () => {},
    click: () => {},
    focus: () => {},
    reset: () => {},
  };
}

const elements = new Map();
const byId = (id) => {
  if (!elements.has(id)) elements.set(id, makeElement(id));
  return elements.get(id);
};

const fire = (el, type) => (el.listeners[type] || []).forEach((fn) => fn({ preventDefault() {} }));
const flush = () => new Promise((r) => setTimeout(r, 0));

/* --------------------------------------------------------------- server */

const EVENT = {
  id: 'evt_test',
  title: "Aby's 41st Birthday",
  celebrant: 'Mary Abegail Matic',
  nickname: 'Aby',
  birthDate: '1985-10-25',
  eventDate: '2026-10-25',
  startTime: '11:30',
  venue: 'Akiro Farm Cafe',
  venueMapUrl: '',
  dressCode: '',
  note: '',
  rsvpDeadline: '2026-10-18',
  hostName: 'Rexter Matic',
  theme: 'lavender',
  ageDisplay: 'number',
  ageLabel: '',
};

const sent = [];
const jsonRes = (status, data) => Promise.resolve({
  ok: status < 400,
  status,
  json: () => Promise.resolve(data),
});

function fetchStub(url, init = {}) {
  const u = String(url);
  if (u.endsWith('/api/session')) return jsonRes(200, { ok: true });
  if (u.includes('/api/events/')) {
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      sent.push(body);
      Object.assign(EVENT, body);
      return jsonRes(200, EVENT);
    }
  }
  if (u.includes('/photo')) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  if (u.endsWith('/api/events')) return jsonRes(200, { events: [EVENT], slots: [] });
  return jsonRes(404, { error: 'not found' });
}

/* ----------------------------------------------------------------- run */

const store = new Map([['aby41.adminKey', 'secret']]);

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0, // the poll is driven by hand below
  Intl,
  Promise,
  JSON,
  Date,
  Math,
  String,
  Number,
  Boolean,
  Object,
  Array,
  RegExp,
  Error,
  URLSearchParams,
  URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
  FileReader: class { readAsDataURL() {} },
  Image: class {},
  fetch: fetchStub,
  confirm: () => true,
  navigator: {},
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  document: {
    getElementById: byId,
    querySelectorAll: () => [],
    createElement: () => makeElement('created'),
    documentElement: makeElement('html'),
    body: makeElement('body'),
    activeElement: null,
  },
};
sandbox.window = sandbox;
sandbox.window.location = {
  origin: 'https://rsmatic.github.io',
  pathname: '/booking/',
  hostname: 'rsmatic.github.io',
  search: '',
  hash: '',
};
// A real Worker URL: the console refuses to unlock when no API is configured.
sandbox.window.ABY_CONFIG = { api: 'https://api.example' };

const context = vm.createContext(sandbox);
vm.runInContext(readFileSync(join(APP, 'themes.js'), 'utf8'), context, { filename: 'themes.js' });
vm.runInContext(readFileSync(join(APP, 'board.js'), 'utf8'), context, { filename: 'board.js' });
vm.runInContext(readFileSync(join(APP, 'admin.js'), 'utf8'), context, { filename: 'admin.js' });

const reload = () => { fire(byId('refreshBtn'), 'click'); return flush().then(flush); };

async function main() {
  console.log('Admin event form\n');

  await flush();
  await flush();
  await flush();

  ok('the form is filled from the server on load',
    byId('d-ageDisplay').value === 'number' && byId('d-venue').value === 'Akiro Farm Cafe',
    byId('d-ageDisplay').value + ' / ' + byId('d-venue').value);

  console.log('\n== an edit survives the background reload ==');
  byId('d-ageDisplay').value = 'hidden';
  fire(byId('detailForm'), 'change');
  await reload();
  ok('the reload leaves the unsaved choice alone', byId('d-ageDisplay').value === 'hidden',
    byId('d-ageDisplay').value);
  ok('the form says there are unsaved changes',
    byId('detailSummary').textContent.indexOf('unsaved') >= 0,
    byId('detailSummary').textContent);

  console.log('\n== saving sends what is on screen ==');
  fire(byId('detailForm'), 'submit');
  await flush();
  await flush();
  const lastSent = sent[sent.length - 1] || {};
  ok('Save sends the chosen value, not the stale one', lastSent.ageDisplay === 'hidden',
    JSON.stringify(lastSent.ageDisplay));
  ok('the server now holds it', EVENT.ageDisplay === 'hidden', EVENT.ageDisplay);

  console.log('\n== after saving, the server is authoritative again ==');
  EVENT.venue = 'Changed elsewhere';
  await reload();
  ok('a later reload refills the form', byId('d-venue').value === 'Changed elsewhere',
    byId('d-venue').value);
  ok('the unsaved marker is gone',
    byId('detailSummary').textContent.indexOf('unsaved') < 0,
    byId('detailSummary').textContent);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest run failed: ' + err.stack);
  process.exit(1);
});
