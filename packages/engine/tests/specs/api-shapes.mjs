// 1.0 接口冻结第 1、2 节：这些形状改了不报错、只是行为变，所以逐条钉住。
// 为什么单开一个文件：它们分属十几个模块，放进各自的测试里，改形状的人看不到"这是一条跨模块的约定"。
export const specs = [
  {
    name: 'API shapes: a get finds undefined, inventory.add always says ok, old top-level names are gone',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => engine.ops.allow(() => {
        const I = engine.inventory;
        I.define('shape-rock', { name: 'rock', stack: 1 });
        const box = I.container('shape-box', { capacity: 1 }), got = box.add('shape-rock'), full = box.add('shape-rock');
        return {
          none: [engine.grids?.get('nope'), I.get('nope'), box.get('nope'), engine.interactions.get('nope')].map(v => v === undefined),
          got, full, old: ['tick', 'cpuMs', 'cpuPhases', 'terms', 'view'].filter(k => k in engine),
          now: [typeof engine.time.tick, typeof engine.autoView.manual, typeof engine.shaderTerms.season],
        };
      }));
      check('every get answers undefined, not null', r.none.every(Boolean), JSON.stringify(r.none));
      check('add that fits: { ok: true, key, added }', r.got.ok === true && r.got.key === 'shape-rock' && r.got.added === 1, JSON.stringify(r.got));
      check('add that does not fit: { ok: false, code }', r.full.ok === false && r.full.code === 'full' && r.full.facts.id === 'shape-rock', JSON.stringify(r.full));
      check('engine.tick, cpuMs, cpuPhases, terms and view are gone', r.old.length === 0, r.old.join());
      check('their replacements are there', r.now.join() === 'number,function,function', r.now.join());
    },
  },
  {
    name: 'API shapes: clock.after takes { data, channel } and stops an old call',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.timeline.skip(); engine.haltLoop();
        const code = f => { try { f(); return null; } catch (e) { return e.code ?? e.message; } };
        let got = null; const h = engine.events.on('shape:due', d => { got = d; });
        engine.clock.after(0.1, 'shape:due', { data: { x: 1 }, channel: 'real' });
        engine.step(0.3, { render: false }); h.remove();
        return { got, dataAsOpts: code(() => engine.clock.after(1, 'shape:due', { x: 1 })) };
      });
      check('the event carries data on the channel it was given', r.got?.x === 1, JSON.stringify(r.got));
      check('data passed where the options go throws, it does not fire empty', r.dataAsOpts === 'module-params', String(r.dataAsOpts));
    },
  },
  {
    // 为什么：这几个值原来写属性只改数字，远裁面、植物、流式加载都不跟，也没有报错。
    name: 'API shapes: writing a value with side effects works like its setter',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const E = engine, out = {};
        E.stream._dirty = false; E.stream.radius = 77; out.radius = [E.stream.radius, E.stream._dirty];
        if (E.weather) { E.weather.autoTimer = 5; E.weather.auto = true; out.auto = [E.weather.auto, E.weather.autoTimer]; E.weather.auto = false; }
        const aa = E.post.antialias; E.post.antialias = !aa; out.aa = E.post.antialias === !aa; E.post.antialias = aa;
        if (E.terrain) { const v = E.terrain.vgen; E.terrain.density = 0.5; out.density = [E.terrain.density, E.terrain.vgen - v]; E.terrain.viewChunks = E.terrain.viewChunks; }
        return out;
      });
      check('stream.radius marks the stream dirty', r.radius[0] === 77 && r.radius[1] === true, JSON.stringify(r.radius));
      check('weather.auto restarts the timer', !r.auto || (r.auto[0] === true && r.auto[1] === 0), JSON.stringify(r.auto));
      check('post.antialias switches', r.aa === true);
      check('terrain.density places plants again', !r.density || (r.density[0] === 0.5 && r.density[1] === 1), JSON.stringify(r.density));
    },
  },
];
