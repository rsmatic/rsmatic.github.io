/* ===========================================================
   End-to-end test against a running API.

     node server/server.js                # in one terminal
     node test/e2e.js                     # in another

   Point it somewhere else to test the deployed Worker:
     API=https://aby41-api.you.workers.dev KEY=secret node test/e2e.js
   =========================================================== */

const API = (process.env.API || 'http://localhost:3000').replace(/\/+$/, '');
const KEY = process.env.KEY || 'aby1025';

let passed = 0;
let failed = 0;

function ok(label, cond, extra = '') {
  if (cond) { passed += 1; console.log('  PASS  ' + label); }
  else { failed += 1; console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
}

async function call(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.admin !== false) headers['x-admin-key'] = KEY;
  const res = await fetch(API + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch { /* empty body */ }
  return { status: res.status, j };
}

/* The server validates theme ids against api/core.js; the admin console draws
   its picker from app/themes.js. If those two lists drift, every theme in the
   picker that the server does not know would fail to save. */
async function checkThemeListsAgree() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));

  const { THEMES } = await import('../api/core.js');
  const source = readFileSync(join(here, '..', 'app', 'themes.js'), 'utf8');
  // ABY_THEME_GROUPS carries { id: ... } entries too, so read only the themes.
  const list = source.slice(source.indexOf('window.ABY_THEMES = ['));
  const uiIds = [...list.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]);

  ok('app/themes.js offers 20 themes', uiIds.length === 20, String(uiIds.length));
  ok('the picker and the server agree on theme ids',
    uiIds.join(',') === THEMES.join(','), uiIds.join(',') + ' vs ' + THEMES.join(','));
}

/* The invitation used to read "41th Birthday". Pull the ordinal helper out of
   the page and check the cases that catch a naive implementation. */
async function checkOrdinals() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));

  const src = readFileSync(join(here, '..', 'app', 'invite.js'), 'utf8');
  const match = src.match(/function ordinal\(n\) \{[\s\S]*?\n {2}\}/);
  if (!match) throw new Error('ordinal() not found in app/invite.js');
  const ordinal = new Function('return (' + match[0] + ')')();

  const cases = [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'],
    [13, '13th'], [21, '21st'], [22, '22nd'], [41, '41st'], [100, '100th'], [111, '111th']];
  const wrong = cases.filter(([n, want]) => ordinal(n) !== want)
    .map(([n, want]) => n + '->' + ordinal(n) + ' (want ' + want + ')');
  ok('ordinals read 41st, 22nd, 13th — not 41th', wrong.length === 0, wrong.join(', '));
}

