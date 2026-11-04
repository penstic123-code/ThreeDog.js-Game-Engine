// What any interactions module must provide (fields: see inventory.contract.js; shared check: @threedog/tools/contract).
// The prompt UI part and the pick rule are replaceable without replacing the module (pick: fn, engine.ui parts).
export default {
  name: 'interactions',
  api: ['add', 'get', 'pick'],
  ops: ['interaction.use'],
  events: ['interaction:hold', 'interaction:interrupt'],
  saves: { interactions: 1 },   // only what once / counter used; the interactions themselves the game / world adds again when things are rebuilt on load
  describe: true,
  options: { pick: 'nearest' },   // the probe needs no key (the game binds it in real use)
  probe: {
    setup: [['add', { x: 0, y: 0, z: 0 }, { id: 'door', label: 'Open' }]],
    emits: [],
    state: null,
  },
};
