/* =====================================================================
   Homepage: project carousel arrows, and the hero tour video.
   ===================================================================== */
(function () {
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

  /* People who ask for less motion get the poster frame, not a
     looping screen recording. */
  const video = document.querySelector('.hm-video');
  if (video && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.removeAttribute('autoplay');
    video.pause();
  }
})();
