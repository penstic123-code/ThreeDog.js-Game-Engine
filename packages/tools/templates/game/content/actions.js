// Game key actions: action name -> default key and label. What a press does is in main.js (read in onFixed: engine.input.pressed('rest')).
// Only the neutral core actions (move, confirm, cancel) exist without an entry; module keys (jump, interact, inventory...) come from main.js options or presets.
export default {
  rest: { keys: ['KeyR'], label: 'Rest' },
};
