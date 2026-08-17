const yearNode = document.getElementById('year');
if (yearNode) {
  yearNode.textContent = new Date().getFullYear();
}

const API_BASE = (window.location.protocol === 'http:' || window.location.protocol === 'https:') && window.location.host
  ? ''
  : 'http://localhost:3000';

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

    formMessage.textContent = 'Sending...';
    formMessage.classList.remove('error');

    try {
      const response = await fetch(`${API_BASE}/api/contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Something went wrong.');
      }

      formMessage.textContent = 'Your details were sent successfully.';
      contactForm.reset();
    } catch (error) {
      formMessage.textContent = error.message || 'Failed to send your request.';
      formMessage.classList.add('error');
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
