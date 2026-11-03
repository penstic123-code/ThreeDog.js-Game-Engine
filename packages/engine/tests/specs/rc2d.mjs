// 2D radiance cascades example (examples/rc2d, page /rc2d.html). Reads the gathered light (rc.target, half floats) at world spots the page names:
// next to a lamp, the same distance from it in the open, and the same distance behind a wall. Light that is not blocked by the wall, a resize that
// does not rebuild, or a dispose that leaves render targets behind all fail here.

const read = () => {
  const { rc, THREE, points } = window.rc2dTest, R = engine.renderer, rt = rc.target, buf = new Uint16Array(4 * 9), at = {};
  for (const [name, [x, z]] of Object.entries(points)) {
    const v = new THREE.Vector3(x, 0, z).project(engine.camera);
    const px = Math.floor((v.x + 1) / 2 * rt.width), py = Math.floor((v.y + 1) / 2 * rt.height);
    R.readRenderTargetPixels(rt, px - 1, py - 1, 3, 3, buf);
    let sum = 0;
    for (let i = 0; i < 9; i++) for (let c = 0; c < 3; c++) sum += THREE.DataUtils.fromHalfFloat(buf[i * 4 + c]);
    at[name] = +(sum / 27).toFixed(4);
  }
  return at;
};

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'rc2d example: light next to a lamp, blocked behind a wall; resize rebuilds; dispose frees its render targets',
    url: '/rc2d.html?threedog-headless',
    async run({ page, check, ev, wait }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const a = await ev(src => { try {
        engine.step(0.2);
        const d = window.rc2dTest.rc.describe();
        return { at: (0, eval)(`(${src})`)(), d, post: engine.post.list?.().map(e => e.name) ?? null };
      } catch (err) { return { err: String(err.stack) }; } }, read.toString());
      if (a.err) { check('runs without error', false, a.err); return; }
      const { lit, open, shadow } = a.at;
      check('a pixel 0.8 m from a lamp is lit (> 0.5)', lit > 0.5, JSON.stringify(a.at));
      check('behind the wall is much darker than the same distance in the open (open > 3x shadow)', open > 3 * shadow, JSON.stringify(a.at));
      check('next to the lamp is brighter than 4 m away in the open', lit > open, JSON.stringify(a.at));
      check('cascades sized from the render size (auto count covers the diagonal, probes halve per cascade)',
        a.d.cascades.length >= 3 && a.d.cascades.every((c, i) => i === 0 || c.spacing === a.d.cascades[i - 1].spacing * 2) &&
        a.d.cascades.at(-1).interval[1] >= Math.hypot(...a.d.size), JSON.stringify(a.d));
      if (a.post) check("the apply pass is in the engine's post chain", a.post.includes('rc2d'), JSON.stringify(a.post));

      const size0 = a.d.size;
      await page.setViewportSize({ width: 640, height: 400 });
      await wait(300);   // the engine's resize observer fires asynchronously
      const b = await ev(src => { try {
        engine.step(0.2);
        return { at: (0, eval)(`(${src})`)(), d: window.rc2dTest.rc.describe() };
      } catch (err) { return { err: String(err.stack) }; } }, read.toString());
      if (b.err) { check('resize runs without error', false, b.err); return; }
      check('resize: the targets follow the new render size', b.d.size[0] !== size0[0] && b.d.size[0] === Math.ceil(640 * 0.5), JSON.stringify({ before: size0, after: b.d.size }));
      check('resize: still lit by the lamp and blocked by the wall', b.at.lit > 0.5 && b.at.open > 3 * b.at.shadow, JSON.stringify(b.at));

      const c = await ev(() => { try {
        const { rc } = window.rc2dTest, info = engine.renderer.info.memory, targets = rc.describe().targets, before = info.textures;
        rc.dispose(); rc.dispose();
        const freed = before - info.textures;   // read before the next frame: post chain changes may allocate their own targets
        engine.step(0.1);   // a frame after dispose: the hook and the post pass are gone, nothing reads a freed target
        return { targets, freed, texture: rc.texture, post: engine.post.list?.().map(e => e.name) ?? null, d: rc.describe().disposed };
      } catch (err) { return { err: String(err.stack) }; } });
      if (c.err) { check('dispose runs without error', false, c.err); return; }
      check('dispose frees every render target (renderer.info.memory.textures)', c.freed >= c.targets && c.texture === null && c.d, JSON.stringify(c));
      if (c.post) check('dispose removes the post pass', !c.post.includes('rc2d'), JSON.stringify(c.post));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
