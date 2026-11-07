/* =====================================================================
   Case study screens: a sideways slider.

   The track is a plain horizontal scroll-snap list, so it already
   swipes on phones and scrolls with a trackpad before this runs. This
   adds the tabs, the arrows, keyboard support and a calm auto play that
   moves one screen every few seconds, but only while the slider is on
   screen and nobody is touching it. People who ask for reduced motion
   get no auto play, and the tour video is paused for them too.
   ===================================================================== */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduce) {
    document.querySelectorAll('.shot-video').forEach((v) => {
      v.removeAttribute('autoplay');
      v.pause();
      v.setAttribute('controls', '');
    });
  }

  const root = document.querySelector('[data-case-slider]');
  if (!root) return;

  const track = root.querySelector('.case-track');
  const slides = Array.from(root.querySelectorAll('.case-slide'));
  const tabs = Array.from(root.querySelectorAll('.case-tab'));
  const prev = root.querySelector('.case-prev');
  const next = root.querySelector('.case-next');
  const bar = root.querySelector('.case-progress span');
  if (!track || !slides.length) return;

  root.classList.add('is-enhanced');

  const DELAY = 6000;
  let index = 0;
  let timer = null;
  let visible = false;
  let held = false;

  function setActive(i) {
    index = i;
    tabs.forEach((t, n) => {
      const on = n === i;
      t.classList.toggle('is-active', on);
      if (on) t.setAttribute('aria-current', 'true');
      else t.removeAttribute('aria-current');
    });
    slides.forEach((s, n) => s.classList.toggle('is-active', n === i));
    // keep the active tab in view on phones, where the tabs scroll
    const tab = tabs[i];
    if (tab && tab.parentElement.scrollWidth > tab.parentElement.clientWidth) {
      tab.parentElement.scrollTo({
        left: tab.offsetLeft - tab.parentElement.clientWidth / 2 + tab.clientWidth / 2,
        behavior: reduce ? 'auto' : 'smooth',
      });
    }
  }

  function go(i) {
    const n = (i + slides.length) % slides.length;
    track.scrollTo({ left: slides[n].offsetLeft - track.offsetLeft, behavior: reduce ? 'auto' : 'smooth' });
    setActive(n);
    restart();
  }

  function stop() {
    window.clearTimeout(timer);
    timer = null;
    if (bar) {
      bar.style.transition = 'none';
      bar.style.width = '0%';
    }
  }

  function restart() {
    stop();
    if (reduce || !visible || held) return;
    if (bar) {
      // force a reflow so the bar starts again from empty
      void bar.offsetWidth;
      bar.style.transition = 'width ' + DELAY + 'ms linear';
      bar.style.width = '100%';
    }
    timer = window.setTimeout(() => go(index + 1), DELAY);
  }

  tabs.forEach((t, n) => t.addEventListener('click', () => go(n)));
  if (prev) prev.addEventListener('click', () => go(index - 1));
  if (next) next.addEventListener('click', () => go(index + 1));

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  });

  // a swipe or trackpad scroll changes the slide too
  let settle = null;
  track.addEventListener('scroll', () => {
    window.clearTimeout(settle);
    settle = window.setTimeout(() => {
      const left = track.scrollLeft;
      let best = 0;
      slides.forEach((s, n) => {
        if (Math.abs(s.offsetLeft - track.offsetLeft - left) < Math.abs(slides[best].offsetLeft - track.offsetLeft - left)) best = n;
      });
      if (best !== index) { setActive(best); restart(); }
    }, 120);
  }, { passive: true });

  // hold still while someone is looking closely
  root.addEventListener('mouseenter', () => { held = true; stop(); });
  root.addEventListener('mouseleave', () => { held = false; restart(); });
  root.addEventListener('focusin', () => { held = true; stop(); });
  root.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!root.contains(document.activeElement)) { held = false; restart(); }
    }, 0);
  });
  track.addEventListener('touchstart', () => { held = true; stop(); }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) restart(); else stop();
    }, { threshold: 0.35 }).observe(root);
  }

  setActive(0);
})();
