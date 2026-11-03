// Night-lights technique example (examples/techniques/night-lights, page /night-lights.html). Renders a frame and reads the canvas in the same
// task: at night the ground under a lamp is clearly brighter than half way to the next lamp, the default parameters leave no large clipped
// area (whole frame and around a lamp head), and by day every light is off. Lamps that do not light the ground, defaults that blow out,
// or lights that ignore the time of day all fail here.

const grab = ({ under, between, head }) => {
  engine.step(1 / 60);
  const { THREE } = window.nightLightsTest, src = engine.renderer.domElement, c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  const px = (p) => { const v = new THREE.Vector3(...p).project(engine.camera); return [Math.round((v.x + 1) / 2 * c.width), Math.round((1 - v.y) / 2 * c.height)]; };
  const box = ([x, y], r) => {
    const X = Math.max(0, x - r), Y = Math.max(0, y - r), d = g.getImageData(X, Y, Math.min(2 * r, c.width - X), Math.min(2 * r, c.height - Y)).data;
    let sum = 0, clipped = 0; const n = d.length / 4;
    for (let i = 0; i < n; i++) { sum += (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255; if (Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) >= 250) clipped++; }
    return { mean: +(sum / n).toFixed(4), clipped: +(clipped / n).toFixed(4) };
  };
  return { under: box(px(under), 6), between: box(px(between), 6), head: box(px(head), 40), frame: box([c.width / 2, c.height / 2], Math.max(c.width, c.height)) };
};

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'night-lights technique: lamp pools brighter than between lamps, no large clipped areas with the defaults, off by day',
    url: '/night-lights.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => { try {
        const g = (0, eval)(`(${src})`), { lights, lampAt, between } = window.nightLightsTest;
        const pts = { under: [lampAt[1][0], 0, lampAt[1][1]], between: [between[0], 0, between[1]], head: [lampAt[1][0], 5.5, lampAt[1][1]] };
        engine.calendar.timeOfDay = 0.92; engine.step(0.5);
        const night = { ...g(pts), f: lights.night, lit: engine.lightPool.usage() };
        engine.calendar.timeOfDay = 0.5; engine.step(0.5);
        const day = { ...g(pts), f: lights.night };
        return { night, day, intensities: engine.lightPool.lights.map(l => +l.intensity.toFixed(2)) };
      } catch (err) { return { err: String(err.stack) }; } }, grab.toString());
      if (r.err) { check('runs without error', false, r.err); return; }
      const { night, day } = r, nums = JSON.stringify({ night: { under: night.under, between: night.between, head: night.head, frame: night.frame }, day: { under: day.under, between: day.between } });
      check('at night the lamps are on (night factor 1)', night.f === 1, String(night.f));
      check('at night the ground under a lamp is clearly brighter than half way to the next lamp (> 1.6x)', night.under.mean > 1.6 * night.between.mean, nums);
      check('default parameters: under 1% of the frame is clipped white', night.frame.clipped < 0.01, nums);
      check('default parameters: no large clipped area around a lamp head (< 15% of an 80 px box)', night.head.clipped < 0.15, nums);
      check('by day the lights are off (night factor 0, every pooled light at intensity 0)', day.f === 0 && r.intensities.every(i => i === 0), JSON.stringify({ f: day.f, i: r.intensities }));
      check('by day there is no lamp pool (under / between within 25%)', day.under.mean < 1.25 * day.between.mean, nums);
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
