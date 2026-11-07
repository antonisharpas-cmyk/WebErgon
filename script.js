const yearNode = document.getElementById('year');
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

/* Send form data to the API using the same origin (localhost or IP address).
   This works whether you're accessing from the same machine or another PC. */
async function postJson(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (networkError) {
    console.error('Network error:', networkError);
    throw new Error(
      'We could not reach the server, so your message was not sent. ' +
      'Please email us directly at info@ergonsite.com and we will pick it up.'
    );
  }

  /* A static file server — VS Code Live Server, http-server, `python -m
     http.server` — will happily serve the HTML but has no /api/contact
     route, so it rejects the POST with 404/405/501 instead of answering
     with JSON. That is a setup problem, not something the visitor did,
     and the generic message below gives whoever is developing the site
     no clue. Name it in the console. */
  if (response.status === 404 || response.status === 405 || response.status === 501) {
    console.error(
      'POST ' + path + ' returned ' + response.status + '. The enquiry API is ' +
      'not running here. Locally, start it with "cd api && node server.mjs" ' +
      '(port 4000).'
    );
    throw new Error(
      'We could not reach the server, so your message was not sent. ' +
      'Please email us directly at info@ergonsite.com and we will pick it up.'
    );
  }

  const raw = (await response.text()).trim();

  if (!raw) {
    console.error('Empty response from server');
    throw new Error(
      'We could not reach the server, so your message was not sent. ' +
      'Please email us directly at info@ergonsite.com and we will pick it up.'
    );
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (parseError) {
    console.error('Non-JSON response:', raw);
    throw new Error(
      'We could not reach the server, so your message was not sent. ' +
      'Please email us directly at info@ergonsite.com and we will pick it up.'
    );
  }

  if (!response.ok || !data.success) {
    throw new Error(data.message || 'Something went wrong. Please try again.');
  }

  return data;
}

/* =====================================================================
   Measure the flight path for the hero intro: the wordmark travels from
   the centre of the stage to wherever the header mark actually sits, so
   it lands correctly at any viewport size instead of on guessed offsets.
   ===================================================================== */
(function () {
  const intro = document.querySelector('.intro-logo');
  const introImg = intro && intro.querySelector('img');
  const target = document.querySelector('.brand-logo-img');
  if (!intro || !introImg || !target) return;

  function measure() {
    const from = intro.getBoundingClientRect();
    const fromImg = introImg.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    if (!from.width || !fromImg.width || !to.width) return;

    intro.style.setProperty('--fly-x', Math.round(to.left + to.width / 2 - (from.left + from.width / 2)) + 'px');
    intro.style.setProperty('--fly-y', Math.round(to.top + to.height / 2 - (from.top + from.height / 2)) + 'px');
    intro.style.setProperty('--fly-s', (to.width / fromImg.width).toFixed(4));
  }

  measure();
  // the logo is a PNG; if it decodes after first paint the box changes
  if (!introImg.complete) introImg.addEventListener('load', measure, { once: true });
  window.addEventListener('resize', measure);
})();

const revealItems = document.querySelectorAll('.reveal');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.18 }
);

revealItems.forEach((item) => observer.observe(item));

/* =====================================================================
   Enquiry form: validate here for a fast, friendly response, and again
   on the server, which is the copy that actually matters.

   WHERE THE FORM SENDS
   To our own server on Render (api/server.mjs), the same server that
   serves ergonsite.com. It files the enquiry in the team console,
   emails it to info@ergonsite.com and sends the enquirer a
   confirmation from info@ergonsite.com. No third-party form services.
   On localhost the form talks to the API running locally on port 4000
   (cd api && node server.mjs).
   ===================================================================== */
const ERGON_API =
  /(^|\.)ergonsite\.com$/.test(location.hostname) ? ''
  : /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:4000'
  : 'https://ergonsite.com';

const contactForm = document.getElementById('contactForm');
const formMessage = document.getElementById('formMessage');

/* Deliberately stricter than the browser's built-in email check, which
   happily accepts "a@b" — no dot, no TLD. This requires a real domain
   with at least one dot and a two-letter-or-longer alphabetic TLD. */
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/* Catches the handful of slips that account for most undeliverable
   addresses. Better to ask than to lose the enquiry to a bounce. */
const DOMAIN_TYPOS = {
  'gmail.co': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'yahoo.co': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahho.com': 'yahoo.com',
  'outlok.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'outlook.co': 'outlook.com',
  'iclould.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'cytanet.com': 'cytanet.com.cy'
};

function validateEmail(raw) {
  const value = raw.trim();
  if (!value) return 'Please enter your email address.';
  if (value.length > 254) return 'That email address is too long.';

  const at = value.lastIndexOf('@');
  if (at < 1) return 'An email address needs an @ symbol.';
  if (value.slice(0, at).length > 64) return 'The part before the @ is too long.';
  if (!EMAIL_RE.test(value)) {
    return 'That does not look like a complete email address. Check the part after the @.';
  }

  const domain = value.slice(at + 1).toLowerCase();
  if (domain.indexOf('..') !== -1) return 'The domain contains two dots in a row.';
  if (domain.indexOf('.') === -1) return 'The domain needs an ending such as .com or .com.cy.';

  const suggestion = DOMAIN_TYPOS[domain];
  if (suggestion) return 'Did you mean @' + suggestion + '?';

  return '';
}

