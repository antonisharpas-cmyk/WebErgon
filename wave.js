/* =====================================================================
   Animated dot-wave field.

   Renders the same surface as assets/wave-dots.png, but with the phase
   advancing over time so the wave actually flows. The PNG stays as the
   CSS background and is only dropped once this takes over, so the plate
   still looks right if JavaScript is off or canvas is unavailable.

   Cost control:
     - dots are batched into a dozen colour buckets and filled as one
       path each, instead of ~4,000 individual fill calls per frame
     - device pixel ratio is capped at 1.5
     - the loop is parked whenever the plate is off screen
     - prefers-reduced-motion gets a single static frame
   ===================================================================== */
(function () {
  const canvases = document.querySelectorAll('.wave-canvas');
  if (!canvases.length) return;

  const test = document.createElement('canvas');
  if (!test.getContext || !test.getContext('2d')) return;

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const BUCKETS = 12;

  const DEEP  = [64, 84, 190];
  const BLUE  = [140, 154, 255];
  const TEAL  = [108, 226, 209];
  const WHITE = [243, 250, 255];

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  // s: 0 = deep trough, 1 = the bright crest of a ribbon
  function shadeColour(s) {
    let c;
    if (s < 0.45) c = mix(DEEP, BLUE, s / 0.45);
    else if (s < 0.75) c = mix(BLUE, TEAL, (s - 0.45) / 0.3);
    else c = mix(TEAL, WHITE, (s - 0.75) / 0.25);
    const alpha = (0.22 + 0.78 * s).toFixed(3);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + alpha + ')';
  }

  const BUCKET_FILL = [];
  for (let i = 0; i < BUCKETS; i++) {
    BUCKET_FILL.push(shadeColour((i + 0.5) / BUCKETS));
  }

  function WaveField(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = true;
    this.frame = null;
    this.resize();
  }

  WaveField.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // roughly one dot every 8px, so density holds at any width
    this.nx = Math.max(44, Math.round(this.w / 8));
    this.ny = Math.max(16, Math.round(this.h / 8));
    return true;
  };

  WaveField.prototype.draw = function (t) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const amp = h * 0.3;
    const paths = [];
    for (let i = 0; i < BUCKETS; i++) paths.push(new Path2D());

    for (let j = 0; j <= this.ny; j++) {
      const v = j / this.ny;
      // fade the top and bottom rows so the field melts into the plate
      const edge = Math.min(1, Math.min(v, 1 - v) / 0.12);
      if (edge <= 0) continue;

      for (let i = 0; i <= this.nx; i++) {
        const u = i / this.nx;

        const z =
          0.62 * Math.sin(4.6 * u + 3.3 * v + 0.4 + t * 0.34) +
          0.4 * Math.sin(7.6 * u - 5.4 * v + 2.0 - t * 0.26) +
          0.17 * Math.sin(12.5 * u + 9.0 * v + 1.1 + t * 0.47);

        const zn = (z + 1.19) / 2.38;

        // bright ribbons are thin contour bands of the height field
        let ribbon = Math.exp(-((z - 0.62) * (z - 0.62)) / 0.0072);
        const second = 0.8 * Math.exp(-((z + 0.3) * (z + 0.3)) / 0.005);
        if (second > ribbon) ribbon = second;

        let s = (0.8 * zn + 0.9 * ribbon) * edge;
        if (s <= 0.04) continue;
        if (s > 1) s = 1;

        const x = u * w;
        const y = v * h + z * amp;
        const r = 0.9 + 2.5 * s;

        let bucket = (s * BUCKETS) | 0;
        if (bucket >= BUCKETS) bucket = BUCKETS - 1;

        const p = paths[bucket];
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, TAU);
      }
    }

    for (let i = 0; i < BUCKETS; i++) {
      ctx.fillStyle = BUCKET_FILL[i];
      ctx.fill(paths[i]);
    }
  };

  const fields = [];

  canvases.forEach(function (canvas) {
    const field = new WaveField(canvas);
    if (!field.w) return;
    fields.push(field);

    // hand over from the static PNG only once we know we can draw
    const plate = canvas.closest('.wave-plate');
    if (plate) plate.classList.add('wave-live');

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            field.visible = entry.isIntersecting;
          });
        },
        { rootMargin: '120px' }
      ).observe(canvas);
    }
  });

  if (!fields.length) return;

  if (REDUCED) {
    fields.forEach(function (f) { f.draw(0); });
    return;
  }

  let start = null;

  function tick(now) {
    if (start === null) start = now;
    const t = (now - start) / 1000;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].visible) fields[i].draw(t);
    }
    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);

  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      fields.forEach(function (f) { f.resize(); });
    }, 150);
  });
})();
