/* =====================================================================
   ErgonSite console: Expenses (owners only).

   One month at a time: what was paid, what is coming, per client and
   per category, all converted to euro. Recurring costs, one-off costs
   and Render's usage files live side by side. Everything is editable:
   a recurring price can change from a month onwards, one month can be
   changed or skipped, a plan can be stopped or deleted.
   Uses the helpers console.js puts on window.ErgonConsole.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { $, h, api, toast } = C;

  const EVERY = { 1: 'Every month', 3: 'Every 3 months', 6: 'Every 6 months', 12: 'Every year', 24: 'Every 2 years' };
  // from/to: the period of "By period", its own; S.month (= to) is the default month for new costs
  const S = { from: null, to: null, month: null, data: null, tab: 'month' };

  const fmt = (n, cur) => {
    try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur || 'EUR' }).format(n); }
    catch (e) { return (Number(n) || 0).toFixed(2) + ' ' + cur; }
  };
  const eur = (n) => (n === null || n === undefined ? 'no rate' : fmt(n, 'EUR'));
  const pad = (n) => String(n).padStart(2, '0');
  const thisMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const shift = (m, n) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n; return Math.floor(i / 12) + '-' + pad(i % 12 + 1); };
  const monthName = (m, short) => new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  const dayName = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');

  /* ---------------- load ----------------
     #expenses            this month          #expenses/2026-10   another month
     #expenses/2026-01..2026-11                                   a period of months
     #expenses/recurring  subscriptions       #expenses/hosting   Render files and clients
     #expenses/settings   rates, reminders, downloads */
  const TABS = ['recurring', 'hosting', 'settings'];
  async function open(arg) {
    S.tab = TABS.includes(arg) ? arg : 'month';
    const m = /^(\d{4}-\d{2})(?:\.\.(\d{4}-\d{2}))?$/.exec(arg || '');
    if (m) { S.from = m[1]; S.to = m[2] || m[1]; if (S.from > S.to) [S.from, S.to] = [S.to, S.from]; }
    S.from ||= thisMonth(); S.to ||= S.from;
    S.month = S.to;
    try { S.data = await api('/expenses?month=' + S.from + '&to=' + S.to); } catch (e) { toast(e.message); return; }
    render();
  }
  const periodKey = (a, b) => (a === b ? a : a + '..' + b);
  const reload = () => open(S.tab === 'month' ? periodKey(S.from, S.to) : S.tab);

  /* ---------------- page ---------------- */
  function render() {
    const d = S.data;
    const body = S.tab === 'recurring' ? [recurring(d)] : S.tab === 'hosting' ? [hosting(d)] : S.tab === 'settings' ? [settings(d)] : [stats(d), monthTable(d)];
    $('#expensesRoot').replaceChildren(head(d), ...body.flat().filter(Boolean));
  }

  function head(d) {
    const t = (key, label, hash) => h('a', { href: '#' + hash, class: S.tab === key ? 'is-on' : '' }, label);
    const add = h('details', { class: 'x-menu' },
      h('summary', { class: 'btn btn-dark', text: '+ Add' }),
      h('div', { class: 'x-menu-list' },
        h('button', { type: 'button', text: 'One-off expense', onclick: (e) => { e.target.closest('details').open = false; entryDialog(); } }),
        h('button', { type: 'button', text: 'Instagram ad', onclick: (e) => { e.target.closest('details').open = false; entryDialog(null, AD); } }),
        h('button', { type: 'button', text: 'Recurring cost (subscription, domain…)', onclick: (e) => { e.target.closest('details').open = false; planDialog(); } })));
    return h('div', { class: 'x-root-head' },
      h('header', { class: 'x-head' },
        h('div', null, h('h2', { text: 'Expenses' }), h('p', { class: 'muted', text: 'What ErgonSite pays for. Totals in euro.' })),
        h('div', { class: 'x-actions' }, add)),
      h('nav', { class: 'x-tabs' },
        t('month', 'By period', 'expenses/' + periodKey(S.from, S.to)), t('recurring', 'Recurring', 'expenses/recurring'),
        t('hosting', 'Render hosting', 'expenses/hosting'), t('settings', 'Settings', 'expenses/settings')));
  }

  /* ---------------- by month ---------------- */
  const GROUPS = [
    ['plan', 'Subscriptions'], ['render', 'Hosting (Render)'], ['ads', 'Instagram ads'], ['client', 'Domains we pay for clients'], ['entry', 'Other one-off']
  ];
  const groupOf = (r) => (r.kind === 'entry' && r.category === AD ? 'ads' : r.kind);
  const sumEur = (rows) => rows.reduce((n, r) => n + (r.skipped ? 0 : r.eur || 0), 0);

  function stats(d) {
    const rows = d.rows.filter((r) => !(r.kind === 'render' && !r.amount));
    const by = (g) => rows.filter((r) => groupOf(r) === g);
    // the months of the period that have a Render file
    const len = (Number(d.to.slice(0, 4)) * 12 + Number(d.to.slice(5))) - (Number(d.month.slice(0, 4)) * 12 + Number(d.month.slice(5))) + 1;
    const files = Array.from({ length: len }, (_, i) => d.render[shift(d.month, i)]).filter(Boolean);
    const hostNote = !files.length ? 'no Render file yet' : len === 1 ? (files[0].final ? 'final bill' : 'estimate')
      : files.length + ' of ' + len + ' months imported' + (files.some((f) => !f.final) ? ', some estimates' : '');
    const go = (a, b) => { location.hash = 'expenses/' + periodKey(a, b); };
    // arrows move the whole period: a month by a month, a year by a year, any other period by its length
    const wholeYear = len > 1 && d.month.slice(5) === '01' && d.month.slice(0, 4) === d.to.slice(0, 4);
    const step = (n) => (wholeYear ? go((Number(d.month.slice(0, 4)) + n) + '-01', (Number(d.month.slice(0, 4)) + n) + '-12') : go(shift(d.month, n * len), shift(d.to, n * len)));
    const picker = C.periodPicker({ from: d.month, to: d.to, label: 'Period', onChange: (p) => go(p.from, p.to) });
    return h('div', { class: 'x-month-head' },
      h('div', { class: 'x-period-bar' }, h('div', { class: 'x-month' },
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Previous period', onclick: () => step(-1) }, '‹'),
        h('b', { text: d.label }),
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Next period', onclick: () => step(1) }, '›')),
        picker),
      h('section', { class: 'x-stats' },
        stat('Total', eur(d.totals.eur), d.totals.estimate ? 'includes estimates' : 'all charged', true),
        stat('Subscriptions', eur(sumEur(by('plan'))), by('plan').length + (len === 1 ? ' this month' : ' charges')),
        stat('Hosting', eur(sumEur(by('render'))), hostNote),
        stat('Ads & other', eur(sumEur(by('ads')) + sumEur(by('entry')) + sumEur(by('client'))), by('ads').length + ' ad' + (by('ads').length === 1 ? '' : 's'))));
  }
  function stat(label, value, note, big) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  function monthTable(d) {
    const rows = d.rows.filter((r) => !(r.kind === 'render' && !r.amount));
    const usd = d.fx.monthRates.USD;
    const note = h('p', { class: 'muted x-note' },
      d.range ? 'Each month is converted at its own rate: the month-end rate once the month is over, today\u2019s rate for the current month. '
      : usd ? 'Dollars converted at 1 EUR = ' + usd + ' USD' + (d.fx.lockedAt ? ', the month-end rate (' + dayName(d.fx.lockedAt) + '), locked' : d.month === thisMonth() ? (d.fx.source === 'ECB' ? ', today\u2019s European Central Bank rate: it follows the daily rate until the month ends, then it is locked' : d.fx.source === 'manual' ? ' (set by hand)' : ' (default rate, set it in Settings)') : '') + '. ' : '',
      'Totals per client and month by month are in ', h('a', { href: '#reports', text: 'Reports' }), '.',
      d.totals.missingRate ? h('b', { class: 'x-warn', text: ' Some costs have no exchange rate: add it in Settings.' }) : null);
    if (!rows.length) {
      return h('section', { class: 'card x-card' }, h('p', { class: 'muted', text: 'Nothing for ' + d.label + ' yet. Use + Add, or import Render’s file under Render hosting.' }), note);
    }
    // search and filters: kept while you move between periods
    const crossYear = d.month.slice(0, 4) !== d.to.slice(0, 4);
    const when = (r) => (crossYear ? dayName(r.date) : dayName(r.date).replace(/ \d{4}$/, ''));
    const search = h('input', { type: 'search', class: 'x-search', placeholder: d.range ? 'Search this period…' : 'Search this month…', 'aria-label': 'Search', value: S.q || '' });
    const kinds = C.multiSelect({
      items: GROUPS.filter(([g]) => rows.some((r) => groupOf(r) === g)).map(([g, t]) => ({ value: g, label: t })),
      selected: S.kinds || [], allLabel: 'All types', noun: 'types', label: 'Types',
      onChange: (v) => { S.kinds = v; draw(); }
    });
    const clientsPick = C.multiSelect({
      items: [...new Set(rows.map((r) => r.client || 'No client'))].sort((a, b) => a.localeCompare(b)).map((c) => ({ value: c, label: c })),
      selected: S.clientsF || [], allLabel: 'All clients', noun: 'clients', label: 'Clients',
      onChange: (v) => { S.clientsF = v; draw(); }
    });
    const tbody = h('tbody');
    const tfoot = h('tfoot');
    search.addEventListener('input', () => { S.q = search.value; draw(); });
    draw();
    return h('section', { class: 'card x-card' },
      h('div', { class: 'x-toolbar' }, search, h('div', { class: 'x-filter-pick' }, kinds), h('div', { class: 'x-filter-pick' }, clientsPick)),
      h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table x-exp' },
        h('thead', null, h('tr', null, h('th', { text: 'Date' }), h('th', { text: 'What' }), h('th', { text: 'For client' }), h('th', { class: 'num', text: 'Paid in' }), h('th', { class: 'num', text: 'EUR' }), h('th'))),
        tbody, tfoot)),
      note);

    function draw() {
    const q = (S.q || '').trim().toLowerCase();
    const shown = rows.filter((r) => (!q || [r.name, r.vendor, r.client, r.post, r.category].some((v) => String(v || '').toLowerCase().includes(q)))
      && (!(S.kinds || []).length || S.kinds.includes(groupOf(r)))
      && (!(S.clientsF || []).length || S.clientsF.includes(r.client || 'No client')));
    const filtered = shown.length !== rows.length;
    const body = [];
    for (const [g, title] of GROUPS) {
      const list = shown.filter((r) => groupOf(r) === g);
      if (!list.length) continue;
      body.push(h('tr', { class: 'x-group' }, h('td', { colspan: '4' }, h('b', { text: title })), h('td', { class: 'num' }, h('b', { text: eur(sumEur(list)) })), h('td')));
      for (const r of list) {
        const edit = r.kind === 'plan' ? () => monthDialog(r) : r.kind === 'entry' ? () => entryDialog(r) : r.kind === 'client' ? () => { location.hash = 'clients/c/' + r.clientId; } : () => mapDialog(r.name, r.client);
        const sub = r.kind === 'entry' && r.post ? 'Post: ' + r.post + (r.campaignFrom ? ' · ' + dayName(r.campaignFrom).replace(/ \d{4}$/, '') + (r.campaignTo ? ' to ' + dayName(r.campaignTo).replace(/ \d{4}$/, '') : '') : '')
          : r.skipped ? 'skipped in ' + monthName(r.month, true) : r.changed ? 'different amount in ' + monthName(r.month, true) : r.vendor && r.vendor !== r.name && r.kind !== 'render' ? r.vendor : '';
        body.push(h('tr', { class: r.skipped ? 'is-off' : '' },
          h('td', { class: 'x-date', text: when(r) }),
          h('td', null, r.name, sub ? h('div', { class: 'x-ad', text: sub }) : null),
          h('td', { class: 'muted', text: r.client || (r.kind === 'render' ? 'no client' : '') }),
          h('td', { class: 'num', text: r.currency === 'EUR' ? '' : fmt(r.amount, r.currency) }),
          h('td', { class: 'num' }, eur(r.eur), r.estimate || r.upcoming ? h('small', { class: 'x-est', text: r.estimate ? ' est.' : ' due' }) : null),
          h('td', { class: 'num' }, h('button', { type: 'button', class: 'link', text: r.kind === 'render' ? 'Client' : r.kind === 'client' ? 'Client' : 'Edit', onclick: edit }))));
      }
    }
    if (!body.length) body.push(h('tr', null, h('td', { colspan: '6', class: 'muted', text: 'Nothing matches.' })));
    tbody.replaceChildren(...body);
    tfoot.replaceChildren(h('tr', null, h('td'), h('td', null, h('b', { text: (filtered ? 'Shown, ' : 'Total ') + d.label })), h('td'), h('td'),
      h('td', { class: 'num' }, h('b', { text: eur(filtered ? sumEur(shown) : d.totals.eur) })), h('td')));
    }
  }

  /* ---------------- recurring ---------------- */
  function recurring(d) {
    return h('section', { class: 'card x-card' },
      h('div', { class: 'x-card-head' }, h('h3', { text: 'Recurring costs' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Recurring', onclick: () => planDialog() })),
      h('p', { class: 'muted x-note', text: 'Subscriptions and renewals that repeat. Edit one to change its price from a month on, set a reminder, stop it or delete it. To change only one month, open that month and press Edit on the line.' }),
      d.plans.length ? h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Name' }), h('th', { text: 'Repeats' }), h('th', { class: 'num', text: 'Price' }), h('th', { text: 'Next charge' }), h('th', { text: 'Reminder' }), h('th'))),
        h('tbody', null, d.plans.map((p) => h('tr', { class: p.stop && p.stop <= thisMonth() ? 'is-off' : '' },
          h('td', null, h('b', { text: p.name }), p.stop ? h('div', { class: 'x-ad', text: 'stopped from ' + monthName(p.stop) }) : p.vendor ? h('div', { class: 'x-ad', text: p.vendor + (p.client ? ' · for ' + p.client : '') }) : null),
          h('td', { text: EVERY[p.every] }),
          h('td', { class: 'num', text: fmt(p.currentPrice, p.currency) }),
          h('td', { text: p.next ? dayName(p.next) : '—' }),
          h('td', { text: p.remindDays ? p.remindDays + ' days before' : 'off' }),
          h('td', { class: 'num' }, h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => planDialog(p) }))))))) :
        h('p', { class: 'muted', text: 'No recurring costs yet. Add Google Workspace, the domain, and so on.' }));
  }

  /* ---------------- Render ---------------- */
  function hosting(d) {
    const file = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
    file.addEventListener('change', () => importRender(Array.from(file.files)).finally(() => { file.value = ''; }));
    const months = Object.entries(d.render).sort((a, b) => b[0].localeCompare(a[0]));
    const inputs = {};
    const mapRows = d.services.map((s) => {
      const inp = h('input', { value: d.renderMap[s.toLowerCase()] || '', list: 'xClients', placeholder: 'Which client?', 'aria-label': 'Client for ' + s });
      inputs[s] = inp;
      const pending = d.renderPending && d.renderPending[s.toLowerCase()];
      return h('label', { class: pending ? 'is-new' : null }, h('span', null, s, pending ? h('span', { class: 'x-chip is-warn', text: inp.value ? 'guessed: check and save' : 'new' }) : null), inp);
    });
    const save = h('button', { type: 'button', class: 'btn btn-dark', text: 'Save', onclick: async () => {
      const map = {};
      for (const [s, inp] of Object.entries(inputs)) map[s] = inp.value;
      try { await api('/expenses/render-map', { method: 'PUT', body: { map } }); toast('Saved'); reload(); } catch (e) { toast(e.message); }
    } });
    return [
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Render files' }), h('button', { type: 'button', class: 'btn btn-dark', text: 'Import CSV', onclick: () => file.click() }), file),
        h('p', { class: 'muted x-note', text: 'In Render: Billing, then download the usage CSV for each month. The current month’s “unbilled charges” file is an estimate: import it again whenever you like, and import the final file when the month is billed. A new file for a month replaces the old one.' }),
        months.length ? h('ul', { class: 'x-list' }, months.map(([m, r]) => h('li', null,
          h('span', { class: 'x-grow' }, h('b', { text: monthName(m) }), h('small', { class: 'muted', text: ' · ' + (r.file || 'imported') })),
          h('span', { class: 'x-chip' + (r.final ? '' : ' is-warn'), text: r.final ? 'final' : 'estimate' }),
          h('button', { type: 'button', class: 'link', text: 'Remove', onclick: async () => {
            if (!confirm('Remove the Render file for ' + monthName(m) + '?')) return;
            try { await api('/expenses/render/' + m, { method: 'DELETE' }); toast('Removed'); reload(); } catch (e) { toast(e.message); }
          } })))) : h('p', { class: 'muted', text: 'No Render files yet.' })),
      d.services.length ? h('section', { class: 'card x-card' }, h('h3', { text: 'Which client is each service?' }),
        h('p', { class: 'muted x-note', text: 'So hosting costs show under the right client in Reports. Leave empty for ErgonSite’s own. A service that appears for the first time in an imported file is marked here (with a guess when its name looks like a client) and stays on the dashboard until you press Save.' }),
        h('div', { class: 'x-mapgrid' }, mapRows), h('div', null, save),
        h('datalist', { id: 'xClients' }, d.clients.map((c) => h('option', { value: c })))) : null
    ];
  }

  /* ---------------- settings ---------------- */
  function settings(d) {
    const curs = Object.keys(d.fx.rates).filter((c) => ['USD', 'GBP'].includes(c) || d.rows.some((r) => r.currency === c) || d.plans.some((p) => p.currency === c));
    const auto = h('input', { type: 'checkbox', checked: d.settings.autoRates ? true : null });
    const rateInputs = curs.map((c) => [c, h('input', { type: 'number', step: '0.0001', min: '0', value: d.fx.rates[c], 'aria-label': '1 EUR in ' + c })]);
    const extraCur = h('input', { placeholder: 'e.g. CHF', maxlength: '3', 'aria-label': 'Another currency' });
    const extraRate = h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'rate', 'aria-label': 'Its rate' });
    const email = h('input', { type: 'email', value: d.settings.remindEmail || '', placeholder: d.settings.defaultEmail });
    const restore = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    restore.addEventListener('change', () => importBackup(restore.files[0]).finally(() => { restore.value = ''; }));
    // downloads have their own period, separate from the month open in "By month"
    const tm = thisMonth();
    const dlFrom = h('input', { type: 'month', value: tm.slice(0, 4) + '-01', 'aria-label': 'From' });
    const dlTo = h('input', { type: 'month', value: tm, 'aria-label': 'To' });
    const dlLink = h('a', { class: 'btn btn-dark', text: 'Download CSV' });
    const dlSet = () => {
      const a = dlFrom.value || tm, b = dlTo.value || tm;
      const [f, t] = a <= b ? [a, b] : [b, a];
      dlLink.href = '/admin/api/expenses/export.csv?from=' + f + '&to=' + t;
    };
    dlFrom.addEventListener('change', dlSet);
    dlTo.addEventListener('change', dlSet);
    dlSet();
    const saveRates = async () => {
      const rates = {};
      for (const [c, inp] of rateInputs) rates[c] = inp.value;
      if (extraCur.value.trim() && extraRate.value) rates[extraCur.value.trim().toUpperCase()] = extraRate.value;
      try { await api('/expenses/settings', { method: 'PUT', body: { rates } }); toast('Rates saved. Automatic updates are now off.'); reload(); } catch (e) { toast(e.message); }
    };
    auto.addEventListener('change', async () => {
      try { await api('/expenses/settings', { method: 'PUT', body: { autoRates: auto.checked } }); toast(auto.checked ? 'Rates will follow the European Central Bank' : 'Automatic rates off'); reload(); } catch (e) { toast(e.message); }
    });
    return [
      h('section', { class: 'card x-card' },
        h('h3', { text: 'Exchange rates (1 EUR = …)' }),
        h('label', { class: 'x-check' }, auto, 'Update every day from the European Central Bank'),
        h('div', { class: 'x-rates' }, rateInputs.map(([c, inp]) => h('label', null, c, inp)), h('label', null, 'Add currency', extraCur), h('label', null, 'Rate', extraRate)),
        h('p', { class: 'muted x-note', text: 'Each month keeps the rate it was converted with, so past months do not change when the dollar moves. Typing a rate turns the daily update off.' }),
        h('div', null, h('button', { type: 'button', class: 'btn btn-light', text: 'Save rates', onclick: saveRates }))),
      h('section', { class: 'card x-card' },
        h('h3', { text: 'Renewal reminder emails' }),
        h('p', { class: 'muted x-note', text: 'A recurring cost with a reminder emails this address once before it renews.' }),
        h('label', null, 'Send to', email),
        h('div', null, h('button', { type: 'button', class: 'btn btn-light', text: 'Save', onclick: async () => {
          try { await api('/expenses/settings', { method: 'PUT', body: { remindEmail: email.value } }); toast('Saved'); } catch (e) { toast(e.message); }
        } }))),
      h('section', { class: 'card x-card' },
        h('h3', { text: 'Download expenses' }),
        h('div', { class: 'x-inline x-dl' }, h('label', null, 'From', dlFrom), h('label', null, 'To', dlTo), dlLink),
        h('p', { class: 'muted x-note', text: 'Every cost in the period as a spreadsheet (CSV). To pick clients or categories too, use Download CSV in Reports.' })),
      h('section', { class: 'card x-card' },
        h('h3', { text: 'Backup' }),
        h('p', { class: 'muted x-note', text: 'A copy of everything in Expenses, to keep safe or to restore.' }),
        h('div', { class: 'x-client-row' },
          h('a', { class: 'btn btn-light', href: '/admin/api/expenses/backup', text: 'Download backup' }),
          h('button', { type: 'button', class: 'btn btn-light', text: 'Restore a backup…', onclick: () => restore.click() }), restore))
    ];
  }

  /* ---------------- dialogs ---------------- */
  function dialog(title, content, buttons) {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const form = h('form', { class: 'x-dialog-body', method: 'dialog' }, h('h3', { text: title }), content, err,
      h('div', { class: 'x-dialog-actions' }, buttons(err), h('button', { type: 'button', class: 'btn btn-light', text: 'Cancel', onclick: () => dlg.close() })));
    const dlg = h('dialog', { class: 'x-dialog' }, form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea');
    if (first) first.focus();
    return { dlg, err, form };
  }
  const field = (label, el) => h('label', null, label, el);
  const currencySelect = (value) => {
    const list = Array.from(new Set(['EUR', 'USD', 'GBP', ...Object.keys(S.data.fx.rates).sort()]));
    return h('select', null, list.map((c) => h('option', { value: c, selected: c === (value || 'EUR') ? true : null, text: c })));
  };
  const lists = () => [h('datalist', { id: 'xCats' }, S.data.categories.map((c) => h('option', { value: c }))),
    h('datalist', { id: 'xClients2' }, S.data.clients.map((c) => h('option', { value: c })))];
  async function run(err, dlg, fn, done) {
    err.textContent = '';
    try { await fn(); dlg.close(); toast(done); reload(); } catch (e) { err.textContent = e.message; }
  }

  // an Instagram ad is a one-off expense with the post it promoted and when it ran
  const AD = 'Instagram ads';
  function entryDialog(r, preset) {
    const today = new Date();
    const defDate = S.from <= thisMonth() && thisMonth() <= S.to ? today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate()) : S.month + '-01';
    const f = {
      name: h('input', { required: true, maxlength: '80', value: r ? r.name : '' }),
      date: h('input', { type: 'date', required: true, value: r ? r.date : defDate }),
      amount: h('input', { type: 'number', step: '0.01', min: '0', required: true, value: r ? r.amount : '' }),
      currency: currencySelect(r && r.currency),
      vendor: h('input', { maxlength: '60', value: r ? r.vendor : '', placeholder: 'Who you paid' }),
      category: h('input', { maxlength: '40', list: 'xCats', value: r ? r.category : preset || '' }),
      client: h('input', { maxlength: '60', list: 'xClients2', value: r ? r.client : '', placeholder: 'Optional' }),
      post: h('input', { maxlength: '300', value: r ? r.post || '' : '', placeholder: 'Which post: its caption or link' }),
      campaignFrom: h('input', { type: 'date', value: r ? r.campaignFrom || '' : '' }),
      campaignTo: h('input', { type: 'date', value: r ? r.campaignTo || '' : '' }),
      notes: h('textarea', { rows: '2', maxlength: '400' })
    };
    if (r && r.notes) f.notes.value = r.notes;
    if (!r && preset === AD) { f.name.value = 'Instagram ad'; f.vendor.value = 'Meta'; }
    const adParts = [field('Which post', f.post), field('Campaign started', f.campaignFrom), field('Campaign ended', f.campaignTo)];
    const content = h('div', { class: 'grid2' }, field('What', f.name), field(preset === AD || (r && r.category === AD) ? 'Cost of the campaign' : 'Amount', f.amount), field('Currency', f.currency), field('Date paid', f.date),
      adParts, field('Paid to', f.vendor), field('Category', f.category), field('For a client?', f.client), field('Notes', f.notes), lists());
    const syncAd = () => { const on = f.category.value.trim().toLowerCase() === AD.toLowerCase(); adParts.forEach((p) => { p.hidden = !on; }); };
    f.category.addEventListener('input', syncAd);
    syncAd();
    const val = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    const { dlg } = dialog(r ? 'Edit expense' : preset === AD ? 'New Instagram ad' : 'New one-off expense', content, (err) => [
      h('button', { type: 'submit', class: 'btn btn-dark', text: 'Save', onclick: (e) => { e.preventDefault(); run(err, dlg, () => api('/expenses/entries' + (r ? '/' + r.id : ''), { method: r ? 'PUT' : 'POST', body: val() }), 'Saved'); } }),
      r ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete', onclick: () => {
        if (confirm('Delete this expense?')) run(err, dlg, () => api('/expenses/entries/' + r.id, { method: 'DELETE' }), 'Deleted');
      } }) : null]);
  }

  function planDialog(p) {
    const f = {
      name: h('input', { required: true, maxlength: '80', value: p ? p.name : '', placeholder: 'e.g. Google Workspace' }),
      vendor: h('input', { maxlength: '60', value: p ? p.vendor : '', placeholder: 'e.g. Google' }),
      category: h('input', { maxlength: '40', list: 'xCats', value: p ? p.category : '' }),
      client: h('input', { maxlength: '60', list: 'xClients2', value: p ? p.client : '', placeholder: 'Optional' }),
      currency: currencySelect(p && p.currency),
      every: h('select', null, Object.entries(EVERY).map(([k, v]) => h('option', { value: k, selected: p && String(p.every) === k ? true : null, text: v }))),
      start: h('input', { type: 'date', required: true, value: p ? p.start : '' }),
      remindDays: h('input', { type: 'number', min: '0', max: '120', step: '1', value: p ? p.remindDays : '' , placeholder: '15 for yearly, 0 = off' }),
      notes: h('textarea', { rows: '2', maxlength: '400' })
    };
    if (p && p.notes) f.notes.value = p.notes;
    const amount = h('input', { type: 'number', step: '0.01', min: '0', required: true });
    const parts = [field('Name', f.name), field('Paid to', f.vendor), field('Category', f.category), field('For a client?', f.client),
      p ? null : field('Price', amount), field('Currency', f.currency), field('Repeats', f.every),
      field(p ? 'First charge (sets the billing day)' : 'First charge date', f.start), field('Remind me … days before', f.remindDays), field('Notes', f.notes), lists()];
    const content = [h('div', { class: 'grid2' }, parts)];

    if (p) {
      const newPrice = h('input', { type: 'number', step: '0.01', min: '0', placeholder: 'New price' });
      const from = h('input', { type: 'month', value: thisMonth() });
      const stopFrom = h('input', { type: 'month', value: p.stop || shift(thisMonth(), 1) });
      const history = p.prices.map((x) => fmt(x.amount, p.currency) + ' from ' + monthName(x.from)).join(' · ');
      content.push(
        h('div', { class: 'x-box' }, h('h4', { text: 'Change the price' }),
          h('p', { class: 'muted x-note', text: 'Price history: ' + history + '. Months before the new price keep the old one.' }),
          h('div', { class: 'x-inline' }, field('New price', newPrice), field('From month', from),
            h('button', { type: 'button', class: 'btn btn-light', text: 'Apply', onclick: async () => {
              if (!newPrice.value) return toast('Enter the new price');
              try { await api('/expenses/plans/' + p.id + '/price', { method: 'POST', body: { amount: newPrice.value, from: from.value } }); toast('New price from ' + monthName(from.value)); dlgRef.dlg.close(); reload(); } catch (e) { toast(e.message); }
            } }))),
        h('div', { class: 'x-box' }, h('h4', { text: p.stop ? 'Stopped' : 'Stop it' }),
          h('p', { class: 'muted x-note', text: p.stop ? 'No charges from ' + monthName(p.stop) + ' on. The months before stay in the history.' : 'Cancelled the service? Stop it from a month on: the history stays.' }),
          h('div', { class: 'x-inline' }, p.stop ? null : field('First month without it', stopFrom),
            h('button', { type: 'button', class: 'btn btn-light', text: p.stop ? 'Start it again' : 'Stop', onclick: async () => {
              try { await api('/expenses/plans/' + p.id + '/stop', { method: 'POST', body: { from: p.stop ? null : stopFrom.value } }); toast(p.stop ? 'Started again' : 'Stopped from ' + monthName(stopFrom.value)); dlgRef.dlg.close(); reload(); } catch (e) { toast(e.message); }
            } }))));
    }
    const val = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      if (v.remindDays === '') delete v.remindDays;
      if (!p) v.amount = amount.value;
      return v;
    };
    const dlgRef = dialog(p ? 'Edit ' + p.name : 'New recurring cost', content, (err) => [
      h('button', { type: 'submit', class: 'btn btn-dark', text: 'Save', onclick: (e) => { e.preventDefault(); run(err, dlgRef.dlg, () => api('/expenses/plans' + (p ? '/' + p.id : ''), { method: p ? 'PUT' : 'POST', body: val() }), 'Saved'); } }),
      p ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete completely', onclick: () => {
        if (confirm('Delete ' + p.name + ' and all of its history? To keep the history, use Stop instead.')) run(err, dlgRef.dlg, () => api('/expenses/plans/' + p.id, { method: 'DELETE' }), 'Deleted');
      } }) : null]);
  }

  // one month of a recurring cost
  function monthDialog(r) {
    const plan = S.data.plans.find((p) => p.id === r.id);
    const amount = h('input', { type: 'number', step: '0.01', min: '0', value: r.skipped ? '' : r.amount });
    const content = [
      h('p', { class: 'muted', text: 'Only ' + monthName(r.month) + ' changes. To change the price for every month from now on, use Edit plan.' }),
      field('Amount for ' + monthName(r.month) + ' (' + r.currency + ')', amount)];
    const { dlg } = dialog(r.name + ', ' + monthName(r.month), content, (err) => [
      h('button', { type: 'submit', class: 'btn btn-dark', text: 'Save', onclick: (e) => { e.preventDefault(); run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: { month: r.month, amount: amount.value } }), 'Saved for ' + monthName(r.month)); } }),
      h('button', { type: 'button', class: 'btn btn-light', text: r.skipped ? 'Charge it this month' : 'Skip this month', onclick: () => run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: r.skipped ? { month: r.month, reset: true } : { month: r.month, skip: true } }), r.skipped ? 'Back on' : 'Skipped') }),
      r.changed ? h('button', { type: 'button', class: 'btn btn-light', text: 'Back to the plan price', onclick: () => run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: { month: r.month, reset: true } }), 'Back to the plan price') }) : null,
      plan ? h('button', { type: 'button', class: 'btn btn-light', text: 'Edit plan', onclick: () => { dlg.close(); planDialog(plan); } }) : null]);
  }

  function mapDialog(service, client) {
    const inp = h('input', { value: client || '', list: 'xClients2', placeholder: 'Which client?' });
    const { dlg } = dialog('Client for ' + service, [field('Client', inp), lists()], (err) => [
      h('button', { type: 'submit', class: 'btn btn-dark', text: 'Save', onclick: (e) => { e.preventDefault(); run(err, dlg, () => api('/expenses/render-map', { method: 'PUT', body: { map: { [service]: inp.value } } }), 'Saved'); } })]);
  }

  /* ---------------- files ---------------- */
  const readText = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(new Error('Could not read ' + file.name)); r.readAsText(file); });
  async function importRender(files) {
    for (const file of files) {
      try {
        const csv = await readText(file);
        const r = await api('/expenses/render', { method: 'POST', body: { file: file.name, csv } });
        toast(r.label + ': ' + fmt(r.total, 'USD') + (r.final ? '' : ' (estimate)') + (r.replaced ? ', replaced the earlier file' : ''));
      } catch (e) { toast(file.name + ': ' + e.message); }
    }
    reload();
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await readText(file));
      if (!confirm('Add what is in ' + file.name + ' to the expenses? Items already here are kept as they are; Render months in the file replace the same months here.')) return;
      const r = await api('/expenses/import', { method: 'POST', body: { data } });
      toast('Imported ' + r.added + ' item' + (r.added === 1 ? '' : 's'));
      reload();
    } catch (e) { toast(e.message.includes('JSON') ? 'That file is not a backup' : e.message); }
  }

  window.ExpensesView = { open };
})();
