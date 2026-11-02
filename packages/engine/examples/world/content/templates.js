// Templates: one reusable object = model + collision (+ interaction, container, state). Each placement in props.js is a world record whose kind is the template name.
// Model 'cabin' is registered by name in main.js (engine.assets.manifest); other model names come from the style. Recipe: docs/recipes/30-templates.md.
export default {
  cabin: { model: 'cabin', collide: 'box' },   // the riverside cabin; its lamp and chimney smoke follow the clock in main.js (presentation only)
};
