// Batch 3, group C specs (same format as packages/engine/tests/specs.mjs); appended at the end of specs.mjs.
// Covers budget, shadow options, HLOD, scenario option hooks, settings menu freezing gameplay, startup time (numbers only).
// For detailed performance comparison see node packages/tools/perf.mjs and packages/engine/docs/PERF.md.
export const specs = [
  {
    name: '性能预算（小城示例）',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const off = engine.budget.report();
        engine.budget.enable({ drawCalls: 1 });
        engine.step(0.1);
        const on = engine.budget.report(), desc = engine.describe().perf.budget;
        engine.budget.enable({});   // no limits given = nothing is checked
        engine.step(0.1);
        const none = engine.budget.report();
        const metric = engine.budget.metric('crates', () => 99, { limit: 10 });
        const custom = engine.budget.report().over.map(o => o.category);
        metric.remove(); engine.budget.disable(); engine.resume();
        return { off, on, desc: !!desc, none, custom };
      });
      check('report() is null when budget is off', r.off === null);
      check('drawCalls over limit and the top consumers are listed', r.on && !r.on.ok && r.on.over[0].category === 'drawCalls' && r.on.over[0].top.length > 0, JSON.stringify(r.on));
      check('describe().perf.budget has a report', r.desc);
      check('categories without a limit are not checked', r.none?.ok === true, JSON.stringify(r.none));
      check('module custom category metric takes effect', r.custom.includes('crates'), r.custom.join(','));
    },
  },
  {
    name: '阴影：updateEvery 与参数可配（小城示例）',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const sm = engine.renderer.shadowMap, orig = sm.render.bind(sm);
        let n = 0;
        sm.render = (...a) => { if (sm.autoUpdate || sm.needsUpdate) n++; orig(...a); };
        const def = { ...engine.sky.shadow, bias: engine.sky.sun.shadow.bias, auto: sm.autoUpdate };
        engine.sky.setShadow({ updateEvery: 4, bias: -0.001 });
        engine.step(1 / 60);   // first frame (setShadow requests one update)
        n = 0;
        for (let i = 0; i < 8; i++) engine.step(1 / 60);
        const every4 = n, bias = engine.sky.sun.shadow.bias;
        engine.sky.setShadow({ updateEvery: 1, bias: def.bias, snap: 'texel' });
        n = 0;
        for (let i = 0; i < 4; i++) engine.step(1 / 60);
        const every1 = n;
        engine.sky.setShadow({ snap: 0.5 });
        sm.render = orig; engine.resume();
        return { def, every4, every1, bias };
      });
      check('defaults match the old behavior (update every frame, 0.5 m snap, bias -0.0006)', r.def.updateEvery === 1 && r.def.snap === 0.5 && r.def.bias === -0.0006 && r.def.auto, JSON.stringify(r.def));
      check('updateEvery: 4 updates twice in 8 frames', r.every4 === 2, r.every4);
      check('bias is configurable', r.bias === -0.001, r.bias);
      check('updateEvery: 1 + texel updates every frame', r.every1 === 4, r.every1);
    },
  },
  {
    name: 'HLOD：远处合并成代理（C 组测试页街区）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const h = engine.hlod;
        await new Promise(res => { const t = () => (h.cells.length && !engine.jobs.pending ? res() : setTimeout(t, 50)); t(); });
        engine.pause();
        const calls = () => { engine.step(0.5); return engine.renderer.info.render.calls; };
        engine.focus.set(0, 0, 0); const near = calls();
        const nearVisible = engine.level.root.getObjectByName('b_3_3').visible;
        engine.focus.set(400, 0, 400); const far = calls();
        const farState = { orig: engine.level.root.getObjectByName('b_3_3').visible, allFar: h.cells.every(c => c.far), proxies: h.cells.reduce((n, c) => n + c.proxy.length, 0) };
        engine.focus.set(0, 0, 0); const back = calls();
        const lod = engine.level.root.getObjectByName('b_0_0_LOD1').visible;
        engine.resume();
        return { near, far, back, nearVisible, ...farState, cells: h.cells.length, lod, d: engine.describe().hlod };
      });
      check('merged cells were built', r.cells > 0 && r.proxies > 0, JSON.stringify(r));
      check('focus moved 400 m away: everything switches to proxies, originals hidden', r.allFar && !r.orig, JSON.stringify(r));
      check(`draw calls drop clearly (near ${r.near} → far ${r.far})`, r.far < r.near * 0.5, `near ${r.near} → far ${r.far}`);
      check('originals visible again after moving back', r.back === r.near && r.nearVisible, `back ${r.back}`);
      check('_LOD1 nodes are hidden normally', r.lod === false);
      check('describe().hlod', r.d?.cells === r.cells, JSON.stringify(r.d));
    },
  },
  {
    name: '现场参数钩子（sky.timeOfDay、weather）与设置菜单冻结玩法',
    url: '/tests/perf/index.html?mode=city',
    async run({ page, check, ev, frames }) {
      const r = await ev(() => {
        const sky = engine.modules.get('sky'), w = engine.modules.get('weather');
        sky.applyState(engine, { time: '18:30' }); const clock = engine.sky.clock;
        sky.applyState(engine, { time: '0.25' }); const t = engine.sky.timeOfDay;
        w.applyState(engine, { weather: 'rain' });
        return { clock, t, weather: engine.weather.name, rain: engine.weather.current.rain, auto: engine.weather.auto };
      });
      check('time 18:30 → sky.clock', r.clock === '18:30', r.clock);
      check('time 0.25 (text from the URL) → sky.timeOfDay', r.t === 0.25, r.t);
      check('weather rain applies immediately and turns off auto weather', r.weather === 'rain' && r.rain > 0.5 && !r.auto, JSON.stringify(r));
      await page.mouse.click(640, 360);
      await ev(() => engine.settings.open()); await frames(2);
      // frozen: frame hooks still run, fixed steps (engine.elapsed) do not
      const frozen = await ev(async () => { const t = engine.elapsed, f = engine.frozen; await __t.frames(15); return { f, same: engine.elapsed === t }; });
      check('freezeWorld: gameplay frozen and time stopped while the menu is open', frozen.f && frozen.same, JSON.stringify(frozen));
      await ev(() => engine.settings.close()); await frames(2);
      check('unfrozen after the menu closes', await ev(async () => { const t = engine.elapsed; await __t.until(() => engine.elapsed > t, 10000).catch(() => {}); return !engine.frozen && engine.elapsed > t; }));
    },
  },
  {
    name: '天空修饰层（天气层 + 游戏层相乘，互不覆盖）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.modules.get('weather').applyState(engine, { weather: 'rain' }); engine.step(0.1);
        const M = engine.sky.modifiers, w = { sun: M.sun, fog: M.fog, tint: M.tintAmount };
        engine.sky.modify('dtest', { sun: 0.5, fog: 0.5 }); engine.step(0.1);
        const both = { sun: M.sun, fog: M.fog, tint: M.tintAmount };
        engine.sky.modify('dtest', null); engine.step(0.1);
        return { w, both, back: M.sun, rain: engine.weather.current.sun, grey: engine.weather.current.grey };
      });
      check('weather layer only: matches the weather values (default behavior unchanged)', Math.abs(r.w.sun - r.rain) < 1e-6 && Math.abs(r.w.tint - r.grey) < 1e-6, JSON.stringify(r));
      check('with a game layer: multiplied, not overwritten by weather', Math.abs(r.both.sun - r.w.sun * 0.5) < 1e-6 && Math.abs(r.both.fog - r.w.fog * 0.5) < 1e-6, JSON.stringify(r));
      check('removing the game layer restores the values', Math.abs(r.back - r.w.sun) < 1e-6, JSON.stringify(r));
    },
  },
  {
    name: 'X：钩子出错隔离（错误分级：游戏回调出错冻结玩法、帧钩子照跑）、按键刚按下照常清空',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const logs = [], orig = console.error; console.error = (...a) => logs.push(String(a[0]));   // expected errors must not count as console errors
        let after = 0;
        const bad1 = engine.onFrame(() => { throw new Error('坏 onFrame'); });
        const bad2 = engine.onFixed(() => { throw new Error('坏 onFixed'); });
        const good = engine.onFrame(() => { after++; });
        engine.input.justPressed.add('KeyE');
        engine.step(0.2);
        const cleared = !engine.input.justPressed.has('KeyE');
        engine.step(0.2);
        bad1.remove(); bad2.remove(); good.remove();
        console.error = orig; engine.resume();
        return { after, cleared, reports: logs.length, error: engine.error, frozen: engine.frozen };
      });
      check('onFrame after a bad hook still runs', r.after >= 6, JSON.stringify(r));
      check('input.endFrame still runs (just-pressed keys are cleared)', r.cleared, JSON.stringify(r));
      check('an error from the same hook is reported once (two bad hooks → 2 reports)', r.reports === 2, JSON.stringify(r));
      check('game callback error in test mode: engine.error records it, gameplay frozen', /onFixed/.test(r.error?.where) && r.frozen, JSON.stringify(r));
    },
  },
  {
    name: 'X：HLOD 远处隐藏原件，射线照样打得到',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const h = engine.hlod;
        await new Promise(res => { const t = () => (h.cells.length && !engine.jobs.pending ? res() : setTimeout(t, 50)); t(); });
        engine.pause();
        const b = engine.level.root.getObjectByName('b_3_3');
        const down = () => engine.raycast([b.position.x, 200, b.position.z], [0, -1, 0])?.object?.name ?? null;
        engine.focus.set(0, 0, 0); engine.step(0.5); const near = down();
        engine.focus.set(400, 0, 400); engine.step(0.5); const far = down(), hidden = !b.visible;
        engine.focus.set(0, 0, 0); engine.step(0.5);
        engine.resume();
        return { near, far, hidden };
      });
      check('ray hits the original when near', r.near === 'b_3_3', JSON.stringify(r));
      check('ray still hits the original when it is hidden far away (proxy shown)', r.hidden && r.far === 'b_3_3', JSON.stringify(r));
    },
  },
  {
    name: 'X：烘焙读回保留材质设置、射线登记随几何体释放',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { THREE, makeMaterial, toGLB } = threedogTest;
        const mat = makeMaterial('prop', { color: 0x808080, flatShading: true, transparent: true, opacity: 0.5, side: THREE.DoubleSide, emissive: 0x332211 });
        const buf = await toGLB(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
        const url = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' })) + '#x.glb';
        const m = (await engine.assets.model(url)).getObjectByProperty('isMesh', true).material;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); engine.add(mesh);
        engine.rays.addStatic(mesh); const had = engine.rays.statics.has(mesh);
        mesh.geometry.dispose(); const gone = !engine.rays.statics.has(mesh); engine.detach(mesh);
        return { purpose: m.userData.purpose, flat: m.flatShading, tr: m.transparent, op: m.opacity, side: m.side === THREE.DoubleSide,
          em: m.emissive?.getHex(), want: new THREE.Color(0x332211).getHex(), had, gone };
      });
      check('rebuilt by role, keeping flatShading / transparent / opacity / side / emissive', r.purpose === 'prop' && r.flat && r.tr && r.op === 0.5 && r.side && r.em === r.want, JSON.stringify(r));
      check('ray registration is removed automatically after geometry dispose', r.had && r.gone, JSON.stringify(r));
    },
  },
  {
    name: 'X：确定性（step 下 jobs 做完、stream 同步挂上、engine.random 可复现、冻结）',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        let n = 0; engine.jobs.add(function* () { for (let i = 0; i < 200; i++) { n++; yield; } });
        engine.step(1 / 30); const jobsDone = n === 200 && engine.jobs.pending === 0;
        const h = engine.stream.add({ position: [engine.focus.x + 2, 0, engine.focus.z], build: () => new threedogTest.THREE.Object3D() });
        engine.step(1 / 30); const stream = { built: h.built, ready: engine.stream.ready, inScene: !!h.object?.parent }; h.remove();
        const seq = () => { engine.random.setSeed(5); return [1, 2, 3].map(() => engine.random.next()); };
        const same = JSON.stringify(seq()) === JSON.stringify(seq());
        engine.random.setSeed(9); engine.random.next(); const saved = engine.saves.collect();
        const a = engine.random.next(); engine.saves.apply(saved); const b = engine.random.next();
        const auto = () => { engine.random.setSeed(7); engine.weather.set('clear', 0.01); engine.weather.setAuto(true); engine.step(0.1); return engine.weather.name; };
        const w1 = auto(), w2 = auto(); engine.weather.setAuto(false);
        engine.freeze('xtest'); const t0 = engine.elapsed, c0 = engine.clock.now; engine.step(1);
        const frozen = engine.elapsed === t0 && engine.clock.now === c0; engine.unfreeze('xtest');
        engine.resume();
        return { jobsDone, stream, same, resume: a === b, w1, w2, frozen };
      });
      check('generator jobs in step ignore real time and finish in one frame', r.jobsDone, JSON.stringify(r));
      check('stream sync build: built, ready and in the scene when step returns', r.stream.built && r.stream.ready && r.stream.inScene, JSON.stringify(r.stream));
      check('engine.random: same seed gives same sequence; continues the sequence after load', r.same && r.resume, JSON.stringify(r));
      check('auto weather uses engine.random (same seed, same result)', r.w1 === r.w2, JSON.stringify(r));
      check('elapsed and clock.now both stop while frozen', r.frozen, JSON.stringify(r));
    },
  },
  {
    name: 'X：读档（函数定时按剩余时间、vars 往返）、阴影开关、手柄键、显示名',
    url: '/tests/perf/index.html?mode=city',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        let fired = 0; engine.clock.after(10, () => fired++);
        const d = engine.saves.collect(); d.parts.clock.now = engine.clock.now - 1000;
        engine.saves.apply(d); engine.step(5); const early = fired; engine.step(6); const late = fired;
        engine.vars.setFlag('xKeep'); engine.vars.bump('xCount', 3);
        engine.saves.apply(engine.saves.collect());
        const varsOk = engine.vars.flag('xKeep') === true && engine.vars.counter('xCount') === 3;
        const L = new threedogTest.THREE.PointLight(); L.castShadow = false; engine.add(L);
        engine.setShadows(false); engine.setShadows(true);
        const shadows = { game: L.castShadow, sun: engine.sky.sun.castShadow }; engine.remove(L);
        engine.input.define('xPad', ['KeyZ'], 'x', { pad: 'PadY' });
        const pad = { custom: engine.input.keysOf('xPad').includes('PadY'), noPhoto: engine.input.padDefaults.photo === undefined };
        engine.modules.get('weather').applyState(engine, { weather: 'rain' });
        const d2 = engine.describe(), label = d2.weather.label, text = engine.describeText();
        engine.resume();
        return { early, late, varsOk, shadows, pad, label, textHas: text.includes('Weather: 雨'), isDay: engine.sky.isDay === engine.sky.daylight > 0 };
      });
      check('function-type after expires by remaining time after load', r.early === 0 && r.late === 1, JSON.stringify(r));
      check('vars: apply(collect()) keeps flags and counters', r.varsOk, JSON.stringify(r));
      check('setShadows off then on: lights the game turned off stay off, the sun is restored', r.shadows.game === false && r.shadows.sun === true, JSON.stringify(r.shadows));
      check('gamepad button comes from define({ pad }); the engine no longer special-cases photo', r.pad.custom && r.pad.noPhoto, JSON.stringify(r.pad));
      check('weather display name comes from the string table (describe label, describeText)', r.label === '雨' && r.textHas, JSON.stringify(r));
      check('sky.isDay agrees with daylight', r.isDay);
    },
  },
  {
    name: 'startup time (numbers are only reported, no threshold)',
    url: '/',
    async run({ check, ev, page }) {
      for (const [name, url] of [['open world', '/'], ['city', '/tests/city/index.html']]) {
        if (url !== '/') { await page.goto(page.url().replace(/\/[^/]*$/, url)); await page.waitForFunction(() => window.engine?.ready, null, { timeout: 60000 }); }
        const s = await ev(() => engine.startup);
        check(`${name}: open to playable ${s?.totalMs} ms (start to playable ${s?.startMs} ms, first-screen chunks ${s?.modules.terrain?.ready ?? '—'} ms)`, !!s);
      }
    },
  },
];
