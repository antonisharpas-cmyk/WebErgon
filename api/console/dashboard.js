/* =====================================================================
   ErgonSite console: Dashboard (owners only).

   What needs doing today in one place: money owed by clients, client
   renewals coming up (maintenance years and domains), our own renewals
   from Expenses, things to check, and the month and the year in money.
   "Write email" opens your own mail program with a suggested text.
   Uses the helpers console.js puts on window.ErgonConsole.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { $, h, api, toast } = C;

  const fmt = (n, cur) => { try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur || 'EUR' }).format(n || 0); } catch (e) { return (n || 0).toFixed(2) + ' ' + cur; } };
  const day = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const rel = (n) => (n === null || n === undefined ? '' : n < 0 ? Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days') + ' ago' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
  const pill = (key, label) => h('span', { class: 'x-chip st-' + key, text: label });
  const mailBtn = (m) => (m && m.to && C.mailto ? h('a', { class: 'btn btn-light x-mini', href: C.mailto(m), text: 'Write email' }) : null);

  async function open() {
    let d;
    try { d = await api('/dashboard'); } catch (e) { toast(e.message); return; }
    const s = d.stats;
    const monthName = new Date(d.month + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long' });

    const unpaid = d.unpaid.map((c) => h('li', { class: c.late ? 'is-late' : '' },
      h('span', { class: 'x-when' }, h('b', { text: c.start ? day(c.start) : 'no due date' }), h('small', { text: c.start ? (c.late ? 'due ' + rel(c.days) : 'due ' + rel(c.days)) : 'set one on the client' })),
      h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.description })),
      h('b', { text: fmt(c.open, c.currency) }),
      pill(c.late ? 'overdue' : c.paid ? 'part' : 'pending', c.late ? (c.paid ? 'part paid, late' : 'late') : c.paid ? 'part paid' : 'not due yet'),
      mailBtn(c.mail)));

    const renewals = d.renewals.map((c) => h('li', { class: c.days < 0 ? 'is-late' : c.days <= (c.remindDays ?? d.remindDays) ? 'is-due' : '' },
      h('span', { class: 'x-when' }, h('b', { text: day(c.end) }), h('small', { text: rel(c.days) })),
      h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }),
        h('small', { class: 'muted', text: ' · ' + c.typeLabel + (c.domainName ? ' ' + c.domainName : '') + (c.type === 'domain' ? (c.payer === 'ergonsite' ? ' · we pay' : ' · client pays') : '') })),
      c.type === 'maintenance' || c.amount ? h('b', { text: fmt(c.amount, c.currency) }) : h('span'),
      pill(c.status, c.statusLabel),
      mailBtn(c.mail)));

    const ours = d.ours.map((o) => h('li', { class: o.due ? 'is-due' : '' },
      h('span', { class: 'x-when' }, h('b', { text: day(o.date) }), h('small', { text: rel(o.days) })),
      h('span', { class: 'x-grow' }, h('a', { href: '#expenses', text: o.name })),
      h('b', { text: fmt(o.amount, o.currency) }),
      o.due ? pill('soon', 'renew soon') : null));

    const checks = d.checks.map((c) => h('li', null,
      h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.text }))));

    const card = (title, items, empty, extra) => h('section', { class: 'card x-card' },
      h('div', { class: 'x-card-head' }, h('h3', { text: title }), extra || null),
      items.length ? h('ul', { class: 'x-list' }, items) : h('p', { class: 'muted', text: empty }));

    const inbox = [];
    if (d.inbox.chatsUnread) inbox.push(h('a', { class: 'x-chip st-pending', href: '#chats', text: d.inbox.chatsUnread + ' unread chat' + (d.inbox.chatsUnread === 1 ? '' : 's') }));
    if (d.inbox.inquiriesNew) inbox.push(h('a', { class: 'x-chip st-pending', href: '#inquiries', text: d.inbox.inquiriesNew + ' new enquir' + (d.inbox.inquiriesNew === 1 ? 'y' : 'ies') }));

    $('#dashboardRoot').replaceChildren(...[
      h('header', { class: 'x-head' }, h('div', null, h('h2', { text: 'Dashboard' }), h('p', { class: 'muted', text: 'What needs doing, and how the money looks.' })),
        inbox.length ? h('div', { class: 'x-client-row' }, inbox) : null),
      h('section', { class: 'x-stats x-stats-5' },
        stat('To collect', fmt(s.toCollect), s.overdue ? fmt(s.overdue) + ' of it is late' : 'nothing late', true),
        stat('In, ' + monthName, fmt(s.inMonth), 'payments received'),
        stat('Costs, ' + monthName, fmt(s.costsMonth), s.costsMonthEstimate ? 'includes estimates' : 'all charged'),
        stat('In, ' + d.year, fmt(s.inYear), 'costs ' + fmt(s.costsYear)),
        stat('Profit, ' + d.year, fmt(s.profitYear), 'money in minus costs', false, s.profitYear < 0)),
      card('Unpaid', unpaid, 'Every client is paid up.'),
      card('Client renewals', renewals, 'No maintenance or domain renews in the next ' + Math.max(60, d.remindDays) + ' days.',
        h('small', { class: 'muted', text: 'highlighted ' + d.remindDays + ' days before' })),
      h('div', { class: 'x-two' },
        card('Our renewals', ours, 'Nothing of ours renews soon.', h('a', { href: '#expenses', class: 'link', text: 'Expenses' })),
        card('To check', checks, 'Nothing to check.')),
      h('p', { class: 'muted x-note', text: 'No email goes to a client by itself. "Write email" opens your own mail program with a suggested text you can change. Record payments and renewals on the client’s page.' })
    ].filter(Boolean));
  }
  function stat(label, value, note, big, neg) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') + (neg ? ' x-neg-stat' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  window.DashboardView = { open };
})();
