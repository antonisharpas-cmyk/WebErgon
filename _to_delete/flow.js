/* =====================================================================
   Flow field.

   Particles drift along a slowly-turning vector field and leave fading
   trails, which reads as ribbons of light moving through the section.

   The trails come from erasing the canvas a few percent per frame with
   destination-out compositing, rather than clearing it. That keeps the
   canvas transparent, so the page's own gradient still shows through —
   painting a translucent background colour instead would flatten it.

   Purely decorative: aria-hidden, and reduced motion gets one still
   frame of static strands.
   ===================================================================== */
(function () {
  const canvas = document.querySelector('.flow-canvas');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PI = Math.PI;

  // brand ramp: deep blue through periwinkle to teal
  const COLOURS = [
    '86, 108, 235',
    '125, 140, 255',
    '150, 168, 255',
    '108, 226, 209',
    '138, 232, 219',
  ];

  /* Strokes are batched: one path per (colour, width, alpha) bucket
     instead of one stroke() call per particle. Quantising alpha to a
     handful of steps is invisible on trails this soft and cuts the
     per-frame draw calls by roughly two thirds. */
  const WIDTHS = [0.7, 1.2, 1.8];
  const ALPHA_STEPS = 6;

  const STROKE = [];
  for (let c = 0; c < COLOURS.length; c++) {
    for (let a = 0; a < ALPHA_STEPS; a++) {
      STROKE.push('rgba(' + COLOURS[c] + ',' + (((a + 1) / ALPHA_STEPS) * 0.55).toFixed(3) + ')');
    }
  }

  let w = 0;
  let h = 0;
  let particles = [];
  let visible = true;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  /* A cheap smooth field. Three sine terms at different scales give
     something noise-like without the cost of real Perlin noise.

     The result is biased around BASE rather than allowed to sweep the
     full circle — unconstrained, particles fall into tight orbits and
     the field reads as scribble instead of drifting current. */
  const BASE = -0.3 * PI;               // general drift: up and to the right

  function angleAt(x, y, t) {
    const a =
      Math.sin(x * 0.0013 + t * 0.1) +
      0.75 * Math.sin(y * 0.0019 - t * 0.08) +
      0.4 * Math.sin((x + y) * 0.0009 + t * 0.13);
    return BASE + a * 0.44;
  }

  function seed(p) {
    p.x = rand(-0.05, 1.05) * w;
    p.y = rand(-0.05, 1.05) * h;
    p.life = 0;
    p.span = rand(6, 15);
    p.speed = rand(26, 62);
    p.wi = (Math.random() * WIDTHS.length) | 0;
    p.ci = (Math.random() * COLOURS.length) | 0;
    p.alpha = rand(0.3, 1);            // scaled by 0.55 in the stroke table
    return p;
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    // trails are soft, so a lower ratio costs nothing visually and
    // keeps the full-canvas erase per frame cheap
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';

    const count = Math.max(60, Math.min(190, Math.round((w * h) / 8000)));
    particles = [];
    for (let i = 0; i < count; i++) {
      const p = seed({});
      p.life = Math.random() * p.span;   // stagger, so nothing respawns in unison
      particles.push(p);
    }
    return true;
  }

  /* The full-canvas erase is the single most expensive thing here, so
     it runs on alternate frames at double strength. Identical to the
     eye, roughly half the fill cost. */
  let eraseFrame = 0;

  function step(t, dt) {
    if ((eraseFrame++ & 1) === 0) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.085)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    const paths = [];

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const ang = angleAt(p.x, p.y, t);
      const nx = p.x + Math.cos(ang) * p.speed * dt;
      const ny = p.y + Math.sin(ang) * p.speed * dt;

      p.life += dt;

      // fade in and out across the particle's life so nothing pops
      const k = p.life / p.span;
      const fade = k < 0.15 ? k / 0.15 : k > 0.8 ? (1 - k) / 0.2 : 1;

      let ai = ((p.alpha * fade) * ALPHA_STEPS) | 0;
      if (ai >= ALPHA_STEPS) ai = ALPHA_STEPS - 1;

      if (ai >= 0) {
        const key = (p.ci * ALPHA_STEPS + ai) * WIDTHS.length + p.wi;
        let path = paths[key];
        if (!path) path = paths[key] = new Path2D();
        path.moveTo(p.x, p.y);
        path.lineTo(nx, ny);
      }

      p.x = nx;
      p.y = ny;

      if (
        p.life >= p.span ||
        p.x < -0.1 * w || p.x > 1.1 * w ||
        p.y < -0.1 * h || p.y > 1.1 * h
      ) {
        seed(p);
      }
    }

    for (let key = 0; key < paths.length; key++) {
      const path = paths[key];
      if (!path) continue;
      ctx.strokeStyle = STROKE[(key / WIDTHS.length) | 0];
      ctx.lineWidth = WIDTHS[key % WIDTHS.length];
      ctx.stroke(path);
    }
  }

  if (!build()) return;

  if (REDUCED) {
    // draw a few seconds of the field once, then stop
    for (let i = 0; i < 260; i++) step(i * 0.05, 0.05);
    return;
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) { visible = e.isIntersecting; });
      },
      { rootMargin: '80px' }
    ).observe(canvas);
  }

  let start = null;
  let last = 0;

  function tick(now) {
    if (start === null) start = now;
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;
    if (visible && dt > 0) step(t, dt);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  });
})();
