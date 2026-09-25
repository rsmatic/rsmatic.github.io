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
    detailDirty: false,
    pausedMessageDirty: false,
    lastSnapshot: '',
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------- helpers */

  /* Formatting, sorting and the seat rows themselves live in app/board.js,
     shared with the coordinator page so the two boards stay identical. */
  var B = window.AbyBoard;
  var escapeHtml = B.escapeHtml;
  var formatDate = B.formatDate;
  var formatTime = B.formatTime;
  var compareSlots = B.compareSlots;
  var copy = B.copyText;

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

  function inviteLink(slot) { return baseUrl() + 'invitation?t=' + slot.token; }

  function refreshLinkNotes() {
    var sample = $('baseSample');
    if (sample) sample.textContent = baseUrl() + 'invitation?t=xxxxxxxxxxxxx';
    var note = $('apiNote');
    if (note) note.textContent = apiBase() || window.location.origin + '  (same origin)';
  }


  function currentEvent() {
    for (var i = 0; i < state.events.length; i += 1) {
      if (state.events[i].id === state.eventId) return state.events[i];
    }
    return null;
  }

  function inviteMessage(slot) {
    return B.inviteMessage(currentEvent(), slot, inviteLink(slot), eventSlots());
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
    window.abyApplyTheme(ev ? ev.theme : '');
    $('eventScope').classList.toggle('hidden', !ev);
    if (!ev) return;
    renderThemes(ev);
    renderDesign(ev);
    renderCoordinator(ev);
    renderPause(ev);
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
        '<span class="meta">' + escapeHtml(formatDate(ev.eventDate)) + ' &middot; ' + count + ' seats' +
          (ev.inviteStatus === 'paused' ? ' &middot; links paused' : '') + '</span>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('[data-event]'), function (btn) {
      btn.addEventListener('click', function () {
        state.eventId = btn.getAttribute('data-event');
        state.detailDirty = false;
        state.pausedMessageDirty = false;
        render();
      });
    });
  }

  /* Swatch colours come from app/themes.js, never from stored data, so they
     are safe to drop straight into a style attribute. */
  function themeCard(t, current) {
    return '<button type="button" class="theme-card' + (t.id === current ? ' active' : '') +
      '" data-theme-id="' + escapeHtml(t.id) + '">' +
      '<span class="preview" style="background:' + t.swatch[0] + '">' +
        '<span class="dot" style="background:' + t.swatch[1] + '"></span>' +
        '<span class="dot" style="background:' + t.swatch[2] + '"></span>' +
        '<span class="bar" style="background:' + t.swatch[1] + '"></span>' +
      '</span>' +
      '<span class="meta">' +
        (t.id === current ? '<span class="tcheck">&#10003;</span>' : '') +
        '<span class="tname">' + escapeHtml(t.name) + '</span>' +
        '<span class="tnote">' + escapeHtml(t.note) + '</span>' +
      '</span></button>';
  }

  function renderThemes(ev) {
    var host = $('themeGrid');
    var current = ev.theme || window.ABY_DEFAULT_THEME;

    host.innerHTML = window.ABY_THEME_GROUPS.map(function (group) {
      var items = window.ABY_THEMES.filter(function (t) { return t.group === group.id; });
      if (!items.length) return '';
      return '<div class="theme-group">' + escapeHtml(group.name) + '</div>' +
        '<div class="theme-row">' + items.map(function (t) { return themeCard(t, current); }).join('') + '</div>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('[data-theme-id]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-theme-id');
        if (id === current) return;
        window.abyApplyTheme(id); // show it immediately, then save
        api('/events/' + ev.id, { method: 'PATCH', body: { theme: id } })
          .then(load)
          .then(function () { toast('Theme saved.'); })
          .catch(function (err) { window.abyApplyTheme(current); fail(err); });
      });
    });
  }

  var UNSAVED = '  \u2022  unsaved changes';

  function markDetailDirty() {
    if (state.detailDirty) return;
    state.detailDirty = true;
    var summary = $('detailSummary');
    if (summary && summary.textContent.indexOf(UNSAVED) < 0) summary.textContent += UNSAVED;
  }

  /* The board reloads every 15 seconds. Refilling the form on every reload
     would throw away edits made since the last save — which is exactly what
     happened to the age setting: pick "Hide it", wait, and the reload put
     "Show the age" back before Save was ever pressed. */
  var DESIGN_CHOICES = ['photoShape', 'photoSize', 'borderStyle', 'cardCorners', 'cardAlign'];
  var DESIGN_FALLBACK = {
    photoShape: 'circle', photoSize: 'medium', borderStyle: 'double',
    cardCorners: 'soft', cardAlign: 'center',
  };

  function themeSwatch(id) {
    for (var i = 0; i < window.ABY_THEMES.length; i += 1) {
      if (window.ABY_THEMES[i].id === id) return window.ABY_THEMES[i].swatch;
    }
    return ['#170e14', '#e7c27d', '#e9a6b8'];
  }

  /* Every control here saves on change, so there is nothing to press and
     nothing to lose — and the console repaints itself as the preview. */
  function renderDesign(ev) {
    DESIGN_CHOICES.forEach(function (field) {
      var el = $('dz-' + field);
      if (el && document.activeElement !== el) el.value = ev[field] || DESIGN_FALLBACK[field];
    });

    var swatch = themeSwatch(ev.theme || window.ABY_DEFAULT_THEME);
    var accent = $('dz-accentColor');
    if (accent && document.activeElement !== accent) accent.value = ev.accentColor || swatch[1];
    var border = $('dz-borderColor');
    if (border && document.activeElement !== border) border.value = ev.borderColor || swatch[1];

    window.abyApplyColors(ev.accentColor, ev.borderColor);
    renderPhoto(ev);
  }

  function saveDesign(field, value) {
    var ev = currentEvent();
    if (!ev) return;
    var body = {};
    body[field] = value;
    api('/events/' + ev.id, { method: 'PATCH', body: body })
      .then(load)
      .then(function () { toast('Design saved.'); })
      .catch(fail);
  }

  /* ---- photo ---- */

  var photoObjectUrl = null;
  var photoShowing = '';   // eventId|photoUpdatedAt currently on screen

  function renderPhoto(ev) {
    var key = ev.id + '|' + (ev.photoUpdatedAt || '');
    if (key === photoShowing) return;
    photoShowing = key;

    var box = $('photoPreview');
    var img = $('photoImg');
    if (photoObjectUrl) { URL.revokeObjectURL(photoObjectUrl); photoObjectUrl = null; }

    if (!ev.photoUpdatedAt) {
      box.classList.remove('has');
      img.removeAttribute('src');
      $('photoRemove').classList.add('hidden');
      return;
    }

    $('photoRemove').classList.remove('hidden');
    // An <img> cannot carry the admin key, so fetch the bytes and show a blob.
    fetch(apiBase() + '/api/events/' + ev.id + '/photo', { headers: { 'x-admin-key': state.key } })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        photoObjectUrl = URL.createObjectURL(blob);
        img.src = photoObjectUrl;
        box.classList.add('has');
      })
      .catch(function () { /* the preview is optional */ });
  }

  /* Shrinking on the phone keeps the upload small and the stored row modest. */
  function shrinkImage(file, maxEdge) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('That file could not be read.')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('That file is not an image.')); };
        img.onload = function () {
          var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ---- coordinator access ---- */

  function coordinatorPageUrl() {
    return baseUrl() + 'coordinator';
  }

  function renderCoordinator(ev) {
    var has = Boolean(ev.coordinatorKey);
    $('coordNone').classList.toggle('hidden', has);
    $('coordHas').classList.toggle('hidden', !has);
    if (!has) return;
    $('coordKey').value = ev.coordinatorKey;
    $('coordLink').value = coordinatorPageUrl();
  }

  function issueCoordinatorKey(message) {
    var ev = currentEvent();
    if (!ev) return;
    api('/events/' + ev.id + '/coordinator', { method: 'POST' })
      .then(load)
      .then(function () { toast(message); })
      .catch(fail);
  }

  /* ---- pausing the links ---- */

  function renderPause(ev) {
    var paused = ev.inviteStatus === 'paused';
    $('pausePanel').classList.toggle('is-paused', paused);
    $('pausedBanner').classList.toggle('hidden', !paused);
    $('pauseState').textContent = paused
      ? 'Paused — guests see only the message below.'
      : 'Open — guests can see the invitation and answer.';
    var btn = $('pauseToggle');
    btn.textContent = paused ? 'Open the links' : 'Pause all links';
    btn.className = paused ? 'primary' : 'danger';

    // Same reason as the details form: a reload must not eat an unsaved edit.
    var box = $('pausedMessage');
    if (!state.pausedMessageDirty && document.activeElement !== box) box.value = ev.pausedMessage || '';
  }

  function fillDetailForm(ev) {
    if (state.detailDirty) return;
    var map = {
      'd-title': ev.title, 'd-celebrant': ev.celebrant, 'd-nickname': ev.nickname,
      'd-birthDate': ev.birthDate, 'd-eventDate': ev.eventDate, 'd-startTime': ev.startTime,
      'd-venue': ev.venue, 'd-venueMapUrl': ev.venueMapUrl, 'd-dressCode': ev.dressCode,
      'd-rsvpDeadline': ev.rsvpDeadline,
      'd-hostName': ev.hostName, 'd-note': ev.note,
      'd-ageDisplay': ev.ageDisplay || 'number', 'd-ageLabel': ev.ageLabel,
      'd-seatDisplay': ev.seatDisplay || 'full',
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (el && document.activeElement !== el) el.value = map[id] || '';
    });
    $('detailSummary').textContent = ev.title + ' — ' + formatDate(ev.eventDate);
  }

  function eventSlots() {
    return state.slots
      .filter(function (s) { return s.eventId === state.eventId; })
      .sort(compareSlots);
  }

  function renderStats() {
    B.renderStats($('stats'), eventSlots());
  }

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

    B.renderSlots({
      host: host,
      slots: slots,
      all: all,
      emptyText: all.length ? 'Nothing matches this filter.' : '',
      allowRemove: true,
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
      remove: function (slot) {
        return api('/slots/' + slot.id, { method: 'DELETE' }).then(load);
      },
      done: function (message) { toast(message); },
      error: fail,
    });
  }

  /* --------------------------------------------------------------- forms */

  $('eventForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {};
    ['title', 'celebrant', 'nickname', 'birthDate', 'eventDate', 'startTime',
      'venue', 'venueMapUrl', 'dressCode', 'rsvpDeadline', 'hostName', 'note',
      'ageDisplay', 'ageLabel', 'seatDisplay'].forEach(function (f) {
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
      'venue', 'venueMapUrl', 'dressCode', 'rsvpDeadline', 'hostName', 'note',
      'ageDisplay', 'ageLabel', 'seatDisplay'].forEach(function (f) {
      body[f] = $('d-' + f).value;
    });
    api('/events/' + state.eventId, { method: 'PATCH', body: body })
      .then(function () {
        state.detailDirty = false;
        return load();
      })
      .then(function () { toast('Details updated.'); })
      .catch(fail);
  });

  $('pauseToggle').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    var pausing = ev.inviteStatus !== 'paused';
    var body = { inviteStatus: pausing ? 'paused' : 'open' };
    // Pausing with a message typed but not saved should use that message.
    if (pausing && state.pausedMessageDirty) body.pausedMessage = $('pausedMessage').value;
    api('/events/' + ev.id, { method: 'PATCH', body: body })
      .then(function () {
        if ('pausedMessage' in body) state.pausedMessageDirty = false;
        return load();
      })
      .then(function () {
        toast(pausing ? 'Links paused. Guests now see your message.' : 'Links are open again.');
      })
      .catch(fail);
  });

  $('pausedMessage').addEventListener('input', function () { state.pausedMessageDirty = true; });

  $('pausedMessageSave').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    api('/events/' + ev.id, { method: 'PATCH', body: { pausedMessage: $('pausedMessage').value } })
      .then(function () {
        state.pausedMessageDirty = false;
        return load();
      })
      .then(function () { toast('Message saved.'); })
      .catch(fail);
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

  DESIGN_CHOICES.concat(['accentColor', 'borderColor']).forEach(function (field) {
    var el = $('dz-' + field);
    if (el) el.addEventListener('change', function () { saveDesign(field, el.value); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-clear]'), function (btn) {
    btn.addEventListener('click', function () { saveDesign(btn.getAttribute('data-clear'), ''); });
  });

  $('coordCreate').addEventListener('click', function () {
    issueCoordinatorKey('Coordinator key created.');
  });

  $('coordRotate').addEventListener('click', function () {
    if (!confirm('Replace the coordinator key? Whoever is using the old one will be signed out.')) return;
    issueCoordinatorKey('New coordinator key issued.');
  });

  $('coordRevoke').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    if (!confirm('Revoke coordinator access? The page will stop working for them.')) return;
    api('/events/' + ev.id + '/coordinator', { method: 'DELETE' })
      .then(load)
      .then(function () { toast('Coordinator access revoked.'); })
      .catch(fail);
  });

  $('coordCopyKey').addEventListener('click', function () {
    copy($('coordKey').value).then(function () { toast('Key copied.'); });
  });

  $('coordCopyLink').addEventListener('click', function () {
    copy($('coordLink').value).then(function () { toast('Page link copied.'); });
  });

  $('coordCopyBoth').addEventListener('click', function () {
    var ev = currentEvent();
    var text = [
      'Here is your coordinator access for ' + (ev ? ev.title : 'the event') + '.',
      '',
      'Page: ' + $('coordLink').value,
      'Key:  ' + $('coordKey').value,
      '',
      'Please keep the key to yourself.',
    ].join('\n');
    copy(text).then(function () { toast('Message copied — paste it to your coordinator.'); });
  });

  $('photoPick').addEventListener('click', function () { $('photoInput').click(); });

  $('photoInput').addEventListener('change', function () {
    var input = $('photoInput');
    var file = input.files && input.files[0];
    var ev = currentEvent();
    if (!file || !ev) return;

    toast('Preparing the photo…');
    shrinkImage(file, 900)
      .then(function (dataUrl) {
        return api('/events/' + ev.id + '/photo', { method: 'PUT', body: { dataUrl: dataUrl } });
      })
      .then(function () {
        photoShowing = '';
        return load();
      })
      .then(function () { toast('Photo uploaded.'); })
      .catch(fail)
      .then(function () { input.value = ''; });
  });

  $('photoRemove').addEventListener('click', function () {
    var ev = currentEvent();
    if (!ev) return;
    if (!confirm('Remove the photo from the invitation?')) return;
    api('/events/' + ev.id + '/photo', { method: 'DELETE' })
      .then(function () { photoShowing = ''; return load(); })
      .then(function () { toast('Photo removed.'); })
      .catch(fail);
  });

  $('detailForm').addEventListener('input', markDetailDirty);
  $('detailForm').addEventListener('change', markDetailDirty);

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
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
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
