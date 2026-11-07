// What any quests module must provide (fields: see inventory.contract.js; shared check: @threedog/tools/contract).
// Who relies on it: the content loader (define, start, the startQuest effect), the hud (list() steps with target for markers), saves (quests key),
// games and tests (state(id) -> { step, steps, done, failed, active } | null, advance(id) for a step finished from code).
export default {
  name: 'quests',
  api: ['define', 'start', 'advance', 'state', 'list'],
  ops: [],
  events: ['quest:start', 'quest:step', 'quest:done'],
  saves: { quests: 3 },
  describe: true,
  options: {},
  probe: {
    setup: [['define', 'deliver', { title: 'Deliver', steps: [{ id: 'pick', text: 'Pick up', done: () => false }, { id: 'drop', text: 'Drop off', done: () => false }] }]],
    emits: [['quest:start', ['start', 'deliver']], ['quest:step', ['advance', 'deliver']], ['quest:done', ['advance', 'deliver']]],
    state: { read: ['list'], map: l => l.map(q => `${q.id}:${q.done}`).join(), expect: 'deliver:true' },
  },
};
