// [guard] What the installed Rapier does about stale query structures, and what the engine's refresh (modules/rigid/refresh.js) may not change. A newer Rapier that gains a
// narrow route, or a step of no time that starts moving things, fails here first.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const R = createRequire(join(ENGINE, 'package.json'))('@dimforge/rapier3d-compat');
const { refreshQueries } = await import(pathToFileURL(join(ENGINE, 'modules/rigid/refresh.js')).href);

export const name = 'rapier refresh: the one native route, and what a step of no time leaves alone';

const rayHit = (w, x) => w.castRay(new R.Ray({ x, y: 10, z: 0 }, { x: 0, y: -1, z: 0 }), 20, true);
const box = (w, x, type = R.RigidBodyDesc.fixed()) => {
  const body = w.createRigidBody(type.setTranslation(x, 0, 0));
  return { body, collider: w.createCollider(R.ColliderDesc.cuboid(1, 1, 1), body) };
};
/** Each case: the change, then which x must answer after a refresh, and which must not */
const cases = {
  add: w => { box(w, 10); return [10, null]; },
  move: (w, s) => { s.moved.body.setTranslation({ x: 20, y: 0, z: 0 }, true); return [20, -20]; },
  'remove and reuse': (w, s) => { w.removeCollider(s.gone.collider, false); w.removeRigidBody(s.gone.body); box(w, 40); return [40, 30]; },
  kinematic: (w, s) => { s.kin.body.setTranslation({ x: 50, y: 0, z: 0 }, true); return [50, -30]; },
};
const fresh = () => {
  const w = new R.World({ x: 0, y: -9.81, z: 0 });
  const s = { moved: box(w, -20), gone: box(w, 30), kin: box(w, -30, R.RigidBodyDesc.kinematicPositionBased()) };
  w.step();
  return [w, s];
};
const once = w => { const dt = w.timestep; w.timestep = 0; w.step(); w.timestep = dt; };
const routes = { none() {}, propagate: w => w.propagateModifiedBodyPositionsToColliders(), once, refresh: w => refreshQueries(w) };

export async function run({ check }) {
  await R.init();
  const answers = {};
  for (const [route, go] of Object.entries(routes)) for (const [what, change] of Object.entries(cases)) {
    const [w, s] = fresh();
    const [yes, no] = change(w, s);
    go(w);
    answers[`${route} ${what}`] = !!rayHit(w, yes) && (no == null || !rayHit(w, no));
    w.free();
  }
  check('no narrower native route: World has neither updateSceneQueries nor a query pipeline', typeof R.World.prototype.updateSceneQueries !== 'function' && !R.QueryPipeline);
  for (const what of Object.keys(cases)) check(`${what}: the refresh answers from the present`, answers[`refresh ${what}`]);
  for (const what of ['add', 'move', 'remove and reuse', 'kinematic']) check(`${what}: with no refresh the query is stale`, !answers[`none ${what}`]);
  check('propagate alone does not refresh a move', !answers['propagate move'], JSON.stringify(answers));
  check('one step of no time does not refresh a move either: why two', !answers['once move'], JSON.stringify(answers));

  // what it leaves alone: a body in flight, a resting body with its contact, a pending kinematic move, the step length
  const w = new R.World({ x: 0, y: -9.81, z: 0 });
  w.timestep = 1 / 60;
  const length = w.timestep;   // Rapier holds it in 32 bits
  box(w, 0);
  const fly = box(w, 10, R.RigidBodyDesc.dynamic()), rest = box(w, 0, R.RigidBodyDesc.dynamic()), slide = box(w, 20, R.RigidBodyDesc.kinematicVelocityBased());
  rest.body.setTranslation({ x: 0, y: 2.05, z: 0 }, true);
  fly.body.setTranslation({ x: 10, y: 50, z: 0 }, true);
  fly.body.setLinvel({ x: 1, y: 2, z: 3 }, true);
  fly.body.setAngvel({ x: 0.1, y: 0.2, z: 0.3 }, true);
  slide.body.setLinvel({ x: 2, y: 0, z: 0 }, true);
  for (let i = 0; i < 30; i++) w.step();
  const state = () => ({ flyV: fly.body.linvel(), flyA: fly.body.angvel(), flyP: fly.body.translation(), restV: rest.body.linvel(), restP: rest.body.translation(), slideP: slide.body.translation(), slideV: slide.body.linvel(), sleeping: rest.body.isSleeping() });
  const contacts = () => { let n = 0; w.contactPairsWith(rest.collider, () => n++); return n; };
  const a = JSON.stringify(state()), c = contacts();
  refreshQueries(w);
  check('velocities, positions and sleep stay as they were', JSON.stringify(state()) === a, `${a} -> ${JSON.stringify(state())}`);
  check('a resting contact stays', contacts() === c && c > 0, `${c} -> ${contacts()}`);
  check('the step length comes back', w.timestep === length, w.timestep);
  // a pending kinematic move still arrives with the step it was meant for, and hands the pushed body its speed then
  const kin = box(w, 60, R.RigidBodyDesc.kinematicPositionBased());
  w.step();
  kin.body.setNextKinematicTranslation({ x: 61, y: 0, z: 0 });
  refreshQueries(w);
  const held = kin.body.translation().x;
  w.step();
  check('a pending kinematic move survives a refresh and lands on the next real step', Math.abs(kin.body.translation().x - 61) < 1e-5, `${held} -> ${kin.body.translation().x}`);

  // the length comes back through a throw too
  const step = w.step;
  w.step = () => { throw new Error('rapier failed'); };
  let threw = false;
  try { refreshQueries(w); } catch { threw = true; }
  w.step = step;
  check('a failing step leaves the step length as it was', threw && w.timestep === length, w.timestep);
  w.free();
}
