// engine.wrap: the one entry for changing what a module's public method does without copying the module (docs/plans/done/2026-11-02-gameplay-architecture.md
// §1.1 "set" level, between options and replacing the module):
//   engine.wrap(engine.inventory, 'add', (next, id, n, o) => weight(id) * n > room() ? false : next(id, n, o));   // around: may skip next
//   engine.wrap(engine.flow, 'go', (next, name) => { log(name); return next(name); });                          // before
//   engine.wrap(engine.interactions, 'add', (next, ...a) => { const h = next(...a); mark(h); return h; });     // after
// Why one wrapper form (next, ...args) and not separate before / after hooks: before and after are just "call next first or last", and around
// (refuse, change the args, change the result) needs next anyway; one shape is one thing to learn and to show in describe.
// Several wrappers compose: the last one wrapped runs first (outermost) and its next goes to the one wrapped before it, the innermost next is the
// module's own method. Removing any one wrapper (handle.remove()) keeps the others in their order, no matter which was added first.
// The wrapper is installed on the object itself, so every caller of that method goes through it: the game, the module's ops (the op
// inventory.transfer calls engine.inventory.transfer) and other modules alike. It wraps one method, not a behaviour: a rule that must hold for
// every way items enter the bag wraps each api method that can do it (add and transfer), or uses the module's own option (maxWeight).
// Only public methods: a name starting with '_' is the module's inside and throws (wrap what the contract lists, modules/<m>/contract.js).
import { fmt } from './validate.js';
import { codedError } from './errorHints.js';

const STRINGS = {
  target: "engine.wrap(target, method, fn): target must be a module's api object (engine.inventory, engine.flow...), got {got}",
  fn: "engine.wrap(target, '{method}', fn): fn must be a function (next, ...args) => ..., e.g. (next, ...a) => next(...a)",
  priv: "engine.wrap(target, '{method}'): '{method}' is private (leading _); wrap a public method: {list}",
  missing: "engine.wrap({name}, '{method}'): {name} has no method '{method}'; public methods: {list}",
};

/** Public method names on an object and its prototype chain (for error messages) */
function methodsOf(obj) {
  const out = new Set();
  for (let o = obj; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    for (const k of Object.getOwnPropertyNames(o)) {
      if (k === 'constructor' || k.startsWith('_')) continue;
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (typeof d.value === 'function') out.add(k);
    }
  }
  return [...out].sort();
}

export class Wraps {
  /** @internal */
  constructor(engine) { this.engine = engine; /** @internal target -> Map(method -> { own, base, list }) */ this._map = new Map(); }

  /** Name of a target for describe and errors: the engine property that holds it (engine.inventory -> 'inventory') */
  _name(target) {
    const e = this.engine;
    for (const n of e.modules?.keys?.() ?? []) if (e[n] === target) return n;
    for (const n of ['npcs', 'player']) if (e[n] === target) return n;
    return target.constructor?.name && target.constructor !== Object ? target.constructor.name : 'object';
  }

  /**
   * Wrap a public method: fn(next, ...args) runs instead of it; call next(...args) to run the method (or the wrapper wrapped before this one).
   * Returns a handle { remove() }. owner names who wrapped it in describe().wraps (default 'game').
   * @example engine.wrap(engine.inventory, 'add', (next, id, n = 1, o) => carried() + weightOf(id) * n > 30 ? false : next(id, n, o), { owner: 'weight' })
   */
  wrap(target, method, fn, { owner = 'game' } = {}) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) throw codedError('wrap-misuse', fmt(STRINGS.target, { got: target === null ? 'null' : typeof target }), TypeError);
    if (typeof fn !== 'function') throw codedError('wrap-misuse', fmt(STRINGS.fn, { method }), TypeError);
    const name = this._name(target);
    if (typeof method !== 'string' || method.startsWith('_')) throw codedError('wrap-misuse', fmt(STRINGS.priv, { method: String(method), list: methodsOf(target).join(', ') }));
    let slots = this._map.get(target);
    if (!slots) this._map.set(target, slots = new Map());
    let slot = slots.get(method);
    if (!slot) {
      if (typeof target[method] !== 'function') throw codedError('wrap-misuse', fmt(STRINGS.missing, { name, method, list: methodsOf(target).join(', ') }));
      // own: did the object itself hold the method (a plain api object) or did it come from the class (put it back by deleting ours)
      slot = { own: Object.prototype.hasOwnProperty.call(target, method), base: target[method], list: [] };
      slots.set(method, slot);
      // one installed function for the whole chain: it reads slot.list each call, so add / remove never re-wraps and order stays the list order
      target[method] = function wrapped(...args) {
        // 调用开始时拍快照：链里某个包装在调用中 remove() 自己或别人时，splice 会挪下标，直接读 slot.list 会跳过或重复调用一层
        const list = slot.list.slice();
        const call = (i, a) => i < 0 ? slot.base.apply(this, a) : list[i].fn.call(this, (...b) => call(i - 1, b), ...a);
        return call(list.length - 1, args);
      };
    }
    const entry = { fn, owner };
    slot.list.push(entry);
    return {
      remove: () => {
        const i = slot.list.indexOf(entry);
        if (i < 0) return;
        slot.list.splice(i, 1);
        if (slot.list.length) return;
        // last wrapper gone: put the method back where it lives (own property or the class), no pass-through function left
        if (slot.own) target[method] = slot.base; else delete target[method];
        slots.delete(method); if (!slots.size) this._map.delete(target);
      },
    };
  }

  /** describe().wraps: { 'inventory.add': ['weight', ...] } outermost first; empty object when nothing is wrapped */
  describe() {
    const out = {};
    for (const [target, slots] of this._map) for (const [m, s] of slots) out[`${this._name(target)}.${m}`] = s.list.map(x => x.owner).reverse();
    return out;
  }

  /**
   * @internal Put every wrapped method back (own property restored, a class method un-shadowed), then forget them. Why not just clear the map:
   * the installed pass-through stays on the object and keeps calling the wrappers, so a target that outlives the engine (a game's own object,
   * a module api reused after dispose) would still run them.
   */
  dispose() {
    for (const [target, slots] of this._map) for (const [m, s] of slots) { if (s.own) target[m] = s.base; else delete target[m]; s.list.length = 0; }
    this._map.clear();
  }
}
