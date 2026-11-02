// Technique examples sun-and-key-light and interior-light (examples/techniques/, pages /sun-and-key-light.html, /interior-light.html).
// Light is read as linear light before tone mapping: the scene is drawn into a half-float target (three applies no tone mapping to a render
// target), then read at world points. What would fail here: the three routes not differing in key:fill the way the README says, a low sun not
// giving longer shadows, the color push not tinting shadows, probe-baked bounce not brightening the room's shadowed side, exposure not easing
// between zones, or a page parameter colliding with the engine's own URL scenario keys (the sun turns NaN and the frame goes black).

// in the page: returns { name: [r, g, b] } linear light at each world point (3x3 pixel average)
// top: read from a camera looking straight down (every ground point visible, none hidden behind the object casting the shadow)
const readLight = (pts, top) => {
  const THREE = window.sunTest?.THREE ?? window.interiorTest.THREE, R = engine.renderer, W = top ? 512 : 320, H = top ? 512 : 180;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
  let cam = engine.camera;
  if (top) { cam = new THREE.PerspectiveCamera(30, W / H, 20, 120); cam.position.set(0, 60, 0.01); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); }
  else { cam.aspect = W / H; cam.updateProjectionMatrix(); }
  // fog off for this one read (put back before the engine looks again): the light on the surface, not the air in front of it
  const fog = engine.scene.fog; engine.scene.fog = null;
  R.setRenderTarget(rt); R.render(engine.scene, cam); R.setRenderTarget(null);
  engine.scene.fog = fog;
  const out = {}, buf = new Uint16Array(4 * 9);
  for (const [name, [x, y, z]] of Object.entries(pts)) {
    const v = new THREE.Vector3(x, y, z).project(cam);
    const px = Math.floor((v.x + 1) / 2 * W), py = Math.floor((v.y + 1) / 2 * H);
    R.readRenderTargetPixels(rt, px - 1, py - 1, 3, 3, buf);
    const c = [0, 0, 0];
    for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++) c[k] += THREE.DataUtils.fromHalfFloat(buf[i * 4 + k]) / 9;
    out[name] = c.map(n => +n.toFixed(4));
  }
  rt.dispose();
  return out;
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// sun page: key:fill on the ground (open vs the cube's shadow), the pole's shadow length, shadow color
async function sunRoute(ev, wait, page, query) {
  await page.goto(page.url().replace(/\/[^/]*$/, '/sun-and-key-light.html?threedog-headless&' + query));
  await page.waitForFunction(() => window.engine?.ready && window.sunTest, null, { timeout: 120000 });
  return ev(src => { try {
    engine.step(0.2);
    const read = (0, eval)(`(${src})`), T = window.sunTest, S = engine.lights.sun, d = S.position.clone().sub(S.target.position), h = Math.hypot(d.x, d.z), ax = -d.x / h, az = -d.z / h;
    const edge = 1 / Math.max(Math.abs(ax), Math.abs(az)) + 0.45;   // 45 cm past the cube's edge, on its shadow side (the noon shadow reaches 65 cm)
    const pts = { open: [3.2, 0, 2.8], cubeShadow: [-2.6 + ax * edge, 0, -1.2 + az * edge] };
    for (let i = 1; i <= 80; i++) pts['s' + i] = [T.points.poleBase[0] + ax * i * 0.25, 0, T.points.poleBase[2] + az * i * 0.25];
    const at = read(pts, true);
    return { at, sun: engine.lights.sun.intensity };
  } catch (err) { return { err: String(err.stack) }; } }, readLight.toString());
}

