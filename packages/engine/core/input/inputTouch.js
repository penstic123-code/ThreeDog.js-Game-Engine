// The touch part of input: which on-screen controls the game needs (a stick, a button per action) and what using them does.
// Drawing is the UI part 'touch' (default ui/touchPart.js); a game replaces it or turns it off with createEngine({ ui: { touch: ... } }).
// press / release go to Input's _keyDown / _keyUp as the key 'Touch:<action>', the same path as real keys (snapshot and just-pressed behave identically).
/** @import { Input } from './Input.js' */
/** @import { TouchView } from '../../types/core' */

/**
 * Touch button: registers the key 'Touch:<action>' on the action and asks the touch part to draw a button (touch devices only)
 * @param {Input} inp
 * @param {string} action
 * @param {string} labelKey  string-table key of the button text
 * @returns {{ remove(): void }}
 * @internal
 */
export function touchButton(inp, action, labelKey) {
  if (!inp.touch) return { remove() {} };
  // counted: two parties may ask for one action, and the button stays until the last of them leaves
  let b = inp._touch.find(x => x.action === action);
  if (!b) {
    inp._touchKeys.set(action, 'Touch:' + action);   // kept beside the bound keys, so a rebind never drops the on-screen button
    inp._readable = null;
    inp._touch.push(b = { action, labelKey, users: 0 });
    touchRefresh(inp);
  }
  b.users++;
  let held = true;
  return { remove() {
    if (!held) return;
    held = false;
    if (--b.users) return;
    inp._keyUp('Touch:' + action);   // a thumb on it when it goes must not leave the action down
    inp._touchKeys.delete(action);
    inp._readable = null;
    inp._touch.splice(inp._touch.indexOf(b), 1);
    touchRefresh(inp);
  } };
}

/**
 * engine.start(): from now on the touch part draws (UI parts are settled). Nothing is created when no stick and no button is wanted (desktop).
 * @param {Input} inp
 * @internal
 */
export function touchStart(inp) {
  inp._touchOn = true;
  inp.engine.events.on('i18n:change', () => touchRefresh(inp));
  touchRefresh(inp);
}

/** @param {Input} inp */
function touchRefresh(inp) {
  if (!inp._touchOn) return;
  const stick = inp.joystick === true || (inp.joystick === 'auto' && inp.touch);
  if (!stick && !inp._touch.length && !inp._touchPart) return;   // a drawn part still hears that its last button left
  const e = inp.engine, first = !inp._touchPart;
  inp._touchPart ??= e.ui.get('touch');
  /** @type {TouchView} */
  const view = {
    stick, buttons: inp._touch.map(b => ({ action: b.action, label: e.t(b.labelKey) })),
    move: (x, y) => { inp.stick.x = x; inp.stick.y = y; },
    press: action => inp._keyDown('Touch:' + action, 'touch'),
    release: action => inp._keyUp('Touch:' + action),
  };
  if (first) inp._touchPart?.show(view); else inp._touchPart?.update(view);
}
