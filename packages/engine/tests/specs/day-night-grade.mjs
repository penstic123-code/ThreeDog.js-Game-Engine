// Day-night-grade technique example (examples/techniques/day-night-grade, page /day-night-grade.html). Moves the calendar through noon, dusk and
// night and reads the frame and describe(): the picture darkens in order but night stays readable, the lamps carry light at night (ground under a
// lamp brighter than open ground) and are off at noon, the grade is warm at dusk with saturation below 1 and cool at night, written as owner
// day-night; remove() stops it and gives the grade back.

// at a time of day: mean brightness of the frame (every 4th pixel), brightness under a lamp and on open ground, the grade and exposure in effect
const at = (time) => {
  const { THREE, follow } = window.dayNightTest, R = engine.renderer, gl = R.getContext(), size = R.getDrawingBufferSize(new THREE.Vector2());
  engine.calendar.timeOfDay = time;
  for (let i = 0; i < 6; i++) engine.step(1 / 30);   // the sky blends, followDayNight writes, the environment map catches up
  const all = new Uint8Array(size.x * size.y * 4);
  gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, all);
  const lum = (i) => (0.2126 * all[i] + 0.7152 * all[i + 1] + 0.0722 * all[i + 2]) / 255;
  let s = 0, n = 0;
  for (let i = 0; i < all.length; i += 16) { s += lum(i); n++; }
  const spot = (p) => { const v = new THREE.Vector3(...p).project(engine.camera), x = Math.floor((v.x + 1) / 2 * size.x), y = Math.floor((v.y + 1) / 2 * size.y);
    let t = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) t += lum(((y + dy) * size.x + x + dx) * 4); return t / 9; };
  const post = engine.describe().look.post ?? {}, val = k => post[k]?.value;
  return { mean: +(s / n).toFixed(3), underLamp: +spot([-0.9, 0, 2.1]).toFixed(3), open: +spot([-6, 0, 6]).toFixed(3), level: +follow.level().toFixed(3),
    temperature: val('lut.temperature'), saturation: val('lut.saturation'), writer: post['lut.temperature']?.writer, exposure: +R.toneMappingExposure.toFixed(3) };
};

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'day-night-grade technique: noon > dusk > night but night readable; lamps carry the night; warm dusk without extra saturation; cool night',
    url: '/day-night-grade.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => { try { const f = (0, eval)(`(${src})`); return { noon: f(0.5), dusk: f(17.25 / 24), night: f(22 / 24) }; }
        catch (err) { return { err: String(err.stack) }; } }, at.toString());
      if (r.err) { check('runs without error', false, r.err); return; }
      const { noon, dusk, night } = r, all = JSON.stringify(r);
      check('the picture darkens in order: noon > dusk > night', noon.mean > dusk.mean && dusk.mean > night.mean, all);
      check('night is dark (mean < 0.6 x noon) but readable (mean > 0.12)', night.mean < 0.6 * noon.mean && night.mean > 0.12, all);
      check('lamps are off at noon and fully on at night', noon.level === 0 && night.level === 1, all);
      check('at night the lamps carry the scene: ground under a lamp > 1.3 x open ground', night.underLamp > 1.3 * night.open, all);
      check('the grade is written by owner day-night', /day-night/.test(String(noon.writer)), all);
      check('dusk is warm (temperature > 0.2) with saturation below 1; night is cool (temperature < 0) and desaturated',
        dusk.temperature > 0.2 && dusk.saturation < 1 && night.temperature < 0 && night.saturation < 0.85, all);
      check('exposure follows the keyframes: lifted at night above noon', night.exposure > noon.exposure, all);

      const gone = await ev(() => { try {
        window.dayNightTest.follow.remove();
        engine.step(1 / 30);
        const p = engine.describe().look.post ?? {};
        return { writer: p['lut.temperature']?.writer ?? null };
      } catch (err) { return { err: String(err.stack) }; } });
      check('remove() gives the grade back (no day-night writer left)', !gone.err && !/day-night/.test(String(gone.writer)), JSON.stringify(gone));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
