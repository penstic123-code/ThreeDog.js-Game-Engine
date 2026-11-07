// A character without the characters module: the proof that characters/character.contract.js is all the engine asks of one. No seats, no walking; a pose is kept as given.
// root: an Object3D in the page, a plain { position } in Node.
export function fakeCharacter({ id = 'hero', root = { position: { x: 0, y: 0, z: 0 } } } = {}) {
  const put = p => { root.position.x = p.x; root.position.y = p.y; root.position.z = p.z; };
  return {
    id, root, state: 'idle', anim: null, channel: 'world', vehicle: null, seat: null, facing: 0, pose: {},
    disposed: false, cameraFollow: false, limp: false, bodyHeld: false, velocity: { x: 0, y: 0, z: 0 }, vy: 0, moveAmount: 0, stateMark: 'idle', mover: null,
    get position() { return root.position; },
    move() {}, placeAt: put, placeRecord: put, enter() {}, exit() {}, walkTo() { return { status: 'failed', remove() {} }; },
    poseProblem: () => null, takePose(pose) { Object.assign(this.pose, pose); },
    seatProblem: () => `character '${id}' has no seats`, backInSeat() {}, syncRecord() {},
  };
}
