// [guard] Picture freedom survives the engine's own lifecycle. The game picks its look with plain three.js, and the engine must neither pick for it nor undo it:
// pixel art (pixelSize low resolution + NearestFilter), wireframe, a node material (TSL) and a module that edits a material at runtime. Each look is read off real
// pixels and as material identity (===) at the start and after a content reload, a save and load, a session load and a module swap. Public API and native three.js only.
// Node materials need a WebGPURenderer; on this machine's software Chromium it lands on the WebGL2 backend and the run says so (real GPU: tools/real-webgpu.mjs).
const J = JSON.stringify;
const PAGE = '/tests/picture-freedom/index.html';

/** In the page: build the five looks, return a probe that reads facts off identity and pixels. Source text, so it can be shipped through ev */
const SETUP = () => {
  const { THREE, TG, TSL, engine, K, read, inside } = window.freedom, out = {};
  const px = (r, g, b) => [r, g, b, 255];
  // a 2x2 texture, channels 0 or 255 only, so any other value in a pixel is a blend between texels
  const tex = filter => { const t = new THREE.DataTexture(new Uint8Array([...px(255, 0, 0), ...px(0, 255, 0), ...px(0, 0, 255), ...px(255, 255, 255)]), 2, 2);
    t.magFilter = t.minFilter = filter; t.needsUpdate = true; return t; };
  const plane = (x, mat, seg = 1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8, seg, seg), mat); m.position.set(x, 0, 0); m.userData.half = 0.9; return m; };
  const basic = o => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const mats = {
    pixel: basic({ map: tex(THREE.NearestFilter) }),
    smooth: basic({ map: tex(THREE.LinearFilter) }),   // the control: the same look measure must see blending here
    wire: basic({ color: 0xffffff, wireframe: true }),
    modded: basic({ color: 0xff0000 }),
  };
  const nodeable = !!engine.renderer.isWebGPURenderer;
  if (nodeable) { const m = new TG.MeshBasicNodeMaterial(); m.toneMapped = false; m.colorNode = TSL.mix(TSL.vec3(1, 0, 0), TSL.vec3(0, 0, 1), TSL.uv().x); mats.node = m; }
  const xs = { pixel: -4.4, smooth: -2.2, wire: 0, node: 2.2, modded: 4.4 }, meshes = {};
  for (const k of Object.keys(mats)) { meshes[k] = plane(xs[k], mats[k], k === 'wire' ? 4 : 1); engine.add(meshes[k], { id: 'pf-' + k }); }
  const is = (c, want) => c.every((v, i) => v === want[i]);
  const exact = c => c.every(v => v === 0 || v === 255);
  /** facts: identity of every material, and what the pixels inside each mesh show */
  const probe = () => {
    const s = read(), f = { identity: Object.keys(mats).every(k => meshes[k].material === mats[k] && meshes[k].parent === engine.scene) };
    const pix = inside(s, meshes.pixel), sm = inside(s, meshes.smooth), wi = inside(s, meshes.wire), mo = inside(s, meshes.modded);
    f.pixel = { blended: pix.filter(c => !exact(c)).length, seen: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]].map(w => pix.some(c => is(c, w))), n: pix.length };
    f.smooth = { blended: sm.filter(c => !exact(c)).length, n: sm.length };
    f.wire = { white: wi.filter(c => is(c, [255, 255, 255])).length, black: wi.filter(c => is(c, [0, 0, 0])).length, n: wi.length };
    f.modded = { r: mo.filter(c => c[0] > 200 && c[1] < 50).length / mo.length, g: mo.filter(c => c[1] > 200 && c[0] < 50).length / mo.length, b: mo.filter(c => c[2] > 200 && c[0] < 50 && c[1] < 50).length / mo.length };
    if (mats.node) {
      const no = inside(s, meshes.node), side = no.w, mean = (cols, ch) => { let t = 0, n = 0; no.forEach((c, i) => { if (cols(i % side)) { t += c[ch]; n++; } }); return t / n; };
      f.node = { leftR: mean(x => x < side / 4, 0), leftB: mean(x => x < side / 4, 2), rightR: mean(x => x > side * 3 / 4, 0), rightB: mean(x => x > side * 3 / 4, 2) };
    }
    const cv = engine.renderer.domElement;
    f.low = { buffer: [cv.width, cv.height], css: [cv.clientWidth, cv.clientHeight], k: K };
    f.texture = { pixelNearest: mats.pixel.map.magFilter === THREE.NearestFilter && mats.pixel.map.minFilter === THREE.NearestFilter, wire: mats.wire.wireframe === true };
    return f;
  };
  window.pf = { mats, meshes, probe };
  out.backend = engine.describe().renderer?.backend ?? null; out.nodeable = nodeable;
  return out;
};

