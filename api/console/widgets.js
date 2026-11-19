/* =====================================================================
   ErgonSite console: shared widgets.

   1. A calendar for every date and month field. The browser's own
      pickers look different on every computer and show dates the US way
      on some; this one looks the same everywhere and writes "19 Nov 2026".
      Any <input type="date"> or <input type="month"> that appears on a
      page or in a dialog is upgraded on its own: the input keeps its
      value (YYYY-MM-DD / YYYY-MM) and still fires input and change, so
      the code that reads it does not change.
   2. ErgonConsole.multiSelect: a dropdown with a search box and
      tick boxes, for filters where you may want several at once.
   ===================================================================== */
(function () {
  'use strict';
  const C = window.ErgonConsole;
  if (!C) return;
  const { h } = C;

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
  const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 10h17M8 3v4M16 3v4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
  const CARET = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /* ---------------- a floating panel under a button ---------------- */
  let openPanel = null;
  function popover(anchor, panel, onClose) {
    if (openPanel) openPanel.close();
    const host = anchor.closest('dialog') || document.body;          // inside a dialog it must live in the dialog
    panel.classList.add('w-pop');
    host.append(panel);
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const w = panel.offsetWidth, hgt = panel.offsetHeight;
      let left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      let top = r.bottom + 6;
      if (top + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
      panel.style.left = left + 'px';
      panel.style.top = Math.max(8, top) + 'px';
    };
    place();
    const away = (e) => { if (!panel.contains(e.target) && !anchor.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); anchor.focus(); } };
    const scroll = (e) => { if (!panel.contains(e.target)) close(); };
    function close() {
      if (!panel.isConnected) return;
      panel.remove();
      document.removeEventListener('pointerdown', away, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
      anchor.setAttribute('aria-expanded', 'false');
      openPanel = null;
      if (onClose) onClose();
    }
    setTimeout(() => {
      document.addEventListener('pointerdown', away, true);
      window.addEventListener('scroll', scroll, true);
    }, 0);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    anchor.setAttribute('aria-expanded', 'true');
    openPanel = { close, place };
    return openPanel;
  }

  /* ---------------- the calendar ---------------- */
  const valueProp = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function enhance(input) {
    if (input.dataset.cal) return;
    const kind = input.type === 'month' ? 'month' : 'date';
    input.dataset.cal = kind;
    const raw = () => valueProp.get.call(input);
    const text = h('span', { class: 'w-cal-text' });
    const btn = h('button', { type: 'button', class: 'w-cal', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, text);
    btn.insertAdjacentHTML('beforeend', ICON);
    if (input.getAttribute('aria-label')) btn.setAttribute('aria-label', input.getAttribute('aria-label'));

    const paint = () => {
      const v = raw();
      let label = '';
      if (kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) label = new Date(v + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      if (kind === 'month' && /^\d{4}-\d{2}$/.test(v)) label = MONTHS[Number(v.slice(5)) - 1] + ' ' + v.slice(0, 4);
      text.textContent = label || input.placeholder || (kind === 'month' ? 'Pick a month' : 'Pick a date');
      btn.classList.toggle('is-empty', !label);
    };
    // keep the real input (forms and code read it), but show the button instead
    input.type = 'hidden';
    Object.defineProperty(input, 'value', { configurable: true, get: raw, set: (v) => { valueProp.set.call(input, v); paint(); } });
    input.after(btn);
    paint();

    const choose = (v) => {
      valueProp.set.call(input, v);
      paint();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true' && openPanel) return openPanel.close();
      const v = raw();
      const base = v ? new Date((kind === 'month' ? v + '-01' : v) + 'T00:00:00') : new Date();
      let view = { y: base.getFullYear(), m: base.getMonth(), mode: kind === 'month' ? 'months' : 'days' };
      const panel = h('div', { class: 'w-calpop', role: 'dialog', 'aria-label': kind === 'month' ? 'Pick a month' : 'Pick a date' });
      let pop;
      const draw = () => {
        const head = h('div', { class: 'w-cal-head' },
          h('button', { type: 'button', class: 'w-nav', 'aria-label': 'Previous', onclick: () => { if (view.mode === 'days') { view.m--; if (view.m < 0) { view.m = 11; view.y--; } } else view.y--; draw(); } }, '‹'),
          h('button', { type: 'button', class: 'w-title', text: view.mode === 'days' ? MONTHS[view.m] + ' ' + view.y : String(view.y),
            onclick: () => { if (kind === 'date') { view.mode = view.mode === 'days' ? 'months' : 'days'; draw(); } } }),
          h('button', { type: 'button', class: 'w-nav', 'aria-label': 'Next', onclick: () => { if (view.mode === 'days') { view.m++; if (view.m > 11) { view.m = 0; view.y++; } } else view.y++; draw(); } }, '›'));
        let grid;
        if (view.mode === 'days') {
          const first = new Date(view.y, view.m, 1);
          const offset = (first.getDay() + 6) % 7;                     // weeks start on Monday
          const cells = [];
          for (let i = 0; i < 42; i++) {
            const d = new Date(view.y, view.m, 1 - offset + i);
            const val = iso(d.getFullYear(), d.getMonth(), d.getDate());
            cells.push(h('button', {
              type: 'button',
              class: 'w-day' + (d.getMonth() !== view.m ? ' is-other' : '') + (val === todayIso() ? ' is-today' : '') + (val === raw() ? ' is-on' : ''),
              text: String(d.getDate()), 'aria-label': d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
              onclick: () => { choose(val); pop.close(); btn.focus(); }
            }));
          }
          grid = [h('div', { class: 'w-week' }, DAYS.map((x) => h('span', { text: x }))), h('div', { class: 'w-days' }, cells)];
        } else {
          grid = h('div', { class: 'w-months' }, MONTHS.map((name, i) => {
            const val = view.y + '-' + pad(i + 1);
            const now = new Date();
            return h('button', {
              type: 'button', text: name.slice(0, 3),
              class: 'w-month' + ((kind === 'month' ? raw() : raw().slice(0, 7)) === val ? ' is-on' : '') + (now.getFullYear() === view.y && now.getMonth() === i ? ' is-today' : ''),
              onclick: () => {
                if (kind === 'month') { choose(val); pop.close(); btn.focus(); }
                else { view.m = i; view.mode = 'days'; draw(); }
              }
            });
          }));
        }
        const foot = h('div', { class: 'w-cal-foot' },
          h('button', { type: 'button', class: 'link', text: kind === 'month' ? 'This month' : 'Today', onclick: () => { choose(kind === 'month' ? todayIso().slice(0, 7) : todayIso()); pop.close(); btn.focus(); } }),
          input.required ? null : h('button', { type: 'button', class: 'link', text: 'Clear', onclick: () => { choose(''); pop.close(); btn.focus(); } }));
        panel.replaceChildren(head, ...[].concat(grid), foot);
        if (pop) pop.place();
      };
      draw();
      pop = popover(btn, panel);
      const focus = panel.querySelector('.is-on') || panel.querySelector('.is-today') || panel.querySelector('.w-day, .w-month');
      if (focus) focus.focus();
    });
  }

  const scan = (root) => {
    if (root.matches && root.matches('input[type=date], input[type=month]')) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('input[type=date], input[type=month]').forEach(enhance);
  };
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); }); })
    .observe(document.body, { childList: true, subtree: true });
  scan(document.body);

  /* ---------------- searchable multi-select ----------------
     items: [{ value, label }]; selected: values; nothing picked = all.
     onChange(values) runs when the panel closes, if anything changed. */
  C.multiSelect = function ({ items, selected, allLabel, noun, onChange, label }) {
    let sel = new Set(selected || []);
    const text = h('span', { class: 'w-ms-text' });
    const btn = h('button', { type: 'button', class: 'w-ms', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label || allLabel }, text);
    btn.insertAdjacentHTML('beforeend', CARET);
    const paint = () => {
      const picked = items.filter((i) => sel.has(i.value));
      text.textContent = !picked.length ? allLabel : picked.length === 1 ? picked[0].label : picked.length + ' ' + noun;
      btn.classList.toggle('is-set', picked.length > 0);
    };
    paint();
    btn.addEventListener('click', () => {
      if (btn.getAttribute('aria-expanded') === 'true' && openPanel) return openPanel.close();
      const before = [...sel].sort().join('\u0001');
      const search = h('input', { type: 'search', class: 'w-ms-search', placeholder: 'Search…', 'aria-label': 'Search' });
      const list = h('div', { class: 'w-ms-list', role: 'listbox', 'aria-multiselectable': 'true' });
      const draw = () => {
        const q = search.value.trim().toLowerCase();
        const shown = items.filter((i) => !q || i.label.toLowerCase().includes(q));
        list.replaceChildren(...shown.map((i) => {
          const box = h('input', { type: 'checkbox', checked: sel.has(i.value) ? true : null });
          box.addEventListener('change', () => { if (box.checked) sel.add(i.value); else sel.delete(i.value); paint(); });
          return h('label', { class: 'w-ms-item' }, box, h('span', { text: i.label }));
        }), ...(shown.length ? [] : [h('p', { class: 'muted w-ms-none', text: 'Nothing matches.' })]));
      };
      search.addEventListener('input', draw);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pop.close(); } });
      const panel = h('div', { class: 'w-mspop' },
        search,
        h('div', { class: 'w-ms-actions' },
          h('button', { type: 'button', class: 'link', text: allLabel, onclick: () => { sel.clear(); paint(); draw(); } }),
          h('button', { type: 'button', class: 'link', text: 'Select shown', onclick: () => { const q = search.value.trim().toLowerCase(); items.filter((i) => !q || i.label.toLowerCase().includes(q)).forEach((i) => sel.add(i.value)); paint(); draw(); } })),
        list,
        h('div', { class: 'w-cal-foot' }, h('button', { type: 'button', class: 'btn btn-dark w-done', text: 'Done', onclick: () => pop.close() })));
      draw();
      const pop = popover(btn, panel, () => {
        if ([...sel].sort().join('\u0001') !== before && onChange) onChange([...sel]);
      });
      search.focus();
    });
    return btn;
  };

  /* ---------------- period picker ----------------
     Quick choices (this month, last month, …) and Custom, which shows a
     From and a To month. onChange({ preset, from, to }) on every change.
     Each section keeps its own period. */
  const pad2 = (n) => String(n).padStart(2, '0');
  const nowMonth = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  const mShift = (m, n) => { const i = Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1 + n; return Math.floor(i / 12) + '-' + pad2(i % 12 + 1); };
  C.PERIODS = {
    month: { label: 'This month', range: () => [nowMonth(), nowMonth()] },
    last: { label: 'Last month', range: () => [mShift(nowMonth(), -1), mShift(nowMonth(), -1)] },
    q: { label: 'Last 3 months', range: () => [mShift(nowMonth(), -2), nowMonth()] },
    year: { label: 'This year', range: () => [nowMonth().slice(0, 4) + '-01', nowMonth()] },
    prev: { label: 'Last year', range: () => { const y = Number(nowMonth().slice(0, 4)) - 1; return [y + '-01', y + '-12']; } },
    custom: { label: 'Custom', range: null }
  };
  C.periodPreset = (from, to, keys) => (keys || Object.keys(C.PERIODS)).find((k) => C.PERIODS[k].range && C.PERIODS[k].range().join() === from + ',' + to) || 'custom';
  C.monthShift = mShift;
  C.periodPicker = function ({ from, to, preset, presets, onChange, label }) {
    const keys = presets || Object.keys(C.PERIODS);
    let cur = preset || C.periodPreset(from, to, keys);
    const fromIn = h('input', { type: 'month', value: from, 'aria-label': 'From' });
    const toIn = h('input', { type: 'month', value: to, 'aria-label': 'To' });
    const custom = h('div', { class: 'w-period-custom', hidden: cur === 'custom' ? null : true },
      h('label', null, 'From', fromIn), h('label', null, 'To', toIn));
    const emit = (p, a, b) => { if (a > b) [a, b] = [b, a]; cur = p; if (onChange) onChange({ preset: p, from: a, to: b }); };
    const onRange = () => { if (fromIn.value && toIn.value) emit('custom', fromIn.value, toIn.value); };
    fromIn.addEventListener('change', onRange);
    toIn.addEventListener('change', onRange);
    const seg = h('div', { class: 'seg x-presets', role: 'group', 'aria-label': label || 'Period' }, keys.map((k) => h('button', {
      type: 'button', class: cur === k ? 'is-on' : null, text: C.PERIODS[k].label, 'aria-pressed': cur === k ? 'true' : 'false',
      onclick: (e) => {
        seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-on', b === e.currentTarget); b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); });
        if (k === 'custom') { custom.hidden = false; cur = 'custom'; return; }
        custom.hidden = true;
        const [a, b] = C.PERIODS[k].range();
        emit(k, a, b);
      }
    })));
    return h('div', { class: 'w-period' }, seg, custom);
  };
})();
