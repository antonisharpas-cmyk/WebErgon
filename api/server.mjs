/* =====================================================================
   ErgonSite API: live chat, enquiries and the team console.

   The website itself stays on GitHub Pages. This small server runs on
   Render and does the three things a static site cannot:

     1. Live chat. The chat bubble on ergonsite.com talks to /api/chat/*.
        Every visitor message is emailed to NOTIFY_EMAIL (a burst of
        messages becomes one email). If the visitor has left by the time
        the team replies, the reply is emailed to them too.
     2. Enquiries. The contact form posts here. Each enquiry is filed in
        the console, emailed to the team and confirmed to the enquirer,
        all from info@ergonsite.com.
     3. The console, at /admin. Team logins, the chat inbox, the
        enquiries inbox, replies, and team management.

   Environment (set these in the Render dashboard, never in the repo):
     DATA_DIR         where the data file lives (the Render disk)
     ADMIN_EMAIL      first owner account, created on first start
     ADMIN_PASSWORD   its password (change it in the console afterwards)
     ADMIN_NAME       its display name, e.g. "Michail"
     NOTIFY_EMAIL     who gets the "new chat message" emails
     SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM
     ALLOWED_ORIGINS  comma-separated, default https://ergonsite.com,https://www.ergonsite.com
     PUBLIC_URL       where this server is reachable, for links in emails
   ===================================================================== */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { makeMailer, layout, esc, textToHtml } from './mail.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT || 4000);
const DATA_DIR = env.DATA_DIR || path.join(HERE, 'data');
const PUBLIC_URL = (env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const NOTIFY_EMAIL = env.NOTIFY_EMAIL || 'info@ergonsite.com';
const ALLOWED_ORIGINS = new Set(
  (env.ALLOWED_ORIGINS || 'https://ergonsite.com,https://www.ergonsite.com')
    .split(',').map((s) => s.trim()).filter(Boolean)
);
try { ALLOWED_ORIGINS.add(new URL(PUBLIC_URL).origin); } catch (e) { /* bad PUBLIC_URL: ignore */ }
if (env.RENDER_EXTERNAL_URL) ALLOWED_ORIGINS.add(env.RENDER_EXTERNAL_URL.replace(/\/$/, ''));
const IS_DEV = !env.RENDER && !env.NODE_ENV?.startsWith('prod');
if (IS_DEV) ['http://localhost:8765', 'http://localhost:3000', 'http://127.0.0.1:8765'].forEach((o) => ALLOWED_ORIGINS.add(o));

if (env.RENDER && !env.DATA_DIR) {
  console.warn('DATA_DIR is not set: chats and enquiries are kept on a temporary disk and are LOST on every deploy. Add a Render disk at /var/data and set DATA_DIR=/var/data.');
}
const store = openStore(DATA_DIR);
const db = store.data;
const mailer = makeMailer(env);

/* ---------- small helpers ---------- */
const now = () => Date.now();
const id = (n = 12) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const clean = (s, max) => String(s ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[A-Za-z]{2,}$/;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, saltHex, keyHex] = String(stored).split('$');
  if (!saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}

/* Fixed-window rate limiter, per key. */
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = now();
  const b = buckets.get(key);
  if (!b || t - b.start > windowMs) { buckets.set(key, { start: t, n: 1 }); return false; }
  b.n += 1;
  return b.n > max;
}
setInterval(() => {
  const t = now();
  for (const [k, b] of buckets) if (t - b.start > 3600_000) buckets.delete(k);
}, 600_000).unref();

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}

function send(res, status, body, headers = {}) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

async function readJson(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function setBaseHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Chat-Token');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
  return false;
}

/* ---------- first owner account ---------- */
if (!db.users.length && env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
  db.users.push({
    id: id(8),
    email: env.ADMIN_EMAIL.toLowerCase().trim(),
    name: env.ADMIN_NAME || 'Owner',
    role: 'owner',
    hash: hashPassword(env.ADMIN_PASSWORD),
    createdAt: now()
  });
  store.flush();
  console.log('Created the first owner account for', env.ADMIN_EMAIL);
}
if (!db.users.length) {
  console.warn('No console accounts yet: set ADMIN_EMAIL and ADMIN_PASSWORD and restart.');
}

/* ---------- presence: is anyone from the team looking right now? ---------- */
const staffSeen = new Map();          // userId -> timestamp
function teamOnline() {
  const t = now();
  for (const ts of staffSeen.values()) if (t - ts < 120_000) return true;
  return false;
}

