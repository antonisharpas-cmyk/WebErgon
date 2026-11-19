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
  const S = { month: null, data: null };

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

  /* ---------------- load ---------------- */
  async function open(month) {
    S.month = /^\d{4}-\d{2}$/.test(month || '') ? month : (S.month || thisMonth());
    try { S.data = await api('/expenses?month=' + S.month); } catch (e) { toast(e.message); return; }
    render();
  }
  const reload = () => open(S.month);

  /* ---------------- page ---------------- */
  function render() {
    const d = S.data;
    const root = $('#expensesRoot');
    root.replaceChildren(...[
      head(d),
      stats(d),
      d.comingUp.length ? comingUp(d) : null,
      monthTable(d),
      h('div', { class: 'x-two' }, byClient(d), history(d)),
      recurring(d),
      renderCard(d),
      settings(d)
    ].filter(Boolean));
  }

  function head(d) {
    const file = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
    file.addEventListener('change', () => importRender(Array.from(file.files)).finally(() => { file.value = ''; }));
    const restore = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    restore.addEventListener('change', () => importBackup(restore.files[0]).finally(() => { restore.value = ''; }));
    const year = d.month.slice(0, 4);
    const more = h('details', { class: 'x-menu' },
      h('summary', { class: 'btn btn-light', text: 'More' }),
      h('div', { class: 'x-menu-list' },
        h('a', { href: '/admin/api/expenses/export.csv?from=' + d.month + '&to=' + d.month, text: 'Download ' + d.label + ' (CSV)' }),
        h('a', { href: '/admin/api/expenses/export.csv?from=' + year + '-01&to=' + year + '-12', text: 'Download all of ' + year + ' (CSV)' }),
        h('a', { href: '/admin/api/expenses/backup', text: 'Download a backup (JSON)' }),
        h('button', { type: 'button', text: 'Restore from a backup…', onclick: () => restore.click() })));
    return h('header', { class: 'x-head' },
      h('div', null, h('h2', { text: 'Expenses' }), h('p', { class: 'muted', text: 'What ErgonSite pays for, month by month. Totals in euro.' })),
      h('div', { class: 'x-month' },
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Previous month', onclick: () => { location.hash = 'expenses/' + shift(d.month, -1); } }, '‹'),
        h('b', { text: d.label }),
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Next month', onclick: () => { location.hash = 'expenses/' + shift(d.month, 1); } }, '›'),
        d.month !== thisMonth() ? h('button', { type: 'button', class: 'link', text: 'This month', onclick: () => { location.hash = 'expenses/' + thisMonth(); } }) : null),
      h('div', { class: 'x-actions' },
        h('button', { type: 'button', class: 'btn btn-dark', text: '+ Expense', onclick: () => entryDialog() }),
        h('button', { type: 'button', class: 'btn btn-light', text: '+ Instagram ad', onclick: () => entryDialog(null, AD) }),
        h('button', { type: 'button', class: 'btn btn-light', text: '+ Recurring', onclick: () => planDialog() }),
        h('button', { type: 'button', class: 'btn btn-light', text: 'Import Render CSV', onclick: () => file.click() }),
        more, file, restore));
  }

  function stats(d) {
    const t = d.totals;
    const cat = (k) => t.byCategory[k] || 0;
    const rows = d.rows.filter((r) => !r.skipped);
    const sum = (f) => rows.filter(f).reduce((n, r) => n + (r.eur || 0), 0);
    const usd = d.fx.monthRates.USD;
    return h('section', { class: 'x-stats' },
      stat('Total ' + monthName(d.month, true), eur(t.eur), t.estimate ? 'includes estimates and upcoming charges' : 'all charged', true),
      stat('Recurring', eur(sum((r) => r.kind === 'plan')), ((n) => n + (n === 1 ? ' subscription' : ' subscriptions'))(rows.filter((r) => r.kind === 'plan').length)),
      stat('Hosting (Render)', eur(sum((r) => r.kind === 'render')), d.render[d.month] ? (d.render[d.month].final ? 'final bill' : 'estimate, re-import to update') : 'no file for this month'),
      stat('One-off', eur(sum((r) => r.kind === 'entry')), cat('Equipment') ? 'incl. equipment' : ' '),
      h('p', { class: 'x-fx muted' }, usd ? 'Converted at 1 EUR = ' + usd + ' USD' + (d.fx.source === 'ECB' ? ' (European Central Bank' + (d.fx.date ? ', ' + dayName(d.fx.date) : '') + ')' : d.fx.source === 'manual' ? ' (set by hand)' : ' (default, set it below)') : '',
        t.missingRate ? h('b', { class: 'x-warn', text: ' Some costs have no exchange rate yet: add it under Settings.' }) : null));
  }
  function stat(label, value, note, big) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  function comingUp(d) {
    return h('section', { class: 'card x-card' },
      h('h3', { text: 'Coming up' }),
      h('ul', { class: 'x-list' }, d.comingUp.map((c) => h('li', { class: c.due ? 'is-due' : '' },
        h('span', { class: 'x-when' }, h('b', { text: dayName(c.date) }), h('small', { text: inDays(c.days) })),
        h('span', { class: 'x-grow' }, c.name, h('small', { class: 'muted', text: ' · ' + EVERY[c.every] })),
        h('b', { text: fmt(c.amount, c.currency) }),
        c.due ? h('span', { class: 'x-chip is-warn', text: 'Renew soon' }) : null))));
  }

  /* ---------------- the month ---------------- */
  function monthTable(d) {
    if (!d.rows.length) {
      return h('section', { class: 'card x-card' }, h('h3', { text: d.label }), h('p', { class: 'muted', text: 'Nothing for this month yet. Add an expense, a recurring cost, or import Render’s CSV.' }));
    }
    const body = [];
    const free = d.rows.filter((r) => r.kind === 'render' && !r.amount);
    for (const r of d.rows) {
      if (r.kind === 'render' && !r.amount) continue;          // free services: listed under Render below
      const chips = [
        r.kind === 'render' ? h('span', { class: 'x-chip', text: 'Render usage' }) : null,
        r.kind === 'client' ? h('span', { class: 'x-chip', text: 'domain we pay for a client' }) : null,
        r.estimate ? h('span', { class: 'x-chip is-warn', text: 'estimate' }) : null,
        r.upcoming && !r.skipped ? h('span', { class: 'x-chip', text: 'upcoming' }) : null,
        r.changed ? h('span', { class: 'x-chip', text: 'changed this month' }) : null,
        r.skipped ? h('span', { class: 'x-chip', text: 'skipped' }) : null
      ];
      const edit = r.kind === 'plan' ? () => monthDialog(r) : r.kind === 'entry' ? () => entryDialog(r) : r.kind === 'client' ? () => { location.hash = 'clients/c/' + r.clientId; } : () => mapDialog(r.name, r.client);
      const ad = r.kind === 'entry' && (r.post || r.campaignFrom)
        ? h('div', { class: 'x-ad', text: [r.post ? 'Post: ' + r.post : '', r.campaignFrom ? 'Ran ' + dayName(r.campaignFrom) + (r.campaignTo ? ' to ' + dayName(r.campaignTo) : '') : ''].filter(Boolean).join(' · ') }) : null;
      const tr = h('tr', { class: r.skipped ? 'is-off' : '' },
        h('td', { class: 'x-date', text: dayName(r.date).replace(/ \d{4}$/, '') }),
        h('td', null, h('b', { text: r.name }), r.vendor && r.vendor !== r.name ? h('small', { class: 'muted', text: ' · ' + r.vendor }) : null, ad, h('div', { class: 'x-chips' }, chips)),
        h('td', { text: r.client || (r.kind === 'render' ? 'Unassigned' : '') }),
        h('td', { text: r.category }),
        h('td', { class: 'num', text: fmt(r.amount, r.currency) }),
        h('td', { class: 'num', text: r.currency === 'EUR' ? '' : eur(r.eur) }),
        h('td', { class: 'num' }, h('button', { type: 'button', class: 'link', text: r.kind === 'render' ? 'Client' : r.kind === 'client' ? 'Open client' : 'Edit', onclick: edit })));
      body.push(tr);
      if (r.kind === 'render' && r.lines.length) {
        body.push(h('tr', { class: 'x-sub' }, h('td'), h('td', { colspan: '6', class: 'muted', text: r.lines.map((l) => l.charge + ' ' + fmt(l.cost, 'USD')).join(' · ') })));
      }
    }
    return h('section', { class: 'card x-card' },
      h('h3', { text: d.label }),
      h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Date' }), h('th', { text: 'What' }), h('th', { text: 'Client' }), h('th', { text: 'Category' }), h('th', { class: 'num', text: 'Amount' }), h('th', { class: 'num', text: 'In EUR' }), h('th'))),
        h('tbody', null, body,
          free.length ? h('tr', { class: 'x-sub' }, h('td'), h('td', { colspan: '6', class: 'muted', text: 'Free on Render this month: ' + free.map((r) => r.name).join(', ') })) : null),
        h('tfoot', null, h('tr', null, h('td'), h('td', null, h('b', { text: 'Total' })), h('td'), h('td'), h('td'), h('td', { class: 'num' }, h('b', { text: eur(d.totals.eur) })), h('td'))))));
  }

  function bars(items, max) {
    return h('ul', { class: 'x-bars' }, items.map(([label, value, note]) => h('li', null,
      h('span', { class: 'x-bar-label', text: label }),
      h('span', { class: 'x-bar' }, h('i', { style: 'width:' + (max ? Math.max(2, (value / max) * 100) : 0) + '%' })),
      h('b', { text: eur(value) + (note || '') }))));
  }
  function byClient(d) {
    const items = Object.entries(d.totals.byClient).sort((a, b) => b[1] - a[1]);
    const max = Math.max(0, ...items.map((x) => x[1]));
    return h('section', { class: 'card x-card' }, h('h3', { text: 'Per client, ' + monthName(d.month, true) }),
      items.length ? bars(items, max) : h('p', { class: 'muted', text: 'Nothing yet.' }),
      h('p', { class: 'muted x-note', text: 'Costs without a client count as Unassigned. Give each Render service a client below.' }));
  }
  function history(d) {
    const first = d.history.findIndex((x) => x.eur > 0);
    const months = first < 0 ? d.history.slice(-1) : d.history.slice(first);     // skip the empty months before the first cost
    const max = Math.max(0, ...months.map((x) => x.eur));
    return h('section', { class: 'card x-card' }, h('h3', { text: months.length < 12 ? 'Month by month' : 'Last 12 months' }),
      bars(months.map((x) => [monthName(x.month, true) + ' ' + x.month.slice(2, 4), x.eur, x.estimate ? ' *' : '']), max),
      h('p', { class: 'muted x-note', text: '* includes estimates or charges still to come.' }));
  }

  /* ---------------- recurring ---------------- */
  function recurring(d) {
    return h('section', { class: 'card x-card' },
      h('div', { class: 'x-card-head' }, h('h3', { text: 'Recurring costs' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Recurring', onclick: () => planDialog() })),
      d.plans.length ? h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Name' }), h('th', { text: 'Repeats' }), h('th', { class: 'num', text: 'Price now' }), h('th', { text: 'Next charge' }), h('th', { text: 'Reminder' }), h('th'))),
        h('tbody', null, d.plans.map((p) => h('tr', { class: p.stop && p.stop <= thisMonth() ? 'is-off' : '' },
          h('td', null, h('b', { text: p.name }), p.vendor ? h('small', { class: 'muted', text: ' · ' + p.vendor }) : null,
            p.stop ? h('div', { class: 'x-chips' }, h('span', { class: 'x-chip', text: 'stopped from ' + monthName(p.stop) })) : null),
          h('td', { text: EVERY[p.every] }),
          h('td', { class: 'num', text: fmt(p.currentPrice, p.currency) }),
          h('td', { text: p.next ? dayName(p.next) : '—' }),
          h('td', { text: p.remindDays ? p.remindDays + ' days before' : 'off' }),
          h('td', { class: 'num' }, h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => planDialog(p) }))))))) :
        h('p', { class: 'muted', text: 'No recurring costs yet. Add Google Workspace, the domain, and so on.' }));
  }

  /* ---------------- Render ---------------- */
  function renderCard(d) {
    const months = Object.entries(d.render).sort((a, b) => b[0].localeCompare(a[0]));
    const inputs = {};
    const mapRows = d.services.map((s) => {
      const inp = h('input', { value: d.renderMap[s.toLowerCase()] || '', list: 'xClients', placeholder: 'Which client?', 'aria-label': 'Client for ' + s });
      inputs[s] = inp;
      return h('label', null, s, inp);
    });
    const save = h('button', { type: 'button', class: 'btn btn-dark', text: 'Save clients', onclick: async () => {
      const map = {};
      for (const [s, inp] of Object.entries(inputs)) map[s] = inp.value;
      try { await api('/expenses/render-map', { method: 'PUT', body: { map } }); toast('Clients saved'); reload(); } catch (e) { toast(e.message); }
    } });
    return h('section', { class: 'card x-card' },
      h('h3', { text: 'Render hosting' }),
      h('p', { class: 'muted x-note', text: 'In Render: Billing › download the usage CSV for each month. The current month’s “unbilled charges” file is an estimate: import it again whenever you like, and import the final file once the month is billed. A new file for a month replaces the old one.' }),
      months.length ? h('ul', { class: 'x-list' }, months.map(([m, r]) => h('li', null,
        h('span', { class: 'x-grow' }, h('b', { text: monthName(m) }), h('small', { class: 'muted', text: ' · ' + (r.file || 'imported') })),
        h('span', { class: 'x-chip' + (r.final ? '' : ' is-warn'), text: r.final ? 'final' : 'estimate' }),
        h('button', { type: 'button', class: 'link', text: 'Remove', onclick: async () => {
          if (!confirm('Remove the Render file for ' + monthName(m) + '?')) return;
          try { await api('/expenses/render/' + m, { method: 'DELETE' }); toast('Removed'); reload(); } catch (e) { toast(e.message); }
        } })))) : h('p', { class: 'muted', text: 'No Render files yet.' }),
      d.services.length ? [h('h4', { text: 'Which client is each service?' }),
        h('div', { class: 'x-mapgrid' }, mapRows), h('div', null, save)] : null,
      h('datalist', { id: 'xClients' }, d.clients.map((c) => h('option', { value: c }))));
  }

  /* ---------------- settings ---------------- */
  function settings(d) {
    const curs = Object.keys(d.fx.rates).filter((c) => ['USD', 'GBP'].includes(c) || d.rows.some((r) => r.currency === c) || d.plans.some((p) => p.currency === c));
    const auto = h('input', { type: 'checkbox', checked: d.settings.autoRates ? true : null });
    const rateInputs = curs.map((c) => [c, h('input', { type: 'number', step: '0.0001', min: '0', value: d.fx.rates[c], 'aria-label': '1 EUR in ' + c })]);
    const extraCur = h('input', { placeholder: 'e.g. CHF', maxlength: '3', 'aria-label': 'Another currency' });
    const extraRate = h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'rate', 'aria-label': 'Its rate' });
    const email = h('input', { type: 'email', value: d.settings.remindEmail || '', placeholder: d.settings.defaultEmail });
    const saveRates = async () => {
      const rates = {};
      for (const [c, inp] of rateInputs) rates[c] = inp.value;
      if (extraCur.value.trim() && extraRate.value) rates[extraCur.value.trim().toUpperCase()] = extraRate.value;
      try { await api('/expenses/settings', { method: 'PUT', body: { rates } }); toast('Rates saved. Automatic updates are now off.'); reload(); } catch (e) { toast(e.message); }
    };
    auto.addEventListener('change', async () => {
      try { await api('/expenses/settings', { method: 'PUT', body: { autoRates: auto.checked } }); toast(auto.checked ? 'Rates will follow the European Central Bank' : 'Automatic rates off'); reload(); } catch (e) { toast(e.message); }
    });
    return h('section', { class: 'card x-card' },
      h('h3', { text: 'Settings' }),
      h('h4', { text: 'Exchange rates (1 EUR = …)' }),
      h('label', { class: 'x-check' }, auto, 'Update every day from the European Central Bank'),
      h('div', { class: 'x-rates' }, rateInputs.map(([c, inp]) => h('label', null, c, inp)), h('label', null, 'Add currency', extraCur), h('label', null, 'Rate', extraRate)),
      h('p', { class: 'muted x-note', text: 'Each month keeps the rate it was converted with, so past months do not change when the dollar moves. Typing a rate here turns the daily update off for now.' }),
      h('div', null, h('button', { type: 'button', class: 'btn btn-light', text: 'Save rates', onclick: saveRates })),
      h('h4', { text: 'Renewal reminder emails' }),
      h('label', null, 'Send reminders to', email),
      h('div', null, h('button', { type: 'button', class: 'btn btn-light', text: 'Save', onclick: async () => {
        try { await api('/expenses/settings', { method: 'PUT', body: { remindEmail: email.value } }); toast('Saved'); } catch (e) { toast(e.message); }
      } })));
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
    const defDate = S.month === thisMonth() ? today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate()) : S.month + '-01';
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
      h('p', { class: 'muted', text: 'Only ' + S.data.label + ' changes. To change the price for every month from now on, use Edit plan.' }),
      field('Amount for ' + S.data.label + ' (' + r.currency + ')', amount)];
    const { dlg } = dialog(r.name + ', ' + S.data.label, content, (err) => [
      h('button', { type: 'submit', class: 'btn btn-dark', text: 'Save', onclick: (e) => { e.preventDefault(); run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: { month: S.month, amount: amount.value } }), 'Saved for ' + S.data.label); } }),
      h('button', { type: 'button', class: 'btn btn-light', text: r.skipped ? 'Charge it this month' : 'Skip this month', onclick: () => run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: r.skipped ? { month: S.month, reset: true } : { month: S.month, skip: true } }), r.skipped ? 'Back on' : 'Skipped') }),
      r.changed ? h('button', { type: 'button', class: 'btn btn-light', text: 'Back to the plan price', onclick: () => run(err, dlg, () => api('/expenses/plans/' + r.id + '/month', { method: 'POST', body: { month: S.month, reset: true } }), 'Back to the plan price') }) : null,
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
