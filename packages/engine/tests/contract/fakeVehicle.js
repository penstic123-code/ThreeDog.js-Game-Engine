// A vehicle without the rigid module (a raft, a mount, a lift): the proof that characters/vehicle.contract.js is all character.enter needs.
// It slides along +Z at throttle x maxSpeed per fixed step of 1/60 s. object: whatever the camera should follow (an Object3D in the page, a plain
// { position } in Node).
export function fakeVehicle({ object = { position: { x: 0, y: 0, z: 0 } }, maxSpeed = 6 } = {}) {
  const p = object.position;
  return {
    object, driver: null, speed: 0, drives: 0,
    seatPosition: () => ({ x: p.x, y: p.y + 0.5, z: p.z }),
    exitPosition: () => ({ x: p.x + 1.5, y: p.y, z: p.z }),
    drive(throttle, steer, brake = 0) { this.drives++; this.speed = brake ? 0 : throttle * maxSpeed; p.z += this.speed / 60; },
  };
}
