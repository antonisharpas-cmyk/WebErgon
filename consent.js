/* =====================================================================
   Google Analytics 4 + cookie consent, in one place.

   Consent Mode v2, default DENIED: the Google tag loads immediately
   (so Analytics' own "tag detected" check passes and reporting starts
   the moment someone accepts), but every storage category starts
   denied and no analytics cookie is written until the visitor accepts
   the banner. Decline is remembered and respected. Ad categories stay
   denied permanently — we run no advertising.

   The choice is stored in localStorage under COOKIE_CHOICE_KEY.
   "Cookie settings" in the footer calls window.showCookieBanner() to
   let a visitor change their mind later — required for the consent to
   be as easy to withdraw as it was to give.
   ===================================================================== */
(function () {
  var GA_ID = 'G-GFSCB12JCB';
  var COOKIE_CHOICE_KEY = 'ergonsite-consent';

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
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function applyChoice(choice) {
    if (choice === 'accepted') {
      gtag('consent', 'update', { analytics_storage: 'granted' });
    }
  }

  function saveChoice(choice) {
    try { localStorage.setItem(COOKIE_CHOICE_KEY, choice); } catch (e) {}
    applyChoice(choice);
  }

  function storedChoice() {
    try { return localStorage.getItem(COOKIE_CHOICE_KEY); } catch (e) { return null; }
  }

  function buildBanner() {
    var el = document.createElement('div');
    el.className = 'consent-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Cookie consent');
    el.innerHTML =
      '<p>We use Google Analytics to understand how this site is used. ' +
      'It sets cookies only if you accept. ' +
      '<a href="/privacy">Privacy policy</a></p>' +
      '<div class="consent-actions">' +
      '<button type="button" class="consent-btn consent-accept">Accept</button>' +
      '<button type="button" class="consent-btn consent-decline">Decline</button>' +
      '</div>';
    el.querySelector('.consent-accept').addEventListener('click', function () {
      saveChoice('accepted'); el.remove();
    });
    el.querySelector('.consent-decline').addEventListener('click', function () {
      saveChoice('declined'); el.remove();
    });
    document.body.appendChild(el);
  }

  window.showCookieBanner = function () {
    if (!document.querySelector('.consent-banner')) buildBanner();
  };

  function init() {
    var choice = storedChoice();
    if (choice === 'accepted' || choice === 'declined') {
      applyChoice(choice);
    } else {
      buildBanner();
    }
    /* footer "Cookie settings" links reopen the banner */
    document.querySelectorAll('[data-cookie-settings]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        window.showCookieBanner();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
