// [守] Options that are not options fail loudly: dialogue.say / start and pickups() go through readParams, so an unknown key (a typo, or a
// form an older version had, like dialogue { lock } or pickups({ model })) throws module-params naming it instead of being ignored.
// The 0.2 -> 0.3 rename traps (renamed-field) were removed in 0.4 as announced; MIGRATING-0.3.md keeps the table.
const PAGE = '/tests/threads/';
export const specs = [
  {
    name: '[守] silent breaks: unknown dialogue line options and pickups() keys throw module-params; the sky keeps its own isDay / daylight',
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
        out.pickup = err(() => T.pickups({ model: 'coin', color: 0xffcc00 }));
        return out;
      });
      check('dialogue.say({ lock }) throws module-params (not an option)', /module-params .*lock/.test(r.lockSay), r.lockSay);
      check('a dialogue option typo throws (readParams, did-you-mean)', /module-params .*chanel/.test(r.typo), r.typo);
      check('a valid bubble line still plays', r.bubble === 'no throw', r.bubble);
      check("the sky's own drawn isDay / daylight still read", r.skyOwn.isDay === 'boolean' && r.skyOwn.daylight === 'number', JSON.stringify(r.skyOwn));
      check('pickups({ model }) throws module-params (the shape is a model name, not an option)', /module-params .*model/.test(r.pickup), r.pickup);
    },
  },
];
