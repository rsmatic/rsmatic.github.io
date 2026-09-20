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

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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

  /** True when this page can reach an API at all. */
  function apiConfigured() {
    if (apiBase()) return true;
    var host = window.location.hostname;
    // An empty api only works when a local server is serving this page too.
    return host === 'localhost' || host === '127.0.0.1' || host === '';
  }

  /** Where the API lives: the Worker URL from app/config.js, or this origin. */
  function apiBase() {
    var cfg = window.ABY_CONFIG || {};
    return String(cfg.api || '').trim().replace(/\/+$/, '');
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
    return fetch(apiBase() + '/api' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
        return data;
      });
    }, function () {
      throw new Error('Cannot reach the API' + (apiBase() ? ' at ' + apiBase() : '') +
        '. Check app/config.js.');
    });
  }

  function fail(err) { toast(err.message, true); }

  /** The folder this page sits in — e.g. https://rsmatic.github.io/booking/ */
  function pageBase() {
    return window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  }

  function baseUrl() {
    var typed = ($('baseUrl').value || '').trim();
    return (typed || pageBase()).replace(/\/+$/, '') + '/';
  }

  function inviteLink(slot) { return baseUrl() + 'i.html?t=' + slot.token; }

  function refreshLinkNotes() {
    var sample = $('baseSample');
    if (sample) sample.textContent = baseUrl() + 'i.html?t=xxxxxxxxxxxxx';
    var note = $('apiNote');
    if (note) note.textContent = apiBase() || window.location.origin + '  (same origin)';
  }

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
    var who = slot.guestName || 'Friend';
    var when = formatDate(ev.eventDate) + (ev.startTime ? ', ' + formatTime(ev.startTime) : '');
    var lines = [
      'Hi ' + who + '!',
      '',
      'You are invited to ' + ev.title + (ev.celebrant ? ' for ' + ev.celebrant : '') + '.',
      'Date: ' + when,
    ];
    if (ev.venue) lines.push('Venue: ' + ev.venue);
    if (ev.dressCode) lines.push('Dress code: ' + ev.dressCode);
    lines.push('Reserved for you: ' + slot.label);
    lines.push('');
    lines.push('Please let us know here if you can make it:');
    lines.push(inviteLink(slot));
    return lines.join('\n');
  }

  /* --------------------------------------------------------------- gate */

  function unlock(key) {
    return fetch(apiBase() + '/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key }),
    }).then(function (res) {
      if (res.status === 401) throw new Error('Wrong admin key.');
      if (!res.ok) throw new Error('The API did not respond (' + res.status + '). Check app/config.js.');
      state.key = key;
      try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* private mode */ }
      $('gate').classList.add('hidden');
      $('app').classList.remove('hidden');
      return load();
    }, function () {
      throw new Error(apiBase()
        ? 'Cannot reach the API at ' + apiBase() + '. Is the Worker deployed?'
        : 'No API configured. Set api in app/config.js, or run node server/server.js.');
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
      $('syncNote').textContent = 'Last sync ' + new Date().toLocaleTimeString();
    }).catch(fail);
  }

  /* ------------------------------------------------------------- render */

  function render() {
    renderEvents();
    var ev = currentEvent();
    $('eventScope').classList.toggle('hidden', !ev);
    if (!ev) return;
    fillDetailForm(ev);
    refreshLinkNotes();
    renderStats();
    renderSlots();
  }

  function renderEvents() {
    var host = $('eventList');
    if (!state.events.length) {
      host.innerHTML = '<p class="muted small">No events yet. Create one below.</p>';
      return;
    }
    host.innerHTML = state.events.map(function (ev) {
      var count = state.slots.filter(function (s) { return s.eventId === ev.id; }).length;
      return '<button type="button" class="event-card' + (ev.id === state.eventId ? ' active' : '') +
        '" data-event="' + escapeHtml(ev.id) + '">' +
        '<span class="name">' + escapeHtml(ev.title) + '</span>' +
        '<span class="meta">' + escapeHtml(formatDate(ev.eventDate)) + ' &middot; ' + count + ' seats</span>' +
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
      { k: 'Total seats', n: slots.length, cls: '' },
      { k: 'Confirmed', n: by('confirmed'), cls: 'ok' },
      { k: 'Awaiting reply', n: by('invited'), cls: 'wait' },
      { k: 'Not coming', n: by('declined'), cls: 'no' },
      { k: 'Open', n: by('open'), cls: 'open' },
    ];
    $('stats').innerHTML = cards.map(function (c) {
      return '<div class="stat ' + c.cls + '"><div class="n">' + c.n + '</div><div class="k">' + c.k + '</div></div>';
    }).join('');
  }

  var STATUS_LABEL = {
    open: 'Open', invited: 'Awaiting reply', confirmed: 'Confirmed', declined: 'Not coming',
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
    $('deleteAllSlotsBtn').classList.toggle('hidden', all.length === 0);

    if (!slots.length) {
      host.innerHTML = all.length
        ? '<p class="muted small">Nothing matches this filter.</p>'
        : '';
      return;
    }

    host.innerHTML = slots.map(function (s) {
      var note = '';
      if (s.status === 'declined') {
        note = '<div class="note declined"><b>Reason:</b> ' + escapeHtml(s.reason || '—') +
          '<br><b>Answered:</b> ' + escapeHtml(new Date(s.respondedAt).toLocaleString()) + '</div>';
      } else if (s.status === 'confirmed') {
        note = '<div class="note confirmed"><b>Seat locked.</b> Answered on ' +
          escapeHtml(new Date(s.respondedAt).toLocaleString()) +
          (s.message ? '<br><b>Message:</b> ' + escapeHtml(s.message) : '') + '</div>';
      }
      return '<div class="slot ' + s.status + '" data-slot="' + escapeHtml(s.id) + '">' +
        '<div class="seat">' + escapeHtml(s.seat) + '<small>' + escapeHtml(s.table) + '</small></div>' +
        '<div><input data-field="guestName" placeholder="Guest name" value="' + escapeHtml(s.guestName) + '" /></div>' +
        '<div><input data-field="guestContact" placeholder="Viber / FB (optional)" value="' + escapeHtml(s.guestContact || '') + '" /></div>' +
        '<div class="actions">' +
          '<span class="badge ' + s.status + '">' + STATUS_LABEL[s.status] + '</span>' +
          '<button class="tiny" data-act="link" type="button" ' + (s.guestName ? '' : 'disabled') + '>Copy link</button>' +
          '<button class="tiny" data-act="msg" type="button" ' + (s.guestName ? '' : 'disabled') + '>Message</button>' +
          '<button class="tiny ghost" data-act="share" type="button" ' + (s.guestName ? '' : 'disabled') + '>Share</button>' +
          '<button class="tiny ghost" data-act="reset" type="button" ' + (s.respondedAt ? '' : 'disabled') + '>Reset</button>' +
          '<button class="tiny ghost" data-act="token" type="button">New link</button>' +
          '<button class="tiny danger" data-act="del" type="button">Remove</button>' +
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
          .then(function () { toast('Saved.'); })
          .catch(fail);
      });
    });

    Array.prototype.forEach.call(row.querySelectorAll('[data-act]'), function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        var slot = findSlot(id);
        if (!slot) return;

        if (act === 'link') {
          copy(inviteLink(slot)).then(function () { toast('Link copied.'); });
        } else if (act === 'msg') {
          copy(inviteMessage(slot)).then(function () { toast('Full message copied — paste it into Messenger or Viber.'); });
        } else if (act === 'share') {
          if (navigator.share) {
            navigator.share({ title: 'Imbitasyon', text: inviteMessage(slot) }).catch(function () {});
          } else {
            copy(inviteMessage(slot)).then(function () { toast('Sharing is not available here — the message was copied instead.'); });
          }
        } else if (act === 'reset') {
          if (!confirm('Reset the answer from ' + (slot.guestName || 'this guest') + '? Their confirmation will be erased.')) return;
          api('/slots/' + id + '/reset', { method: 'POST' }).then(load).then(function () { toast('Answer reset.'); }).catch(fail);
        } else if (act === 'token') {
          if (!confirm('This makes a new link. The old link you already sent will stop working. Continue?')) return;
          api('/slots/' + id + '/token', { method: 'POST' }).then(load).then(function () { toast('The seat has a new link.'); }).catch(fail);
        } else if (act === 'del') {
          if (!confirm('Remove ' + slot.label + '?')) return;
          api('/slots/' + id, { method: 'DELETE' }).then(load).then(function () { toast('Removed.'); }).catch(fail);
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
    }).then(function () { toast('Event created.'); }).catch(fail);
  });

  $('detailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate', 'startTime',
      'venue', 'dressCode', 'rsvpDeadline', 'hostName', 'note'].forEach(function (f) {
      body[f] = $('d-' + f).value;
    });
    api('/events/' + state.eventId, { method: 'PATCH', body: body })
      .then(load).then(function () { toast('Details updated.'); }).catch(fail);
  });

  $('deleteEventBtn').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    if (!confirm('Delete "' + ev.title + '" along with every seat and answer? This cannot be undone.')) return;
    api('/events/' + ev.id, { method: 'DELETE' }).then(function () {
      state.eventId = '';
      return load();
    }).then(function () { toast('Event deleted.'); }).catch(fail);
  });

  /* Clears the whole seating plan but keeps the event. Every link already sent
     dies with the seats, so say so plainly before doing it. */
  $('deleteAllSlotsBtn').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    var slots = eventSlots();
    if (!slots.length) return;

    var answered = slots.filter(function (s) { return s.respondedAt; }).length;
    var confirmed = slots.filter(function (s) { return s.status === 'confirmed'; }).length;

    var warning = 'Delete all ' + slots.length + ' seats from "' + ev.title + '"?\n\n';
    if (answered) {
      warning += confirmed + ' guest(s) already confirmed and ' + (answered - confirmed) +
        ' declined. Their answers will be erased.\n\n';
    }
    warning += 'Every invitation link you have already sent will stop working.\n' +
      'This cannot be undone.';
    if (!confirm(warning)) return;

    if (answered && !confirm('Last check: ' + answered + ' guest(s) have already replied. Still delete?')) {
      return;
    }

    api('/events/' + ev.id + '/slots', { method: 'DELETE' })
      .then(function (res) {
        return load().then(function () {
          toast('Deleted ' + res.removed + ' seats.');
        });
      })
      .catch(fail);
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
        return load().then(function () { toast('Added ' + made + ' seats.'); });
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
    refreshLinkNotes();
  });

  $('refreshBtn').addEventListener('click', function () { load(); });

  /* One file with every event, seat and answer — your offline backup. */
  $('exportBtn').addEventListener('click', function () {
    api('/export').then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'aby41-db-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('JSON backup downloaded.');
    }).catch(fail);
  });

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
  refreshLinkNotes();

  if (!apiConfigured()) {
    var gateErr = $('gateError');
    gateErr.innerHTML = 'No API configured yet.<br>Set <b>api</b> in <code>app/config.js</code> to the ' +
      'Cloudflare Worker URL, then commit and push.';
    gateErr.classList.remove('hidden');
    $('gateKey').disabled = true;
    $('gateForm').querySelector('button').disabled = true;
    return;
  }

  var saved = null;
  try { saved = localStorage.getItem(KEY_STORE); } catch (e) { /* ignore */ }
  if (saved) {
    unlock(saved).catch(function () { $('gateKey').focus(); });
  } else {
    $('gateKey').focus();
  }
})();
