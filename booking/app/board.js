/* ===========================================================
   The seat board, shared by the admin console and the
   coordinator page so the two can never drift apart.

   Nothing here talks to the network. The caller passes in the
   functions that save, and gets told what happened.
   =========================================================== */

(function () {
  'use strict';

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var STATUS_LABEL = {
    open: 'Open', invited: 'Awaiting reply', confirmed: 'Confirmed', declined: 'Not coming',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return iso;
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear() + ' (' + DAYS[d.getDay()] + ')';
  }

  function formatTime(hhmm) {
    if (!hhmm) return '';
    var bits = String(hhmm).split(':');
    var h = Number(bits[0]);
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (bits[1] || '00') + ' ' + suffix;
  }

  /* Seats are stored as text, so "10" sorts before "2" unless compared
     numerically. Numeric collation also keeps "Table 10" after "Table 9". */
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function compareSlots(a, b) {
    return collator.compare(a.table || '', b.table || '') ||
      collator.compare(a.seat || '', b.seat || '');
  }

  /** The message that gets pasted into Messenger or Viber. */
  function inviteMessage(ev, slot, link) {
    if (!ev) return link;
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
    lines.push(link);
    return lines.join('\n');
  }

  function copyText(text) {
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

  function renderStats(host, slots) {
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
    host.innerHTML = cards.map(function (c) {
      return '<div class="stat ' + c.cls + '"><div class="n">' + c.n +
        '</div><div class="k">' + c.k + '</div></div>';
    }).join('');
  }

  function slotRow(s, allowRemove) {
    var note = '';
    if (s.status === 'declined') {
      note = '<div class="note declined"><b>Reason:</b> ' + escapeHtml(s.reason || '—') +
        '<br><b>Answered:</b> ' + escapeHtml(new Date(s.respondedAt).toLocaleString()) + '</div>';
    } else if (s.status === 'confirmed') {
      note = '<div class="note confirmed"><b>Seat locked.</b> Answered on ' +
        escapeHtml(new Date(s.respondedAt).toLocaleString()) +
        (s.message ? '<br><b>Message:</b> ' + escapeHtml(s.message) : '') + '</div>';
    }
    var named = s.guestName ? '' : 'disabled';
    return '<div class="slot ' + s.status + '" data-slot="' + escapeHtml(s.id) + '">' +
      '<div class="seat">' + escapeHtml(s.seat) + '<small>' + escapeHtml(s.table) + '</small></div>' +
      '<div><input data-field="guestName" placeholder="Guest name" value="' + escapeHtml(s.guestName) + '" /></div>' +
      '<div><input data-field="guestContact" placeholder="Viber / FB (optional)" value="' + escapeHtml(s.guestContact || '') + '" /></div>' +
      '<div class="actions">' +
        '<span class="badge ' + s.status + '">' + STATUS_LABEL[s.status] + '</span>' +
        '<button class="tiny" data-act="link" type="button" ' + named + '>Copy link</button>' +
        '<button class="tiny" data-act="msg" type="button" ' + named + '>Message</button>' +
        '<button class="tiny ghost" data-act="share" type="button" ' + named + '>Share</button>' +
        '<button class="tiny ghost" data-act="reset" type="button" ' + (s.respondedAt ? '' : 'disabled') + '>Reset</button>' +
        '<button class="tiny ghost" data-act="token" type="button">New link</button>' +
        (allowRemove ? '<button class="tiny danger" data-act="del" type="button">Remove</button>' : '') +
      '</div>' + note +
    '</div>';
  }

  /**
   * @param {object} o
   * @param {HTMLElement} o.host      where the rows go
   * @param {Array}  o.slots          already filtered and sorted
   * @param {string} o.emptyText      shown when slots is empty
   * @param {boolean} o.allowRemove   show the Remove button
   * @param {function} o.link         slot -> invitation URL
   * @param {function} o.message      slot -> the text to paste into a chat
   * @param {function} o.save         (slotId, patch) -> Promise
   * @param {function} o.reset        (slotId) -> Promise
   * @param {function} o.newLink      (slotId) -> Promise
   * @param {function} [o.remove]     (slot) -> Promise, needed with allowRemove
   * @param {function} o.done         (message) after a successful change
   * @param {function} o.error        (Error)
   */
  function renderSlots(o) {
    if (!o.slots.length) {
      o.host.innerHTML = o.emptyText ? '<p class="muted small">' + escapeHtml(o.emptyText) + '</p>' : '';
      return;
    }

    o.host.innerHTML = o.slots.map(function (s) { return slotRow(s, o.allowRemove); }).join('');

    var byId = {};
    o.slots.forEach(function (s) { byId[s.id] = s; });

    Array.prototype.forEach.call(o.host.querySelectorAll('.slot'), function (row) {
      var id = row.getAttribute('data-slot');

      Array.prototype.forEach.call(row.querySelectorAll('[data-field]'), function (input) {
        input.addEventListener('change', function () {
          var patch = {};
          patch[input.getAttribute('data-field')] = input.value;
          o.save(id, patch).then(function () { o.done('Saved.'); }, o.error);
        });
      });

      Array.prototype.forEach.call(row.querySelectorAll('[data-act]'), function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          var slot = byId[id];
          if (!slot) return;

          if (act === 'link') {
            copyText(o.link(slot)).then(function () { o.done('Link copied.'); });
          } else if (act === 'msg') {
            copyText(o.message(slot)).then(function () {
              o.done('Full message copied — paste it into Messenger or Viber.');
            });
          } else if (act === 'share') {
            if (navigator.share) {
              navigator.share({ title: 'Invitation', text: o.message(slot) }).catch(function () {});
            } else {
              copyText(o.message(slot)).then(function () {
                o.done('Sharing is not available here — the message was copied instead.');
              });
            }
          } else if (act === 'reset') {
            if (!confirm('Reset the answer from ' + (slot.guestName || 'this guest') +
              '? Their confirmation will be erased.')) return;
            o.reset(id).then(function () { o.done('Answer reset.'); }, o.error);
          } else if (act === 'token') {
            if (!confirm('This makes a new link. The old link you already sent will stop working. Continue?')) return;
            o.newLink(id).then(function () { o.done('The seat has a new link.'); }, o.error);
          } else if (act === 'del' && o.remove) {
            if (!confirm('Remove ' + slot.label + '?')) return;
            o.remove(slot).then(function () { o.done('Removed.'); }, o.error);
          }
        });
      });
    });
  }

  window.AbyBoard = {
    MONTHS: MONTHS,
    DAYS: DAYS,
    STATUS_LABEL: STATUS_LABEL,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    formatTime: formatTime,
    compareSlots: compareSlots,
    inviteMessage: inviteMessage,
    copyText: copyText,
    renderStats: renderStats,
    renderSlots: renderSlots,
  };
})();
