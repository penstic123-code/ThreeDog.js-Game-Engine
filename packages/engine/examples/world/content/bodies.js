// Physics props (a game kind, declared in rules.js): id -> { shape, place, x, z, float? }. Each entry is a world record of kind 'body' with a stable id;
// main.js gives it a mesh and a rigid body, and a pushed crate's position is saved as a change on top of this data. float: starts above the water surface.
export default {
  'crate-0': { shape: 'crate', place: 'home', x: 5, z: -1 },
  'crate-1': { shape: 'crate', place: 'home', x: 5.85, z: -1 },
  'crate-2': { shape: 'crate', place: 'home', x: 6.7, z: -1 },
  'crate-3': { shape: 'crate', place: 'home', x: 5, z: -0.1 },
  'crate-4': { shape: 'crate', place: 'home', x: 5.85, z: -0.1 },
  'crate-5': { shape: 'crate', place: 'home', x: 6.7, z: -0.1 },
  ball: { shape: 'ball', place: 'home', x: 2, z: 9 },
  barrel: { shape: 'barrel', place: 'water', x: 0, z: 0, float: true },
};
