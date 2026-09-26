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
  if (opts.coordinator) headers['x-coordinator-key'] = opts.coordinator;
  else if (opts.admin !== false) headers['x-admin-key'] = KEY;
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

/**
 * A method missing from Access-Control-Allow-Methods is invisible to curl and
 * fatal in a browser — the preflight refuses the request before it is sent.
 * Photo upload shipped broken that way, so compare the header against the
 * methods the pages actually use.
 */
async function checkCorsCoversTheApp() {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));

  const source = ['admin.js', 'invite.js', 'coordinator.js', 'board.js']
    .map((f) => readFileSync(join(here, '..', 'app', f), 'utf8')).join('\n');
  const used = new Set(['GET', ...[...source.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1])]);

  const res = await fetch(API + '/api/events', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://rsmatic.github.io',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,x-admin-key',
    },
  });
  const allow = res.headers.get('access-control-allow-methods');
  if (!allow) {
    console.log('  SKIP  same-origin server, no CORS headers to check');
    return;
  }
  const missing = [...used].filter((m) => allow.indexOf(m) < 0);
  ok('CORS allows every method the pages use', missing.length === 0,
    'missing ' + missing.join(', ') + ' from "' + allow + '"');
}

/**
 * The guest pages live in folders so their address has no .html:
 * /booking/invitation and /booking/coordinator. The local server mirrors
 * what GitHub Pages does, and the old .html addresses still forward, so
 * links already sent out keep working.
 */
async function checkPageRoutes() {
  const home = await fetch(API + '/');
  if (!(home.headers.get('content-type') || '').includes('text/html')) {
    console.log('  SKIP  API-only host, no pages to serve');
    return;
  }

  for (const path of ['/', '/invitation', '/invitation/', '/coordinator', '/coordinator/',
    '/app/board.js', '/app/styles.css']) {
    const res = await fetch(API + path, { redirect: 'manual' });
    ok('serves ' + path, res.ok || res.status === 302, String(res.status));
  }

  const invitation = await (await fetch(API + '/invitation?t=whatever')).text();
  ok('the invitation page reaches its assets from one folder up',
    invitation.includes('"../app/invite.js"') && !invitation.includes('"app/invite.js"'));

  ok('the old i.html and c.html addresses are gone',
    (await fetch(API + '/i.html?t=whatever')).status === 404 &&
    (await fetch(API + '/c.html')).status === 404);

  ok('nothing under server/ is reachable',
    (await fetch(API + '/server/data/db.json')).status === 404);
}

