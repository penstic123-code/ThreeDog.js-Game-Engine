// Props: decorations around the cabin. model is a style pack model name (lowpoly.models; use an array for parameters), position is relative to the cabin (home), rot is facing (radians).
// collide sets collision ('box', 'circle' cylinder; omit for none). Only registered, not built at once: built when the player gets near (data lives in engine.world; id rules in modules/content/props.js).
export default [
  { model: 'pine', place: 'home', x: -8, z: -6, scale: 1.2, collide: 'circle' },
  { model: 'pine', place: 'home', x: -10, z: -1, collide: 'circle' },
  { model: 'roundTree', place: 'home', x: 8, z: -7, collide: 'circle' },
  { model: 'rock', place: 'home', x: 5, z: 5, rot: 0.6, scale: 0.8, collide: 'box' },
  { model: 'rock', place: 'home', x: -5, z: 6, rot: 2.1, scale: 0.6 },
  { model: ['flower', 0xf2d16b], place: 'home', x: 1.6, z: 3.4 },
  { model: ['flower', 0xe08aa0], place: 'home', x: -1.6, z: 3.4 },
  { id: 'cabin', template: 'cabin', place: 'home', x: 0, z: 0, y: -0.05 },   // a template instance (templates.js); new entries go at the end so index ids above stay stable
];
