// [守] Options that are not options fail loudly: dialogue.say / start and style.pickup go through readParams, so an unknown key (a typo, or a
// form an older version had, like dialogue { lock } or style.pickup.model) throws module-params naming it instead of being ignored.
// The 0.2 -> 0.3 rename traps (renamed-field) were removed in 0.4 as announced; MIGRATING-0.3.md keeps the table.
const PAGE = '/tests/threads/';
export const specs = [
  {
    name: '[守] silent breaks: unknown dialogue line options and style.pickup keys throw module-params; the sky keeps its own isDay / daylight',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk } = threedogThreads, T = threedogThreads.all, { createEngine } = T, out = {};
        const err = f => { try { f(); return 'no throw'; } catch (e) { return `${e.code} ${e.message}`; } };
        const E = mk(createEngine, 'silent-breaks');
        E.use(T.world(), T.calendar(), T.sky(), T.dialogue());
        await E.start();
        out.lockSay = err(() => E.dialogue.say('hi', { lock: false }));
        out.typo = err(() => E.dialogue.say('hi', { chanel: 'bubble' }));
        out.bubble = err(() => E.dialogue.say('hi', { channel: 'bubble', seconds: 1 }));
        out.skyOwn = { isDay: typeof E.sky.isDay, daylight: typeof E.sky.daylight };
        E.dispose();
        const F = mk(createEngine, 'silent-pickup', { style: { pickup: { model: 'coin', color: 0xffcc00 } } });
        out.pickup = err(() => F.use(T.world(), T.pickups()));
        F.dispose();
        return out;
      });
      check('dialogue.say({ lock }) throws module-params (not an option)', /module-params .*lock/.test(r.lockSay), r.lockSay);
      check('a dialogue option typo throws (readParams, did-you-mean)', /module-params .*chanel/.test(r.typo), r.typo);
      check('a valid bubble line still plays', r.bubble === 'no throw', r.bubble);
      check("the sky's own drawn isDay / daylight still read", r.skyOwn.isDay === 'boolean' && r.skyOwn.daylight === 'number', JSON.stringify(r.skyOwn));
      check('style.pickup.model throws module-params (style.pickup is color / size / lift)', /module-params .*model/.test(r.pickup), r.pickup);
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
