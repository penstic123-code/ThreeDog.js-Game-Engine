// What any game-flow module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// A state that stops the game holds engine.freeze('flow') (not engine.haltLoop), so describe().holds and the settings menu see who holds it.
export default {
  name: 'flow',
  api: ['define', 'go', 'transition'],
  fields: ['state'],   // the settings menu reads what to go back to
  ops: [],
  events: ['flow:change', 'flow:transition'],
  saves: {},
  describe: true,
  options: {},
  probe: {
    setup: [['define', 'title', { freeze: true }]],
    emits: [['flow:change', ['go', 'title']]],
    state: null,
  },
};
