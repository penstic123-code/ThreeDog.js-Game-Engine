// 所有权（core/owned.js）："不许绕开"的检查。每个登记过的引擎自写属性都必须在 CASES 里有一条用例，
// 否则第一条检查就失败——新登记一个属性却不写用例，过不了。每条用例跑三步：
//   (a) 游戏不接管直接写 → 引擎让开，值留着，恰好一条警告且含接管原文
//   (b) look.<part>.manual(key) → 引擎不再写，也不警告
//   (c) manual(key, false) 交还 → 引擎恢复驱动
// 另有原生对拍：同一个小场景，纯 three.js 渲染和引擎（画面捷径全关）渲染，像素一致。
// Same format as the other files here.

// 每个 id：poke = 游戏直接写（返回写进去的值），get = 读当前值，drive = 让引擎有机会写一次（一帧，或该属性的引擎写入点）
const CASES = `({
  'sun.intensity': { poke: () => (engine.lights.sun.intensity = 77), get: () => engine.lights.sun.intensity },
  'sun.color': { poke: () => { engine.lights.sun.color.setRGB(0.123, 0.2, 0.3); return 0.123; }, get: () => engine.lights.sun.color.r },
  'sun.direction': { poke: () => { const s = engine.lights.sun; s.position.copy(s.target.position).add(new engine.THREE.Vector3(0, 0.5, 100)); return 0; },
    get: () => { const s = engine.lights.sun; return +(s.position.clone().sub(s.target.position).normalize().x).toFixed(3); }, drive: () => { engine.calendar.timeOfDay = (engine.calendar.timeOfDay + 0.07) % 1; engine.step(0.05); } },
  'shadow.follow': { poke: () => (engine.lights.sun.target.position.x = 9999), get: () => engine.lights.sun.target.position.x },
  'hemi': { poke: () => (engine.lights.hemi.intensity = 55), get: () => engine.lights.hemi.intensity },
  'fog': { poke: () => { engine.scene.fog.color.setRGB(0.011, 0.5, 0.5); return 0.011; }, get: () => engine.scene.fog.color.r },
  'exposure': { setup: () => (window.__hT = engine.look.tone.set({ exposure: [[0, 1.1], [0.5, 1.4]] }, { owner: 'ownedTest' })), poke: () => (engine.renderer.toneMappingExposure = 3.3), get: () => engine.renderer.toneMappingExposure,
    drive: () => { engine.calendar.timeOfDay = (engine.calendar.timeOfDay + 0.05) % 1; engine.step(0.05); }, teardown: () => window.__hT.remove() },
  'background': { poke: () => (engine.scene.background = window.__bg ??= new engine.THREE.Color(0.9, 0.1, 0.1)), get: () => engine.scene.background,
    // with the dome the sky does not write scene.background; it draws over it. Owned means: game takes it -> dome hides, hand back -> dome shows
    engineWrites: () => !!engine.sky._backdrop || !!engine.sky.skybox, domeShown: () => engine.sky.dome.visible },
  'env': { setup: () => (window.__hE = engine.look.env.replace('sky', { owner: 'ownedTest' })), teardown: () => window.__hE.remove(), poke: () => (engine.scene.environment = window.__envTex ??= new engine.THREE.Texture()), get: () => engine.scene.environment,
    drive: () => { if (engine.sky._env) engine.sky._env.key = null; engine.sky._envFrame(1e4); } },
  'camera.fov': { setup: () => (window.__fov0 = engine.camera.fov), poke: () => (engine.camera.fov = 33), get: () => engine.camera.fov,
    drive: () => engine._setFov(61.5), teardown: () => engine._setFov(window.__fov0) },
  'camera.far': { poke: () => (engine.camera.far = 4321), get: () => engine.camera.far, drive: () => engine.viewFar(engine.camera.far + 100) },
  'pixelRatio': { poke: () => { engine.renderer.setPixelRatio(0.77); return 0.77; }, get: () => engine.renderer.getPixelRatio(),
    drive: () => { const a = engine.adaptive, was = { on: a.on, paused: a.paused, min: a.min }; Object.assign(a, { on: true, paused: false, cooldown: 0, t: 0, age: 10, min: 0.3 }); engine._adapt(1, 1000, false, true); Object.assign(a, was); } },   // one heavy 1 s window past the startup grace
  // written once at creation, never per frame: drive = describe() (the read that notices a direct write); quiet = the yield warns nothing,
  // because a direct renderer.toneMapping write is the documented way to change the curve; hand-back writes the creation curve again
  'toneMapping': { poke: () => (engine.renderer.toneMapping = engine.THREE.NeutralToneMapping), get: () => engine.renderer.toneMapping, drive: () => engine.describe(), quiet: true },
  'camera': { skip: 'tests/specs/b.mjs "[guard] Camera" (the vehicle page has a camera module)' },
  // never yields (a write to post.object() is replaced on the next chain change, post-fuse.mjs); manual() is checked on both backends there
  'post.chain': { skip: 'tests/specs/post-webgpu.mjs "[guard] post on WebGPU" (manual() stops rebuilds)' },
})`;

import { readFileSync } from 'node:fs';

