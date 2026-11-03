// What any particles module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// Content's `{ particles: { name, at, count } }` run calls emit; games define effects, attach emitters and read counts. Nothing is saved:
// particles are presentation, so a replacement only has to answer these calls.
export default {
  name: 'particles',
  api: ['define', 'emit', 'attach', 'count'],
  ops: [],
  events: [],
  saves: {},
  describe: true,
  options: {},
  probe: {
    setup: [['define', 'spark', { max: 8 }], ['emit', 'spark', { x: 0, y: 0, z: 0 }, { count: 3 }]],
    emits: [],
    state: null,
  },
};
