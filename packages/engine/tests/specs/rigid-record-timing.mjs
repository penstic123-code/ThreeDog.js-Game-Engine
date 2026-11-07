// [guard] A world record driven by a physics body (positionFrom 'view') equals the solver at the end of every fixed step, so a save and the next step read this step's
// result, not the one before. Real Rapier. Run: threedog test "Rigid record"
const PAGE = '/tests/threads/';
const J = JSON.stringify;

export const specs = [
  {
    name: '[guard] Rigid record: a live body\'s record equals the solver at the end of a fixed step and in a save',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, all: T, THREE } = threedogThreads, out = { gaps: [] };
        const E = mk(T.createEngine, 'rr-timing');
        E.use(T.world(), T.collision(), T.content(), T.rigid());
        await E.start(); E.haltLoop();
        const steps = async n => { for (let i = 0; i < n; i++) { E.step(1 / 60, { render: false, describe: false }); await new Promise(res => setTimeout(res, 0)); } };
        E.assets.manifest({ name: 'rr', models: { rrBox: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()) } });
        E.content.load({ templates: { rrCrate: { model: 'rrBox', body: { shape: 'box', mass: 1 } } }, props: [{ id: 'rr-a', template: 'rrCrate', x: 4, z: 4 }] });
        for (let i = 0; i < 60 && !E.world.view('rr-a'); i++) await steps(1);
        const view = E.world.view('rr-a'), b = E.rigid.bodies.find(x => x.mesh === view);
        out.found = !!b;
        b.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
        const gap = p => { const t = b.body.translation(); return Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z); };
        for (let i = 0; i < 10; i++) { await steps(1); out.gaps.push(gap(E.world.get('rr-a').position)); }
        const saved = E.saves.collect().parts.world, s = J => J;
        out.savedKeys = Object.keys(saved);
        const entry = saved.changed?.['rr-a'] ?? saved.diff?.['rr-a'] ?? saved.records?.find?.(x => x.id === 'rr-a') ?? null;
        out.entry = entry;
        out.saveGap = entry?.position || entry?.set?.position ? gap(entry.position ?? entry.set.position) : null;
        E.dispose();
        return out;
      });
      check('the crate has a body', r.found, J(r));
      check('record equals the solver after every step of a moving body', Math.max(...r.gaps) < 1e-6, J(r.gaps));
      check('the save holds the solver\'s position', r.saveGap !== null && r.saveGap < 1e-6, J(r));
    },
  },
  {
    name: '[guard] Rigid record: the body decides a template copy\'s pose in a save: untouched stays out, a nudge is kept, a load puts back turn, speed and height',
    url: PAGE,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { mk, all: T, THREE } = threedogThreads, out = {};
        const E = mk(T.createEngine, 'rr-owner');
        E.use(T.world(), T.collision(), T.content(), T.rigid());
        await E.start(); E.haltLoop();
        const steps = async n => { for (let i = 0; i < n; i++) { E.step(1 / 60, { render: false, describe: false }); await new Promise(res => setTimeout(res, 0)); } };
        E.assets.manifest({ name: 'rr', models: { rrBox: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()) } });
        E.content.load({ templates: { rrCrate: { model: 'rrBox', body: { shape: 'box', mass: 1 } } }, props: [{ id: 'rr-a', template: 'rrCrate', x: 4, z: 4 }] });
        for (let i = 0; i < 60 && !E.world.view('rr-a'); i++) await steps(1);
        const body = () => E.rigid.bodies.find(x => x.id === 'rr-a')?.body, parts = () => E.saves.collect().parts;
        const inSave = () => { const p = parts(); return [!!p.rigid['rr-a'], !!p.world.changed['rr-a']]; };
        await steps(90);
        out.settled = body().isSleeping();
        out.untouched = inSave();
        await E.saves.save('a'); await E.saves.load('a');
        out.afterLoad = inSave();
        await steps(90);
        const was = body().translation();
        body().setLinvel({ x: 0.2, y: 0, z: 0 }, true);
        await steps(90);
        const now = body().translation();
        out.nudge = Math.hypot(now.x - was.x, now.z - was.z);
        out.nudged = inSave();
        body().setTranslation({ x: 4, y: 3, z: 4 }, true); body().setLinvel({ x: 1, y: 2, z: 0 }, true); body().setAngvel({ x: 1, y: 2, z: 3 }, true);
        await steps(5);
        const a = structuredClone(parts());
        await E.saves.save('b'); await E.saves.load('b');
        const b = structuredClone(parts());
        out.state = [a.rigid['rr-a'], b.rigid['rr-a']];
        out.record = [a.world.changed['rr-a'], b.world.changed['rr-a']];
        E.ops.run('thing.set', { id: 'rr-a', position: [7, 0, 7] });
        await steps(60);
        out.placed = E.world.get('rr-a').position.y;
        E.dispose();
        return out;
      });
      check('an untouched crate settles asleep with no entry in either save part', r.settled && J(r.untouched) === '[false,false]', J(r));
      check('a load writes no entry for it', J(r.afterLoad) === '[false,false]', J(r));
      check('a nudge under the settling distance is saved', r.nudge > 0.001 && r.nudge < 0.05 && r.nudged[0], J(r));
      check('turn, speed and height come back from a load', J(r.state[0]) === J(r.state[1]) && r.state[0][1] > 1, J(r.state));
      check('the record follows the body across the load', J(r.record[0]) === J(r.record[1]), J(r.record));
      check('a place written with no height stands the crate on the ground', Math.abs(r.placed - 0.5) < 0.02, J(r.placed));
    },
  },
];
