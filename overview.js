/* =====================================================================
   Work page: "Overview" opens a project inside a Mac-style browser
   window on top of the page, so the visitor never leaves ergonsite.com.

   A button with data-ov-url shows that live site in an iframe.
   A button with data-ov-video plays that video instead (OneEleven is a
   private system, so its window shows the demo-data tour).

   If a site refuses to be framed, the window stays blank; the
   "open in a new tab" button in the toolbar is always there for that.
   ===================================================================== */
(function () {
  const buttons = document.querySelectorAll('.ov-btn');
  if (!buttons.length) return;

  const modal = document.createElement('div');
  modal.className = 'ov-modal';
  modal.hidden = true;
  modal.innerHTML =
    '<div class="ov-backdrop" data-ov-close></div>' +
    '<div class="ov-window" role="dialog" aria-modal="true" aria-labelledby="ov-title">' +
      '<div class="ov-bar">' +
        '<div class="ov-lights">' +
          '<button type="button" class="ov-light ov-red" data-ov-close aria-label="Close"></button>' +
          '<button type="button" class="ov-light ov-yellow" data-ov-close aria-label="Minimise"></button>' +
          '<button type="button" class="ov-light ov-green" data-ov-zoom aria-label="Full screen"></button>' +
        '</div>' +
        '<div class="ov-nav" aria-hidden="true">' +
          '<span class="ov-chev">&lsaquo;</span><span class="ov-chev is-off">&rsaquo;</span>' +
        '</div>' +
        '<div class="ov-address">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="11" width="14" height="10" rx="2.5" fill="currentColor"/></svg>' +
          '<span class="ov-url"></span>' +
          '<button type="button" class="ov-reload" aria-label="Reload">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<a class="ov-open" target="_blank" rel="noopener noreferrer" aria-label="Open in a new tab">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</a>' +
      '</div>' +
      '<h2 class="ov-sr" id="ov-title"></h2>' +
      '<div class="ov-body"><span class="ov-spinner" aria-hidden="true"></span></div>' +
    '</div>';
  document.body.appendChild(modal);

  const win = modal.querySelector('.ov-window');
  const body = modal.querySelector('.ov-body');
  const urlText = modal.querySelector('.ov-url');
  const openLink = modal.querySelector('.ov-open');
  const reload = modal.querySelector('.ov-reload');
  const title = modal.querySelector('#ov-title');
  let lastFocus = null;

  function clearBody() {
    body.querySelectorAll('iframe, video').forEach(function (n) { n.remove(); });
    body.classList.remove('is-loaded');
  }

  function open(btn) {
    lastFocus = btn;
    clearBody();
    win.classList.remove('is-zoomed');
    title.textContent = btn.dataset.ovTitle || 'Project overview';

    if (btn.dataset.ovVideo) {
      const v = document.createElement('video');
      v.src = btn.dataset.ovVideo;
      v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.controls = true;
      v.setAttribute('aria-label', btn.dataset.ovTitle || '');
      v.addEventListener('loadeddata', function () { body.classList.add('is-loaded'); });
      body.appendChild(v);
      urlText.textContent = btn.dataset.ovLabel || '';
      openLink.href = btn.dataset.ovLink || btn.dataset.ovVideo;
      reload.hidden = true;
    } else {
      const f = document.createElement('iframe');
      f.src = btn.dataset.ovUrl;
      f.title = btn.dataset.ovTitle || 'Website preview';
      f.loading = 'eager';
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      f.addEventListener('load', function () { body.classList.add('is-loaded'); });
      body.appendChild(f);
      urlText.textContent = new URL(btn.dataset.ovUrl).hostname.replace(/^www\./, '');
      openLink.href = btn.dataset.ovUrl;
      reload.hidden = false;
    }

    modal.hidden = false;
    document.documentElement.classList.add('ov-lock');
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    modal.querySelector('.ov-red').focus();
  }

  function close() {
    if (modal.hidden) return;
    modal.classList.remove('is-open');
    document.documentElement.classList.remove('ov-lock');
    setTimeout(function () {
      modal.hidden = true;
      clearBody();
    }, 260);
    if (lastFocus) lastFocus.focus();
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      open(btn);
    });
  });

  modal.addEventListener('click', function (e) {
    if (e.target.closest('[data-ov-close]')) close();
    if (e.target.closest('[data-ov-zoom]')) win.classList.toggle('is-zoomed');
  });

  reload.addEventListener('click', function () {
    const f = body.querySelector('iframe');
    if (!f) return;
    body.classList.remove('is-loaded');
    f.src = f.src;
  });

  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    /* keep focus inside the window */
    const items = Array.from(win.querySelectorAll('button:not([hidden]), a[href], iframe, video'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();
