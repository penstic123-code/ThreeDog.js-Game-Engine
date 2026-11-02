// Input defaults and strings. Split out of Input.js: neutral actions, bound-action labels, gamepad menu keys, the redefine warning.
// Only neutral input lives here: the direction axis (input.axis, the touch stick) and menu confirm / cancel. Nothing in it does anything until a game or module
// reads it.
// Gameplay keys (run, interact, jump...) are not core defaults: the game binds them (createEngine({ bindings }), input.define, a module's keys option or a
// preset such as
// presets.player.thirdPerson / presets.interactions.nearest), so no game inherits another game's Shift-to-run or E-to-use.
export const DEFAULT_ACTIONS = {
  moveForward: [['KeyW', 'ArrowUp'], 'input.moveForward'],
  moveBack: [['KeyS', 'ArrowDown'], 'input.moveBack'],
  moveLeft: [['KeyA', 'ArrowLeft'], 'input.moveLeft'],
  moveRight: [['KeyD', 'ArrowRight'], 'input.moveRight'],
  confirm: [['Space', 'Enter'], 'input.confirm'],
  cancel: [['Escape'], 'input.cancel'],
  // The UI choice cursor (ui/Focus.js) moves between dialogue choices and window controls with these. Menu keys like confirm / cancel: read with
  // pressedRaw only while a window or dialogue is on top of the UI focus stack (which holds an opaque input context), so sharing WASD / arrows with
  // walking never moves the player and the cursor at once. Rebind like any action (createEngine({ bindings, padBindings }), input.rebind).
  uiUp: [['ArrowUp', 'KeyW'], 'input.uiUp'],
  uiDown: [['ArrowDown', 'KeyS'], 'input.uiDown'],
  uiLeft: [['ArrowLeft', 'KeyA'], 'input.uiLeft'],
  uiRight: [['ArrowRight', 'KeyD'], 'input.uiRight'],
};
// display names for actions a game creates through createEngine({ bindings }) before the module that reads them defines its label
export const BOUND_LABELS = { run: 'input.run', interact: 'input.interact', jump: 'input.jump' };
// Default gamepad keys for the neutral menu actions only (confirm / cancel / menu): added when the action is registered (override in createEngine({ padBindings
// })).
// Gameplay actions (jump, run, interact, inventory...) get pad keys the same way as keyboard keys: from the game or a preset (presets.player.*, presets.keys.*)
export const PAD_DEFAULTS = { confirm: 'PadA', cancel: 'PadB', menu: 'PadStart', uiUp: 'PadUp', uiDown: 'PadDown', uiLeft: 'PadLeft', uiRight: 'PadRight' };
const STRINGS = { redefine: 'Input action "{action}" defined twice: it already had keys {from}, now {to}; the later definition overrides. Ignore this if the change is intended; to change only the label, pass the same keys' };
export const fmtRedefine = (action, from, to) => STRINGS.redefine.replace('{action}', action).replace('{from}', from.join(', ')).replace('{to}', to.join(', '));
