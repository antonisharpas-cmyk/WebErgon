/* =====================================================================
   Searchable country-code picker.

   Progressive enhancement: the markup ships a real <select> holding
   every country, so the field works with no JavaScript at all. This
   script hides that select, drives it from a searchable listbox, and
   keeps the select as the single source of truth for the form value.

   Choosing "Other" swaps in a free-text box for codes we don't list.
   ===================================================================== */
(function () {
  const select = document.querySelector('select[name="dialCode"]');
  if (!select) return;

  const other = document.querySelector('.dial-other');
  const options = Array.from(select.options).map(function (opt) {
    return {
      value: opt.value,
      country: opt.getAttribute('data-country') || opt.textContent.trim(),
      label: opt.textContent.trim(),
    };
  });

  const wrap = document.createElement('div');
  wrap.className = 'dial-picker';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dial-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="dial-current"></span>';

  const panel = document.createElement('div');
  panel.className = 'dial-panel';
  panel.hidden = true;

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'dial-search';
  search.placeholder = 'Search country or code…';
  search.setAttribute('aria-label', 'Search for a country or dialling code');
  search.autocomplete = 'off';

  const list = document.createElement('ul');
  list.className = 'dial-list';
  list.setAttribute('role', 'listbox');

  panel.appendChild(search);
  panel.appendChild(list);
  wrap.appendChild(trigger);
  wrap.appendChild(panel);

  select.parentNode.insertBefore(wrap, select);
  select.classList.add('is-enhanced');
  select.setAttribute('tabindex', '-1');
  select.setAttribute('aria-hidden', 'true');

  let filtered = options.slice();
  let active = 0;

  function currentIndex() {
    for (let i = 0; i < options.length; i++) {
      if (options[i].value === select.value) return i;
    }
    return 0;
  }

  function paintTrigger() {
    const opt = options[currentIndex()];
    trigger.querySelector('.dial-current').textContent = opt ? opt.label : '';
  }

  function renderList() {
    list.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('li');
      empty.className = 'dial-empty';
      empty.textContent = 'No match';
      list.appendChild(empty);
      return;
    }

    filtered.forEach(function (opt, i) {
      const li = document.createElement('li');
      li.className = 'dial-option' + (i === active ? ' is-active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', opt.value === select.value ? 'true' : 'false');
      li.textContent = opt.label;
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();          // keep focus, so blur doesn't race the click
        choose(opt);
      });
      li.addEventListener('mousemove', function () {
        if (active === i) return;
        active = i;
        paintActive();
      });
      list.appendChild(li);
    });
  }

  function paintActive() {
    const items = list.querySelectorAll('.dial-option');
    items.forEach(function (el, i) {
      el.classList.toggle('is-active', i === active);
    });
    const el = items[active];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function choose(opt) {
    select.value = opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    paintTrigger();
    applyOtherState();
    close();
    trigger.focus();
  }

  function applyOtherState() {
    if (!other) return;
    const isOther = select.value === 'other';
    other.hidden = !isOther;
    wrap.classList.toggle('is-other', isOther);
    if (isOther) other.focus();
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = '';
    filtered = options.slice();
    active = Math.max(0, filtered.indexOf(options[currentIndex()]));
    renderList();
    paintActive();
    search.focus();
  }

  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  trigger.addEventListener('click', function () {
    panel.hidden ? open() : close();
  });

  search.addEventListener('input', function () {
    const q = search.value.trim().toLowerCase().replace(/^\+/, '');
    filtered = !q
      ? options.slice()
      : options.filter(function (opt) {
          return (
            opt.country.toLowerCase().indexOf(q) !== -1 ||
            opt.value.replace('+', '').indexOf(q) === 0
          );
        });
    active = 0;
    renderList();
  });

  function keyNav(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (panel.hidden) return open();
      active += e.key === 'ArrowDown' ? 1 : -1;
      if (active < 0) active = filtered.length - 1;
      if (active >= filtered.length) active = 0;
      paintActive();
    } else if (e.key === 'Enter') {
      if (!panel.hidden && filtered[active]) {
        e.preventDefault();
        choose(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (!panel.hidden) {
        e.preventDefault();
        close();
        trigger.focus();
      }
    }
  }

  trigger.addEventListener('keydown', keyNav);
  search.addEventListener('keydown', keyNav);

  document.addEventListener('click', function (e) {
    if (!wrap.contains(e.target)) close();
  });

  paintTrigger();
  applyOtherState();
})();