/* ---------- chat wording and timings ---------- */
const TEAM_NAME = 'ErgonSite Team';          // the name visitors see on every reply
const SITE_URL = (env.SITE_URL || 'https://ergonsite.com').replace(/\/$/, '');
const IDLE_CLOSE_MS = Number(env.CHAT_IDLE_MINUTES || 10) * 60_000;
const PHONE_RE = /^[+0-9()\s.-]{6,25}$/;

function autoReplyText(online, name) {
  const first = String(name).split(/\s+/)[0];
  return online
    ? `Hi ${first}, thanks for your message! Someone from our team will reply here in a moment.`
    : `Hi ${first}, thanks for your message! Our team will reply here as soon as possible. If you close this page, the reply will come to your email.`;
}
const CLOSING_TEXT = 'We haven’t heard back for a while, so we’re closing this chat for now. Send a message here any time to reopen it, or use the link we’ve emailed you.';

/* A one-time link that brings a chat back in any browser. Only its hash
   is stored; the link lives in the visitor's own inbox. */
function resumeLink(conv) {
  const key = id(24);
  conv.resume = { hash: sha(key), expires: now() + 30 * 24 * 3600_000 };
  store.save();
  return `${SITE_URL}/#chat=${conv.id}.${key}`;
}

function transcriptHtml(conv, limit = 12) {
  return conv.messages.slice(-limit).map((m) => {
    const mine = m.from === 'visitor';
    return `<div style="margin:0 0 8px;${mine ? 'text-align:right' : ''}"><span style="display:inline-block;max-width:85%;text-align:left;padding:9px 13px;border-radius:14px;background:${mine ? '#1b3a9e' : '#f5f5f7'};color:${mine ? '#fff' : '#1d1d1f'}">${mine ? '' : `<b style="display:block;font-size:12px;color:#1b3a9e">${TEAM_NAME}</b>`}${textToHtml(m.text)}</span></div>`;
  }).join('');
}

function emailVisitor(conv, { subject, title, intro, button }) {
  if (!conv.visitor.email) return;
  const link = resumeLink(conv);
  mailer.send({
    to: conv.visitor.email,
    replyTo: NOTIFY_EMAIL,
    subject,
    text: `Hi ${conv.visitor.name},\n\n${intro}\n\n${conv.messages.slice(-6).map((m) => (m.from === 'visitor' ? 'You' : TEAM_NAME) + ': ' + m.text).join('\n\n')}\n\n${button}: ${link}\n\nOr simply reply to this email.\n\nErgonSite Team\ninfo@ergonsite.com\n${SITE_URL}`,
    html: layout(title,
      `<p style="margin:0 0 14px">Hi ${esc(conv.visitor.name)},</p><p style="margin:0 0 16px">${esc(intro)}</p>${transcriptHtml(conv)}
       <p style="margin:22px 0 0"><a href="${link}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">${esc(button)}</a></p>
       <p style="margin:14px 0 0;color:#6e6e73;font-size:13px">Or simply reply to this email.</p>`,
      'ErgonSite Team &middot; info@ergonsite.com &middot; ergonsite.com')
  }).catch((err) => console.error('Visitor email failed:', err.message));
}

/* ---------- emails to the team ----------
   The first message of a new (or reopened) chat goes out at once.
   Follow-ups within 30 seconds of each other are sent as one email. */
const pendingNotify = new Map();      // conversationId -> timer
function notifyTeam(conv, immediate) {
  const run = () => {
    pendingNotify.delete(conv.id);
    const since = conv.notifiedAt || 0;
    const fresh = conv.messages.filter((m) => m.from === 'visitor' && m.at > since);
    if (!fresh.length) return;
    const isNew = !since;
    const reopened = isNew && conv.reopenedAt && conv.reopenedAt > conv.createdAt;
    conv.notifiedAt = now();
    store.save();
    const v = conv.visitor;
    const consoleLink = `${PUBLIC_URL}/admin/#chat/${conv.id}`;
    const lines = fresh.map((m) => `<p style="margin:0 0 10px;padding:10px 14px;background:#f5f5f7;border-radius:12px">${textToHtml(m.text)}</p>`).join('');
    mailer.send({
      to: NOTIFY_EMAIL,
      replyTo: v.email || undefined,
      subject: reopened ? `Live chat reopened by ${v.name}` : isNew ? `New live chat from ${v.name}` : `Live chat: ${v.name} sent ${fresh.length > 1 ? fresh.length + ' messages' : 'a message'}`,
      text: `${v.name} <${v.email}>${v.phone ? ' ' + v.phone : ''} on the website chat:\n\n${fresh.map((m) => m.text).join('\n\n')}\n\nLog in to the console and reply: ${consoleLink}`,
      html: layout(isNew ? `New live chat from ${v.name}` : `${v.name} sent a message`,
        `<p style="margin:0 0 14px;color:#6e6e73">${esc(v.email)}${v.phone ? ` &middot; ${esc(v.phone)}` : ''}${conv.page ? ` &middot; on ${esc(conv.page)}` : ''}</p>${lines}
         <p style="margin:22px 0 0"><a href="${consoleLink}" style="display:inline-block;background:#1b3a9e;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:600">Log in to the console and reply</a></p>`,
        'Your reply appears in their chat window straight away, and is emailed to them if they have left the website.')
    }).catch((err) => console.error('Chat notification failed:', err.message));
  };
  if (pendingNotify.has(conv.id)) {
    if (!immediate) return;
    clearTimeout(pendingNotify.get(conv.id));
  }
  if (immediate) run();
  else pendingNotify.set(conv.id, setTimeout(run, 30_000));
}

