// Placements: what stands in the level. { template, id, place, x, z } places an instance of a template (templates.js); { model, place, x, z } a plain prop.
// Give each placement a stable id: saves store only what play changed on top of this list, keyed by id.
export default [
  { id: 'stash-home', template: 'stash', place: 'home', x: 3, z: -4 },
];
