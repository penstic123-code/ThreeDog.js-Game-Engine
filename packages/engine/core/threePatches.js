// Every change the engine makes to three.js itself or to the game's own three.js objects, in one list: describe().threePatches shows them,
// threePatches.off(id) undoes one (when it can be undone).
// Why a list: "three.js stays fully writable" means a game can see every place the engine reaches into three's own classes, objects or
// renderer and turn it off, instead of finding it by surprise (an accessor in devtools, another library's Object3D.add wrapper stacking on
// the engine's). THREE.md "Global changes" says what each one does to the game's own code. Every change made anywhere is noted here where
// it is made; a change that cannot be undone is still listed, with why (off(id) then throws and says what it would cost).
//   threePatches.list()        // [{ id, what, scope, on, offable, lost }]
//   threePatches.off('shadow-accessors')   // three's own behavior again (moving patches then cast still shadows)
// Page-wide on purpose: a prototype is shared by every engine on the page, so the switch is too.
import { codedError } from './errorHints.js';

const KEY = Symbol.for('threedog.threePatches');   // global: a second copy of a file (hot reload) re-registers the same id instead of a second entry
/** @typedef {{ id: string, what: string, scope: string, on: boolean, offable: boolean, lost: string, off: (() => void) | null }} PatchEntry */
/** @type {Map<string, PatchEntry>} */
const reg = globalThis[KEY] ??= new Map();

/**
 * Record one change to three.js (engine code calls this where it makes the change).
 * @param {string} id  short stable name ('shadow-accessors')
 * @param {string} what  one line: which member of what, and why
 * @param {(() => void) | null} off  puts three's original back; null when it cannot be undone (say why in opts.lost)
 * @param {{ scope?: string, lost?: string }} [opts]  scope: what it reaches ('page' default: a three.js class or shared table;
 *   'objects in the scene', 'engine renderer'); lost: what stops working when it is off (or, with off null, why it stays)
 * @internal
 */
export function notePatch(id, what, off, { scope = 'page', lost = '' } = {}) { reg.set(id, { id, what, scope, on: true, offable: !!off, lost, off }); }
/**
 * Whether a change is still on: the switch of a change that is applied object by object as they appear (its off() then only flips this,
 * and the code that applies it asks here). Page-wide like the list. @param {string} id @returns {boolean} @internal
 */
export const patchOn = id => reg.get(id)?.on !== false;

export const threePatches = {
  /** Every change the engine made to three.js: [{ id, what, scope, on, offable, lost }] @returns {{ id: string, what: string, scope: string, on: boolean, offable: boolean, lost: string }[]} */
  list: () => [...reg.values()].map(({ id, what, scope, on, offable, lost }) => ({ id, what, scope, on, offable, lost })),
  /**
   * Undo one change page-wide (three's original member again). Call it before creating the objects that should not see it.
   * @param {string} id
   * @returns {void}
   */
  off(id) {
    const p = reg.get(id);
    if (!p) throw codedError('unknown-name', `threePatches.off('${id}'): no such change; the changes are ${[...reg.keys()].join(', ') || 'none'}`);
    if (!p.off) throw codedError('engine-misuse', `threePatches.off('${id}'): this change cannot be undone (${p.lost}); it is listed so it can be seen`);
    if (p.on) { p.off(); p.on = false; }
  },
};
