// Low-level conventions; same style as the other files here.
// 1.3 module lifecycle: entering / leaving levels does not accumulate, no callbacks after engine.dispose(), UI elements and listeners are all released.
export const specs = [
  {
    name: 'S1 lifecycle: 10 level enters / exits, listeners, timers and geometries do not grow (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE;
        engine.assets.manifest({ models: { 's1-level2': () => {
          const g = new T.Group(), floor = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial());
          floor.name = 'ground'; floor.position.y = -0.5; g.add(floor); return g;
        } } });
        // common game pattern: after each level loads, attach level-owned things and hand them to level.track to be released on level change
        engine.events.on('level:loaded', () => {
          const L = engine.level;
          L.track(engine.triggers.add({ position: [0, 0, 0], radius: 2, tag: 's1' }));
          L.track(engine.clock.every(5, () => {}));
          L.track(engine.events.on('item:add', () => {}));
          L.track(engine.onFixed(() => {}));
          const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
          engine.add(m); L.track({ remove: () => engine.remove(m) });
          // renderer.info.memory.geometries only counts geometries that have been drawn. Whether a building falls inside the view depends on how far the
          // player/camera has moved when the sample is taken (slower under load: the physics engine starts late), which made the count flip by 1
          // without any leak. Turning culling off makes every visible mesh get drawn, so the count no longer depends on timing.
          engine.scene.traverse(n => { n.frustumCulled = false; });
        });
        const round = async () => { await engine.level.load('s1-level2'); engine.step(0.1); await engine.level.load('city-block'); engine.step(0.1); };
        await round();
        const first = engine.counts();
        for (let i = 0; i < 9; i++) await round();
        const tenth = engine.counts();
        for (let i = 0; i < 10; i++) await round();   // 20 rounds: still no growth, so the 10-round plateau is not just a slower leak
        return { first, last: tenth, twentieth: engine.counts() };
      });
      const keys = ['listeners', 'fixed', 'frame', 'timers', 'statics', 'geometries', 'textures', 'streamEntries'];
      const grown = keys.filter(k => r.last[k] > r.first[k] || r.twentieth[k] > r.first[k]);
      check('engine.counts() gives all counts', keys.every(k => typeof r.first[k] === 'number'), JSON.stringify(r.first));
      check('Counts are the same after the 1st and 10th level enter / exit (no accumulation)', grown.length === 0, grown.map(k => `${k}: ${r.first[k]} → ${r.last[k]}`).join(', '));
    },
  },
  {
    name: 'S1 lifecycle: no callbacks after engine.dispose(), module dispose runs in reverse order (open world)',
    url: '/',
    async run({ check, ev, wait }) {
      await ev(() => {
        const calls = window.s1 = { order: [], fixed: 0, frame: 0, timer: 0, event: 0 };
        engine.use({ name: 's1a', type: 'rules', dispose: () => calls.order.push('s1a') }, { name: 's1b', type: 'rules', dispose: () => calls.order.push('s1b') });
        engine.onFixed(() => calls.fixed++);
        engine.onFrame(() => calls.frame++);
        engine.clock.every(0.05, () => calls.timer++);
        engine.events.on('s1:ping', () => calls.event++);
        engine.dispose();
        engine.dispose();   // calling again is harmless
        calls.after = { fixed: calls.fixed, frame: calls.frame, timer: calls.timer };
        engine.events.emit('s1:ping');
      });
      await wait(400);
      const r = await ev(() => {
        // elements already in the page HTML (the example's photo bar, instructions) do not count; engine-built ones carry the threedog- class or hang under uiRoot
        const leftovers = [...document.body.querySelectorAll('[class*="threedog-"]')];
        return { ...window.s1, counts: engine.counts(), disposed: engine.disposed, ready: engine.ready,
          rootGone: !engine.uiRoot.isConnected, leftovers: leftovers.map(el => el.className) };
      });
      check('Module dispose hooks run once, in reverse install order', JSON.stringify(r.order) === '["s1b","s1a"]', JSON.stringify(r.order));
      check('After dispose, onFixed / onFrame / clock no longer call back', r.fixed === r.after.fixed && r.frame === r.after.frame && r.timer === r.after.timer, JSON.stringify(r));
      check('After dispose, events are no longer delivered', r.event === 0);
      check('engine.disposed is true, ready is false', r.disposed === true && r.ready === false);
      const c = r.counts;
      check('Listeners, hooks, timers, raycast registrations and on-demand streaming are all cleared', !c.listeners && !c.fixed && !c.frame && !c.timers && !c.statics && !c.streamEntries && !c.jobs, JSON.stringify(c));
      check('All UI elements built by the engine and modules are removed (uiRoot and every threedog- element)', r.rootGone && r.leftovers.length === 0, r.leftovers.join(', '));
    },
  },
  {
    name: 'S1 resource ref counting: removing one of two copies leaves the other working, release waits for the last one, trim frees unused ones (small town)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const T = engine.THREE, A = engine.assets;
        // a small model that generates fast (under 20 ms in dev; also guards against the "fast generation returns undefined" regression)
        A.manifest({ models: { 's1-box': () => { const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial())); return g; } } });
        const a = engine.add(await A.model('s1-box')), b = engine.add(await A.model('s1-box'));
        const geo = b.children[0].geometry; let disposed = 0; geo.addEventListener('dispose', () => disposed++);
        const out = { shared: a.children[0].geometry === geo, users2: A.users('s1-box') };
        engine.remove(a); engine.step(0.05);
        out.afterA = { users: A.users('s1-box'), disposed, bOk: !!b.parent && b.children[0].geometry === geo };
        A.release('s1-box'); out.afterRelease = disposed;
        engine.remove(b); out.afterB = disposed;
        const c = engine.add(await A.model('s1-box')), geo2 = c.children[0].geometry; let d2 = 0; geo2.addEventListener('dispose', () => d2++);
        engine.remove(c);
        out.beforeTrim = d2; out.trimmed = A.trim(); out.afterTrim = d2;
        return out;
      });
      check('Two copies share the geometry, user count 2', r.shared && r.users2 === 2, JSON.stringify(r));
      check('Remove one copy: user count 1, shared geometry not freed, the other works', r.afterA.users === 1 && r.afterA.disposed === 0 && r.afterA.bOk, JSON.stringify(r.afterA));
      check('release does not free while copies remain; frees only after the last is removed', r.afterRelease === 0 && r.afterB === 1, `${r.afterRelease} → ${r.afterB}`);
      check('After all copies are removed, trim() frees it', r.beforeTrim === 0 && r.afterTrim === 1 && r.trimmed.includes('s1-box'), JSON.stringify(r));
    },
  },
  {
    name: 'S1 error tiers: a look module error disables only that module; a gameplay error (inventory give throws) freezes gameplay and is recorded in engine.error (small town)',
    url: '/tests/city/index.html',
    expectErrors: /s1-boom|give failed/,   // this test deliberately causes two errors
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        let fxCalls = 0;
        engine.use({ name: 's1fx', type: 'look', frame() { fxCalls++; throw new Error('s1-boom'); } });
        engine.step(0.2);
        const t0 = engine.clock.now; engine.step(0.5);
        const fx = { disabled: engine.disabledModules.has('s1fx'), calls: fxCalls, error: engine.error, clockMoved: engine.clock.now > t0 };
        // gameplay: the inventory breaks when a quest reward gives an item (error inside an event listener; it used to be swallowed and the quest still counted as done)
        const inv = { give() { throw new Error('give failed'); } };
        let rewarded = false;
        engine.events.on('s1:reward', () => { inv.give('fish', 1); rewarded = true; });
        engine.events.emit('s1:reward');
        const t1 = engine.clock.now; engine.step(0.5);
        return { fx, rewarded, error: engine.error, frozen: engine.frozen, clockStopped: engine.clock.now === t1, text: engine.describeText().split('\n')[0] };
      });
      check('Look module error: disabled, called once, no engine.error, game time keeps running', r.fx.disabled && r.fx.calls === 1 && !r.fx.error && r.fx.clockMoved, JSON.stringify(r.fx));
      check('Gameplay error: engine.error records where and why', r.error?.message === 'give failed' && /s1:reward/.test(r.error.where) && !r.rewarded, JSON.stringify(r.error));
      check('Frozen after a gameplay error: game time stops', r.frozen && r.clockStopped);
      check('describeText reports the error on its first line', /Error, gameplay frozen/.test(r.text), r.text);
    },
  },
  {
    name: 'S1 module order: sorted by stage + before / after; a cycle or a misspelled stage throws at use() (open world)',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const order = engine.moduleOrder, at = n => order.indexOf(n);
        const pairs = [['timeline', 'cameraRig'], ['weather', 'sky'], ['sky', 'water'], ['interactions', 'dialogue'],
          ['particles', 'hud'], ['settings', 'hud'], ['hud', 'characters'], ['characters', 'music']];
        const wrong = pairs.filter(([a, b]) => at(a) >= 0 && at(b) >= 0 && at(a) > at(b)).map(p => p.join(' should precede '));
        const err = fn => { try { fn(); return null; } catch (e) { return e.message; } };
        engine.use({ name: 's1x', type: 'rules', after: ['s1y'] });
        const cycle = err(() => engine.use({ name: 's1y', type: 'rules', after: ['s1x'] }));
        const stage = err(() => engine.use({ name: 's1z', type: 'rules', stage: 'gamplay' }));
        engine.use({ name: 's1early', type: 'rules', stage: 'control', frame() {} });
        return { order, wrong, cycle, stage, yInstalled: engine.has('s1y'), earlyFirst: engine.moduleOrder.indexOf('s1early') < engine.moduleOrder.indexOf('terrain') };
      });
      check('moduleOrder sorts by stage and before / after (timeline -> camera, weather -> sky -> water, interaction -> dialogue, particles -> target marker...)', r.wrong.length === 0, r.wrong.join('; ') + ' | ' + r.order.join(' '));
      check('before / after form a cycle: use() throws and names the cycle, the module is not installed', /s1y -> s1x -> s1y|s1x -> s1y -> s1x/.test(r.cycle ?? '') && !r.yInstalled, r.cycle);
      check('Misspelled stage: throws and lists the available stages', /gamplay/.test(r.stage ?? '') && /gameplay/.test(r.stage ?? ''), r.stage);
      check('A control-stage module installed later is ordered before the world stage (terrain)', r.earlyFirst);
    },
  },
  {
    name: 'S1 background results: chunk collision takes effect on a fixed tick, and waiting for the async result matches computing it synchronously on the spot (open world)',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const p = engine.player.position, x = p.x, z = p.z;
        const count = () => { let n = 0; engine.ground.forEachCollider(x, z, 30, () => n++); return n; };
        const stepTo = tick => { while (engine.tick < tick) engine.step(1 / 60, { render: false }); };
        const run = async waitForWorker => {
          engine.terrain.rebuild();
          engine.step(1 / 30, { render: false });              // run the frame hook once: issues the chunk request
          const t0 = engine.tick, late0 = engine.commits.stats.late;
          // let the background thread send the results back: wait until every queued chunk was sent and answered
          //   (paused, so replies only collect in terrain.ready; a timeout falls through to the late path)
          const T = engine.terrain;
          if (waitForWorker) await __t.until(() => T.inFlight === 0 && !T._want.length && T.ready.length > 0, 10000).catch(() => {});
          engine.step(1 / 30, { render: false });              // frame hook uploads the arrived result for display (collision does not count yet)
          stepTo(t0 + 25); const before = count();
          stepTo(t0 + 70); const after = count();
          return { before, after, late: engine.commits.stats.late - late0 };
        };
        return { async: await run(true), sync: await run(false) };
      });
      check('Tree collision does not count before the effective tick (0 in both modes)', r.async.before === 0 && r.sync.before === 0, JSON.stringify(r));
      check('After the tick, both modes have the same collision count (> 0)', r.async.after > 0 && r.async.after === r.sync.after, JSON.stringify(r));
      check('Sync mode not finished by the tick: main thread generates on the spot (late > 0)', r.sync.late > 0, JSON.stringify(r));
    },
  },
  {
    name: 'S1 time-sliced jobs: results with apply take effect on a fixed tick; unfinished ones are finished on the spot at the tick (open world)',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const got = [];
        const t0 = engine.tick;
        engine.jobs.add(function* () { for (let i = 0; i < 5; i++) yield; return 42; }, { apply: v => got.push({ v, tick: engine.tick }) });
        engine.step(0.2, { render: false });                   // the job finished long ago, but the tick has not come
        const early = got.length;
        while (engine.tick < t0 + 31) engine.step(1 / 60, { render: false });
        const onTime = got[0];
        const t1 = engine.tick;
        engine.jobs.add(function* () { for (let i = 0; i < 1000; i++) yield; return 7; }, { apply: v => got.push({ v, tick: engine.tick }), lag: 1 });
        engine.step(1 / 60, { render: false });                // fixed step runs before jobs: at the tick it has not started yet
        engine.events.emit('s1:ev', { a: 1, obj: engine.scene });
        const ev = engine.events.recent('s1:ev').at(-1);
        return { early, onTime, t0, forced: got[1], t1, pending: engine.jobs.pending, ev, tick: engine.tick };
      });
      check('Waits for the tick even when done: no effect before it', r.early === 0, JSON.stringify(r));
      check('Takes effect on the 30th tick after the request, with the right result', r.onTime?.v === 42 && r.onTime.tick === r.t0 + 30, JSON.stringify(r));
      check('Event history: recent() records the tick and a data summary (objects shown as …)', r.ev?.tick === r.tick && r.ev.data.a === 1 && r.ev.data.obj === '…', JSON.stringify(r.ev));
      check('Unfinished at the tick: finished on the spot with the right result, and the job leaves the queue', r.forced?.v === 7 && r.forced.tick === r.t1 + 1 && r.pending === 0, JSON.stringify(r));
    },
  },
];
