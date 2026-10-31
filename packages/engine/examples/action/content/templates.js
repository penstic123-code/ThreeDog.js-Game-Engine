// Templates: one reusable object = model + collision (+ state). Each placement in props.js is a world record whose kind is the template name.
// Model names are this example's own generators (models.js, registered in main.js). Recipe: docs/recipes/30-templates.md.
export default {
  floor: { model: 'floor' },                              // walked on; the room has no terrain
  wall: { model: 'wall', collide: 'box' },
  pillar: { model: 'pillar', collide: 'circle' },
  // The enemy: its stats are instance state, so a placement can make a tougher one ({ template: 'slime', hp: 6, maxHp: 6 }).
  // static: false keeps it out of the static ray set, because it moves; hit detection is the example's own rule in main.js.
  slime: { model: 'enemy', static: false, state: { hp: 3, maxHp: 3, damage: 1, cooldown: 0, drop: 'gem' } },
};
