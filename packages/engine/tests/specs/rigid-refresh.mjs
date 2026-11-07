// [guard] A copy of another owner's data syncs on read, comparing owner and version (core/base/follows.js). The rows drive every way the rigid copy can fall behind while no step runs.
const THREADS = '/tests/threads/';
const J = o => JSON.stringify(o);

export const specs = [
  {
    name: '[guard] refresh while frozen: walls, solids, bodies and moves reach rigid queries, and a step of no time disturbs nothing',
    url: THREADS,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { all: T, mk, createEngine, THREE } = threedogThreads;
        const E = mk(createEngine, 'refresh-frozen', {});
        E.use(T.collision(), T.rigid());
        await E.start();
        const box = at => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); m.position.set(...at); E.add(m); return m; };
        const falling = E.rigid.addBox(box([20, 30, 0]), { mass: 1 });
        for (let i = 0; i < 10; i++) E.step(1 / 60);
        const pose = () => { const t = falling.body.translation(), v = falling.body.linvel(); return [t.x, t.y, t.z, v.x, v.y, v.z]; };
        const hold = E.freeze('menu'), was = pose(), out = {};
        const wall = E.collision.addBox([10, 0, 0], { halfWidth: 1, halfDepth: 1, height: 6 });
        out.wall = E.collider3d.overlap([10, 2, 0], 0.5);
        out.wallSweep = !!E.collider3d.sweep([7, 2, 0], [13, 2, 0], 0.2);
        wall.remove();
        out.wallGone = E.collider3d.overlap([10, 2, 0], 0.5);
        const solid = E.collider3d.addSolid({ position: [-10, 2, 0], size: [2, 2, 2] });
        out.solid = E.collider3d.overlap([-10, 2, 0], 0.5);
        solid.remove();
        out.solidGone = E.collider3d.overlap([-10, 2, 0], 0.5);
        const crate = E.rigid.addBox(box([0, 2, 10]), { mass: 1 });
        out.body = E.collider3d.overlap([0, 2, 10], 0.2);
        E.rigid.setPosition(crate, [0, 2, 20]);
        out.moved = [E.collider3d.overlap([0, 2, 10], 0.2), E.collider3d.overlap([0, 2, 20], 0.2)];
        crate.remove();
        out.bodyGone = E.collider3d.overlap([0, 2, 20], 0.2);
        out.still = J2(pose()) === J2(was);
        hold.remove();
        E.step(1 / 60);
        out.goesOn = pose()[1] < was[1];
        // what a query pays: the plain read, then one with a change to bring in
        const t0 = performance.now(); for (let i = 0; i < 20000; i++) E.collider3d.overlap([50, 50, 50], 0.1);
        const t1 = performance.now(); for (let i = 0; i < 200; i++) { E.collider3d.addSolid({ position: [60, 60, 60], size: [1, 1, 1] }).remove(); E.collider3d.overlap([50, 50, 50], 0.1); }
        out.us = { read: (t1 - t0) / 20000 * 1000, changed: (performance.now() - t1) / 200 * 1000 };
        E.dispose();
        return out;
        function J2(a) { return JSON.stringify(a); }
      });
      check('a wall comes and goes', r.wall === true && r.wallSweep === true && r.wallGone === false, J(r));
      check('a solid comes and goes', r.solid === true && r.solidGone === false, J(r));
      check('a body comes, moves and goes', r.body === true && r.moved[0] === false && r.moved[1] === true && r.bodyGone === false, J(r));
      check('the refresh moved nothing: pose and speed are the same to the bit', r.still === true, J(r));
      check('control: the world goes on after the freeze', r.goesOn === true, J(r));
      check(`measured: a read ${r.us.read.toFixed(2)} us, with a change ${r.us.changed.toFixed(1)} us`, r.us.read < 50, J(r.us));
    },
  },
  {
    name: '[guard] refresh of the ground: a world box with no height stands on the next level at once, also while frozen',
    url: THREADS,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const { all: T, mk, createEngine, THREE } = threedogThreads;
        const flat = y => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100), new THREE.MeshBasicMaterial()); m.position.y = y - 0.5; g.add(m); return g; };
        const E = mk(createEngine, 'refresh-ground', {});
        E.use(T.collision(), T.level({ scene: flat(0) }), T.rigid());
        await E.start();
        E.collision.addBox([5, 0, 0], { halfWidth: 1, halfDepth: 1, height: 2 });
        E.step(1 / 60);
        const low = E.collider3d.overlap([5, 1, 0], 0.2);
        const hold = E.freeze('menu');
        await E.level.load(flat(20));
        const out = { low, ground: E.surface(5, 0), old: E.collider3d.overlap([5, 1, 0], 0.2), now: E.collider3d.overlap([5, 21, 0], 0.2) };
        hold.remove(); E.dispose();
        return out;
      });
      check('control: the box stood on the first level, and the ground rose', r.low === true && Math.abs(r.ground - 20) < 0.01, J(r));
      check('it left the old height and stands on the new one', r.old === false && r.now === true, J(r));
    },
  },
];
