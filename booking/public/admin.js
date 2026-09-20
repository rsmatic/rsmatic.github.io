/* ===========================================================
   Admin console — events, seat slots, guest names, invite links.
   =========================================================== */

(function () {
  'use strict';

  var KEY_STORE = 'aby41.adminKey';
  var BASE_STORE = 'aby41.baseUrl';

  var state = {
    key: '',
    events: [],
    slots: [],
    eventId: '',
    filter: 'all',
    search: '',
    lastSnapshot: '',
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- helpers */

  var MONTHS = ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo',
    'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'];
  var DAYS = ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'];

  function formatDate(iso) {
    if (!iso) return '';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return iso;
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' (' + DAYS[d.getDay()] + ')';
  }

  function formatTime(hhmm) {
    if (!hhmm) return '';
    var bits = hhmm.split(':');
    var h = Number(bits[0]);
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (bits[1] || '00') + ' ' + suffix;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer;
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2800);
  }

  function api(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      headers: { 'x-admin-key': state.key },
    };
    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch('/api' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
        return data;
      });
    });
  }

  function fail(err) { toast(err.message, true); }

  function baseUrl() {
    return ($('baseUrl').value || '').trim().replace(/\/+$/, '') || window.location.origin;
  }

  function inviteLink(slot) { return baseUrl() + '/i/' + slot.token; }

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  function currentEvent() {
    for (var i = 0; i < state.events.length; i += 1) {
      if (state.events[i].id === state.eventId) return state.events[i];
    }
    return null;
  }

  function inviteMessage(slot) {
    var ev = currentEvent();
    if (!ev) return inviteLink(slot);
    var who = slot.guestName || 'Kaibigan';
    var when = formatDate(ev.eventDate) + (ev.startTime ? ', ' + formatTime(ev.startTime) : '');
    var lines = [
      'Kumusta ' + who + '!',
      '',
      'Inaanyayahan ka namin sa ' + ev.title + (ev.celebrant ? ' ni ' + ev.celebrant : '') + '.',
      'Petsa: ' + when,
    ];
    if (ev.venue) lines.push('Venue: ' + ev.venue);
    if (ev.dressCode) lines.push('Dress code: ' + ev.dressCode);
    lines.push('Nakalaan sa iyo: ' + slot.label);
    lines.push('');
    lines.push('Pakisagot lang po dito kung makakarating ka:');
    lines.push(inviteLink(slot));
    return lines.join('\n');
  }

  /* --------------------------------------------------------------- gate */

  function unlock(key) {
    return fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key }),
    }).then(function (res) {
      if (!res.ok) throw new Error('Maling admin key.');
      state.key = key;
      try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* private mode */ }
      $('gate').classList.add('hidden');
      $('app').classList.remove('hidden');
      return load();
    });
  }

  $('gateForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('gateError');
    err.classList.add('hidden');
    unlock($('gateKey').value.trim()).catch(function (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    });
  });

  $('lockBtn').addEventListener('click', function () {
    try { localStorage.removeItem(KEY_STORE); } catch (e) { /* ignore */ }
    window.location.reload();
  });

  /* --------------------------------------------------------------- load */

  function load() {
    return api('/events').then(function (data) {
      state.events = data.events || [];
      state.slots = data.slots || [];
      if (!currentEvent()) state.eventId = state.events.length ? state.events[0].id : '';
      render();
      $('syncNote').textContent = 'Huling sync ' + new Date().toLocaleTimeString();
    }).catch(fail);
  }

  /* ------------------------------------------------------------- render */

  function render() {
    renderEvents();
    var ev = currentEvent();
    $('eventScope').classList.toggle('hidden', !ev);
    if (!ev) return;
    fillDetailForm(ev);
    $('baseSample').textContent = baseUrl() + '/i/xxxxxxx';
    renderStats();
    renderSlots();
  }

  function renderEvents() {
    var host = $('eventList');
    if (!state.events.length) {
      host.innerHTML = '<p class="muted small">Wala pang event. Gumawa ng bago sa ibaba.</p>';
      return;
    }
    host.innerHTML = state.events.map(function (ev) {
      var count = state.slots.filter(function (s) { return s.eventId === ev.id; }).length;
      return '<button type="button" class="event-card' + (ev.id === state.eventId ? ' active' : '') +
        '" data-event="' + escapeHtml(ev.id) + '">' +
        '<span class="name">' + escapeHtml(ev.title) + '</span>' +
        '<span class="meta">' + escapeHtml(formatDate(ev.eventDate)) + ' &middot; ' + count + ' upuan</span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-event]'), function (btn) {
      btn.addEventListener('click', function () {
        state.eventId = btn.getAttribute('data-event');
        render();
      });
    });
  }

  function fillDetailForm(ev) {
    var map = {
      'd-title': ev.title, 'd-celebrant': ev.celebrant, 'd-nickname': ev.nickname,
      'd-birthDate': ev.birthDate, 'd-eventDate': ev.eventDate, 'd-startTime': ev.startTime,
      'd-venue': ev.venue, 'd-dressCode': ev.dressCode, 'd-rsvpDeadline': ev.rsvpDeadline,
      'd-hostName': ev.hostName, 'd-note': ev.note,
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (el && document.activeElement !== el) el.value = map[id] || '';
    });
    $('detailSummary').textContent = ev.title + ' — ' + formatDate(ev.eventDate);
  }

  function eventSlots() {
    return state.slots.filter(function (s) { return s.eventId === state.eventId; });
  }

  function renderStats() {
    var slots = eventSlots();
    var by = function (status) {
      return slots.filter(function (s) { return s.status === status; }).length;
    };
    var cards = [
      { k: 'Kabuuang upuan', n: slots.length, cls: '' },
      { k: 'Confirmed', n: by('confirmed'), cls: 'ok' },
      { k: 'Hinihintay', n: by('invited'), cls: 'wait' },
      { k: 'Hindi darating', n: by('declined'), cls: 'no' },
      { k: 'Bakante', n: by('open'), cls: 'open' },
    ];
    $('stats').innerHTML = cards.map(function (c) {
      return '<div class="stat ' + c.cls + '"><div class="n">' + c.n + '</div><div class="k">' + c.k + '</div></div>';
    }).join('');
  }

  var STATUS_LABEL = {
    open: 'Bakante', invited: 'Hinihintay', confirmed: 'Confirmed', declined: 'Hindi darating',
  };

  function renderSlots() {
    var host = $('slotList');
    var all = eventSlots();
    var needle = state.search.toLowerCase();
    var slots = all.filter(function (s) {
      if (state.filter !== 'all' && s.status !== state.filter) return false;
      if (!needle) return true;
      return (s.guestName + ' ' + s.label + ' ' + (s.guestContact || '')).toLowerCase().indexOf(needle) >= 0;
    });

    $('emptySlots').classList.toggle('hidden', all.length > 0);

    if (!slots.length) {
      host.innerHTML = all.length
        ? '<p class="muted small">Walang tugma sa filter na ito.</p>'
        : '';
      return;
    }

    host.innerHTML = slots.map(function (s) {
      var note = '';
      if (s.status === 'declined') {
        note = '<div class="note declined"><b>Dahilan:</b> ' + escapeHtml(s.reason || '—') +
          '<br><b>Sumagot:</b> ' + escapeHtml(new Date(s.respondedAt).toLocaleString()) + '</div>';
      } else if (s.status === 'confirmed') {
        note = '<div class="note confirmed"><b>Naka-lock ang upuan.</b> Sumagot noong ' +
          escapeHtml(new Date(s.respondedAt).toLocaleString()) +
          (s.message ? '<br><b>Mensahe:</b> ' + escapeHtml(s.message) : '') + '</div>';
      }
      return '<div class="slot ' + s.status + '" data-slot="' + escapeHtml(s.id) + '">' +
        '<div class="seat">' + escapeHtml(s.seat) + '<small>' + escapeHtml(s.table) + '</small></div>' +
        '<div><input data-field="guestName" placeholder="Pangalan ng bisita" value="' + escapeHtml(s.guestName) + '" /></div>' +
        '<div><input data-field="guestContact" placeholder="Viber / FB (optional)" value="' + escapeHtml(s.guestContact || '') + '" /></div>' +
        '<div class="actions">' +
          '<span class="badge ' + s.status + '">' + STATUS_LABEL[s.status] + '</span>' +
          '<button class="tiny" data-act="link" type="button" ' + (s.guestName ? '' : 'disabled') + '>Kopyahin ang link</button>' +
          '<button class="tiny" data-act="msg" type="button" ' + (s.guestName ? '' : 'disabled') + '>Mensahe</button>' +
          '<button class="tiny ghost" data-act="share" type="button" ' + (s.guestName ? '' : 'disabled') + '>Share</button>' +
          '<button class="tiny ghost" data-act="reset" type="button" ' + (s.respondedAt ? '' : 'disabled') + '>I-reset</button>' +
          '<button class="tiny ghost" data-act="token" type="button">Bagong link</button>' +
          '<button class="tiny danger" data-act="del" type="button">Alisin</button>' +
        '</div>' + note +
      '</div>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('.slot'), wireSlot);
  }

  function findSlot(id) {
    for (var i = 0; i < state.slots.length; i += 1) {
      if (state.slots[i].id === id) return state.slots[i];
    }
    return null;
  }

  function wireSlot(row) {
    var id = row.getAttribute('data-slot');

    Array.prototype.forEach.call(row.querySelectorAll('[data-field]'), function (input) {
      input.addEventListener('change', function () {
        var body = {};
        body[input.getAttribute('data-field')] = input.value;
        api('/slots/' + id, { method: 'PATCH', body: body })
          .then(function () { return load(); })
          .then(function () { toast('Na-save.'); })
          .catch(fail);
      });
    });

    Array.prototype.forEach.call(row.querySelectorAll('[data-act]'), function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        var slot = findSlot(id);
        if (!slot) return;

        if (act === 'link') {
          copy(inviteLink(slot)).then(function () { toast('Nakopya ang link.'); });
        } else if (act === 'msg') {
          copy(inviteMessage(slot)).then(function () { toast('Nakopya ang buong mensahe — i-paste sa Messenger o Viber.'); });
        } else if (act === 'share') {
          if (navigator.share) {
            navigator.share({ title: 'Imbitasyon', text: inviteMessage(slot) }).catch(function () {});
          } else {
            copy(inviteMessage(slot)).then(function () { toast('Walang share dito — nakopya na lang ang mensahe.'); });
          }
        } else if (act === 'reset') {
          if (!confirm('I-reset ang sagot ni ' + (slot.guestName || 'bisita') + '? Mabubura ang confirmation.')) return;
          api('/slots/' + id + '/reset', { method: 'POST' }).then(load).then(function () { toast('Na-reset.'); }).catch(fail);
        } else if (act === 'token') {
          if (!confirm('Gagawa ng bagong link. Hindi na gagana ang lumang link na naipadala mo. Tuloy?')) return;
          api('/slots/' + id + '/token', { method: 'POST' }).then(load).then(function () { toast('Bagong link na ang slot.'); }).catch(fail);
        } else if (act === 'del') {
          if (!confirm('Alisin ang ' + slot.label + '?')) return;
          api('/slots/' + id, { method: 'DELETE' }).then(load).then(function () { toast('Naalis.'); }).catch(fail);
        }
      });
    });
  }

  /* --------------------------------------------------------------- forms */

  $('eventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate', 'startTime',
      'venue', 'dressCode', 'rsvpDeadline', 'hostName', 'note'].forEach(function (f) {
      body[f] = $('ev-' + f).value;
    });
    api('/events', { method: 'POST', body: body }).then(function (ev) {
      state.eventId = ev.id;
      $('eventForm').reset();
      return load();
    }).then(function () { toast('Nagawa na ang event.'); }).catch(fail);
  });

  $('detailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate', 'startTime',
      'venue', 'dressCode', 'rsvpDeadline', 'hostName', 'note'].forEach(function (f) {
      body[f] = $('d-' + f).value;
    });
    api('/events/' + state.eventId, { method: 'PATCH', body: body })
      .then(load).then(function () { toast('Na-update ang detalye.'); }).catch(fail);
  });

  $('deleteEventBtn').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    if (!confirm('Burahin ang "' + ev.title + '" kasama ang lahat ng upuan at sagot? Hindi na ito maibabalik.')) return;
    api('/events/' + ev.id, { method: 'DELETE' }).then(function () {
      state.eventId = '';
      return load();
    }).then(function () { toast('Nabura ang event.'); }).catch(fail);
  });

  $('slotForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {
      table: $('s-table').value,
      count: $('s-count').value,
      startAt: $('s-startAt').value,
    };
    api('/events/' + state.eventId + '/slots', { method: 'POST', body: body })
      .then(function (res) {
        var made = (res.created || []).length;
        $('s-startAt').value = String(Number(body.startAt || 1) + made);
        return load().then(function () { toast('Nadagdag ang ' + made + ' upuan.'); });
      }).catch(fail);
  });

  /* ------------------------------------------------------------ controls */

  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-filter]'), function (chip) {
    chip.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.chip[data-filter]'), function (c) {
        c.classList.remove('active');
      });
      chip.classList.add('active');
      state.filter = chip.getAttribute('data-filter');
      renderSlots();
    });
  });

  $('search').addEventListener('input', function () {
    state.search = $('search').value.trim();
    renderSlots();
  });

  $('baseUrl').addEventListener('input', function () {
    try { localStorage.setItem(BASE_STORE, $('baseUrl').value.trim()); } catch (e) { /* ignore */ }
    $('baseSample').textContent = baseUrl() + '/i/xxxxxxx';
  });

  $('refreshBtn').addEventListener('click', function () { load(); });

  /* Poll so a guest's answer shows up without touching anything — but never
     while a field is being edited, or the typing would be wiped out. */
  setInterval(function () {
    if (!state.key) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    load();
  }, 15000);

  /* ----------------------------------------------------------- bootstrap */

  try {
    var savedBase = localStorage.getItem(BASE_STORE);
    if (savedBase) $('baseUrl').value = savedBase;
  } catch (e) { /* ignore */ }
  $('baseSample').textContent = baseUrl() + '/i/xxxxxxx';

  var saved = null;
  try { saved = localStorage.getItem(KEY_STORE); } catch (e) { /* ignore */ }
  if (saved) {
    unlock(saved).catch(function () { $('gateKey').focus(); });
  } else {
    $('gateKey').focus();
  }
})();
