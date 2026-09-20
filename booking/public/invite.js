/* ===========================================================
   Guest invitation page — opened from the link sent over
   Messenger or Viber. One seat, one token, one answer.
   =========================================================== */

(function () {
  'use strict';

  var token = decodeURIComponent(window.location.pathname.replace(/^\/i\//, '')).replace(/\/+$/, '');
  var slot = null;
  var choice = null; // true = attending, false = not

  var $ = function (id) { return document.getElementById(id); };

  var MONTHS = ['Enero', 'Pebrero', 'Marso', 'Abril', 'Mayo', 'Hunyo', 'Hulyo',
    'Agosto', 'Setyembre', 'Oktubre', 'Nobyembre', 'Disyembre'];
  var DAYS = ['Linggo', 'Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado'];

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

    $('c-eyebrow').textContent = 'Ikaw ay inaanyayahan sa';
    if (age !== null) {
      $('c-age').textContent = age;
      $('c-age').classList.remove('hidden');
    }
    $('c-name').textContent = ev.celebrant || ev.title;
    $('c-sub').innerHTML = age !== null
      ? escapeHtml((ev.nickname ? ev.nickname + "'s " : '') + age + 'th Birthday Celebration')
      : escapeHtml(ev.title);

    var facts = [];
    if (ev.eventDate) facts.push(['Petsa', formatDate(ev.eventDate)]);
    if (ev.startTime) facts.push(['Oras', escapeHtml(formatTime(ev.startTime))]);
    if (ev.venue) facts.push(['Venue', escapeHtml(ev.venue)]);
    if (ev.dressCode) facts.push(['Dress code', escapeHtml(ev.dressCode)]);
    $('c-facts').innerHTML = facts.map(function (f) {
      return '<div><dt>' + f[0] + '</dt><dd>' + f[1] + '</dd></div>';
    }).join('');

    $('c-guest').textContent = slot.guestName || 'Bisita';
    $('c-seat').textContent = slot.label;

    if (ev.note) {
      $('c-note').textContent = ev.note;
      $('c-note').classList.remove('hidden');
    }

    $('footer').textContent = ev.hostName ? 'Inihahandog ni ' + ev.hostName : '';
    document.title = 'Imbitasyon — ' + (ev.title || 'Birthday');
  }

  function renderAsk() {
    $('resultBox').classList.add('hidden');
    $('askBox').classList.remove('hidden');

    var deadline = slot.event.rsvpDeadline;
    $('deadlineNote').textContent = deadline
      ? 'Pakisagot po bago sumapit ang ' + formatShortDate(deadline) + '.'
      : 'Pakisagot po para maihanda namin ang upuan mo.';

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

  function renderResult() {
    $('askBox').classList.add('hidden');
    $('resultBox').classList.remove('hidden');

    var attending = slot.status === 'confirmed';
    $('r-icon').innerHTML = attending ? '&#10003;' : '&#9825;';
    $('r-icon').style.color = attending ? 'var(--ok)' : 'var(--no)';
    $('r-title').textContent = attending ? 'Salamat! Naka-book na ang upuan mo.' : 'Salamat sa pagsagot.';
    $('r-body').textContent = attending
      ? 'Nakareserba na sa pangalan mo ang upuan at hindi na ito maibibigay sa iba. Kitakits sa ' +
        formatShortDate(slot.event.eventDate) + '!'
      : 'Naitala na namin na hindi ka makakarating. Sayang, pero salamat sa pagpapaalam.';

    var rows = [
      '<div><b>Bisita:</b> ' + escapeHtml(slot.guestName || '—') + '</div>',
      '<div><b>Upuan:</b> ' + escapeHtml(slot.label) + '</div>',
      '<div><b>Sagot:</b> ' + (attending ? 'Makakarating' : 'Hindi makakarating') + '</div>',
    ];
    if (!attending && slot.reason) rows.push('<div><b>Dahilan:</b> ' + escapeHtml(slot.reason) + '</div>');
    if (attending && slot.message) rows.push('<div><b>Mensahe mo:</b> ' + escapeHtml(slot.message) + '</div>');
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
      toast('Pakilagay po ang dahilan.', true);
      $('reason').focus();
      return;
    }

    var btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = 'Ipinapadala…';

    fetch('/api/invite/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attending: choice,
        reason: reason,
        message: $('message').value.trim(),
      }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Hindi naipadala ang sagot.');
        return data;
      });
    }).then(function (data) {
      slot = data;
      renderSlot();
      toast('Naipadala na ang sagot mo.');
    }).catch(function (err) {
      toast(err.message, true);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Ipadala ang sagot';
    });
  });

  /* ------------------------------------------------------------ bootstrap */

  if (!token) {
    show('invalid');
    return;
  }

  fetch('/api/invite/' + encodeURIComponent(token))
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
