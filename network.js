/* =====================================================================
   Connection network — the team page background.

   Nodes drift slowly and draw a line to any neighbour within range,
   fading with distance. The metaphor is deliberate: people, and the
   links between them, forming and reforming.

   Kept sparse on purpose. A dense mesh reads as a stock "tech" graphic;
   a loose one reads as a constellation of people.
   ===================================================================== */
(function () {
  const canvas = document.querySelector('.network-canvas');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  const LINK_STEPS = 7;                 // alpha buckets for batching links
  const LINK_RGB = '132, 158, 235';
  const LINK_STROKE = [];
  for (let i = 0; i < LINK_STEPS; i++) {
    LINK_STROKE.push('rgba(' + LINK_RGB + ',' + (((i + 1) / LINK_STEPS) * 0.22).toFixed(3) + ')');
  }

  let w = 0;
  let h = 0;
  let nodes = [];
  let range = 170;
  let visible = true;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // link range scales with the canvas so density feels the same at
    // any width, rather than turning into a solid web on large screens
    range = Math.max(110, Math.min(168, Math.sqrt(w * h) / 6.4));

    const count = Math.max(26, Math.min(60, Math.round((w * h) / 21000)));
    nodes = [];
    for (let i = 0; i < count; i++) {
      const hub = Math.random() < 0.18;
      nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: rand(-7, 7),
        vy: rand(-7, 7),
        r: hub ? rand(2.2, 3.2) : rand(0.9, 1.7),
        hub: hub,
        pulse: Math.random() * TAU,
      });
    }
    return true;
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!REDUCED) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        // bounce just inside the edges so nodes never vanish
        if (n.x < 4 || n.x > w - 4) { n.vx *= -1; n.x = Math.max(4, Math.min(w - 4, n.x)); }
        if (n.y < 4 || n.y > h - 4) { n.vy *= -1; n.y = Math.max(4, Math.min(h - 4, n.y)); }
      }
    }

    // links first, so nodes sit on top of them
    const paths = [];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > range * range) continue;

        const closeness = 1 - Math.sqrt(d2) / range;
        let bucket = (closeness * LINK_STEPS) | 0;
        if (bucket >= LINK_STEPS) bucket = LINK_STEPS - 1;
        if (bucket < 0) continue;

        let path = paths[bucket];
        if (!path) path = paths[bucket] = new Path2D();
        path.moveTo(a.x, a.y);
        path.lineTo(b.x, b.y);
      }
    }

    ctx.lineWidth = 1;
    for (let i = 0; i < paths.length; i++) {
      if (!paths[i]) continue;
      ctx.strokeStyle = LINK_STROKE[i];
      ctx.stroke(paths[i]);
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const breathe = REDUCED ? 1 : 0.75 + 0.25 * Math.sin(t * 0.9 + n.pulse);

      if (n.hub) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(108, 226, 209,' + (0.1 * breathe).toFixed(3) + ')';
        ctx.arc(n.x, n.y, n.r * 5, 0, TAU);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.fillStyle = n.hub
        ? 'rgba(108, 226, 209,' + (0.85 * breathe).toFixed(3) + ')'
        : 'rgba(168, 186, 255,' + (0.55 * breathe).toFixed(3) + ')';
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
    }
  }

  if (!build()) return;

  if (REDUCED) {
    draw(0, 0);
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
    if (visible) draw(t, dt);
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  });
})();
