// WebGPU + TSL example (examples/webgpu-tsl, page /webgpu-tsl.html), run the way a game runs it: its own WebGPURenderer on the WebGL2 backend
// (same pixels on every machine, plan step 11: CI runs the WebGPU route there). A guard for the example recipe 56 points at:
// every material in the scene is a node material (nothing GLSL slipped in), the grass moves with engine time, the lantern follows the
// engine's daylight, the post node changes the picture live, and nothing logs an error. Why each: the example's whole point is that the
// engine's functions and values work inside the game's own TSL; a scene that draws but ignores uTime / uDaylight would teach the wrong thing.

/** In the page: draw one frame and read the canvas in the same task; mean brightness of a box (whole frame when no box) */
const helpers = () => {
  const read = () => {
    engine.renderOnce();
    const src = engine.renderer.domElement, c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(src, 0, 0);
    return { d: g.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
  };
  const meanBox = (s, [x, y], r) => {
    let sum = 0, n = 0;
    for (let j = Math.max(0, y - r); j < Math.min(s.h, y + r); j++) for (let i = Math.max(0, x - r); i < Math.min(s.w, x + r); i++) {
      const k = (j * s.w + i) * 4; sum += s.d[k] + s.d[k + 1] + s.d[k + 2]; n++;
    }
    return +(sum / (3 * n)).toFixed(2);
  };
  const changed = (a, b) => { let n = 0; for (let k = 0; k < a.d.length; k += 4) if (Math.abs(a.d[k] - b.d[k]) + Math.abs(a.d[k + 1] - b.d[k + 1]) + Math.abs(a.d[k + 2] - b.d[k + 2]) > 12) n++;
    return +(100 * n / (a.w * a.h)).toFixed(2); };
  return { read, meanBox, changed };
};

export const specs = [
  {
    name: '[guard] webgpu-tsl example: all node materials on the WebGL2 backend, grass sways with uTime, lantern follows uDaylight, post node live',
    url: '/webgpu-tsl.html?threedog-headless&webgl2',
    software: true,   // reads rendered pixels through the helpers above
    async run({ page, check, ev }) {
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const r = await ev(src => { try {
        const { read, meanBox, changed } = (0, eval)(`(${src})`)(), { parts, picture, THREE } = window.webgpuTslTest, U = engine.uniforms;
        engine.haltLoop();
        engine.step(0.01);   // one real frame first: renderOnce skips onRender, so picture/'s lights and sky are unset until a frame has run
        const mats = [];
        engine.scene.traverse(o => { if (o.material) for (const m of [].concat(o.material)) mats.push({ o: o.name || o.type, type: m.type, node: !!m.isNodeMaterial }); });
        // hold the values the sky would write so one change at a time moves the picture
        U.uCloudShadow.value = 0; U.uWind.value = 3;
        const at = p => { const v = new THREE.Vector3(...p).project(engine.camera), c = engine.renderer.domElement;
          return [Math.round((v.x + 1) / 2 * c.width), Math.round((1 - v.y) / 2 * c.height)]; };
        // time moves by stepping (uTime follows engine.time.now('real')); the same two moments with the grass hidden are the control (lantern flicker, sky)
        const span = hide => { parts.grass.visible = !hide; const a = read(); engine.step(0.7); const b = read(); parts.grass.visible = true; return changed(a, b); };
        const swayed = span(false), still = span(true);
        U.uDaylight.value = 1;
        const lp = at(parts.lantern.position.toArray());
        const day = meanBox(read(), lp, 6); U.uDaylight.value = 0; const night = meanBox(read(), lp, 6); U.uDaylight.value = 1;
        picture.scanlines.value = 0; const flat = read();
        picture.scanlines.value = 0.5; const lines = read();
        const order = engine.post.object() ? engine.post._pipe?.order ?? null : null;
        return { renderer: engine.describe().renderer, mats, sway: { swayed, still }, day, night, post: { flatMean: meanBox(flat, [flat.w >> 1, flat.h >> 1], 1e4),
          linesMean: meanBox(lines, [lines.w >> 1, lines.h >> 1], 1e4) }, order, error: engine.error?.message ?? '' };
      } catch (err) { return { err: String(err.stack) }; } }, helpers.toString());
      if (r.err) { check('runs without error', false, r.err); return; }
      console.log('  webgpu-tsl numbers:', JSON.stringify({ sway: r.sway, day: r.day, night: r.night, post: r.post, order: r.order }));
      check('runs on WebGPURenderer, WebGL2 backend (the game asked for it, so no fallback warning reason)', r.renderer.requested === 'webgpu' && r.renderer.backend === 'webgl2', JSON.stringify(r.renderer));
      const notNode = r.mats.filter(m => !m.node);
      check('every material in the scene is a node material (both sky domes included): nothing GLSL on the WebGPU route', r.mats.length >= 4 && !notNode.length, JSON.stringify(notNode.length ? notNode : r.mats));
      check('the grass moves with engine time (wind() inside the game\'s positionNode reads uTime)', r.sway.swayed > r.sway.still + 0.2, JSON.stringify(r.sway));
      check('the lantern glows at night and not at noon (uniforms(engine).uDaylight inside its emissiveNode)', r.night > r.day + 20, `day ${r.day}, night ${r.night}`);
      check('the post node runs after tone mapping and its uniform is live (amount 0.5 darkens the frame)', r.post.linesMean < r.post.flatMean * 0.9
        && Array.isArray(r.order) && r.order.indexOf('scanlines') > r.order.indexOf('output (tone mapping)'), JSON.stringify({ post: r.post, order: r.order }));
      check('no engine, page or shader errors', !r.error && errors.length === 0, [r.error, ...errors].filter(Boolean).slice(0, 3).join(' | '));
    },
  },
];
