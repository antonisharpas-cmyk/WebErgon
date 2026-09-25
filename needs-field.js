/* =====================================================================
   "What do you need?" — a dropdown that holds checkboxes.

   A native <select multiple> is the obvious tool and the wrong one: on
   desktop it demands ctrl-click, which most people never discover, and
   on phones it renders as an unlabelled scrolling box. This keeps the
   closed-dropdown affordance people expect and opens to plain
   checkboxes, so picking three things takes three taps.

   The checkboxes carry no name attribute on purpose. The form value is
   the hidden input this writes to, so FormData sees one tidy
   comma-separated string instead of a repeated key.

   No JavaScript, no dropdown: the panel is visible and every checkbox
   still works, so the field degrades to a plain checkbox list.
   ===================================================================== */
(function () {
  const root = document.querySelector('[data-multiselect]');
  if (!root) return;

  const trigger = root.querySelector('.multiselect-trigger');
  const panel = root.querySelector('.multiselect-panel');
  const valueEl = root.querySelector('.multiselect-value');
  const hidden = root.querySelector('input[type="hidden"]');
  const boxes = Array.from(root.querySelectorAll('input[type="checkbox"]'));
  if (!trigger || !panel || !valueEl || !hidden || !boxes.length) return;

  const placeholder = valueEl.getAttribute('data-placeholder') || 'Select';

  // the panel is open in the markup so it works without this script;
  // now that we are running, close it
  root.classList.add('is-enhanced');
  panel.hidden = true;
  trigger.hidden = false;

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }

  function isOpen() {
    return !panel.hidden;
  }

  function sync() {
    const picked = boxes.filter((b) => b.checked).map((b) => b.value);
    hidden.value = picked.join(', ');

    if (!picked.length) {
      valueEl.textContent = placeholder;
      valueEl.classList.add('is-placeholder');
    } else {
      valueEl.classList.remove('is-placeholder');
      // two fit comfortably; past that the count is more readable than
      // a truncated list
      valueEl.textContent = picked.length <= 2
        ? picked.join(' · ')
        : picked.length + ' selected';
    }

    // clear the "please tell us what you need" warning the moment they do
    const field = root.closest('.field');
    if (field && picked.length) {
      field.classList.remove('has-error');
      const msg = field.querySelector('.field-msg');
      if (msg) msg.textContent = '';
    }
  }

  trigger.addEventListener('click', () => {
    if (isOpen()) close();
    else open();
  });

  boxes.forEach((box) => box.addEventListener('change', sync));

  // clicking away closes it, but not while the click is inside the panel
  document.addEventListener('click', (event) => {
    if (isOpen() && !root.contains(event.target)) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      close();
      trigger.focus();
    }
  });

  // tabbing past the last checkbox should close it, the way a real
  // select does, rather than leaving a panel hanging over the page
  panel.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (isOpen() && !root.contains(document.activeElement)) close();
    }, 0);
  });

  sync();
})();
