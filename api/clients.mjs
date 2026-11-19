/* =====================================================================
   Clients and billing, for the console's Clients section (owners only).

   For every client: contact details, what they pay us (website or CRM
   fees, yearly maintenance), their domain's expiry date, the payments
   they made, and the logins to their admin page.

   Charges
     website / crm / other   a one-off fee; it can be paid in parts.
     maintenance             a yearly fee with a start and an end date.
     domain                  the client's own domain, in the client's own
                             registrar account and paid by them to the
                             registrar; we only remind them to renew it.
   A charge's status comes from its payments: Pending, Partly paid, Paid.

   Emails to clients are never sent on their own. Each day the console
   prepares drafts and waits for an owner to read, edit and send them:
     - renewal notices, a set number of days (30) before a maintenance
       year or a domain ends; sending a maintenance notice also opens
       the next year's charge, so its payment can be tracked;
     - payment reminders for anything unpaid, on the due date and then
       every few weeks until it is paid.
   When new drafts appear, the team gets one email saying so.

   Logins are encrypted with AES-256-GCM. The key comes from VAULT_KEY in
   Render's environment and never touches the data file, so the file on
   its own does not give the passwords away.
   ===================================================================== */
import crypto from 'node:crypto';

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,}$/;
const TYPES = ['website', 'crm', 'maintenance', 'domain', 'other'];
const TYPE_LABEL = { website: 'Website', crm: 'CRM', maintenance: 'Maintenance & hosting', domain: 'Domain', other: 'Other' };
const METHODS = ['Cash', 'Bank transfer', 'Card', 'Other'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Nicosia' }));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const addDays = (date, n) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
function open(key, sealed) {
  const b = Buffer.from(sealed, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/* ===================================================================== */
export function setupClients({ db, store, send, readJson, clean, id, now, mailer, layout, esc, notifyEmail, publicUrl, vaultSecret, expenses }) {
  const KEY = vaultKey(vaultSecret);
  const ensure = () => {
    const x = db.clients || (db.clients = {});
    x.list ||= [];
    x.charges ||= [];
    x.logins ||= [];
    x.outbox ||= [];
    x.settings ||= {};
    const s = x.settings;
    s.remindDays ??= 30;
    s.chaseDays ??= 14;
    s.paymentText ??= 'You can pay in cash when we next meet, or reply to this email and we will arrange it with you.';
    s.signature ??= 'ErgonSite Team';
    s.digest ??= true;
    return x;
  };
  ensure();

  /* ---------- figures ---------- */
  const paidOf = (c) => r2((c.payments || []).reduce((n, p) => n + p.amount, 0));
  function statusOf(c, today = todayStr()) {
    if (c.type === 'domain') {
      if (c.renewedTo) return { key: 'renewed', label: 'Renewed' };
      if (!c.end) return { key: 'check', label: 'Expiry not known' };
      const d = daysBetween(today, c.end);
      if (d < 0) return { key: 'overdue', label: 'Expired' };
      if (d <= (c.remindDays ?? ensure().settings.remindDays)) return { key: 'soon', label: 'Renew soon' };
      return { key: 'ok', label: 'Active' };
    }
    const amount = c.amount || 0;
    const paid = paidOf(c);
    if (amount > 0 && paid >= amount) return { key: 'paid', label: 'Paid' };
    const late = c.start && c.start < today;
    if (paid > 0) return { key: late ? 'overdue' : 'part', label: 'Partly paid, ' + euro(r2(amount - paid), c.currency) + ' to go' };
    return { key: late ? 'overdue' : 'pending', label: late ? 'Unpaid' : 'Pending' };
  }
  function chargeOut(c) {
    const s = statusOf(c);
    return { ...c, paid: paidOf(c), open: c.type === 'domain' ? 0 : r2(Math.max(0, (c.amount || 0) - paidOf(c))), status: s.key, statusLabel: s.label, typeLabel: TYPE_LABEL[c.type] };
  }
  function clientOut(cl) {
    const x = ensure();
    const charges = x.charges.filter((c) => c.clientId === cl.id).map(chargeOut);
    const today = todayStr();
    const next = charges.filter((c) => (c.type === 'maintenance' || c.type === 'domain') && c.end && !c.renewedTo && c.end >= today)
      .sort((a, b) => a.end.localeCompare(b.end))[0];
    return {
      ...cl,
      open: r2(charges.reduce((n, c) => n + c.open, 0)),
      paidTotal: r2(charges.reduce((n, c) => n + (c.type === 'domain' ? 0 : c.paid), 0)),
      overdue: charges.some((c) => c.status === 'overdue'),
      nextRenewal: next ? { date: next.end, type: next.typeLabel } : null,
      drafts: x.outbox.filter((o) => o.clientId === cl.id && o.status === 'draft').length
    };
  }

  /* ---------- the emails ---------- */
  function draft(cl, c, kind) {
    const x = ensure();
    const s = x.settings;
    const name = (cl.contact || '').split(/\s+/)[0] || cl.name;
    const sign = `\n\nKind regards,\n${s.signature}\ninfo@ergonsite.com · +357 96 400 240`;
    let subject, text;
    if (kind === 'renewal' && c.type === 'maintenance') {
      const nextEnd = addMonthsDate(c.end, 12);
      subject = `Your ErgonSite maintenance renews on ${nice(c.end)}`;
      text = `Dear ${name},\n\nA friendly note that the maintenance and hosting plan for ${cl.website || cl.name} ends on ${nice(c.end)}.\n\n`
        + `To keep your website online, updated and supported for another year (${nice(c.end)} to ${nice(nextEnd)}), the renewal is ${euro(c.amount || 0, c.currency)}.\n\n`
        + `${s.paymentText}\n\nIf you have any questions, just reply to this email.${sign}`;
    } else if (kind === 'renewal' && c.type === 'domain') {
      const dom = c.domainName || cl.domain || 'your domain';
      subject = `Your domain ${dom} expires on ${nice(c.end)}`;
      text = `Dear ${name},\n\nA friendly reminder that your domain ${dom} expires on ${nice(c.end)}.\n\n`
        + `The domain is registered in your own${c.registrar ? ' ' + c.registrar : ''} account, so the renewal is made there and paid directly to ${c.registrar || 'the registrar'}${c.domainCost ? ' (' + c.domainCost + ' a year)' : ''}. `
        + `Please renew it before ${nice(c.end)}: if it expires, the website and any email addresses on it stop working.\n\n`
        + `If you would like us to help with the renewal, reply to this email and we will arrange it.${sign}`;
    } else {
      const open = r2((c.amount || 0) - paidOf(c));
      subject = `Payment reminder: ${c.description || TYPE_LABEL[c.type]}`;
      text = `Dear ${name},\n\nA friendly reminder that ${euro(open, c.currency)} is still open for ${c.description || TYPE_LABEL[c.type]}${c.start ? ' (due ' + nice(c.start) + ')' : ''}.\n\n`
        + `${s.paymentText}\n\nIf you have already paid, thank you, and please ignore this email.${sign}`;
    }
    const d = { id: id(8), clientId: cl.id, chargeId: c.id, kind, to: cl.email || '', subject, text, createdAt: now(), status: 'draft' };
    x.outbox.push(d);
    return d;
  }

  // prepare whatever is due today; returns the new drafts
  function prepare() {
    const x = ensure();
    const s = x.settings;
    const today = todayStr();
    const made = [];
    for (const c of x.charges) {
      const cl = x.list.find((k) => k.id === c.clientId);
      if (!cl || cl.paused || c.noReminders) continue;
      const mine = x.outbox.filter((o) => o.chargeId === c.id);
      // renewal notice
      if ((c.type === 'maintenance' || c.type === 'domain') && c.end && !c.renewedTo) {
        const days = daysBetween(today, c.end);
        if (days <= (c.remindDays ?? s.remindDays) && days >= -30 && !mine.some((o) => o.kind === 'renewal')) made.push(draft(cl, c, 'renewal'));
      }
      // payment reminder
      if (c.type !== 'domain' && (c.amount || 0) > paidOf(c) && c.start && c.start <= today) {
        const last = mine.filter((o) => o.kind === 'payment').sort((a, b) => b.createdAt - a.createdAt)[0];
        const waiting = last && last.status === 'draft';
        const recent = last && daysBetween(new Date(last.sentAt || last.dismissedAt || last.createdAt).toISOString().slice(0, 10), today) < s.chaseDays;
        if (!waiting && !recent) made.push(draft(cl, c, 'payment'));
      }
    }
    if (made.length) store.save();
    return made;
  }
  async function daily() {
    const made = prepare();
    const x = ensure();
    if (!made.length || !x.settings.digest) return;
    const lines = made.map((d) => {
      const cl = x.list.find((k) => k.id === d.clientId);
      return `- ${cl ? cl.name : 'Client'}: ${d.subject}`;
    });
    try {
      await mailer.send({
        to: notifyEmail,
        subject: `${made.length} client email${made.length === 1 ? '' : 's'} waiting for your approval`,
        text: `The console has prepared these emails to clients. Nothing is sent until you approve it.\n\n${lines.join('\n')}\n\nOpen them: ${publicUrl}/admin/#clients/outbox`,
        html: layout('Client emails to approve', `<p>The console has prepared these emails to clients. Nothing is sent until you approve it.</p><ul>${lines.map((l) => '<li>' + esc(l.slice(2)) + '</li>').join('')}</ul>`
          + `<p><a href="${esc(publicUrl)}/admin/#clients/outbox" style="color:#1b3a9e;font-weight:600">Open the emails to approve</a></p>`)
      });
    } catch (err) {
      console.error('Draft digest not sent:', err.message);
    }
  }

  async function sendDraft(d, user) {
    const x = ensure();
    if (!EMAIL_RE.test(d.to || '')) throw httpError(400, 'This client has no valid email address. Add it on the client first.');
    if (!mailer.enabled) throw httpError(400, 'Email is not set up on the server, so nothing can be sent yet.');
    const html = layout(d.subject, esc(d.text).replace(/\n/g, '<br>'));
    await mailer.send({ to: d.to, replyTo: 'info@ergonsite.com', subject: d.subject, text: d.text, html });
    d.status = 'sent';
    d.sentAt = now();
    d.sentBy = user.name;
    // sending a maintenance renewal opens next year's charge
    const c = x.charges.find((q) => q.id === d.chargeId);
    if (c && d.kind === 'renewal' && c.type === 'maintenance' && !c.renewedTo) renew(c, {});
    store.save();
  }

  function renew(c, b) {
    const x = ensure();
    const start = c.end || todayStr();
    const end = b.end && DATE_RE.test(b.end) ? b.end : addMonthsDate(start, 12);
    const next = {
      id: id(8), clientId: c.clientId, type: c.type, description: c.description, currency: c.currency || 'EUR',
      amount: c.type === 'domain' ? null : r2(b.amount !== undefined && b.amount !== '' ? b.amount : c.amount),
      start, end, payments: [], registrar: c.registrar || '', domainName: c.domainName || '', domainCost: c.domainCost || '',
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
      if (e && !e.split(/[,;]\s*/).every((x) => EMAIL_RE.test(x))) throw httpError(400, 'That email address is not valid.');
      c.email = e;
    }
    if (b.paused !== undefined) c.paused = !!b.paused;
    if (!c.name) throw httpError(400, 'The client needs a name.');
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
    if (b.amount !== undefined) c.amount = b.amount === '' || b.amount === null ? null : r2(b.amount);
    if (c.type !== 'domain' && !(c.amount >= 0)) throw httpError(400, 'Enter the amount.');
    if (c.type === 'domain') c.amount = null;
    if (b.remindDays !== undefined) c.remindDays = b.remindDays === '' || b.remindDays === null ? undefined : Math.max(0, Math.min(180, Math.round(Number(b.remindDays))));
    if (b.noReminders !== undefined) c.noReminders = !!b.noReminders;
    c.currency ||= 'EUR';
    c.description ||= TYPE_LABEL[c.type];
    if (!old) c.id = id(8);
    return c;
  }

  /* ---------- reports: what came in against what it cost ---------- */
  function report(year) {
    const x = ensure();
    const from = `${year}-01-01`, to = `${year}-12-31`;
    const costs = expenses ? expenses.costsByClient(`${year}-01`, `${year}-12`) : { byClient: {}, total: 0 };
    const key = (s) => String(s || '').trim().toLowerCase();
    const rows = x.list.map((cl) => {
      const charges = x.charges.filter((c) => c.clientId === cl.id && c.type !== 'domain');
      const billed = r2(charges.filter((c) => c.start && c.start >= from && c.start <= to).reduce((n, c) => n + (c.amount || 0), 0));
      const received = r2(charges.reduce((n, c) => n + (c.payments || []).filter((p) => p.date >= from && p.date <= to).reduce((m, p) => m + p.amount, 0), 0));
      const open = r2(charges.reduce((n, c) => n + Math.max(0, (c.amount || 0) - paidOf(c)), 0));
      const cost = r2(costs.byClient[key(cl.name)] || 0);
      return { id: cl.id, name: cl.name, billed, received, open, costs: cost, profit: r2(received - cost) };
    }).sort((a, b) => b.received - a.received || a.name.localeCompare(b.name));
    const named = new Set(x.list.map((c) => key(c.name)));
    const company = r2(Object.entries(costs.byClient).filter(([k]) => !named.has(k)).reduce((n, [, v]) => n + v, 0));
    const t = rows.reduce((a, r) => ({ billed: a.billed + r.billed, received: a.received + r.received, open: a.open + r.open, costs: a.costs + r.costs }), { billed: 0, received: 0, open: 0, costs: 0 });
    const allCosts = r2(t.costs + company);
    return { year, rows, company, totals: { billed: r2(t.billed), received: r2(t.received), open: r2(t.open), clientCosts: r2(t.costs), costs: allCosts, profit: r2(t.received - allCosts) } };
  }

  function overview() {
    const x = ensure();
    prepare();
    return {
      today: todayStr(),
      clients: x.list.map(clientOut).sort((a, b) => a.name.localeCompare(b.name)),
      drafts: x.outbox.filter((o) => o.status === 'draft').length,
      upcoming: x.charges.filter((c) => (c.type === 'maintenance' || c.type === 'domain') && c.end && !c.renewedTo)
        .map((c) => ({ ...chargeOut(c), client: (x.list.find((k) => k.id === c.clientId) || {}).name, days: daysBetween(todayStr(), c.end) }))
        .filter((c) => c.days <= 120).sort((a, b) => a.end.localeCompare(b.end)),
      unpaid: x.charges.filter((c) => c.type !== 'domain' && (c.amount || 0) > paidOf(c))
        .map((c) => ({ ...chargeOut(c), client: (x.list.find((k) => k.id === c.clientId) || {}).name }))
        .sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999')),
      vault: !!KEY, mail: mailer.enabled, settings: x.settings, methods: METHODS, types: TYPE_LABEL
    };
  }
  function clientDetail(cl) {
    const x = ensure();
    return {
      client: clientOut(cl),
      charges: x.charges.filter((c) => c.clientId === cl.id).map(chargeOut)
        .sort((a, b) => (b.start || '').localeCompare(a.start || '') || a.type.localeCompare(b.type)),
      logins: x.logins.filter((l) => l.clientId === cl.id).map(({ secret, ...l }) => ({ ...l, hasPassword: !!secret })),
      emails: x.outbox.filter((o) => o.clientId === cl.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
    };
  }

  /* other parts of the console keep client names (expenses); keep them in step */
  function renameEverywhere(oldName, newName) {
    if (!oldName || oldName === newName || !db.expenses) return;
    const same = (s) => String(s || '').trim().toLowerCase() === oldName.trim().toLowerCase();
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

  /* ---------- routes: /admin/api/clients/... ---------- */
  async function handle(req, res, p, user, url) {
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
    if (p === '/clients/report' && req.method === 'GET') {
      const y = Number(url.searchParams.get('year')) || Number(todayStr().slice(0, 4));
      return send(res, 200, report(y));
    }
    if (p === '/clients/import' && req.method === 'POST') {
      const b = await body();
      return send(res, 200, { ok: true, added: importData(b.data) });
    }
    if (p === '/clients/settings' && req.method === 'PUT') {
      const b = await body();
      const s = x.settings;
      if (b.remindDays !== undefined) s.remindDays = Math.max(1, Math.min(180, Math.round(Number(b.remindDays) || 30)));
      if (b.chaseDays !== undefined) s.chaseDays = Math.max(3, Math.min(90, Math.round(Number(b.chaseDays) || 14)));
      if (b.paymentText !== undefined) s.paymentText = clean(b.paymentText, 600);
      if (b.signature !== undefined) s.signature = clean(b.signature, 80) || 'ErgonSite Team';
      if (b.digest !== undefined) s.digest = !!b.digest;
      store.save();
      return send(res, 200, { ok: true });
    }

    /* emails waiting for approval */
    if (p === '/clients/outbox' && req.method === 'GET') {
      prepare();
      const list = x.outbox.filter((o) => o.status === 'draft').sort((a, b) => a.createdAt - b.createdAt)
        .map((o) => ({ ...o, client: (x.list.find((k) => k.id === o.clientId) || {}).name }));
      const sent = x.outbox.filter((o) => o.status !== 'draft').sort((a, b) => (b.sentAt || b.dismissedAt || 0) - (a.sentAt || a.dismissedAt || 0)).slice(0, 40)
        .map((o) => ({ ...o, client: (x.list.find((k) => k.id === o.clientId) || {}).name }));
      return send(res, 200, { drafts: list, history: sent, mail: mailer.enabled });
    }
    m = p.match(/^\/clients\/outbox\/([A-Za-z0-9_-]+)(\/send|\/dismiss)?$/);
    if (m) {
      const d = x.outbox.find((o) => o.id === m[1]);
      if (!d) return send(res, 404, { message: 'Not found.' });
      if (d.status !== 'draft') return send(res, 400, { message: 'This email was already handled.' });
      if (!m[2] && req.method === 'PUT') {
        const b = await body();
        if (b.to !== undefined) d.to = clean(b.to, 300);
        if (b.subject !== undefined) d.subject = clean(b.subject, 200);
        if (b.text !== undefined) d.text = clean(b.text, 8000);
        d.edited = true;
        store.save();
        return send(res, 200, { ok: true });
      }
      if (m[2] === '/send' && req.method === 'POST') {
        const b = await body();
        if (b.to !== undefined) d.to = clean(b.to, 300);
        if (b.subject !== undefined) d.subject = clean(b.subject, 200);
        if (b.text !== undefined) d.text = clean(b.text, 8000);
        await sendDraft(d, user);
        return send(res, 200, { ok: true });
      }
      if (m[2] === '/dismiss' && req.method === 'POST') {
        d.status = 'dismissed'; d.dismissedAt = now(); d.dismissedBy = user.name;
        store.save();
        return send(res, 200, { ok: true });
      }
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
        // drafts not sent yet go to the new address
        for (const o of x.outbox) if (o.clientId === next.id && o.status === 'draft') o.to = next.email || '';
        store.save();
        return send(res, 200, { client: clientOut(next) });
      }
      if (req.method === 'DELETE') {
        const cid = x.list[i].id;
        x.list.splice(i, 1);
        x.charges = x.charges.filter((c) => c.clientId !== cid);
        x.logins = x.logins.filter((l) => l.clientId !== cid);
        x.outbox = x.outbox.filter((o) => o.clientId !== cid);
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
      if (c.type !== 'domain' && Number(b.paidNow) > 0) {
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
        x.outbox = x.outbox.filter((o) => o.chargeId !== c.id || o.status !== 'draft');
        store.save();
        return send(res, 200, { ok: true });
      }
      if (m[2] === '/payments' && req.method === 'POST') {
        const b = await body();
        const a = r2(b.amount);
        if (!(a > 0)) return send(res, 400, { message: 'Enter the amount received.' });
        if (!DATE_RE.test(b.date || '')) return send(res, 400, { message: 'Pick the date it was paid.' });
        c.payments.push({ id: id(6), date: b.date, amount: a, method: METHODS.includes(b.method) ? b.method : 'Other', note: clean(b.note, 200) });
        // a waiting payment reminder: dropped when paid in full, otherwise rewritten
        // with the new open amount (unless someone already edited it by hand)
        for (const o of x.outbox) {
          if (o.chargeId !== c.id || o.kind !== 'payment' || o.status !== 'draft') continue;
          if (paidOf(c) >= (c.amount || 0)) { o.status = 'dismissed'; o.dismissedAt = now(); o.dismissedBy = 'paid'; continue; }
          if (o.edited) continue;
          const cl = x.list.find((k) => k.id === c.clientId);
          const fresh = draft(cl, c, 'payment');
          x.outbox = x.outbox.filter((q) => q !== fresh);
          o.subject = fresh.subject; o.text = fresh.text;
        }
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
        if (c.type !== 'maintenance' && c.type !== 'domain') return send(res, 400, { message: 'Only maintenance and domains renew.' });
        const next = renew(c, await body());
        for (const o of x.outbox) if (o.chargeId === c.id && o.kind === 'renewal' && o.status === 'draft') { o.status = 'dismissed'; o.dismissedAt = now(); o.dismissedBy = 'renewed'; }
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
        try { pw = open(KEY, l.secret); } catch { return send(res, 400, { message: 'This password was saved with a different VAULT_KEY and cannot be opened.' }); }
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

  setTimeout(daily, 8_000);
  setInterval(daily, 6 * 3600_000).unref();

  // money in between two dates (for Reports): payments received, and charges billed
  function ledger(from, to) {
    const x = ensure();
    const name = (cid) => (x.list.find((k) => k.id === cid) || {}).name || 'Unknown client';
    const payments = [], billed = [];
    for (const c of x.charges) {
      if (c.type === 'domain') continue;
      for (const p of c.payments || []) {
        if (p.date >= from && p.date <= to) payments.push({ date: p.date, client: name(c.clientId), type: TYPE_LABEL[c.type], description: c.description, method: p.method, note: p.note || '', currency: c.currency || 'EUR', amount: p.amount });
      }
      if (c.start && c.start >= from && c.start <= to) billed.push({ date: c.start, client: name(c.clientId), type: TYPE_LABEL[c.type], description: c.description, currency: c.currency || 'EUR', amount: c.amount || 0, paid: paidOf(c) });
    }
    const open = x.charges.filter((c) => c.type !== 'domain' && (c.amount || 0) > paidOf(c))
      .map((c) => ({ client: name(c.clientId), description: c.description, due: c.start || null, open: r2((c.amount || 0) - paidOf(c)) }));
    return { payments, billed, open };
  }

  return {
    handle,
    ledger,
    draftCount: () => ensure().outbox.filter((o) => o.status === 'draft').length,
    names: () => ensure().list.map((c) => c.name)
  };
}
