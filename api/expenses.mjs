/* =====================================================================
   Company expenses, for the console's Expenses section (owners only).

   Three kinds of cost:
     plans     things that repeat (Google Workspace every month, the
               domain every year). Each keeps its price history: a new
               price starts from a chosen month and the months before it
               keep the old one. A single month can be changed or skipped
               without touching the plan, and a plan can be stopped from a
               month onwards (history stays) or deleted outright.
     entries   one-off costs (a laptop, an ad, a template).
     render    Render's usage CSVs, one per month, cost per service. Each
               service is linked to a client, so hosting cost per client
               is known. The current month's "unbilled charges" file is an
               estimate and is simply imported again to update it.

   Money is kept in its own currency (EUR, USD, ...) and converted to EUR
   for totals. Rates come from the European Central Bank once a day, or
   are typed in by hand; each month keeps the rates it was converted
   with, so old months do not move when the dollar does.

   Reminders: a plan with "remind N days before" shows in "Coming up" and
   is emailed to the team once, N days before each renewal.
   ===================================================================== */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CUR_RE = /^[A-Z]{3}$/;
const DEFAULT_RATES = { USD: 1.16, GBP: 0.88 };          // 1 EUR = x; replaced by the ECB rates on the first fetch
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const todayStr = () => {
  // the team works in Cyprus time
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Nicosia' }));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const monthOf = (date) => date.slice(0, 7);
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthFromIndex = (i) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
const addMonths = (m, n) => monthFromIndex(monthIndex(m) + n);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
function dateInMonth(month, day) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  return `${month}-${pad(Math.min(day, last))}`;
}
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const money = (s) => {
  const n = Number(String(s || '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/* Render's export: invoice_date,charge_type,name,charge,rate,usage,cost
   with invoice_date like "2026-November" and cost like "$4.36" or "—". */
export function parseRenderCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw httpError(400, 'That file is empty.');
  const head = rows[0].map((x) => x.trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  const need = ['invoice_date', 'charge_type', 'name', 'charge', 'cost'];
  if (need.some((n) => col(n) < 0)) throw httpError(400, 'This does not look like a Render usage CSV (it needs invoice_date, name, charge and cost columns).');
  let month = null;
  const lines = [];
  for (const r of rows.slice(1)) {
    const label = (r[col('invoice_date')] || '').trim();
    const mm = label.match(/^(\d{4})-([A-Za-z]+)$/);
    const mi = mm ? MONTHS.findIndex((x) => x.toLowerCase().startsWith(mm[2].toLowerCase().slice(0, 3))) : -1;
    if (mi < 0) continue;
    const m = `${mm[1]}-${pad(mi + 1)}`;
    if (month && m !== month) throw httpError(400, 'The file mixes more than one month. Import one month per file.');
    month = m;
    lines.push({
      type: (r[col('charge_type')] || '').trim().slice(0, 40),
      service: (r[col('name')] || '').trim().slice(0, 80),
      charge: (r[col('charge')] || '').trim().slice(0, 60),
      usage: col('usage') >= 0 ? (r[col('usage')] || '').trim().slice(0, 40) : '',
      cost: r2(money(r[col('cost')]))
    });
  }
  if (!month) throw httpError(400, 'No usable rows: the invoice_date column should read like 2026-November.');
  return { month, lines };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

/* ===================================================================== */
export function setupExpenses({ db, store, send, readJson, clean, id, now, mailer, layout, esc, notifyEmail, publicUrl }) {
  let extraCosts = () => [];                 // set by the Clients section (domains we pay for clients)
  const ensure = () => {
    const x = db.expenses || (db.expenses = {});
    x.plans ||= [];
    x.entries ||= [];
    x.render ||= {};
    x.renderMap ||= {};
    x.settings ||= {};
    if (x.settings.autoRates === undefined) x.settings.autoRates = true;
    x.settings.remindEmail ||= '';
    x.fx ||= {};
    x.fx.rates ||= { ...DEFAULT_RATES };
    x.fx.source ||= 'default';
    x.fx.history ||= {};
    return x;
  };
  ensure();

  /* ---------- currency ---------- */
  function ratesFor(month) {
    const x = ensure();
    return x.fx.history[month] || x.fx.rates;
  }
  function toEur(amount, cur, month) {
    if (cur === 'EUR') return r2(amount);
    const rate = ratesFor(month)[cur] || ensure().fx.rates[cur];
    return rate ? r2(amount / rate) : null;               // null: no rate for that currency yet
  }
  function snapshot() {
    // the current month converts at the latest rates; earlier months keep theirs
    const x = ensure();
    x.fx.history[monthOf(todayStr())] = { ...x.fx.rates };
  }

  async function fetchEcb() {
    const x = ensure();
    if (!x.settings.autoRates) return;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 10_000);
      const res = await fetch(ECB_URL, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('ECB ' + res.status);
      const xml = await res.text();
      const rates = {};
      for (const m of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g)) rates[m[1]] = Number(m[2]);
      const day = (xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/) || [])[1] || todayStr();
      if (!rates.USD) throw new Error('ECB answer had no USD rate');
      x.fx.rates = rates;
      x.fx.date = day;
      x.fx.source = 'ECB';
      snapshot();
      store.save();
    } catch (err) {
      console.warn('Exchange rates not updated:', err.message);
    }
  }

  /* ---------- plans ---------- */
  function priceAt(plan, month) {
    let p = null;
    for (const x of plan.prices) if (x.from <= month && (!p || x.from >= p.from)) p = x;
    return p ? p.amount : (plan.prices[0] ? plan.prices[0].amount : 0);
  }
  // the plan's charge in a given month, or null
  function occurrence(plan, month) {
    const start = monthOf(plan.start);
    const diff = monthIndex(month) - monthIndex(start);
    if (diff < 0 || diff % plan.every) return null;
    if (plan.stop && month >= plan.stop) return null;
    const o = plan.overrides[month] || {};
    if (o.skip) return { skipped: true, date: dateInMonth(month, Number(plan.start.slice(8, 10))) };
    return {
      date: dateInMonth(month, Number(plan.start.slice(8, 10))),
      amount: r2(o.amount !== undefined ? o.amount : priceAt(plan, month)),
      changed: o.amount !== undefined
    };
  }
  function nextOccurrence(plan, from) {
    let m = monthOf(from);
    for (let i = 0; i < 400; i++, m = addMonths(m, 1)) {
      if (plan.stop && m >= plan.stop) return null;
      const o = occurrence(plan, m);
      if (o && !o.skipped && o.date >= from) return { ...o, month: m };
    }
    return null;
  }

  /* ---------- a month, put together ---------- */
  function clientOf(service) {
    return ensure().renderMap[service.toLowerCase()] || '';
  }
  function monthRows(month) {
    const x = ensure();
    const today = todayStr();
    const rows = [];
    for (const p of x.plans) {
      const o = occurrence(p, month);
      if (!o) continue;
      rows.push({
        kind: 'plan', id: p.id, name: p.name, vendor: p.vendor, category: p.category, client: p.client,
        currency: p.currency, amount: o.skipped ? 0 : o.amount, date: o.date, every: p.every,
        skipped: !!o.skipped, changed: !!o.changed, upcoming: o.date > today
      });
    }
    for (const e of x.entries) {
      if (monthOf(e.date) !== month) continue;
      rows.push({ kind: 'entry', id: e.id, name: e.name, vendor: e.vendor, category: e.category, client: e.client,
        currency: e.currency, amount: e.amount, date: e.date, notes: e.notes, upcoming: e.date > today,
        post: e.post || '', campaignFrom: e.campaignFrom || '', campaignTo: e.campaignTo || '' });
    }
    // domains ErgonSite pays for clients (kept in the Clients section)
    for (const d of extraCosts(month)) rows.push({ kind: 'client', ...d, upcoming: d.date > today });
    const r = x.render[month];
    if (r) {
      const by = new Map();
      for (const l of r.lines) {
        const k = l.service;
        const g = by.get(k) || { cost: 0, lines: [] };
        g.cost += l.cost;
        g.lines.push(l);
        by.set(k, g);
      }
      for (const [service, g] of by) {
        rows.push({ kind: 'render', id: service, name: service, vendor: 'Render', category: 'Hosting', client: clientOf(service),
          currency: 'USD', amount: r2(g.cost), date: `${month}-01`, estimate: !r.final,
          lines: g.lines.filter((l) => l.cost > 0).map((l) => ({ charge: l.charge, usage: l.usage, cost: l.cost })) });
      }
    }
    for (const row of rows) row.eur = toEur(row.amount, row.currency, month);
    rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'render' ? 1 : b.kind === 'render' ? -1 : 0) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return rows;
  }
  function totals(rows) {
    const t = { eur: 0, missingRate: false, byCategory: {}, byClient: {}, byCurrency: {}, estimate: false };
    for (const r of rows) {
      if (r.skipped) continue;
      if (r.eur === null) { t.missingRate = true; continue; }
      t.eur += r.eur;
      t.byCategory[r.category || 'Other'] = r2((t.byCategory[r.category || 'Other'] || 0) + r.eur);
      t.byClient[r.client || 'Unassigned'] = r2((t.byClient[r.client || 'Unassigned'] || 0) + r.eur);
      t.byCurrency[r.currency] = r2((t.byCurrency[r.currency] || 0) + r.amount);
      if (r.estimate || r.upcoming) t.estimate = true;
    }
    t.eur = r2(t.eur);
    return t;
  }

  function comingUp() {
    const x = ensure();
    const today = todayStr();
    const out = [];
    for (const p of x.plans) {
      const n = nextOccurrence(p, today);
      if (!n) continue;
      const days = daysBetween(today, n.date);
      const window = Math.max(p.remindDays || 0, p.every === 1 ? 31 : 60);
      if (days > window) continue;
      out.push({ id: p.id, name: p.name, date: n.date, days, amount: n.amount, currency: p.currency,
        eur: toEur(n.amount, p.currency, n.month), every: p.every, due: !!p.remindDays && days <= p.remindDays });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  const dueCount = () => comingUp().filter((c) => c.due).length;

  function planOut(p) {
    const today = todayStr();
    const n = nextOccurrence(p, today);
    return { ...p, currentPrice: priceAt(p, monthOf(today)), next: n ? n.date : null, nextAmount: n ? n.amount : null };
  }

  /* ---------- reminder emails ---------- */
  async function sendReminders() {
    const x = ensure();
    const today = todayStr();
    for (const p of x.plans) {
      if (!p.remindDays) continue;
      const n = nextOccurrence(p, today);
      if (!n || p.remindedFor === n.date) continue;
      const days = daysBetween(today, n.date);
      if (days > p.remindDays) continue;
      const to = x.settings.remindEmail || notifyEmail;
      const amount = `${n.amount.toFixed(2)} ${p.currency}`;
      const when = new Date(n.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      const text = `${p.name} renews on ${when} (${days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days'}) for ${amount}.\n\n`
        + `Make sure the card on file has enough funds, or renew it by hand.\n\nExpenses in the console: ${publicUrl}/admin/#expenses`;
      try {
        await mailer.send({
          to, subject: `Renewal in ${days} day${days === 1 ? '' : 's'}: ${p.name}`, text,
          html: layout(`${p.name} renews soon`, `<p><b>${esc(p.name)}</b> renews on <b>${esc(when)}</b> for <b>${esc(amount)}</b>.</p>`
            + `<p>Make sure the card on file has enough funds, or renew it by hand.</p>`
            + `<p><a href="${esc(publicUrl)}/admin/#expenses" style="color:#1b3a9e;font-weight:600">Open Expenses in the console</a></p>`)
        });
        p.remindedFor = n.date;
        store.save();
      } catch (err) {
        console.error('Renewal reminder not sent:', err.message);
      }
    }
  }

  /* ---------- input checks ---------- */
  function planInput(b, old) {
    const p = old ? { ...old } : { overrides: {}, prices: [], createdAt: now() };
    if (b.name !== undefined) p.name = clean(b.name, 80);
    if (!p.name) throw httpError(400, 'Give it a name.');
    if (b.vendor !== undefined) p.vendor = clean(b.vendor, 60);
    if (b.category !== undefined) p.category = clean(b.category, 40) || 'Other';
    if (b.client !== undefined) p.client = clean(b.client, 60);
    if (b.notes !== undefined) p.notes = clean(b.notes, 400);
    if (b.currency !== undefined) {
      const c = String(b.currency).toUpperCase();
      if (!CUR_RE.test(c)) throw httpError(400, 'Currency should be a 3-letter code like EUR or USD.');
      p.currency = c;
    }
    if (b.every !== undefined) {
      const e = Number(b.every);
      if (![1, 3, 6, 12, 24].includes(e)) throw httpError(400, 'Pick how often it repeats.');
      p.every = e;
    }
    if (b.start !== undefined) {
      if (!DATE_RE.test(b.start)) throw httpError(400, 'The first payment date is not valid.');
      p.start = b.start;
    }
    if (b.remindDays !== undefined) p.remindDays = Math.max(0, Math.min(120, Math.round(Number(b.remindDays) || 0)));
    if (!old) {
      const a = Number(b.amount);
      if (!(a >= 0)) throw httpError(400, 'Enter the price.');
      p.prices = [{ from: monthOf(p.start), amount: r2(a) }];
      p.id = id(8);
    }
    p.currency ||= 'EUR';
    p.every ||= 1;
    p.category ||= 'Other';
    p.vendor ||= '';
    p.client ||= '';
    p.remindDays ??= p.every >= 12 ? 15 : 0;
    p.stop ??= null;
    return p;
  }
  function entryInput(b, old) {
    const e = old ? { ...old } : { createdAt: now() };
    if (b.name !== undefined) e.name = clean(b.name, 80);
    if (!e.name) throw httpError(400, 'Give it a name.');
    if (b.date !== undefined) {
      if (!DATE_RE.test(b.date)) throw httpError(400, 'The date is not valid.');
      e.date = b.date;
    }
    if (!e.date) throw httpError(400, 'Pick a date.');
    if (b.amount !== undefined) {
      const a = Number(b.amount);
      if (!(a >= 0)) throw httpError(400, 'Enter the amount.');
      e.amount = r2(a);
    }
    if (b.currency !== undefined) {
      const c = String(b.currency).toUpperCase();
      if (!CUR_RE.test(c)) throw httpError(400, 'Currency should be a 3-letter code like EUR or USD.');
      e.currency = c;
    }
    for (const [k, n] of [['vendor', 60], ['category', 40], ['client', 60], ['notes', 400], ['post', 300]]) if (b[k] !== undefined) e[k] = clean(b[k], n);
    // an ad campaign can say when it ran
    for (const k of ['campaignFrom', 'campaignTo']) {
      if (b[k] === undefined) continue;
      if (b[k] === '' || b[k] === null) e[k] = '';
      else if (!DATE_RE.test(b[k])) throw httpError(400, 'A campaign date is not valid.');
      else e[k] = b[k];
    }
    if (e.campaignFrom && e.campaignTo && e.campaignTo < e.campaignFrom) throw httpError(400, 'The campaign ends before it starts.');
    e.currency ||= 'EUR';
    e.category ||= 'Other';
    e.vendor ||= '';
    e.client ||= '';
    if (!old) e.id = id(8);
    return e;
  }

  function overview(month) {
    const x = ensure();
    const rows = monthRows(month);
    const history = [];
    for (let i = 11; i >= 0; i--) {
      const m = addMonths(month, -i);
      const t = totals(monthRows(m));
      history.push({ month: m, eur: t.eur, estimate: t.estimate });
    }
    const clients = new Set(['ErgonSite']);
    for (const p of x.plans) if (p.client) clients.add(p.client);
    for (const e of x.entries) if (e.client) clients.add(e.client);
    for (const c of Object.values(x.renderMap)) if (c) clients.add(c);
    for (const c of (db.clients && db.clients.list) || []) clients.add(c.name);      // the Clients section
    const categories = new Set(['Hosting', 'Email & software', 'Domains', 'Instagram ads', 'Marketing', 'Equipment', 'Other']);
    for (const p of x.plans) categories.add(p.category);
    for (const e of x.entries) categories.add(e.category);
    const services = new Set();
    for (const r of Object.values(x.render)) for (const l of r.lines) services.add(l.service);
    return {
      month, label: monthLabel(month), today: todayStr(),
      rows, totals: totals(rows), history, comingUp: comingUp(),
      plans: x.plans.map(planOut).sort((a, b) => a.name.localeCompare(b.name)),
      render: Object.fromEntries(Object.entries(x.render).map(([m, r]) => [m, { final: r.final, importedAt: r.importedAt, file: r.file }])),
      renderMap: x.renderMap, services: [...services].sort((a, b) => a.localeCompare(b)),
      fx: { rates: x.fx.rates, date: x.fx.date || '', source: x.fx.source, monthRates: ratesFor(month) },
      settings: { ...x.settings, defaultEmail: notifyEmail },
      clients: [...clients].sort((a, b) => a.localeCompare(b)), categories: [...categories].sort((a, b) => a.localeCompare(b))
    };
  }

  function exportCsv(from, to) {
    const out = [['date', 'month', 'type', 'name', 'vendor', 'category', 'client', 'currency', 'amount', 'eur', 'status'].join(',')];
    for (let i = monthIndex(from); i <= monthIndex(to); i++) {
      const m = monthFromIndex(i);
      for (const r of monthRows(m)) {
        if (r.skipped || (r.kind === 'render' && !r.amount)) continue;
        const status = r.estimate ? 'estimate' : r.upcoming ? 'upcoming' : 'charged';
        out.push([r.date, m, r.kind === 'render' ? 'hosting usage' : r.kind === 'plan' ? 'recurring' : r.kind === 'client' ? 'client domain' : 'one-off', r.name + (r.post ? ' (' + r.post + ')' : ''), r.vendor, r.category,
          r.client, r.currency, r.amount.toFixed(2), r.eur === null ? '' : r.eur.toFixed(2), status].map(csvCell).join(','));
      }
    }
    return out.join('\r\n') + '\r\n';
  }

  function mergeBackup(data) {
    const x = ensure();
    if (!data || typeof data !== 'object') throw httpError(400, 'That file is not an expenses backup.');
    let added = 0;
    for (const p of Array.isArray(data.plans) ? data.plans : []) {
      if (!p || !p.id || x.plans.some((q) => q.id === p.id)) continue;
      const clean1 = planInput({ ...p, amount: (p.prices && p.prices[0] && p.prices[0].amount) || 0 });
      clean1.id = String(p.id).slice(0, 20);
      if (Array.isArray(p.prices) && p.prices.length) {
        clean1.prices = p.prices.filter((q) => q && MONTH_RE.test(q.from)).map((q) => ({ from: q.from, amount: r2(q.amount) }));
      }
      clean1.overrides = {};
      for (const [m, o] of Object.entries(p.overrides || {})) {
        if (!MONTH_RE.test(m) || !o) continue;
        clean1.overrides[m] = o.skip ? { skip: true } : { amount: r2(o.amount) };
      }
      clean1.stop = p.stop && MONTH_RE.test(p.stop) ? p.stop : null;
      x.plans.push(clean1); added++;
    }
    for (const e of Array.isArray(data.entries) ? data.entries : []) {
      if (!e || !e.id || x.entries.some((q) => q.id === e.id)) continue;
      const c = entryInput(e);
      c.id = String(e.id).slice(0, 20);
      x.entries.push(c); added++;
    }
    for (const [m, r] of Object.entries(data.render || {})) {
      if (!MONTH_RE.test(m) || !r || !Array.isArray(r.lines)) continue;
      x.render[m] = { final: !!r.final, importedAt: r.importedAt || now(), file: clean(r.file, 120),
        lines: r.lines.slice(0, 500).map((l) => ({ type: clean(l.type, 40), service: clean(l.service, 80), charge: clean(l.charge, 60), usage: clean(l.usage, 40), cost: r2(l.cost) })) };
      added++;
    }
    for (const [k, v] of Object.entries(data.renderMap || {})) x.renderMap[String(k).toLowerCase().slice(0, 80)] = clean(v, 60);
    store.save();
    return added;
  }

  /* ---------- routes: /admin/api/expenses/... ---------- */
  async function handle(req, res, p, user, url) {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only owners can see expenses.' });
    const x = ensure();
    const body = () => readJson(req, 512 * 1024);

    if (p === '/expenses' && req.method === 'GET') {
      const m = url.searchParams.get('month');
      return send(res, 200, overview(MONTH_RE.test(m || '') ? m : monthOf(todayStr())));
    }

    if (p === '/expenses/export.csv' && req.method === 'GET') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      if (!MONTH_RE.test(from || '') || !MONTH_RE.test(to || '') || from > to) return send(res, 400, { message: 'Pick a valid period.' });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ergonsite-expenses-${from}-to-${to}.csv"`, 'Cache-Control': 'no-store' });
      return res.end('﻿' + exportCsv(from, to));
    }
    if (p === '/expenses/backup' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="ergonsite-expenses-backup-${todayStr()}.json"`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ kind: 'ergonsite-expenses', version: 1, exportedAt: new Date().toISOString(), plans: x.plans, entries: x.entries, render: x.render, renderMap: x.renderMap }, null, 1));
    }
    if (p === '/expenses/import' && req.method === 'POST') {
      const b = await body();
      const added = mergeBackup(b.data);
      return send(res, 200, { ok: true, added });
    }

    /* recurring */
    if (p === '/expenses/plans' && req.method === 'POST') {
      const plan = planInput(await body());
      x.plans.push(plan); store.save();
      return send(res, 201, { plan: planOut(plan) });
    }
    let m = p.match(/^\/expenses\/plans\/([A-Za-z0-9_-]+)(\/price|\/stop|\/month)?$/);
    if (m) {
      const i = x.plans.findIndex((q) => q.id === m[1]);
      if (i < 0) return send(res, 404, { message: 'Not found.' });
      const plan = x.plans[i];
      if (!m[2] && req.method === 'PUT') {
        x.plans[i] = planInput(await body(), plan); store.save();
        return send(res, 200, { plan: planOut(x.plans[i]) });
      }
      if (!m[2] && req.method === 'DELETE') {
        x.plans.splice(i, 1); store.save();
        return send(res, 200, { ok: true });
      }
      if (m[2] === '/price' && req.method === 'POST') {
        // a new price from a month onwards; the months before keep theirs
        const b = await body();
        const a = Number(b.amount);
        if (!MONTH_RE.test(b.from || '') || !(a >= 0)) return send(res, 400, { message: 'Enter the new price and the month it starts.' });
        plan.prices = plan.prices.filter((q) => q.from !== b.from);
        plan.prices.push({ from: b.from, amount: r2(a) });
        plan.prices.sort((q, w) => q.from.localeCompare(w.from));
        for (const k of Object.keys(plan.overrides)) if (k >= b.from && plan.overrides[k].amount !== undefined) delete plan.overrides[k];
        store.save();
        return send(res, 200, { plan: planOut(plan) });
      }
      if (m[2] === '/stop' && req.method === 'POST') {
        const b = await body();
        if (b.from !== null && !MONTH_RE.test(b.from || '')) return send(res, 400, { message: 'Pick the first month without it.' });
        plan.stop = b.from;                              // null starts it again
        store.save();
        return send(res, 200, { plan: planOut(plan) });
      }
      if (m[2] === '/month' && req.method === 'POST') {
        // change or skip one month only
        const b = await body();
        if (!MONTH_RE.test(b.month || '')) return send(res, 400, { message: 'Which month?' });
        if (b.reset) delete plan.overrides[b.month];
        else if (b.skip) plan.overrides[b.month] = { skip: true };
        else {
          const a = Number(b.amount);
          if (!(a >= 0)) return send(res, 400, { message: 'Enter the amount for that month.' });
          plan.overrides[b.month] = { amount: r2(a) };
        }
        store.save();
        return send(res, 200, { plan: planOut(plan) });
      }
    }

    /* one-off */
    if (p === '/expenses/entries' && req.method === 'POST') {
      const e = entryInput(await body());
      x.entries.push(e); store.save();
      return send(res, 201, { entry: e });
    }
    m = p.match(/^\/expenses\/entries\/([A-Za-z0-9_-]+)$/);
    if (m) {
      const i = x.entries.findIndex((q) => q.id === m[1]);
      if (i < 0) return send(res, 404, { message: 'Not found.' });
      if (req.method === 'PUT') { x.entries[i] = entryInput(await body(), x.entries[i]); store.save(); return send(res, 200, { entry: x.entries[i] }); }
      if (req.method === 'DELETE') { x.entries.splice(i, 1); store.save(); return send(res, 200, { ok: true }); }
    }

    /* Render usage */
    if (p === '/expenses/render' && req.method === 'POST') {
      const b = await body();
      const { month, lines } = parseRenderCsv(b.csv || '');
      const file = clean(b.file, 120);
      const final = !/unbilled/i.test(file) && month < monthOf(todayStr());
      const replaced = !!x.render[month];
      x.render[month] = { final, importedAt: now(), file, lines };
      for (const l of lines) {
        const k = l.service.toLowerCase();
        if (!(k in x.renderMap)) x.renderMap[k] = '';
      }
      store.save();
      return send(res, 200, { month, label: monthLabel(month), final, replaced, total: r2(lines.reduce((n, l) => n + l.cost, 0)) });
    }
    m = p.match(/^\/expenses\/render\/(\d{4}-\d{2})$/);
    if (m && req.method === 'DELETE') {
      delete x.render[m[1]]; store.save();
      return send(res, 200, { ok: true });
    }
    if (p === '/expenses/render-map' && req.method === 'PUT') {
      const b = await body();
      for (const [k, v] of Object.entries(b.map || {})) x.renderMap[String(k).toLowerCase().slice(0, 80)] = clean(v, 60);
      store.save();
      return send(res, 200, { ok: true });
    }

    /* settings */
    if (p === '/expenses/settings' && req.method === 'PUT') {
      const b = await body();
      if (b.remindEmail !== undefined) {
        const e = clean(b.remindEmail, 160);
        if (e && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(e)) return send(res, 400, { message: 'That reminder email is not valid.' });
        x.settings.remindEmail = e;
      }
      if (b.autoRates !== undefined) x.settings.autoRates = !!b.autoRates;
      if (b.rates && typeof b.rates === 'object') {
        for (const [c, v] of Object.entries(b.rates)) {
          const cur = String(c).toUpperCase(), n = Number(v);
          if (CUR_RE.test(cur) && cur !== 'EUR' && n > 0) x.fx.rates[cur] = Math.round(n * 1e6) / 1e6;
        }
        x.fx.source = 'manual';
        x.fx.date = todayStr();
        x.settings.autoRates = false;
        snapshot();
      }
      store.save();
      if (b.autoRates) await fetchEcb();
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { message: 'Not found' });
  }

  /* ---------- background: rates twice a day, reminders every hour ---------- */
  setTimeout(() => { fetchEcb(); sendReminders(); }, 5_000);
  setInterval(fetchEcb, 12 * 3600_000).unref();
  setInterval(sendReminders, 3600_000).unref();

  // costs per client over a period, in euro (for the Clients report); keys are lower-case names
  function costsByClient(fromMonth, toMonth) {
    const byClient = {};
    let total = 0;
    for (let i = monthIndex(fromMonth); i <= monthIndex(toMonth); i++) {
      for (const r of monthRows(monthFromIndex(i))) {
        if (r.skipped || r.eur === null) continue;
        const k = String(r.client || 'unassigned').trim().toLowerCase();
        byClient[k] = r2((byClient[k] || 0) + r.eur);
        total += r.eur;
      }
    }
    return { byClient, total: r2(total) };
  }

  // every cost between two months, one row each (for Reports)
  function rowsBetween(fromMonth, toMonth) {
    const out = [];
    for (let i = monthIndex(fromMonth); i <= monthIndex(toMonth); i++) {
      const m = monthFromIndex(i);
      for (const r of monthRows(m)) {
        if (r.skipped || (r.kind === 'render' && !r.amount)) continue;
        out.push({ month: m, date: r.date, kind: r.kind, name: r.name + (r.post ? ' · ' + r.post : ''), vendor: r.vendor, category: r.category || 'Other', client: r.client || '',
          currency: r.currency, amount: r.amount, eur: r.eur, estimate: !!r.estimate, upcoming: !!r.upcoming });
      }
    }
    return out;
  }

  return { handle, dueCount, costsByClient, rowsBetween, comingUp: () => comingUp(), monthTotal: (m) => totals(monthRows(m)),
    setExtraCosts: (fn) => { extraCosts = fn; } };
}
