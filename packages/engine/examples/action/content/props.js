// What stands in the room (rule R33: the level is content). Every entry has a stable id so saves store only what play changed.
export default [
  { id: 'floor', template: 'floor', place: 'room', x: 0, z: 0 },
  { id: 'wall-n', template: 'wall', place: 'room', x: 0, z: -8 },
  { id: 'wall-s', template: 'wall', place: 'room', x: 0, z: 8 },
  { id: 'wall-w', template: 'wall', place: 'room', x: -8, z: 0, rot: 1.5708 },
  { id: 'wall-e', template: 'wall', place: 'room', x: 8, z: 0, rot: 1.5708 },
  { id: 'pillar-1', template: 'pillar', place: 'room', x: -4, z: 0 },
  { id: 'pillar-2', template: 'pillar', place: 'room', x: 4, z: 0 },
  { id: 'slime-1', template: 'slime', place: 'room', x: 0, z: 3 },
];
