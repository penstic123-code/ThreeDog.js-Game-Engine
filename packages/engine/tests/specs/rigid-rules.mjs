// [guard] The rules of the refresh and rigid group, each held for its whole class (docs/testing/review/2026-11-07-1.0-audit/convergence-plan.md).
const THREADS = '/tests/threads/';
const J = o => JSON.stringify(o);

export const specs = [
  {
    // Rule F: engine.remove is the one way out, whatever the path to the body: the model itself, a parent, a vehicle. The other direction stays: entry.remove leaves the model
    name: '[guard] a body follows its model: engine.remove of the model or of any parent takes it, and a model keeps its place when only the body goes',
    url: THREADS,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { all: T, mk, createEngine, THREE } = threedogThreads;
        const E = mk(createEngine, 'rule-f', {});
        E.use(T.collision(), T.rigid());
        await E.start();
        const box = at => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); m.position.set(...at); return m; };
        const own = box([0, 5, 0]); E.add(own); E.rigid.addBox(own);
        const room = new THREE.Group(); E.add(room);
        const deep = new THREE.Group(); room.add(deep);
        const inner = box([4, 5, 0]); deep.add(inner); E.rigid.addBox(inner);
        const kept = box([8, 5, 0]); E.add(kept); const only = E.rigid.addBox(kept);
        const car = box([12, 5, 0]); E.add(car);
        E.rigid.addWheeled(car, { wheels: [{ position: [0.5, -0.5, 0.5], radius: 0.3 }] });
        const before = E.rigid.stats.bodies;
        E.remove(own); const a = E.rigid.stats.bodies;
        E.remove(room); const b = E.rigid.stats.bodies;
        E.remove(car); const c = { bodies: E.rigid.stats.bodies, cars: E.rigid.vehicles.length };
        only.remove(); let inScene = false; E.scene.traverse(o => { if (o === kept) inScene = true; });
        E.remove(kept);   // the body already went: nothing left to tell, and no throw
        for (let i = 0; i < 3; i++) E.step(1 / 60);
        const out = { before, a, b, c, inScene, left: E.rigid.stats.bodies };
        E.dispose();
        return out;
      });
      check('the model itself', r.before === 4 && r.a === 3, J(r));
      check('a parent two levels up', r.b === 2, J(r));
      check('a vehicle goes through its own remove', r.c.bodies === 1 && r.c.cars === 0, J(r));
      check('entry.remove leaves the model in the scene', r.inScene && r.left === 0, J(r));
    },
  },
  {
    // Rule G: one check at vec3, so the row walks entries of different owners and every way of writing a vector. What vec3 left alone stays: no argument at all means the origin
    name: '[guard] public vectors are finite: entries of every owner refuse NaN and Infinity by name, in every way of writing a vector',
    url: THREADS,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { all: T, mk, createEngine, THREE } = threedogThreads;
        const E = mk(createEngine, 'rule-g', {});
        E.use(T.collision(), T.rigid());
        await E.start();
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); E.add(m);
        const crate = E.rigid.addBox(m, { mass: 1 });
        const code = f => { try { f(); return 'taken'; } catch (e) { return e.code ?? e.message; } };
        const bad = [[NaN, 0, 0], { x: 0, y: Infinity, z: 0 }, new THREE.Vector3(0, 0, NaN), NaN];
        const doors = { impulse: v => E.rigid.impulse(crate, v), setPosition: v => E.rigid.setPosition(crate, v), overlap: v => E.collider3d.overlap(v), sweep: v => E.collider3d.sweep(v, [1, 1, 1]), sweepTo: v => E.collider3d.sweep([1, 1, 1], v), solid: v => E.collider3d.addSolid({ position: v, size: [1, 1, 1] }) };
        const out = {};
        for (const [name, door] of Object.entries(doors)) out[name] = bad.map(v => code(() => door(v)));
        const fine = { nothing: code(() => E.collider3d.overlap(undefined)), array: code(() => E.rigid.impulse(crate, [1, 0, 0])), object: code(() => E.rigid.setPosition(crate, { x: 1, z: 2 })) };
        const t = crate.body.translation();
        E.dispose();
        return { out, fine, t };
      });
      for (const [name, codes] of Object.entries(r.out)) check(`${name} refuses every bad vector`, codes.every(c => c === 'bad-position'), J(codes));
      check('control: good vectors and no vector still work', Object.values(r.fine).every(c => c === 'taken'), J(r.fine));
      check('control: the crate kept a real place', Number.isFinite(r.t.x) && r.t.z === 2, J(r.t));
    },
  },
];
