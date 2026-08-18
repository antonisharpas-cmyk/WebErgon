const yearNode = document.getElementById('year');
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

/* The enquiry form talks to server.js. If the pages are being served by
   something else (VS Code Live Server, Live Preview, python -m http.server),
   that static server has no /api/contact route and returns an empty body,
   which is what produced "Unexpected end of JSON input". So: try the
   current origin first, then fall back to the Node server on port 3000. */
const API_BASES = (function () {
  const bases = [];
  const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';

  if (isHttp && window.location.host) {
    bases.push('');
  }

  // server.js walks 3000 -> 3003 when a port is busy, so try them all
  const host = window.location.hostname || 'localhost';
  [3000, 3001, 3002, 3003].forEach(function (port) {
    const base = 'http://' + host + ':' + port;
    if (window.location.origin !== base) bases.push(base);
  });

  return bases;
})();

async function postJson(path, payload) {
  let lastError = null;

  for (const base of API_BASES) {
    let response;
    try {
      response = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (networkError) {
      lastError = networkError;
      continue;                       // host unreachable — try the next base
    }

    const raw = (await response.text()).trim();

    if (!raw) {
      // reached a server, but not one that speaks our API
      lastError = new Error('empty response from ' + (base || 'this origin'));
      continue;
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (parseError) {
      lastError = new Error('non-JSON response from ' + (base || 'this origin'));
      continue;
    }

    if (!response.ok || !data.success) {
      throw new Error(data.message || 'Something went wrong. Please try again.');
    }

    return data;
  }

  console.error('Contact API unreachable. Last error:', lastError);
  throw new Error(
    'We could not reach the server, so your message was not sent. ' +
    'Please email us directly at info@ergonsite.com and we will pick it up.'
  );
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
   ===================================================================== */
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
    return 'That does not look like a complete email address — check the part after the @.';
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
    return 'Digits only please — pick the country code from the list.';
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
  const fields = Array.from(contactForm.querySelectorAll('input, textarea'));

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
      message: (data.message || '').trim()
    };

    const submitButton = contactForm.querySelector('button[type="submit"]');

    formMessage.textContent = 'Sending...';
    formMessage.classList.remove('error');
    if (submitButton) submitButton.disabled = true;

    try {
      await postJson('/api/contact', payload);
      formMessage.textContent = 'Thank you — your details were sent. We will be in touch shortly.';
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

/* Clone the client marquee once so the -50% scroll loops seamlessly.
   Doing it here rather than in the HTML means the logo list only has to
   be maintained in one place. */
const marqueeTrack = document.querySelector('.marquee-track');

if (marqueeTrack) {
  const originals = Array.from(marqueeTrack.children);

  originals.forEach((item) => {
    const clone = item.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    // Keep the duplicated logos out of the tab order, otherwise keyboard
    // users hit every client link twice.
    clone.querySelectorAll('a').forEach((link) => {
      link.setAttribute('tabindex', '-1');
    });
    marqueeTrack.appendChild(clone);
  });
}
