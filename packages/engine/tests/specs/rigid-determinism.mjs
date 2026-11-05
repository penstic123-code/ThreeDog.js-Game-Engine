// Rigid determinism: same inputs + same number of fixed steps give bit-identical bodies (fresh pages, frame rate, save / load). Replay, engine.step,
// saves and the net module rely on it. Same format as the other files here; vehicle test page (flat level, a car, ?mover=rapier for the Rapier character mover).
//
// Why fresh pages and not two runs in one page: a Rapier world keeps solver caches, freed-handle order and islands that no body list shows, so a
// second run in the same page can differ where a reload does not (or hide a difference a reload has). The real loop runs between page load and
// engine.haltLoop(), a wall-clock number of steps: everything the scenario compares is built after the pause, so that number does not enter.

const READY = { timeout: 60000 };
const reopen = async page => { await page.reload(); await page.waitForFunction(() => window.engine?.ready && window.car, null, READY); };

// The scenario, run inside the page (serialized: it must be self-contained). Builds a 4-box stack knocked over by a fifth box, a rolling ball, a
// second car driving in a curve and the player walking on autopilot, then steps `seconds` of fixed steps. Returns every body pose and the player
// as exact numbers (JSON keeps doubles exact; Rapier's f32 widen to doubles exactly).
async function scenario({ seconds = 2, frameEvery = 2 }) {
  const e = window.engine, R = e.rigid, T = e.THREE;
  e.haltLoop();
  const st = { render: false, describe: false };
  // game time starts when loading ends, and the real-time loop ran a few steps (machine speed) before this pause: let the player, created on
  // engine:ready, land first, so the scenario starts from the same resting state on every page
  e.step(0.5, { ...st, frameEvery });
  {
    const box = (x, y, z) => R.addBox(new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()), { size: [1, 1, 1], mass: 2 });
    const at = (b, x, y, z) => { R.setPosition(b, [x, y, z]); b.mesh.position.set(x, y, z); return b; };
    for (let i = 0; i < 4; i++) at(box(), 5, 0.5 + i, -5);
    const hitter = at(box(), 1, 2.5, -5);
    R.impulse(hitter, [16, 1, 0.5]);
    const ball = R.addBall(new T.Mesh(new T.SphereGeometry(0.4, 8, 6), new T.MeshBasicMaterial()), { radius: 0.4, restitution: 0.5 });
    at(ball, 0, 0.4, 6); R.impulse(ball, [2, 0, 1.5]);
    const g = new T.Group(); g.add(new T.Mesh(new T.BoxGeometry(1.8, 0.6, 3.6), new T.MeshBasicMaterial()));
    g.position.set(-5, 1, 10);
    const wheels = [[-0.85, 1.2, true, false], [0.85, 1.2, true, false], [-0.85, -1.2, false, true], [0.85, -1.2, false, true]]
      .map(([x, z, steer, drive]) => ({ position: [x, 0, z], radius: 0.35, steer, drive }));
    window.detCar = R.addWheeled(g, { id: 'detCar', wheels, mass: 600, engineForce: 1200 });
    window.detCar.drive(1, 0.4, 0);
    e.input.autopilot = { x: 0.3, y: 1, speed: 1 };
  }
  e.step(seconds, { ...st, frameEvery });
  const out = R.bodies.map(b => { const t = b.body.translation(), q = b.body.rotation(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w]; });
  const p = e.player.position;
  return { bodies: out, player: [p.x, p.y, p.z], steps: e.clock?.now ?? null };
}
// first differing body and how far off it is (0 = bit-identical)
const diff = (a, b) => {
  if (a.bodies.length !== b.bodies.length) return { count: [a.bodies.length, b.bodies.length] };
  let max = 0, at = -1;
  a.bodies.forEach((x, i) => x.forEach((v, k) => { const d = Math.abs(v - b.bodies[i][k]); if (d > max) { max = d; at = i; } }));
  const pl = Math.max(...a.player.map((v, k) => Math.abs(v - b.player[k])));
  return { max, at, player: pl };
};
const same = d => d.max === 0 && d.player === 0;

