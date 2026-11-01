// The exhibits, relative to the stage (x right, z toward the overview camera, which stands at z = +24).
// Back row: trees, rock, flowers. Middle row: wood / stone / metal, glass, shadow receiver. Right: the room (interior and exterior in one piece).
export default [
  { id: 'pine', model: 'pine', place: 'stage', x: -14, z: -8, scale: 1.2 },
  { id: 'round-tree', model: 'roundTree', place: 'stage', x: -9, z: -8 },
  { id: 'rock', model: 'rock', place: 'stage', x: -5, z: -7, rot: 0.6, scale: 1.4 },
  { id: 'flower-a', model: ['flower', 0xf2d16b], place: 'stage', x: -2.4, z: -5 },
  { id: 'flower-b', model: ['flower', 0xe08aa0], place: 'stage', x: -1.4, z: -5.4 },
  { id: 'flower-c', model: ['flower', 0xa8c8f0], place: 'stage', x: -0.6, z: -4.8 },
  { id: 'wood', template: 'woodBlock', place: 'stage', x: 1.5, z: -3 },
  { id: 'stone', template: 'stoneBlock', place: 'stage', x: 4, z: -3 },
  { id: 'metal', template: 'metalBall', place: 'stage', x: 6.5, z: -3 },
  { id: 'glass', template: 'glassPanes', place: 'stage', x: -6, z: 2.5 },
  { id: 'shadow-stage', template: 'shadowStage', place: 'stage', x: -1.5, z: 3 },
  { id: 'room', template: 'room', place: 'stage', x: 14, z: -2, y: 0.02 },
];
