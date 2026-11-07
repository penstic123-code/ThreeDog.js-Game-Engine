// What a three-axis collision provider must give (an object contract, shared check @threedog/tools/contract). engine.collision answers on the ground plane, with a height;
// a tilted solid, a floating island or a flying character needs all three axes. rigid is the first holder (provides: ['collider3d'], so engine.collider3d is it);
// a game's own voxel grid or BVH that passes this contract takes the slot with engine.use(mine(), { replaces: 'collider3d' }), and nothing else needs to know.
//   addSolid({ position, size | radius, rotation?, friction? })  a fixed solid, turned any way: size = [x, y, z] box, radius = ball; rotation = [x, y, z] radians or a quaternion.
//                                                         Returns { remove() }. Works before start() (rigid builds it with the world), and outlives newGame and a load
//   overlap(position, radius?)        is a ball here inside something solid? true / false
//   sweep(from, to, radius?)          move a ball from there to there: null when clear, else the first hit { point, normal, distance }; point is the ball's center at the
//                                     hit, normal the world direction out of what it hit. What a flying mover or a path source steps with
//                                     Starting in contact and moving out is clear. Sweep from the middle of a body, not its feet: a center exactly on a mesh surface has no side, and that reads as a hit at 0
// All three see every collider of the holder and skip the player's own capsule. Not here: walking (engine.collision), volumetric paths (rule characters.path).
export default {
  name: 'collider3d',
  kind: 'object',
  api: ['addSolid', 'overlap', 'sweep'],
  // Who may write where a dynamic body is (design.md section 9). The solver holds it, so the record and the model follow the body and not the other way round
  position: {
    authority: 'solver',
    writers: {
      step: 'the solver, on a fixed step; the record follows through world views',
      setPosition: 'rigid.setPosition or body.setTranslation: a placement, by anyone; it reaches the record on the next fixed step, so a read while frozen is one step late',
      vehicle: 'a seat rides its body: it reads the body and never writes it',
      load: 'a save puts it back',
    },
  },
  calls: [['addSolid', { position: [0, 0, 0], size: [1, 1, 1], rotation: [0, 0, 1] }], ['addSolid', { position: [0, 5, 0], radius: 1 }], ['overlap', [0, 0, 0], 0.5], ['sweep', [0, 9, 0], [0, -9, 0], 0.5]],
};