async function main() {
  console.log('Testing ' + API + '\n');

  console.log('== invitation wording ==');
  await checkOrdinals().catch((err) => {
    failed += 1;
    console.log('  FAIL  could not check ordinals -> ' + err.message);
  });

  console.log('== theme lists ==');
  await checkThemeListsAgree().catch((err) => {
    failed += 1;
    console.log('  FAIL  could not compare the theme lists -> ' + err.message);
  });

  console.log('== admin key ==');
  ok('no key -> 401', (await call('/api/events', { admin: false })).status === 401);
  const bad = await fetch(API + '/api/events', { headers: { 'x-admin-key': 'wrong' } });
  ok('wrong key -> 401', bad.status === 401);
  ok('right key -> 200', (await call('/api/events')).status === 200);

  console.log('\n== event ==');
  let r = await call('/api/events', { method: 'POST', body: { title: 'Test Event', eventDate: '2026-10-25', celebrant: 'Tester' } });
  ok('create event', r.status === 201, JSON.stringify(r.j));
  const eventId = r.j.id;
  ok('event without a date -> 400', (await call('/api/events', { method: 'POST', body: { title: 'No date' } })).status === 400);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { venue: 'Bahay namin' } });
  ok('update event', r.j.venue === 'Bahay namin', JSON.stringify(r.j));

  console.log('\n== theme ==');
  ok('a new event falls back to the default theme', r.j.theme === 'rose-gold', r.j.theme);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { theme: 'midnight' } });
  ok('a known theme is stored', r.j.theme === 'midnight', r.j.theme);
  ok('an unknown theme -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { theme: 'neon-disco' } })).status === 400);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { theme: '' } });
  ok('an empty theme returns to the default', r.j.theme === 'rose-gold', r.j.theme);
  await call('/api/events/' + eventId, { method: 'PATCH', body: { theme: 'emerald' } });

  console.log('\n== age on the invitation ==');
  r = await call('/api/events/' + eventId);
  r = await call('/api/events');
  const fresh = r.j.events.find((e) => e.id === eventId);
  ok('a new event shows the age by default', fresh.ageDisplay === 'number', fresh.ageDisplay);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { ageDisplay: 'hidden' } });
  ok('the age can be hidden', r.j.ageDisplay === 'hidden', r.j.ageDisplay);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { ageDisplay: 'custom', ageLabel: 'Fourtis' } });
  ok('own wording is stored', r.j.ageDisplay === 'custom' && r.j.ageLabel === 'Fourtis',
    r.j.ageDisplay + ' / ' + r.j.ageLabel);
  ok('an unknown age display -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { ageDisplay: 'sideways' } })).status === 400);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { ageLabel: 'x'.repeat(80) } });
  ok('the wording is capped at 40 characters', r.j.ageLabel.length === 40, String(r.j.ageLabel.length));
  await call('/api/events/' + eventId, { method: 'PATCH', body: { ageDisplay: 'custom', ageLabel: 'Fourtis' } });

  console.log('\n== invitation design ==');
  r = await call('/api/events');
  const design = r.j.events.find((e) => e.id === eventId);
  ok('a new event gets the design defaults',
    design.photoShape === 'circle' && design.photoSize === 'medium' &&
    design.borderStyle === 'double' && design.cardCorners === 'soft' && design.cardAlign === 'center',
    JSON.stringify([design.photoShape, design.photoSize, design.borderStyle, design.cardCorners, design.cardAlign]));
  r = await call('/api/events/' + eventId, {
    method: 'PATCH',
    body: { photoShape: 'arch', photoSize: 'large', borderStyle: 'dashed', cardCorners: 'round', cardAlign: 'left' },
  });
  ok('every design choice is stored',
    r.j.photoShape === 'arch' && r.j.photoSize === 'large' && r.j.borderStyle === 'dashed' &&
    r.j.cardCorners === 'round' && r.j.cardAlign === 'left', JSON.stringify(r.j.photoShape));
  ok('an unknown shape -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { photoShape: 'triangle' } })).status === 400);
  ok('an unknown border -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { borderStyle: 'neon' } })).status === 400);

  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { accentColor: '#FF8800', borderColor: '#123456' } });
  ok('colours are stored lowercase', r.j.accentColor === '#ff8800' && r.j.borderColor === '#123456',
    r.j.accentColor + ' / ' + r.j.borderColor);
  ok('a colour that is not #rrggbb -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { accentColor: 'red' } })).status === 400);
  ok('a colour of "" hands it back to the theme',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { accentColor: '' } })).j.accentColor === '');

  console.log('\n== photo ==');
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  ok('an event starts with no photo',
    (await call('/api/events/' + eventId + '/photo')).status === 404);
  ok('a data URL that is not an image -> 400',
    (await call('/api/events/' + eventId + '/photo', { method: 'PUT', body: { dataUrl: 'data:text/html;base64,PGI+' } })).status === 400);
  ok('something that is not a data URL -> 400',
    (await call('/api/events/' + eventId + '/photo', { method: 'PUT', body: { dataUrl: 'https://example.com/x.png' } })).status === 400);
  ok('an oversized photo -> 413',
    (await call('/api/events/' + eventId + '/photo', { method: 'PUT', body: { dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(700000) } })).status === 413);

  r = await call('/api/events/' + eventId + '/photo', { method: 'PUT', body: { dataUrl: 'data:image/png;base64,' + PNG } });
  ok('a PNG uploads', r.status === 200 && !!r.j.photoUpdatedAt, JSON.stringify(r.j));
  const stamp = r.j.photoUpdatedAt;

  let raw = await fetch(API + '/api/events/' + eventId + '/photo', { headers: { 'x-admin-key': KEY } });
  const bytes = new Uint8Array(await raw.arrayBuffer());
  ok('the photo comes back as image bytes',
    raw.headers.get('content-type') === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50,
    raw.headers.get('content-type') + ' / ' + bytes[0]);
  ok('the photo is cached hard', /immutable/.test(raw.headers.get('cache-control') || ''),
    raw.headers.get('cache-control'));

  r = await call('/api/events');
  ok('the admin list carries the stamp but not the image',
    r.j.events.find((e) => e.id === eventId).photoUpdatedAt === stamp &&
    JSON.stringify(r.j.events).indexOf(PNG.slice(0, 40)) < 0);
  console.log('\n== venue map link ==');
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: 'https://maps.app.goo.gl/abc123' } });
  ok('an https link is kept', r.j.venueMapUrl === 'https://maps.app.goo.gl/abc123', r.j.venueMapUrl);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: 'maps.app.goo.gl/xyz' } });
  ok('a bare domain becomes https', r.j.venueMapUrl === 'https://maps.app.goo.gl/xyz', r.j.venueMapUrl);
  ok('a javascript: link -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: 'javascript:alert(1)' } })).status === 400);
  ok('a data: link -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: 'data:text/html,<script>' } })).status === 400);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: '' } });
  ok('an empty link clears it', r.j.venueMapUrl === '', JSON.stringify(r.j.venueMapUrl));
  await call('/api/events/' + eventId, { method: 'PATCH', body: { venueMapUrl: 'https://maps.example/venue' } });

  console.log('\n== slots ==');
  r = await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Table 1', count: 3, startAt: 1 } });
  ok('create 3 slots', r.status === 201 && r.j.created.length === 3);
  const [a, b, c] = r.j.created;
  ok('new slots start open', r.j.created.every((s) => s.status === 'open'));
  ok('labels are seat-numbered', a.label.endsWith('Seat 1') && c.label.endsWith('Seat 3'), a.label);
  ok('tokens are unique', new Set(r.j.created.map((s) => s.token)).size === 3);

  r = await call('/api/slots/' + a.id, { method: 'PATCH', body: { guestName: 'Juan Dela Cruz', guestContact: '09171234567' } });
  ok('assigning a name flips open -> invited', r.j.status === 'invited', r.j.status);

  console.log('\n== seat order ==');
  await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Order', count: 12 } });
  r = await call('/api/events');
  const seatOrder = r.j.slots.filter((s) => s.table === 'Order').map((s) => s.seat).join(',');
  ok('seats come back 1..12, not 1,10,11,12,2', seatOrder === '1,2,3,4,5,6,7,8,9,10,11,12', seatOrder);

  console.log('\n== guest opens the link ==');
  r = await call('/api/invite/' + a.token, { admin: false });
  ok('invite loads without any admin key', r.status === 200);
  ok('guest sees their own seat + name', r.j.label === a.label && r.j.guestName === 'Juan Dela Cruz');
  ok('token is NOT echoed back to the guest page', !('token' in r.j));
  ok('event details reach the guest', r.j.event.venue === 'Bahay namin');
  ok('the theme reaches the guest page', r.j.event.theme === 'emerald', r.j.event.theme);
  ok('the age wording reaches the guest page',
    r.j.event.ageDisplay === 'custom' && r.j.event.ageLabel === 'Fourtis',
    r.j.event.ageDisplay + ' / ' + r.j.event.ageLabel);
  ok('the map link reaches the guest page', r.j.event.venueMapUrl === 'https://maps.example/venue',
    r.j.event.venueMapUrl);
  ok('the design reaches the guest page',
    r.j.event.photoShape === 'arch' && r.j.event.cardAlign === 'left' && !!r.j.event.photoUpdatedAt,
    JSON.stringify([r.j.event.photoShape, r.j.event.cardAlign, r.j.event.photoUpdatedAt]));

  raw = await fetch(API + '/api/invite/' + a.token + '/photo');
  ok('a guest can load the photo with only their token',
    raw.ok && raw.headers.get('content-type') === 'image/png', raw.status + ' ' + raw.headers.get('content-type'));
  ok('a bad token cannot', !(await fetch(API + '/api/invite/nope/photo')).ok);
  ok('the design reaches the guest page',
    r.j.event.photoShape === 'arch' && r.j.event.cardAlign === 'left' && !!r.j.event.photoUpdatedAt,
    JSON.stringify([r.j.event.photoShape, r.j.event.cardAlign, r.j.event.photoUpdatedAt]));

  raw = await fetch(API + '/api/invite/' + a.token + '/photo');
  ok('a guest can load the photo with only their token',
    raw.ok && raw.headers.get('content-type') === 'image/png', raw.status + ' ' + raw.headers.get('content-type'));
  ok('a bad token cannot',
    !(await fetch(API + '/api/invite/nope/photo')).ok);

  console.log('\n== guest confirms ==');
  r = await call('/api/invite/' + a.token, { admin: false, method: 'POST', body: { attending: true, message: 'Happy birthday Aby!' } });
  ok('confirm returns confirmed', r.j.status === 'confirmed', r.j.status);
  r = await call('/api/events');
  const locked = r.j.slots.find((s) => s.id === a.id);
  ok('seat is blocked on the admin side', locked.status === 'confirmed' && !!locked.respondedAt);
  ok('greeting is stored', locked.message === 'Happy birthday Aby!');

  console.log('\n== guest declines ==');
  await call('/api/slots/' + b.id, { method: 'PATCH', body: { guestName: 'Maria Santos' } });
  r = await call('/api/invite/' + b.token, { admin: false, method: 'POST', body: { attending: false } });
  ok('decline without a reason is rejected', r.status === 400, r.status + ' ' + (r.j && r.j.error));
  r = await call('/api/invite/' + b.token, { admin: false, method: 'POST', body: { attending: false, reason: 'May biyahe po ako.' } });
  ok('decline with a reason is accepted', r.j.status === 'declined');
  r = await call('/api/events');
  ok('reason reaches the admin board', r.j.slots.find((s) => s.id === b.id).reason === 'May biyahe po ako.');

  console.log('\n== guest changes their mind ==');
  r = await call('/api/invite/' + b.token, { admin: false, method: 'POST', body: { attending: true } });
  ok('declined -> confirmed works', r.j.status === 'confirmed');
  ok('the old reason is cleared', r.j.reason === null, JSON.stringify(r.j.reason));

  console.log('\n== admin controls ==');
  r = await call('/api/slots/' + a.id + '/reset', { method: 'POST' });
  ok('reset returns the seat to invited', r.j.status === 'invited' && r.j.respondedAt === null);
  r = await call('/api/slots/' + c.id + '/token', { method: 'POST' });
  ok('regenerating the link changes the token', r.j.token !== c.token);
  ok('the old link stops working', (await call('/api/invite/' + c.token, { admin: false })).status === 404);
  r = await call('/api/slots/' + b.id, { method: 'PATCH', body: { guestName: '' } });
  ok('clearing the name frees the seat', r.j.status === 'open' && r.j.respondedAt === null && r.j.reason === null);
  r = await call('/api/slots/' + b.id, { method: 'PATCH', body: { table: 'Table 2', seat: '9', label: '' } });
  ok('relabelling follows table + seat', r.j.label === 'Table 2 · Seat 9', r.j.label);

  console.log('\n== bad input ==');
  ok('unknown token -> 404', (await call('/api/invite/does-not-exist', { admin: false })).status === 404);
  ok('missing answer -> 400', (await call('/api/invite/' + a.token, { admin: false, method: 'POST', body: {} })).status === 400);
  ok('unknown slot -> 404', (await call('/api/slots/slt_nope', { method: 'PATCH', body: { guestName: 'x' } })).status === 404);
  ok('unknown endpoint -> 404', (await call('/api/nope')).status === 404);

  console.log('\n== concurrency ==');
  r = await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Stress', count: 30 } });
  const made = r.j.created;
  await Promise.all(made.map((s, i) => call('/api/slots/' + s.id, { method: 'PATCH', body: { guestName: 'Guest ' + i } })));
  await Promise.all(made.map((s, i) => call('/api/invite/' + s.token, {
    admin: false, method: 'POST',
    body: i % 2 ? { attending: true } : { attending: false, reason: 'busy' },
  })));
  r = await call('/api/events');
  const stress = r.j.slots.filter((s) => s.table === 'Stress');
  const confirmed = stress.filter((s) => s.status === 'confirmed').length;
  const declined = stress.filter((s) => s.status === 'declined').length;
  ok('30 simultaneous answers, none lost', stress.length === 30 && confirmed === 15 && declined === 15,
    stress.length + ' slots / ' + confirmed + ' confirmed / ' + declined + ' declined');

  console.log('\n== delete all seats ==');
  r = await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Wipe', count: 4 } });
  const wipeToken = r.j.created[0].token;
  await call('/api/slots/' + r.j.created[0].id, { method: 'PATCH', body: { guestName: 'Someone' } });
  await call('/api/invite/' + wipeToken, { admin: false, method: 'POST', body: { attending: true } });
  const beforeWipe = (await call('/api/events')).j.slots.filter((s) => s.eventId === eventId).length;
  r = await call('/api/events/' + eventId + '/slots', { method: 'DELETE' });
  ok('reports how many it removed', r.status === 200 && r.j.removed === beforeWipe, JSON.stringify(r.j));
  r = await call('/api/events');
  ok('no seats left for the event', !r.j.slots.some((s) => s.eventId === eventId));
  ok('the event itself survives', r.j.events.some((e) => e.id === eventId));
  ok('links from deleted seats stop working',
    (await call('/api/invite/' + wipeToken, { admin: false })).status === 404);
  ok('deleting seats of an unknown event -> 404',
    (await call('/api/events/evt_nope/slots', { method: 'DELETE' })).status === 404);
  ok('clearing an already empty event is harmless',
    (await call('/api/events/' + eventId + '/slots', { method: 'DELETE' })).j.removed === 0);

  console.log('\n== removing the photo ==');
  ok('the photo can be removed',
    (await call('/api/events/' + eventId + '/photo', { method: 'DELETE' })).status === 200);
  ok('it is gone afterwards',
    (await call('/api/events/' + eventId + '/photo')).status === 404);
  r = await call('/api/events');
  ok('the stamp is cleared too',
    !r.j.events.find((e) => e.id === eventId).photoUpdatedAt,
    JSON.stringify(r.j.events.find((e) => e.id === eventId).photoUpdatedAt));

  console.log('\n== export ==');
  r = await call('/api/export');
  ok('export returns events + slots', Array.isArray(r.j.events) && Array.isArray(r.j.slots));

  console.log('\n== cleanup ==');
  await call('/api/events/' + eventId, { method: 'DELETE' });
  r = await call('/api/events');
  ok('deleting the event removes its slots too',
    !r.j.events.some((e) => e.id === eventId) && !r.j.slots.some((s) => s.eventId === eventId));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest run failed: ' + err.message);
  process.exit(1);
});
