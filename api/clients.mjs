/* =====================================================================
   Clients and billing, for the console's Clients section (owners only).

   For every client: contact details, what they pay us (website or CRM
   fees, yearly maintenance), their domain, the payments they made, and
   the logins to their admin page.

   Charges
     website / crm / other   a one-off fee; it can be paid in parts.
     maintenance             a yearly fee with a start and an end date.
     domain                  the client's domain and when it expires.
                             Usually the client pays the registrar from
                             their own account and we only keep an eye on
                             the date. When ErgonSite pays the registrar
                             for them, what we pay is a cost (it shows in
                             Expenses and Reports under that client), and
                             whatever the client pays us back is tracked
                             like any other charge.
   A charge's status comes from its payments: Pending, Partly paid, Paid,
   Unpaid once the due date has passed.

   Nothing is ever emailed to a client from here. The dashboard lists
   what is unpaid and what renews soon; next to each one, "Write email"
   opens your own mail program with a suggested text you can change.
   The only automatic email goes to the team: when a domain ErgonSite
   pays for is close to expiring, info@ergonsite.com is told to renew it.

   Logins are encrypted with AES-256-GCM. The key comes from VAULT_KEY in
   Render's environment and never touches the data file, so the file on
   its own does not give the passwords away.
   ===================================================================== */