function validatePhone(raw) {
  const value = raw.trim();
  if (!value) return '';                 // optional
  if (!/^[0-9\s().-]+$/.test(value)) {
    return 'Digits only please, and pick the country code from the list.';
  }
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 6 || digits.length > 14) {
    return 'A phone number should be between 6 and 14 digits.';
  }
  return '';
}

function fieldOf(input) {
  return input.closest('.field');
}

function setError(input, message) {
  const field = fieldOf(input);
  if (!field) return;
  const msg = field.querySelector('.field-msg');
  if (msg) msg.textContent = message || '';
  field.classList.toggle('has-error', Boolean(message));
  input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function checkField(input) {
  const name = input.name;
  const value = input.value;
  let message = '';

  if (name === 'email') {
    message = validateEmail(value);
  } else if (name === 'phone') {
    message = validatePhone(value);
  } else if (input.required && !value.trim()) {
    const label = fieldOf(input) && fieldOf(input).querySelector('.field-label');
    const what = label ? label.textContent.replace(/optional/i, '').trim().toLowerCase() : 'this field';
    message = 'Please fill in your ' + what + '.';
  } else if (name === 'message' && value.trim().length < 10) {
    message = 'Please give us a little more detail (at least 10 characters).';
  }

  setError(input, message);
  return message;
}

if (contactForm) {
  // the multi-select writes to a hidden input, which has no label to
  // flag and cannot take focus, so it is checked separately below
  const fields = Array.from(contactForm.querySelectorAll('input, textarea'))
    .filter((el) => el.type !== 'hidden');

  fields.forEach((input) => {
    // validate on blur, then live once the field is already flagged, so
    // nobody is scolded mid-keystroke
    input.addEventListener('blur', () => checkField(input));
    input.addEventListener('input', () => {
      const field = fieldOf(input);
      if (field && field.classList.contains('has-error')) checkField(input);
    });
  });

  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    let firstInvalid = null;
    fields.forEach((input) => {
      if (checkField(input) && !firstInvalid) firstInvalid = input;
    });

    /* "What do you need?" is a group of checkboxes, so the loop above
       cannot see it — an unanswered one still has to stop the send. */
    const needsInput = contactForm.querySelector('input[name="needs"]');
    if (needsInput && !needsInput.value.trim()) {
      const needsField = needsInput.closest('.field');
      if (needsField) {
        needsField.classList.add('has-error');
        const needsMsg = needsField.querySelector('.field-msg');
        if (needsMsg) needsMsg.textContent = 'Please tell us what you need.';
        if (!firstInvalid) {
          firstInvalid = needsField.querySelector('.multiselect-trigger') ||
            needsField.querySelector('input[type="checkbox"]');
        }
      }
    }

    if (firstInvalid) {
      formMessage.textContent = 'Please correct the highlighted fields.';
      formMessage.classList.add('error');
      firstInvalid.focus();
      return;
    }

    const data = Object.fromEntries(new FormData(contactForm).entries());
    const localNumber = (data.phone || '').trim();
    const dial = data.dialCode === 'other'
      ? (data.dialCodeOther || '').trim()
      : (data.dialCode || '');

    const payload = {
      name: (data.name || '').trim(),
      email: (data.email || '').trim(),
      company: (data.company || '').trim(),
      phone: localNumber ? (dial + ' ' + localNumber).trim() : '',
      needs: (data.needs || '').trim(),
      message: (data.message || '').trim()
    };

    const submitButton = contactForm.querySelector('button[type="submit"]');

    formMessage.textContent = 'Sending...';
    formMessage.classList.remove('error');
    if (submitButton) submitButton.disabled = true;

    try {
      await postJson(ERGON_API + '/api/inquiries', Object.assign({ page: location.pathname }, payload));
      /* Tell Analytics an enquiry happened. generate_lead is GA4's
         standard name for this, so it appears in reports without any
         configuration. window.gtag always exists (consent.js defines
         it), and if the visitor declined analytics the call goes
         nowhere, which is exactly right. */
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'generate_lead', { form: 'contact' });
      }
      formMessage.textContent = 'Thank you, your details were sent. We will be in touch shortly.';
      contactForm.reset();
      fields.forEach((input) => setError(input, ''));
    } catch (error) {
      formMessage.textContent = error.message || 'Failed to send your request.';
      formMessage.classList.add('error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

/* =====================================================================
   Reveal buttons: every button collapses to the same width, but each
   expands only as far as its own detail needs. Measured rather than
   hardcoded, so changing the email or the handle needs no CSS edit.
   ===================================================================== */
(function () {
  const buttons = Array.from(document.querySelectorAll('.reveal-btn'));
  if (!buttons.length) return;

  const group = buttons[0].parentElement;

  function measure() {
    let widest = 0;

    buttons.forEach(function (btn) {
      const swap = btn.querySelector('.rb-swap');
      const value = btn.querySelector('.rb-value');
      if (!swap || !value) return;

      // everything that is not the swapping text: icon, gap, padding, border
      const chrome = btn.getBoundingClientRect().width - swap.getBoundingClientRect().width;
      const needed = Math.ceil(value.scrollWidth + chrome) + 2;
      const collapsed = parseFloat(getComputedStyle(btn).getPropertyValue('--rb-min')) || 186;
      const open = Math.max(needed, collapsed);

      btn.style.setProperty('--rb-open', open + 'px');
      if (open > widest) widest = open;
    });

    // hold the column at the widest button so nothing shifts sideways
    if (group && widest) group.style.width = widest + 'px';
  }

  measure();

  // Manrope loads over the network; text width changes when it lands
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measure);
  }

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (group) group.style.width = '';
      measure();
    }, 150);
  });
})();

