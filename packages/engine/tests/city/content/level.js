// Level marker points: main.js puts them into the scene when building the block; the level module reads them by name.
//   spawn = spawn point · npc_* = NPC spots · trigger_* = trigger zones (shape/radius/height become the zone's shape) · marker_* = others (teleporters)
// With a Blender-exported glTF later, place these points as empties in Blender and this file is no longer needed.
export default {
  markers: {
    spawn: { x: 0, z: 8 },
    npc_shopkeeper: { x: -11, z: 11 },
    trigger_plaza: { x: 0, z: -14, shape: 'cylinder', radius: 6, height: 4 },
    marker_gate_a: { x: 11, z: 4 },
    marker_gate_b: { x: -55, z: -44 },
  },
};
