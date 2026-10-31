// UI focus stack: windows, dialogue, cutscenes and the settings menu are pushed in open order. The back key (action cancel, default Esc) goes to the top entry only;
// with an empty stack it goes to the "root" (registered by setRoot, usually the settings menu). So Esc has one entry point and never closes a cutscene and opens the menu at once.
//
//   const f = uiFocus(engine);                                   // one per engine
//   const h = f.push('inventory', { cancel: () => win.toggle(false) });   // no cancel = swallow the back key (Esc does nothing during dialogue)
//   h.fresh      pushed this frame: the key press that opened it (E, Space) must not count as its own action
//   h.remove()   pop (safe to call repeatedly)
//   f.setRoot(() => settings.open())                             // what the back key does on an empty stack; returns a handle { remove() }
//   f.top        top name or null; f.list() names from bottom to top
// Look: none (behavior only).
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
  const entries = [];
  let frame = 0, root = null;
  f = {
    get top() { return entries.at(-1)?.id ?? null; },
    list() { return entries.map(x => x.id); },
    /** Push: { cancel }. Returns a handle { id, fresh, remove() } */
    push(id, { cancel = null } = {}) {
      const h = {
        id, cancel, at: frame,
        get fresh() { return h.at === frame; },
        remove() { const i = entries.indexOf(h); if (i >= 0) entries.splice(i, 1); },
      };
      entries.push(h);
      return h;
    },
    /** Who gets the back key when the stack is empty (only one; a later registration replaces the earlier) */
    setRoot(fn) { root = fn; return { remove: () => { if (root === fn) root = null; } }; },
  };
  // Start of each frame (the onFrame callback runs before module frame hooks): bump the frame number so the back key dispatches once
  f.hook = engine.onFrame(() => {
    frame++;
    if (!engine.input.pressedRaw('cancel')) return;
    const top = entries.at(-1);
    if (top) top.cancel?.();
    else root?.();
  });
  stacks.set(engine, f);
  return f;
}
