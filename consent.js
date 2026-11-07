/* Anti-clickjacking. GitHub Pages cannot send an X-Frame-Options or
   frame-ancestors header, so if this page is ever loaded inside an
   <iframe> on another site (the setup for a clickjacking attack), break
   out of the frame — or, if that is blocked, hide the page rather than
   let it be framed invisibly. */
(function () {
  if (window.top !== window.self) {
    try { window.top.location = window.self.location; }
    catch (e) { document.documentElement.style.display = 'none'; }
  }
})();

/* =====================================================================
   Google Analytics 4 + cookie consent.

   Three-way banner (Decline all / Customise / Accept all) plus a
   preferences dialog with per-category control. Two categories exist:
   essential (always on — it is what remembers this very choice) and
   analytics (GA4, off until allowed).

   Consent Mode v2, default DENIED: the Google tag itself loads up
   front so Analytics' "tag detected" check passes and reporting can
   begin the instant someone allows it, but no analytics cookie is
   written while consent is denied. Ad categories are denied
   permanently — we run no advertising.

   The choice is stored in localStorage under CHOICE_KEY. Footer
   "Cookie settings" links (data-cookie-settings) reopen the dialog,
   so withdrawing consent is as easy as giving it.
   ===================================================================== */
(function () {
  var GA_ID = 'G-GFSCB12JCB';
  var CHOICE_KEY = 'ergonsite-consent';

  /* no tracking of ourselves while developing locally */
  var IS_LOCAL = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/
    .test(location.hostname);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  gtag('js', new Date());
  gtag('config', GA_ID);

  if (!IS_LOCAL) {
    var tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(tag);
  }

  function applyChoice(choice) {
    gtag('consent', 'update', {
      analytics_storage: choice === 'accepted' ? 'granted' : 'denied'
    });
  }

  /* consent is stored with a timestamp and expires after 360 days, at
     which point the banner asks again — a consent given once should
     not be treated as given forever */
  var CHOICE_TTL_DAYS = 360;

  function saveChoice(choice) {
    try {
      localStorage.setItem(CHOICE_KEY, JSON.stringify({ v: choice, t: Date.now() }));
    } catch (e) {}
    applyChoice(choice);
  }

  function storedChoice() {
    try {
      var raw = localStorage.getItem(CHOICE_KEY);
      if (!raw) return null;
      /* pre-expiry versions stored a bare string; honour it once but
         let the next save upgrade the format */
      if (raw === 'accepted' || raw === 'declined') return raw;
      var data = JSON.parse(raw);
      if (Date.now() - data.t > CHOICE_TTL_DAYS * 86400000) return null;
      return data.v;
    } catch (e) { return null; }
  }

  function removeUi() {
    var b = document.querySelector('.consent-banner');
    var d = document.querySelector('.consent-overlay');
    if (b) b.remove();
    if (d) d.remove();
  }

  /* ---------------- banner ---------------- */
  function buildBanner() {
    if (document.querySelector('.consent-banner')) return;
    var el = document.createElement('div');
    el.className = 'consent-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Privacy options');
    el.innerHTML =
      '<div class="consent-copy">' +
      '<strong>We care about your privacy.</strong>' +
      '<p>We are using cookies to give you the best experience on our website. ' +
      '<a href="/privacy">Privacy &amp; cookies</a></p></div>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn" data-act="decline">Decline all</button>' +
      '<button type="button" class="consent-btn" data-act="customise">Customise</button>' +
      '<button type="button" class="consent-btn consent-btn-primary" data-act="accept">Accept all</button>' +
      '</div>';
    el.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'accept') { saveChoice('accepted'); removeUi(); }
      if (act === 'decline') { saveChoice('declined'); removeUi(); }
      if (act === 'customise') { buildDialog(); }
    });
    document.body.appendChild(el);
  }

  /* ---------------- preferences dialog ---------------- */
  function buildDialog() {
    if (document.querySelector('.consent-overlay')) return;
    var analyticsOn = storedChoice() === 'accepted';
    var ov = document.createElement('div');
    ov.className = 'consent-overlay';
    ov.innerHTML =
      '<div class="consent-dialog" role="dialog" aria-modal="true" aria-label="Cookie preferences">' +
      /* the four corner nodes of the constellation frame; the connecting
         lines are the dialog's own animated gradient border */
      '<span class="cf-node cf-tl" aria-hidden="true"></span>' +
      '<span class="cf-node cf-tr" aria-hidden="true"></span>' +
      '<span class="cf-node cf-bl" aria-hidden="true"></span>' +
      '<span class="cf-node cf-br" aria-hidden="true"></span>' +
      '<h2>Cookie preferences</h2>' +
      '<p class="consent-intro">Pick what this site is allowed to remember. Essential ' +
      'cookies cannot be switched off, because one of them stores the choice you make ' +
      'here. You can change your mind anytime via &ldquo;Cookie settings&rdquo; in the footer.</p>' +

      /* The categories sit on the same rail-and-nodes system as the
         process timeline: a track down the left, one glowing node per
         category. The essential node is always lit; the analytics node
         lights up with its toggle (via :has), so the graphic itself
         shows what is on. */
      '<div class="consent-flow">' +
      '<span class="consent-rail" aria-hidden="true"></span>' +

      '<div class="consent-item is-on">' +
      '<span class="cat-node" aria-hidden="true"></span>' +
      '<div class="consent-cat-head"><h3>Essential</h3>' +
      '<span class="consent-lock">Always on</span></div>' +
      '<p>Remembers your consent choice and keeps core features like the contact form working.</p>' +
      '</div>' +

      '<div class="consent-item consent-item-optional">' +
      '<span class="cat-node" aria-hidden="true"></span>' +
      '<div class="consent-cat-head"><h3>Analytics</h3>' +
      '<label class="consent-toggle"><input type="checkbox" id="consentAnalytics"' +
      (analyticsOn ? ' checked' : '') + '><span class="consent-slider" aria-hidden="true"></span>' +
      '<span class="sr-only">Allow analytics cookies</span></label></div>' +
      '<p>These cookies help us understand how you use our website and improve your experience.</p>' +
      '</div>' +
      '</div>' +

      '<p class="consent-more"><a href="/privacy">Read the full privacy &amp; cookies policy</a></p>' +

      '<div class="consent-actions consent-dialog-actions">' +
      '<button type="button" class="consent-btn" data-act="cancel">Cancel</button>' +
      '<button type="button" class="consent-btn" data-act="save">Save my choices</button>' +
      '<button type="button" class="consent-btn consent-btn-primary" data-act="accept">Accept all</button>' +
      '</div></div>';

    ov.addEventListener('click', function (ev) {
      if (ev.target === ov) { ov.remove(); return; }   // click outside closes
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'cancel') { ov.remove(); return; }
      if (act === 'accept') { saveChoice('accepted'); removeUi(); return; }
      if (act === 'save') {
        var on = ov.querySelector('#consentAnalytics').checked;
        saveChoice(on ? 'accepted' : 'declined');
        removeUi();
      }
    });
    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') { ov.remove(); document.removeEventListener('keydown', esc); }
    });
    document.body.appendChild(ov);
  }

  window.showCookieBanner = buildDialog;   // settings links open the dialog directly

  function init() {
    var choice = storedChoice();
    if (choice === 'accepted' || choice === 'declined') {
      applyChoice(choice);
    } else {
      buildBanner();
    }
    document.querySelectorAll('[data-cookie-settings]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        buildDialog();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
