/* ===========================================================
   Guest invitation page — opened from the link sent over
   Messenger or Viber. One seat, one token, one answer.
   =========================================================== */

(function () {
  'use strict';

  /** Where the API lives: the Worker URL from app/config.js, or this origin. */
  function apiBase() {
    var cfg = window.ABY_CONFIG || {};
    return String(cfg.api || '').trim().replace(/[/]+$/, '');
  }

  /* The link may arrive as ?t=TOKEN, #TOKEN, or /i/TOKEN — accept all three. */
  function readToken() {
    var q = new URLSearchParams(window.location.search).get('t');
    if (q) return q.trim();
    var hash = window.location.hash.replace(/^#/, '').trim();
    if (hash) return decodeURIComponent(hash);
    var m = window.location.pathname.match(/[/]i[/]([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  var token = readToken();
  var slot = null;
  var choice = null; // true = attending, false = not

  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function parseDate(iso) {
    if (!iso) return null;
    var p = String(iso).split('-');
    if (p.length !== 3) return null;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' &middot; ' + DAYS[d.getDay()];
  }

  function formatShortDate(iso) {
    var d = parseDate(iso);
    if (!d) return '';
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatTime(hhmm) {
    if (!hhmm) return '';
    var bits = String(hhmm).split(':');
    var h = Number(bits[0]);
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (bits[1] || '00') + ' ' + suffix;
  }

  /** 41 -> "41st", 12 -> "12th". */
  function ordinal(n) {
    var lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return n + 'th';
    if (n % 10 === 1) return n + 'st';
    if (n % 10 === 2) return n + 'nd';
    if (n % 10 === 3) return n + 'rd';
    return n + 'th';
  }

  function ageAt(birthIso, eventIso) {
    var b = parseDate(birthIso);
    var e = parseDate(eventIso);
    if (!b || !e) return null;
    var age = e.getFullYear() - b.getFullYear();
    var beforeBirthday = e.getMonth() < b.getMonth() ||
      (e.getMonth() === b.getMonth() && e.getDate() < b.getDate());
    if (beforeBirthday) age -= 1;
    return age >= 0 ? age : null;
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
    toastTimer = setTimeout(function () { el.className = ''; }, 3200);
  }

  function show(id) {
    ['loading', 'invalid', 'card'].forEach(function (k) {
      $(k).classList.toggle('hidden', k !== id);
    });
  }

  /* ------------------------------------------------------------- render */

  function renderEvent() {
    var ev = slot.event;
    var age = ageAt(ev.birthDate, ev.eventDate);

    window.abyApplyTheme(ev.theme);
    window.abyApplyColors(ev.accentColor, ev.borderColor);

    var card = $('card');
    card.setAttribute('data-border', ev.borderStyle || 'double');
    card.setAttribute('data-corners', ev.cardCorners || 'soft');
    card.setAttribute('data-align', ev.cardAlign || 'center');
    card.setAttribute('data-photo-shape', ev.photoShape || 'circle');
    card.setAttribute('data-photo-size', ev.photoSize || 'medium');

    // ?v=<updatedAt> makes a new upload a new URL, so the photo can be
    // cached hard without ever going stale.
    var photoWrap = $('c-photo-wrap');
    if (ev.photoUpdatedAt) {
      $('c-photo').src = apiBase() + '/api/invite/' + encodeURIComponent(token) +
        '/photo?v=' + encodeURIComponent(ev.photoUpdatedAt);
      $('c-photo').alt = ev.celebrant || ev.title || '';
      photoWrap.classList.remove('hidden');
    } else {
      $('c-photo').removeAttribute('src');
      photoWrap.classList.add('hidden');
    }

    $('c-eyebrow').textContent = 'You are invited to';

    // The host chooses what stands above the name: the age, their own
    // wording in its place, or nothing at all.
    var mode = ev.ageDisplay || 'number';
    var ownWording = String(ev.ageLabel || '').trim();
    var showsAge = mode === 'number' && age !== null;
    var ageEl = $('c-age');

    ageEl.classList.remove('word');
    if (showsAge) {
      ageEl.textContent = String(age);
      ageEl.classList.remove('hidden');
    } else if (mode === 'custom' && ownWording) {
      ageEl.textContent = ownWording;
      ageEl.classList.add('word');
      ageEl.classList.remove('hidden');
    } else {
      ageEl.textContent = '';
      ageEl.classList.add('hidden');
    }

    $('c-name').textContent = ev.celebrant || ev.title;

    var whose = ev.nickname ? ev.nickname + "'s " : '';
    if (showsAge) {
      $('c-sub').textContent = whose + ordinal(age) + ' Birthday Celebration';
    } else if (whose) {
      $('c-sub').textContent = whose + 'Birthday Celebration';
    } else {
      $('c-sub').textContent = ev.title;
    }

    var facts = [];
    if (ev.eventDate) facts.push(['Date', formatDate(ev.eventDate)]);
    if (ev.startTime) facts.push(['Time', escapeHtml(formatTime(ev.startTime))]);
    if (ev.venue) facts.push(['Venue', escapeHtml(ev.venue)]);
    if (ev.dressCode) facts.push(['Dress code', escapeHtml(ev.dressCode)]);
    $('c-facts').innerHTML = facts.map(function (f) {
      return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
    }).join('');

    // The server only stores http(s) map links, but this is what turns the
    // value into a clickable href, so check the scheme here as well.
    var mapLink = $('c-map');
    var mapUrl = String(ev.venueMapUrl || '');
    if (/^https?:\/\//i.test(mapUrl)) {
      mapLink.href = mapUrl;
      mapLink.classList.remove('hidden');
    } else {
      mapLink.removeAttribute('href');
      mapLink.classList.add('hidden');
    }

    $('c-guest').textContent = slot.guestName || 'Guest';

    // One person may hold several seats; the invitation shows them as one.
    var seats = (slot.seats && slot.seats.length)
      ? slot.seats
      : [{ table: slot.table, seat: slot.seat, label: slot.label }];

    // The host decides how much of the seating the guest is told.
    var seatMode = ev.seatDisplay || 'full';
    var seatLine = $('c-seat');
    var seatNote = $('c-seatnote');

    seatLine.textContent = seatMode === 'full' ? window.AbyBoard.seatSummary(seats) : '';
    seatLine.classList.toggle('hidden', seatMode !== 'full');

    var noteText = '';
    if (seatMode === 'count') {
      noteText = seats.length + (seats.length > 1 ? ' seats are' : ' seat is') +
        ' reserved in your name.';
    } else if (seatMode === 'full' && seats.length > 1) {
      noteText = seats.length + ' seats are reserved in your name.';
    }
    seatNote.textContent = noteText;
    seatNote.classList.toggle('hidden', !noteText);

    if (ev.note) {
      $('c-note').textContent = ev.note;
      $('c-note').classList.remove('hidden');
    }

    $('footer').textContent = ev.hostName ? 'Hosted by ' + ev.hostName : '';
    document.title = 'Invitation — ' + (ev.title || 'Birthday');
  }

  function renderAsk() {
    $('resultBox').classList.add('hidden');
    $('askBox').classList.remove('hidden');

    var deadline = slot.event.rsvpDeadline;
    $('deadlineNote').textContent = deadline
      ? 'Please reply before ' + formatShortDate(deadline) + '.'
      : 'Please reply so we can prepare your seat.';

    choice = slot.status === 'confirmed' ? true : (slot.status === 'declined' ? false : null);
    $('reason').value = slot.reason || '';
    $('message').value = slot.message || '';
    applyChoice();
  }

  function applyChoice() {
    $('choiceYes').classList.toggle('sel', choice === true);
    $('choiceNo').classList.toggle('sel', choice === false);
    $('reasonBox').classList.toggle('hidden', choice !== false);
    $('messageBox').classList.toggle('hidden', choice !== true);
    $('submitBtn').disabled = choice === null;
  }

  function seatCount(s) { return (s.seats && s.seats.length) || 1; }

  /** Matches what the invitation showed, so the recap never says more. */
  function seatRecap(s) {
    var mode = (s.event && s.event.seatDisplay) || 'full';
    if (mode === 'hidden') return '';
    if (mode === 'count') {
      return '<div><b>Seats:</b> ' + seatCount(s) + '</div>';
    }
    return '<div><b>' + (seatCount(s) > 1 ? 'Seats' : 'Seat') + ':</b> ' +
      escapeHtml(window.AbyBoard.seatSummary(s.seats || [])) + '</div>';
  }

  function renderResult() {
    $('askBox').classList.add('hidden');
    $('resultBox').classList.remove('hidden');

    var attending = slot.status === 'confirmed';
    $('r-icon').innerHTML = attending ? '&#10003;' : '&#9825;';
    $('r-icon').style.color = attending ? 'var(--ok)' : 'var(--no)';
    $('r-title').textContent = attending ? 'Thank you! Your seat is booked.' : 'Thank you for letting us know.';
    $('r-body').textContent = attending
      ? (seatCount(slot) > 1 ? 'Your ' + seatCount(slot) + ' seats are' : 'The seat is') +
        ' held in your name and will not be given to anyone else. See you on ' +
        formatShortDate(slot.event.eventDate) + '!'
      : 'We have noted that you cannot come. We will miss you, but thank you for telling us.';

    var rows = [
      '<div><b>Guest:</b> ' + escapeHtml(slot.guestName || '—') + '</div>',
      seatRecap(slot),
      '<div><b>Answer:</b> ' + (attending ? 'Coming' : 'Not coming') + '</div>',
    ];
    if (!attending && slot.reason) rows.push('<div><b>Reason:</b> ' + escapeHtml(slot.reason) + '</div>');
    if (attending && slot.message) rows.push('<div><b>Your message:</b> ' + escapeHtml(slot.message) + '</div>');
    $('r-recap').innerHTML = rows.join('');
  }

  function renderSlot() {
    renderEvent();
    if (slot.respondedAt) renderResult();
    else renderAsk();
    show('card');
  }

  /* -------------------------------------------------------------- events */

  $('choiceYes').addEventListener('click', function () { choice = true; applyChoice(); });
  $('choiceNo').addEventListener('click', function () { choice = false; applyChoice(); });
  $('changeBtn').addEventListener('click', function () { renderAsk(); });

  $('submitBtn').addEventListener('click', function () {
    if (choice === null) return;
    var reason = $('reason').value.trim();
    if (choice === false && !reason) {
      toast('Please give a reason.', true);
      $('reason').focus();
      return;
    }

    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Sending…';

    fetch(apiBase() + '/api/invite/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attending: choice,
        reason: reason,
        message: $('message').value.trim(),
      }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Your answer could not be sent.');
        return data;
      });
    }).then(function (data) {
      slot = data;
      renderSlot();
      toast('Your answer has been sent.');
    }).catch(function (err) {
      toast(err.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Send my answer';
    });
  });

  /* ------------------------------------------------------------ bootstrap */

  function apiConfigured() {
    if (apiBase()) return true;
    var host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '';
  }

  if (!apiConfigured()) {
    $('invalid').querySelector('h2').textContent = 'This page is not ready yet';
    $('invalid').querySelector('p').textContent =
      'There is a technical problem with this invitation. Please tell whoever invited you.';
    show('invalid');
    return;
  }

  if (!token) {
    show('invalid');
    return;
  }

  fetch(apiBase() + '/api/invite/' + encodeURIComponent(token))
    .then(function (res) {
      if (!res.ok) throw new Error('not found');
      return res.json();
    })
    .then(function (data) {
      slot = data;
      renderSlot();
    })
    .catch(function () { show('invalid'); });
})();
