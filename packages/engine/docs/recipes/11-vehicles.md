# Vehicles and boarding

Required modules: `collision()` + `rigid()` (Rapier physics; the vehicle controller lives there) + `characters()`. With
`interactions({ ...presets.interactions.nearest })` installed, a "board/exit" prompt (E key) appears automatically near a vehicle.
Convention: **the front of the car faces the model's +Z**, and a wheel's `position` is relative to the body origin (meters). Rapier has to be
downloaded and initialized, so build the car after `engine:ready`.

## 1. Build a car (main.js)
```js
import { presets, THREE, makeMaterial } from 'threedog';

function makeCar() {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 3.6), makeMaterial('vehicle', { color: 0xc04a3a }));
  body.position.y = 0.3; body.castShadow = true; car.add(body);
  const wheels = [[-0.85, 1.2, true, false], [0.85, 1.2, true, false], [-0.85, -1.2, false, true], [0.85, -1.2, false, true]].map(([x, z, steer, drive]) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 10).rotateZ(Math.PI / 2), makeMaterial('vehicle', { color: 0x333333 }));
    w.position.set(x, 0, z); car.add(w);                               // wheels are children of the body: they follow suspension, steering and rolling
    return { position: [x, 0, z], radius: 0.35, steer, drive, object: w };
  });
  return { car, wheels };
}

engine.events.on('engine:ready', () => {
  const { car, wheels } = makeCar();
  car.position.set(10, engine.surface(10, 0) + 1.5, 0);                // place it slightly above the ground and let it drop
  const v = engine.rigid.addWheeled(car, { wheels, mass: 600, engineForce: 1200, camera: { distance: 14, height: 2 } });
  window.car = v;                                                     // handy for tests and the console
});
```
`addWheeled` options: `id` stable id (default `vehicle1`, `vehicle2`... in creation order; give one when that order varies), `wheels` (at least 3),
`mass` in kg, `engineForce` throttle force, `brakeForce`, `maxSteer` in radians, `suspension: { rest, stiffness, damping }`,
`seats` seat positions (the first drives, the rest ride; each exits on its own side), `hideDriver` (default true; false keeps riders visible on their seats: bikes, karts, open carts), `camera` camera distance/height while driving, `size` body collision box (by default the model's bounding box, wheels excluded),
`friction` grip, `exitOffset` how far from the side of the body the player lands when exiting (meters, default 0.8).
Rigid bodies and vehicles do not change a model's shadow settings: set `mesh.castShadow = true` yourself if you want a shadow.

## 2. Boarding and driving
- Player: press E near the car to board (when interactions is installed); while driving, WASD = throttle/steering; the brake key (action `brake`, only
  when the game gives one: `characters({ ...presets.keys.brake })` is B / gamepad LT, or `characters({ brakeKeys: ['KeyX'] })`; keep it off Space so
  it doesn't compete with jumping) brakes, and without one the engine warns once; press E again to exit.
- Saving: the player save records which vehicle the player is in (its `id`); loading an on-foot save while driving exits the vehicle first, and
  loading a driving save puts the player back in the car.
- Code: `engine.player.enter(v)`, `engine.player.exit()`; `engine.player.vehicle` is the vehicle being driven (null when on foot); `v.driver` is who is driving, `v.passengers` who rides, `character.seat` the seat (0 drives; a second `enter` takes a free passenger seat, which does not steer).
- NPCs/scripts driving: `v.drive(throttle -1..1, steer -1..1 (right is positive), brake 0-1)`; the last values set are used on every fixed step.
- Events: `vehicle:enter`, `vehicle:exit` (`{ character, vehicle }`). Removal: `v.remove()` (anyone inside exits first; the model stays,
  `engine.remove(car)` deletes it).
- Native objects: `v.body` (Rapier rigid body), `v.controller` (vehicle controller), `v.speed` (m/s, negative when reversing).

## 3. Rigid bodies: saves, joints, determinism
This section covers every `engine.rigid` body (crates, balls, hulls, vehicles), not only cars.

**Saves.** A body added with an `id` (`rigid.addBox(mesh, { id: rec.id })`; vehicles always have one) is saved with its pose, rotation,
velocities and sleep, and a load gives that state back to the body with the same id, also when it is built after the load (a world presenter's
`build`). A body without an id is not saved: after a load it is wherever its record (or your code) puts it, upright and at rest.

**Joints** (hinges, doors, ropes, chains) are plain Rapier on engine bodies; the engine has no wrapper:
```js
const R = engine.rigid, J = R.R.JointData;
const post = R.addBox(postMesh, { fixed: true }), door = R.addBox(doorMesh, { mass: 8 });
// hinge on the post's right edge, turning around Y; anchors are in each body's local space
const hinge = R.world.createImpulseJoint(J.revolute({ x: 0.5, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), post.body, door.body, true);
hinge.setLimits(-1.5, 1.5);
// rope: the weight hangs at most 2 m below the hook
R.world.createImpulseJoint(J.rope(2, { x: 0, y: -0.5, z: 0 }, { x: 0, y: 0.5, z: 0 }), hook.body, weight.body, true);
```
`R.world` is the Rapier world and `entry.body` the Rapier body. newGame and a load rebuild the physics world (physics starts over like a fresh
page) and free the old world's joints with it; the engine does not copy them. It emits `rigid:rebuilt` once the bodies are back, and that is
where a game re-creates its joints, with the same code that made them:
```js
function hang() {   // makes the joints; called after the bodies are added, and again after every rebuild
  const h = R.world.createImpulseJoint(J.revolute({ x: 0.5, y: 0, z: 0 }, { x: -0.5, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), post.body, door.body, true);
  h.setLimits(-1.5, 1.5);
  R.world.createImpulseJoint(J.rope(2, { x: 0, y: -0.5, z: 0 }, { x: 0, y: 0.5, z: 0 }), hook.body, weight.body, true);
}
hang();
engine.events.on('rigid:rebuilt', hang);   // { world, player, bodies }: bodies maps the ids you gave addBox / addBall / addHull
```
`entry.body` already points at the rebuilt body there; a joint object kept from before belongs to the freed world (hold the new one). A body
the game made with `world.createRigidBody` is not rebuilt: make anchors with `addBox(mesh, { fixed: true })`. In development a `rigid-misuse`
warning names a rebuild that dropped joints when none was re-created by the next step. Joints are not saved: on a load, bodies a presenter's
`build` adds come back after the event, so create their joints in that `build`. With a vehicle present the world is kept (no event, joints
stay). Removing a body removes its joints (Rapier does that).

**Determinism**, the one place this is stated (replay, `engine.step`, saves and net link here):
- Same build, same machine, same inputs and the same number of fixed steps give bit-identical bodies, in a fresh page and at any frame rate.
  Physics only advances in fixed steps. Test: `npm test -- "rigid determinism"`: stacked boxes knocked over, a rolling ball, a driving car, the
  `mover: 'rapier'` player, two fresh pages, `frameEvery` 1 / 2 / 4.
- A load restores each saved body exactly. Rapier's contact and warm-start caches and its solver order are not saved, so the run after a load
  is not bit-identical to the run that went on without the load. A toppling stack can end some centimetres away (measured: 0.24 m after 1.5 s).
  Bodies at rest stay at rest. Bit-identical continuation would need `world.takeSnapshot()`, which includes the terrain colliders (about 650 KB
  for the open world's 9 chunks) and is not used.
- Across machines: the engine uses `@dimforge/rapier3d-compat`, which Rapier does not promise to be cross-platform deterministic (that is the
  separate `rapier3d-deterministic` build). Two machines can drift apart. The net module does not depend on matching physics: the host owns the
  state, and physics is not synced (each machine simulates its own bodies).

## 4. Verify
- In a test (no real key presses): `engine.player.enter(car); engine.input.autopilot = { x: 0, y: 1 }; engine.step(3)`,
  then `describe().player.vehicle.speed` is above 0 and the car has moved; after `engine.player.exit()`, `engine.player.vehicle` is null and the
  player stands outside the door.
- Vehicle speed is only in the object form `engine.describe().player.vehicle` (the player line of describeText does not show it);
  `describe().player.mover` and `grounded` are there too.
- Related test: `npm test -- 载具` (test page in the engine repository: `packages/engine/tests/vehicle/`, with a complete car and steps).
