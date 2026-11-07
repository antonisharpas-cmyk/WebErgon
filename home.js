/* =====================================================================
   Homepage: project carousel arrows, the landing video, and the
   scrolling Google reviews.
   ===================================================================== */
(function () {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- project carousel ---------- */
  const track = document.querySelector('.hm-track');
  const arrows = document.querySelectorAll('.hm-arrow');

  if (track && arrows.length) {
    function step() {
      const tile = track.querySelector('.hm-tile');
      if (!tile) return track.clientWidth * 0.8;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 20;
      return tile.getBoundingClientRect().width + gap;
    }

    function update() {
      const max = track.scrollWidth - track.clientWidth - 2;
      arrows.forEach(function (btn) {
        const dir = Number(btn.dataset.scroll);
        btn.disabled = dir < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= max;
      });
    }

    arrows.forEach(function (btn) {
      btn.addEventListener('click', function () {
        track.scrollBy({ left: Number(btn.dataset.scroll) * step(), behavior: 'smooth' });
      });
    });

    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- landing video ----------
     People who ask for less motion get the still poster frame. */
  const landing = document.querySelector('.hm-landing-video');
  if (landing && REDUCED) {
    landing.removeAttribute('autoplay');
    landing.pause();
  }

  /* ---------- reviews marquee ----------
     The cards in the HTML are the real list. Here they are repeated
     until one lap is wider than the screen, then the lap is doubled so
     the CSS animation can slide exactly half the track and loop with
     no visible jump. Copies are hidden from screen readers. */
  const rvTrack = document.querySelector('.rv-track');
  if (rvTrack && !REDUCED) {
    const originals = Array.from(rvTrack.children);

    function build() {
      rvTrack.querySelectorAll('[data-rv-clone]').forEach(function (n) { n.remove(); });
      rvTrack.classList.remove('is-running');

      const lap = rvTrack.scrollWidth;
      if (!lap) return;
      const laps = Math.max(1, Math.ceil(window.innerWidth / lap));

      function addSet() {
        originals.forEach(function (card) {
          const c = card.cloneNode(true);
          c.setAttribute('data-rv-clone', '');
          c.setAttribute('aria-hidden', 'true');
          rvTrack.appendChild(c);
        });
      }

      for (let i = 1; i < laps; i++) addSet();      // first half
      for (let i = 0; i < laps; i++) addSet();      // second half

      const half = rvTrack.scrollWidth / 2;
      rvTrack.style.setProperty('--rv-duration', Math.round(half / 40) + 's');
      rvTrack.classList.add('is-running');
    }

    let width = window.innerWidth;
    build();
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - width) < 40) return;
      width = window.innerWidth;
      build();
    });
  }
})();