export const specs = [
  {
    name: 'technique sun-and-key-light: routes differ in key:fill as documented, low sun = longer shadows, color push tints shadows',
    url: '/sun-and-key-light.html?threedog-headless&route=noon',
    async run({ page, check, ev, wait }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const L = (r) => lum(r.at.open) / Math.max(1e-4, lum(r.at.cubeShadow));
      const shadowLen = (r) => { const o = lum(r.at.open); let n = 0; for (let i = 1; i <= 80; i++) if (lum(r.at['s' + i]) < 0.7 * o) n = i; return n * 0.25; };
      const r = {};
      for (const q of ['route=noon', 'route=overcast', 'route=golden', 'route=golden&tint=0']) {
        r[q] = await sunRoute(ev, wait, page, q);
        if (r[q].err) { check(`${q} runs without error`, false, r[q].err); return; }
      }
      const noon = r['route=noon'], over = r['route=overcast'], gold = r['route=golden'], neutral = r['route=golden&tint=0'];
      check('the sun intensity is a number on every route (no NaN from a URL key)', [noon, over, gold].every(x => Number.isFinite(x.sun)), JSON.stringify([noon.sun, over.sun, gold.sun]));
      const m = { noon: +L(noon).toFixed(2), overcast: +L(over).toFixed(2), golden: +L(gold).toFixed(2) };
      check('measured ground key:fill orders noon > golden > overcast (README table)', m.noon > m.golden && m.golden > m.overcast, JSON.stringify(m));
      check('overcast reads soft (ground lit/shadow under 2), noon hard (over 3)', m.overcast < 2 && m.noon > 3, JSON.stringify(m));
      const len = { noon: shadowLen(noon), golden: shadowLen(gold) };
      check('the low golden sun throws a pole shadow over 4x the noon one', len.golden > 4 * Math.max(0.25, len.noon), JSON.stringify(len));
      const blueRed = (x) => x.at.cubeShadow[2] / Math.max(1e-4, x.at.cubeShadow[0]);
      check('color push: golden shadows are blue (b/r > 1.15); tint=0 keeps them near gray (b/r within 0.9..1.1)',
        blueRed(gold) > 1.15 && blueRed(neutral) > 0.9 && blueRed(neutral) < 1.1, JSON.stringify({ golden: blueRed(gold), neutral: blueRed(neutral) }));
      check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
  {
    name: 'technique interior-light: probe-baked bounce brightens the shadowed side; exposure eases between zones; lamps at night',
    url: '/interior-light.html?threedog-headless&fill=none',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      const load = async (q) => {
        await page.goto(page.url().replace(/\/[^/]*$/, '/interior-light.html?threedog-headless&' + q));
        await page.waitForFunction(() => window.engine?.ready && window.interiorTest, null, { timeout: 120000 });
        return ev(async src => { try {
          await window.interiorTest.ready;
          engine.step(0.2);
          return { at: (0, eval)(`(${src})`)(window.interiorTest.points), sun: engine.lights.sun.intensity, probes: (engine.describe().render.probes ?? []).reduce((n, p) => n + p.count, 0) };
        } catch (err) { return { err: String(err.stack) }; } }, readLight.toString());
      };
      const none = await load('fill=none'), probes = await load('fill=probes');
      if (none.err || probes.err) { check('pages run without error', false, none.err ?? probes.err); return; }
      check('probes were baked', probes.probes > 0, JSON.stringify(probes.probes));
      const gain = (k) => lum(probes.at[k]) / Math.max(1e-4, lum(none.at[k]));
      check('probe-baked fill brightens the shadowed corner and north wall (> 1.15x vs no fill)', gain('corner') > 1.15 && gain('northWall') > 1.15,
        JSON.stringify({ corner: gain('corner'), northWall: gain('northWall'), none: none.at, probes: probes.at }));

      const ex = await ev(() => { try {
        const z = window.interiorTest.zone, start = z.exposure;
        engine.setCamera('fixed', { position: [6, 1.7, 12], lookAt: [0, 1.2, 0] });   // walk out of the door
        engine.step(0.1); const mid = z.exposure;
        for (let i = 0; i < 40; i++) engine.step(0.1);
        return { start, mid, end: z.exposure, zone: z.name };
      } catch (err) { return { err: String(err.stack) }; } });
      if (ex.err) { check('zone switch runs', false, ex.err); return; }
      check('exposure eases from the indoor to the outdoor value (between after 0.1 s, settled after 4 s)',
        ex.zone === 'outside' && ex.start > ex.mid && ex.mid > ex.end && Math.abs(ex.end - 1) < 0.02, JSON.stringify(ex));

      const night = await load('night=1&fill=none');
      if (night.err) { check('night page runs', false, night.err); return; }
      check('night: the sun intensity is a number (page params do not collide with the engine URL keys) and the lamps light the room',
        Number.isFinite(night.sun) && lum(night.at.northWall) > 0.005, JSON.stringify(night));
      check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
