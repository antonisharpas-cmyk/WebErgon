/* =====================================================================
   Hero starfield.

   A slow-drifting field of stars with a gentle twinkle, plus the
   occasional shooting star. Purely decorative: the canvas is
   aria-hidden and everything degrades to an empty background if
   canvas is unavailable.

   Reduced motion gets one static frame and no meteors.
   ===================================================================== */
(function () {
  const canvas = document.querySelector('.star-canvas');
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;

  // mostly white, with a few carrying the brand tints
  const TINTS = [
    '255, 255, 255',
    '255, 255, 255',
    '255, 255, 255',
    '255, 255, 255',
    '185, 198, 255',
    '158, 240, 226',
  ];

  let w = 0;
  let h = 0;
  let stars = [];
  let meteors = [];
  let nextMeteorAt = 1.6;
  let visible = true;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function build() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = Math.max(70, Math.min(260, Math.round((w * h) / 6400)));
    stars = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rand(0.35, 1.45),
        base: rand(0.16, 0.9),
        speed: rand(0.35, 1.5),
        phase: Math.random() * TAU,
        drift: rand(1.5, 6),                 // px per second, downward
        tint: TINTS[(Math.random() * TINTS.length) | 0],
      });
    }
    return true;
  }

  function spawnMeteor() {
    const angle = rand(0.42, 0.72);          // radians, down and to the right
    const speed = rand(0.45, 0.75) * w;      // px per second
    return {
      x: rand(-0.1, 0.75) * w,
      y: rand(-0.05, 0.4) * h,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0,
      span: rand(0.9, 1.5),                  // seconds
      len: rand(170, 300),
      tint: Math.random() < 0.25 ? '158, 240, 226' : '255, 255, 255',
    };
  }

  function draw(t, dt) {
    ctx.clearRect(0, 0, w, h);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];

      if (!REDUCED) {
        s.y += s.drift * dt;
        if (s.y > h + 2) {
          s.y = -2;
          s.x = Math.random() * w;
        }
      }

      // twinkle: never fully off, so the field stays calm
      const tw = REDUCED ? 1 : 0.65 + 0.35 * Math.sin(t * s.speed + s.phase);
      const a = s.base * tw;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + s.tint + ',' + a.toFixed(3) + ')';
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();

      // a soft halo on the brighter few
      if (s.r > 1.1) {
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + s.tint + ',' + (a * 0.14).toFixed(3) + ')';
        ctx.arc(s.x, s.y, s.r * 3.2, 0, TAU);
        ctx.fill();
      }
    }

    if (REDUCED) return;

    if (t >= nextMeteorAt && meteors.length < 2) {
      meteors.push(spawnMeteor());
      nextMeteorAt = t + rand(3, 7.5);
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.life += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      const p = m.life / m.span;
      if (p >= 1 || m.x > w + m.len || m.y > h + m.len) {
        meteors.splice(i, 1);
        continue;
      }

      // ease in then out, so it never pops on or off
      const fade = Math.sin(Math.min(1, p) * Math.PI);
      const mag = Math.hypot(m.vx, m.vy) || 1;
      const tailX = m.x - (m.vx / mag) * m.len;
      const tailY = m.y - (m.vy / mag) * m.len;

      const grad = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
      grad.addColorStop(0, 'rgba(' + m.tint + ',' + (1 * fade).toFixed(3) + ')');
      grad.addColorStop(0.3, 'rgba(' + m.tint + ',' + (0.42 * fade).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(' + m.tint + ',0)');

      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      // glow around the head so the streak reads at a glance
      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + m.tint + ',' + (0.16 * fade).toFixed(3) + ')';
      ctx.arc(m.x, m.y, 9, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = 'rgba(' + m.tint + ',' + fade.toFixed(3) + ')';
      ctx.arc(m.x, m.y, 2.2, 0, TAU);
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
    // clamp dt so a backgrounded tab does not teleport everything
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
