/* =====================================================================
   ErgonSite console: live chat inbox, enquiries inbox, team.

   Everything visitors typed is put on the page with textContent only,
   never innerHTML, so a message can never inject markup or script.
   The list refreshes every 5 seconds, an open chat every 3.
   ===================================================================== */
(function () {
  'use strict';

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;   // CSSOM, allowed by the strict CSP
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
    return el;
  }

  async function api(path, opts = {}) {
    const res = await fetch('/admin/api' + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json', 'X-Console': '1' } : { 'X-Console': '1' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && path !== '/login') { showLogin(); throw new Error(data.message || 'Please sign in.'); }
    if (!res.ok) throw new Error(data.message || 'Something went wrong.');
    return data;
  }

  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('is-on'), 2600);
  }

  const initials = (name) => (String(name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  const COLORS = ['#1b3a9e', '#00897b', '#5e35b1', '#e8710a', '#c2185b', '#3949ab', '#2e7d32'];
  const colorFor = (s) => COLORS[[...String(s)].reduce((n, c) => n + c.charCodeAt(0), 0) % COLORS.length];

  function when(ts) {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diff = (today - d) / 86400000;
    if (diff < 6) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  const full = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  /* ---------------- state ---------------- */
  const state = {
    me: null, view: 'chats', overview: null,
    chatFilter: 'open', inqFilter: 'active',
    chatId: null, inqId: null, chatLastAt: 0
  };

  /* ---------------- sign in ---------------- */
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    clearInterval(state.listTimer); clearInterval(state.chatTimer);
    setTimeout(() => $('#loginForm [name=email]').focus(), 30);
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#loginError').textContent = '';
    const btn = $('button', f); btn.disabled = true;
    try {
      await api('/login', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
      f.password.value = '';
      await boot();
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally { btn.disabled = false; }
  });

  $('#logout').addEventListener('click', async () => {
    try { await api('/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    state.me = null;
    showLogin();
  });

  async function boot() {
    let data;
    try { data = await api('/me'); } catch (e) { return showLogin(); }
    state.me = data.user;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#meName').textContent = data.user.name;
    $('#meEmail').textContent = data.user.email;
    $('#meAvatar').textContent = initials(data.user.name);
    $('#mailWarn').hidden = data.mail;
    $('#addUser').hidden = data.user.role !== 'owner';
    route();
    await refresh();
    clearInterval(state.listTimer);
    state.listTimer = setInterval(refresh, 5000);
  }

  /* ---------------- routing (#chats, #chat/ID, #inquiries, #inquiry/ID, #team) ---------------- */
  function route() {
    const hash = location.hash.replace(/^#/, '') || 'chats';
    const [name, id] = hash.split('/');
    const view = name === 'chat' ? 'chats' : name === 'inquiry' ? 'inquiries' : (['chats', 'inquiries', 'team'].includes(name) ? name : 'chats');
    state.view = view;
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + view));
    $$('.side-nav a').forEach((a) => a.classList.toggle('is-on', a.dataset.view === view));
    if (name === 'chat' && id) openChat(id);
    else if (view === 'chats') closeDetail('chats');
    if (name === 'inquiry' && id) openInquiry(id);
    else if (view === 'inquiries') closeDetail('inquiries');
    if (view === 'team') loadTeam();
  }
  window.addEventListener('hashchange', route);

  function closeDetail(view) {
    if (view === 'chats') { state.chatId = null; clearInterval(state.chatTimer); }
    if (view === 'inquiries') state.inqId = null;
    $('#view-' + view).classList.remove('has-detail');
    renderLists();
  }

  /* ---------------- lists ---------------- */
  async function refresh() {
    try {
      state.overview = await api('/overview');
    } catch (e) { return; }
    const c = state.overview.counts;
    const bc = $('#badgeChats'); bc.hidden = !c.chatsUnread; bc.textContent = c.chatsUnread;
    const bi = $('#badgeInq'); bi.hidden = !c.inquiriesNew; bi.textContent = c.inquiriesNew;
    const total = c.chatsUnread + c.inquiriesNew;
    document.title = (total ? '(' + total + ') ' : '') + 'ErgonSite console';
    renderLists();
  }

  function renderLists() {
    const o = state.overview;
    if (!o) return;

    const chats = o.conversations.filter((x) => state.chatFilter === 'all' || x.status === state.chatFilter);
    $('#chatList').replaceChildren(...chats.map((x) =>
      h('li', null, h('button', {
        type: 'button',
        class: (x.id === state.chatId ? 'is-on ' : '') + (x.unread ? 'is-unread' : ''),
        onclick: () => { location.hash = 'chat/' + x.id; }
      },
        h('span', { class: 'avatar', style: 'background:' + colorFor(x.visitor.email) }, initials(x.visitor.name), x.visitorOnline ? h('i', { class: 'dot-online', title: 'On the website now' }) : null),
        h('span', { class: 'who', text: x.visitor.name }),
        h('span', { class: 'when', text: x.last ? when(x.last.at) : '' }),
        h('span', { class: 'prev', text: x.last ? (x.last.from === 'staff' ? 'You: ' : '') + x.last.text : '' })
      ))
    ));
    $('#chatEmpty').hidden = chats.length > 0;

    const inqs = o.inquiries.filter((x) => state.inqFilter === 'all' || (state.inqFilter === 'done' ? x.status === 'done' : x.status !== 'done'));
    $('#inqList').replaceChildren(...inqs.map((x) =>
      h('li', null, h('button', {
        type: 'button',
        class: (x.id === state.inqId ? 'is-on ' : '') + (x.read ? '' : 'is-unread'),
        onclick: () => { location.hash = 'inquiry/' + x.id; }
      },
        h('span', { class: 'avatar', style: 'background:' + colorFor(x.email) }, initials(x.name)),
        h('span', { class: 'who', text: x.name + (x.company ? ' · ' + x.company : '') }),
        h('span', { class: 'when', text: when(x.createdAt) }),
        h('span', { class: 'prev', text: x.preview })
      ))
    ));
    $('#inqEmpty').hidden = inqs.length > 0;
  }

  $$('[data-chatfilter]').forEach((b) => b.addEventListener('click', () => {
    state.chatFilter = b.dataset.chatfilter;
    $$('[data-chatfilter]').forEach((x) => x.classList.toggle('is-on', x === b));
    renderLists();
  }));
  $$('[data-inqfilter]').forEach((b) => b.addEventListener('click', () => {
    state.inqFilter = b.dataset.inqfilter;
    $$('[data-inqfilter]').forEach((x) => x.classList.toggle('is-on', x === b));
    renderLists();
  }));

  /* ---------------- one chat ---------------- */
  async function openChat(id) {
    const changed = state.chatId !== id;
    state.chatId = id;
    $('#view-chats').classList.add('has-detail');
    let data;
    try { data = await api('/conversations/' + id); } catch (e) { toast(e.message); return; }
    const c = data.conversation;
    if (changed || !$('#chatThread')) renderChat(c);
    else updateThread(c.messages);
    clearInterval(state.chatTimer);
    state.chatTimer = setInterval(async () => {
      if (state.chatId !== id || document.hidden) return;
      try {
        const d = await api('/conversations/' + id);
        updateThread(d.conversation.messages);
        const on = $('#chatOnline');
        if (on) on.textContent = d.conversation.visitorOnline ? 'On the website now' : 'Not on the website';
      } catch (e) { /* ignore */ }
    }, 3000);
    renderLists();
  }

  function renderChat(c) {
    const head = h('div', { class: 'detail-head' },
      h('button', { type: 'button', class: 'back', 'aria-label': 'Back', onclick: () => { location.hash = 'chats'; } }, '‹'),
      h('span', { class: 'avatar', style: 'background:' + colorFor(c.visitor.email) }, initials(c.visitor.name)),
      h('div', null,
        h('h3', { text: c.visitor.name }),
        h('div', { class: 'meta' },
          h('a', { href: 'mailto:' + c.visitor.email, text: c.visitor.email }), ' · ',
          h('span', { id: 'chatOnline', text: c.visitorOnline ? 'On the website now' : 'Not on the website' }),
          c.page ? ' · started on ' + c.page : '')
      ),
      h('div', { class: 'actions' },
        h('button', { type: 'button', text: c.status === 'closed' ? 'Reopen' : 'Mark as done', onclick: async () => {
          await api('/conversations/' + c.id + '/status', { method: 'POST', body: { status: c.status === 'closed' ? 'open' : 'closed' } });
          toast(c.status === 'closed' ? 'Chat reopened' : 'Chat marked as done');
          await refresh(); location.hash = 'chats';
        } }),
        h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => {
          if (!confirm('Delete this chat for good? This cannot be undone.')) return;
          await api('/conversations/' + c.id, { method: 'DELETE' });
          toast('Chat deleted'); await refresh(); location.hash = 'chats';
        } })
      )
    );
    const thread = h('div', { class: 'thread', id: 'chatThread' });
    const ta = h('textarea', { rows: '1', placeholder: 'Write a reply…  (Enter to send, Shift+Enter for a new line)', 'aria-label': 'Reply' });
    const sendBtn = h('button', { type: 'submit', class: 'btn btn-dark', text: 'Send' });
    const form = h('form', { class: 'composer' }, ta, sendBtn);
    const note = h('p', { class: 'composer-note', text: 'If the visitor has left the website, your reply is also emailed to them.' });

    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      sendBtn.disabled = true;
      try {
        const r = await api('/conversations/' + c.id + '/reply', { method: 'POST', body: { text } });
        ta.value = ''; ta.style.height = '';
        updateThread([r.message], true);
        if (r.emailed) toast('Sent. They have left the site, so it was emailed to ' + c.visitor.email);
        refresh();
      } catch (err) { toast(err.message); }
      finally { sendBtn.disabled = false; ta.focus(); }
    });

    state.chatLastAt = 0;
    state.seen = new Set();
    $('#chatDetail').replaceChildren(head, thread, form, note);
    updateThread(c.messages);
    ta.focus();
  }

  function updateThread(messages, append) {
    const thread = $('#chatThread');
    if (!thread) return;
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    let lastDay = state.lastDay;
    if (!append && !state.seen.size) lastDay = '';
    for (const m of messages) {
      if (state.seen.has(m.id)) continue;
      state.seen.add(m.id);
      const day = new Date(m.at).toDateString();
      if (day !== lastDay) {
        thread.append(h('div', { class: 'day', text: new Date(m.at).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) }));
        lastDay = day;
      }
      thread.append(h('div', { class: 'msg ' + m.from },
        m.text,
        h('small', { text: (m.from === 'staff' ? (m.staffName || 'ErgonSite') + ' · ' : '') + new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
      ));
    }
    state.lastDay = lastDay;
    if (nearBottom || append || messages.length > 1) thread.scrollTop = thread.scrollHeight;
  }

  /* ---------------- one enquiry ---------------- */
  async function openInquiry(id) {
    state.inqId = id;
    $('#view-inquiries').classList.add('has-detail');
    let data;
    try { data = await api('/inquiries/' + id); } catch (e) { toast(e.message); return; }
    const q = data.inquiry;

    const statusSel = h('select', { 'aria-label': 'Status', style: 'width:auto;padding:6px 12px;border-radius:999px;font-size:13px' },
      ...['new', 'in progress', 'done'].map((s) => h('option', { value: s, selected: q.status === s ? true : null, text: s[0].toUpperCase() + s.slice(1) })));
    statusSel.addEventListener('change', async () => {
      await api('/inquiries/' + q.id + '/status', { method: 'POST', body: { status: statusSel.value } });
      toast('Status saved'); refresh();
    });

    const head = h('div', { class: 'detail-head' },
      h('button', { type: 'button', class: 'back', 'aria-label': 'Back', onclick: () => { location.hash = 'inquiries'; } }, '‹'),
      h('span', { class: 'avatar', style: 'background:' + colorFor(q.email) }, initials(q.name)),
      h('div', null, h('h3', { text: q.name }), h('div', { class: 'meta', text: 'Sent ' + full(q.createdAt) })),
      h('div', { class: 'actions' }, statusSel,
        h('button', { type: 'button', class: 'danger', text: 'Delete', onclick: async () => {
          if (!confirm('Delete this enquiry for good? This cannot be undone.')) return;
          await api('/inquiries/' + q.id, { method: 'DELETE' });
          toast('Enquiry deleted'); await refresh(); location.hash = 'inquiries';
        } }))
    );

    const facts = h('dl', { class: 'facts' },
      h('dt', { text: 'Email' }), h('dd', null, h('a', { href: 'mailto:' + q.email, text: q.email })),
      q.phone ? [h('dt', { text: 'Phone' }), h('dd', null, h('a', { href: 'tel:' + q.phone.replace(/[^0-9+]/g, ''), text: q.phone }))] : null,
      q.company ? [h('dt', { text: 'Company' }), h('dd', { text: q.company })] : null,
      q.needs ? [h('dt', { text: 'Needs' }), h('dd', { text: q.needs })] : null
    );

    const replies = q.replies.map((r) => h('div', { class: 'reply-item' },
      h('small', { text: r.staffName + ' replied · ' + full(r.at) + (r.sent ? '' : ' · not sent: email is not set up') }),
      h('p', { class: 'message-text', text: r.text })));

    const subj = h('input', { value: 'Re: your enquiry to ErgonSite', 'aria-label': 'Subject' });
    const body = h('textarea', { rows: '6', placeholder: 'Hi ' + q.name.split(' ')[0] + ',\n\n', 'aria-label': 'Reply' });
    const sendBtn = h('button', { type: 'submit', class: 'btn btn-dark', text: 'Send email' });
    const replyForm = h('form', { class: 'card' },
      h('h3', { text: 'Reply by email' }),
      h('label', null, 'Subject', subj),
      h('label', null, 'Message', body),
      h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: 'Sent from info@ergonsite.com to ' + q.email + ', signed with your name.' }),
      h('div', null, sendBtn));
    replyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!body.value.trim()) return;
      sendBtn.disabled = true;
      try {
        const r = await api('/inquiries/' + q.id + '/reply', { method: 'POST', body: { subject: subj.value, text: body.value } });
        toast(r.reply.sent ? 'Email sent to ' + q.email : 'Saved, but not emailed: email is not set up yet');
        await refresh(); openInquiry(q.id);
      } catch (err) { toast(err.message); sendBtn.disabled = false; }
    });

    const notes = h('textarea', { rows: '3', placeholder: 'Only the team sees these notes.', 'aria-label': 'Notes' });
    notes.value = q.notes || '';
    notes.addEventListener('change', async () => {
      await api('/inquiries/' + q.id + '/notes', { method: 'POST', body: { notes: notes.value } });
      toast('Notes saved');
    });

    $('#inqDetail').replaceChildren(head, h('div', { class: 'inq-body' },
      h('div', { class: 'card' }, facts, h('p', { class: 'message-text', text: q.message })),
      replies.length ? h('div', { class: 'card' }, h('h3', { text: 'Replies' }), replies) : null,
      replyForm,
      h('div', { class: 'card' }, h('h3', { text: 'Team notes' }), notes)
    ));
    renderLists();
  }

  /* ---------------- team ---------------- */
  async function loadTeam() {
    let data;
    try { data = await api('/users'); } catch (e) { return; }
    $('#teamList').replaceChildren(...data.users.map((u) => h('li', null,
      h('span', { class: 'avatar', style: 'background:' + colorFor(u.email) }, initials(u.name)),
      h('div', { class: 'who' }, u.name + (u.id === state.me.id ? ' (you)' : ''), h('span', { text: u.email + ' · ' + u.role + (u.lastLoginAt ? ' · last in ' + when(u.lastLoginAt) : '') })),
      state.me.role === 'owner' && u.id !== state.me.id ? h('button', { type: 'button', class: 'btn btn-light', text: 'Remove', onclick: async () => {
        if (!confirm('Remove ' + u.name + ' from the console?')) return;
        try { await api('/users/' + u.id, { method: 'DELETE' }); toast(u.name + ' removed'); loadTeam(); } catch (err) { toast(err.message); }
      } }) : null
    )));
  }

  $('#addUser').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#addUserError').textContent = '';
    try {
      await api('/users', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value, role: f.role.value } });
      toast(f.name.value + ' added. Send them the console link and their first password.');
      f.reset(); loadTeam();
    } catch (err) { $('#addUserError').textContent = err.message; }
  });

  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    $('#pwError').textContent = '';
    try {
      await api('/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
      toast('Password changed'); f.reset();
    } catch (err) { $('#pwError').textContent = err.message; }
  });

  boot();
})();