export const specs = [
  {
    name: 'rigid determinism: two fresh pages, same scenario and fixed steps -> bit-identical boxes, ball, car and rapier-mover player [guard]',
    url: '/tests/vehicle/index.html?mover=rapier',
    timeout: 180000,
    async run({ page, check, ev }) {
      const a = await ev(scenario, { seconds: 3 });
      await reopen(page);
      const b = await ev(scenario, { seconds: 3 });
      const d = diff(a, b);
      check('the scenario moved things (the stack fell, the car drove)', a.bodies.length >= 8 && Math.abs(a.bodies.at(-1)[2] - 10) > 2, JSON.stringify(a.bodies.at(-1)));
      check('fresh page B equals fresh page A bit for bit', same(d), JSON.stringify(d));
      // frame rate: frame hooks once per 1 / 2 / 4 fixed steps (a slow machine renders fewer frames per step); physics only reads fixed steps
      await reopen(page);
      const c = await ev(scenario, { seconds: 3, frameEvery: 1 });
      await reopen(page);
      const f = await ev(scenario, { seconds: 3, frameEvery: 4 });
      check('frameEvery 1 and 4 give the same bodies as frameEvery 2', same(diff(a, c)) && same(diff(a, f)), JSON.stringify([diff(a, c), diff(a, f)]));
    },
  },
  {
    // A load used to put a toppling crate back upright and at rest at its record's position (the record keeps a position only), and leave a car
    // where it was at load time: the game after the load was not the saved game. The save part 'rigid' keeps pose, velocities and sleep per body id.
    name: 'rigid save: a load restores pose, rotation and velocity of bodies with an id (world-record crates mid-topple, a driving car) [guard]',
    serial: true,   // failed once beside other pages (load-sensitive), passes alone
    url: '/tests/vehicle/index.html',
    timeout: 180000,
    async run({ check, ev }) {
      const r = await ev(async () => {
        const e = window.engine, R = e.rigid, T = e.THREE, W = e.world, car = window.car, st = { render: false, describe: false };
        e.haltLoop();
        // the usual way a game saves props: world records whose model is a rigid body (positionFrom 'view'), the body named by the record id
        W.present('detbox', { positionFrom: 'view', build(rec) {
          const m = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial()); m.position.copy(rec.position);
          m.userData.body = R.addBox(m, { id: rec.id, size: [1, 1, 1], mass: 2 }); return m;
        }, dispose(rec, m) { m.userData.body?.remove(); e.remove(m); } });
        const ids = ['d0', 'd1', 'd2', 'd3', 'dh'];
        const pose = () => [...ids.map(id => W.view(id)?.userData.body?.body), car.body].map(b => {
          if (!b) return null; const t = b.translation(), q = b.rotation(), v = b.linvel(), w = b.angvel(); return [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z, w.x, w.y, w.z];
        });
        for (let i = 0; i < 4; i++) W.add({ id: 'd' + i, kind: 'detbox', position: { x: 5, y: 0.5 + i, z: -5 } });
        W.add({ id: 'dh', kind: 'detbox', position: { x: 1, y: 2.5, z: -5 } });
        e.step(1 / 60, st);
        R.impulse(W.view('dh').userData.body, [16, 1, 0.5]);
        car.drive(1, 0.3, 0);
        e.step(0.5, st);
        await e.saves.save('rigid-det');
        const atSave = pose();
        e.step(1.5, st);
        car.drive(0, 0, 0);
        const moved = pose();
        await e.saves.load('rigid-det');
        const atLoad = pose();
        let dup = null; try { R.addBox(new T.Mesh(), { id: 'd0', size: [1, 1, 1] }); } catch (err) { dup = err.code; }
        await e.saves.remove('rigid-det');
        return { atSave, moved, atLoad, dup };
      });
      const d = (a, b) => Math.max(...a.flatMap((x, i) => x ? x.map((v, k) => Math.abs(v - (b[i]?.[k] ?? NaN))) : [NaN]));
      check('between save and load the bodies moved on (otherwise this tests nothing)', d(r.atSave, r.moved) > 0.1, d(r.atSave, r.moved));
      // f32 exactly, except the quaternion Rapier renormalizes in setRotation (one f32 ulp)
      check('after the load every crate and the car has its saved pose, rotation and velocities', d(r.atSave, r.atLoad) < 1e-6, JSON.stringify({ d: d(r.atSave, r.atLoad), saved: r.atSave[4], loaded: r.atLoad[4] }));
      check('a second live body with the same id throws rigid-misuse', r.dup === 'rigid-misuse', r.dup);
    },
  },
];

