// Props in world coordinates (the island is centred on 0, 0; the river runs east-west near z = 2, the wheat field is north-east around 14, -13).
// Trees ring the meadow, the flock grazes south of the river, facing different ways. rot is yaw in radians.
export default [
  { id: 'tree-1', template: 'tree', x: -18, z: -10, scale: 1.1, rot: 0.4 },
  { id: 'tree-2', template: 'tree', x: -11, z: -17, scale: 0.9, rot: 2.1 },
  { id: 'tree-3', template: 'tree', x: -21, z: -2, scale: 1.0, rot: 4.0 },
  { id: 'tree-4', template: 'tree', x: 12, z: 17, scale: 1.0, rot: 1.2 },
  { id: 'tree-5', template: 'tree', x: 19, z: 13, scale: 0.85, rot: 5.3 },
  { id: 'tree-6', template: 'tree', x: -2, z: -19, scale: 1.2, rot: 3.1 },
  { id: 'tree-7', template: 'tree', x: 24, z: -2, scale: 0.9, rot: 0.9 },
  { id: 'sheep-1', template: 'sheep', x: -7, z: 12, rot: 0.3 },
  { id: 'sheep-2', template: 'sheep', x: -4.5, z: 13.5, rot: -0.8 },
  { id: 'sheep-3', template: 'sheep', x: -8.5, z: 15, rot: 2.4 },
  { id: 'sheep-4', template: 'sheep', x: -5.5, z: 16.5, rot: 1.1 },
  { id: 'sheep-5', template: 'sheep', x: -2.5, z: 11, rot: -2.0 },
  { id: 'sheep-6', template: 'sheep', x: -10, z: 11.5, rot: 0.9, scale: 0.9 },
  { id: 'sheep-7', template: 'sheep', x: -3, z: 15.5, rot: 3.6, scale: 1.05 },
  { id: 'sheep-8', template: 'sheep', x: -1, z: 13, rot: -0.2, scale: 0.85 },
];