/* ---------- close chats that have gone quiet ----------
   After the team has replied, if the visitor says nothing for
   IDLE_CLOSE_MS the chat is closed with a short message, and the visitor
   gets an email with a link to reopen it. The automatic first reply does
   not count: a chat the team has not answered yet is never closed. */
setInterval(() => {
  const t = now();
  for (const conv of db.conversations) {
    if (conv.status !== 'open') continue;
    const real = conv.messages.filter((m) => m.from === 'visitor' || m.from === 'staff');
    const last = real[real.length - 1];
    if (!last || last.from !== 'staff' || t - last.at < IDLE_CLOSE_MS) continue;
    conv.messages.push({ id: id(8), from: 'system', text: CLOSING_TEXT, at: t });
    conv.status = 'closed';
    conv.closedAt = t;
    conv.updatedAt = t;
    store.save();
    emailVisitor(conv, {
      subject: 'Your chat with ErgonSite',
      title: 'We’ve closed your chat for now',
      intro: 'We haven’t heard back for a while, so we closed the chat. Here is the conversation. You can pick it up again at any time.',
      button: 'Reopen the chat'
    });
  }
}, Math.max(2000, Math.min(60_000, IDLE_CLOSE_MS / 2))).unref();


/* ---------- enquiry emails ----------
   Both go out from info@ergonsite.com (SMTP):
   a confirmation to the person who wrote, and an alert to the team. */
function inquiryEmails(q) {
  const first = q.name.split(/\s+/)[0];
  const lines = [
    ['Email', q.email], ['Phone', q.phone], ['Company', q.company], ['Needs', q.needs]
  ].filter(([, v]) => v);

  mailer.send({
    to: q.email,
    replyTo: NOTIFY_EMAIL,
    subject: 'We received your enquiry | ErgonSite',
    text: `Dear ${q.name},\n\nThank you for getting in touch with ErgonSite. This is a confirmation that we have received your enquiry, and a copy of your message is included below for your records.\n\nWe will come back to you as soon as possible, within 24 hours.\n\nYour message:\n${q.message}\n\nBest regards,\n\nErgonSite Team\ninfo@ergonsite.com\n+357 96 400 240\n${SITE_URL}`,
    html: layout(`Thank you, ${first}`,
      `<p style="margin:0 0 14px">Dear ${esc(q.name)},</p>
       <p style="margin:0 0 14px">Thank you for getting in touch with ErgonSite. This is a confirmation that we have received your enquiry. A copy of your message is below for your records.</p>
       <p style="margin:0 0 18px">We will come back to you as soon as possible, within 24 hours.</p>
       <div style="background:#f5f5f7;border-radius:14px;padding:16px 18px;color:#1d1d1f">${textToHtml(q.message)}</div>
       <p style="margin:22px 0 0">Best regards,<br><b>ErgonSite Team</b></p>`,
      `ErgonSite &middot; <a href="mailto:info@ergonsite.com" style="color:#6e6e73">info@ergonsite.com</a> &middot; +357 96 400 240 &middot; <a href="${SITE_URL}" style="color:#6e6e73">ergonsite.com</a>`)
  }).catch((err) => console.error('Enquiry confirmation failed:', err.message));

  const consoleLink = `${PUBLIC_URL}/admin/#inquiry/${q.id}`;
  mailer.send({
    to: NOTIFY_EMAIL,
    replyTo: q.email,
    subject: `Enquiry from ${q.name}${q.company ? ' (' + q.company + ')' : ''}`,
    text: `${q.name} sent an enquiry on ergonsite.com.\n\n${lines.map(([k, v]) => k + ': ' + v).join('\n')}\n\n${q.message}\n\nAnswer in the console: ${consoleLink}\n(or simply reply to this email)`,
    html: layout(`New enquiry from ${q.name}`,
      `<table role="presentation" style="font-size:14px;margin:0 0 14px">${lines.map(([k, v]) => `<tr><td style="color:#6e6e73;padding:2px 14px 2px 0">${k}</td><td>${esc(v)}</td></tr>`).join('')}</table>
       <div style="background:#f5f5f7;border-radius:14px;padding:16px 18px;color:#1d1d1f">${textToHtml(q.message)}</div>
       <p style="margin:22px 0 0"><a href="${consoleLink}" style="display:inline-block;background:#1b3a9e;color:#fff;text-decoration:none;padding:13px 22px;border-radius:999px;font-weight:600">Log in to the console and reply</a></p>`,
      'You can also simply reply to this email: it goes straight to the person who wrote.')
  }).catch((err) => console.error('Enquiry alert failed:', err.message));
}

