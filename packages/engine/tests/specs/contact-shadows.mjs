// Contact-shadows technique example (examples/techniques/contact-shadows, page /contact-shadows.html). Reads the frame's brightness just beside the
// base of a 10 cm cup on a table and a 12 cm block on the ground, on the side away from the sun, against open spots on the same surfaces.
// With the technique the base is clearly darker (the object sits); with the example's loose settings (?mode=float, 70 m box, 4 cm normal bias, full
// fill) the contact stays near open brightness (it floats). Also: the handle writes on the page's own lights and gives their values back, the AO pass joins the chain.

// brightness (0..1, mean of rgb over 3x3 px) at world points; contact points are pushed out of the base along the ground, away from the sun
const read = () => {
  const { THREE, points, picture } = window.contactTest, R = engine.renderer, gl = R.getContext(), size = R.getDrawingBufferSize(new THREE.Vector2());
  const sun = picture.sun.position.clone().sub(picture.sun.target.position).setY(0).normalize();
  engine.step(1 / 60);   // render, then read the drawing buffer in the same task (before the browser clears it)
  const at = (p) => {
    const v = new THREE.Vector3(...p).project(engine.camera), px = Math.floor((v.x + 1) / 2 * size.x), py = Math.floor((v.y + 1) / 2 * size.y);
    const b = new Uint8Array(4 * 9);
    gl.readPixels(px - 1, py - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, b);
    let s = 0; for (let i = 0; i < 9; i++) s += b[i * 4] + b[i * 4 + 1] + b[i * 4 + 2];
    return +(s / 27 / 255).toFixed(3);
  };
  const contact = ({ at: [x, y, z], r }) => at([x - sun.x * (r + 0.015), y, z - sun.z * (r + 0.015)]);
  const o = { cup: contact(points.cup), tableOpen: at(points.tableOpen), block: contact(points.block), groundOpen: at(points.groundOpen) };
  return { ...o, cupRatio: +(o.cup / o.tableOpen).toFixed(3), blockRatio: +(o.block / o.groundOpen).toFixed(3) };
};

const measure = (ev) => ev(src => { try { engine.step(0.5); return (0, eval)(`(${src})`)(); } catch (err) { return { err: String(err.stack) }; } }, read.toString());

export const specs = [
  {
    software: true,   // reads rendered pixels (through a helper): stays on software rendering (same pixels on every machine)
    name: 'contact-shadows technique: small objects darken their base (loose settings float); the handle writes and gives back shadow, fill and AO',
    url: '/contact-shadows.html?threedog-headless',
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const fixed = await measure(ev);
      if (fixed.err) { check('runs without error', false, fixed.err); return; }
      check('with the technique the cup\'s base on the table is clearly darker than open table (< 0.75)', fixed.cupRatio < 0.75, JSON.stringify(fixed));
      check('with the technique the block\'s base on the ground is clearly darker than open ground (< 0.75)', fixed.blockRatio < 0.75, JSON.stringify(fixed));

      const h = await ev(() => { try {
        const { cs, picture: { sun, hemi } } = window.contactTest, values = () => ({ extent: sun.shadow.camera.right, nb: sun.shadow.normalBias, fill: hemi.intensity });
        const on = values(), d = cs.describe();
        cs.remove();
        return { on, off: values(), d };
      } catch (err) { return { err: String(err.stack) }; } });
      if (h.err) { check('handle runs without error', false, h.err); return; }
      check('the handle writes the page\'s sun and fill (8 m box, 1.2 cm normal bias, fill x 0.4; texel 0.78 cm)',
        h.on.extent === 8 && h.on.nb === 0.012 && Math.abs(h.on.fill - 0.4 * h.off.fill) < 1e-9 && h.d.texelCm === 0.78, JSON.stringify(h));
      check('remove() gives back the values it found (70 m, 4 cm normal bias, full fill)', h.off.extent === 70 && h.off.nb === 0.04 && h.off.fill === 1.2, JSON.stringify(h.off));

      await page.goto(page.url().replace('?threedog-headless', '?threedog-headless&ao=1'));
      await page.waitForFunction(() => window.engine?.ready, null, { timeout: 60000 });
      const ao = await ev(() => { try { engine.step(0.2); return { post: engine.post.list?.().map(e => `${e.name}:${e.enabled}`) ?? [] }; } catch (err) { return { err: String(err.stack) }; } });
      check('?ao=1 puts the AO pass in the post chain, on', !ao.err && ao.post.includes('ao:true'), JSON.stringify(ao));

      await page.goto(page.url().replace('&ao=1', '&mode=float'));
      await page.waitForFunction(() => window.engine?.ready, null, { timeout: 60000 });
      const float = await measure(ev);
      if (float.err) { check('float mode runs without error', false, float.err); return; }
      check('loose settings (?mode=float): the cup\'s base barely darkens (the failure the README shows) and less than with the technique',
        float.cupRatio > fixed.cupRatio + 0.15, JSON.stringify({ fixed, float }));
      check('loose settings: the block on the ground darkens its base less than with the technique', float.blockRatio > fixed.blockRatio + 0.1, JSON.stringify({ fixed, float }));
      check('no page or shader errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    },
  },
];
