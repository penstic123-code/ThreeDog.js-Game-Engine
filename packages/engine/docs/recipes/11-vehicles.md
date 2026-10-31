# Vehicles and boarding

Required modules: `collision()` + `rigid()` (Rapier physics; the vehicle controller lives there) + `characters()`. With `interactions()` installed, a "board/exit" prompt (E key) appears automatically near a vehicle.
Convention: **the front of the car faces the model's +Z**, and a wheel's `position` is relative to the body origin (meters). Rapier has to be downloaded and initialized, so build the car after `world:ready`.

## 1. Build a car (main.js)
```js
import { THREE, makeMaterial } from 'threedog';

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

engine.events.on('world:ready', () => {
  const { car, wheels } = makeCar();
  car.position.set(10, engine.surface(10, 0) + 1.5, 0);                // place it slightly above the ground and let it drop
  const v = engine.rigid.addVehicle(car, { wheels, mass: 600, engineForce: 1200, camera: { distance: 14, height: 2 } });
  window.car = v;                                                     // handy for tests and the console
});
```
`addVehicle` options: `wheels` (at least 3), `mass` in kg, `engineForce` throttle force, `brakeForce`, `maxSteer` in radians, `suspension: { rest, stiffness, damping }`,
`seat` seat position, `camera` camera distance/height while driving, `size` body collision box (by default the model's bounding box, wheels excluded), `friction` grip, `exitOffset` how far from the side of the body the player lands when exiting (meters, default 0.8).
Rigid bodies and vehicles do not change a model's shadow settings: set `mesh.castShadow = true` yourself if you want a shadow.

## 2. Boarding and driving
- Player: press E near the car to board (when interactions is installed); while driving, WASD = throttle/steering; the B key / gamepad LT (action `brake`, registered when rigid is installed; change it with `characters({ brakeKeys: ['KeyX'] })`, so it doesn't compete with Space for jumping) brakes; press E again to exit.
- Saving: the player save records which vehicle the player is in (its index in `rigid.vehicles`); loading an on-foot save while driving exits the vehicle first, and loading a driving save puts the player back in the car.
- Code: `engine.player.enter(v)`, `engine.player.exit()`; `engine.player.vehicle` is the vehicle being driven (null when on foot); `v.driver` is who is driving.
- NPCs/scripts driving: `v.drive(throttle -1..1, steer -1..1 (right is positive), brake 0-1)`; the last values set are used on every fixed step.
- Events: `vehicle:enter`, `vehicle:exit` (`{ character, vehicle }`). Removal: `car.remove()` (anyone inside exits first).
- Native objects: `v.body` (Rapier rigid body), `v.controller` (vehicle controller), `v.speed` (m/s, negative when reversing).

## 3. Verify
- In a test (no real key presses): `engine.player.enter(car); engine.input.autopilot = { x: 0, y: 1 }; engine.step(3)`,
  then `describe().player.vehicle.speed` is above 0 and the car has moved; after `engine.player.exit()`, `engine.player.vehicle` is null and the player stands outside the door.
- Vehicle speed is only in the object form `engine.describe().player.vehicle` (the player line of describeText does not show it); `describe().player.mover` and `grounded` are there too.
- Related test: `npm test -- 载具` (test page in the engine repository: `packages/engine/tests/vehicle/`, with a complete car and steps).
