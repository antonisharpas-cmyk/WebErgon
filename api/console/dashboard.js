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

  // the period of the money cards: its own, remembered while the browser tab is open
  const P = { preset: 'month' };
  try { Object.assign(P, JSON.parse(sessionStorage.getItem('es-dash') || '{}')); } catch (e) { /* no storage */ }
  const mName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  const span = (a, b) => (a === b ? mName(a) : mName(a) + ' to ' + mName(b));
  const change = (now, before) => {
    if (!before) return '';
    const pct = Math.round(((now - before) / Math.abs(before)) * 100);
    if (!pct) return 'same as before';
    return (pct > 0 ? '+' : '') + pct + '% vs before';
  };

  async function open() {
    if (P.preset !== 'custom' && C.PERIODS[P.preset]) [P.from, P.to] = C.PERIODS[P.preset].range();
    let d;
    try { d = await api('/dashboard' + (P.from ? '?from=' + P.from + '&to=' + P.to : '')); } catch (e) { toast(e.message); return; }
    const s = d.stats;

    const unpaid = d.unpaid.map((c) => h('li', { class: c.late ? 'is-late' : '' },
      h('span', { class: 'x-when' }, h('b', { text: c.start ? day(c.start) : 'no due date' }), h('small', { text: c.start ? (c.late ? 'due ' + rel(c.days) : 'due ' + rel(c.days)) : 'set one on the client' })),
      h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.description })),
      h('b', { text: fmt(c.open, c.currency) }),
      pill(c.late ? 'overdue' : c.paid ? 'part' : 'pending', c.late ? (c.paid ? 'part paid, late' : 'late') : c.paid ? 'part paid' : 'not due yet'),
      mailBtn(c.mail)));

    const cls = (c) => (c.days < 0 ? 'is-late' : c.days <= (c.remindDays ?? d.remindDays) ? 'is-due' : '');
    const maint = d.renewals.filter((c) => c.type === 'maintenance').map((c) => h('li', { class: cls(c) },
      h('span', { class: 'x-when' }, h('b', { text: day(c.end) }), h('small', { text: rel(c.days) })),
      h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · maintenance year ends' })),
      h('b', { text: fmt(c.amount, c.currency) }),
      pill(c.status, c.statusLabel),
      mailBtn(c.mail)));
    // domains: who has to act, the client (we remind them) or us (we pay)
    const domains = d.renewals.filter((c) => c.type === 'domain').map((c) => {
      const we = c.payer === 'ergonsite';
      return h('li', { class: cls(c) },
        h('span', { class: 'x-when' }, h('b', { text: day(c.end) }), h('small', { text: rel(c.days) })),
        h('span', { class: 'x-grow' }, h('b', { text: c.domainName || 'Domain' }), ' ', h('a', { href: '#clients/c/' + c.clientId, text: c.client })),
        we ? h('span', { class: 'x-chip st-pending', text: 'We pay' + (c.ourCost ? ' ' + fmt(c.ourCost, c.ourCostCurrency) : '') }) : h('span', { class: 'x-chip', text: 'Client pays' }),
        pill(c.status, c.statusLabel),
        we ? h('a', { class: 'btn btn-light x-mini', href: '#clients/c/' + c.clientId, text: 'Renew, then mark' }) : (c.mail && c.mail.to ? h('a', { class: 'btn btn-light x-mini', href: C.mailto(c.mail), text: 'Remind client' }) : null));
    });

    const ours = d.ours.map((o) => h('li', { class: o.due ? 'is-due' : '' },
      h('span', { class: 'x-when' }, h('b', { text: day(o.date) }), h('small', { text: rel(o.days) })),
      h('span', { class: 'x-grow' }, h('a', { href: '#expenses', text: o.name })),
      h('b', { text: fmt(o.amount, o.currency) }),
      o.due ? pill('soon', 'renew soon') : null));

    const checks = d.checks.map((c) => h('li', null,
      h('span', { class: 'x-grow' }, h('a', { href: c.href || '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.text }))));

    const card = (title, items, empty, extra) => h('section', { class: 'card x-card' },
      h('div', { class: 'x-card-head' }, h('h3', { text: title }), extra || null),
      items.length ? h('ul', { class: 'x-list' }, items) : h('p', { class: 'muted', text: empty }));

    const inbox = [];
    if (d.inbox.chatsUnread) inbox.push(h('a', { class: 'x-chip st-pending', href: '#chats', text: d.inbox.chatsUnread + ' unread chat' + (d.inbox.chatsUnread === 1 ? '' : 's') }));
    if (d.inbox.inquiriesNew) inbox.push(h('a', { class: 'x-chip st-pending', href: '#inquiries', text: d.inbox.inquiriesNew + ' new enquir' + (d.inbox.inquiriesNew === 1 ? 'y' : 'ies') }));

    $('#dashboardRoot').replaceChildren(...[
      h('header', { class: 'x-head' }, h('div', null, h('h2', { text: 'Dashboard' }), h('p', { class: 'muted', text: 'What needs doing, and how the money looks.' })),
        inbox.length ? h('div', { class: 'x-client-row' }, inbox) : null),
      h('section', { class: 'card x-card x-money' },
        h('div', { class: 'x-period-bar' },
          h('div', null, h('h3', { text: 'Money' }), h('small', { class: 'muted', text: span(d.from, d.to) + ' · compared with ' + span(s.prev.from, s.prev.to) })),
          C.periodPicker({ from: d.from, to: d.to, preset: P.preset, label: 'Period of the money cards', onChange: (p) => {
            Object.assign(P, p);
            try { sessionStorage.setItem('es-dash', JSON.stringify(P)); } catch (e) { /* no storage */ }
            open();
          } })),
        h('div', { class: 'x-stats x-stats-5' },
          stat('Billed', fmt(s.billed), change(s.billed, s.prev.billed) || 'what we charged'),
          stat('Money in', fmt(s.received), change(s.received, s.prev.received) || 'payments received'),
          stat('Costs', fmt(s.costs), (s.estimate ? 'includes estimates · ' : '') + (change(s.costs, s.prev.costs) || 'from Expenses')),
          stat('Profit', fmt(s.profit), s.received ? Math.round((s.profit / s.received) * 100) + '% of money in' : 'money in minus costs', false, s.profit < 0),
          stat('To collect, now', fmt(s.toCollect), s.overdue ? fmt(s.overdue) + ' of it is late' : 'nothing late')),
        h('p', { class: 'muted x-note' }, 'The period changes these cards only. The lists below are always about today. For clients and categories, open ', h('a', { href: '#reports', text: 'Reports' }), '.')),
      card('Unpaid', unpaid, 'Every client is paid up.'),
      card('Domains expiring', domains, 'No domain expires in the next ' + Math.max(60, d.remindDays) + ' days.',
        h('small', { class: 'muted', text: 'highlighted ' + d.remindDays + ' days before' })),
      h('div', { class: 'x-two' },
        card('Maintenance renewals', maint, 'No maintenance year ends in the next ' + Math.max(60, d.remindDays) + ' days.'),
        card('Our renewals', ours, 'Nothing of ours renews soon.', h('a', { href: '#expenses', class: 'link', text: 'Expenses' }))),
      card('To check', checks, 'Nothing to check.'),
      h('p', { class: 'muted x-note', text: 'No email goes to a client by itself. "Write email" opens your own mail program with a suggested text you can change. Record payments and renewals on the client’s page.' })
    ].filter(Boolean));
  }
  function stat(label, value, note, big, neg) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') + (neg ? ' x-neg-stat' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  window.DashboardView = { open };
})();
