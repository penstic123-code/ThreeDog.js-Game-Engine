// What any dialogue module must provide (fields: see inventory.contract.js; shared check: @threedog/tools/contract).
// Who relies on it: NPC talk (start with onEnd, channel), the timeline say step (say -> a Promise with remove()), the content loader (define), NPC
// self-heal and interactions (active), conditions and effects (state.flags). fields are not methods: they must exist (active may be null).
// say / start take { channel: 'main' | 'bubble', at }: main locks input and joins the UI focus stack (its choices take the choice cursor), bubble shows a
// line over at while play goes on. dialogue.advance / dialogue.choose are the only ways keys, clicks and the dev bridge move a conversation on.
export default {
  name: 'dialogue',
  api: ['define', 'start', 'say', 'end'],
  fields: ['active', 'state'],
  ops: ['dialogue.advance', 'dialogue.choose'],
  events: ['dialogue:start', 'dialogue:line', 'dialogue:end', 'dialogue:bubble'],
  saves: {},   // story flags live in engine.vars (saved there); a conversation in progress is not saved
  describe: true,
  options: { charsPerSecond: 0 },
  probe: {
    setup: [['define', 'guide', { start: { text: 'Hello.', next: 'ask' }, ask: { text: 'Coming?', choices: [{ text: 'Yes' }, { text: 'No' }] } }]],
    emits: [['dialogue:start', ['start', 'guide']], ['dialogue:line', ['start', 'guide']], ['dialogue:end', ['end']],
      ['dialogue:bubble', ['say', 'Over here!', { channel: 'bubble', at: { x: 0, y: 0, z: 0 }, speaker: 'guide' }]]],
    state: null,
  },
};
