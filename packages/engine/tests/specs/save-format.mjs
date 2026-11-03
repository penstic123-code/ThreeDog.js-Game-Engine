// Save format guards for the gameplay modules: saves store stable names and only what differs, and old saves still load.
// Same format as the other files here.

export const specs = [
  {
    name: 'save format: world writes owed time only for kinds simulated far (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const W = fn => engine.ops.allow(fn), w = engine.world;
        W(() => { for (let i = 0; i < 200; i++) w.add({ kind: 'sf-prop', position: [i * 3, 0, 900] }); });
        w.simulate('sf-crop', { far: rec => { rec.g = (rec.g ?? 0) + 1; } });
        W(() => w.add({ id: 'sf-crop-1', kind: 'sf-crop', position: [2000, 0, 2000] }));
        w.simulate('sf-near', { near: () => {} });
        W(() => w.add({ id: 'sf-near-1', kind: 'sf-near', position: [2100, 0, 2000] }));
        engine.step(2);
        const owed = engine.saves.collect().parts.world.owed;
        return { keys: Object.keys(owed).filter(k => k.startsWith('sf-')), props: Object.keys(owed).filter(k => k.includes('sf-prop')).length };
      });
      check('unsimulated and near-only records write no owed entry', r.props === 0 && !r.keys.includes('sf-near-1'), JSON.stringify(r));
      check('a far-simulated record keeps its owed time', r.keys.includes('sf-crop-1'), JSON.stringify(r));
    },
  },
  {
    name: 'save format: quest progress is saved by step / part id; a step inserted later keeps old saves on their step; version 1 saves migrate (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const W = fn => engine.ops.allow(fn), Q = engine.quests;
        let met = false, partA = false;
        const steps = () => [
          { id: 'talk', text: 'talk', done: () => met },
          { id: 'defend', all: [{ id: 'a', text: 'A', done: () => partA }, { id: 'b', text: 'B', done: () => false }] },
          { id: 'home', text: 'home', done: () => false },
        ];
        Q.define('sf-q', { title: 'Q', steps: steps() });
        W(() => Q.start('sf-q'));
        met = true; partA = true;
        engine.step(1.2);
        const saved = structuredClone(engine.saves.collect().parts.quests.state['sf-q']);
        await engine.saves.save('sf-quest');
        // the game ships an update: a step inserted before 'defend'
        Q.define('sf-q', { title: 'Q', steps: [steps()[0], { id: 'mayor', text: 'see the mayor', done: () => false }, ...steps().slice(1)] });
        met = false; partA = false;
        await engine.saves.load('sf-quest');
        const after = { step: Q._progress['sf-q'].step, parts: Q._progress['sf-q'].parts, current: Q.list().find(q => q.id === 'sf-q').steps.find(s => s.current)?.parts?.map(p => p.done) };
        // a version 1 save (positions, booleans) of a quest without ids, and one with ids
        Q.define('sf-old', { title: 'Old', steps: [{ text: 'x', done: () => false }, { all: [{ text: 'p', done: () => false }, { text: 'q', done: () => false }] }] });
        const v1 = { savedAt: 1, versions: {}, parts: { quests: { state: { 'sf-old': { step: 1, done: false, parts: [false, true] }, 'sf-q': { step: 1, done: false, parts: [true, false] } } } } };
        const ok = engine.saves.apply(v1, 'v1');
        const now = engine.saves.collect().parts.quests.state;
        return { saved, after, ok, old: Q._progress['sf-old'], q: Q._progress['sf-q'], v2: now['sf-old'], qv2: now['sf-q'] };
      });
      check('the save names the step and the parts met', r.saved.step === 'defend' && JSON.stringify(r.saved.parts) === '["a"]', JSON.stringify(r.saved));
      check('after inserting a step, the old save resumes on the same step with the same part met', r.after.step === 2 && JSON.stringify(r.after.current) === '[true,false]', JSON.stringify(r.after));
      check('a version 1 save migrates by position', r.ok && r.old.step === 1 && JSON.stringify(r.old.parts) === '[false,true]' && JSON.stringify(r.v2) === '{"step":"1","done":false,"parts":["1"]}', JSON.stringify([r.old, r.v2]));
      check('version 1 positions are named with the ids the quest has now (the save predates ids: position 1 is now mayor)', r.q.step === 1 && JSON.stringify(r.qv2) === '{"step":"mayor","done":false}', JSON.stringify([r.q, r.qv2]));
    },
  },
  {
    name: 'save format: inventory load drops bad rows and recovers a missing key counter (open world) [guard]',
    url: '/',
    async run({ check, ev }) {
      const r = await ev(() => {
        const warns = [], warn = console.warn;
        console.warn = (...a) => warns.push(a.join(' '));
        const bad = { savedAt: 1, versions: {}, parts: { inventory: { items: [
          { id: 'film', count: 3 }, { id: 'film', count: '1e9' }, { id: 'film', count: -2 }, { count: 4 },
          { id: 'film', count: 1, key: 'film#7', data: { roll: 2 } }, { id: 'film', count: 1, key: 'film#8', data: 'x' }] } } };
        const ok = engine.saves.apply(bad, 'bad');
        console.warn = warn;
        const list = engine.inventory.bag.list().map(x => `${x.key}:${x.count}`);
        const key = engine.ops.allow(() => engine.inventory.add('film', 1, { data: { roll: 9 }, silent: true }));
        return { ok, list, warns: warns.filter(w => w.includes('dropped a saved entry')).length, seq: engine.inventory._seq };
      });
      check('only well-formed rows are loaded', r.list.join() === 'film:3,film#7:1', JSON.stringify(r));
      check('each bad row is reported once', r.warns >= 3, JSON.stringify(r));
      check('a save without seq continues after the highest key it holds', r.seq >= 8, JSON.stringify(r));
    },
  },
  {
    name: 'save format: the player vehicle is saved by id; an index from an old save still seats the player (vehicle scene) [guard]',
    url: '/tests/vehicle/index.html',
    async run({ check, ev }) {
      const r = await ev(async () => {
        const car = window.car, W = engine.world;
        engine.ops.allow(() => engine.player.enter(car));
        engine.step(0.2);
        const id = car.id, rec = W.get('player').vehicle;
        await engine.saves.save('sf-car');
        engine.ops.allow(() => engine.player.exit());
        engine.step(0.2);
        await engine.saves.load('sf-car');
        engine.step(0.1);
        const back = engine.player.vehicle === car;
        // an old save: vehicle as the index in rigid.vehicles
        engine.ops.allow(() => engine.player.exit());
        engine.step(0.1);
        const data = engine.saves.collect();
        data.parts.world.records.player.vehicle = 0;   // world v2: records keyed by id
        engine.saves.apply(data, 'old');
        engine.step(0.1);
        return { id, rec, back, legacy: engine.player.vehicle === car, now: W.get('player').vehicle };
      });
      check('the record holds the vehicle id', typeof r.id === 'string' && r.rec === r.id, JSON.stringify(r));
      check('loading seats the player in the same vehicle', r.back, JSON.stringify(r));
      check('an index from an old save is read and rewritten as the id', r.legacy && r.now === r.id, JSON.stringify(r));
    },
  },
];
