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

  const host = window.location.hostname || 'localhost';
  const fallback = 'http://' + host + ':3000';
  if (window.location.origin !== fallback) {
    bases.push(fallback);
  }

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

  console.error('Contact API unreachable.', lastError);
  throw new Error(
    'Could not reach the server. Open the site through the Node backend ' +
    '(run "node server.js", then visit the address it prints) rather than a ' +
    'static preview server.'
  );
}

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

const contactForm = document.getElementById('contactForm');
const formMessage = document.getElementById('formMessage');

if (contactForm) {
  contactForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(contactForm);
    const payload = Object.fromEntries(formData.entries());

    const submitButton = contactForm.querySelector('button[type="submit"]');

    formMessage.textContent = 'Sending...';
    formMessage.classList.remove('error');
    if (submitButton) submitButton.disabled = true;

    try {
      await postJson('/api/contact', payload);
      formMessage.textContent = 'Thank you — your details were sent. We will be in touch shortly.';
      contactForm.reset();
    } catch (error) {
      formMessage.textContent = error.message || 'Failed to send your request.';
      formMessage.classList.add('error');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

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
