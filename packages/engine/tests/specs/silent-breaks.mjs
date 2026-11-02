// [守] 0.2 -> 0.3 的"静默改变"：旧写法以前不报错、只是悄悄做错（对话锁输入反了、旧字段读 undefined、style 键不再读），现在都要响亮地报错并点名新写法。
// 守的是"不许绕开"：
//   1. dialogue.say / start 的选项走 readParams：lock 点名 channel: 'bubble'，其它未知键照常报错；
//   2. 搬去日历的字段（从日历契约推出来的整张表，不是手写名单）在 sky 上读写都报错；
//   3. 改名的结果字段（失败结果 .reason、runState.by、describe().ui.inputContexts）走同一个 renamedFields，读旧名报 renamed-field；
//   4. style.pickup 只认 color / size / lift，0.2 的 model 报未知键。
// 全部走 core/validate.js 的 renamed（一张改名表 + 一个帮手，只在开发时装），报 renamed-field 并点名新写法；clock.timeScale 也在这里
// （Node 里不是开发模式，packages/tools/tests/time-channels.mjs 只守 clock.rate 只读）。
const PAGE = '/tests/threads/';
export const specs = [
  {
    name: '[守] silent breaks: old 0.2 forms throw with the new way (dialogue lock, sky calendar fields, renamed result fields, style.pickup.model)',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const err = f => { try { f(); return 'no throw'; } catch (e) { return `${e.code} ${e.message}`; } };
        const E = mk(createEngine, 'silent-breaks');
        E.use(T.world(), T.calendar(), T.sky(), T.dialogue());
        await E.start();
        out.lockSay = err(() => E.dialogue.say('hi', { lock: false }));
        out.lockStart = err(() => E.dialogue.start('nobody', 'start', null, { lock: false }));
        out.typo = err(() => E.dialogue.say('hi', { chanel: 'bubble' }));
        out.bubble = err(() => E.dialogue.say('hi', { channel: 'bubble', seconds: 1 }));
        // the names that moved from the 0.2 sky to the calendar (the sky lists them explicitly; a new calendar name is not banned on the sky)
        const names = ['timeOfDay', 'day', 'dayLength', 'hoursPerDay', 'clock', 'seasons', 'season', 'seasonIndex', 'seasonProgress', 'totalDays',
          'at', 'between', 'daily', 'onSeason', 'untilMark', 'daysPerSeason', 'dayOfSeason'];
        out.skyRead = names.filter(k => !/renamed-field .*engine\.calendar\./.test(err(() => E.sky[k])));
        out.skyWrite = err(() => { E.sky.seasons = ['a']; });
        out.skyOwn = { isDay: typeof E.sky.isDay, daylight: typeof E.sky.daylight };
        out.timeScaleRead = err(() => E.clock.timeScale);
        out.timeScaleWrite = err(() => { E.clock.timeScale = 60; });
        out.rate = E.clock.rate;
        E.ops.define('sb.fail', { can: () => 'noMoney', run() {} });
        const res = E.ops.run('sb.fail', {});
        out.res = { ok: res.ok, code: res.code, keys: Object.keys(res).join(), reason: err(() => res.reason) };
        out.by = err(() => E.runState.by);
        out.owners = Array.isArray(E.runState.owners);
        out.ui = err(() => E.describe().ui.inputContexts);
        out.uiJson = JSON.stringify(E.describe().ui).includes('inputContexts');
        E.dispose();
        const F = mk(createEngine, 'silent-pickup', { style: { pickup: { model: 'coin', color: 0xffcc00 } } });
        out.pickup = err(() => F.use(T.world(), T.pickups()));
        F.dispose();
        return out;
      });
      check('dialogue.say({ lock }) throws and names channel bubble', /renamed-field .*channel: 'bubble'/.test(r.lockSay), r.lockSay);
      check('dialogue.start(..., { lock }) throws and names channel bubble', /renamed-field .*channel: 'bubble'/.test(r.lockStart), r.lockStart);
      check('a dialogue option typo throws (readParams, did-you-mean)', /module-params .*chanel/.test(r.typo), r.typo);
      check('a valid bubble line still plays', r.bubble === 'no throw', r.bubble);
      check('every name that moved to the calendar, read on the sky, throws renamed-field naming engine.calendar', r.skyRead.length === 0, JSON.stringify(r.skyRead));
      check('writing sky.seasons throws', /renamed-field/.test(r.skyWrite), r.skyWrite);
      check("clock.timeScale read and write throw renamed-field naming engine.mod('clock.rate'); the rate is unchanged", /renamed-field .*engine\.mod\('clock\.rate'/.test(r.timeScaleRead) && /renamed-field .*engine\.mod\('clock\.rate'/.test(r.timeScaleWrite) && r.rate === 1, JSON.stringify([r.timeScaleRead, r.timeScaleWrite, r.rate]));
      check("the sky's own drawn isDay / daylight still read", r.skyOwn.isDay === 'boolean' && r.skyOwn.daylight === 'number', JSON.stringify(r.skyOwn));
      check('a failed result: .code reads, .reason throws renamed-field naming .code, JSON keys unchanged', r.res.code === 'noMoney' && /renamed-field .*\.code/.test(r.res.reason) && !r.res.keys.includes('reason'), JSON.stringify(r.res));
      check('runState.by throws renamed-field naming .owners', /renamed-field .*owners/.test(r.by) && r.owners, r.by);
      check('describe().ui.inputContexts throws naming describe().holds.input, not in JSON', /renamed-field .*holds\.input/.test(r.ui) && !r.uiJson, r.ui);
      check('style.pickup.model throws renamed-field naming the asset model path', /renamed-field .*style\.pickup.*'model'.*asset model/.test(r.pickup), r.pickup);
    },
  },
  {
    // 两个入口各有其层：look.lights.set 是叠在昼夜关键帧上面的一层（昼夜照走），直接写 engine.lights 是接管（引擎停写）。
    // 守的是 set 在走帧 / 出图的路径上真的生效，并且不接管：拿掉之后关键帧接着写
    name: '[守] one entry per layer: look.lights.set wins over the sky keyframes on the step path and gives them back on remove',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T;
        const E = mk(createEngine, 'lights-set');
        E.use(T.calendar({ time: '12:00' }), T.sky());
        await E.start();
        E.step(0.1);
        const base = E.lights.sun.intensity;
        const h = E.look.lights.set({ sun: { intensity: base * 3 + 1 } }, { owner: 'test' });
        E.step(0.1);
        const set = E.lights.sun.intensity;
        h.remove(); E.step(0.1);
        const back = E.lights.sun.intensity, owned = JSON.stringify(E.describe().owned ?? {}).includes('sun.intensity');
        E.dispose();
        return { base, set, back, owned };
      });
      check('look.lights.set changes the sun the sky drives (after a rendered step)', Math.abs(r.set - (r.base * 3 + 1)) < 1e-3, JSON.stringify(r));
      check('remove() gives it back to the keyframes, nothing taken over', Math.abs(r.back - r.base) < 1e-3, JSON.stringify(r));
    },
  },
];
