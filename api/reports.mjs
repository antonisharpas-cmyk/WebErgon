/* =====================================================================
   Reports, for the console (owners only): money in against costs over
   any period, filtered by client and by cost category.

   Money in comes from the Clients section (payments received, and what
   was billed). Costs come from the Expenses section (recurring, one-off
   and Render hosting, converted to euro). Clients are matched by name.

   GET /admin/api/dashboard  what needs doing (unpaid, renewals, our own
       renewals, things to check) and the month and the year in money
   GET /admin/api/reports?from=YYYY-MM&to=YYYY-MM&client=&category=
   GET /admin/api/reports/export.csv  (same filters) one line per payment
       and per cost, for the accountant
   ===================================================================== */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const pad = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const monthIndex = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const monthFromIndex = (i) => `${Math.floor(i / 12)}-${pad((i % 12) + 1)}`;
const lastDay = (m) => `${m}-${pad(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate())}`;
const key = (s) => String(s || '').trim().toLowerCase();
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function setupReports({ send, expenses, clients, inbox }) {
  function filters(url) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    let from = url.searchParams.get('from') || `${now.getFullYear()}-01`;
    let to = url.searchParams.get('to') || thisMonth;
    if (!MONTH_RE.test(from)) from = `${now.getFullYear()}-01`;
    if (!MONTH_RE.test(to)) to = thisMonth;
    if (from > to) [from, to] = [to, from];
    if (monthIndex(to) - monthIndex(from) > 59) from = monthFromIndex(monthIndex(to) - 59);      // five years at most
    // several clients and categories can be picked: ?client=A&client=B
    const many = (k) => [...new Set(url.searchParams.getAll(k).map((v) => v.trim()).filter(Boolean))].slice(0, 100);
    return { from, to, clients: many('client'), categories: many('category') };
  }

  function build(f) {
    const allCosts = expenses.rowsBetween(f.from, f.to);
    const money = clients.ledger(`${f.from}-01`, lastDay(f.to));
    const clientNames = clients.names();

    const isCompany = (name) => !clientNames.some((n) => key(n) === key(name));
    const matchClient = (name) => !f.clients.length || f.clients.some((c) => (c === '__company' ? isCompany(name) : key(c) === key(name)));
    const cats = new Set(f.categories);
    const costs = allCosts.filter((r) => matchClient(r.client || 'Unassigned') && (!cats.size || cats.has(r.category)));
    // a cost-category filter is about costs only: money in is left out so profit is not misleading
    const payments = cats.size ? [] : money.payments.filter((p) => matchClient(p.client));
    const billed = cats.size ? [] : money.billed.filter((b) => matchClient(b.client));
    const open = cats.size ? [] : money.open.filter((o) => matchClient(o.client));

    const months = [];
    for (let i = monthIndex(f.from); i <= monthIndex(f.to); i++) {
      const m = monthFromIndex(i);
      const received = r2(payments.filter((p) => p.date.slice(0, 7) === m).reduce((n, p) => n + p.amount, 0));
      const bill = r2(billed.filter((b) => b.date.slice(0, 7) === m).reduce((n, b) => n + b.amount, 0));
      const cost = r2(costs.filter((c) => c.month === m).reduce((n, c) => n + (c.eur || 0), 0));
      const estimate = costs.some((c) => c.month === m && (c.estimate || c.upcoming));
      months.push({ month: m, received, billed: bill, costs: cost, profit: r2(received - cost), estimate });
    }

    // per client: every client with something in the period, plus our own costs
    const per = new Map();
    const row = (name) => {
      const k = clientNames.find((n) => key(n) === key(name)) ? key(name) : '__company';
      if (!per.has(k)) per.set(k, { key: k, name: k === '__company' ? 'ErgonSite itself & unassigned' : clientNames.find((n) => key(n) === k), received: 0, billed: 0, costs: 0, open: 0 });
      return per.get(k);
    };
    for (const p of payments) row(p.client).received += p.amount;
    for (const b of billed) row(b.client).billed += b.amount;
    for (const o of open) row(o.client).open += o.open;
    for (const c of costs) row(c.client || 'Unassigned').costs += c.eur || 0;
    const byClient = [...per.values()].map((x) => ({ ...x, received: r2(x.received), billed: r2(x.billed), costs: r2(x.costs), open: r2(x.open), profit: r2(x.received - x.costs) }))
      .sort((a, b) => (a.key === '__company') - (b.key === '__company') || b.received - a.received || b.costs - a.costs);

    const cat = new Map();
    for (const c of costs) cat.set(c.category, r2((cat.get(c.category) || 0) + (c.eur || 0)));
    const byCategory = [...cat.entries()].map(([category, eur]) => ({ category, eur })).sort((a, b) => b.eur - a.eur);

    const totals = {
      received: r2(months.reduce((n, m) => n + m.received, 0)),
      billed: r2(months.reduce((n, m) => n + m.billed, 0)),
      costs: r2(months.reduce((n, m) => n + m.costs, 0)),
      open: r2(open.reduce((n, o) => n + o.open, 0)),
      missingRate: costs.some((c) => c.eur === null)
    };
    totals.profit = r2(totals.received - totals.costs);

    const options = {
      clients: clientNames.slice().sort((a, b) => a.localeCompare(b)),
      categories: [...new Set(allCosts.map((c) => c.category))].sort((a, b) => a.localeCompare(b))
    };
    return { filters: f, months, byClient, byCategory, totals, options,
      costs: costs.sort((a, b) => a.date.localeCompare(b.date)),
      payments: payments.sort((a, b) => a.date.localeCompare(b.date)) };
  }

  function csv(r) {
    const out = [['date', 'type', 'client', 'category', 'description', 'paid to / method', 'currency', 'amount', 'eur', 'note'].join(',')];
    const lines = [
      ...r.payments.map((p) => [p.date, 'income', p.client, p.type, p.description, p.method, p.currency, p.amount.toFixed(2), p.amount.toFixed(2), p.note]),
      ...r.costs.map((c) => [c.date, 'cost', c.client || 'Unassigned', c.category, c.name, c.vendor, c.currency, c.amount.toFixed(2), c.eur === null ? '' : c.eur.toFixed(2), c.estimate ? 'estimate' : c.upcoming ? 'upcoming' : ''])
    ].sort((a, b) => a[0].localeCompare(b[0]));
    for (const l of lines) out.push(l.map(csvCell).join(','));
    out.push('');
    out.push(['', 'total income', '', '', '', '', 'EUR', '', r.totals.received.toFixed(2), ''].join(','));
    out.push(['', 'total costs', '', '', '', '', 'EUR', '', r.totals.costs.toFixed(2), ''].join(','));
    out.push(['', 'profit', '', '', '', '', 'EUR', '', r.totals.profit.toFixed(2), ''].join(','));
    return out.join('\r\n') + '\r\n';
  }

  /* the dashboard: what needs doing, and how the month and the year look */
  // the money cards follow the period picked on the dashboard (this month by default);
  // the lists below them are always about now
  function dashboard(url) {
    const d = new Date();
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const f = url.searchParams.get('from') ? filters(url) : { from: month, to: month };
    const len = monthIndex(f.to) - monthIndex(f.from) + 1;
    const cur = build({ from: f.from, to: f.to, clients: [], categories: [] });
    // compared with: the same months a year before for a year or year-to-date, otherwise the period just before
    const yearly = len > 1 && f.from.endsWith('-01') && f.from.slice(0, 4) === f.to.slice(0, 4);
    const back = yearly ? 12 : len;
    const prevFrom = monthFromIndex(monthIndex(f.from) - back), prevTo = monthFromIndex(monthIndex(f.to) - back);
    const prev = build({ from: prevFrom, to: prevTo, clients: [], categories: [] });
    const a = clients.attention();
    const pick = (r) => ({ received: r.totals.received, billed: r.totals.billed, costs: r.totals.costs, profit: r.totals.profit });
    return {
      month, year: d.getFullYear(), from: f.from, to: f.to,
      stats: {
        toCollect: a.toCollect, overdue: a.overdue,
        ...pick(cur), estimate: cur.months.some((x) => x.estimate),
        prev: { from: prevFrom, to: prevTo, ...pick(prev) }
      },
      unpaid: a.unpaid, renewals: a.renewals, remindDays: a.remindDays,
      checks: [
        ...expenses.pendingServices().map((s) => ({ kind: 'render', href: '#expenses/hosting', client: 'Render: ' + s.service,
          text: s.guess ? 'new hosting service, looks like ' + s.guess + ': confirm it' : 'new hosting service: which client is it?' })),
        ...a.checks
      ],
      ours: expenses.comingUp(),
      inbox: inbox ? inbox() : { chatsUnread: 0, inquiriesNew: 0 }
    };
  }

  async function handle(req, res, p, user, url) {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only owners can see this.' });
    if (req.method !== 'GET') return send(res, 405, { message: 'Not allowed' });
    if (p === '/dashboard') return send(res, 200, dashboard(url));
    const f = filters(url);
    if (p === '/reports') return send(res, 200, build(f));
    if (p === '/reports/export.csv') {
      const who = f.clients.length === 1 ? '-' + f.clients[0].replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() : f.clients.length ? `-${f.clients.length}-clients` : '';
      const name = `ergonsite-report-${f.from}-to-${f.to}${who}.csv`;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      return res.end('﻿' + csv(build(f)));
    }
    return send(res, 404, { message: 'Not found' });
  }

  return { handle };
}
