/* =====================================================================
   ErgonSite live chat bubble.

   Talks to the ErgonSite API on Render (see api/server.mjs). A visitor
   gives a name and email once, then chats; the team answers from the
   console and the reply appears here. The conversation is remembered in
   this browser (localStorage), so coming back later picks it up again.
   Every message from the team is put on the page with textContent only.
   ===================================================================== */
(function () {
  'use strict';

  const API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:4000'
    : 'https://api.ergonsite.com';
  const KEY = 'ergon.chat';
  const TEAM = [
    ['/assets/chat/michail-athanasiades.webp', 'Michail'],
    ['/assets/chat/antonis-harpas.webp', 'Antonis'],
    ['/assets/chat/maria-athanasiadou.webp', 'Maria'],
    ['/assets/chat/tasos-kounni.webp', 'Tasos']
  ];

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;            // only ever our own static markup
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
  }

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save(v) { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch (e) { /* private mode */ } }

  let conv = load();          // {id, token, name, lastReadAt}
  let messages = [];
  let lastAt = 0;
  let online = false;
  let isOpen = false;
  let timer = null;

  async function call(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    if (conv && conv.token) headers['X-Chat-Token'] = conv.token;
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
      mode: 'cors'
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (!res.ok) throw Object.assign(new Error(data.message || 'The chat is not available right now.'), { status: res.status });
    return data;
  }

  /* ---------------- the DOM ---------------- */
  const ICON_CHAT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.6 3.6c-.4.3-.9 0-.9-.5V17H4.5A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z" fill="currentColor"/><circle cx="8.5" cy="11.3" r="1.2" fill="#1b3a9e"/><circle cx="12" cy="11.3" r="1.2" fill="#1b3a9e"/><circle cx="15.5" cy="11.3" r="1.2" fill="#1b3a9e"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-6.5 16-2.5-6.5z" fill="currentColor"/></svg>';

  const faces = () => h('span', { class: 'ec-faces', 'aria-hidden': 'true' },
    TEAM.map(([src]) => h('img', { src, alt: '', width: '34', height: '34', loading: 'lazy' })));

  const badge = h('span', { class: 'ec-badge', hidden: true });
  const launcher = h('button', {
    type: 'button', class: 'ec-launcher', 'aria-label': 'Chat with ErgonSite', 'aria-expanded': 'false', 'aria-controls': 'ec-panel'
  }, h('span', { class: 'ec-ico ec-ico-chat', html: ICON_CHAT }), h('span', { class: 'ec-ico ec-ico-x', html: ICON_X }), badge);

  const teaserClose = h('button', { type: 'button', class: 'ec-teaser-x', 'aria-label': 'Dismiss', html: ICON_X });
  const teaser = h('div', { class: 'ec-teaser', hidden: true },
    faces(),
    h('p', null, h('b', { text: 'Questions about a project?' }), h('span', { text: 'Chat with the people who build it.' })),
    teaserClose);

  const statusLine = h('span', { class: 'ec-status' });
  const body = h('div', { class: 'ec-body' });
  const closeBtn = h('button', { type: 'button', class: 'ec-close', 'aria-label': 'Close chat', html: ICON_X });
  const panel = h('div', { class: 'ec-panel', id: 'ec-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ec-title', hidden: true },
    h('div', { class: 'ec-head' },
      faces(),
      h('div', { class: 'ec-head-text' }, h('h2', { id: 'ec-title', text: 'Chat with ErgonSite' }), statusLine),
      closeBtn),
    body);

  const root = h('div', { class: 'ec-root' }, teaser, panel, launcher);

  function setStatus() {
    statusLine.replaceChildren(
      h('i', { class: online ? 'is-on' : '' }),
      online ? 'Online now' : 'We reply here, or by email if you leave'
    );
  }

  /* ---------------- views ---------------- */
  function showStart(errorText) {
    const err = h('p', { class: 'ec-error', role: 'alert', text: errorText || '' });
    const form = h('form', { class: 'ec-start', novalidate: true },
      h('p', { class: 'ec-hello' }, h('b', { text: 'Hi there.' }), ' Tell us what you’re working on and the team that builds it will answer.'),
      h('label', null, h('span', { text: 'Name' }), h('input', { name: 'name', autocomplete: 'name', maxlength: '80', required: true })),
      h('label', null, h('span', { text: 'Email' }), h('input', { name: 'email', type: 'email', autocomplete: 'email', maxlength: '160', required: true })),
      h('label', null, h('span', { text: 'Message' }), h('textarea', { name: 'message', rows: '3', maxlength: '2000', required: true })),
      h('input', { name: 'website', class: 'ec-hp', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' }),
      err,
      h('button', { type: 'submit', class: 'ec-btn' }, 'Start chat', h('span', { html: ICON_SEND })),
      h('p', { class: 'ec-fine' }, 'We keep the chat to answer you. ', h('a', { href: '/privacy', text: 'Privacy Policy' }))
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      if (!f.name.value.trim()) { err.textContent = 'Please tell us your name.'; return f.name.focus(); }
      if (!/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(f.email.value.trim())) { err.textContent = 'Please check your email, so we can reply if you leave.'; return f.email.focus(); }
      if (!f.message.value.trim()) { err.textContent = 'Please type a message.'; return f.message.focus(); }
      const btn = form.querySelector('.ec-btn'); btn.disabled = true; err.textContent = '';
      try {
        const r = await call('/api/chat/start', { method: 'POST', body: {
          name: f.name.value, email: f.email.value, message: f.message.value, website: f.website.value, page: location.pathname
        } });
        if (!r.id) { showStart(); return; }
        conv = { id: r.id, token: r.token, name: f.name.value.trim(), lastReadAt: Date.now() };
        save(conv);
        online = r.online; setStatus();
        messages = []; lastAt = 0;
        showThread();
        addMessages(r.messages);
        if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'chat' });
      } catch (ex) {
        err.textContent = ex.message + (ex.status ? '' : ' You can also email info@ergonsite.com.');
        btn.disabled = false;
      }
    });
    body.replaceChildren(form);
    setTimeout(() => { const first = form.querySelector('input'); if (first && isOpen) first.focus(); }, 60);
  }

  let threadEl = null;
  let inputEl = null;
  function showThread() {
    threadEl = h('div', { class: 'ec-thread', 'aria-live': 'polite' });
    inputEl = h('textarea', { rows: '1', maxlength: '2000', placeholder: 'Write a message…', 'aria-label': 'Message' });
    const sendBtn = h('button', { type: 'submit', class: 'ec-send', 'aria-label': 'Send', html: ICON_SEND });
    const form = h('form', { class: 'ec-compose' }, inputEl, sendBtn);
    inputEl.addEventListener('input', () => { inputEl.style.height = 'auto'; inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px'; });
    inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = inputEl.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        const r = await call('/api/chat/' + conv.id + '/messages', { method: 'POST', body: { text } });
        inputEl.value = ''; inputEl.style.height = '';
        addMessages([r.message]);
      } catch (ex) {
        if (ex.status === 404) return reset();
        addNote(ex.message);
      } finally { sendBtn.disabled = false; inputEl.focus(); }
    });
    const endBtn = h('button', { type: 'button', class: 'ec-end', text: 'Start a new chat', onclick: () => {
      if (confirm('Start a new chat? This one stays with our team.')) reset();
    } });
    body.replaceChildren(threadEl, form, endBtn);
    messages.forEach(renderMessage);
  }

  function addNote(text) {
    if (threadEl) threadEl.append(h('p', { class: 'ec-note', text }));
  }

  function renderMessage(m) {
    const mine = m.from === 'visitor';
    threadEl.append(h('div', { class: 'ec-msg ' + (mine ? 'is-mine' : 'is-team') },
      mine ? null : h('span', { class: 'ec-who', text: m.name || 'ErgonSite' }),
      h('p', { text: m.text }),
      h('time', { text: new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function addMessages(list) {
    let added = false;
    for (const m of list || []) {
      if (messages.some((x) => x.id === m.id)) continue;
      messages.push(m);
      lastAt = Math.max(lastAt, m.at);
      if (threadEl && isOpen) renderMessage(m);
      added = true;
    }
    if (added && messages.length === 1 && messages[0].from === 'visitor' && threadEl) {
      addNote('Thanks, ' + (conv.name || '').split(' ')[0] + '. We have your message and will reply here. If you leave, the reply goes to your email.');
    }
    updateUnread();
  }

  function updateUnread() {
    if (!conv) { badge.hidden = true; return; }
    if (isOpen) { conv.lastReadAt = Date.now(); save(conv); }
    const n = messages.filter((m) => m.from === 'staff' && m.at > (conv.lastReadAt || 0)).length;
    badge.hidden = !n;
    badge.textContent = n;
    launcher.classList.toggle('has-unread', n > 0);
  }

  function reset() {
    conv = null; save(null); messages = []; lastAt = 0; threadEl = null;
    updateUnread();
    showStart();
  }

  /* ---------------- polling ---------------- */
  async function poll() {
    if (!conv) {
      try { const s = await call('/api/status'); online = s.online; setStatus(); } catch (e) { /* offline */ }
      return;
    }
    try {
      const r = await call('/api/chat/' + conv.id + '?after=' + lastAt);
      online = r.online; setStatus();
      addMessages(r.messages);
    } catch (e) {
      if (e.status === 404) reset();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    const every = isOpen ? 3000 : (conv ? 20000 : 0);
    if (!every) return;
    timer = setTimeout(async () => { await poll(); schedule(); }, every);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { poll(); } schedule(); });

  /* ---------------- open / close ---------------- */
  async function open() {
    isOpen = true;
    hideTeaser(true);
    panel.hidden = false;
    requestAnimationFrame(() => root.classList.add('is-open'));
    launcher.setAttribute('aria-expanded', 'true');
    launcher.setAttribute('aria-label', 'Close chat');
    document.documentElement.classList.add('ec-lock-mobile');
    if (conv) {
      if (!threadEl) showThread();
      else { threadEl.replaceChildren(); messages.forEach(renderMessage); }
      await poll();
      updateUnread();
      if (inputEl) inputEl.focus();
    } else {
      showStart();
      poll();
    }
    schedule();
  }

  function close() {
    isOpen = false;
    root.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Chat with ErgonSite');
    document.documentElement.classList.remove('ec-lock-mobile');
    setTimeout(() => { if (!isOpen) panel.hidden = true; }, 250);
    schedule();
  }

  launcher.addEventListener('click', () => (isOpen ? close() : open()));
  closeBtn.addEventListener('click', () => { close(); launcher.focus(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) { close(); launcher.focus(); } });

  /* a gentle hello, once per visit, after a few seconds */
  function hideTeaser(forever) {
    teaser.classList.remove('is-on');
    setTimeout(() => { teaser.hidden = true; }, 300);
    if (forever) { try { sessionStorage.setItem('ergon.teaser', '1'); } catch (e) { /* ignore */ } }
  }
  teaserClose.addEventListener('click', (e) => { e.stopPropagation(); hideTeaser(true); });
  teaser.addEventListener('click', () => open());

  function maybeTeaser() {
    let seen = false;
    try { seen = sessionStorage.getItem('ergon.teaser') === '1'; } catch (e) { /* ignore */ }
    if (seen || conv || isOpen) return;
    setTimeout(() => {
      if (isOpen) return;
      teaser.hidden = false;
      requestAnimationFrame(() => teaser.classList.add('is-on'));
      setTimeout(() => { if (!isOpen) hideTeaser(false); }, 12000);
    }, 7000);
  }

  function start() {
    document.body.append(root);
    setStatus();
    requestAnimationFrame(() => root.classList.add('is-ready'));
    if (conv) { poll(); schedule(); }
    maybeTeaser();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
