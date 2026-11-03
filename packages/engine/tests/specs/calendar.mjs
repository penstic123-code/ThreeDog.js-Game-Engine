// [守] 日历从天空里拆出来（docs/plans/done/2026-11-02-genericity-fixes.md 第 1 项）：时间、天数、季节归 calendar() 模块，sky 只读它来画。
// 守的是"不许绕开"：
//   1. 不装 sky，只装 calendar，NPC 日程照样随时间换站（以前日历长在 sky 里，室内游戏没有天空日程就停了）；
//   2. sky 读日历：改 calendar.timeOfDay，太阳方向跟着变；不装 calendar 时 sky 画一个固定时刻；旧的日历选项写在 sky 上会报错指路；
//   3. 内容里的 clock 条件不装 sky 也能用，并按日历的 hoursPerDay 换算；
//   4. 旧存档把时间存在 'sky' 部件下，新版本照样读进日历（saves.register 的 movedFrom）。
// 契约检查（modules/calendar/contract.js）在 Node 里跑：packages/tools/tests/contracts.mjs。
const PAGE = '/tests/threads/';
export const specs = [
  {
    name: '[守] calendar: NPC schedules follow the calendar with no sky installed',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'cal-npc');
        // 10 game seconds per hour; the NPC stands far from the focus, so the world's far simulation walks it (no model, no sky, no collision)
        E.use(T.world(), T.calendar({ time: '05:00', dayLength: 240 }), T.characters());
        await E.start();
        const A = { x: 600, z: 0 }, B = { x: 640, z: 0 };
        const npc = E.npcs.add({ id: 'cal-baker', name: 'Baker', position: A, speed: 2, schedule: [{ at: '00:00', position: A }, { at: '06:00', position: B }] });
        E.step(0.2, { render: false });
        const before = { stop: npc.currentStop()?.x, x: npc.data.position.x };
        E.step(20, { render: false });   // 05:00 + 2 h = 07:00: the 06:00 stop is current and the baker has walked toward it
        const after = { stop: npc.currentStop()?.x, x: npc.data.position.x, clock: E.calendar.clock };
        const out = { noSky: !E.sky, before, after };
        E.dispose();
        return out;
      });
      check('no sky installed', r.noSky);
      check('before 06:00 the current stop is the first one', r.before.stop === 600, JSON.stringify(r.before));
      check('after the calendar passes 06:00 the stop changes and the NPC walks toward it', r.after.stop === 640 && r.after.x > 601 && /^07:/.test(r.after.clock), JSON.stringify(r.after));
    },
  },
  {
    name: '[守] calendar: the sky draws the calendar time; sky alone draws a fixed time; old calendar keys on sky throw with the new place',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const E = mk(createEngine, 'cal-sky');
        E.use(T.calendar({ time: 0.3 }), T.sky());
        await E.start();
        E.step(0.05, { render: false }); const d1 = E.uniforms.uSunDir.value.toArray().join();
        E.calendar.timeOfDay = 0.6; E.step(0.05, { render: false }); const d2 = E.uniforms.uSunDir.value.toArray().join();
        out.moved = d1 !== d2; out.drawn = E.sky.drawnTime; out.ctxTime = E.uniforms.uTimeOfDay.value;
        E.dispose();
        const F = mk(createEngine, 'cal-sky-fixed');
        F.use(T.sky({ time: '18:00' })); await F.start(); F.step(1, { render: false });
        out.fixed = { cal: F.calendar === undefined, drawn: F.sky.drawnTime, t: F.uniforms.uTimeOfDay.value };
        F.dispose();
        const err = f => { try { f(); return ''; } catch (e) { return e.message; } };
        out.oldKey = err(() => T.sky({ dayLength: 360 }));
        const G = mk(createEngine, 'cal-sky-twice');
        out.twice = err(() => G.use(T.calendar(), T.sky({ time: 0.5 })));
        G.dispose();
        return out;
      });
      check('changing calendar.timeOfDay moves the sun', r.moved, JSON.stringify(r));
      check('the sky draws the calendar time (drawnTime, uTimeOfDay)', Math.abs(r.drawn - 0.6) < 0.01 && Math.abs(r.ctxTime - 0.6) < 0.01, JSON.stringify(r));
      check('sky alone: no calendar, the fixed time 18:00 is drawn and stays', r.fixed.cal && r.fixed.drawn === 0.75 && r.fixed.t === 0.75, JSON.stringify(r.fixed));
      check('sky({ dayLength }) throws and names calendar()', /calendar/.test(r.oldKey), r.oldKey);
      check('calendar() + sky({ time }) throws (the sky time would be unused)', /calendar\(\{ time \}\)/.test(r.twice), r.twice);
    },
  },
  {
    name: '[守] calendar: content clock conditions without a sky, in the calendar hours; an old save with time under sky loads into the calendar',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        // a 10-hour day (a shop sim's working day): '05:00' is half the day
        const E = mk(createEngine, 'cal-content');
        E.use(T.world(), T.calendar({ time: '04:00', hoursPerDay: 10 }), T.content());
        await E.start();
        let got = null;
        E.content.condition('shopOpen', { ref: 'clock', desc: 'the shop opens at this clock time', test: (e, t) => { got = t; return e.calendar.timeOfDay >= t; } });
        out.closed = E.content.test({ shopOpen: '05:00' }); out.frac = got;
        E.calendar.timeOfDay = 0.6; out.open = E.content.test({ shopOpen: '05:00' });
        out.noSky = !E.sky;
        // an old save: the time lived under the 'sky' part (before the calendar was its own module)
        const old = { savedAt: 1, versions: { sky: 1 }, parts: { sky: { time: 0.75, day: 4 } } };
        await E.saves.import(btoa(JSON.stringify(old)), 'cal-old');
        out.loaded = await E.saves.load('cal-old');
        out.after = { t: E.calendar.timeOfDay, day: E.calendar.day };
        out.parts = Object.keys(E.saves.collect().parts).filter(k => k === 'sky' || k === 'calendar');
        E.dispose();
        return out;
      });
      check('no sky installed', r.noSky);
      check("clock condition gets the fraction in the calendar's hours ('05:00' of 10 h = 0.5)", r.frac === 0.5, String(r.frac));
      check('clock condition follows the calendar time', r.closed === false && r.open === true, JSON.stringify(r));
      check("old save with time under 'sky' loads into the calendar", r.loaded === true && r.after.t === 0.75 && r.after.day === 4, JSON.stringify(r));
      check("the next save writes 'calendar' and drops the old 'sky' part", r.parts.join() === 'calendar', r.parts.join());
    },
  },
];
