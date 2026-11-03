// The one default key preset and its labels. Split out of Input.js.
// Only the basics live here: the direction axis (input.axis, the touch stick), menu confirm / cancel and the UI cursor. Every game needs them and
// nothing in them does anything until a game or module reads them, so they are the base value of their action (the game's bind hides it).
// Every other key is the game's choice: modules declare actions and their context, never keys (input.action), and the game binds them
// (createEngine({ bindings }), engine.input.bind, or a presets.bindings.* map). This file and presets.js are the only places in the engine that
// may name a key (the static check in tests/specs/input-owners.mjs).
export const BASIC_KEYS = Object.freeze({
  moveForward: Object.freeze(['KeyW', 'ArrowUp']),
  moveBack: Object.freeze(['KeyS', 'ArrowDown']),
  moveLeft: Object.freeze(['KeyA', 'ArrowLeft']),
  moveRight: Object.freeze(['KeyD', 'ArrowRight']),
  confirm: Object.freeze(['Space', 'Enter', 'PadA']),
  cancel: Object.freeze(['Escape', 'PadB']),
  // The UI choice cursor (ui/Focus.js) moves between dialogue choices and window controls with these. Read with pressedRaw only while a window or
  // dialogue is on top of the UI focus stack (which holds an opaque input context), so sharing WASD / arrows with walking never moves the player
  // and the cursor at once.
  uiUp: Object.freeze(['ArrowUp', 'KeyW', 'PadUp']),
  uiDown: Object.freeze(['ArrowDown', 'KeyS', 'PadDown']),
  uiLeft: Object.freeze(['ArrowLeft', 'KeyA', 'PadLeft']),
  uiRight: Object.freeze(['ArrowRight', 'KeyD', 'PadRight']),
});
export const BASIC_LABELS = { moveForward: 'input.moveForward', moveBack: 'input.moveBack', moveLeft: 'input.moveLeft', moveRight: 'input.moveRight',
  confirm: 'input.confirm', cancel: 'input.cancel', uiUp: 'input.uiUp', uiDown: 'input.uiDown', uiLeft: 'input.uiLeft', uiRight: 'input.uiRight' };
// display names for actions a game binds before the module that reads them declares its label
export const BOUND_LABELS = { run: 'input.run', interact: 'input.interact', jump: 'input.jump' };
