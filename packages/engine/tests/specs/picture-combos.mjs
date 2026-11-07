// [guard] Picture combos: the engine's picture switches are each tested alone; this spec tries them together, over a pairwise covering list (every pair of values of any two
// switches appears in at least one case). Switches: renderer route, shadows, post effects (none / one / two / three), fog, quality preset, camera kind, lights.
// Each case (ground, box, sphere, a few frames) checks only: nothing reported an error, the picture is neither all black nor one flat colour, and after going back to the plain
// setting the picture matches the plain picture taken at the start. It never judges how the picture looks and fixes no look value. A failure names the case (its index and
// settings) so it can be replayed: set the same switches on /tests/picture-combos/index.html?route=<route> and read engine.renderOnce().
// The route is one engine per spec (two specs, one page load each), the other switches are changed on that one engine between cases.
const J = JSON.stringify;
const PAGE = '/tests/picture-combos/index.html';
const FACTORS = {
  route: ['webgl', 'webgpu'], shadows: ['off', 'on'], post: [0, 1, 2, 3], fog: ['off', 'on'], preset: ['low', 'high'], camera: ['perspective', 'orthographic'], lights: ['sun', 'sun+point'],
};
const POST_NAMES = ['bloom', 'vignette', 'grain'];   // post: n turns on the first n of these
const TOLERANCE = 2;   // mean absolute channel difference (0..255) allowed when going back to plain; the render is deterministic on one machine, so this is slack for the readback only

/** Seeded greedy pairwise cover: repeatedly make a few random candidate cases and keep the one covering the most pairs not covered yet, until every pair is covered */
export function pairwise(factors, seed = 20261107) {
  let s = seed >>> 0;
  const rnd = n => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 16) % n; };   // small LCG, high bits: its low bits repeat too soon to reach every pair. Same list on every run
  const keys = Object.keys(factors), pk = (a, va, b, vb) => `${a}=${va}|${b}=${vb}`, left = new Set();
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) for (const va of factors[keys[i]]) for (const vb of factors[keys[j]]) left.add(pk(keys[i], va, keys[j], vb));
  const total = left.size, cases = [];
  const gain = c => { let n = 0; for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (left.has(pk(keys[i], c[keys[i]], keys[j], c[keys[j]]))) n++; return n; };
  while (left.size) {
    let best = null, bestGain = -1;
    for (let t = 0; t < 40; t++) {
      const c = {}; for (const k of keys) c[k] = factors[k][rnd(factors[k].length)];
      const g = gain(c); if (g > bestGain) { best = c; bestGain = g; }
    }
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) left.delete(pk(keys[i], best[keys[i]], keys[j], best[keys[j]]));
    cases.push(best);
  }
  return { cases, pairs: total };
}

export const { cases: CASES, pairs: PAIRS } = pairwise(FACTORS);
const label = (c, i) => `case #${i} ${J(c)}`;

export const specs = ['webgl', 'webgpu'].map(route => ({
  name: `[guard] picture combos, ${route === 'webgpu' ? 'WebGPURenderer' : 'WebGLRenderer'}: ${CASES.filter(c => c.route === route).length} pairwise cases of shadows, post effects, fog, preset, camera, lights run without error, draw a real picture and return to the plain picture`,
  url: `${PAGE}?route=${route}`,
  software: true,   // reads rendered pixels
  async run({ page, check, ev }) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
    const mine = CASES.map((c, i) => ({ c, i })).filter(x => x.c.route === route);
    const results = await ev(async ({ mine, POST_NAMES }) => {
      const { THREE, engine, sun, point, effects, read, persp, ortho } = window.combos, out = [];
      const setCamera = o => { engine.camera = o ? ortho : persp; };
      const frames = () => { for (let k = 0; k < 3; k++) read(); return read(); };
      // the plain setting: low preset, no shadows, no post, no fog, perspective, sun only
      const plain = () => {
        engine.settings.preset('low'); engine.renderer.shadowMap.enabled = false; sun.castShadow = false; engine.scene.fog = null; point.visible = false; setCamera(false);
      };
      const stats = f => {
        const seen = new Set(); let lit = 0;
        for (let p = 0; p < f.d.length; p += 4 * 7) { seen.add((f.d[p] >> 4) * 256 + (f.d[p + 1] >> 4) * 16 + (f.d[p + 2] >> 4)); if (f.d[p] + f.d[p + 1] + f.d[p + 2] > 30) lit++; }
        return { colors: seen.size, lit, w: f.w, h: f.h };
      };
      const diff = (a, b) => { if (a.w !== b.w || a.h !== b.h) return 255; let t = 0; for (let p = 0; p < a.d.length; p += 4) t += Math.abs(a.d[p] - b.d[p]) + Math.abs(a.d[p + 1] - b.d[p + 1]) + Math.abs(a.d[p + 2] - b.d[p + 2]); return t / (a.d.length / 4 * 3); };
      const errs = [], on = e => errs.push(String(e.message ?? e)), ce = console.error;
      window.addEventListener('error', on); console.error = (...a) => { errs.push(a.join(' ')); ce.apply(console, a); };
      plain(); const start = frames(), startStats = stats(start);
      for (const { c, i } of mine) {
        const r = { i, c, errs: [] }, e0 = errs.length, handles = [];
        try {
          engine.settings.preset(c.preset);
          engine.renderer.shadowMap.enabled = c.shadows === 'on'; sun.castShadow = c.shadows === 'on';
          engine.scene.fog = c.fog === 'on' ? new THREE.Fog(0x203040, 8, 30) : null;
          point.visible = c.lights === 'sun+point';
          setCamera(c.camera === 'orthographic');
          for (let k = 0; k < c.post; k++) handles.push(engine.post.add(effects[POST_NAMES[k]](), { name: 'pc-' + POST_NAMES[k] }));
          r.stats = stats(frames());
          for (const h of handles) h.remove();
          plain();
          r.back = diff(start, frames());
        } catch (err) { r.thrown = String(err?.stack ?? err).slice(0, 400); for (const h of handles) try { h.remove(); } catch {} try { plain(); } catch {} }
        r.errs = errs.slice(e0);
        out.push(r);
      }
      window.removeEventListener('error', on); console.error = ce;
      return { start: startStats, out };
    }, { mine, POST_NAMES });
    console.log(`  picture combos ${route}: ${mine.length} cases of ${CASES.length}; ${PAIRS} value pairs covered over all cases`);
    check('plain start picture is not all black or one flat colour', results.start.lit > 100 && results.start.colors > 4, J(results.start));
    for (const r of results.out) {
      const L = label(r.c, r.i);
      check(`${L}: no error was reported and nothing threw`, !r.thrown && r.errs.length === 0, J({ thrown: r.thrown, errs: r.errs.slice(0, 3) }));
      check(`${L}: the picture is not all black and not one flat colour`, !!r.stats && r.stats.lit > 100 && r.stats.colors > 4, J(r.stats));
      check(`${L}: after going back to plain, the picture matches the plain one (mean difference <= ${TOLERANCE} of 255)`, typeof r.back === 'number' && r.back <= TOLERANCE, `difference ${r.back}`);
    }
    check('no page error or console error outside the cases', errors.length === 0, J(errors.slice(0, 3)));
  },
}));
