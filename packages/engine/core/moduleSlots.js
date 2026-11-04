// Exclusive slots for modules ("only one may hold this": 'sky', 'inventory', a tone-mapping stage), mixed into Engine with modules.js.
//   provides: ['inventory']                        the module holds the slot while installed (a kind 'one' shared point, core/sharedPoint.js);
//                                                  a second provider is shared-taken, naming both and the replaces fix
//   requires: ['inventory']                        depend on the slot, not on whichever module gives it
//   engine.use(mine(), { replaces: 'inventory' })  unload the holder first (its tracked handles, slot, ctx.mod entries, drawing parts, dispose)
// Why the slot is a shared point and not a module-name table: one owner registry for everything (describe().shared shows the holder beside
// every shared value, ctx.track releases it with the rest), so there is no second mechanism to learn. Kept apart from modules.js only for size.
import { DEV, fmt, closest, warnOnce } from './validate.js';
import { codedError, coded } from './errorHints.js';
import { reportError } from './errors.js';
import { PICTURE_SLOTS } from './pictureSlots.js';

const STRINGS = {
  provides: 'module {name}: provides is a list of exclusive slot names, e.g. provides: [\'inventory\']; got {got}',
  notSlot: 'module {name} provides \'{slot}\', but \'{slot}\' is a shared value (kind {kind}), not an exclusive slot; pick a slot name of its own, or change the value with ctx.mod(\'{slot}\', { ... })',
  noHolder: 'engine.use(..., { replaces: \'{slot}\' }): no installed module provides \'{slot}\', so there is nothing to replace. Fix: drop { replaces }, or check the slot name (describe().shared lists the slots held now)',
  notProvided: 'engine.use(..., { replaces: \'{slot}\' }): none of the modules in this call provides \'{slot}\', so the swap would leave it empty. Fix: add provides: [\'{slot}\'] to the module that takes over from {holder}',
  byName: 'engine.use(..., { replaces }): module {name} requires module \'{dep}\' by its name, and the swap unloads {dep}. Fix: in {name}, require the slot (requires: [\'<slot>\']) instead of the module name',
  unuse: 'dispose hook of module {name} (unloaded by replaces)',
  misspelt: "picture module {name} provides '{slot}', which is not a picture slot, so no other part collides with it and the writers tool cannot see it. Fix: provides: ['{hint}'] (the slots: {list})",
  notIn: "engine.unuse('{name}'): no such module is installed. Installed: {list}",
  needed: "engine.unuse('{name}'): module {dep} requires '{slot}', and nothing else provides it. Fix: unload {dep} first, or swap in another provider: engine.use(mine(), { replaces: '{slot}' })",
};

/** engine.use(a(), b(), { replaces: 'sky' }): the options object is the last argument and has `replaces` (a module always has a name) */
export const isUseOpts = o => !!o && typeof o === 'object' && !Array.isArray(o) && !('name' in o) && 'replaces' in o;

/** _planUse: a module's provides must be a list of names (checked before anything installs) */
export function checkProvides(m) {
  if (m.provides != null && !(Array.isArray(m.provides) && m.provides.every(s => typeof s === 'string' && s)))
    throw codedError('module-provides', fmt(STRINGS.provides, { name: m.name, got: JSON.stringify(m.provides) }));
  // a misspelt claim is worse than none: it reads as declared and guards nothing. Picture modules only, and only a near miss: their own slots stay free
  if (DEV && m.type === 'picture') for (const slot of m.provides ?? []) {
    const hint = slot in PICTURE_SLOTS ? null : closest(slot, Object.keys(PICTURE_SLOTS));
    if (hint) warnOnce(coded('module-provides', fmt(STRINGS.misspelt, { name: m.name, slot, hint, list: Object.keys(PICTURE_SLOTS).join(', ') })));
  }
}

export const slotMethods = {
  /**
   * @internal engine.use(mod, { replaces }): the installed modules that hold these slots, after checking the swap is well formed
   * (the slot is held, the newcomer provides it, no installed module requires the old one by its module name).
   * @returns {Set<string>} module names to unload
   */
  _replaced(list, replaces) {
    const gone = new Set();
    if (replaces == null) return gone;
    const provided = new Set(list.flatMap(m => m?.provides ?? []));
    for (const slot of [].concat(replaces)) {
      const holder = this.stacks.has(slot) && this.stacks.get(slot).kind === 'one' ? this.stacks.get(slot).value() : null;
      if (!holder || !this.modules.has(holder)) throw codedError('module-replaces', fmt(STRINGS.noHolder, { slot }));
      if (!provided.has(slot)) throw codedError('module-replaces', fmt(STRINGS.notProvided, { slot, holder }));
      gone.add(holder);
    }
    for (const m of this.modules.values()) for (const dep of m.requires ?? []) if (gone.has(dep) && !gone.has(m.name) && !list.some(n => n?.name === dep) && !provided.has(dep))
      throw codedError('module-replaces', fmt(STRINGS.byName, { name: m.name, dep }));
    return gone;
  },
  /**
   * Unload one installed module: its tracked handles, its slots and ctx.mod entries, its dispose. What it added some other way stays (dev reports a picture module's
   * leftovers). To swap a holder use engine.use(mine(), { replaces: 'slot' }).
   * @example engine.unuse('rain');
   * @param {string} name
   */
  unuse(name) {
    const m = this.modules.get(name);
    if (!m) throw codedError('module-unuse', fmt(STRINGS.notIn, { name, list: [...this.modules.keys()].join(', ') || 'none' }));
    const gives = [name, ...(m.provides ?? [])], others = [...this.modules.values()].filter(o => o !== m);
    for (const o of others) for (const dep of o.requires ?? []) if (gives.includes(dep) && !others.some(p => p.name === dep || p.provides?.includes(dep)))
      throw codedError('module-unuse', fmt(STRINGS.needed, { name, dep: o.name, slot: dep }));
    this._unuse(name);
  },
  /**
   * @internal unload one installed module (engine.unuse, replaces, a plugin taken out): tracked handles and slots, drawing parts, its dispose, the engine property;
   * returns its definition. swapping: a newcomer takes over its slots, so what it wrote to them is the newcomer's to replace
   */
  _unuse(name, swapping = false) {
    const m = this.modules.get(name);
    this._dropTracked(name);
    try { m.dispose?.(this); } catch (err) { reportError(this, err, fmt(STRINGS.unuse, { name }), { soft: true }); }
    this._picture?.partGone(m, swapping);
    this.modules.delete(name); this._modState.delete(name); this._modInst.delete(name); delete this[name];
    this._sortHooks();
    return m;
  },
  /** @internal engine.<slot> -> the provider's API while it is installed (the returned handle is tracked by the provider, so it goes with it) */
  _aliasSlot(slot, api) {
    (this._slotAlias ??= new Set()).add(slot);
    return { remove: () => { if (this[slot] === api) delete this[slot]; this._slotAlias.delete(slot); } };
  },
  /** @internal is this capability provided by an installed module? */
  _provided(slot) { for (const m of this.modules.values()) if (m.provides?.includes(slot)) return true; return false; },
  /** @internal the exclusive slot a module provides (a 'one' shared point, made on first use) */
  _slot(slot, by) {
    if (!this.stacks.has(slot)) return this.stacks.define(slot, { kind: 'one', save: false });
    const s = this.stacks.get(slot);
    if (s.kind !== 'one') throw codedError('module-provides', fmt(STRINGS.notSlot, { name: by, slot, kind: s.kind }));
    return s;
  },
};
