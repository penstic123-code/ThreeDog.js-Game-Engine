// One ownership model for every property the engine writes on its own (a sky's background, the shadow box's center, camera, pixel ratio ...).
//
//   const o = defineOwned(engine, { id: 'view.far', part: 'view', key: 'far', read: () => camera.far, write: v => { camera.far = v; },
//     levels: { manual: "engine.autoView.manual('far')" } });
//   per frame:  o.check();  if (o.on) target.position.copy(focus);  o.mark();      (or o.drive(v) when the write is one value: needs write)
//
// Why "the engine yields" (user decision 1, 2026-11-02): a game that writes sun.target.position directly means it. Silently writing the old value
// back every frame is the "my change does nothing" bug; warning and still overwriting only moves it. So the first outside write hands the property
// to the game (mode 'yielded'), the value stays, and one warning names the explicit takeover and the hand-back. Detection runs in release builds too
// (a few number compares per frame), so the game behaves the same with and without dev checks; only the warning text is dev-only.
//
// Modes per property: 'engine' (the engine writes it) | 'manual' (engine.autoView.manual(key), or the entry that hands the value to the game) | 'yielded'
// (the game wrote it directly). engine.autoView.manual(key, false) hands any of them back. describe().owned lists them all.
import { warnOnce, DEV, fmt } from '../base/validate.js';
import { codedError, coded } from '../base/errorHints.js';

const STRINGS = {   // yielded: the prefix up to "stopped writing it" is matched by tests (the owned-prop tag carries the fix); the rest leads with the next calls
  yielded: '{id} was changed outside the engine, so the engine stopped writing it (your value stays). Next: {manual} to own it on purpose (no warning);{set} ' +
    '{back} to give it back to the engine',
  set: ' {set} to let the engine drive it and only adjust it;',
};

// Page-wide like the rest of the dev checks (validate.js): a tween anywhere names the objects it animates, and only properties on those objects
// skip detection. Why per object, not per owner: one owner-wide exemption would switch every check off (a tween on a door would turn off the sky guard).
const exempt = new Map();   // owner -> Set of ids (strings) and objects
const live = new Set();     // every registered property on the page: ending an exemption re-reads the ones it covered
/**
 * Exempt properties from outside-write detection while owner animates them (a timeline tweening a light): neither a warning nor a yield.
 * @param {any} owner a name or any unique key @param {Iterable<any> | false} [what] owned ids ('sun.intensity') or the three.js objects being animated; false ends it
 */
export function allowOwned(owner, what) {
  if (what === false || what == null) {
    // the animation's last value is the game's choice, not an outside write: take it as the new reference
    const s = exempt.get(owner); exempt.delete(owner);
    if (s) for (const o of live) if (o._snap && covers(s, o)) o.mark();
    return;
  }
  exempt.set(owner, new Set(what));
}
const covers = (s, entry) => s.has(entry.id) || entry.objects.some(o => s.has(o));
function isExempt(entry) {
  for (const s of exempt.values()) if (covers(s, entry)) return true;
  return false;
}

const flat = v => [].concat(v);
const differs = (a, b) => a.length !== b.length || a.some((x, i) => x !== b[i]);

class Owned {
  constructor(e, spec) {
    /** @type {string} */ this.id = spec.id;
    /** @type {string} */ this.part = spec.part;
    /** @type {string} */ this.key = spec.key ?? spec.id;
    /** @type {{ set?: string, manual?: string, back?: string }} */ this.levels = spec.levels ?? {};
    this._read = spec.read; this._write = spec.write; this._e = e;
    /** objects this property lives on (allowOwned matches them) */ this.objects = spec.objects ?? [];
    /** 'engine' | 'manual' | 'yielded' */ this.mode = 'engine';
    /** who took it: 'game' (manual()), or 'three' for a direct write */ this.by = 'engine';
    this._snap = null;
    this._onChange = spec.onChange;
    // once: the engine never writes it, it only keeps the value read here (renderer.toneMapping). So a direct write is the documented way to change it (yielding warns
    // nothing), and handing it back writes that value again (spec.write)
    this._once = spec.once ? { value: this._read() } : null;
  }
  /** Does the engine write this property now */
  get on() { return this.mode === 'engine'; }
  /** Before the engine writes: a value different from the last mark() was written by someone else, so yield to it (once per takeover) */
  check() {
    if (this.mode !== 'engine' || !this._snap) return;
    const v = flat(this._read());
    if (!differs(v, this._snap) || isExempt(this)) return;
    this._set('yielded', 'three');
    if (DEV && this._e.validate && !this._once) {
      const L = this.levels, back = L.back ?? L.manual.replace(/\(([^()]*)\)\s*$/, (_, a) => `(${a ? a + ', ' : ''}false)`);
      warnOnce(coded('owned-prop', fmt(STRINGS.yielded, { id: this.id, manual: L.manual, set: L.set ? fmt(STRINGS.set, { set: L.set }) : '', back })));
    }
  }
  /**
   * After the engine wrote (or chose not to): remember what is there now.
   * @param {any} [reference] what the engine left there, when that is not what is there now: a property registered after the game could already write it
   *   (a sky installed once picture code ran), so the first check() still sees that write
   */
  mark(reference = this._read()) { this._snap = flat(reference); }
  /** check, write when the engine owns it, mark. Needs spec.write */
  drive(v) { this.check(); if (this.on) this._write(v); this.mark(); }
  /** Take over (on) or hand back (false). Hand-back forgets the snapshot so the engine's next write is not mistaken for an outside one */
  manual(on = true, by = 'game') {
    if (on) this._set('manual', by);
    else if (this._once) { this._write?.(this._once.value); this._set('engine', 'engine'); this.mark(); }   // nothing writes it per frame: write it back now
    else { this._snap = null; this._set('engine', 'engine'); }
  }
  _set(mode, by) {
    const was = this.mode;
    this.mode = mode; this.by = by; this.at = this._e.time?.frame ?? null;
    if (was !== mode) this._onChange?.(this);
  }
  /** describe().owned row: writer = who writes it now ('engine' | 'manual:<who>' | 'three (engine yielded)') */
  info() {
    return ({ part: this.part, key: this.key, writer: this.mode === 'engine' ? 'engine' : this.mode === 'yielded' ? 'three (engine yielded)' : `manual:${this.by}`, ...(this.levels.manual ? { manual: this.levels.manual } : {}) });
  }
}