/* ---------- views sent to the browser ---------- */
const publicMsg = (m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, name: m.from === 'visitor' ? undefined : TEAM_NAME });

function convSummary(c) {
  const last = c.messages[c.messages.length - 1];
  return {
    id: c.id, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt,
    visitor: c.visitor, page: c.page,
    unread: c.messages.filter((m) => m.from === 'visitor' && m.at > (c.staffReadAt || 0)).length,
    last: last ? { from: last.from, text: last.text.slice(0, 140), at: last.at } : null,
    visitorOnline: now() - (c.visitorSeenAt || 0) < 60_000
  };
}
function inquirySummary(q) {
  return {
    id: q.id, status: q.status, createdAt: q.createdAt, updatedAt: q.updatedAt,
    name: q.name, email: q.email, company: q.company, phone: q.phone, needs: q.needs,
    preview: q.message.slice(0, 140), replies: q.replies.length, read: Boolean(q.readAt)
  };
}

/* ---------- public API (the website) ---------- */
async function publicApi(req, res, url) {
  const ip = clientIp(req);
  const p = url.pathname;

  if (p === '/api/status' && req.method === 'GET') {
    return send(res, 200, { online: teamOnline() });
  }

  if (p === '/api/chat/start' && req.method === 'POST') {
    if (limited('start:' + ip, 6, 3600_000)) return send(res, 429, { message: 'Too many new chats from this connection. Please email info@ergonsite.com.' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true });            // honeypot: a bot filled the hidden field
    const name = clean(b.name, 80);
    const email = clean(b.email, 160).toLowerCase();
    const phone = clean(b.phone, 30);
    const text = clean(b.message, 2000);
    if (!name) return send(res, 400, { message: 'Please tell us your name.' });
    if (!EMAIL_RE.test(email)) return send(res, 400, { message: 'Please check your email address, so we can reply if you leave.' });
    if (phone && !PHONE_RE.test(phone)) return send(res, 400, { message: 'Please check the phone number, or leave it empty.' });
    if (!text) return send(res, 400, { message: 'Please type a message.' });
    const token = id(24);
    const t = now();
    const online = teamOnline();
    const conv = {
      id: id(9), tokenHash: sha(token), status: 'open', createdAt: t, updatedAt: t,
      visitor: { name, email, phone }, page: clean(b.page, 200), ipHash: sha(ip).slice(0, 16),
      visitorSeenAt: t, staffReadAt: 0, notifiedAt: 0,
      messages: [
        { id: id(8), from: 'visitor', text, at: t },
        { id: id(8), from: 'auto', text: autoReplyText(online, name), at: t + 1 }
      ]
    };
    db.conversations.push(conv);
    store.save();
    notifyTeam(conv, true);
    return send(res, 201, { id: conv.id, token, status: conv.status, messages: conv.messages.map(publicMsg), online });
  }

  /* The link from an email: swap the one-time key for a fresh chat token. */
  if (p === '/api/chat/resume' && req.method === 'POST') {
    if (limited('resume:' + ip, 20, 3600_000)) return send(res, 429, { message: 'Too many attempts. Please try again later.' });
    const b = await readJson(req, 1024);
    const conv = db.conversations.find((c) => c.id === clean(b.id, 20));
    const key = String(b.key || '');
    if (!conv || !conv.resume || conv.resume.expires < now() || sha(key) !== conv.resume.hash) {
      return send(res, 404, { message: 'This link has expired. Start a new chat, or ask for a new link with your email.' });
    }
    const token = id(24);
    conv.tokenHash = sha(token);
    conv.resume = null;
    conv.visitorSeenAt = now();
    store.save();
    return send(res, 200, { id: conv.id, token, name: conv.visitor.name, status: conv.status, messages: conv.messages.map(publicMsg), online: teamOnline() });
  }

  /* "Continue a previous chat": email a link to the latest chat for that
     address. The answer is the same whether or not one exists, so this
     cannot be used to find out who has chatted with us. */
  if (p === '/api/chat/recover' && req.method === 'POST') {
    const b = await readJson(req, 1024);
    const email = clean(b.email, 160).toLowerCase();
    if (!EMAIL_RE.test(email)) return send(res, 400, { message: 'Please check your email address.' });
    if (limited('recover:' + ip, 5, 3600_000) || limited('recover:' + email, 3, 3600_000)) {
      return send(res, 429, { message: 'Please check your inbox for the link we already sent.' });
    }
    const conv = [...db.conversations].filter((c) => c.visitor.email === email).sort((a, z) => z.updatedAt - a.updatedAt)[0];
    if (conv) {
      emailVisitor(conv, {
        subject: 'Continue your chat with ErgonSite',
        title: 'Continue your chat',
        intro: 'Here is your conversation with us. Use the button to carry on where you left off.',
        button: 'Continue the chat'
      });
    }
    return send(res, 200, { ok: true });
  }

  const m = p.match(/^\/api\/chat\/([A-Za-z0-9_-]{6,20})(\/messages)?$/);
  if (m) {
    const conv = db.conversations.find((c) => c.id === m[1]);
    const token = String(req.headers['x-chat-token'] || '');
    if (!conv || !token || sha(token) !== conv.tokenHash) return send(res, 404, { message: 'This chat has ended.' });

    if (!m[2] && req.method === 'GET') {
      conv.visitorSeenAt = now();
      const after = Number(url.searchParams.get('after') || 0);
      return send(res, 200, {
        status: conv.status,
        messages: conv.messages.filter((x) => x.at > after).map(publicMsg),
        online: teamOnline()
      });
    }

    if (m[2] && req.method === 'POST') {
      if (limited('msg:' + ip, 40, 600_000)) return send(res, 429, { message: 'You are sending messages very quickly. Please wait a moment.' });
      const b = await readJson(req);
      const text = clean(b.text, 2000);
      if (!text) return send(res, 400, { message: 'Please type a message.' });
      const t = now();
      const reopened = conv.status === 'closed';
      const msg = { id: id(8), from: 'visitor', text, at: t };
      conv.messages.push(msg);
      if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
      conv.updatedAt = t;
      conv.visitorSeenAt = t;
      if (reopened) { conv.status = 'open'; conv.notifiedAt = 0; conv.reopenedAt = t; }
      store.save();
      notifyTeam(conv, reopened);
      return send(res, 201, { message: publicMsg(msg), status: conv.status });
    }
  }

  if (p === '/api/inquiries' && req.method === 'POST') {
    if (limited('inq:' + ip, 8, 3600_000)) return send(res, 429, { message: 'Too many enquiries from this connection.' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true, success: true });
    const q = {
      id: id(9), status: 'new', createdAt: now(), updatedAt: now(), readAt: 0,
      name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), company: clean(b.company, 160),
      phone: clean(b.phone, 40), needs: clean(b.needs, 400), message: clean(b.message, 5000),
      page: clean(b.page, 200), replies: [], notes: ''
    };
    if (!q.name || !EMAIL_RE.test(q.email) || !q.message) return send(res, 400, { message: 'Missing name, email or message.' });
    db.inquiries.push(q);
    store.save();
    inquiryEmails(q);
    return send(res, 201, { ok: true, success: true });
  }

  return send(res, 404, { message: 'Not found' });
}

