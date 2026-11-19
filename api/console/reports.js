/* =====================================================================
   ErgonSite console: Reports (owners only).

   Pick a period, a client and a cost category; see money in against
   costs month by month, per client and per category, with every line
   behind the totals, and download it all as CSV.
   Uses the helpers console.js puts on window.ErgonConsole.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { $, h, api, toast } = C;

  const pad = (n) => String(n).padStart(2, '0');
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  const shift = (m, n) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n; return Math.floor(i / 12) + '-' + pad(i % 12 + 1); };
  const fmt = (n) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const fmtCur = (n, cur) => { try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur || 'EUR' }).format(n || 0); } catch (e) { return (n || 0).toFixed(2) + ' ' + cur; } };
  const mName = (m, short) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', short ? { month: 'short', year: '2-digit' } : { month: 'long', year: 'numeric' });
  const day = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const PRESETS = {
    month: { label: 'This month', range: () => [thisMonth, thisMonth] },
    last: { label: 'Last month', range: () => [shift(thisMonth, -1), shift(thisMonth, -1)] },
    q: { label: 'Last 3 months', range: () => [shift(thisMonth, -2), thisMonth] },
    year: { label: 'This year', range: () => [now.getFullYear() + '-01', thisMonth] },
    prev: { label: 'Last year', range: () => [(now.getFullYear() - 1) + '-01', (now.getFullYear() - 1) + '-12'] },
    custom: { label: 'Custom', range: null }
  };

  let F = { preset: 'year', from: PRESETS.year.range()[0], to: thisMonth, client: '', category: '' };
  try { const saved = JSON.parse(sessionStorage.getItem('es-report') || 'null'); if (saved) F = Object.assign(F, saved); } catch (e) { /* no storage */ }
  if (F.preset !== 'custom' && PRESETS[F.preset]) [F.from, F.to] = PRESETS[F.preset].range();

  const query = () => '?from=' + F.from + '&to=' + F.to + '&client=' + encodeURIComponent(F.client) + '&category=' + encodeURIComponent(F.category);

  async function open() {
    try { sessionStorage.setItem('es-report', JSON.stringify(F)); } catch (e) { /* no storage */ }
    let r;
    try { r = await api('/reports' + query()); } catch (e) { toast(e.message); return; }
    render(r);
  }
  function set(patch) { Object.assign(F, patch); open(); }

  /* ---------------- page ---------------- */
  function render(r) {
    const t = r.totals;
    const clientLabel = F.client === '__company' ? 'ErgonSite itself & unassigned' : F.client || 'all clients';
    const scope = (F.from === F.to ? mName(F.from) : mName(F.from) + ' to ' + mName(F.to)) + ' · ' + clientLabel + (F.category ? ' · ' + F.category : '');
    $('#reportsRoot').replaceChildren(...[
      h('header', { class: 'x-head' }, h('div', null, h('h2', { text: 'Reports' }), h('p', { class: 'muted', text: 'Money in against costs, for any period, client or category.' }))),
      filterBar(r),
      h('p', { class: 'x-scope', text: scope }),
      h('section', { class: 'x-stats x-stats-5' },
        stat('Profit', fmt(t.profit), F.category ? 'costs only: a category is picked' : 'money in minus costs', true, t.profit < 0),
        stat('Money in', fmt(t.received), 'payments received'),
        stat('Costs', fmt(t.costs), t.missingRate ? 'some costs have no exchange rate' : 'all costs, in euro'),
        stat('Billed', fmt(t.billed), 'charges due in the period'),
        stat('Still to collect', fmt(t.open), 'unpaid, any date')),
      monthsCard(r),
      h('div', { class: 'x-two' }, clientsCard(r), categoryCard(r)),
      detailsCard(r)
    ].filter(Boolean));
  }

  function stat(label, value, note, big, neg) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') + (neg ? ' is-neg' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  function filterBar(r) {
    const from = h('input', { type: 'month', value: F.from, 'aria-label': 'From' });
    const to = h('input', { type: 'month', value: F.to, 'aria-label': 'To' });
    const onRange = () => { if (from.value && to.value) set({ preset: 'custom', from: from.value, to: to.value }); };
    from.addEventListener('change', onRange);
    to.addEventListener('change', onRange);
    const client = h('select', { 'aria-label': 'Client' },
      h('option', { value: '', text: 'All clients' }),
      r.options.clients.map((c) => h('option', { value: c, selected: F.client === c ? true : null, text: c })),
      h('option', { value: '__company', selected: F.client === '__company' ? true : null, text: 'ErgonSite itself & unassigned' }));
    client.addEventListener('change', () => set({ client: client.value }));
    const cats = Array.from(new Set([...r.options.categories, F.category].filter(Boolean)));
    const category = h('select', { 'aria-label': 'Cost category' },
      h('option', { value: '', text: 'All categories' }),
      cats.map((c) => h('option', { value: c, selected: F.category === c ? true : null, text: c })));
    category.addEventListener('change', () => set({ category: category.value }));
    return h('section', { class: 'card x-card x-filters' },
      h('div', { class: 'seg x-presets' }, Object.entries(PRESETS).map(([k, p]) => h('button', {
        type: 'button', class: F.preset === k ? 'is-on' : '', text: p.label,
        onclick: () => (p.range ? set({ preset: k, from: p.range()[0], to: p.range()[1] }) : set({ preset: 'custom' }))
      }))),
      h('div', { class: 'x-filter-row' },
        h('label', null, 'From', from), h('label', null, 'To', to), h('label', null, 'Client', client), h('label', null, 'Cost category', category),
        h('div', { class: 'x-filter-actions' },
          (F.client || F.category) ? h('button', { type: 'button', class: 'link', text: 'Clear filters', onclick: () => set({ client: '', category: '' }) }) : null,
          h('a', { class: 'btn btn-light', href: '/admin/api/reports/export.csv' + query(), text: 'Download CSV' }))));
  }

  function monthsCard(r) {
    // skip the empty months before the first money in or cost
    const first = r.months.findIndex((m) => m.received || m.billed || m.costs);
    r = Object.assign({}, r, { months: first > 0 ? r.months.slice(first) : r.months });
    const max = Math.max(1, ...r.months.map((m) => Math.max(m.received, m.costs)));
    const chart = h('div', { class: 'x-chart', role: 'img', 'aria-label': 'Money in and costs per month' },
      r.months.map((m) => h('div', { class: 'x-col', title: mName(m.month) + ': in ' + fmt(m.received) + ', costs ' + fmt(m.costs) },
        h('div', { class: 'x-col-bars' },
          h('i', { class: 'is-in', style: 'height:' + (m.received / max * 100) + '%' }),
          h('i', { class: 'is-out', style: 'height:' + (m.costs / max * 100) + '%' })),
        h('small', { text: mName(m.month, true) }))));
    return h('section', { class: 'card x-card' },
      h('div', { class: 'x-card-head' }, h('h3', { text: 'Month by month' }),
        h('div', { class: 'x-legend' }, h('span', null, h('i', { class: 'is-in' }), 'Money in'), h('span', null, h('i', { class: 'is-out' }), 'Costs'))),
      r.months.length > 1 ? chart : null,
      h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Month' }), h('th', { class: 'num', text: 'Billed' }), h('th', { class: 'num', text: 'Money in' }), h('th', { class: 'num', text: 'Costs' }), h('th', { class: 'num', text: 'Profit' }))),
        h('tbody', null, r.months.slice().reverse().map((m) => h('tr', null,
          h('td', null, mName(m.month), m.estimate ? h('small', { class: 'muted', text: ' · incl. estimates' }) : null),
          h('td', { class: 'num', text: m.billed ? fmt(m.billed) : '' }),
          h('td', { class: 'num', text: fmt(m.received) }),
          h('td', { class: 'num', text: fmt(m.costs) }),
          h('td', { class: 'num' }, h('b', { class: m.profit < 0 ? 'x-neg' : '', text: fmt(m.profit) }))))),
        h('tfoot', null, h('tr', null, h('td', null, h('b', { text: 'Total' })), h('td', { class: 'num', text: fmt(r.totals.billed) }), h('td', { class: 'num', text: fmt(r.totals.received) }), h('td', { class: 'num', text: fmt(r.totals.costs) }), h('td', { class: 'num' }, h('b', { class: r.totals.profit < 0 ? 'x-neg' : '', text: fmt(r.totals.profit) })))))));
  }

  function clientsCard(r) {
    return h('section', { class: 'card x-card' }, h('h3', { text: 'Per client' }),
      r.byClient.length ? h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Client' }), h('th', { class: 'num', text: 'In' }), h('th', { class: 'num', text: 'Costs' }), h('th', { class: 'num', text: 'Profit' }), h('th', { class: 'num', text: 'Open' }))),
        h('tbody', null, r.byClient.map((c) => h('tr', null,
          h('td', null, h('button', { type: 'button', class: 'link x-cell-link', text: c.name, title: 'Show only this', onclick: () => set({ client: c.key === '__company' ? '__company' : c.name }) })),
          h('td', { class: 'num', text: fmt(c.received) }), h('td', { class: 'num', text: fmt(c.costs) }),
          h('td', { class: 'num' }, h('b', { class: c.profit < 0 ? 'x-neg' : '', text: fmt(c.profit) })),
          h('td', { class: 'num', text: c.open ? fmt(c.open) : '' })))))) : h('p', { class: 'muted', text: 'Nothing in this period.' }),
      h('p', { class: 'muted x-note', text: 'Click a client to see only them. Costs are matched by the client name used in Expenses.' }));
  }

  function categoryCard(r) {
    const max = Math.max(0, ...r.byCategory.map((c) => c.eur));
    return h('section', { class: 'card x-card' }, h('h3', { text: 'Costs by category' }),
      r.byCategory.length ? h('ul', { class: 'x-bars' }, r.byCategory.map((c) => h('li', null,
        h('button', { type: 'button', class: 'link x-bar-label', text: c.category, title: 'Show only this', onclick: () => set({ category: c.category }) }),
        h('span', { class: 'x-bar' }, h('i', { style: 'width:' + (max ? Math.max(2, c.eur / max * 100) : 0) + '%' })),
        h('b', { text: fmt(c.eur) })))) : h('p', { class: 'muted', text: 'No costs in this period.' }),
      F.category ? h('p', { class: 'muted x-note', text: 'With a category picked, money in is hidden, so profit is not compared against part of the costs.' }) : null);
  }

  function detailsCard(r) {
    const pay = r.payments.map((p) => h('tr', null, h('td', { class: 'x-date', text: day(p.date) }), h('td', { text: p.client }), h('td', null, p.description, h('small', { class: 'muted', text: ' · ' + p.method })), h('td', { class: 'num', text: fmtCur(p.amount, p.currency) })));
    const cost = r.costs.map((c) => h('tr', null, h('td', { class: 'x-date', text: day(c.date) }), h('td', { text: c.client || 'Unassigned' }),
      h('td', null, c.name, h('small', { class: 'muted', text: ' · ' + c.category + (c.estimate ? ' · estimate' : c.upcoming ? ' · upcoming' : '') })),
      h('td', { class: 'num', text: fmtCur(c.amount, c.currency) + (c.currency !== 'EUR' && c.eur !== null ? ' (' + fmt(c.eur) + ')' : '') })));
    const table = (rows) => h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
      h('thead', null, h('tr', null, h('th', { text: 'Date' }), h('th', { text: 'Client' }), h('th', { text: 'What' }), h('th', { class: 'num', text: 'Amount' }))), h('tbody', null, rows)));
    return h('section', { class: 'card x-card' }, h('h3', { text: 'Every line' }),
      h('details', { class: 'x-details' }, h('summary', { text: 'Money in (' + pay.length + ')' }), pay.length ? table(pay) : h('p', { class: 'muted', text: 'No payments in this period.' })),
      h('details', { class: 'x-details' }, h('summary', { text: 'Costs (' + cost.length + ')' }), cost.length ? table(cost) : h('p', { class: 'muted', text: 'No costs in this period.' })));
  }

  window.ReportsView = { open };
})();