/**
 * Values the engine only keeps and never writes (toneMapping) meet no engine write that would notice a takeover, so describe() looks before any section reads
 * them. Why one place: the render section checked on its own, after the picture section had read the stale writer, and describe('owned') alone
 * said 'engine' for a curve the game had set
 * @param {any} engine @internal
 */
export function checkWrittenOnce(engine) { for (const o of engine._owned?.values() ?? []) if (o._once) o.check(); }

/**
 * Register one engine-written property. The id is unique per engine (a second defineOwned with the same id replaces the first: a module reinstalled).
 * @param {any} engine
 * @param {{ id: string, part: string, key?: string, read: () => any, write?: (v: any) => void, objects?: any[],
 *   levels: { manual: string, set?: string, back?: string }, onChange?: (o: Owned) => void, once?: boolean }} spec
 *   part: the group whose manual() takes it (engine.autoView.manual(key)); key: the name manual() matches (prefix match on dots: 'sun' takes
 *   'sun.intensity' and 'sun.color'); once: written only at creation (read now is the creation value; needs write for the hand-back); levels: the copyable calls the warning quotes (manual is required); onChange: mode changed (the sky hides its dome when the game
 *   takes scene.background)
 * @returns {Owned}
 */
export function defineOwned(engine, spec) {
  if (!spec?.id || !spec.part || typeof spec.read !== 'function') throw codedError('owned-misuse', 'defineOwned(engine, { id, part, read, write?, levels }): id, part and read are required');
  // the yield warning leads with this call, so a property nobody can take on purpose cannot be registered
  if (typeof spec.levels?.manual !== 'string' || !spec.levels.manual) throw codedError('owned-misuse', `defineOwned(engine, { id: '${spec.id}', levels: { manual } }): levels.manual is required, the copyable takeover call the warning quotes, e.g. levels: { manual: "engine.autoView.manual('far')" }`);
  const reg = engine._owned ??= new Map();
  const o = new Owned(engine, spec);
  const old = reg.get(spec.id); if (old) live.delete(old);
  reg.set(spec.id, o); live.add(o);
  return o;
}
/** Remove registrations (a module disposed) @param {any} engine @param {Iterable<{ id: string }>} list */
export function dropOwned(engine, list) { for (const o of list) { live.delete(o); if (engine._owned?.get(o.id) === o) engine._owned.delete(o.id); } }

/** Registered properties of one part whose key is `key` or starts with `key.` (no keys: all of the part) */
function ownedOf(engine, part, keys) {
  const all = [...(engine._owned?.values() ?? [])].filter(o => o.part === part);
  if (keys == null) return all;
  return all.filter(o => [].concat(keys).some(k => o.key === k || o.key.startsWith(k + '.')));
}

/**
 * manual(keys?, on?) of a group (engine.autoView.manual): the game takes these properties (the engine stops writing them) or hands them back (on false).
 * Throws with the part's takeable keys when nothing matches, so a typo does not silently do nothing.
 * @returns {{ remove(): void }} remove() hands them back
 */
export function manualVerb(engine, part, keys, on = true, by = 'game') {
  if (typeof keys === 'boolean') { on = keys; keys = undefined; }
  const hit = ownedOf(engine, part, keys);
  if (!hit.length) {
    const known = [...new Set(ownedOf(engine, part).map(o => o.key))];
    throw codedError('owned-misuse', `engine.${part}.manual(${keys === undefined ? '' : JSON.stringify(keys)}): ${known.length ? `no engine-written key matches; keys: ${known.join(', ')}` : 'the engine writes nothing of this part on its own right now (nothing to take over)'}`);
  }
  for (const o of hit) o.manual(on, by);
  return { remove: () => { for (const o of hit) o.manual(false); } };
}

/** describe().owned: { id: { part, key, writer, manual? } } (undefined when nothing is registered) */
export function describeOwned(engine) {
  const extra = Object.entries(engine._ownedRows ?? {}).map(([id, f]) => [id, f()]).filter(([, r]) => r);
  if (!engine._owned?.size && !extra.length) return undefined;
  return Object.fromEntries([...[...engine._owned ?? []].map(([id, o]) => [id, o.info()]), ...extra]);
}
/**
 * A describe().owned row that is not one property: the engine changing things the game made (the cascades' csm patch on game materials, the one
 * named exception to "the engine does not change what it did not create"). row() returns undefined while there is nothing to show.
 * @param {any} engine @param {string} id @param {() => (object | undefined)} row
 */
export function ownedRow(engine, id, row) { (engine._ownedRows ??= {})[id] = row; }