/* ---------- console (same origin, cookie session) ---------- */
const COOKIE = 'es_session';
const SESSION_MS = 14 * 24 * 3600_000;

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function currentUser(req) {
  const tok = readCookie(req, COOKIE);
  if (!tok) return null;
  const s = db.sessions.find((x) => x.hash === sha(tok));
  if (!s || s.expires < now()) return null;
  const u = db.users.find((x) => x.id === s.userId);
  if (u) staffSeen.set(u.id, now());
  return u || null;
}

function sessionCookie(token, maxAgeSec) {
  const secure = IS_DEV ? '' : '; Secure';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

const me = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function consoleApi(req, res, url) {
  const p = url.pathname.slice('/admin/api'.length) || '/';
  const ip = clientIp(req);

  /* Every write must come from the console page itself: same origin, and
     a custom header that a cross-site form cannot add. */
  if (req.method !== 'GET') {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (req.headers['x-console'] !== '1' || (origin && new URL(origin).host !== host)) {
      return send(res, 403, { message: 'Forbidden' });
    }
  }

  if (p === '/login' && req.method === 'POST') {
    const b = await readJson(req, 4096);
    const email = clean(b.email, 160).toLowerCase();
    if (limited('login:' + ip, 8, 900_000) || limited('login:' + email, 8, 900_000)) {
      return send(res, 429, { message: 'Too many attempts. Wait 15 minutes and try again.' });
    }
    const u = db.users.find((x) => x.email === email);
    const ok = u ? checkPassword(String(b.password || ''), u.hash) : (hashPassword('x'), false);
    if (!ok) return send(res, 401, { message: 'Wrong email or password.' });
    const token = id(32);
    db.sessions = db.sessions.filter((s) => s.expires > now());
    db.sessions.push({ hash: sha(token), userId: u.id, expires: now() + SESSION_MS, createdAt: now() });
    u.lastLoginAt = now();
    store.save();
    return send(res, 200, { user: me(u) }, { 'Set-Cookie': sessionCookie(token, SESSION_MS / 1000) });
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, { message: 'Please sign in.' });

  if (p === '/logout' && req.method === 'POST') {
    const tok = readCookie(req, COOKIE);
    db.sessions = db.sessions.filter((s) => s.hash !== sha(tok));
    store.save();
    staffSeen.delete(user.id);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }

  if (p === '/me' && req.method === 'GET') return send(res, 200, { user: me(user), mail: mailer.enabled });

  if (p === '/overview' && req.method === 'GET') {
    const convs = [...db.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(convSummary);
    const inqs = [...db.inquiries].sort((a, b) => b.createdAt - a.createdAt).map(inquirySummary);
    return send(res, 200, {
      conversations: convs,
      inquiries: inqs,
      counts: {
        chatsUnread: convs.reduce((n, c) => n + (c.unread ? 1 : 0), 0),
        inquiriesNew: inqs.filter((q) => q.status === 'new').length
      }
    });
  }

  /* --- chats --- */
  let m = p.match(/^\/conversations\/([A-Za-z0-9_-]+)(\/reply|\/status)?$/);
  if (m) {
    const conv = db.conversations.find((c) => c.id === m[1]);
    if (!conv) return send(res, 404, { message: 'Chat not found.' });

    if (!m[2] && req.method === 'GET') {
      conv.staffReadAt = now();
      store.save();
      return send(res, 200, { conversation: { ...convSummary(conv), messages: conv.messages } });
    }
    if (!m[2] && req.method === 'DELETE') {
      db.conversations = db.conversations.filter((c) => c !== conv);
      store.data.conversations = db.conversations;
      store.save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/status' && req.method === 'POST') {
      const b = await readJson(req, 1024);
      conv.status = b.status === 'closed' ? 'closed' : 'open';
      conv.updatedAt = now();
      store.save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/reply' && req.method === 'POST') {
      const b = await readJson(req);
      const text = clean(b.text, 4000);
      if (!text) return send(res, 400, { message: 'Type a reply first.' });
      const t = now();
      const msg = { id: id(8), from: 'staff', staffId: user.id, staffName: user.name, text, at: t };
      conv.messages.push(msg);
      conv.updatedAt = t;
      conv.staffReadAt = t;
      conv.status = 'open';
      store.save();
      /* The visitor has closed the page: send the reply to their inbox,
         with a link that brings the chat back. */
      let emailed = false;
      if (t - (conv.visitorSeenAt || 0) > 90_000 && conv.visitor.email) {
        emailed = true;
        emailVisitor(conv, {
          subject: 'ErgonSite Team replied to your chat',
          title: 'We replied to your chat',
          intro: 'You had left the website when we answered, so here is our reply.',
          button: 'Continue the chat'
        });
      }
      return send(res, 201, { message: msg, emailed });
    }
  }

  /* --- enquiries --- */
  m = p.match(/^\/inquiries\/([A-Za-z0-9_-]+)(\/reply|\/status|\/notes)?$/);
  if (m) {
    const q = db.inquiries.find((x) => x.id === m[1]);
    if (!q) return send(res, 404, { message: 'Enquiry not found.' });

    if (!m[2] && req.method === 'GET') {
      if (!q.readAt) { q.readAt = now(); store.save(); }
      return send(res, 200, { inquiry: q });
    }
    if (!m[2] && req.method === 'DELETE') {
      db.inquiries = db.inquiries.filter((x) => x !== q);
      store.data.inquiries = db.inquiries;
      store.save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/status' && req.method === 'POST') {
      const b = await readJson(req, 1024);
      q.status = ['new', 'in progress', 'done'].includes(b.status) ? b.status : q.status;
      q.updatedAt = now();
      store.save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/notes' && req.method === 'POST') {
      const b = await readJson(req);
      q.notes = clean(b.notes, 5000);
      q.updatedAt = now();
      store.save();
      return send(res, 200, { ok: true });
    }
    if (m[2] === '/reply' && req.method === 'POST') {
      const b = await readJson(req);
      const text = clean(b.text, 8000);
      const subject = clean(b.subject, 200) || 'Re: your enquiry to ErgonSite';
      if (!text) return send(res, 400, { message: 'Type a reply first.' });
      try {
        await mailer.send({
          to: q.email,
          replyTo: NOTIFY_EMAIL,
          subject,
          text: `${text}\n\n${user.name}\nErgonSite\ninfo@ergonsite.com\nhttps://ergonsite.com`,
          html: layout(subject, `${textToHtml(text)}<p style="margin:18px 0 0">${esc(user.name)}<br>ErgonSite</p>`,
            'ErgonSite &middot; info@ergonsite.com &middot; ergonsite.com')
        });
      } catch (err) {
        console.error('Enquiry reply failed:', err.message);
        return send(res, 502, { message: 'The email could not be sent. Check the SMTP settings on Render.' });
      }
      const reply = { id: id(8), staffId: user.id, staffName: user.name, subject, text, at: now(), sent: mailer.enabled };
      q.replies.push(reply);
      if (q.status === 'new') q.status = 'in progress';
      q.updatedAt = now();
      store.save();
      return send(res, 201, { reply });
    }
  }

  /* --- team --- */
  if (p === '/password' && req.method === 'POST') {
    const b = await readJson(req, 4096);
    if (!checkPassword(String(b.current || ''), user.hash)) return send(res, 400, { message: 'Your current password is not right.' });
    const next = String(b.next || '');
    if (next.length < 10) return send(res, 400, { message: 'Use at least 10 characters.' });
    user.hash = hashPassword(next);
    const keep = sha(readCookie(req, COOKIE));
    db.sessions = db.sessions.filter((s) => s.userId !== user.id || s.hash === keep);
    store.save();
    return send(res, 200, { ok: true });
  }

  if (p === '/users' && req.method === 'GET') {
    return send(res, 200, { users: db.users.map((u) => ({ ...me(u), lastLoginAt: u.lastLoginAt || 0 })) });
  }
  if (p === '/users' && req.method === 'POST') {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only an owner can add people.' });
    const b = await readJson(req, 4096);
    const email = clean(b.email, 160).toLowerCase();
    const name = clean(b.name, 60);
    const pw = String(b.password || '');
    if (!name || !EMAIL_RE.test(email)) return send(res, 400, { message: 'Name and a valid email, please.' });
    if (pw.length < 10) return send(res, 400, { message: 'The first password needs at least 10 characters.' });
    if (db.users.some((u) => u.email === email)) return send(res, 400, { message: 'That email already has an account.' });
    const nu = { id: id(8), email, name, role: b.role === 'owner' ? 'owner' : 'member', hash: hashPassword(pw), createdAt: now() };
    db.users.push(nu);
    store.save();
    return send(res, 201, { user: me(nu) });
  }
  m = p.match(/^\/users\/([A-Za-z0-9_-]+)$/);
  if (m && req.method === 'DELETE') {
    if (user.role !== 'owner') return send(res, 403, { message: 'Only an owner can remove people.' });
    if (m[1] === user.id) return send(res, 400, { message: 'You cannot remove yourself.' });
    db.users = db.users.filter((u) => u.id !== m[1]);
    store.data.users = db.users;
    db.sessions = db.sessions.filter((s) => s.userId !== m[1]);
    store.data.sessions = db.sessions;
    store.save();
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { message: 'Not found' });
}

/* ---------- the console page and its files ---------- */
const CONSOLE_DIR = path.join(HERE, 'console');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const CONSOLE_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

function serveConsole(req, res, url) {
  let rel = url.pathname.replace(/^\/admin\/?/, '');
  if (!rel) rel = 'index.html';
  const file = path.normalize(path.join(CONSOLE_DIR, rel));
  if (!file.startsWith(CONSOLE_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Content-Security-Policy': CONSOLE_CSP,
    'X-Frame-Options': 'DENY',
    'Cache-Control': rel === 'index.html' ? 'no-store' : 'no-cache',
    'X-Robots-Tag': 'noindex, nofollow'
  });
  fs.createReadStream(file).pipe(res);
}


/* ---------- the website itself ----------
   The same files GitHub Pages publishes at ergonsite.com, so this
   address shows the real site rather than an error. Only public file
   types are served, and everything GitHub Pages does not publish
   (_config.yml's exclude list: the server code, the old back office,
   notes, data) is refused here too. */
const SITE_DIR = path.resolve(HERE, '..');
const SITE_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf'
};
const SITE_DENY = /^\/(api|data|node_modules|admin|claude outputs)(\/|$)|^\/(server\.js|admin\.html|admin\.js|start\.bat|notes\.md|readme\.md|cursor-demos\.html|package(-lock)?\.json|render\.yaml|vercel\.json|_config\.yml)$|\/\./i;
const ON_RENDER_HOST = /\.onrender\.com$/i;

function serveSite(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { message: 'Bad request' }); }
  if (SITE_DENY.test(rel)) return siteNotFound(res);

  const candidates = rel.endsWith('/')
    ? [rel + 'index.html']
    : path.extname(rel) ? [rel] : [rel + '.html', rel + '/index.html'];

  for (const c of candidates) {
    const file = path.normalize(path.join(SITE_DIR, c));
    if (!file.startsWith(SITE_DIR + path.sep)) return siteNotFound(res);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const type = SITE_TYPES[path.extname(file).toLowerCase()];
    if (!type) return siteNotFound(res);

    /* Pages, scripts and styles are re-checked on every visit, so a deploy
       shows up straight away; images, video and fonts are kept for an hour. */
    const fresh = /^(text\/|application\/(json|manifest))/.test(type);
    const headers = {
      'Content-Type': type,
      'Cache-Control': fresh ? 'no-cache' : 'public, max-age=3600',
      'Accept-Ranges': 'bytes',
      'Last-Modified': st.mtime.toUTCString()
    };
    const since = Date.parse(String(req.headers['if-modified-since'] || ''));
    if (since && Math.floor(st.mtimeMs / 1000) * 1000 <= since && !req.headers.range) {
      res.writeHead(304, { 'Cache-Control': headers['Cache-Control'], 'Last-Modified': headers['Last-Modified'] });
      return res.end();
    }
    /* ergonsite.com is the real address: keep this copy out of Google. */
    if (ON_RENDER_HOST.test(String(req.headers.host || ''))) headers['X-Robots-Tag'] = 'noindex';

    /* Video needs byte ranges, or Safari will not play it. */
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
      if (start < 0) start = 0;
      if (start >= st.size || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      end = Math.min(end, st.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file, { start, end }).pipe(res);
    }

    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file).pipe(res);
  }
  return siteNotFound(res);
}

function siteNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end('<!doctype html><meta charset="utf-8"><title>Not found | ErgonSite</title><body style="font-family:system-ui,sans-serif;text-align:center;padding:80px 20px;color:#1d1d1f"><h1 style="letter-spacing:-.03em">Page not found</h1><p><a href="/" style="color:#1b3a9e">Back to the homepage</a></p>');
}

/* ---------- server ---------- */
const server = http.createServer(async (req, res) => {
  setBaseHeaders(res);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { message: 'Bad request' }); }
  const p = url.pathname;

  try {
    if (p === '/healthz') return send(res, 200, { ok: true });

    if (p.startsWith('/api/')) {
      const allowed = cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      /* Browsers always send Origin on these calls: refuse other websites. */
      if (req.headers.origin && !allowed) return send(res, 403, { message: 'Forbidden' });
      return await publicApi(req, res, url);
    }

    if (p.startsWith('/admin/api/')) return await consoleApi(req, res, url);

    if (p === '/admin' && !url.search) {
      res.writeHead(301, { Location: '/admin/' });
      return res.end();
    }
    if (p === '/admin/' || p.startsWith('/admin/')) return serveConsole(req, res, url);

    if (req.method === 'GET' || req.method === 'HEAD') return serveSite(req, res, p);

    return send(res, 404, { message: 'Not found' });
  } catch (err) {
    if (err.status) return send(res, err.status, { message: err.message });
    console.error(err);
    return send(res, 500, { message: 'Something went wrong on our side.' });
  }
});

server.listen(PORT, () => {
  console.log(`ErgonSite API on :${PORT}  (console: ${PUBLIC_URL}/admin/, data: ${store.file})`);
});

function shutdown() {
  try { store.flush(); } catch (err) { console.error(err); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
