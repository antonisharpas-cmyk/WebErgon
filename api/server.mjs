/* =====================================================================
   ErgonSite API: live chat, enquiries and the team console.

   The website itself stays on GitHub Pages. This small server runs on
   Render and does the three things a static site cannot:

     1. Live chat. The chat bubble on ergonsite.com talks to /api/chat/*.
        Every visitor message is emailed to NOTIFY_EMAIL (a burst of
        messages becomes one email). If the visitor has left by the time
        the team replies, the reply is emailed to them too.
     2. Enquiries. The contact form keeps sending through Web3Forms as
        before, and also files a copy here, so every enquiry is in one
        place and can be answered from the console.
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

/* ---------- chat notification emails (bursts become one email) ---------- */
const pendingNotify = new Map();      // conversationId -> timer
function scheduleChatNotify(conv) {
  if (pendingNotify.has(conv.id)) return;
  pendingNotify.set(conv.id, setTimeout(() => {
    pendingNotify.delete(conv.id);
    const since = conv.notifiedAt || 0;
    const fresh = conv.messages.filter((m) => m.from === 'visitor' && m.at > since);
    if (!fresh.length) return;
    conv.notifiedAt = now();
    store.save();
    const lines = fresh.map((m) => `<p style="margin:0 0 10px">${textToHtml(m.text)}</p>`).join('');
    mailer.send({
      to: NOTIFY_EMAIL,
      replyTo: conv.visitor.email || undefined,
      subject: `Chat: ${conv.visitor.name}${fresh.length > 1 ? ` (${fresh.length} messages)` : ''}`,
      text: `${conv.visitor.name} <${conv.visitor.email}> on the website chat:\n\n${fresh.map((m) => m.text).join('\n\n')}\n\nAnswer in the console: ${PUBLIC_URL}/admin#chat/${conv.id}`,
      html: layout(`New chat message from ${conv.visitor.name}`,
        `<p style="margin:0 0 14px;color:#6e6e73">${esc(conv.visitor.email)}${conv.page ? ` &middot; on ${esc(conv.page)}` : ''}</p>${lines}
         <p style="margin:22px 0 0"><a href="${PUBLIC_URL}/admin#chat/${conv.id}" style="display:inline-block;background:#1d1d1f;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600">Answer in the console</a></p>`,
        'Replies typed in the console appear in the visitor’s chat window, and are emailed to them if they have left.')
    }).catch((err) => console.error('Chat notification failed:', err.message));
  }, 45_000));
}

/* ---------- views sent to the browser ---------- */
const publicMsg = (m) => ({ id: m.id, from: m.from, text: m.text, at: m.at, name: m.from === 'staff' ? m.staffName : undefined });

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
    const text = clean(b.message, 2000);
    if (!name) return send(res, 400, { message: 'Please tell us your name.' });
    if (!EMAIL_RE.test(email)) return send(res, 400, { message: 'Please check your email address, so we can reply if you leave.' });
    if (!text) return send(res, 400, { message: 'Please type a message.' });
    const token = id(24);
    const t = now();
    const conv = {
      id: id(9), tokenHash: sha(token), status: 'open', createdAt: t, updatedAt: t,
      visitor: { name, email }, page: clean(b.page, 200), ipHash: sha(ip).slice(0, 16),
      visitorSeenAt: t, staffReadAt: 0, notifiedAt: 0,
      messages: [{ id: id(8), from: 'visitor', text, at: t }]
    };
    db.conversations.push(conv);
    store.save();
    scheduleChatNotify(conv);
    return send(res, 201, { id: conv.id, token, messages: conv.messages.map(publicMsg), online: teamOnline() });
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
      const msg = { id: id(8), from: 'visitor', text, at: t };
      conv.messages.push(msg);
      if (conv.messages.length > 500) conv.messages.splice(0, conv.messages.length - 500);
      conv.updatedAt = t;
      conv.visitorSeenAt = t;
      if (conv.status === 'closed') conv.status = 'open';
      store.save();
      scheduleChatNotify(conv);
      return send(res, 201, { message: publicMsg(msg) });
    }
  }

  if (p === '/api/inquiries' && req.method === 'POST') {
    if (limited('inq:' + ip, 8, 3600_000)) return send(res, 429, { message: 'Too many enquiries from this connection.' });
    const b = await readJson(req);
    if (b.website) return send(res, 200, { ok: true });
    const q = {
      id: id(9), status: 'new', createdAt: now(), updatedAt: now(), readAt: 0,
      name: clean(b.name, 120), email: clean(b.email, 160).toLowerCase(), company: clean(b.company, 160),
      phone: clean(b.phone, 40), needs: clean(b.needs, 400), message: clean(b.message, 5000),
      page: clean(b.page, 200), replies: [], notes: ''
    };
    if (!q.name || !EMAIL_RE.test(q.email) || !q.message) return send(res, 400, { message: 'Missing name, email or message.' });
    db.inquiries.push(q);
    store.save();
    return send(res, 201, { ok: true });
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
      /* The visitor has closed the page: send the reply to their inbox. */
      let emailed = false;
      if (t - (conv.visitorSeenAt || 0) > 90_000 && conv.visitor.email) {
        emailed = true;
        mailer.send({
          to: conv.visitor.email,
          replyTo: NOTIFY_EMAIL,
          subject: 'ErgonSite replied to your chat',
          text: `Hi ${conv.visitor.name},\n\n${user.name} from ErgonSite replied to your chat:\n\n${text}\n\nYou can simply reply to this email.\n\nErgonSite\ninfo@ergonsite.com\nhttps://ergonsite.com`,
          html: layout(`${user.name} replied to your chat`,
            `<p style="margin:0 0 14px">Hi ${esc(conv.visitor.name)},</p><div style="background:#f5f5f7;border-radius:14px;padding:16px 18px">${textToHtml(text)}</div><p style="margin:16px 0 0">You can simply reply to this email, or come back to <a href="https://ergonsite.com" style="color:#1b3a9e">ergonsite.com</a> and carry on in the chat.</p>`,
            'ErgonSite &middot; info@ergonsite.com &middot; ergonsite.com')
        }).catch((err) => console.error('Reply email failed:', err.message));
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

    if (p === '/' || p === '/robots.txt') {
      res.writeHead(p === '/' ? 302 : 200, p === '/' ? { Location: '/admin/' } : { 'Content-Type': 'text/plain' });
      return res.end(p === '/' ? '' : 'User-agent: *\nDisallow: /\n');
    }

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
