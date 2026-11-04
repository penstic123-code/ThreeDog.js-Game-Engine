// Wet-road technique example (examples/techniques/wet-road, page /wet-road.html). Renders a frame and reads the canvas in the same task:
// the road is darker when wet, wetness follows the weather with the dry-out delay, the puddle mask has soft edges (no hard opaque discs),
// and at night the wet road carries reflection streaks the dry road does not. A patch that stops compiling, a wetness that ignores rain
// or dries at once, or puddles cut with a hard edge all fail here.

// Frame -> luminance (0-1) of canvas regions given as fractions [x0, y0, x1, y1]; also the per-pixel rows for the mask check
const grab = (regions) => {
  engine.step(1 / 60);
  const src = engine.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  const out = {};
  for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
    const X = Math.floor(x0 * c.width), Y = Math.floor(y0 * c.height), W = Math.max(1, Math.floor((x1 - x0) * c.width)), H = Math.max(1, Math.floor((y1 - y0) * c.height));
    const d = g.getImageData(X, Y, W, H).data, lum = new Float32Array(W * H);
    let sum = 0, max = 0;
    for (let i = 0; i < W * H; i++) { const l = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; lum[i] = l; sum += l; if (l > max) max = l; }
    out[name] = { mean: +(sum / (W * H)).toFixed(4), max: +max.toFixed(4), W, H, rows: name === 'mask' ? Array.from(lum, v => +v.toFixed(3)) : undefined };
  }
  return out;
};

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'wet-road technique: darker when wet, follows rain with a dry-out delay, soft puddle edges, night reflection streaks',
    url: '/wet-road.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => { try {
        const g = (0, eval)(`(${src})`), { wet } = window.wetRoadTest, near = [0.3, 0.75, 0.7, 0.95], road = [0.3, 0.52, 0.7, 0.95];
        // 1. noon, held dry vs held wet: same view, only the road material changes (no rain drops in the picture)
        engine.weather.set('clear', { seconds: 0 }); engine.step(0.5);
        engine.calendar.timeOfDay = 0.5;
        wet.hold(0); const dry = g({ near });
        wet.hold(1); const wetDay = g({ near });
        // 2. night: lamps on; streaks only on the wet road
        engine.calendar.timeOfDay = 0.92;
        engine.step(1 / 60);   // picture/ writes the lamps in onRender and the pool takes them up next frame: dry and wet must both see them on
        wet.hold(0); const dryNight = g({ road });
        wet.hold(1); const wetNight = g({ road });
        // 3. the mask view: rows across the near road
        wet.maskView = true; engine.calendar.timeOfDay = 0.5; const mask = g({ mask: [0.3, 0.6, 0.7, 0.95] }).mask; wet.maskView = false;
        // 4. weather drives wetness: dry, then rain, then clear (game time, 1 s steps)
        wet.hold(0); wet.hold(null); engine.weather.set('rain', { seconds: 0 });
        for (let i = 0; i < 8; i++) engine.step(1);
        const afterRain = wet.wetness;
        for (let i = 0; i < 40; i++) engine.step(1);
        const soaked = wet.wetness;
        engine.weather.set('clear', { seconds: 0 });
        const delay = 40;   // WET_ROAD_DEFAULTS.dryDelay
        for (let i = 0; i < delay - 10; i++) engine.step(1);
        const inDelay = wet.wetness;
        for (let i = 0; i < 200; i++) engine.step(1);
        return { dry: dry.near, wetDay: wetDay.near, dryNight: dryNight.road, wetNight: wetNight.road, mask: { W: mask.W, H: mask.H, rows: mask.rows }, afterRain, soaked, inDelay, dried: wet.wetness, d: wet.describe() };
      } catch (err) { return { err: String(err.stack) }; } }, grab.toString());
      if (r.err) { check('runs without error', false, r.err); return; }
      const nums = JSON.stringify({ dry: r.dry.mean, wet: r.wetDay.mean, dryNight: r.dryNight, wetNight: r.wetNight });
      check('by day the wet road is clearly darker than the dry one (wet < 0.85 x dry)', r.wetDay.mean < 0.85 * r.dry.mean, nums);
      check('at night the wet road carries bright reflection streaks the dry road lacks (peak and mean up)', r.wetNight.max > r.dryNight.max + 0.08 && r.wetNight.mean > r.dryNight.mean, nums);
      check('rain wets the road gradually (some, not all, after 8 s of rain)', r.afterRain > 0.1 && r.afterRain < 0.9, String(r.afterRain));
      check('long rain soaks it (wetness 1)', r.soaked > 0.99, String(r.soaked));
      check('after the rain stops the road stays wet through the dry-out delay', r.inDelay > 0.99, String(r.inDelay));
      check('and then dries completely', r.dried < 0.01, JSON.stringify(r.d));
      // soft edge: of the pixels that are some puddle, a good share is in between (a hard disc is almost all 0 or full), and big pixel-to-pixel
      // jumps are rare (a hard edge gives one at every boundary crossing of every row). Full = the 98th percentile: the tone curve maps the mask's 1 below white.
      const { W, rows } = r.mask, full = [...rows].sort((x, y) => x - y)[Math.floor(rows.length * 0.98)] || 1e-6;
      let some = 0, mid = 0, jumps = 0;
      for (let i = 0; i < rows.length; i++) {
        const v = rows[i] / full;
        if (v > 0.08) { some++; if (v < 0.92) mid++; }
        if (i % W && Math.abs(rows[i] - rows[i - 1]) / full > 0.3) jumps++;
      }
      const info = JSON.stringify({ some, mid, jumps, full, n: rows.length });
      check('puddles exist in the near road (mask covers 5-70% of it)', some > 0.05 * rows.length && some < 0.7 * rows.length, info);
      check('puddle edges are soft: >= 12% of puddle pixels are partial, jumps > 0.3 in under 0.2% of pixels', mid >= 0.12 * some && jumps < 0.002 * rows.length, info);
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
