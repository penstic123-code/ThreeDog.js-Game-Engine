// [guard] Plugins composed (outside review of 0.4.0, 2026-11-03): several plugins on one picture must switch off and on without side effects.
// Why a guard: four gaps were found with real plugin code. Post effects with no distinct order came back in a new place after off / on (the
// list still said A, B); the plugins of one style pack shared one owner, so switching B off also dropped A's material; turning a material
// patch plugin off left the materials already made with the patch (a streamed world got mixed looks); off('<pack>') did not say that the
// pack's starting values stay. If any of these comes back, or off / on stops giving back the exact picture, this fails.
// Page: perf city (WebGL, real look / plugin / patch code). Same format as the other files here.

/** Shared by the pixel items: render the engine at a small fixed size, read every pixel, compare two reads */
const PIX = `(() => {
  const R = engine.renderer, gl = R.getContext(), W = 64, H = 48, size = R.getSize(new threedogTest.THREE.Vector2());
  R.setSize(W, H, false); engine.post.setAntialias(false);
  const read = () => { engine.step(1 / 60, { describe: false }); const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const diff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
  return { read, diff, done: () => R.setSize(size.x, size.y, false) };
})()`;

export const specs = [
  {
    name: '[guard] plugins composed: post effects keep their place across off / on; look.post.set is a pause, plugins.off an unload',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled(); engine.pause();
        const { ShaderPass, CopyShader } = threedogTest, out = {};
        const fx = n => ({ name: n, slot: 'ldr', create: () => new ShaderPass(CopyShader) });   // no order of its own: ties decide
        engine.plugins.add({ './plugins/60-pa.js': { default: fx('pa') }, './plugins/61-pb.js': { default: fx('pb') } });
        const order = () => engine.post.list().filter(x => /^p[ab]$/.test(x.name)).map(x => x.name).join();
        out.start = order();
        out.offResult = engine.plugins.off('60-pa');
        out.offOrder = order();
        engine.plugins.on('60-pa'); out.back = order();
        engine.look.post.set({ pa: false }); engine.look.post.set({ pa: true }); out.paused = order();
        out.list = engine.plugins.list().filter(p => /^6[01]-/.test(p.name)).map(p => `${p.name}:${p.reach.join()}`);
        engine.plugins.off('60-pa'); engine.plugins.off('61-pb');
        return out;
      });
      console.log('  plugin post order:', JSON.stringify(r));
      check('A, B with no order render A then B; after off(A) / on(A) still A then B (the place is the registration place)', r.start === 'pa,pb' && r.offOrder === 'pb' && r.back === 'pa,pb', JSON.stringify(r));
      check('look.post.set({ pa: false / true }) keeps the place too', r.paused === 'pa,pb', r.paused);
      check('off() returns what it did: the plugins it took out, their reach, and how to pause instead', r.offResult?.off?.join() === '60-pa' && /look\.post\.set\(\{ pa: false \}\)/.test(r.offResult.note ?? ''), JSON.stringify(r.offResult));
      check('plugins.list() says each post plugin reaches the live picture', r.list.join() === '60-pa:live,61-pb:live', r.list.join());
    },
  },
  {
    name: '[guard] plugins composed: each style plugin is its own owner (B off gives A back, not the base); the same key from two plugins is a conflict unless one replaces the other; off(pack) keeps the pack\'s starting values',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, createEngine } = threedogTest, out = {};
        const err = async f => { try { await f(); return ''; } catch (e) { return e.message; } };
        const mk = (plugins, key) => createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, saveKey: key + performance.now(),
          style: { name: 'ink', exposure: 1.3, materials: { prop: { type: 'toon' } }, plugins } });
        const red = () => Object.assign(new THREE.MeshLambertMaterial({ color: 0xff0000 }), { name: 'prop' });
        const blue = () => Object.assign(new THREE.MeshPhongMaterial({ color: 0x0000ff }), { name: 'prop' });
        // two plugins replacing one role, neither says it replaces the other: a dev conflict naming both
        const c = mk({ './plugins/10-a.js': { default: red() }, './plugins/20-b.js': { default: blue() } }, 'pc-conflict');
        out.conflict = await err(() => c.start());
        c.dispose?.();
        // B declares it replaces A: B wins while on; B off gives A's red back (A still on); off(pack) gives the base; the starting values stay
        const e = mk({ './plugins/10-a.js': { default: red() }, './plugins/20-b.js': { default: blue(), replaces: '10-a' } }, 'pc-replace');
        await e.start();
        const hex = () => e.makeMaterial('prop').type;
        out.both = hex();
        out.offB = e.plugins.off('ink/20-b'); out.afterB = hex(); out.aOn = e.plugins.list().find(p => p.name === 'ink/10-a')?.on;
        e.plugins.on('ink/20-b'); out.backB = hex();
        out.offPack = e.plugins.off('ink'); out.base = hex(); out.exposure = e.renderer.toneMappingExposure;
        out.slots = e.describe().slots.filter(s => s.file.startsWith('style ink')).map(s => s.affects.join());
        e.dispose?.();
        return out;
      });
      console.log('  plugin owners:', JSON.stringify(r));
      check('two style plugins replacing the same role: shared-conflict naming both plugins', /shared-conflict/.test(r.conflict) && /ink\/10-a/.test(r.conflict) && /ink\/20-b/.test(r.conflict), r.conflict);
      check('B (replaces A) wins; B off gives A\'s red with A still on; B on again is blue', r.both === 'MeshPhongMaterial' && r.afterB === 'MeshLambertMaterial' && r.aOn === true && r.backB === 'MeshPhongMaterial', JSON.stringify(r));
      check('off(pack) takes every plugin of the pack out (base material back) and says the pack\'s starting values stay', r.base === 'MeshToonMaterial' && r.offPack?.off?.length === 2 && /starting values/.test(r.offPack.note ?? '') && Math.abs(r.exposure - 1.3) < 1e-6, JSON.stringify({ base: r.base, offPack: r.offPack, exposure: r.exposure }));
    },
  },
  {
    name: '[guard] plugins composed: a material patch plugin off / on rebuilds the materials already made (look.materials.rebuild), keeping wind and cloud shadow',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        await engine.loading.settled(); engine.pause();
        const { THREE, applyEffects, materialPatches } = threedogTest, out = {};
        const m0 = applyEffects(engine.makeMaterial('pcrate', { color: 0x886644 }), { wind: 0.05, clouds: true, engine });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m0); engine.add(mesh, { id: 'pc-crate' });
        engine.plugins.add({ './plugins/70-tint.js': { default: { slot: 'color', glsl: 'diffuseColor.rgb *= vec3(0.2, 1.0, 0.2);', roles: ['pcrate'] } } });
        out.reach = engine.plugins.list().find(p => p.name === '70-tint')?.reach;
        out.start = materialPatches(mesh.material);   // the plugin was added after m0 was made: on() rebuilt it
        out.off = engine.plugins.off('70-tint');
        out.afterOff = materialPatches(mesh.material);
        out.color = mesh.material.color.getHex();
        engine.plugins.on('70-tint'); out.afterOn = materialPatches(mesh.material);
        out.noRebuild = engine.plugins.off('70-tint', { rebuild: false }); out.stale = materialPatches(mesh.material).includes('70-tint');
        out.manual = engine.look.materials.rebuild(); out.fresh = !materialPatches(mesh.material).includes('70-tint');
        engine.remove(mesh);
        return out;
      });
      console.log('  plugin material reach:', JSON.stringify(r));
      check('plugins.list() reports a patch plugin as reaching new materials only (off / on rebuilds the made ones)', r.reach?.join() === 'new materials only', JSON.stringify(r.reach));
      check('on: the material already on the mesh carries the patch; off: it is gone; wind and cloud shadow stay; the call color stays',
        r.start.includes('70-tint') && !r.afterOff.includes('70-tint') && ['wind', 'clouds'].every(n => r.afterOff.includes(n) && r.start.includes(n)) && r.afterOn.includes('70-tint') && r.color === 0x886644, JSON.stringify(r));
      check('off() says how many materials it rebuilt; { rebuild: false } leaves them and names the exact call', r.off?.rebuilt >= 1 && r.stale && /engine\.look\.materials\.rebuild\(\)/.test(r.noRebuild?.note ?? ''), JSON.stringify({ off: r.off, noRebuild: r.noRebuild }));
      check('look.materials.rebuild() brings the made materials in line and reports the count and time', r.fresh && r.manual?.rebuilt >= 1 && typeof r.manual.ms === 'number', JSON.stringify(r.manual));
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[guard] plugins composed (WebGL pixels): sky + weather + fog, material + wind + cloud shadow, bloom + grading + grain: each plugin off changes the picture, on gives the exact previous picture, the post order stays',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async PIX => {
        await engine.loading.settled(); engine.pause();
        const { THREE, postEffects: E, applyEffects } = threedogTest, out = {};
        const hold = engine.freeze('pc-pixels', { ambient: true }), px = (0, eval)(PIX);   // wind, clouds, weather stand still: two reads differ only by the plugins
        // material + wind + cloud shadow: a crate in front of the camera with both effects, and a tint patch plugin on its role
        const cam = engine.camera, ahead = cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(4).add(cam.position);
        const crate = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), applyEffects(engine.makeMaterial('pcomb', { color: 0xaa8855 }), { wind: 0.05, clouds: true, engine }));
        crate.position.copy(ahead); engine.add(crate, { id: 'pcomb-crate' });
        // fog as a module plugin (it writes look.fog under its own owner and lets go on dispose), with the page's sky and weather running
        const fogRule = { name: 'pcFog', type: 'look', install(en) { this.h = en.look.fog.set({ color: '#ff00ff', near: 1, far: 30 }, { owner: 'pcFog' }); }, dispose() { this.h?.remove(); } };
        engine.plugins.add({
          './plugins/80-fog.js': { default: fogRule },
          './plugins/81-tint.js': { default: { slot: 'color', glsl: 'diffuseColor.rgb *= vec3(0.3, 0.3, 1.0);', roles: ['pcomb'] } },
          './plugins/82-bloom.js': { default: E.bloom({ strength: 0.8, threshold: 0.2 }) },
          './plugins/83-grade.js': { default: E.lut({ contrast: 1.3, saturation: 0.6, temperature: 0.4 }) },
          './plugins/84-grain.js': { default: E.grain({ amount: 0.15, animated: false }) },
        });
        const order = () => engine.post.list().map(x => x.name).join();
        const base = px.read(), order0 = order();
        out.rows = {};
        for (const n of ['80-fog', '81-tint', '82-bloom', '83-grade', '84-grain']) {
          engine.plugins.off(n); const off = px.read();
          engine.plugins.on(n); const on = px.read();
          out.rows[n] = { changed: px.diff(base, off), back: px.diff(base, on), order: order() === order0 };
        }
        px.done(); hold?.remove?.();
        for (const n of ['80-fog', '81-tint', '82-bloom', '83-grade', '84-grain']) engine.plugins.off(n);
        engine.remove(crate);
        return out;
      }, PIX);
      console.log('  plugin combos:', JSON.stringify(r));
      for (const [n, x] of Object.entries(r.rows)) {
        check(`${n}: off changes the picture, on gives the exact previous picture, the post order is the same`, x.changed > 2 && x.back === 0 && x.order, JSON.stringify(x));
      }
    },
  },
  {
    software: true,   // reads rendered pixels: stays on software rendering (same pixels on every machine)
    name: '[guard] plugins composed on WebGPU and WebGL: two post plugins whose result depends on their order keep it across off / on, and on gives the picture back',
    url: '/tests/engine-webgpu/index.html',
    async run({ check, ev }) {
      const r = await ev(() => window.pluginOrderRoutes());
      console.log('  plugin order routes:', JSON.stringify(r));
      for (const k of ['gl', 'gpu']) {
        const x = r[k];
        check(`${k}: half then lift (plugin order); each off changes the picture, on gives it back (as close as two untouched frames) and the order stays`,
          x.order === 'half,lift' && ['60-half', '61-lift'].every(n => x[n].changed > 5 && x[n].back <= Math.max(x.still, 0.05) && x[n].order), JSON.stringify(x));
      }
    },
  },
];
