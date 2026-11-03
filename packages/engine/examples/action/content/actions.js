// This example's key actions: name -> keys and label. What a press does lives in main.js (attack in a fixed step, retry / save / load in the frame hook).
// Move, interact (E, presets.bindings.interact) and the bag (I, presets.bindings.inventory) come from their modules.
export default {
  attack: { keys: ['Mouse0', 'KeyF'], label: 'Attack' },
  retry: { keys: ['KeyR'], label: 'Retry' },
  save: { keys: ['KeyK'], label: 'Save' },
  load: { keys: ['KeyL'], label: 'Load' },
};