export const specs = [
  {
    name: '[guard] owned: every engine-written property yields to a direct write (one warning with the takeover call), manual() stops the engine, manual(k, false) hands back',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async (CASES) => {
        await engine.loading.settled();
        engine.pause(); engine.step(0.05);
        const C = (0, eval)(CASES), owned = engine.describe().owned, out = { missing: Object.keys(owned).filter(id => !C[id]), rows: {} };
        const near = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-3 : a === b);
        for (const [id, row] of Object.entries(owned)) {
          const c = C[id];
          if (!c || c.skip) continue;
          const part = engine.look[row.part], drive = c.drive ?? (() => engine.step(0.05));
          const res = out.rows[id] = {};
          c.setup?.(); drive(); drive();
          // (a) direct write: the engine yields, the value stays, one warning naming the takeover
          let v;
          const a = await __t.warns(() => { v = c.poke(); drive(); drive(); });
          res.a = { yielded: engine.describe().owned[id].writer, stays: near(c.get(), v), warns: a.warns.filter(w => w.includes(`${id} was changed outside`) && w.includes(row.manual)).length, quiet: !!c.quiet };
          if (c.domeShown) res.a.domeHidden = !c.domeShown();
          // (c) hand back: the engine drives it again (the value moves off the game's)
          part.manual(row.key, false); drive(); drive();
          res.c = { by: engine.describe().owned[id].writer, moved: c.engineWrites && !c.engineWrites() ? c.domeShown() : !near(c.get(), v) };
          // (b) manual: the engine stops, no warning, describe().owned and describe().look say manual:game
          const b = await __t.warns(() => { part.manual(row.key); v = c.poke(); drive(); drive(); });
          res.b = { by: engine.describe().owned[id].writer, stays: near(c.get(), v), warns: b.warns.filter(w => w.includes(id)).length };
          part.manual(row.key, false); drive();
          c.teardown?.();
        }
        let typo = ''; try { engine.look.lights.manual('sunn'); } catch (err) { typo = err.message; }
        out.catalog = engine.catalog('look.lights').verbs;
        out.typo = typo;
        out.ids = Object.keys(owned);
        out.lookWriter = (() => { const h = engine.look.lights.manual('sun'); const o = engine.describe().look.lights['sun.intensity'].writer; h.remove(); return o; })();
        return out;
      }, CASES);
      check('every registered owned property has a case here (registering one without a test fails)', r.missing.length === 0, JSON.stringify(r.missing));
      const rows = Object.entries(r.rows);
      check('rows ran (sky page: sun, hemi, fog, exposure, background, env, camera.far, pixelRatio ...)', rows.length >= 8, rows.map(([k]) => k).join());
      for (const [id, x] of rows) {
        check(`${id} (a): direct write -> engine yields, value stays, exactly one warning with the takeover call (none for a quiet once-written one)`, /yielded/.test(x.a.yielded) && x.a.stays && x.a.warns === (x.a.quiet ? 0 : 1) && x.a.domeHidden !== false, JSON.stringify(x.a));
        check(`${id} (c): manual(key, false) -> the engine drives it again`, x.c.by === 'engine' && x.c.moved, JSON.stringify(x.c));
        check(`${id} (b): manual(key) -> the engine stops writing, no warning, describe().owned says manual:game`, x.b.by === 'manual:game' && x.b.stays && x.b.warns === 0, JSON.stringify(x.b));
      }
      // the ownership table in recipe 52 must list every registered id (camera too: registered on camera-module pages); read here in node
      const md = readFileSync(new URL('../../docs/recipes/52-look.md', import.meta.url), 'utf8');
      const undocumented = [...r.ids, 'camera'].filter(id => !md.includes('| `' + id + '`'));
      check('recipe 52 "Who writes it" lists every registered id', undocumented.length === 0, JSON.stringify(undocumented));
      check('manual() is a listed verb; a typo throws with the keys; describe().look shows the writer', r.catalog.includes('manual') && /keys: .*sun\.intensity/.test(r.typo) && r.lookWriter === 'manual:game', JSON.stringify([r.catalog, r.typo, r.lookOwner]));
    },
  },
  {
    name: "[guard] parity: a small scene in plain three.js and in the engine with the look shortcuts off render the same pixels (the engine adds nothing hidden)",
    url: '/tests/parity/index.html',
    software: true,   // compares pixels; the read happens inside the page's parity()
    async run({ check, ev }) {
      const r = await ev(() => window.parity());
      check('engine vs plain three.js: mean channel difference < 0.5, max < 8 (of 255)', r.mean < 0.5 && r.max < 8 && r.lit > 0.2, JSON.stringify(r));
    },
  },
  {
    name: "[guard] parity on WebGPU: the same scene, createEngine({ renderer: 'webgpu' }) vs a plain WebGPURenderer on the same backend, same pixels",
    url: '/tests/parity/index.html?backend=webgpu',
    software: true,
    async run({ check, ev }) {
      const r = await ev(() => window.parity());
      console.log('  webgpu parity numbers:', JSON.stringify(r));
      check(`engine (${r.backend}) vs plain WebGPURenderer: mean channel difference < 0.5, max < 8 (of 255)`,
        ['webgpu', 'webgl2'].includes(r.backend) && r.mean < 0.5 && r.max < 8 && r.lit > 0.2, JSON.stringify(r));
      // the tier is known only after init() on WebGPU; the MSAA default must follow it (it once kept the pre-init 'high' guess: edge pixels off by 126)
      check('MSAA default follows the tier detected after init (low -> off)', r.engine.msaa === (r.engine.tier !== 'low'), JSON.stringify(r.engine));
    },
  },
];
