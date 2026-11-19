/* =====================================================================
   Reports, for the console (owners only): money in against costs over
   any period, filtered by client and by cost category.

   Money in comes from the Clients section (payments received, and what
   was billed). Costs come from the Expenses section (recurring, one-off
   and Render hosting, converted to euro). Clients are matched by name.

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

export function setupReports({ send, expenses, clients }) {
  function filters(url) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    let from = url.searchParams.get('from') || `${now.getFullYear()}-01`;
    let to = url.searchParams.get('to') || thisMonth;
    if (!MONTH_RE.test(from)) from = `${now.getFullYear()}-01`;
    if (!MONTH_RE.test(to)) to = thisMonth;
    if (from > to) [from, to] = [to, from];
    if (monthIndex(to) - monthIndex(from) > 59) from = monthFromIndex(monthIndex(to) - 59);      // five years at most
    return { from, to, client: (url.searchParams.get('client') || '').trim(), category: (url.searchParams.get('category') || '').trim() };
  }

  function build(f) {
    const allCosts = expenses.rowsBetween(f.from, f.to);
    const money = clients.ledger(`${f.from}-01`, lastDay(f.to));
    const clientNames = clients.names();

    const matchClient = (name) => {
      if (!f.client) return true;
      if (f.client === '__company') return !clientNames.some((n) => key(n) === key(name));
      return key(name) === key(f.client);
    };
    const costs = allCosts.filter((r) => matchClient(r.client || 'Unassigned') && (!f.category || r.category === f.category));
    // a cost-category filter is about costs only: money in is left out so profit is not misleading
    const payments = f.category ? [] : money.payments.filter((p) => matchClient(p.client));
    const billed = f.category ? [] : money.billed.filter((b) => matchClient(b.client));
    const open = f.category ? [] : money.open.filter((o) => matchClient(o.client));

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

  async function handle(req, res, p, user, url) {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only owners can see reports.' });
    if (req.method !== 'GET') return send(res, 405, { message: 'Not allowed' });
    const f = filters(url);
    if (p === '/reports') return send(res, 200, build(f));
    if (p === '/reports/export.csv') {
      const name = `ergonsite-report-${f.from}-to-${f.to}${f.client ? '-' + f.client.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() : ''}.csv`;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
      return res.end('﻿' + csv(build(f)));
    }
    return send(res, 404, { message: 'Not found' });
  }

  return { handle };
}