async function main() {
  console.log('Testing ' + API + '\n');

  console.log('== page addresses ==');
  await checkPageRoutes().catch((err) => {
    failed += 1;
    console.log('  FAIL  could not check the page routes -> ' + err.message);
  });

  console.log('== browser access ==');
  await checkCorsCoversTheApp().catch((err) => {
    failed += 1;
    console.log('  FAIL  could not check CORS -> ' + err.message);
  });

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

  console.log('\n== seats on the invitation ==');
  r = await call('/api/events');
  ok('a new event names the seats by default',
    r.j.events.find((e) => e.id === eventId).seatDisplay === 'full',
    r.j.events.find((e) => e.id === eventId).seatDisplay);
  ok('the seat numbers can be hidden',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { seatDisplay: 'hidden' } })).j.seatDisplay === 'hidden');
  ok('only the count can be shown',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { seatDisplay: 'count' } })).j.seatDisplay === 'count');
  ok('an unknown seat display -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { seatDisplay: 'semaphore' } })).status === 400);
  ok('an empty value returns to naming the seats',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { seatDisplay: '' } })).j.seatDisplay === 'full');
  await call('/api/events/' + eventId, { method: 'PATCH', body: { seatDisplay: 'count' } });

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
  ok('the seat display choice reaches the guest page',
    r.j.event.seatDisplay === 'count', r.j.event.seatDisplay);
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

  console.log('\n== pausing the links ==');
  r = await call('/api/events');
  ok('a new event has its links open',
    r.j.events.find((e) => e.id === eventId).inviteStatus === 'open',
    r.j.events.find((e) => e.id === eventId).inviteStatus);
  ok('an unknown invite status -> 400',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { inviteStatus: 'maybe' } })).status === 400);
  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { inviteStatus: 'paused', pausedMessage: '' } });
  ok('the links can be paused', r.j.inviteStatus === 'paused', r.j.inviteStatus);

  r = await call('/api/invite/' + a.token, { admin: false });
  ok('a paused link says so', r.status === 200 && r.j.paused === true, JSON.stringify(r.j));
  ok('with a default message when the host wrote none', /not ready yet/.test(r.j.message), r.j.message);
  ok('and gives away no seat, date or venue',
    !('seats' in r.j) && !('guestName' in r.j) && !('token' in r.j) &&
    !('eventDate' in r.j.event) && !('venue' in r.j.event),
    JSON.stringify(r.j));
  ok('but keeps the look of the event', r.j.event.theme === 'emerald', r.j.event.theme);

  await call('/api/events/' + eventId, { method: 'PATCH', body: { pausedMessage: '  Abangan! Malapit na.  ' } });
  r = await call('/api/invite/' + a.token, { admin: false });
  ok('the host can write their own message', r.j.message === 'Abangan! Malapit na.', r.j.message);
  ok('the message is capped at 500 characters',
    (await call('/api/events/' + eventId, { method: 'PATCH', body: { pausedMessage: 'x'.repeat(600) } }))
      .j.pausedMessage.length === 500);
  await call('/api/events/' + eventId, { method: 'PATCH', body: { pausedMessage: 'Abangan! Malapit na.' } });

  r = await call('/api/invite/' + a.token, { admin: false, method: 'POST', body: { attending: true } });
  ok('a paused link cannot answer', r.status === 403, r.status + ' ' + JSON.stringify(r.j));
  ok('and the refusal carries the message', r.j && r.j.error === 'Abangan! Malapit na.', JSON.stringify(r.j));
  ok('nor load the photo', (await fetch(API + '/api/invite/' + a.token + '/photo')).status === 403);
  r = await call('/api/events');
  ok('the refused answer changed nothing', !r.j.slots.find((s) => s.id === a.id).respondedAt);

  r = await call('/api/events/' + eventId, { method: 'PATCH', body: { inviteStatus: 'open' } });
  ok('the links can be opened again', r.j.inviteStatus === 'open', r.j.inviteStatus);
  ok('and the message is kept for next time', r.j.pausedMessage === 'Abangan! Malapit na.', r.j.pausedMessage);
  r = await call('/api/invite/' + a.token, { admin: false });
  ok('the same link shows the invitation again', !r.j.paused && r.j.event.venue === 'Bahay namin');

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

  console.log('\n== one guest, several seats ==');
  r = await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Merge', count: 4 } });
  const m = r.j.created;
  // The same person on two seats, someone else on a third.
  await call('/api/slots/' + m[0].id, { method: 'PATCH', body: { guestName: 'Jed' } });
  await call('/api/slots/' + m[1].id, { method: 'PATCH', body: { guestName: '  jed  ' } });
  await call('/api/slots/' + m[2].id, { method: 'PATCH', body: { guestName: 'Tita Baby' } });

  r = await call('/api/invite/' + m[0].token, { admin: false });
  ok('the invitation lists both of that name\'s seats',
    r.j.seats.length === 2, JSON.stringify(r.j.seats));
  ok('matching ignores case and stray spaces',
    r.j.seats.map((x) => x.seat).join(',') === m[0].seat + ',' + m[1].seat,
    r.j.seats.map((x) => x.seat).join(','));
  ok('someone else is not swept in',
    (await call('/api/invite/' + m[2].token, { admin: false })).j.seats.length === 1);

  r = await call('/api/invite/' + m[0].token, { admin: false, method: 'POST', body: { attending: true } });
  ok('answering once returns all of their seats', r.j.seats.length === 2);
  r = await call('/api/events');
  const merged = r.j.slots.filter((x) => x.table === 'Merge');
  ok('both seats lock together',
    merged.find((x) => x.id === m[0].id).status === 'confirmed' &&
    merged.find((x) => x.id === m[1].id).status === 'confirmed',
    merged.map((x) => x.status).join(','));
  ok('the other guest is untouched',
    merged.find((x) => x.id === m[2].id).status === 'invited',
    merged.find((x) => x.id === m[2].id).status);
  ok('the empty seat stays open',
    merged.find((x) => x.id === m[3].id).status === 'open');

  r = await call('/api/invite/' + m[1].token, { admin: false, method: 'POST', body: { attending: false, reason: 'May lakad' } });
  ok('changing the answer from the other link moves both',
    r.j.status === 'declined');
  r = await call('/api/events');
  ok('both seats now read declined',
    r.j.slots.filter((x) => x.table === 'Merge' && x.status === 'declined').length === 2);

  // Renaming one of them splits the pair again.
  await call('/api/slots/' + m[1].id, { method: 'PATCH', body: { guestName: 'Jed Junior' } });
  ok('renaming one seat separates the invitations',
    (await call('/api/invite/' + m[0].token, { admin: false })).j.seats.length === 1);

  // A seat with no name must never merge with another nameless seat.
  await call('/api/slots/' + m[0].id, { method: 'PATCH', body: { guestName: '' } });
  r = await call('/api/invite/' + m[0].token, { admin: false });
  ok('nameless seats stand alone', r.j.seats.length === 1, JSON.stringify(r.j.seats));
  r = await call('/api/invite/' + m[0].token, { admin: false, method: 'POST', body: { attending: true } });
  ok('a nameless seat can still answer for itself', r.j.status === 'confirmed');
  r = await call('/api/events');
  ok('and does not drag the other nameless seat with it',
    r.j.slots.find((x) => x.id === m[3].id).status === 'open',
    r.j.slots.find((x) => x.id === m[3].id).status);

  await call('/api/events/' + eventId + '/slots', { method: 'DELETE' });
  console.log('\n== coordinator access ==');
  // The seats were all removed a moment ago, so give this section its own.
  await call('/api/events/' + eventId + '/slots', { method: 'POST', body: { table: 'Coord', count: 3 } });

  ok('a coordinator key is refused before one exists',
    (await call('/api/coordinator/board', { coordinator: 'nothing' })).status === 401);
  ok('an empty coordinator key is refused',
    (await call('/api/coordinator/board', { coordinator: ' ' })).status === 401);

  r = await call('/api/events/' + eventId + '/coordinator', { method: 'POST' });
  ok('the host can issue a key', r.status === 200 && /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/.test(r.j.coordinatorKey || ''),
    JSON.stringify(r.j));
  const ckey = r.j.coordinatorKey;

  r = await call('/api/coordinator/session', { admin: false, method: 'POST', body: { key: ckey } });
  ok('the key signs in and names its event', r.status === 200 && r.j.eventId === eventId, JSON.stringify(r.j));
  ok('a wrong key does not',
    (await call('/api/coordinator/session', { admin: false, method: 'POST', body: { key: 'aaaa-bbbb-cccc-dddd' } })).status === 401);

  r = await call('/api/coordinator/board', { coordinator: ckey });
  ok('the board lists this event only',
    r.status === 200 && r.j.event.id === eventId && r.j.slots.every((x) => x.eventId === eventId));
  ok('the board never hands out seat tokens',
    r.j.slots.length > 0 && r.j.slots.every((x) => !('token' in x)),
    Object.keys(r.j.slots[0] || {}).join(','));
  ok('the coordinator key is never echoed back',
    JSON.stringify(r.j).indexOf(ckey) < 0);
  ok('the event view leaves out the design and the key',
    !('coordinatorKey' in r.j.event) && !('accentColor' in r.j.event) && !('photoUpdatedAt' in r.j.event),
    Object.keys(r.j.event).join(','));

  console.log('\n== the coordinator page is read-only ==');
  const seat = r.j.slots.find((x) => x.status === 'open') || r.j.slots[0];
  ok('cannot rename a guest',
    (await call('/api/coordinator/slots/' + seat.id, {
      coordinator: ckey, method: 'PATCH', body: { guestName: 'Tita Baby' },
    })).status === 404);
  ok('cannot reissue a link',
    (await call('/api/coordinator/slots/' + seat.id + '/token', { coordinator: ckey, method: 'POST' })).status === 404);
  ok('cannot undo an answer',
    (await call('/api/coordinator/slots/' + seat.id + '/reset', { coordinator: ckey, method: 'POST' })).status === 404);
  r = await call('/api/events');
  ok('the seat is untouched by all of that',
    r.j.slots.find((x) => x.id === seat.id).guestName !== 'Tita Baby',
    r.j.slots.find((x) => x.id === seat.id).guestName);
  ok('cannot read the admin event list',
    (await call('/api/events', { coordinator: ckey, admin: false })).status === 401);
  ok('cannot change the event',
    (await call('/api/events/' + eventId, { coordinator: ckey, admin: false, method: 'PATCH', body: { title: 'Nope' } })).status === 401);
  ok('cannot delete a seat',
    (await call('/api/coordinator/slots/' + seat.id, { coordinator: ckey, method: 'DELETE' })).status === 404);
  ok('cannot create seats',
    (await call('/api/events/' + eventId + '/slots', { coordinator: ckey, admin: false, method: 'POST', body: { count: 1 } })).status === 401);
  ok('cannot issue itself a new key',
    (await call('/api/events/' + eventId + '/coordinator', { coordinator: ckey, admin: false, method: 'POST' })).status === 401);

  const other = await call('/api/events', { method: 'POST', body: { title: 'Someone else', eventDate: '2026-12-01' } });
  await call('/api/events/' + other.j.id + '/coordinator', { method: 'POST' });
  r = await call('/api/coordinator/board', { coordinator: ckey });
  ok('sees only its own event, never another one',
    r.j.event.id === eventId && r.j.slots.every((x) => x.eventId === eventId));
  await call('/api/events/' + other.j.id, { method: 'DELETE' });

  console.log('\n== revoking ==');
  r = await call('/api/events/' + eventId + '/coordinator', { method: 'POST' });
  ok('a replacement key retires the old one',
    (await call('/api/coordinator/board', { coordinator: ckey })).status === 401);
  const ckey2 = r.j.coordinatorKey;
  ok('the replacement works', (await call('/api/coordinator/board', { coordinator: ckey2 })).status === 200);
  await call('/api/events/' + eventId + '/coordinator', { method: 'DELETE' });
  ok('revoking closes the door', (await call('/api/coordinator/board', { coordinator: ckey2 })).status === 401);
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