/* =====================================================================
   Service cards: the highlight follows the cursor. Only two custom
   properties are written here — the gradient itself lives in the
   stylesheet — and the writes are throttled to one per frame so a fast
   mouse cannot flood style recalculation.
   ===================================================================== */
(function () {
  const cards = document.querySelectorAll('.service-card');
  if (!cards.length) return;
  // touch devices have no hover state to track; the CSS default centres
  // the highlight for them
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;

  cards.forEach(function (card) {
    let frame = null;
    let point = null;

    card.addEventListener('pointermove', function (event) {
      point = event;
      if (frame) return;
      frame = requestAnimationFrame(function () {
        frame = null;
        const box = card.getBoundingClientRect();
        card.style.setProperty('--mx', Math.round(point.clientX - box.left) + 'px');
        card.style.setProperty('--my', Math.round(point.clientY - box.top) + 'px');
      });
    });

    // hand the highlight back to the centred default, so the next hover
    // does not start from wherever the pointer happened to leave
    card.addEventListener('pointerleave', function () {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = null;
      }
      card.style.removeProperty('--mx');
      card.style.removeProperty('--my');
    });
  });
})();

/* =====================================================================
   Clone the client marquee until half the track is wider than the
   viewport, then let CSS shift it by -50%: the second half lands
   exactly where the first began, so the loop is seamless.

   Cloning ONCE is only enough when the logo list is already wider than
   the screen. With three clients it is not, and a single duplicate
   leaves a visible empty gap sweeping past. Deriving the copy count
   from the measured width means the logo list can be any length.
   ===================================================================== */
(function () {
  const track = document.querySelector('.marquee-track');
  if (!track) return;

  const originals = Array.from(track.children);
  if (!originals.length) return;

  function fill() {
    // start from a clean single set so a resize does not keep appending
    track.querySelectorAll('[data-marquee-clone]').forEach((n) => n.remove());

    const setWidth = originals.reduce(
      (total, item) => total + item.getBoundingClientRect().width +
        parseFloat(getComputedStyle(item).marginRight || 0),
      0
    );
    if (!setWidth) return;

    const viewport = track.parentElement.getBoundingClientRect().width;
    // half the track has to cover the viewport, and the track needs an
    // even number of sets for -50% to land on a set boundary
    const copies = Math.max(2, Math.ceil(viewport / setWidth) * 2);

    const batch = document.createDocumentFragment();
    for (let copy = 1; copy < copies; copy += 1) {
      originals.forEach((item) => {
        const clone = item.cloneNode(true);
        clone.setAttribute('data-marquee-clone', '');
        clone.setAttribute('aria-hidden', 'true');
        // keep duplicated logos out of the tab order, otherwise keyboard
        // users hit every client link several times over
        clone.querySelectorAll('a').forEach((link) => {
          link.setAttribute('tabindex', '-1');
        });
        batch.appendChild(clone);
      });
    }
    track.appendChild(batch);
  }

  fill();

  // the chips are a fixed width, so only a viewport change matters
  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fill, 200);
  });
})();

/* =====================================================================
   SERVICE WORKER

   Registered from here rather than an inline <script> because the CSP
   whitelists one specific inline hash; a new inline block would be
   blocked. Failure is non-fatal — the site works fine without it, we
   just lose the install prompt and offline fallback.
   ===================================================================== */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (error) {
      console.warn('Service worker registration failed:', error);
    });
  });
}

/* =====================================================================
   Phone and tablet menu: the bars button opens the page links as a
   full-height sheet under the header.
   ===================================================================== */
(function () {
  const bar = document.querySelector('.topbar');
  const toggle = bar && bar.querySelector('.nav-toggle');
  const nav = bar && bar.querySelector('.main-nav');
  if (!toggle || !nav) return;

  const wide = window.matchMedia('(min-width: 941px)');

  function set(open) {
    bar.classList.toggle('nav-open', open);
    document.documentElement.classList.toggle('nav-lock', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  toggle.addEventListener('click', function () {
    set(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) set(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && bar.classList.contains('nav-open')) {
      set(false);
      toggle.focus();
    }
  });

  (wide.addEventListener ? wide.addEventListener.bind(wide, 'change') : wide.addListener.bind(wide))(function (e) {
    if (e.matches) set(false);
  });
})();
