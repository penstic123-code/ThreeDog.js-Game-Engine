// Stage 1.11 step 4: NPCs move to engine.world (facts are data; Character is only the presentation while near). Same style as packages/engine/tests/specs.mjs; appended at the end of specs.mjs.
export const specs = [
  {
    name: 'S1 NPC: walk far and the model unloads, advance 2 hours, walk back to the scheduled position (stop / straight-line interpolation) and the model is rebuilt (open world)',
    url: '/?cutscene=skip',   // the opening cutscene takes over the camera (focus would not follow the player)
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const W = engine.world, P = engine.player, S = engine.sky, home = P.position.clone();
        S.timeOfDay = 9 / 24;
        const A = { x: home.x + 4, z: home.z + 4 }, B1 = { x: home.x + 34, z: home.z + 4 }, B2 = { x: home.x + 204, z: home.z + 4 };
        // two NPCs with two stops each, both heading to B at 10:00: one B is near (reachable within 1 hour, stops at the stop), the other far (unreachable, stops on the line)
        const near = engine.npcs.add({ id: 's1-near', name: '近站', position: A, schedule: [{ at: '00:00', position: A }, { at: '10:00', position: B1 }] });
        const far = engine.npcs.add({ id: 's1-far', name: '远站', position: A, schedule: [{ at: '00:00', position: A }, { at: '10:00', position: B2 }] });
        engine.step(0.5);
        const built = !!near.root?.parent && !!far.character, isHandle = !('mover' in near)   /* a handle, not a Character */;
        P.placeAt({ x: home.x + 400, z: home.z }); engine.step(3);   // camera focus follows smoothly
        const away = { near: near.root, far: W.view('s1-far'), data: !!W.get('s1-near') && !!W.get('s1-far'), pos: near.position.x };
        const twoHours = S.dayLength * 2 / 24, t0 = S.timeOfDay;
        engine.step(twoHours, { render: false });
        const tod = S.timeOfDay, walked = near.data.speed * (tod - 10 / 24) * S.dayLength / (S.timeScale || 1);   // distance walked after leaving at 10:00
        const farData = { ...far.data.position };
        P.placeAt({ x: home.x, z: home.z }); engine.step(3);
        return { built, isHandle, away, t0, tod, walked, farData, A, B1, B2,
          near: { ...near.data.position, model: !!near.root?.parent, stop: near.data.nav.stop },
          far: { ...far.data.position, model: !!far.root?.parent, state: far.state },
          plain: !/"isObject3D"|"uuid"/.test(JSON.stringify([near.data, far.data])) };
      });
      check('nearby: model built automatically; npcs.add returns a handle (not a Character)', r.built && r.isHandle, JSON.stringify(r));
      check('walk far: model removed (root is null), data stays, handle position reads the data', r.away.near === null && r.away.far === null && r.away.data && typeof r.away.pos === 'number', JSON.stringify(r.away));
      check('advanced 2 hours of game time', Math.abs((r.tod - r.t0) * 24 - 2) < 0.05, `${r.t0} → ${r.tod}`);
      const dB1 = Math.hypot(r.near.x - r.B1.x, r.near.z - r.B1.z);
      check('reachable: stops at the scheduled stop (error < 2 m), now at the current stop', dB1 < 2 && r.near.stop === 1, JSON.stringify(r.near));
      // far simulation (before the player returns): along the A→B2 line, distance walked = speed × time since departure
      const along = r.farData.x - r.A.x, side = Math.abs(r.farData.z - r.A.z);
      check('unreachable: stops at the interpolated point on the line (distance ≈ speed × time)', side < 0.5 && Math.abs(along - r.walked) < 3, `along line ${along.toFixed(1)} m, expected ${r.walked.toFixed(1)} m, off by ${side.toFixed(2)}`);
      check('walk back: both models rebuilt', r.near.model && r.far.model, JSON.stringify(r));
      check('NPC data holds no three.js objects', r.plain);
    },
  },
  {
    name: 'S1 NPC: a repeated add overrides only the passed fields (zone is not reset) (city block)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(() => {
        const W = engine.world, id = engine.npcs.get('店主').id, zone = W.get(id).zone, sched = W.get(id).schedule.length;
        engine.npcs.add({ id, name: '店主二号' });
        const d = W.get(id);
        return { zone, afterZone: d.zone, name: d.name, sched: d.schedule.length, wasSched: sched };
      });
      check('repeated add changes only the passed name; zone and schedule stay', r.name === '店主二号' && r.afterZone === r.zone && r.zone != null && r.sched === r.wasSched, JSON.stringify(r));
    },
  },
  {
    name: 'S1 NPC: switching level only removes the model; switching back keeps the NPC and its state (city block)',
    url: '/tests/city/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const W = engine.world, T = engine.THREE, npc = engine.npcs.get('店主');
        const id = npc.id, zone = npc.data.zone;
        W.set(id, { mood: 'happy' });   // game-added state field
        engine.assets.manifest({ models: { 's1-level2': () => {
          const g = new T.Group(), floor = new T.Mesh(new T.BoxGeometry(40, 1, 40), new T.MeshBasicMaterial());
          floor.name = 'ground'; floor.position.y = -0.5; g.add(floor); return g;
        } } });
        await engine.level.load('s1-level2'); engine.step(0.2);
        const mid = { data: !!engine.npcs.get(id), model: !!npc.root, zone: W.zone, nearby: engine.describe().nearby.some(x => x.id === id) };
        await engine.level.load('city-block'); engine.step(0.2);
        return { id, zone, mid, back: { data: !!engine.npcs.get(id), model: !!npc.root?.parent, mood: npc.data?.mood, zone: W.zone, count: engine.npcs.list().filter(n => n.name === '店主').length } };
      });
      check('shopkeeper has a stable id (content key) and belongs to the current zone', r.id === 'shopkeeper' && r.zone === 'city-block', JSON.stringify(r));
      check('switch to another zone: data stays, model removed, describe does not list it', r.mid.data && !r.mid.model && r.mid.zone === 's1-level2' && !r.mid.nearby, JSON.stringify(r.mid));
      check('switch back: model rebuilt automatically, state kept, no duplicate shopkeeper', r.back.data && r.back.model && r.back.mood === 'happy' && r.back.count === 1, JSON.stringify(r.back));
    },
  },
  {
    name: 'S1 NPC: save → change → load restores position and state, and the save holds no three.js objects (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const W = engine.world, npc = engine.npcs.get('fisher');
        engine.step(0.5);
        engine.saves.save('s1-npc');
        const json = engine.saves.export('s1-npc'), before = JSON.stringify(npc.data);
        npc.placeAt({ x: npc.position.x + 30, z: npc.position.z });
        W.set('fisher', { mood: 'changed', state: 'run' });
        engine.step(0.2);
        const moved = JSON.stringify(npc.data) !== before;
        const ret = engine.saves.load('s1-npc');
        const after = JSON.stringify(npc.data);
        engine.step(1 / 60);
        const ch = npc.character, d = npc.data.position;
        return { moved, isPromise: typeof ret?.then === 'function', same: after === before, mood: npc.data.mood ?? null,
          rebuilt: !!ch, gap: ch ? Math.hypot(ch.root.position.x - d.x, ch.root.position.z - d.z) : -1,
          plain: !!json && !/"isObject3D"|"uuid"|"matrixWorld"/.test(atob(json)), hasNpc: /"changed":\{.*"fisher":\{/s.test(atob(json)) };
      });
      check('changes took effect (position and fields both changed)', r.moved, JSON.stringify(r));
      check('load: NPC data (position, state, schedule progress, motion state) fully restored, no fields that were absent from the save', r.isPromise && r.same && r.mood === null, JSON.stringify(r));
      check('next step after load: model rebuilt from data, positions match', r.rebuilt && r.gap >= 0 && r.gap < 0.2, JSON.stringify(r));
      check('save holds the NPC changes (content NPCs are initial data, only changes are saved) and no three.js objects', r.plain && r.hasNpc, JSON.stringify(r));
    },
  },
  {
    name: 'S1 NPC: running N seconds straight vs save → load → run N seconds gives the same NPC positions, vars, clock, random (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const P = engine.player, home = P.position.clone();
        engine.sky.timeOfDay = 6.02 / 24;   // just past 6:00: the old fisherman heads to the river and the test NPC to its second stop, both walking
        const A = { x: home.x + 3, z: home.z + 3 };
        engine.npcs.add({ id: 's1-det', name: '确定性', position: A, schedule: [{ at: '00:00', position: A }, { at: '06:00', position: { x: home.x + 18, z: home.z - 12 } }] });
        engine.step(1);
        engine.vars.bump('s1.det', 1);
        engine.saves.save('s1-det');
        const snap = () => {
          const pos = id => { const p = engine.world.get(id).position; return [p.x, p.y, p.z]; };
          return { det: pos('s1-det'), fisher: pos('fisher'), detState: engine.world.get('s1-det').state, vars: JSON.stringify(engine.vars.toJSON?.() ?? engine.saves.collect().parts.vars),
            clock: engine.clock.now, random: JSON.stringify(engine.random.toJSON()), tod: engine.sky.timeOfDay };
        };
        const N = 5;
        engine.step(N, { render: false });
        const a = snap();
        await engine.saves.load('s1-det');
        engine.world.refresh(); for (let i = 0; i < 100 && !engine.world.view('cabin'); i++) await null;   // a load rebuilds content views (the cabin template and its collider) in a few microtasks; wait for it as the next frame would
        engine.step(N, { render: false });
        const b = snap();
        const moved = Math.hypot(a.det[0] - A.x, a.det[2] - A.z);
        return { a, b, moved };
      });
      const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      check('test NPC really walks during this time (not standing still)', r.moved > 2 && r.a.detState === 'walk', JSON.stringify(r.a));
      check('NPC positions match (near ones moved by mover, far ones simulated)', d(r.a.det, r.b.det) < 1e-6 && d(r.a.fisher, r.b.fisher) < 1e-6, JSON.stringify({ a: [r.a.det, r.a.fisher], b: [r.b.det, r.b.fisher] }));
      check('vars, clock, random and time of day match', r.a.vars === r.b.vars && r.a.clock === r.b.clock && r.a.random === r.b.random && r.a.tod === r.b.tod, JSON.stringify({ a: r.a, b: r.b }));
    },
  },
  {
    name: 'S1 NPC behavior: wander gives the same result for the same seed and stays in its circle; a misspelled behavior name throws and lists the registered ones (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const P = engine.player, home = P.position.clone(), H = { x: home.x + 400, z: home.z };
        P.placeAt({ x: home.x - 400, z: home.z }); engine.step(3);   // walk far away: focus follows
        engine.random.setSeed(5);
        const n = engine.npcs.add({ id: 'w1', name: '游荡者', position: H, behavior: 'wander', mind: { radius: 6 } });
        engine.step(1, { render: false });
        engine.saves.save('s1-wander');   // same start point (data, random numbers, simulation steps) run three times: the same seed gives the same result
        const run = seed => {
          engine.saves.load('s1-wander'); if (seed) engine.random.setSeed(seed);
          engine.step(40, { render: false });
          const q = n.data.position;
          return { x: q.x, z: q.z, far: !n.root, d: Math.hypot(q.x - H.x, q.z - H.z) };
        };
        const a = run(), b = run(), c = run(6);
        let msg = ''; try { engine.npcs.add({ id: 'w2', name: 'x', behavior: 'wandr' }); } catch (e) { msg = e.message; }
        return { a, b, c, msg };
      });
      const same = Math.hypot(r.a.x - r.b.x, r.a.z - r.b.z) < 0.01, diff = Math.hypot(r.a.x - r.c.x, r.a.z - r.c.z) > 0.01;
      check('wander: far simulation, same seed same result, different seeds differ', r.a.far && same && diff, JSON.stringify(r));
      check('wander: stays within the radius circle (6 m)', r.a.d <= 6.01 && r.c.d <= 6.01, JSON.stringify(r));
      check('misspelled behavior name: throws and lists the registered ones', /wandr/.test(r.msg) && /schedule/.test(r.msg) && /wander/.test(r.msg), r.msg);
    },
  },
  {
    name: 'S1 NPC behavior: custom behavior keeps time across near/far switches; switching behavior restores on load (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const P = engine.player, home = P.position.clone();
        engine.npcs.behavior('clock', { near: (rec, dt) => { rec.mind.t = (rec.mind.t ?? 0) + dt; rec.mind.nearT = (rec.mind.nearT ?? 0) + dt; }, far: (rec, dt) => { rec.mind.t = (rec.mind.t ?? 0) + dt; } });
        const n = engine.npcs.add({ id: 'clk', name: '计时', position: { x: home.x + 4, z: home.z + 4 }, behavior: 'clock' });
        engine.step(1, { render: false });
        P.placeAt({ x: home.x + 400, z: home.z }); engine.step(3, { render: false });
        engine.step(20, { render: false });
        P.placeAt({ x: home.x, z: home.z }); engine.step(3, { render: false });
        const t = n.data.mind.t, total = 1 + 3 + 20 + 3, nearT = n.data.mind.nearT;
        // switch behavior → save → switch back to schedule → load: behavior and params come back
        n.setBehavior('wander', { radius: 5, home: { x: home.x + 4, z: home.z + 4 } });
        engine.step(0.5, { render: false });
        engine.saves.save('s1-beh');
        n.setBehavior('schedule');
        engine.saves.load('s1-beh');
        engine.step(10, { render: false });
        const d = n.data, away = Math.hypot(d.position.x - (home.x + 4), d.position.z - (home.z + 4));
        return { t, total, nearT, behavior: d.behavior, radius: d.mind.radius, away };
      });
      check('custom behavior: near + far accumulated dt = elapsed time (far catches up first when near)', Math.abs(r.t - r.total) < 0.5 && r.nearT > 0 && r.nearT < r.t, JSON.stringify(r));
      check('switch behavior: after load the behavior name and params are restored and it keeps following the new behavior (stays in its circle)', r.behavior === 'wander' && r.radius === 5 && r.away <= 5.5, JSON.stringify(r));
    },
  },
  {
    name: 'S1 NPC avoidance: heading to one point does not overlap and the player is not pushed; off means they stack; straight run vs save-and-reload / frameEvery 1·2·4 positions bit-identical (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.pause();
        const P = engine.player, h = P.position.clone(), T = { x: h.x + 14, z: h.z + 14 };
        const ids = Array.from({ length: 8 }, (_, i) => 's1-av' + i);
        ids.forEach((id, i) => {
          const a = i / 8 * Math.PI * 2, A = { x: T.x + Math.cos(a) * 6, z: T.z + Math.sin(a) * 6 };
          engine.npcs.add({ id, name: id, position: A, schedule: [{ at: '00:00', position: T }] });   // 8 NPCs walk from a circle to the same point
        });
        engine.step(0.3, { render: false });
        engine.saves.save('s1-av');
        const pos = () => ids.map(id => { const p = engine.world.get(id).position; return [p.x, p.y, p.z]; });
        const minGap = () => { let m = 9; const q = pos(); for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) m = Math.min(m, Math.hypot(q[i][0] - q[j][0], q[i][2] - q[j][2])); return m; };
        const run = (fe, avoid) => { engine.saves.load('s1-av'); engine.npcs.avoid.set(avoid); engine.step(12, { render: false, frameEvery: fe }); return { p: JSON.stringify(pos()), gap: minGap() }; };
        const base = run(2, true), again = run(2, true), f1 = run(1, true), f4 = run(4, true), off = run(2, false);
        // player as obstacle: NPCs walk to where the player stands, the player stays still
        engine.npcs.avoid.set(true);
        const me = { x: P.position.x, z: P.position.z };
        engine.npcs.add({ id: 's1-av-p', name: 'p', position: { x: me.x + 5, z: me.z }, schedule: [{ at: '00:00', position: me }] });
        engine.step(8, { render: false });
        const q = engine.world.get('s1-av-p').position;
        return { base, again, f1, f4, off, playerMoved: Math.hypot(P.position.x - me.x, P.position.z - me.z), toPlayer: Math.hypot(q.x - me.x, q.z - me.z), min: 2 * engine.movement.radius };
      });
      check('avoidance: 8 NPCs heading to the same point stay at least one radius apart (>= 0.8 × sum of two radii)', r.base.gap > 0.8 * r.min, JSON.stringify({ gap: r.base.gap, min: r.min }));
      // control: still clearly below the 0.8 x avoidance bar; async paths come from a 1 m walkable grid, so they bunch slightly less tightly than sync paths did
      check('avoidance off: the same scene stacks up (so the above is the effect of avoidance)', r.off.gap < 0.7 * r.min, JSON.stringify({ gap: r.off.gap }));
      check('loading the same save twice gives bit-identical positions', r.base.p === r.again.p);
      check('frameEvery 1 / 4 and 2 give bit-identical positions (avoidance runs only in the fixed step)', r.f1.p === r.base.p && r.f4.p === r.base.p);
      check('player as obstacle: NPCs stop outside the player, player position is not pushed', r.toPlayer > 0.9 * r.min && r.playerMoved === 0, JSON.stringify({ toPlayer: r.toPlayer, playerMoved: r.playerMoved }));
    },
  },
  {
    name: 'S1 NPC avoidance: 400 nearby NPCs cost < 1ms per fixed step (spread-out crowd), packed crowd also < 4ms (open world)',
    url: '/?cutscene=skip',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.pause();
        const h = engine.player.position.clone(), out = {};
        // time avoid.push directly: step once to record start positions, then push all 400 NPCs with dt = 0 (no movement) and take the fastest of several runs (includes rebuilding the grid once per step)
        const A = engine.npcs.avoid;
        const measure = (name, make) => {
          engine.random.setSeed(3);
          for (let i = 0; i < 400; i++) make(i, 's1-pf' + i);
          engine.step(2, { render: false });
          const list = engine.npcs.list().filter(n => n.character);
          let best = 1e9;
          for (let k = 0; k < 15; k++) {
            A._gridN = -1; const t = performance.now();
            for (const n of list) A.push(n.data, n.character, 0);
            best = Math.min(best, performance.now() - t);
          }
          out[name] = { ms: best, models: list.length };
          for (let i = 0; i < 400; i++) engine.npcs.remove('s1-pf' + i);
        };
        // spread-out crowd: 400 wanderers in 30×30 m (density about 0.45 per m²)
        measure('crowd', (i, id) => engine.npcs.add({ id, name: id, behavior: 'wander', mind: { radius: 8 }, position: { x: h.x + 6 + (i % 20) * 1.5, z: h.z + 6 + Math.floor(i / 20) * 1.5 } }));
        // packed crowd: 400 NPCs head to one point from 10×10 m (worst case of hundreds of zombies around the player)
        measure('pile', (i, id) => engine.npcs.add({ id, name: id, position: { x: h.x + (i % 20) * 0.5 - 5, z: h.z + 6 + Math.floor(i / 20) * 0.5 }, schedule: [{ at: '00:00', position: { x: h.x, z: h.z + 12 } }] }));
        return out;
      });
      console.log('avoidance cost ms/step (400 NPCs pushed once each)', JSON.stringify(r));
      check('spread-out crowd (400 with models): avoidance < 1ms per fixed step', r.crowd.models >= 400 && r.crowd.ms < 1, JSON.stringify(r.crowd));
      check('packed crowd (400): avoidance < 4ms per fixed step', r.pile.models >= 400 && r.pile.ms < 4, JSON.stringify(r.pile));
    },
  },
];
