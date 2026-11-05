// A throw inside a game hook must not leave work half done or freeze a game for something that is not a real error (hook audit 2026-11-05).
export const specs = [
  {
    name: '[guard] quest reward: a reward that throws after done is set still announces the quest, applies the rest and does not freeze',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = threedogThreads.all, E = threedogThreads.mk(T.createEngine, 'hook-reward', {});
        E.use(T.world(), T.quests({ notify: false }), T.content());
        await E.start();
        const boom = Object.assign(new Error('no ground here'), { code: 'ground-missing' });
        const sf = E.vars.setFlag.bind(E.vars); E.vars.setFlag = (k, v) => { if (k === 'badFlag') throw boom; return sf(k, v); };   // stands in for an effect that fails (content-place, ground-missing)
        const q = (reward) => ({ title: 'Q', steps: [{ id: 'a', text: 'a', done: () => true }], reward });
        // the reward is a content effect list: the effect after the failing one must still run
        E.quests.define('q1', q(() => E.content.run([{ setFlag: 'badFlag' }, { setFlag: 'afterBoom' }])));
        E.quests.define('q2', q(() => { throw boom; }));   // a plain reward function that throws
        const done = []; E.events.on('quest:done', ({ id }) => done.push(id));
        const q0 = console.error; const errs = []; console.error = (...a) => errs.push(a.join(' '));
        E.ops.allow(() => { E.quests.start('q1'); E.quests.start('q2'); });
        E.step(1);
        console.error = q0;
        return { done, flag: E.vars.flag('afterBoom'), frozen: E.error ? JSON.stringify(E.error).slice(0, 300) : false, s1: E.quests.isDone('q1'), s2: E.quests.isDone('q2'), said: errs.some(s => s.includes("quest 'q1' reward")) };
      });
      check('both quests announce quest:done', r.done.includes('q1') && r.done.includes('q2') && r.s1 && r.s2, JSON.stringify(r));
      check('the effect after the failing one still ran', r.flag === true, JSON.stringify(r));
      check('the failure is reported, the game is not frozen', r.said && !r.frozen, JSON.stringify(r));
    },
  },
  {
    name: '[guard] jobs: a job that fails inside its commit tick rejects its own promise once and does not freeze the fixed step or apply',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = threedogThreads.all, E = threedogThreads.mk(T.createEngine, 'hook-jobs', {});
        await E.start();
        let applied = false, rejected = null;
        E.jobs.add(function* () { yield; yield; throw new Error('job broke'); }, { apply: () => { applied = true; }, lag: 1 }).catch(err => { rejected = err.message; });
        for (let i = 0; i < 6; i++) E.step(1 / 60);
        await Promise.resolve();
        return { applied, rejected, frozen: E.error ? E.error.message : false };
      });
      check('the job error reaches its promise', r.rejected === 'job broke', JSON.stringify(r));
      check('the fixed step is not frozen by it and apply did not run', r.frozen === false && !r.applied, JSON.stringify(r));
    },
  },
  {
    name: '[guard] approach on a held character answers cannotWalk instead of throwing; an NPC the game holds on the base layer is left alone',
    url: '/tests/vehicle/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        engine.haltLoop();
        const p = engine.player; p.placeAt({ x: 20, z: 20 });
        const hold = engine.control.take(p, { owner: 'hook-script', layer: 'script', step: () => null });   // a script holds the walk layer
        const h = engine.interactions.add({ x: 26, y: 0, z: 20 }, { id: 'clerk2', label: 'Talk', radius: Infinity, approach: true, onUse: () => 'served' });
        const res = engine.ops.run('interaction.use', { id: 'clerk2' }, { source: 'test' });
        const frozenA = engine.error ? engine.error.message : false;
        h.remove(); hold.remove();
        return { code: res.code ?? res.error?.code ?? JSON.stringify(res).slice(0, 200), ok: res.ok, frozenA };
      });
      check('approach on a held character: cannotWalk, no freeze', r.ok === false && /cannotWalk/.test(r.code) && r.frozenA === false, JSON.stringify(r));
    },
  },
  {
    name: '[guard] an NPC the game already holds on the base layer is left alone, not a control-conflict thrown from the fixed step',
    url: '/tests/threads/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const T = threedogThreads.all, E = threedogThreads.mk(T.createEngine, 'hook-npc', {});
        E.use(T.world(), T.collision(), T.characters(), T.timeline());
        await E.start();
        const npc = E.npcs.add({ id: 'hook-npc', name: 'Held', position: { x: 4, z: 0 }, speed: 2, schedule: [{ at: 0, position: { x: 14, z: 0 } }] });
        E.control.take(npc, { owner: 'game-ai', layer: 'base', step: () => null });
        for (let i = 0; i < 30; i++) E.step(1 / 60);
        return { frozen: E.error ? E.error.message : false, owner: E.control.of(npc)?.owner };
      });
      check('nothing thrown and the game keeps the character', r.frozen === false && r.owner === 'game-ai', JSON.stringify(r));
    },
  },
];
