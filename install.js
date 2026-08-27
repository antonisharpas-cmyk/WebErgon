/* =====================================================================
   Shows the right instructions for whatever scanned the QR code.

   Android Chrome can genuinely install on a button press, so we catch
   beforeinstallprompt and offer one. iOS cannot: Safari has no install
   API at all, and the only route is the Share menu — so there we show
   the three taps rather than a button that could not work.
   ===================================================================== */
(function () {
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);

  var btn = document.getElementById('installBtn');
  var note = document.getElementById('note');
  var lede = document.getElementById('lede');
  var doneMsg = document.getElementById('doneMsg');

  function show(id) { document.getElementById(id).style.display = 'block'; }

  /* Already opened from the home screen — nothing left to do. */
  var standalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (standalone) {
    lede.textContent = 'You are already running the installed version.';
    note.textContent = '';
    return;
  }

  var deferred = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    document.getElementById('androidSteps').style.display = 'none';
    document.getElementById('desktopSteps').style.display = 'none';
    btn.style.display = 'block';
    note.textContent = 'Takes a couple of seconds. Nothing is downloaded from an app store.';
  });

  btn.addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function (choice) {
      if (choice.outcome === 'accepted') {
        btn.style.display = 'none';
        doneMsg.style.display = 'block';
        note.textContent = '';
      }
      deferred = null;
    });
  });

  window.addEventListener('appinstalled', function () {
    btn.style.display = 'none';
    doneMsg.style.display = 'block';
    note.textContent = '';
  });

  /* Fallback instructions, shown until (and unless) the prompt arrives. */
  if (isIOS) {
    show('iosSteps');
    note.textContent = 'iPhone and iPad have no one-tap install — Safari only offers it through the Share menu. Make sure you are in Safari, not Chrome or an in-app browser.';
  } else if (isAndroid) {
    show('androidSteps');
    note.textContent = 'If an Install button appears above, use that instead.';
  } else {
    show('desktopSteps');
    note.textContent = 'Works in Chrome and Edge. Safari on Mac uses File → Add to Dock.';
  }
})();
