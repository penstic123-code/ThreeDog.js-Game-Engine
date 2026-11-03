// UI focus stack and choice cursor. Windows, dialogue, cutscenes and the settings menu are pushed in open order. The back key (action cancel, default Esc / pad B) goes to the top
// entry only; with an empty stack it goes to the "root" (registered by setRoot, usually the settings menu). So Esc has one entry point and never closes a cutscene and opens the menu at once.
// The choice cursor lives here for the same reason: the menu keys (uiUp / uiDown / uiLeft / uiRight, d-pad, left stick) and confirm move and press
// the selected control of the top entry only (cursor.js), so keyboard-only and gamepad-only players can pick dialogue choices and use every window.
//
//   const f = uiFocus(engine);                                   // one per engine
//   const h = f.push('inventory', { cancel: () => win.toggle(false), nav: () => win.el });   // no cancel = swallow the back key (Esc does nothing during dialogue)
//     nav: () => Element   cursor over the controls inside it (buttons, inputs, selects, [data-nav]); the selected one gets the class is-cursor
//     nav: { count(), confirm(i), moved?(i) }   a list the owner draws itself (dialogue choices); h.setNav(nav | null) changes it while pushed
//   h.index      the selected control / choice;  h.consumed  the cursor used confirm this frame (the owner's own confirm handling skips it)
//   h.fresh      pushed this frame: the key press that opened it (E, Space) must not count as its own action
//   h.remove()   pop (safe to call repeatedly)
//   f.setRoot(() => settings.open())                             // what the back key does on an empty stack; returns a handle { remove() }
//   f.top        top name or null; f.list() names from bottom to top; f.cursor { id, index } of the top entry when it has a nav, else null
// Look: none (behavior only); the cursor marks the selected DOM control with .is-cursor.
import { stepCursor, forgetNav } from './cursor.js';
const stacks = new WeakMap();   // engine -> UI focus stack
/** @import { Engine } from '../types/core' */
/** @import { UIFocus } from '../types/gameplay' */

/**
 * UI focus stack: windows, dialogue and cutscenes push in open order; the back key (Esc) goes to the top only; an empty stack hands it to the settings menu
 * @param {Engine} engine
 * @returns {UIFocus}
 */
export function uiFocus(engine) {
  let f = stacks.get(engine);
  if (f) return f;
  const entries = [], stick = { key: '', t: 0 };
  let frame = 0, root = null;
  f = {
    get top() { return entries.at(-1)?.id ?? null; },
    list() { return entries.map(x => x.id); },
    get cursor() { const t = entries.at(-1); return t?.nav ? { id: t.id, index: t.index ?? 0 } : null; },
    /** Push: { cancel, nav }. Returns a handle { id, fresh, index, consumed, setNav(nav), remove() } */
    push(id, { cancel = null, nav = null } = {}) {
      const h = {
        id, cancel, nav, index: null, at: frame, used: -1,
        get fresh() { return h.at === frame; },
        get consumed() { return h.used === frame; },
        setNav(n) { forgetNav(h); h.nav = n; h.index = null; },
        remove() { forgetNav(h); const i = entries.indexOf(h); if (i >= 0) entries.splice(i, 1); },
      };
      entries.push(h);
      return h;
    },
    /** Who gets the back key when the stack is empty (only one; a later registration replaces the earlier) */
    setRoot(fn) { root = fn; return { remove: () => { if (root === fn) root = null; } }; },
  };
  // Start of each frame (the onFrame callback runs before module frame hooks): bump the frame number so the back key dispatches once,
  // then the cursor of the top entry moves / presses (before the dialogue's own confirm check, which reads h.consumed)
  f.hook = engine.onFrame(dt => {
    frame++;
    const top = entries.at(-1);
    if (top?.nav && stepCursor(engine, top, stick, dt)) top.used = frame;
    if (!engine.input.pressedRaw('cancel')) return;
    if (entries.at(-1)) entries.at(-1).cancel?.();
    else root?.();
  });
  stacks.set(engine, f);
  return f;
}
