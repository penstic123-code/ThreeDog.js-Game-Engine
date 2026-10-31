// Templates: one reusable object = model + collision + interaction (+ container, state). Each placement in props.js is a world record of this kind.
// model is a style pack model name (lowpoly.models) or an assets name. Recipe: node_modules/threedog/docs/recipes/30-templates.md.
export default {
  stash: {
    model: 'rock', collide: 'box',
    interact: { label: 'Search', op: 'stash.search' },   // E near it runs the op (defined in main.js) with { id } of this stash
    container: { capacity: 4, items: { apple: 2 } },      // each stash gets a container whose id is its record id; items = starting goods (placed once)
  },
};
