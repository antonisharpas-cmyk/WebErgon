/* =====================================================================
   ErgonSite console: Clients (owners only).

   #clients            every client as a card, with a search box
   #clients/c/ID       one client: charges, payments, logins
   #clients/settings   renewal window and the wording of suggested emails
   Nothing here emails a client. "Write email" opens your own mail
   program with a suggested text, to change and send yourself.
   Uses the helpers console.js puts on window.ErgonConsole.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { $, h, api, toast } = C;

  const S = { data: null, search: '' };
  const pad = (n) => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const fmt = (n, cur) => { try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur || 'EUR' }).format(n || 0); } catch (e) { return (n || 0).toFixed(2) + ' ' + cur; } };
  const day = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const ts = (t) => new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const pill = (key, label) => h('span', { class: 'x-chip st-' + key, text: label });
  const root = () => $('#clientsRoot');

  /* a ready-made email in your own mail program */
  function mailto(m) {
    const enc = (s) => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
    return 'mailto:' + encodeURIComponent(m.to || '').replace(/%40/g, '@').replace(/%2C/g, ',') + '?subject=' + enc(m.subject) + '&body=' + enc(m.body);
  }
  C.mailto = mailto;

  /* ---------------- routing ---------------- */
  async function open(rest) {
    const parts = (rest || '').split('/').filter(Boolean);
    try { S.data = await api('/clients'); } catch (e) { toast(e.message); return; }
    if (parts[0] === 'c' && parts[1]) return clientPage(parts[1]);
    if (parts[0] === 'settings') return settingsPage();
    return listPage();
  }
  const go = (hash) => { if (location.hash === '#' + hash) open(hash.replace(/^clients\/?/, '')); else location.hash = hash; };
  const reload = () => open(location.hash.replace(/^#clients\/?/, ''));

  function page(active, ...content) {
    const t = (key, label, hash) => h('a', { href: '#' + hash, class: active === key ? 'is-on' : '' }, label);
    root().replaceChildren(...[
      h('header', { class: 'x-head' }, h('div', null, h('h2', { text: 'Clients' }), h('p', { class: 'muted', text: 'Contact details, charges, payments and logins for each client.' }))),
      h('nav', { class: 'x-tabs' }, t('list', 'Clients', 'clients'), t('settings', 'Settings', 'clients/settings')),
      S.data.vault ? null : h('p', { class: 'x-banner', text: 'VAULT_KEY is not set on Render yet, so client passwords cannot be saved. Usernames and links work already.' }),
      ...content].filter(Boolean));
  }

  /* ---------------- all clients ---------------- */
  function listPage() {
    const d = S.data;
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

    const grid = h('section', { class: 'x-grid' });
    const none = h('p', { class: 'muted', hidden: true, text: 'No client matches.' });
    const draw = () => {
      const q = S.search.trim().toLowerCase();
      const list = d.clients.filter((c) => !q || [c.name, c.contact, c.email, c.website, c.domain, c.phone].some((v) => String(v || '').toLowerCase().includes(q)));
      grid.replaceChildren(...list.map((c) => h('a', { class: 'x-client', href: '#clients/c/' + c.id },
        h('b', { text: c.name }),
        h('small', { class: 'muted', text: c.website || c.email || ' ' }),
        h('div', { class: 'x-client-row' },
          c.open ? h('span', { class: 'x-chip ' + (c.overdue ? 'st-overdue' : 'st-pending'), text: fmt(c.open) + ' open' }) : h('span', { class: 'x-chip st-paid', text: 'all paid' }),
          c.nextRenewal ? h('span', { class: 'x-chip', text: c.nextRenewal.type.split(' ')[0] + ' ' + day(c.nextRenewal.date) }) : null))));
      none.hidden = list.length > 0 || !d.clients.length;
    };
    const search = h('input', { type: 'search', class: 'x-search', placeholder: 'Search by name, email, website…', 'aria-label': 'Search clients', value: S.search });
    search.addEventListener('input', () => { S.search = search.value; draw(); });
    draw();

    page('list',
      h('div', { class: 'x-toolbar' }, search,
        h('button', { type: 'button', class: 'btn btn-dark', text: '+ Client', onclick: () => clientDialog() }),
        h('button', { type: 'button', class: 'btn btn-light', text: 'Import file', onclick: () => fileIn.click() }), fileIn),
      grid, none,
      d.clients.length ? null : h('p', { class: 'muted', text: 'No clients yet. Add one, or import the starter file.' }));
    if (S.search) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
  }

  /* ---------------- one client ---------------- */
  async function clientPage(cid) {
    let d;
    try { d = await api('/clients/c/' + cid); } catch (e) { toast(e.message); return go('clients'); }
    const c = d.client;
    const facts = h('dl', { class: 'facts' },
      c.contact ? [h('dt', { text: 'Contact' }), h('dd', { text: c.contact })] : null,
      h('dt', { text: 'Email' }), h('dd', null, c.email ? h('a', { href: 'mailto:' + c.email, text: c.email }) : h('span', { class: 'x-warn', text: 'missing' })),
      c.phone ? [h('dt', { text: 'Phone' }), h('dd', null, h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), text: c.phone }))] : null,
      c.website ? [h('dt', { text: 'Website' }), h('dd', null, h('a', { href: /^https?:/.test(c.website) ? c.website : 'https://' + c.website, target: '_blank', rel: 'noopener', text: c.website }))] : null,
      c.domain ? [h('dt', { text: 'Domain' }), h('dd', { text: c.domain })] : null,
      c.notes ? [h('dt', { text: 'Notes' }), h('dd', { class: 'message-text', text: c.notes })] : null);

    const rows = d.charges.filter((ch) => ch.type !== 'domain').map((ch) => {
      const period = ch.type === 'maintenance' ? day(ch.start) + ' to ' + day(ch.end) : ch.start ? 'due ' + day(ch.start) : 'no due date';
      return h('tr', { class: ch.renewedTo ? 'is-done' : '' },
        h('td', null, h('b', { text: ch.typeLabel }), h('div', { class: 'muted', text: ch.description })),
        h('td', { class: 'x-date', text: period }),
        h('td', { class: 'num', text: fmt(ch.amount, ch.currency) }),
        h('td', { class: 'num', text: fmt(ch.paid, ch.currency) }),
        h('td', null, pill(ch.status, ch.statusLabel)),
        h('td', { class: 'num' }, h('div', { class: 'x-row-actions' },
          ch.mail && c.email ? h('a', { class: 'link', href: mailto(ch.mail), text: 'Write email' }) : null,
          ch.open > 0 ? h('button', { type: 'button', class: 'link', text: 'Payment', onclick: () => paymentDialog(ch) }) : null,
          ch.type === 'maintenance' && !ch.renewedTo ? h('button', { type: 'button', class: 'link', text: 'Renew', onclick: () => renewDialog(ch) }) : null,
          h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => chargeDialog(c, ch) }))));
    });

    /* the domain: its own card, so its expiry and who pays are easy to find */
    const doms = d.charges.filter((ch) => ch.type === 'domain');
    const current = doms.filter((ch) => !ch.renewedTo);
    const earlier = doms.filter((ch) => ch.renewedTo);
    const domainItems = current.map((ch) => {
      const days = ch.end ? Math.round((new Date(ch.end + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000) : null;
      const we = ch.payer === 'ergonsite';
      return h('li', { class: 'x-domain' + (ch.status === 'overdue' ? ' is-late' : ch.status === 'soon' ? ' is-due' : '') },
        h('div', { class: 'x-grow' },
          h('div', { class: 'x-domain-name' }, h('b', { text: ch.domainName || c.domain || 'Domain' }), pill(ch.status, ch.statusLabel)),
          h('div', { class: 'x-domain-facts' },
            h('span', null, h('small', { class: 'muted', text: 'Expires' }), h('b', { text: ch.end ? day(ch.end) : 'not known' }), ch.end ? h('small', { class: 'muted', text: days < 0 ? Math.abs(days) + ' days ago' : 'in ' + days + ' days' }) : null),
            h('span', null, h('small', { class: 'muted', text: 'Who pays' }), h('b', { text: we ? 'ErgonSite' : 'The client' }),
              h('small', { class: 'muted', text: we ? (ch.registrar || 'registrar') + (ch.ourCost ? ', costs us ' + fmt(ch.ourCost, ch.ourCostCurrency) : '') : (ch.registrar ? 'own ' + ch.registrar + ' account' : 'own account') + (ch.domainCost ? ', ' + ch.domainCost : '') })),
            we ? h('span', null, h('small', { class: 'muted', text: 'Client pays us' }), h('b', { text: ch.amount > 0 ? fmt(ch.amount, ch.currency) : 'included' }),
              ch.payStatus ? pill(ch.payStatus.key, ch.payStatus.label) : null) : null,
            h('span', null, h('small', { class: 'muted', text: 'Reminder' }), h('b', { text: (ch.remindDays ?? S.data.settings.remindDays) + ' days before' }),
              h('small', { class: 'muted', text: we ? 'dashboard + email to us' : 'dashboard; you email the client' })))),
        h('div', { class: 'x-row-actions' },
          ch.mail && c.email && ch.end ? h('a', { class: 'link', href: mailto(ch.mail), text: we ? 'Write email' : 'Remind client' }) : null,
          ch.open > 0 ? h('button', { type: 'button', class: 'link', text: 'Payment', onclick: () => paymentDialog(ch) }) : null,
          ch.end ? h('button', { type: 'button', class: 'link', text: 'Mark renewed', onclick: () => renewDialog(ch) }) : null,
          h('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => chargeDialog(c, ch, 'domain') })));
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

    page('list',
      h('div', { class: 'x-crumbs' }, h('a', { href: '#clients', text: '‹ All clients' })),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { class: 'x-big', text: c.name }),
          h('div', { class: 'x-actions' }, h('button', { type: 'button', class: 'btn btn-light', text: 'Edit client', onclick: () => clientDialog(c) }))),
        facts,
        h('div', { class: 'x-client-row' }, c.open ? pill(c.overdue ? 'overdue' : 'pending', fmt(c.open) + ' open') : pill('paid', 'all paid'), h('span', { class: 'muted', text: 'Paid so far ' + fmt(c.paidTotal) }))),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Domain' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Domain', onclick: () => chargeDialog(c, null, 'domain') })),
        domainItems.length ? h('ul', { class: 'x-list' }, domainItems) : h('p', { class: 'muted', text: 'Add the client\u2019s domain: its expiry date, and whether they pay the registrar themselves or ErgonSite pays it for them.' }),
        earlier.length ? h('p', { class: 'muted x-note', text: 'Earlier: ' + earlier.map((ch) => (ch.domainName || 'domain') + ' ' + day(ch.start) + ' to ' + day(ch.end)).join(' · ') }) : null),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Charges' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Charge', onclick: () => chargeDialog(c) })),
        rows.length ? h('div', { class: 'x-table-wrap' }, h('table', { class: 'x-table' },
          h('thead', null, h('tr', null, h('th', { text: 'What' }), h('th', { text: 'When' }), h('th', { class: 'num', text: 'Amount' }), h('th', { class: 'num', text: 'Paid' }), h('th', { text: 'Status' }), h('th'))),
          h('tbody', null, rows))) : h('p', { class: 'muted', text: 'No charges yet.' }),
        c.email ? null : h('p', { class: 'muted x-note', text: 'Add an email address to the client to get the "Write email" links.' })),
      h('section', { class: 'card x-card' },
        h('div', { class: 'x-card-head' }, h('h3', { text: 'Logins' }), h('button', { type: 'button', class: 'btn btn-light', text: '+ Login', onclick: () => loginDialog(c) })),
        logins.length ? h('ul', { class: 'x-list' }, logins) : h('p', { class: 'muted', text: 'Save the client’s admin page link with our username and password here. Passwords are encrypted and only owners can open them.' })));
  }
  function copy(text, done) {
    navigator.clipboard.writeText(text).then(() => toast(done), () => toast('Could not copy'));
  }

  /* ---------------- settings ---------------- */
  function settingsPage() {
    const s = S.data.settings;
    const remind = h('input', { type: 'number', min: '1', max: '180', value: s.remindDays });
    const payText = h('textarea', { rows: '3', maxlength: '600' }); payText.value = s.paymentText;
    const sign = h('input', { value: s.signature, maxlength: '80' });
    page('settings',
      h('section', { class: 'card x-card' }, h('h3', { text: 'Renewals and suggested emails' }),
        h('p', { class: 'muted x-note', text: 'No email is ever sent to a client automatically. The dashboard lists what is unpaid and what renews soon, and "Write email" opens your own mail program with a suggested text that you can change before sending.' }),
        h('label', null, 'Flag renewals on the dashboard this many days before', remind),
        h('label', null, 'How to pay (used in the suggested emails)', payText),
        h('label', null, 'Signed', sign),
        h('div', null, h('button', { type: 'button', class: 'btn btn-dark', text: 'Save', onclick: async () => {
          try { await api('/clients/settings', { method: 'PUT', body: { remindDays: remind.value, paymentText: payText.value, signature: sign.value } }); toast('Saved'); reload(); } catch (e) { toast(e.message); }
        } }))),
      h('section', { class: 'card x-card' }, h('h3', { text: 'Logins' }),
        h('p', { class: 'muted x-note', text: S.data.vault
          ? 'Passwords are encrypted with VAULT_KEY from Render. Keep that key the same: logins saved with one key cannot be opened with another.'
          : 'Add VAULT_KEY in Render, Environment: a long random text. Then passwords can be saved. Never change it afterwards.' })));
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
  const save = (label, fn) => h('button', { type: 'submit', class: 'btn btn-dark', text: label, onclick: (e) => { e.preventDefault(); fn(); } });

  function clientDialog(c) {
    const f = {
      name: h('input', { required: true, maxlength: '80', value: c ? c.name : '' }),
      contact: h('input', { maxlength: '80', value: c ? c.contact || '' : '', placeholder: 'Who we talk to' }),
      email: h('input', { maxlength: '160', value: c ? c.email || '' : '', placeholder: 'Two? Separate with a comma' }),
      phone: h('input', { maxlength: '40', value: c ? c.phone || '' : '' }),
      website: h('input', { maxlength: '120', value: c ? c.website || '' : '', placeholder: 'e.g. andreou.law' }),
      domain: h('input', { maxlength: '120', value: c ? c.domain || '' : '' }),
      notes: h('textarea', { rows: '3', maxlength: '2000' })
    };
    if (c && c.notes) f.notes.value = c.notes;
    const val = () => Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    dialog(c ? 'Edit ' + c.name : 'New client', [h('div', { class: 'grid2' },
      field('Company', f.name), field('Contact person', f.contact), field('Email', f.email), field('Phone', f.phone), field('Website', f.website), field('Domain', f.domain)),
      field('Notes', f.notes),
      c ? h('p', { class: 'muted x-note', text: 'Renaming also updates the client’s name in Expenses.' }) : null],
    (err, dlg) => [
      save('Save', () => run(err, dlg, () => api(c ? '/clients/c/' + c.id : '/clients', { method: c ? 'PUT' : 'POST', body: val() }), 'Saved', (r) => go('clients/c/' + r.client.id))),
      c ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete client', onclick: () => {
        if (confirm('Delete ' + c.name + ' with all charges, payments and logins? This cannot be undone.')) run(err, dlg, () => api('/clients/c/' + c.id, { method: 'DELETE' }), 'Deleted', () => go('clients'));
      } }) : null]);
  }

  // mode 'domain' edits a domain; otherwise a money charge (website, CRM, maintenance, other)
  function chargeDialog(cl, ch, mode) {
    const isDomain = mode === 'domain' || (ch && ch.type === 'domain');
    const types = Object.entries(S.data.types).filter(([k]) => (isDomain ? k === 'domain' : k !== 'domain'));
    const type = h('select', null, types.map(([k, v]) => h('option', { value: k, selected: ch && ch.type === k ? true : null, text: v })));
    const payer = h('select', null,
      h('option', { value: 'client', selected: !ch || ch.payer !== 'ergonsite' ? true : null, text: 'The client, from their own account' }),
      h('option', { value: 'ergonsite', selected: ch && ch.payer === 'ergonsite' ? true : null, text: 'ErgonSite pays it for them' }));
    const curSel = (v) => h('select', null, ['USD', 'EUR', 'GBP'].map((c) => h('option', { value: c, selected: c === (v || 'USD') ? true : null, text: c })));
    const f = {
      description: h('input', { maxlength: '120', value: ch ? ch.description : '', placeholder: 'e.g. Website, first half' }),
      amount: h('input', { type: 'number', step: '0.01', min: '0', value: ch && ch.amount !== null && ch.amount !== undefined ? ch.amount : '' }),
      start: h('input', { type: 'date', value: ch ? ch.start || '' : today() }),
      end: h('input', { type: 'date', value: ch ? ch.end || '' : '' }),
      domainName: h('input', { maxlength: '120', value: ch ? ch.domainName || '' : cl.domain || '', placeholder: 'e.g. andreou.law' }),
      registrar: h('input', { maxlength: '60', value: ch ? ch.registrar || '' : 'Porkbun' }),
      domainCost: h('input', { maxlength: '60', value: ch ? ch.domainCost || '' : 'about $11', placeholder: 'what the client pays the registrar' }),
      ourCost: h('input', { type: 'number', step: '0.01', min: '0', value: ch && ch.ourCost ? ch.ourCost : '' }),
      ourCostCurrency: curSel(ch && ch.ourCostCurrency),
      remindDays: h('input', { type: 'number', min: '0', max: '180', value: ch && ch.remindDays !== undefined ? ch.remindDays : '', placeholder: String(S.data.settings.remindDays) })
    };
    const paidNow = h('input', { type: 'number', step: '0.01', min: '0', placeholder: '0' });
    const method = h('select', null, S.data.methods.map((m) => h('option', { value: m, text: m })));
    const lbl = { start: h('span'), end: h('span'), amount: h('span') };
    const wrap = (k) => h('label', null, lbl[k], f[k]);
    const parts = {
      description: field('Description', f.description), payer: field('Who pays the registrar', payer), amount: wrap('amount'),
      start: wrap('start'), end: wrap('end'),
      domainName: field('Domain', f.domainName), registrar: field('Registrar', f.registrar), domainCost: field('Client pays the registrar', f.domainCost),
      ourCost: field('We pay the registrar', f.ourCost), ourCostCurrency: field('In', f.ourCostCurrency),
      remindDays: field('Flag the renewal … days before', f.remindDays), paidNow: field('Already paid', paidNow), method: field('Paid by', method)
    };
    const sync = () => {
      const t = type.value, dom = t === 'domain', yearly = t === 'maintenance' || dom, we = dom && payer.value === 'ergonsite';
      parts.payer.hidden = !dom;
      parts.description.hidden = dom;
      parts.amount.hidden = dom && !we;
      lbl.amount.textContent = dom ? 'We charge the client (empty = included)' : 'Amount (EUR)';
      parts.end.hidden = !yearly; parts.remindDays.hidden = !yearly;
      parts.domainName.hidden = parts.registrar.hidden = !dom;
      parts.domainCost.hidden = !dom || we;
      parts.ourCost.hidden = parts.ourCostCurrency.hidden = !we;
      parts.paidNow.hidden = parts.method.hidden = !!ch || (dom && !we);
      lbl.start.textContent = yearly ? (dom ? (we ? 'Last paid / renewed on' : 'Last renewed on (optional)') : 'Start') : 'Due date';
      lbl.end.textContent = dom ? 'Expires on' : 'End';
      if (yearly && !dom && !f.end.value && f.start.value) {
        const d = new Date(f.start.value + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1);
        f.end.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      }
    };
    type.addEventListener('change', sync);
    payer.addEventListener('change', sync);
    f.start.addEventListener('change', () => { if (!ch) { f.end.value = ''; sync(); } });
    const val = () => {
      const v = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
      v.type = type.value; v.payer = payer.value;
      if (!ch) { v.paidNow = paidNow.value; v.method = method.value; v.paidOn = f.start.value || today(); }
      return v;
    };
    const order = isDomain
      ? ['domainName', 'end', 'payer', 'registrar', 'domainCost', 'ourCost', 'ourCostCurrency', 'amount', 'start', 'remindDays', 'paidNow', 'method']
      : ['description', 'amount', 'start', 'end', 'remindDays', 'paidNow', 'method'];
    const content = [h('div', { class: 'grid2' }, isDomain ? null : field('What for', type), order.map((k) => parts[k])),
      isDomain ? h('p', { class: 'muted x-note', text: 'The client pays: the dashboard shows the renewal and "Remind client" writes them an email. ErgonSite pays: the dashboard shows it, we get an email to renew it, and what we pay goes into Expenses and Reports under this client.' }) : null];
    if (ch && ch.payments && ch.payments.length) {
      content.push(h('div', { class: 'x-box' }, h('h4', { text: 'Payments' }), h('ul', { class: 'x-list' }, ch.payments.map((p) => h('li', null,
        h('span', { class: 'x-grow', text: day(p.date) + ' · ' + p.method + (p.note ? ' · ' + p.note : '') }), h('b', { text: fmt(p.amount) }),
        h('button', { type: 'button', class: 'link', text: 'Remove', onclick: async () => {
          if (!confirm('Remove this payment?')) return;
          try { await api('/clients/charges/' + ch.id + '/payments/' + p.id, { method: 'DELETE' }); toast('Payment removed'); document.querySelector('dialog.x-dialog').close(); reload(); } catch (e) { toast(e.message); }
        } }))))));
    }
    dialog(isDomain ? (ch ? 'Edit domain' : 'Domain for ' + cl.name) : ch ? 'Edit charge' : 'New charge for ' + cl.name, content, (err, dlg) => [
      save('Save', () => run(err, dlg, () => api(ch ? '/clients/charges/' + ch.id : '/clients/c/' + cl.id + '/charges', { method: ch ? 'PUT' : 'POST', body: val() }), 'Saved')),
      ch ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete', onclick: () => {
        if (confirm(isDomain ? 'Delete this domain?' : 'Delete this charge and its payments?')) run(err, dlg, () => api('/clients/charges/' + ch.id, { method: 'DELETE' }), 'Deleted');
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
    (err, dlg) => [save('Save payment', () => run(err, dlg, () => api('/clients/charges/' + ch.id + '/payments', { method: 'POST', body: { amount: amount.value, date: date.value, method: method.value, note: note.value } }), 'Payment saved'))]);
  }

  function renewDialog(ch) {
    const start = ch.end || today();
    const d = new Date(start + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1);
    const end = h('input', { type: 'date', value: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) });
    const amount = h('input', { type: 'number', step: '0.01', min: '0', value: ch.amount || '' });
    const ourCost = h('input', { type: 'number', step: '0.01', min: '0', value: ch.ourCost || '' });
    const dom = ch.type === 'domain', we = ch.payer === 'ergonsite';
    dialog(dom ? 'Domain renewed' : 'Renew maintenance', [
      h('p', { class: 'muted', text: dom ? (we ? 'We renewed ' + (ch.domainName || 'the domain') + ' for the client.' : 'The client renewed ' + (ch.domainName || 'the domain') + '.') + ' Enter the new expiry date; the next renewal follows from it.' : 'Opens the next year from ' + day(start) + ', unpaid until you record the payment.' }),
      h('div', { class: 'grid2' }, field(dom ? 'New expiry date' : 'Ends on', end),
        !dom || we ? field(dom ? 'We charge the client' : 'Amount (EUR)', amount) : null,
        dom && we ? field('We paid the registrar (' + (ch.ourCostCurrency || 'USD') + ')', ourCost) : null)],
    (err, dlg) => [save(dom ? 'Save' : 'Open next year', () => run(err, dlg, () => api('/clients/charges/' + ch.id + '/renew', { method: 'POST', body: { end: end.value, amount: amount.value, ourCost: ourCost.value } }), dom ? 'Saved' : 'Next year opened'))]);
  }

  function loginDialog(cl, l) {
    const label = h('input', { maxlength: '60', value: l ? l.label : 'Admin page' });
    const url = h('input', { maxlength: '300', value: l ? l.url : (cl.website ? (/^https?:/.test(cl.website) ? cl.website : 'https://' + cl.website) + '/admin' : ''), placeholder: 'https://…/admin' });
    const user = h('input', { maxlength: '160', value: l ? l.username : 'info@ergonsite.com', autocomplete: 'off' });
    const pw = h('input', { type: 'password', maxlength: '500', autocomplete: 'new-password', placeholder: l && l.hasPassword ? 'Leave empty to keep the saved one' : '' });
    const eye = h('button', { type: 'button', class: 'link', text: 'Show', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; eye.textContent = pw.type === 'password' ? 'Show' : 'Hide'; } });
    dialog(l ? 'Edit login' : 'New login for ' + cl.name, [h('div', { class: 'grid2' }, field('Name', label), field('Link', url), field('Username', user), h('label', null, h('span', null, 'Password ', eye), pw)),
      S.data.vault ? h('p', { class: 'muted x-note', text: 'The password is encrypted before it is saved.' }) : h('p', { class: 'x-warn', text: 'VAULT_KEY is not set on Render, so only the link and username can be saved for now.' })],
    (err, dlg) => [save('Save', () => run(err, dlg, () => api(l ? '/clients/logins/' + l.id : '/clients/c/' + cl.id + '/logins', { method: l ? 'PUT' : 'POST', body: { label: label.value, url: url.value, username: user.value, password: pw.value } }), 'Saved')),
      l ? h('button', { type: 'button', class: 'btn btn-light x-danger', text: 'Delete', onclick: () => {
        if (confirm('Delete this login?')) run(err, dlg, () => api('/clients/logins/' + l.id, { method: 'DELETE' }), 'Deleted');
      } }) : null]);
  }

  window.ClientsView = { open, chargeDialogFor: null };
})();
