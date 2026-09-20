/* ===========================================================
   Coordinator page — the guest list and nothing else.

   A coordinator can name seats, send invitations, reissue a
   link and undo an answer. They cannot touch the event, its
   design, the seating plan itself, or the admin key.
   =========================================================== */

(function () {
  'use strict';

  var KEY_STORE = 'aby41.coordinatorKey';
  var B = window.AbyBoard;

  var state = { key: '', event: null, slots: [], filter: 'all', search: '' };

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- helpers */

  var toastTimer;
  function toast(message, isError) {
    var el = $('toast');
    el.textContent = message;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2800);
  }

  function fail(err) { toast(err.message, true); }

  function apiBase() {
    var cfg = window.ABY_CONFIG || {};
    return String(cfg.api || '').trim().replace(/\/+$/, '');
  }

  function apiConfigured() {
    if (apiBase()) return true;
    var host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '';
  }

  function api(path, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      headers: { 'x-coordinator-key': state.key },
    };
    if (options.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    return fetch(apiBase() + '/api/coordinator' + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
        return data;
      });
    }, function () {
      throw new Error('Cannot reach the API' + (apiBase() ? ' at ' + apiBase() : '') + '.');
    });
  }

  /** The guest opens i.html next to this page. */
  function pageBase() {
    return window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  }

  function inviteLink(slot) { return pageBase() + 'i.html?t=' + slot.token; }
  function inviteMessage(slot) { return B.inviteMessage(state.event, slot, inviteLink(slot)); }

  /* --------------------------------------------------------------- gate */

  function unlock(key) {
    return fetch(apiBase() + '/api/coordinator/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: key }),
    }).then(function (res) {
      if (res.status === 401) throw new Error('Wrong coordinator key.');
      if (!res.ok) throw new Error('The API did not respond (' + res.status + ').');
      state.key = key;
      try { localStorage.setItem(KEY_STORE, key); } catch (e) { /* private mode */ }
      $('gate').classList.add('hidden');
      $('app').classList.remove('hidden');
      return load();
    }, function () {
      throw new Error(apiBase()
        ? 'Cannot reach the API at ' + apiBase() + '.'
        : 'No API configured. Ask the host to check app/config.js.');
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
    return api('/board').then(function (data) {
      state.event = data.event || null;
      state.slots = (data.slots || []).slice().sort(B.compareSlots);
      render();
      $('syncNote').textContent = 'Last sync ' + new Date().toLocaleTimeString();
    }).catch(fail);
  }

  /* ------------------------------------------------------------- render */

  function render() {
    var ev = state.event;
    if (!ev) return;

    window.abyApplyTheme(ev.theme);

    $('ev-name').textContent = ev.title;
    var bits = [B.formatDate(ev.eventDate)];
    if (ev.startTime) bits.push(B.formatTime(ev.startTime));
    if (ev.venue) bits.push(ev.venue);
    if (ev.dressCode) bits.push('Dress code: ' + ev.dressCode);
    $('ev-meta').textContent = bits.join('  ·  ');

    B.renderStats($('stats'), state.slots);
    renderSlots();
  }

  function renderSlots() {
    var needle = state.search.toLowerCase();
    var slots = state.slots.filter(function (s) {
      if (state.filter !== 'all' && s.status !== state.filter) return false;
      if (!needle) return true;
      return (s.guestName + ' ' + s.label + ' ' + (s.guestContact || ''))
        .toLowerCase().indexOf(needle) >= 0;
    });

    $('emptySlots').classList.toggle('hidden', state.slots.length > 0);

    B.renderSlots({
      host: $('slotList'),
      slots: slots,
      emptyText: state.slots.length ? 'Nothing matches this filter.' : '',
      allowRemove: false,
      link: inviteLink,
      message: inviteMessage,
      save: function (id, patch) {
        return api('/slots/' + id, { method: 'PATCH', body: patch }).then(load);
      },
      reset: function (id) {
        return api('/slots/' + id + '/reset', { method: 'POST' }).then(load);
      },
      newLink: function (id) {
        return api('/slots/' + id + '/token', { method: 'POST' }).then(load);
      },
      done: function (message) { toast(message); },
      error: fail,
    });
  }

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

  $('refreshBtn').addEventListener('click', function () { load(); });

  /* Answers arrive while this page is open, so refresh — but never while a
     field is being edited, or the typing would be wiped out. */
  setInterval(function () {
    if (!state.key) return;
    var active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    load();
  }, 15000);

  /* ----------------------------------------------------------- bootstrap */

  if (!apiConfigured()) {
    $('gateError').textContent = 'This page is not set up yet. Please tell the host.';
    $('gateError').classList.remove('hidden');
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
