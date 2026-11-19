/* =====================================================================
   ErgonSite console: Clients (owners only).

   #clients            everyone, what is coming up, what is unpaid
   #clients/c/ID       one client: charges, payments, logins, emails
   #clients/outbox     emails to clients waiting for approval
   #clients/report     money in against costs, per client, per year
   #clients/settings   reminder timing and the wording used in emails
   Uses the helpers console.js puts on window.ErgonConsole.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { $, h, api, toast } = C;

  const S = { data: null, tab: 'list' };
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmt = (n, cur) => { try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur || 'EUR' }).format(n || 0); } catch (e) { return (n || 0).toFixed(2); } };
  const day = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const inDays = (n) => (n < 0 ? Math.abs(n) + ' days ago' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
  const ts = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pill = (key, label) => h('span', { class: 'x-chip st-' + key, text: label });
  const root = () => $('#clientsRoot');

  /* ---------------- routing ---------------- */
  async function open(rest) {
    const parts = (rest || '').split('/').filter(Boolean);
    try { S.data = await api('/clients'); } catch (e) { toast(e.message); return; }
    if (parts[0] === 'c' && parts[1]) return clientPage(parts[1]);
    if (parts[0] === 'outbox') return outboxPage();
    if (parts[0] === 'report') return reportPage(parts[1]);
    if (parts[0] === 'settings') return settingsPage();
    return listPage();
  }
  const go = (hash) => { if (location.hash === '#' + hash) open(hash.replace(/^clients\/?/, '')); else location.hash = hash; };
  const reload = () => open(location.hash.replace(/^#clients\/?/, ''));

  function tabs(active) {
    const d = S.data;
    const t = (key, label, hash, badge) => h('a', { href: '#' + hash, class: active === key ? 'is-on' : '' }, label, badge ? h('b', { class: 'badge badge-warn', text: badge }) : null);
    return h('nav', { class: 'x-tabs' },
      t('list', 'Clients', 'clients'),
      t('outbox', 'Emails to approve', 'clients/outbox', d.drafts || null),
      t('report', 'Profit & costs', 'clients/report'),
      t('settings', 'Settings', 'clients/settings'));
  }
  function page(active, ...content) {
    const notes = [];
    if (!S.data.mail) notes.push(h('p', { class: 'x-banner', text: 'Email is not set up on the server, so emails to clients cannot be sent yet. Drafts are still prepared.' }));
    if (!S.data.vault) notes.push(h('p', { class: 'x-banner', text: 'VAULT_KEY is not set on Render yet, so client passwords cannot be saved. Usernames and links work already.' }));
    root().replaceChildren(...[h('header', { class: 'x-head' }, h('div', null, h('h2', { text: 'Clients' }), h('p', { class: 'muted', text: 'What each client pays, what is due, and their logins.' }))),
      tabs(active), ...notes, ...content].filter(Boolean));
  }

  /* ---------------- all clients ---------------- */
  function listPage() {
    const d = S.data;
    const open = d.clients.reduce((n, c) => n + c.open, 0);
    const soon = d.upcoming.filter((c) => c.days >= 0 && c.days <= 60).length;
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; fileIn.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!confirm('Add the clients and charges in ' + f.name + '? Clients with the same name are kept and get the new charges.')) return;
        const r = await api('/clients/import', { method: 'POST', body: { data } });
        toast('Imported ' + r.added + ' items'); reload();
      } catch (e) { toast(e.message.includes('JSON') ? 'That file is not a clients file' : e.message); }
    });

    page('list',
      h('div', { class: 'x-actions x-actions-left' },
        h('button', { type: 'button', class: 'btn btn-dark', text: '+ Client', onclick: () => clientDialog() }),
        h('button', { type: 'button', class: 'btn btn-light', text: 'Import file', onclick: () => fileIn.click() }), fileIn),
      h('section', { class: 'x-stats' },
        stat('To collect', fmt(open), d.unpaid.length + ' unpaid charge' + (d.unpaid.length === 1 ? '' : 's'), true),
        stat('Clients', String(d.clients.length), d.clients.filter((c) => c.overdue).length + ' with something overdue'),
        stat('Renewals, 60 days', String(soon), 'maintenance and domains'),
        stat('Emails to approve', String(d.drafts), d.drafts ? 'waiting for you' : 'nothing waiting')),
      d.upcoming.length ? h('section', { class: 'card x-card' }, h('h3', { text: 'Renewals coming up' }),
        h('ul', { class: 'x-list' }, d.upcoming.map((c) => h('li', { class: c.days <= 30 ? 'is-due' : '' },
          h('span', { class: 'x-when' }, h('b', { text: day(c.end) }), h('small', { text: inDays(c.days) })),
          h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.typeLabel + (c.domainName ? ' ' + c.domainName : '') })),
          c.type === 'domain' ? h('small', { class: 'muted', text: 'client renews it' }) : h('b', { text: fmt(c.amount, c.currency) }),
          pill(c.status, c.statusLabel))))) : null,
      d.unpaid.length ? h('section', { class: 'card x-card' }, h('h3', { text: 'Unpaid' }),
        h('ul', { class: 'x-list' }, d.unpaid.map((c) => h('li', null,
          h('span', { class: 'x-when' }, h('b', { text: c.start ? day(c.start) : 'no due date' }), h('small', { text: c.start ? 'due' : 'set one to send reminders' })),
          h('span', { class: 'x-grow' }, h('a', { href: '#clients/c/' + c.clientId, text: c.client }), h('small', { class: 'muted', text: ' · ' + c.description })),
          h('b', { text: fmt(c.open, c.currency) }),
          pill(c.status, c.status === 'part' || (c.status === 'overdue' && c.paid) ? 'part paid' : c.statusLabel))))) : null,
      h('section', { class: 'x-grid' }, d.clients.map((c) => h('a', { class: 'x-client', href: '#clients/c/' + c.id },
        h('b', { text: c.name }),
        h('small', { class: 'muted', text: c.website || c.email || ' ' }),
        h('div', { class: 'x-client-row' },
          c.open ? h('span', { class: 'x-chip ' + (c.overdue ? 'st-overdue' : 'st-pending'), text: fmt(c.open) + ' open' }) : h('span', { class: 'x-chip st-paid', text: 'all paid' }),
          c.nextRenewal ? h('span', { class: 'x-chip', text: c.nextRenewal.type.split(' ')[0] + ' ' + day(c.nextRenewal.date) }) : null,
          c.drafts ? h('span', { class: 'x-chip st-soon', text: c.drafts + ' email' + (c.drafts === 1 ? '' : 's') }) : null)))),
      d.clients.length ? null : h('p', { class: 'muted', text: 'No clients yet. Add one, or import the starter file.' }));
  }
  function stat(label, value, note, big) {
    return h('div', { class: 'x-stat' + (big ? ' is-big' : '') }, h('span', { class: 'muted', text: label }), h('b', { text: value }), h('small', { class: 'muted', text: note }));
  }

  /* ---------------- one client ---------------- */
  async function clientPage(cid) {
    let d;
    try { d = await api('/clients/c/' + cid); } catch (e) { toast(e.message); return go('clients'); }
    const c = d.client;
    const facts = h('dl', { class: 'facts' },
      c.contact ? [h('dt', { text: 'Contact' }), h('dd', { text: c.contact })] : null,
      h('dt', { text: 'Email' }), h('dd', null, c.email ? h('a', { href: 'mailto:' + c.email, text: c.email }) : h('span', { class: 'x-warn', text: 'missing: emails cannot be sent' })),
      c.phone ? [h('dt', { text: 'Phone' }), h('dd', null, h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), text: c.phone }))] : null,
      c.website ? [h('dt', { text: 'Website' }), h('dd', null, h('a', { href: /^https?:/.test(c.website) ? c.website : 'https://' + c.website, target: '_blank', rel: 'noopener', text: c.website }))] : null,
      c.domain ? [h('dt', { text: 'Domain' }), h('dd', { text: c.domain })] : null,
      c.notes ? [h('dt', { text: 'Notes' }), h('dd', { class: 'message-text', text: c.notes })] : null,
      c.paused ? [h('dt', { text: 'Emails' }), h('dd', { class: 'x-warn', text: 'paused for this client' })] : null);

    const rows = d.charges.map((ch) => {
      const period = ch.type === 'maintenance' || ch.type === 'domain' ? day(ch.start) + ' to ' + day(ch.end) : ch.start ? 'due ' + day(ch.start) : 'no due date';
      return h('tr', { class: ch.renewedTo ? 'is-done' : '' },
        h('td', null, h('b', { text: ch.typeLabel }), h('div', { class: 'muted', text: ch.type === 'domain' ? [ch.domainName, ch.registrar, ch.domainCost].filter(Boolean).join(' · ') : ch.description })),
        h('td', { class: 'x-date', text: period }),
        h('td', { class: 'num', text: ch.type === 'domain' ? 'client pays' : fmt(ch.amount, ch.currency) }),
        h('td', { class: 'num', text: ch.type === 'domain' ? '' : fmt(ch.paid, ch.currency) }),
        h('td', null, pill(ch.status, ch.statusLabel)),
        h('td', { class: 'num' }, h('div', { class: 'x-row-actions' },
          ch.type !== 'domain' && ch.open > 0 ? h('button', { type: 'button', class: 'link', text: 'Payment', onclick: () => paymentDialog(ch) }) : null,
          (ch.type === 'maintenance' || ch.type === 'domain') && !ch.renewedTo ? h('button', { type: 'button', class: 'link', text: ch.type === 'domain' ? 'Mark renewed' : 'Renew', onclick: () => renewDialog(ch) }) : null,
          h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => chargeDialog(c, ch) }))));
    });

    const logins = d.logins.map((l) => {
      const pwSpan = h('span', { class: 'x-secret', text: l.hasPassword ? '••••••••••' : 'no password saved' });
      const reveal = async () => (await api('/clients/logins/' + l.id + '/reveal', { method: 'POST' })).password;
      return h('li', null,
        h('div', { class: 'x-grow' },
          h('b', { text: l.label }), l.url ? [' · ', h('a', { href: /^https?:/.test(l.url) ? l.url : 'https://' + l.url, target: '_blank', rel: 'noopener', text: l.url })] : null,
          h('div', { class: 'x-login-line' },
            h('span', { class: 'muted', text: 'User ' }), h('code', { text: l.username || '—' }),
            l.username ? h('button', { type: 'button', class: 'link', text: 'Copy', onclick: () => copy(l.username, 'Username copied') }) : null,
            h('span', { class: 'muted', text: '  Password ' }), pwSpan,
            l.hasPassword ? h('button', { type: 'button', class: 'link', text: 'Show', onclick: async (e) => {
              const b = e.currentTarget;
              if (b.textContent === 'Hide') { pwSpan.textContent = '••••••••••'; b.textContent = 'Show'; return; }
              try { pwSpan.textContent = await reveal(); b.textContent = 'Hide'; setTimeout(() => { pwSpan.textContent = '••••••••••'; b.textContent = 'Show'; }, 30000); } catch (err) { toast(err.message); }
            } }) : null,
            l.hasPassword ? h('button', { type: 'button', class: 'link', text: 'Copy', onclick: async () => { try { copy(await reveal(), 'Password copied'); } catch (err) { toast(err.message); } } }) : null),
          l.lastShownBy ? h('small', { class: 'muted', text: 'Last opened by ' + l.lastShownBy + ', ' + ts(l.lastShownAt) }) : null),
        h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => loginDialog(c, l) }));
    });

    const emails = d.emails.map((o) => h('li', null,
      h('span', { class: 'x-when' }, h('b', { text: ts(o.sentAt || o.dismissedAt || o.createdAt).split(',')[0] }), h('small', { text: o.status })),
      h('span', { class: 'x-grow', text: o.subject }),
      o.status === 'draft' ? h('a', { href: '#clients/outbox', text: 'Review' }) : null));

    page('list',
      h('div', { class: 'x-crumbs' }, h('a', { href: '#clients', text: '‹ All clients' })),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { class: 'x-big', text: c.name }),
          h('div', { class: 'x-actions' }, h('button', { type: 'button', class: 'btn btn-light', text: 'Edit client', onclick: () => clientDialog(c) }))),
        facts,
        h('div', { class: 'x-client-row' }, c.open ? pill(c.overdue ? 'overdue' : 'pending', fmt(c.open) + ' open') : pill('paid', 'all paid'), h('span', { class: 'muted', text: 'Paid so far ' + fmt(c.paidTotal) }))),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Charges' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Charge', onclick: () => chargeDialog(c) })),
        rows.length ? h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
          h('thead', null, h('tr', null, h('th', { text: 'What' }), h('th', { text: 'When' }), h('th', { class: 'num', text: 'Amount' }), h('th', { class: 'num', text: 'Paid' }), h('th', { text: 'Status' }), h('th'))),
          h('tbody', null, rows))) : h('p', { class: 'muted', text: 'No charges yet.' })),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Logins' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Login', onclick: () => loginDialog(c) })),
        logins.length ? h('ul', { class: 'x-list' }, logins) : h('p', { class: 'muted', text: 'Save the client’s admin page link with our username and password here. Passwords are encrypted and only owners can open them.' })),
      h('section', { class: 'card x-card' }, h('h3', { text: 'Emails' }),
        emails.length ? h('ul', { class: 'x-list' }, emails) : h('p', { class: 'muted', text: 'No emails yet. Renewal notices and payment reminders appear here.' })));
  }
  function copy(text, done) {
    navigator.clipboard.writeText(text).then(() => toast(done), () => toast('Could not copy'));
  }

  /* ---------------- emails to approve ---------------- */
  async function outboxPage() {
    let d;
    try { d = await api('/clients/outbox'); } catch (e) { toast(e.message); return; }
    const cards = d.drafts.map((o) => {
      const to = h('input', { value: o.to, 'aria-label': 'To' });
      const subject = h('input', { value: o.subject, 'aria-label': 'Subject' });
      const text = h('textarea', { rows: '12', 'aria-label': 'Message' });
      text.value = o.text;
      const body = () => ({ to: to.value, subject: subject.value, text: text.value });
      const sendBtn = h('button', { type: 'button', class: 'btn btn-dark', text: 'Send to client', onclick: async () => {
        if (!confirm('Send this email to ' + to.value + '?')) return;
        sendBtn.disabled = true;
        try { await api('/clients/outbox/' + o.id + '/send', { method: 'POST', body: body() }); toast('Sent to ' + to.value); reload(); }
        catch (e) { toast(e.message); sendBtn.disabled = false; }
      } });
      return h('section', { class: 'card x-card x-draft' },
        h('div', { class: 'x-card-head' },
          h('div', null, h('h3', null, h('a', { href: '#clients/c/' + o.clientId, text: o.client || 'Client' })),
            h('small', { class: 'muted', text: (o.kind === 'renewal' ? 'Renewal notice' : 'Payment reminder') + ' · prepared ' + ts(o.createdAt) })),
          pill(o.kind === 'renewal' ? 'soon' : 'pending', o.kind === 'renewal' ? 'renewal' : 'payment')),
        h('label', null, 'To', to), h('label', null, 'Subject', subject), h('label', null, 'Message', text),
        o.kind === 'renewal' ? h('p', { class: 'muted x-note', text: 'Sending a maintenance renewal also opens next year’s charge on the client, so you can track its payment.' }) : null,
        h('div', { class: 'x-dialog-actions' }, sendBtn,
          h('button', { type: 'button', class: 'btn btn-light', text: 'Save changes', onclick: async () => {
            try { await api('/clients/outbox/' + o.id, { method: 'PUT', body: body() }); toast('Saved'); } catch (e) { toast(e.message); }
          } }),
          h('button', { type: 'button', class: 'btn btn-light', text: 'Don’t send', onclick: async () => {
            try { await api('/clients/outbox/' + o.id + '/dismiss', { method: 'POST' }); toast('Removed from the list'); reload(); } catch (e) { toast(e.message); }
          } })));
    });
    page('outbox',
      h('p', { class: 'muted x-note', text: 'Every day the console prepares renewal notices (' + S.data.settings.remindDays + ' days before a maintenance year or a domain ends) and payment reminders (on the due date, then every ' + S.data.settings.chaseDays + ' days while unpaid). Nothing reaches a client until you press Send. Emails go from info@ergonsite.com, and replies come back there.' }),
      ...(cards.length ? cards : [h('section', { class: 'card x-card' }, h('p', { class: 'muted', text: 'Nothing waiting. New drafts appear here, and you get an email when they do.' }))]),
      d.history.length ? h('section', { class: 'card x-card' }, h('h3', { text: 'Sent and skipped' }),
        h('ul', { class: 'x-list' }, d.history.map((o) => h('li', null,
          h('span', { class: 'x-when' }, h('b', { text: ts(o.sentAt || o.dismissedAt).split(',')[0] }), h('small', { text: o.status === 'sent' ? 'sent by ' + (o.sentBy || '') : 'not sent' + (o.dismissedBy === 'paid' ? ': paid' : o.dismissedBy === 'renewed' ? ': renewed' : '') })),
          h('span', { class: 'x-grow' }, h('b', { text: (o.client || '') + ' ' }), h('span', { class: 'muted', text: o.subject })))))) : null);
  }

  /* ---------------- profit & costs ---------------- */
  async function reportPage(yearArg) {
    const year = Number(yearArg) || new Date().getFullYear();
    let r;
    try { r = await api('/clients/report?year=' + year); } catch (e) { toast(e.message); return; }
    const t = r.totals;
    page('report',
      h('div', { class: 'x-month' },
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Previous year', onclick: () => go('clients/report/' + (year - 1)) }, '‹'),
        h('b', { text: String(year) }),
        h('button', { type: 'button', class: 'x-arrow', 'aria-label': 'Next year', onclick: () => go('clients/report/' + (year + 1)) }, '›')),
      h('section', { class: 'x-stats' },
        stat('Profit ' + year, fmt(t.profit), 'money received minus all costs', true),
        stat('Received', fmt(t.received), 'payments in ' + year),
        stat('Costs', fmt(t.costs), 'from Expenses, all of ' + year),
        stat('Still to collect', fmt(t.open), 'unpaid charges, any year')),
      h('section', { class: 'card x-card' }, h('h3', { text: 'Per client' }),
        h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
          h('thead', null, h('tr', null, h('th', { text: 'Client' }), h('th', { class: 'num', text: 'Billed in ' + year }), h('th', { class: 'num', text: 'Received' }), h('th', { class: 'num', text: 'Open' }), h('th', { class: 'num', text: 'Their costs' }), h('th', { class: 'num', text: 'Profit' }))),
          h('tbody', null, r.rows.map((x) => h('tr', null,
            h('td', null, h('a', { href: '#clients/c/' + x.id, text: x.name })),
            h('td', { class: 'num', text: fmt(x.billed) }), h('td', { class: 'num', text: fmt(x.received) }), h('td', { class: 'num', text: x.open ? fmt(x.open) : '' }),
            h('td', { class: 'num', text: fmt(x.costs) }), h('td', { class: 'num' }, h('b', { class: x.profit < 0 ? 'x-neg' : '', text: fmt(x.profit) })))),
            h('tr', null, h('td', null, h('span', { class: 'muted', text: 'ErgonSite itself (email, domain, our website, unassigned)' })), h('td'), h('td'), h('td'), h('td', { class: 'num', text: fmt(r.company) }), h('td', { class: 'num', text: fmt(-r.company) }))),
          h('tfoot', null, h('tr', null, h('td', null, h('b', { text: 'Total' })), h('td', { class: 'num', text: fmt(t.billed) }), h('td', { class: 'num', text: fmt(t.received) }), h('td', { class: 'num', text: fmt(t.open) }), h('td', { class: 'num', text: fmt(t.costs) }), h('td', { class: 'num' }, h('b', { text: fmt(t.profit) })))))),
        h('p', { class: 'muted x-note', text: 'Received counts payments made in ' + year + '. Costs come from the Expenses section, matched by client name (hosting on Render, and anything else you tag with the client). Profit = received minus costs.' })));
  }

  /* ---------------- settings ---------------- */
  function settingsPage() {
    const s = S.data.settings;
    const remind = h('input', { type: 'number', min: '1', max: '180', value: s.remindDays });
    const chase = h('input', { type: 'number', min: '3', max: '90', value: s.chaseDays });
    const payText = h('textarea', { rows: '3', maxlength: '600' }); payText.value = s.paymentText;
    const sign = h('input', { value: s.signature, maxlength: '80' });
    const digest = h('input', { type: 'checkbox', checked: s.digest ? true : null });
    page('settings',
      h('section', { class: 'card x-card' }, h('h3', { text: 'Client emails' }),
        h('div', { class: 'grid2' },
          h('label', null, 'Renewal notice, days before the end', remind),
          h('label', null, 'Payment reminder, repeat every … days', chase)),
        h('label', null, 'How to pay (used in renewal notices and payment reminders)', payText),
        h('label', null, 'Signed', sign),
        h('label', { class: 'x-check' }, digest, 'Email info@ergonsite.com when new client emails are waiting for approval'),
        h('div', null, h('button', { type: 'button', class: 'btn btn-dark', text: 'Save', onclick: async () => {
          try {
            await api('/clients/settings', { method: 'PUT', body: { remindDays: remind.value, chaseDays: chase.value, paymentText: payText.value, signature: sign.value, digest: digest.checked } });
            toast('Saved'); reload();
          } catch (e) { toast(e.message); }
        } }))),
      h('section', { class: 'card x-card' }, h('h3', { text: 'Logins' }),
        h('p', { class: 'muted x-note', text: S.data.vault
          ? 'Passwords are encrypted with VAULT_KEY from Render. Keep that key the same: logins saved with one key cannot be opened with another.'
          : 'Add VAULT_KEY in Render, Environment: a long random text (for example two random passwords joined). Then passwords can be saved. Never change it afterwards.' })));
  }

  /* ---------------- dialogs ---------------- */
  function dialog(title, content, buttons) {
    const err = h('p', { class: 'form-error', role: 'alert' });
    const dlg = h('dialog', { class: 'x-dialog' });
    const form = h('form', { class: 'x-dialog-body', method: 'dialog' }, h('h3', { text: title }), content, err,
      h('div', { class: 'x-dialog-actions' }, buttons(err, dlg), h('button', { type: 'button', class: 'btn btn-light', text: 'Cancel', onclick: () => dlg.close() })));
    dlg.append(form);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=checkbox]), select, textarea');
    if (first) first.focus();
    return dlg;
  }
  const field = (label, el) => h('label', null, label, el);
  async function run(err, dlg, fn, done, after) {
    err.textContent = '';
    try { const r = await fn(); dlg.close(); toast(done); if (after) after(r); else reload(); } catch (e) { err.textContent = e.message; }
  }
  const save = (label, fn) => (err, dlg) => h('button', { type: 'submit', class: 'btn btn-dark', text: label, onclick: (e) => { e.preventDefault(); fn(err, dlg); } });

  function clientDialog(c) {
    const f = {
      name: h('input', { required: true, maxlength: '80', value: c ? c.name : '' }),
      contact: h('input', { maxlength: '80', value: c ? c.contact || '' : '', placeholder: 'Who we talk to' }),
      email: h('input', { maxlength: '160', value: c ? c.email || '' : '', placeholder: 'Where emails go (two? separate with a comma)' }),
      phone: h('input', { maxlength: '40', value: c ? c.phone || '' : '' }),
      website: h('input', { maxlength: '120', value: c ? c.website || '' : '', placeholder: 'e.g. andreou.law' }),
      domain: h('input', { maxlength: '120', value: c ? c.domain || '' : '' }),
      notes: h('textarea', { rows: '3', maxlength: '2000' })
    };
    if (c && c.notes) f.notes.value = c.notes;
    const paused = h('input', { type: 'checkbox', checked: c && c.paused ? true : null });
    const val = () => Object.assign(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), { paused: paused.checked });
    dialog(c ? 'Edit ' + c.name : 'New client', [h('div', { class: 'grid2' },
      field('Company', f.name), field('Contact person', f.contact), field('Email', f.email), field('Phone', f.phone), field('Website', f.website), field('Domain', f.domain)),
      field('Notes', f.notes), h('label', { class: 'x-check' }, paused, 'Pause all emails to this client'),
      c ? h('p', { class: 'muted x-note', text: 'Renaming also updates the client’s name in Expenses.' }) : null],
    (err, dlg) => [
      save('Save', () => run(err, dlg, () => api(c ? '/clients/c/' + c.id : '/clients', { method: c ? 'PUT' : 'POST', body: val() }), 'Saved', (r) => go('clients/c/' + r.client.id)))(err, dlg),
      c ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete client', onclick: () => {
        if (confirm('Delete ' + c.name + ' with all charges, payments, logins and emails? This cannot be undone.')) run(err, dlg, () => api('/clients/c/' + c.id, { method: 'DELETE' }), 'Deleted', () => go('clients'));
      } }) : null]);
  }

  function chargeDialog(cl, ch) {
    const type = h('select', null, Object.entries(S.data.types).map(([k, v]) => h('option', { value: k, selected: ch && ch.type === k ? true : null, text: v })));
    const f = {
      description: h('input', { maxlength: '120', value: ch ? ch.description : '', placeholder: 'e.g. Website, first half' }),
      amount: h('input', { type: 'number', step: '0.01', min: '0', value: ch && ch.amount !== null ? ch.amount : '' }),
      start: h('input', { type: 'date', value: ch ? ch.start || '' : today() }),
      end: h('input', { type: 'date', value: ch ? ch.end || '' : '' }),
      domainName: h('input', { maxlength: '120', value: ch ? ch.domainName || '' : cl.domain || '', placeholder: 'e.g. andreou.law' }),
      registrar: h('input', { maxlength: '60', value: ch ? ch.registrar || '' : 'Porkbun' }),
      domainCost: h('input', { maxlength: '60', value: ch ? ch.domainCost || '' : 'about $11', placeholder: 'what the client pays the registrar' }),
      remindDays: h('input', { type: 'number', min: '0', max: '180', value: ch && ch.remindDays !== undefined ? ch.remindDays : '', placeholder: String(S.data.settings.remindDays) })
    };
    const paidNow = h('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' });
    const method = h('select', null, S.data.methods.map((m) => h('option', { value: m, text: m })));
    const noRem = h('input', { type: 'checkbox', checked: ch && ch.noReminders ? true : null });
    const labels = { start: h('span'), end: h('span') };
    const wrap = (k, label) => { labels[k].textContent = label; return h('label', null, labels[k], f[k]); };
    const parts = {
      description: field('Description', f.description), amount: field('Amount (EUR)', f.amount),
      start: wrap('start', 'Start'), end: wrap('end', 'End'),
      domainName: field('Domain', f.domainName), registrar: field('Registered at', f.registrar), domainCost: field('Client pays the registrar', f.domainCost),
      remindDays: field('Renewal notice, days before', f.remindDays), paidNow: field('Already paid', paidNow), method: field('Paid by', method)
    };
    const sync = () => {
      const t = type.value, dom = t === 'domain', yearly = t === 'maintenance' || dom;
      parts.amount.hidden = dom;
      parts.end.hidden = !yearly; parts.remindDays.hidden = !yearly;
      parts.domainName.hidden = parts.registrar.hidden = parts.domainCost.hidden = !dom;
      parts.paidNow.hidden = parts.method.hidden = dom || !!ch;
      labels.start.textContent = yearly ? (dom ? 'Registered / renewed on' : 'Start') : 'Due date';
      labels.end.textContent = dom ? 'Expires on' : 'End';
      if (yearly && !f.end.value && f.start.value) {
        const d = new Date(f.start.value + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1);
        f.end.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      }
    };
    type.addEventListener('change', sync);
    f.start.addEventListener('change', () => { if (!ch) { f.end.value = ''; sync(); } });
    const val = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      v.type = type.value; v.noReminders = noRem.checked;
      if (!ch) { v.paidNow = paidNow.value; v.method = method.value; v.paidOn = f.start.value || today(); }
      return v;
    };
    const content = [h('div', { class: 'grid2' }, field('What for', type), Object.values(parts)),
      h('label', { class: 'x-check' }, noRem, 'No emails for this charge')];
    if (ch && ch.payments && ch.payments.length) {
      content.push(h('div', { class: 'x-box' }, h('h4', { text: 'Payments' }), h('ul', { class: 'x-list' }, ch.payments.map((p) => h('li', null,
        h('span', { class: 'x-grow', text: day(p.date) + ' · ' + p.method + (p.note ? ' · ' + p.note : '') }), h('b', { text: fmt(p.amount) }),
        h('button', { type: 'button', class: 'link', text: 'Remove', onclick: async () => {
          if (!confirm('Remove this payment?')) return;
          try { await api('/clients/charges/' + ch.id + '/payments/' + p.id, { method: 'DELETE' }); toast('Payment removed'); document.querySelector('dialog.x-dialog').close(); reload(); } catch (e) { toast(e.message); }
        } }))))));
    }
    dialog(ch ? 'Edit charge' : 'New charge for ' + cl.name, content, (err, dlg) => [
      save('Save', () => run(err, dlg, () => api(ch ? '/clients/charges/' + ch.id : '/clients/c/' + cl.id + '/charges', { method: ch ? 'PUT' : 'POST', body: val() }), 'Saved'))(err, dlg),
      ch ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete', onclick: () => {
        if (confirm('Delete this charge and its payments?')) run(err, dlg, () => api('/clients/charges/' + ch.id, { method: 'DELETE' }), 'Deleted');
      } }) : null]);
    sync();
  }

  function paymentDialog(ch) {
    const amount = h('input', { type: 'number', step: '0.01', min: '0', value: ch.open });
    const date = h('input', { type: 'date', value: today() });
    const method = h('select', null, S.data.methods.map((m) => h('option', { value: m, text: m })));
    const note = h('input', { maxlength: '200', placeholder: 'Optional' });
    dialog('Payment for ' + ch.description, [h('p', { class: 'muted', text: 'Still open: ' + fmt(ch.open) }),
      h('div', { class: 'grid2' }, field('Amount received', amount), field('Date', date), field('Paid by', method), field('Note', note))],
    (err, dlg) => [save('Save payment', () => run(err, dlg, () => api('/clients/charges/' + ch.id + '/payments', { method: 'POST', body: { amount: amount.value, date: date.value, method: method.value, note: note.value } }), 'Payment saved'))(err, dlg)]);
  }

  function renewDialog(ch) {
    const start = ch.end || today();
    const d = new Date(start + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1);
    const end = h('input', { type: 'date', value: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) });
    const amount = h('input', { type: 'number', step: '0.01', min: '0', value: ch.amount || '' });
    const dom = ch.type === 'domain';
    dialog(dom ? 'Domain renewed' : 'Renew maintenance', [
      h('p', { class: 'muted', text: dom ? 'The client renewed ' + (ch.domainName || 'the domain') + '. Enter the new expiry date; the next reminder follows from it.' : 'Opens the next year from ' + day(start) + ', unpaid until you record the payment.' }),
      h('div', { class: 'grid2' }, field(dom ? 'New expiry date' : 'Ends on', end), dom ? null : field('Amount (EUR)', amount))],
    (err, dlg) => [save(dom ? 'Save' : 'Open next year', () => run(err, dlg, () => api('/clients/charges/' + ch.id + '/renew', { method: 'POST', body: { end: end.value, amount: amount.value } }), dom ? 'Saved' : 'Next year opened'))(err, dlg)]);
  }

  function loginDialog(cl, l) {
    const label = h('input', { maxlength: '60', value: l ? l.label : 'Admin page' });
    const url = h('input', { maxlength: '300', value: l ? l.url : (cl.website ? (/^https?:/.test(cl.website) ? cl.website : 'https://' + cl.website) + '/admin' : ''), placeholder: 'https://…/admin' });
    const user = h('input', { maxlength: '160', value: l ? l.username : 'info@ergonsite.com', autocomplete: 'off' });
    const pw = h('input', { type: 'password', maxlength: '500', autocomplete: 'new-password', placeholder: l && l.hasPassword ? 'Leave empty to keep the saved one' : '' });
    const eye = h('button', { type: 'button', class: 'link', text: 'Show', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; eye.textContent = pw.type === 'password' ? 'Show' : 'Hide'; } });
    dialog(l ? 'Edit login' : 'New login for ' + cl.name, [h('div', { class: 'grid2' }, field('Name', label), field('Link', url), field('Username', user), h('label', null, h('span', null, 'Password ', eye), pw)),
      S.data.vault ? h('p', { class: 'muted x-note', text: 'The password is encrypted before it is saved.' }) : h('p', { class: 'x-warn', text: 'VAULT_KEY is not set on Render, so only the link and username can be saved for now.' })],
    (err, dlg) => [save('Save', () => run(err, dlg, () => api(l ? '/clients/logins/' + l.id : '/clients/c/' + cl.id + '/logins', { method: l ? 'PUT' : 'POST', body: { label: label.value, url: url.value, username: user.value, password: pw.value } }), 'Saved'))(err, dlg),
      l ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete', onclick: () => {
        if (confirm('Delete this login?')) run(err, dlg, () => api('/clients/logins/' + l.id, { method: 'DELETE' }), 'Deleted');
      } }) : null]);
  }

  window.ClientsView = { open };
})();
