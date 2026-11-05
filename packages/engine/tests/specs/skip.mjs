// engine.skip（跳过时间）：和 step 慢慢推结果一致、跨天跨季节、跳过中按键无效。
// 守的是"不许绕开"：跳过必须走分段补算（定时按顺序、不重复），不能直接改 clock.now / cal.timeOfDay 了事。
export const specs = [
  {
    name: 'SKIP 跳过时间：跳 12 小时与 step 慢慢推一致（作物、NPC、定时、店门）',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.timeline.skip(); engine.haltLoop();
        const W = engine.world, cal = engine.calendar, P = engine.player.position;
        engine.mod('clock.rate', { owner: 'test', set: 10 });                       // 12 sky hours = 180 game seconds = 18 fixed seconds
        cal.timeOfDay = 0.75; engine.step(0.05, { render: false });
        W.simulate('skcrop', { far: (rec, dt) => { rec.g += dt; } });
        W.add({ id: 'sk-near', kind: 'skcrop', position: { x: P.x + 2, z: P.z }, g: 0 });
        W.add({ id: 'sk-far', kind: 'skcrop', position: { x: P.x + 400, z: P.z }, g: 0 });
        engine.npcs.add({ id: 'sk-npc', name: 'SkNpc', position: [P.x + 300, 0, P.z + 330],
          schedule: [{ at: '20:00', position: [P.x + 300, 0, P.z + 300] }, { at: '04:00', position: [P.x + 330, 0, P.z + 300] }] });
        engine.saves.save('sk-12h');
        const log = [];
        const arm = () => [
          engine.clock.every(35, () => log.push('every')),
          engine.clock.after(100, () => log.push('after')),
          cal.at('22:00', () => log.push('at22')),
          cal.at('03:00', () => log.push('at3')),
          cal.daily(d => log.push('daily' + d)),
          cal.between('05:00', '09:00', { on: () => log.push('open'), off: () => log.push('close') }),
        ];
        const read = () => ({ log: log.join(','), near: W.get('sk-near').g, far: W.get('sk-far').g, npc: { ...W.get('sk-npc').position },
          now: engine.clock.now, clock: cal.clock, day: cal.day, ts: engine.clock.rate });
        const t0 = engine.clock.now, gap = ((0.25 - cal.timeOfDay) % 1 + 1) % 1 * cal.dayLength;   // game seconds to 06:00
        let hs = arm();
        engine.step(gap / 10, { render: false });
        const slow = read();
        hs.forEach(h => h.remove()); log.length = 0;
        engine.saves.load('sk-12h');
        hs = arm();
        let done = null;
        engine.skip({ to: '06:00' }).then(v => { done = v; });   // fade 0: time has moved on return
        const fast = read();
        hs.forEach(h => h.remove());
        engine.mod('clock.rate', { owner: 'test', set: 1 });
        return { slow, fast, farEvery: W.farEvery, sync: fast.clock === '06:00', want: (fast.now - t0) / 10 };
      });
      const { slow, fast } = r, tol = r.farEvery + 1e-6;
      check('skip({ to: "06:00" }) lands on 06:00 synchronously (fade 0)', r.sync, JSON.stringify(fast));
      check('timers fire in the same order and count as stepping (after / every / at / daily / between)', slow.log === fast.log, `slow ${slow.log}\nfast ${fast.log}`);
      check('game seconds and day match', Math.abs(slow.now - fast.now) < 10 / 60 && slow.day === fast.day && fast.ts === 10, JSON.stringify([slow.now, fast.now, slow.day, fast.day]));
      check('world far growth matches within one far turn (near and far records)', Math.abs(slow.near - fast.near) <= tol && Math.abs(slow.far - fast.far) <= tol && Math.abs(fast.far - r.want) < 1e-6, JSON.stringify([slow.near, fast.near, slow.far, fast.far]));
      const d = Math.hypot(slow.npc.x - fast.npc.x, slow.npc.z - fast.npc.z);
      check('far NPC schedule position matches within one far turn of walking', d <= 2.6 * r.farEvery + 0.05, `${d.toFixed(3)} m`);
    },
  },
  {
    name: 'SKIP 跳过时间：跨天跨季节 daily / onSeason / at 按顺序各一次；op 拒绝非正数',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        engine.timeline.skip(); engine.haltLoop();
        const cal = engine.calendar, log = [];
        cal.day = 7; cal._season = cal.season; cal.timeOfDay = 23 / 24; engine.step(0.05, { render: false });
        const startSeason = cal.season;
        const hs = [cal.daily(d => log.push('d' + d)), cal.at('12:00', d => log.push('n' + d)),
          cal.onSeason('summer', () => log.push('summer')), cal.onSeason('autumn', () => log.push('autumn')),
          engine.events.on('day:start', d => log.push('new' + d)), engine.events.on('time:skip', e => log.push('skip' + Math.round(e.seconds)))];
        engine.skip({ seconds: 8 * cal.dayLength });
        hs.forEach(h => h.remove());
        const bad = engine.ops.run('time.skip', { seconds: 0 });
        let threw = '';
        try { engine.skip({}); } catch (err) { threw = err.message; }
        return { log, startSeason, season: cal.season, day: cal.day, clock: cal.clock, bad, threw, dayLength: cal.dayLength };
      });
      const days = [8, 9, 10, 11, 12, 13, 14, 15];
      const want = days.flatMap(d => [`new${d}`, ...(d === 8 ? ['summer'] : d === 15 ? ['autumn'] : []), `d${d}`, `n${d}`]).concat(`skip${8 * r.dayLength}`);
      check('8 days from day 7 23:00: day 15, 23:00, autumn', r.startSeason === 'spring' && r.day === 15 && r.clock === '23:00' && r.season === 'autumn', JSON.stringify(r));
      check('day:start, onSeason, daily and at fire once per crossing in time order', r.log.join(',') === want.join(','), `got  ${r.log.join(',')}\nwant ${want.join(',')}`);
      check('time.skip op refuses seconds <= 0; skip({}) throws with the fix', r.bad.ok === false && r.bad.code === 'notForward' && /to: "06:00"/.test(r.threw), JSON.stringify(r.bad) + ' ' + r.threw);
    },
  },
  {
    name: 'SKIP 跳过时间：带淡入淡出时锁输入、冻结，按键无效，结束后自动存档',
    url: '/',
    async run({ check, ev, page }) {
      await ev(() => {
        engine.timeline.skip(); engine.haltLoop();
        engine.calendar.timeOfDay = 0.5; engine.step(0.1, { render: false });
        window.__sk = { p0: { ...engine.player.position }, done: false, t0: engine.clock.now };
        engine.saves.remove('sk-auto');
        engine.skip({ seconds: 60, fade: 0.2, save: 'sk-auto' }).then(() => { window.__sk.done = true; });
      });
      await page.keyboard.down('KeyW');
      const mid = await ev(async () => {
        const s = window.__sk, out = { locked: !engine.input.enabled, frozen: engine.frozen, axis: engine.input.axis.y };
        for (let i = 0; i < 40 && !s.done; i++) { engine.step(0.1, { render: false }); await new Promise(res => setTimeout(res, 0)); }
        const p = engine.player.position;
        return { ...out, done: s.done, moved: Math.hypot(p.x - s.p0.x, p.z - s.p0.z), dt: engine.clock.now - s.t0, saved: engine.saves.list().some(x => x.slot === 'sk-auto') };
      });
      await page.keyboard.up('KeyW');
      const after = await ev(() => { engine.step(0.02, { render: false }); return ({ locked: !engine.input.enabled, frozen: engine.frozen }); });   // input context changes apply at the next step boundary
      check('during the fade: input locked, gameplay frozen, W gives no axis', mid.locked && mid.frozen && mid.axis === 0, JSON.stringify(mid));
      check('holding W through the skip does not move the player; skip advanced 60 game seconds', mid.done && mid.moved < 0.01 && Math.abs(mid.dt - 60) < 0.01, JSON.stringify(mid));
      check('after the skip input and gameplay resume; save option wrote the slot', !after.locked && !after.frozen && mid.saved, JSON.stringify({ after, saved: mid.saved }));
    },
  },
];
