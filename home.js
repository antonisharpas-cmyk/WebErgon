/* =====================================================================
   Homepage: project carousel arrows, the landing video, and the
   scrolling Google reviews.
   ===================================================================== */
(function () {
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- project carousel ---------- */
  const track = document.querySelector('.hm-track');
  const arrows = document.querySelectorAll('.hm-carousel .hm-arrow');

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

  /* ---------- reviews ----------
     The real list is the cards in the HTML. */
  const rvTrack = document.querySelector('.rv-track');

  /* Long reviews show their first lines and a "Read more" button, so one
     card never towers over the rest. Runs before the cards are copied, so
     the copies carry the button too; one listener serves them all. */
  if (rvTrack) {
    rvTrack.querySelectorAll('.rv-card').forEach(function (card) {
      const quote = card.querySelector('blockquote');
      if (!quote || quote.scrollHeight < 240) return;
      card.classList.add('is-long');
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'rv-more';
      more.textContent = 'Read more';
      more.setAttribute('aria-expanded', 'false');
      card.appendChild(more);
    });
    rvTrack.addEventListener('click', function (e) {
      const more = e.target.closest('.rv-more');
      if (!more) return;
      const card = more.closest('.rv-card');
      const open = card.classList.toggle('is-open');
      more.textContent = open ? 'Show less' : 'Read more';
      more.setAttribute('aria-expanded', String(open));
    });
  }

  /* The row drifts slowly to the left on its own. The arrows move it one
     review at a time, and a finger, trackpad or wheel can scroll it too.
     The drift waits while someone is scrolling, using the keyboard in the
     row, or reading an opened review; hovering does not stop it.
     To loop with no visible jump, the cards are repeated until one lap is
     wider than the screen and that lap is doubled; past the halfway point
     the row steps back by exactly one lap. Copies are hidden from screen
     readers. People who ask for less motion get no drift and no copies. */
  const rvRow = document.querySelector('.rv-marquee');
  if (rvTrack && rvRow) {
    const SPEED = 40;                         // px per second
    const originals = Array.from(rvTrack.children);
    const box = document.querySelector('.hm-reviews .container');
    let half = 0;                             // one lap, 0 when not looping
    let pos = 0;
    let move = null;                          // arrow move in progress
    let holdUntil = 0;
    let last = 0;

    function build() {
      rvTrack.querySelectorAll('[data-rv-clone]').forEach(function (n) { n.remove(); });
      half = 0;
      if (REDUCED) return;
      const lap = rvTrack.scrollWidth;
      if (!lap) return;
      const laps = Math.max(1, Math.ceil(rvRow.clientWidth / lap));

      function addSet() {
        originals.forEach(function (card) {
          const c = card.cloneNode(true);
          c.setAttribute('data-rv-clone', '');
          c.setAttribute('aria-hidden', 'true');
          c.querySelectorAll('button').forEach(function (btn) { btn.tabIndex = -1; });
          rvTrack.appendChild(c);
        });
      }

      for (let i = 1; i < laps; i++) addSet();      // first half
      for (let i = 0; i < laps; i++) addSet();      // second half
      half = rvTrack.scrollWidth / 2;
      pos = pos % half;
    }

    function cardStep() {
      const card = rvTrack.querySelector('.rv-card');
      return card.getBoundingClientRect().width + (parseFloat(getComputedStyle(card).marginRight) || 0);
    }

    // where the page's content column starts inside the row, so an arrow
    // stop lines a card up with the heading above it
    function inset() {
      if (!box) return 0;
      return box.getBoundingClientRect().left + (parseFloat(getComputedStyle(box).paddingLeft) || 0)
        - rvRow.getBoundingClientRect().left;
    }

    function shift(by) {
      pos += by;
      if (move) { move.from += by; move.to += by; }
    }

    function keepInRange() {
      if (half) {
        while (pos >= half) shift(-half);
        while (pos < 0) shift(half);
      } else {
        pos = Math.max(0, Math.min(pos, rvRow.scrollWidth - rvRow.clientWidth));
      }
    }

    function show() { rvRow.scrollLeft = pos; }

    function waiting(now) {
      return now < holdUntil || document.hidden ||
        rvTrack.querySelector('.rv-card.is-open') || rvRow.querySelector(':focus-visible');
    }

    function frame(now) {
      const dt = last ? Math.min(now - last, 100) : 0;
      last = now;
      if (move) {
        const t = move.ms ? Math.min(1, (now - move.start) / move.ms) : 1;
        const e = 1 - Math.pow(1 - t, 3);
        pos = move.from + (move.to - move.from) * e;
        if (t === 1) move = null;
        keepInRange();
        show();
      } else if (half && !waiting(now)) {
        pos += SPEED * dt / 1000;
        keepInRange();
        show();
      }
      requestAnimationFrame(frame);
    }

    document.querySelectorAll('[data-rv]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const dir = Number(btn.dataset.rv);
        const step = cardStep();
        const off = inset();
        const from = move ? move.to : pos;            // quick clicks add up
        const k = dir > 0 ? Math.floor((from + off) / step + 0.02) + 1
                          : Math.ceil((from + off) / step - 0.02) - 1;
        move = { from: pos, to: k * step - off, start: performance.now(), ms: REDUCED ? 0 : 550 };
        holdUntil = performance.now() + 4000;
      });
    });

    // the visitor scrolled the row themselves (touch, trackpad, wheel)
    rvRow.addEventListener('scroll', function () {
      if (Math.abs(rvRow.scrollLeft - pos) <= 2) return;   // our own move
      pos = rvRow.scrollLeft;
      move = null;
      holdUntil = performance.now() + 2500;
      if (half && (pos <= 0 || pos >= half)) {
        pos = pos <= 0 ? half : pos - half;                // same picture, one lap over
        show();
      }
    }, { passive: true });
    ['pointerdown', 'touchstart', 'wheel'].forEach(function (type) {
      rvRow.addEventListener(type, function () { holdUntil = performance.now() + 2500; }, { passive: true });
    });

    let width = window.innerWidth;
    build();
    show();
    requestAnimationFrame(frame);
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - width) < 40) return;
      width = window.innerWidth;
      build();
      show();
    });
  }
})();
