// Gamepad (standard layout) button names; like keyboard key names they can go into action bindings
const PAD_BUTTONS = ['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadSelect', 'PadStart', 'PadL3', 'PadR3', 'PadUp', 'PadDown', 'PadLeft', 'PadRight'];

/** Read the first connected gamepad into the input's keys, stick and look (every frame, allocates nothing) @internal */
export function pollPad(input, dt) {
  const pads = navigator.getGamepads?.();
  let gp = null;
  if (pads) for (let i = 0; i < pads.length && !gp; i++) if (pads[i]?.connected) gp = pads[i];
  if (!gp) {
    input.padStick.x = input.padStick.y = 0;
    if (input._padOn) { input._padOn = false; for (const b of PAD_BUTTONS) input._keyUp(b); }   // disconnected (battery died): release what it held, once
    return;
  }
  input._padOn = true;
  const btns = gp.buttons;
  for (let i = 0; i < btns.length && i < PAD_BUTTONS.length; i++) { if (btns[i].pressed) input._keyDown(PAD_BUTTONS[i], 'pad'); else input._keyUp(PAD_BUTTONS[i]); }
  const z = input.padDeadzone, cut = v => Math.abs(v) < z ? 0 : v;
  input.padStick.x = cut(gp.axes[0] || 0); input.padStick.y = -cut(gp.axes[1] || 0);
  const lx = cut(gp.axes[2] || 0), ly = cut(gp.axes[3] || 0);
  if (lx || ly || input.padStick.x || input.padStick.y) input.lastDevice = 'pad';
  input.look.dx += lx * input.padLookSpeed * 60 * dt; input.look.dy += ly * input.padLookSpeed * 60 * dt;
}

const KEY_NAMES = { Space: 'Space', Enter: 'Enter', Escape: 'Esc', ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', AltLeft: 'Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', Backquote: '`' };
const keyName = code => KEY_NAMES[code] ?? code.replace(/^Key|^Digit|^Pad/, '');

/** Key name shown in the UI, e.g. "E" (follows the last used device: gamepad keys after a pad press) @internal */
export function keyLabel(input, action) {
  const keys = input.keysOf(action).filter(k => !k.startsWith('Touch:'));
  const pad = keys.filter(k => k.startsWith('Pad')), kb = keys.filter(k => !k.startsWith('Pad'));
  const use = input.lastDevice === 'pad' && pad.length ? pad : kb.length ? kb : pad;
  // Key names go through the string table too (key.Space -> its localized name); fall back to the generic form if missing
  const name = k => input.engine.i18n?.has('key.' + k) ? input.engine.t('key.' + k) : keyName(k);
  return use.map(name).filter((v, i, arr) => arr.indexOf(v) === i).join('/');
}