import crypto from 'node:crypto';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,}$/;
const CUR_RE = /^[A-Z]{3}$/;
const TYPES = ['website', 'crm', 'maintenance', 'domain', 'other'];
const TYPE_LABEL = { website: 'Website', crm: 'CRM', maintenance: 'Maintenance & hosting', domain: 'Domain', other: 'Other' };
const METHODS = ['Cash', 'Bank transfer', 'Card', 'Other'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Nicosia' }));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addMonthsDate = (date, n) => {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)) - 1 + n, day = Number(date.slice(8, 10));
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const nice = (date) => new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const euro = (n, cur = 'EUR') => new Intl.NumberFormat('en-IE', { style: 'currency', currency: cur }).format(n);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ---------- logins: AES-256-GCM with a key from the environment ---------- */
function vaultKey(raw) {
  return raw ? crypto.createHash('sha256').update(String(raw)).digest() : null;
}
function seal(key, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
}
function unseal(key, sealed) {
  const b = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/* ===================================================================== */
export function setupClients({ db, store, send, readJson, clean, id, now, vaultSecret, mailer, layout, esc, notifyEmail, publicUrl }) {
  const KEY = vaultKey(vaultSecret);
  const ensure = () => {
    const x = db.clients || (db.clients = {});
    x.list ||= [];
    x.charges ||= [];
    x.logins ||= [];
    delete x.outbox;                         // the old "emails to approve" list is gone
    x.settings ||= {};
    const s = x.settings;
    s.remindDays ??= 30;
    s.paymentText ??= 'You can pay in cash when we next meet, or reply to this email and we will arrange it with you.';
    s.signature ??= 'ErgonSite Team';
    delete s.chaseDays; delete s.digest;
    return x;
  };
  ensure();

  /* ---------- figures ---------- */
  const paidOf = (c) => r2((c.payments || []).reduce((n, p) => n + p.amount, 0));
  const openOf = (c) => r2(Math.max(0, (c.amount || 0) - paidOf(c)));
  const yearly = (c) => c.type === 'maintenance' || c.type === 'domain';
  function payStatus(c, today = todayStr()) {
    const amount = c.amount || 0;
    const paid = paidOf(c);
    if (amount > 0 && paid >= amount) return { key: 'paid', label: 'Paid' };
    if (!(amount > 0)) return null;
    const late = c.start && c.start < today;
    if (paid > 0) return { key: late ? 'overdue' : 'part', label: 'Partly paid, ' + euro(r2(amount - paid), c.currency) + ' to go' };
    return { key: late ? 'overdue' : 'pending', label: late ? 'Unpaid' : 'Pending' };
  }
  function renewStatus(c, today = todayStr()) {
    if (c.renewedTo) return { key: 'renewed', label: 'Renewed' };
    if (!c.end) return { key: 'check', label: 'Expiry not known' };
    const d = daysBetween(today, c.end);
    if (d < 0) return { key: 'overdue', label: c.type === 'domain' ? 'Expired' : 'Ended' };
    if (d <= (c.remindDays ?? ensure().settings.remindDays)) return { key: 'soon', label: 'Renews soon' };
    return { key: 'ok', label: 'Active' };
  }
  function chargeOut(c) {
    // a domain shows its renewal state; money owed shows as a second line
    const pay = payStatus(c);
    const main = c.type === 'domain' ? renewStatus(c) : (pay || { key: 'paid', label: 'Paid' });
    return { ...c, paid: paidOf(c), open: openOf(c), status: main.key, statusLabel: main.label,
      payStatus: c.type === 'domain' && pay ? pay : null, typeLabel: TYPE_LABEL[c.type] };
  }
  function clientOut(cl) {
    const x = ensure();
    const charges = x.charges.filter((c) => c.clientId === cl.id).map(chargeOut);
    const today = todayStr();
    const next = charges.filter((c) => yearly(c) && c.end && !c.renewedTo && c.end >= today).sort((a, b) => a.end.localeCompare(b.end))[0];
    return {
      ...cl,
      open: r2(charges.reduce((n, c) => n + c.open, 0)),
      paidTotal: r2(charges.reduce((n, c) => n + c.paid, 0)),
      overdue: charges.some((c) => c.open > 0 && c.start && c.start < today),
      nextRenewal: next ? { date: next.end, type: next.typeLabel } : null
    };
  }
  const clientName = (cid) => (ensure().list.find((k) => k.id === cid) || {}).name || 'Unknown client';

  /* ---------- a suggested email, opened in your own mail program ---------- */
  function compose(cl, c, kind) {
    const s = ensure().settings;
    const name = (cl.contact || '').split(/\s+/)[0] || cl.name;
    const sign = `\n\nKind regards,\n${s.signature}\ninfo@ergonsite.com · +357 96 400 240`;
    let subject, body;
    if (kind === 'renewal' && c.type === 'maintenance') {
      subject = `Your ErgonSite maintenance renews on ${nice(c.end)}`;
      body = `Dear ${name},\n\nA friendly note that the maintenance and hosting plan for ${cl.website || cl.name} ends on ${nice(c.end)}.\n\n`
        + `To keep your website online, updated and supported for another year (${nice(c.end)} to ${nice(addMonthsDate(c.end, 12))}), the renewal is ${euro(c.amount || 0, c.currency)}.\n\n`
        + `${s.paymentText}\n\nIf you have any questions, just reply to this email.${sign}`;
    } else if (kind === 'renewal' && c.type === 'domain') {
      const dom = c.domainName || cl.domain || 'your domain';
      subject = `Your domain ${dom} expires on ${nice(c.end)}`;
      body = c.payer === 'ergonsite'
        ? `Dear ${name},\n\nA friendly note that your domain ${dom} expires on ${nice(c.end)}. We will renew it for you${c.amount ? ', and the renewal for the next year is ' + euro(c.amount, c.currency) : ''}.\n\n`
          + `${c.amount ? s.paymentText + '\n\n' : ''}If you have any questions, just reply to this email.${sign}`
        : `Dear ${name},\n\nA friendly reminder that your domain ${dom} expires on ${nice(c.end)}.\n\n`
          + `The domain is registered in your own${c.registrar ? ' ' + c.registrar : ''} account, so the renewal is made there and paid directly to ${c.registrar || 'the registrar'}${c.domainCost ? ' (' + c.domainCost + ' a year)' : ''}. `
          + `Please renew it before ${nice(c.end)}: if it expires, the website and any email addresses on it stop working.\n\n`
          + `If you would like us to help with the renewal, reply to this email and we will arrange it.${sign}`;
    } else {
      subject = `Payment reminder: ${c.description || TYPE_LABEL[c.type]}`;
      body = `Dear ${name},\n\nA friendly reminder that ${euro(openOf(c), c.currency)} is still open for ${c.description || TYPE_LABEL[c.type]}${c.start ? ' (due ' + nice(c.start) + ')' : ''}.\n\n`
        + `${s.paymentText}\n\nIf you have already paid, thank you, and please ignore this email.${sign}`;
    }
    return { to: cl.email || '', subject, body };
  }

  /* ---------- what needs attention (for the dashboard) ---------- */
  function attention() {
    const x = ensure();
    const today = todayStr();
    const s = x.settings;
    const withClient = (c, extra) => {
      const cl = x.list.find((k) => k.id === c.clientId) || { name: 'Unknown client' };
      return { ...chargeOut(c), client: cl.name, clientEmail: cl.email || '', ...extra };
    };
    const unpaid = x.charges.filter((c) => openOf(c) > 0)
      .map((c) => {
        const cl = x.list.find((k) => k.id === c.clientId) || { name: '' };
        const late = !!(c.start && c.start < today);
        return withClient(c, { late, days: c.start ? daysBetween(today, c.start) : null, mail: compose(cl, c, 'payment') });
      })
      .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
    const renewals = x.charges.filter((c) => yearly(c) && c.end && !c.renewedTo)
      .map((c) => {
        const cl = x.list.find((k) => k.id === c.clientId) || { name: '' };
        return withClient(c, { days: daysBetween(today, c.end), mail: compose(cl, c, 'renewal') });
      })
      .filter((c) => c.days <= Math.max(60, s.remindDays))
      .sort((a, b) => a.end.localeCompare(b.end));
    const checks = [
      ...x.charges.filter((c) => c.type === 'domain' && !c.end && !c.renewedTo).map((c) => ({ kind: 'domain', clientId: c.clientId, client: clientName(c.clientId), text: 'Domain expiry date not known' + (c.domainName ? ' (' + c.domainName + ')' : '') })),
      ...x.list.filter((k) => !k.email).map((k) => ({ kind: 'email', clientId: k.id, client: k.name, text: 'No email address' })),
      ...x.charges.filter((c) => openOf(c) > 0 && !c.start).map((c) => ({ kind: 'due', clientId: c.clientId, client: clientName(c.clientId), text: 'No due date for ' + (c.description || TYPE_LABEL[c.type]) }))
    ];
    return {
      unpaid, renewals, checks, remindDays: s.remindDays,
      toCollect: r2(unpaid.reduce((n, c) => n + c.open, 0)),
      overdue: r2(unpaid.filter((c) => c.late).reduce((n, c) => n + c.open, 0)),
      count: unpaid.filter((c) => c.late).length + renewals.filter((c) => c.days <= s.remindDays).length
    };
  }

  // domains ErgonSite pays for a client: a cost in the month it was bought or renewed
  function ourDomainCosts(month) {
    return ensure().charges
      .filter((c) => c.type === 'domain' && c.payer === 'ergonsite' && c.ourCost > 0 && c.start && c.start.slice(0, 7) === month)
      .map((c) => ({ id: c.id, clientId: c.clientId, date: c.start, name: 'Domain ' + (c.domainName || ''), vendor: c.registrar || '', category: 'Domains',
        client: clientName(c.clientId), currency: c.ourCostCurrency || 'USD', amount: r2(c.ourCost) }));
  }

  // money in between two dates (for Reports): payments received, and charges billed
  function ledger(from, to) {
    const x = ensure();
    const payments = [], billed = [];
    for (const c of x.charges) {
      for (const p of c.payments || []) {
        if (p.date >= from && p.date <= to) payments.push({ date: p.date, client: clientName(c.clientId), type: TYPE_LABEL[c.type], description: c.description, method: p.method, note: p.note || '', currency: c.currency || 'EUR', amount: p.amount });
      }
      if (c.amount > 0 && c.start && c.start >= from && c.start <= to) billed.push({ date: c.start, client: clientName(c.clientId), type: TYPE_LABEL[c.type], description: c.description, currency: c.currency || 'EUR', amount: c.amount, paid: paidOf(c) });
    }
    const open = x.charges.filter((c) => openOf(c) > 0).map((c) => ({ client: clientName(c.clientId), description: c.description, due: c.start || null, open: openOf(c) }));
    return { payments, billed, open };
  }

  function renew(c, b) {
    const x = ensure();
    const start = c.end || todayStr();
    const end = b.end && DATE_RE.test(b.end) ? b.end : addMonthsDate(start, 12);
    const amount = b.amount !== undefined && b.amount !== '' && b.amount !== null ? r2(b.amount) : (c.amount ?? null);
    const next = {
      id: id(8), clientId: c.clientId, type: c.type, description: c.description, currency: c.currency || 'EUR',
      amount: c.type === 'domain' && c.payer !== 'ergonsite' ? null : amount,
      start, end, payments: [], registrar: c.registrar || '', domainName: c.domainName || '', domainCost: c.domainCost || '',
      payer: c.payer || 'client', ourCost: b.ourCost !== undefined && b.ourCost !== '' ? r2(b.ourCost) : (c.ourCost || 0), ourCostCurrency: c.ourCostCurrency || 'USD',
      remindDays: c.remindDays, notes: '', createdAt: now()
    };
    x.charges.push(next);
    c.renewedTo = next.id;
    return next;
  }

  /* ---------- input ---------- */
  function clientInput(b, old) {
    const c = old ? { ...old } : { createdAt: now() };
    for (const [k, n] of [['name', 80], ['contact', 80], ['phone', 40], ['website', 120], ['domain', 120], ['notes', 2000]]) if (b[k] !== undefined) c[k] = clean(b[k], n);
    if (b.email !== undefined) {
      const e = clean(b.email, 160);
      if (e && !e.split(/[,;]\s*/).every((v) => EMAIL_RE.test(v))) throw httpError(400, 'That email address is not valid.');
      c.email = e;
    }
    if (!c.name) throw httpError(400, 'The client needs a name.');
    delete c.paused;
    if (!old) c.id = id(8);
    return c;
  }
  function chargeInput(b, old) {
    const c = old ? { ...old } : { payments: [], createdAt: now() };
    if (b.type !== undefined) {
      if (!TYPES.includes(b.type)) throw httpError(400, 'Pick what the charge is for.');
      c.type = b.type;
    }
    if (!c.type) throw httpError(400, 'Pick what the charge is for.');
    for (const [k, n] of [['description', 120], ['registrar', 60], ['domainName', 120], ['domainCost', 60], ['notes', 1000]]) if (b[k] !== undefined) c[k] = clean(b[k], n);
    for (const k of ['start', 'end']) {
      if (b[k] === undefined) continue;
      if (b[k] === '' || b[k] === null) c[k] = null;
      else if (!DATE_RE.test(b[k])) throw httpError(400, 'A date is not valid.');
      else c[k] = b[k];
    }
    if (c.start && c.end && c.end < c.start) throw httpError(400, 'The end date is before the start date.');
    if (b.payer !== undefined) c.payer = b.payer === 'ergonsite' ? 'ergonsite' : 'client';
    if (b.ourCost !== undefined) c.ourCost = b.ourCost === '' || b.ourCost === null ? 0 : r2(b.ourCost);
    if (b.ourCostCurrency !== undefined) {
      const cur = String(b.ourCostCurrency).toUpperCase();
      if (!CUR_RE.test(cur)) throw httpError(400, 'Currency should be a 3-letter code like USD.');
      c.ourCostCurrency = cur;
    }
    if (b.amount !== undefined) c.amount = b.amount === '' || b.amount === null ? null : r2(b.amount);
    if (c.type === 'domain') {
      c.payer ||= 'client';
      if (c.payer === 'client') { c.amount = null; c.ourCost = 0; }
      c.ourCostCurrency ||= 'USD';
    } else if (!(c.amount >= 0)) throw httpError(400, 'Enter the amount.');
    if (b.remindDays !== undefined) c.remindDays = b.remindDays === '' || b.remindDays === null ? undefined : Math.max(0, Math.min(180, Math.round(Number(b.remindDays))));
    delete c.noReminders;
    c.currency ||= 'EUR';
    c.description ||= TYPE_LABEL[c.type];
    if (!old) c.id = id(8);
    return c;
  }

  function overview() {
    const x = ensure();
    return {
      today: todayStr(),
      clients: x.list.map(clientOut).sort((a, b) => a.name.localeCompare(b.name)),
      vault: !!KEY, settings: x.settings, methods: METHODS, types: TYPE_LABEL
    };
  }
  function clientDetail(cl) {
    const x = ensure();
    return {
      client: clientOut(cl),
      charges: x.charges.filter((c) => c.clientId === cl.id).map((c) => ({
        ...chargeOut(c),
        mail: openOf(c) > 0 ? compose(cl, c, 'payment') : yearly(c) && c.end && !c.renewedTo ? compose(cl, c, 'renewal') : null
      })).sort((a, b) => (b.start || '').localeCompare(a.start || '') || a.type.localeCompare(b.type)),
      logins: x.logins.filter((l) => l.clientId === cl.id).map(({ secret, ...l }) => ({ ...l, hasPassword: !!secret }))
    };
  }

  /* other parts of the console keep client names (expenses); keep them in step */
  function renameEverywhere(oldName, newName) {
    if (!oldName || oldName === newName || !db.expenses) return;
    const same = (v) => String(v || '').trim().toLowerCase() === oldName.trim().toLowerCase();
    for (const p of db.expenses.plans || []) if (same(p.client)) p.client = newName;
    for (const e of db.expenses.entries || []) if (same(e.client)) e.client = newName;
    for (const k of Object.keys(db.expenses.renderMap || {})) if (same(db.expenses.renderMap[k])) db.expenses.renderMap[k] = newName;
  }

  function importData(data) {
    const x = ensure();
    if (!data || !Array.isArray(data.clients)) throw httpError(400, 'That file is not a clients file.');
    let added = 0;
    for (const raw of data.clients) {
      let cl = x.list.find((k) => k.name.toLowerCase() === String(raw.name || '').toLowerCase());
      if (!cl) { cl = clientInput(raw); x.list.push(cl); added++; }
      for (const ch of raw.charges || []) {
        const c = chargeInput(ch);
        c.clientId = cl.id;
        c.payments = (ch.payments || []).filter((p) => DATE_RE.test(p.date || '') && p.amount > 0)
          .map((p) => ({ id: id(6), date: p.date, amount: r2(p.amount), method: METHODS.includes(p.method) ? p.method : 'Other', note: clean(p.note, 200) }));
        if (ch.renewed) c.renewedTo = 'imported';
        x.charges.push(c); added++;
      }
    }
    store.save();
    return added;
  }

  /* ---------- the team is told to renew domains we pay for ---------- */
  async function remindUs() {
    if (!mailer) return;
    const x = ensure();
    const today = todayStr();
    for (const c of x.charges) {
      if (c.type !== 'domain' || c.payer !== 'ergonsite' || c.renewedTo || !c.end || c.remindedFor === c.end) continue;
      const days = daysBetween(today, c.end);
      if (days > (c.remindDays ?? x.settings.remindDays)) continue;
      const cl = x.list.find((k) => k.id === c.clientId) || { name: 'a client' };
      const dom = c.domainName || cl.domain || 'a domain';
      const cost = c.ourCost ? ` (about ${euro(c.ourCost, c.ourCostCurrency || 'USD')})` : '';
      const when = days < 0 ? `expired on ${nice(c.end)}` : `expires on ${nice(c.end)} (${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'})`;
      try {
        await mailer.send({
          to: notifyEmail,
          subject: `Renew ${dom} for ${cl.name}`,
          text: `${dom} (${cl.name}) ${when}. ErgonSite pays this one: renew it at ${c.registrar || 'the registrar'}${cost}, then press "Mark renewed" on the client in the console.

${publicUrl}/admin/#clients/c/${c.clientId}`,
          html: layout(`Renew ${dom}`, `<p><b>${esc(dom)}</b> (${esc(cl.name)}) ${esc(when)}.</p><p>ErgonSite pays this one: renew it at ${esc(c.registrar || 'the registrar')}${esc(cost)}, then press <b>Mark renewed</b> on the client in the console.</p>`
            + `<p><a href="${esc(publicUrl)}/admin/#clients/c/${esc(c.clientId)}" style="color:#1b3a9e;font-weight:600">Open ${esc(cl.name)}</a></p>`)
        });
        c.remindedFor = c.end;
        store.save();
      } catch (err) {
        console.error('Domain reminder not sent:', err.message);
      }
    }
  }
  setTimeout(remindUs, 9_000);
  setInterval(remindUs, 3600_000).unref();

  /* ---------- routes: /admin/api/clients/... ---------- */
  async function handle(req, res, p, user) {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only owners can see clients and billing.' });
    const x = ensure();
    const body = () => readJson(req, 256 * 1024);
    let m;

    if (p === '/clients' && req.method === 'GET') return send(res, 200, overview());
    if (p === '/clients' && req.method === 'POST') {
      const cl = clientInput(await body());
      if (x.list.some((k) => k.name.toLowerCase() === cl.name.toLowerCase())) return send(res, 400, { message: 'There is already a client with that name.' });
      x.list.push(cl); store.save();
      return send(res, 201, { client: clientOut(cl) });
    }
    if (p === '/clients/import' && req.method === 'POST') {
      const b = await body();
      return send(res, 200, { ok: true, added: importData(b.data) });
    }
    if (p === '/clients/settings' && req.method === 'PUT') {
      const b = await body();
      const s = x.settings;
      if (b.remindDays !== undefined) s.remindDays = Math.max(1, Math.min(180, Math.round(Number(b.remindDays) || 30)));
      if (b.paymentText !== undefined) s.paymentText = clean(b.paymentText, 600);
      if (b.signature !== undefined) s.signature = clean(b.signature, 80) || 'ErgonSite Team';
      store.save();
      return send(res, 200, { ok: true });
    }

    /* one client */
    m = p.match(/^\/clients\/c\/([A-Za-z0-9_-]+)$/);
    if (m) {
      const i = x.list.findIndex((k) => k.id === m[1]);
      if (i < 0) return send(res, 404, { message: 'Client not found.' });
      if (req.method === 'GET') return send(res, 200, clientDetail(x.list[i]));
      if (req.method === 'PUT') {
        const old = x.list[i].name;
        const next = clientInput(await body(), x.list[i]);
        if (x.list.some((k, j) => j !== i && k.name.toLowerCase() === next.name.toLowerCase())) return send(res, 400, { message: 'There is already a client with that name.' });
        x.list[i] = next;
        renameEverywhere(old, next.name);
        store.save();
        return send(res, 200, { client: clientOut(next) });
      }
      if (req.method === 'DELETE') {
        const cid = x.list[i].id;
        x.list.splice(i, 1);
        x.charges = x.charges.filter((c) => c.clientId !== cid);
        x.logins = x.logins.filter((l) => l.clientId !== cid);
        store.save();
        return send(res, 200, { ok: true });
      }
    }

    /* charges */
    m = p.match(/^\/clients\/c\/([A-Za-z0-9_-]+)\/charges$/);
    if (m && req.method === 'POST') {
      if (!x.list.some((k) => k.id === m[1])) return send(res, 404, { message: 'Client not found.' });
      const b = await body();
      const c = chargeInput(b);
      c.clientId = m[1];
      if ((c.amount || 0) > 0 && Number(b.paidNow) > 0) {
        c.payments.push({ id: id(6), date: DATE_RE.test(b.paidOn || '') ? b.paidOn : todayStr(), amount: r2(b.paidNow), method: METHODS.includes(b.method) ? b.method : 'Cash', note: '' });
      }
      x.charges.push(c); store.save();
      return send(res, 201, { charge: chargeOut(c) });
    }
    m = p.match(/^\/clients\/charges\/([A-Za-z0-9_-]+)(\/payments|\/renew|\/payments\/[A-Za-z0-9_-]+)?$/);
    if (m) {
      const c = x.charges.find((q) => q.id === m[1]);
      if (!c) return send(res, 404, { message: 'Not found.' });
      if (!m[2] && req.method === 'PUT') { Object.assign(c, chargeInput(await body(), c)); store.save(); return send(res, 200, { charge: chargeOut(c) }); }
      if (!m[2] && req.method === 'DELETE') {
        x.charges = x.charges.filter((q) => q.id !== c.id);
        for (const q of x.charges) if (q.renewedTo === c.id) q.renewedTo = null;
        store.save();
        return send(res, 200, { ok: true });
      }
      if (m[2] === '/payments' && req.method === 'POST') {
        const b = await body();
        const a = r2(b.amount);
        if (!(a > 0)) return send(res, 400, { message: 'Enter the amount received.' });
        if (!DATE_RE.test(b.date || '')) return send(res, 400, { message: 'Pick the date it was paid.' });
        c.payments.push({ id: id(6), date: b.date, amount: a, method: METHODS.includes(b.method) ? b.method : 'Other', note: clean(b.note, 200) });
        store.save();
        return send(res, 200, { charge: chargeOut(c) });
      }
      if (m[2] && m[2].startsWith('/payments/') && req.method === 'DELETE') {
        const pid = m[2].split('/')[2];
        c.payments = c.payments.filter((q) => q.id !== pid);
        store.save();
        return send(res, 200, { charge: chargeOut(c) });
      }
      if (m[2] === '/renew' && req.method === 'POST') {
        if (c.renewedTo) return send(res, 400, { message: 'This one was already renewed.' });
        if (!yearly(c)) return send(res, 400, { message: 'Only maintenance and domains renew.' });
        const next = renew(c, await body());
        store.save();
        return send(res, 200, { charge: chargeOut(next) });
      }
    }

    /* logins */
    m = p.match(/^\/clients\/c\/([A-Za-z0-9_-]+)\/logins$/);
    if (m && req.method === 'POST') {
      if (!x.list.some((k) => k.id === m[1])) return send(res, 404, { message: 'Client not found.' });
      const b = await body();
      const l = { id: id(8), clientId: m[1], label: clean(b.label, 60) || 'Admin page', url: clean(b.url, 300), username: clean(b.username, 160), createdAt: now(), updatedBy: user.name };
      if (b.password) {
        if (!KEY) return send(res, 400, { message: 'Passwords cannot be saved until VAULT_KEY is set on Render.' });
        l.secret = seal(KEY, String(b.password).slice(0, 500));
      }
      x.logins.push(l); store.save();
      return send(res, 201, { ok: true });
    }
    m = p.match(/^\/clients\/logins\/([A-Za-z0-9_-]+)(\/reveal)?$/);
    if (m) {
      const l = x.logins.find((q) => q.id === m[1]);
      if (!l) return send(res, 404, { message: 'Not found.' });
      if (m[2] === '/reveal' && req.method === 'POST') {
        if (!l.secret) return send(res, 400, { message: 'No password saved for this login.' });
        if (!KEY) return send(res, 400, { message: 'VAULT_KEY is not set on Render, so passwords cannot be opened.' });
        let pw;
        try { pw = unseal(KEY, l.secret); } catch { return send(res, 400, { message: 'This password was saved with a different VAULT_KEY and cannot be opened.' }); }
        l.lastShownBy = user.name; l.lastShownAt = now(); store.save();
        return send(res, 200, { password: pw });
      }
      if (!m[2] && req.method === 'PUT') {
        const b = await body();
        if (b.label !== undefined) l.label = clean(b.label, 60) || 'Admin page';
        if (b.url !== undefined) l.url = clean(b.url, 300);
        if (b.username !== undefined) l.username = clean(b.username, 160);
        if (b.password) {
          if (!KEY) return send(res, 400, { message: 'Passwords cannot be saved until VAULT_KEY is set on Render.' });
          l.secret = seal(KEY, String(b.password).slice(0, 500));
        }
        l.updatedBy = user.name; l.updatedAt = now();
        store.save();
        return send(res, 200, { ok: true });
      }
      if (!m[2] && req.method === 'DELETE') {
        x.logins = x.logins.filter((q) => q.id !== l.id); store.save();
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { message: 'Not found' });
  }

  return {
    handle,
    ledger,
    attention,
    ourDomainCosts,
    attentionCount: () => attention().count,
    names: () => ensure().list.map((c) => c.name)
  };
}