export const specs = ['webgpu', 'webgl'].map(route => ({
  name: `[guard] picture freedom, ${route === 'webgpu' ? 'WebGPURenderer (node materials)' : 'WebGLRenderer'}: pixel art, wireframe${route === 'webgpu' ? ', a TSL node material' : ''} and a module's material edit survive content reload, save and load, session load and a module swap`,
  url: `${PAGE}?route=${route}`,
  software: true,   // reads rendered pixels
  async run({ page, check, ev }) {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
    const info = await ev(src => (0, eval)(`(${src})`)(), SETUP.toString());
    const r = await ev(async () => {
      const { engine } = window.freedom, { mats, meshes, probe } = window.pf, out = { stages: {} };
      const swapOrder = [];
      // a module that edits the game's material every fixed step, and whose replacement edits it another way: a plain write on the game's own object
      const look = (name, hex) => ({ name, type: 'rules', provides: ['look'], install() {}, fixed() { swapOrder.push(name); mats.modded.color.setHex(hex); } });
      engine.use(look('lookRed', 0xff0000));
      engine.step(1 / 60, { render: false });
      out.stages.start = probe();
      // 1. a content reload: engine.content.load twice, the second one overriding by name
      engine.content.load({ items: { gold: { name: 'Gold' } } });
      engine.content.load({ items: { gold: { name: 'Gold II' } } });
      engine.step(1 / 60, { render: false });
      out.stages.content = probe();
      // 2. save and load on the running playthrough, then a full session load (what Continue does)
      await engine.saves.save('pf'); await engine.saves.flush();
      out.saved = await engine.saves.load('pf');
      engine.step(1 / 60, { render: false });
      out.stages.saveLoad = probe();
      await engine.session.load('pf');
      engine.step(1 / 60, { render: false });
      out.stages.session = probe();
      // 3. swap the module that edits the material: the new one's write must show, the material must be the same object
      engine.use(look('lookGreen', 0x00ff00), { replaces: 'look' });
      engine.step(1 / 60, { render: false });
      out.stages.swap = probe();
      out.order = swapOrder;
      return out;
    });
    console.log(`  picture freedom ${route}: backend ${info.backend}, node materials ${info.nodeable}`);
    if (route === 'webgpu' && info.backend !== 'webgpu') console.log('  NOT real WebGPU: this browser fell back to the WebGL2 backend of WebGPURenderer; the node material ran there, not on a GPU device');
    const names = ['start', 'content', 'saveLoad', 'session', 'swap'];
    check('the renderer is the one asked for (WebGPURenderer on the webgpu route, plain WebGLRenderer on the other)', info.nodeable === (route === 'webgpu'), J(info));
    check('the content reload, save and load and session load all returned true', r.saved === true, J(r.saved));
    for (const n of names) {
      const f = r.stages[n];
      check(`${n}: pixel art: the drawing buffer is ${f.low.k}x smaller than its CSS box, and a nearest texture shows only its own 4 colors (no blended pixel), all 4 seen`,
        Math.abs(f.low.buffer[0] * f.low.k - f.low.css[0]) <= f.low.k && f.pixel.blended === 0 && f.pixel.seen.every(Boolean) && f.texture.pixelNearest, J([f.low, f.pixel, f.texture]));
      check(`${n}: the control (same texture, LinearFilter) does blend, so the measure bites`, f.smooth.blended > 0, J(f.smooth));
      check(`${n}: wireframe: the lines are white pixels on black, not a filled plane`, f.texture.wire && f.wire.white > 0 && f.wire.white < f.wire.n / 2, J(f.wire));
      check(`${n}: every game material is still the one object on its mesh, and the meshes are still in the scene`, f.identity, J(f.identity));
      if (n !== 'swap') check(`${n}: the module's red edit shows in the pixels`, f.modded.r > 0.9, J(f.modded));
      else check('swap: the new module replaced the old one, its green edit shows in the pixels and nothing is red any more', f.modded.g > 0.9 && f.modded.r === 0, J(f.modded));
      if (route === 'webgpu') check(`${n}: node material: red on the left, blue on the right`, f.node.leftR > f.node.leftB + 60 && f.node.rightB > f.node.rightR + 60, J(f.node));
    }
    check('only the new module ran after the swap, once per step', r.order.slice(-1)[0] === 'lookGreen' && !r.order.slice(r.order.indexOf('lookGreen')).includes('lookRed'), J(r.order));
    check('no page error or console error', errors.length === 0, J(errors));
  },
}));
