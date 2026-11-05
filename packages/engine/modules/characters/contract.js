// What any characters module must provide (fields: see gameplay/inventory.contract.js; shared check: @threedog/tools/contract).
// The player is the world record 'player' (saved with world, not under a key of its own); jumps, landings, launches and falls are events other
// modules listen to, fired by the character itself (not exercised by the shared check: they need a player on ground).
export default {
  name: 'characters',
  api: ['createPlayer', 'removePlayer', 'findSpawn', 'findPath', 'findPathAsync', 'support', 'moveInput', 'carryRiders'],
  ops: [],
  events: ['character:jump', 'character:step', 'character:land', 'character:launch', 'character:fall'],
  saves: {},
  describe: true,
  options: { npcs: false },
  probe: { setup: [], emits: [], state: null },
};
