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
      'POST ' + path + ' returned ' + response.status + '. This page is being ' +
      'served by a static file server with no API. Start the backend with ' +
      '"node server.js" and open the site on the port it prints (3000 by ' +
      'default) — the form posts to whatever origin the page came from.'
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

   WHERE THE FORM SENDS, AND WHY THERE ARE TWO PATHS
   The live site is on GitHub Pages, which serves files and can run
   nothing — no /api/contact, no Node. In production the form therefore
   posts to Web3Forms, a form-to-email relay, which delivers each
   enquiry to the inbox tied to the access key. On localhost or a LAN
   address the local Node backend exists, so the form keeps posting to
   /api/contact and the admin page keeps working.

   ONE-TIME SETUP: get a free access key at https://web3forms.com
   (enter info@ergonsite.com, the key arrives by email) and paste it
   below. The key only routes messages to your inbox — it is designed
   to be public, so shipping it in this file is fine.
   ===================================================================== */
const WEB3FORMS_ACCESS_KEY = '7e7508ef-0f1c-4bd0-bdd0-41e032e92a44';

/* =====================================================================
   AUTO-CONFIRMATION TO THE ENQUIRER

   Sent through EmailJS, because it is the one free way to send from
   the real info@ergonsite.com mailbox with no backend: Web3Forms can
   only deliver TO us, and its auto-responder sends from web3forms.com,
   which is not our address.

   ONE-TIME SETUP at https://www.emailjs.com (sign up with
   info@ergonsite.com):
     1. Email Services -> Add New Service -> connect the
        info@ergonsite.com mailbox. Copy the Service ID.
     2. Email Templates -> Create New Template. Set "To Email" to
        {{email}}, "From Name" to ErgonSite, subject and body per the
        template text in NOTES.md. Copy the Template ID.
     3. Account -> General -> copy the Public Key.
   Paste the three values below. All three are safe to publish — the
   public key only lets pages send using YOUR templates to YOUR
   configured service, nothing else.

   The confirmation is fired after the enquiry itself has been
   delivered, and a failure here is logged but never shown: the
   enquiry got through, and that is the thing that matters.
   ===================================================================== */
const EMAILJS_SERVICE_ID = 'service_p6u9u5p';
const EMAILJS_TEMPLATE_ID = 'template_zuejzg6';
const EMAILJS_PUBLIC_KEY = 'd7VGpw1g1OJcwk6so';

async function sendConfirmationEmail(payload) {
  if (EMAILJS_SERVICE_ID.indexOf('PASTE-') === 0) {
    console.warn('EmailJS not configured yet — no confirmation email sent to the enquirer.');
    return;
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE_ID,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          name: payload.name,
          email: payload.email,
          company: payload.company,
          message: payload.message
        }
      })
    });
    if (!response.ok) {
      console.error('Confirmation email failed:', await response.text());
    }
  } catch (error) {
    console.error('Confirmation email failed:', error);
  }
}

const IS_LOCAL_BACKEND =
  location.protocol !== 'https:' &&
  (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ||
   /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(location.hostname));

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
      if (IS_LOCAL_BACKEND) {
        await postJson('/api/contact', payload);
      } else {
        if (WEB3FORMS_ACCESS_KEY.indexOf('PASTE-YOUR') === 0) {
          console.error(
            'The enquiry form has no Web3Forms access key yet. Get one free at ' +
            'https://web3forms.com and paste it into WEB3FORMS_ACCESS_KEY in script.js.'
          );
          throw new Error(
            'The form is not connected yet. Please email us directly at ' +
            'info@ergonsite.com and we will pick it up.'
          );
        }
        /* The subject carries the enquirer's name (and company) so each
           enquiry has a distinct subject line. With a fixed subject the
           inbox threads every notification into one long conversation,
           which buries new enquiries under old ones. Two messages from
           the same person will still thread together — that one is a
           feature. */
        await postJson('https://api.web3forms.com/submit', {
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: 'Enquiry from ' + payload.name +
            (payload.company ? ' (' + payload.company + ')' : '') +
            ' — ergonsite.com',
          from_name: payload.name,
          name: payload.name,
          email: payload.email,
          company: payload.company,
          phone: payload.phone,
          message: payload.message
        });

        // fire-and-forget on purpose: the enquiry is already delivered,
        // so a hiccup here must not turn the thank-you into an error
        sendConfirmationEmail(payload);

        /* Tell Analytics an enquiry happened. generate_lead is GA4's
           standard name for this, so it appears in reports without any
           configuration. window.gtag always exists (consent.js defines
           it), and if the visitor declined analytics the call goes
           nowhere, which is exactly right. */
        if (typeof window.gtag === 'function') {
          window.gtag('event', 'generate_lead', { form: 'contact' });
        }
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
