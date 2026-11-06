// Container table: implementation of inventory.container() / transfer() and the containers save part.
import { DEV, warnOnce } from '../../core/base/validate.js';
import { readParams, keysSchema } from '../../core/base/params.js';
import { Container } from './Container.js';
import { codedError } from '../../core/base/errorHints.js';
import { isPlainObject } from '../../core/base/util.js';
import { refuseSave } from '../../core/saves/saveValues.js';

/** Container table: implementation of inventory.container() / transfer(); bag is the home bag 'player' (saved as its own part, never removed). @internal */
export class Containers {
  constructor(inv, bag) { this.inv = inv; this.bag = bag; this.map = new Map([[bag.id, bag]]); this.renames = new Map(); }

  /**
   * content/renames.js: a container saved under an old authored id moves to the new id (null = drop it). Remembered, so a save loaded later
   * is renamed the same way. Skipped when the new id already holds goods of its own (they cannot merge; the old one stays an orphan).
   * @param {Record<string, string | null>} [map]  new entries; without it, applies the remembered ones
   */
  rename(map) {
    for (const [a, b] of Object.entries(map || {})) this.renames.set(a, b);
    for (const [a, b] of this.renames) {
      const c = this.map.get(a);
      if (!c || c === this.bag || (b != null && this.map.get(b)?._entries.length)) continue;
      this.map.delete(a);
      if (b != null) { c.id = b; this.map.set(b, c); }
    }
  }

  get(id, opts) {
    if (typeof id !== 'string' || !id) throw codedError('container', `inventory.container(id): id must be a non-empty string (e.g. the chest's id in world), got ${JSON.stringify(id)}`);
    readParams(`inventory.container('${id}')`, keysSchema(['capacity', 'maxWeight', 'items']), opts);
    for (const k of ['capacity', 'maxWeight']) if (opts?.[k] != null && !(opts[k] > 0)) throw codedError('container', `inventory.container('${id}'): ${k} must be a positive number (Infinity = no limit), got ${opts[k]}`);
    let c = this.map.get(id);
    if (!c) {
      this.map.set(id, c = new Container(this.inv, id, opts));
      // place goods only on first creation; seeding is setup, so the ops guard lets it through
      if (opts?.items) { c._start = { ...opts.items }; this._seed(c); }
    } else {   // container created first by a load, game code sets the limits afterwards; if it already exists, goods are not placed again, but a later load of an older save needs them
      if (opts?.items) c._start ??= { ...opts.items };
      if (opts?.capacity != null) c.capacity = opts.capacity;
      if (opts?.maxWeight != null) c.maxWeight = opts.maxWeight;
    }
    return c;
  }

  /** Takes a container or container id; an id never created throws (a typo must not silently create a new one). */
  find(x, role) {
    if (x instanceof Container) return x;
    const c = typeof x === 'string' && this.map.get(x);
    if (!c) throw codedError('container', `inventory.transfer: ${role} container '${x}' does not exist: create it first with inventory.container('${x}', { capacity }) (existing: ${[...this.map.keys()].join(', ')})`);
    return c;
  }

  /** The entry with this key in any container, or null */
  entry(key) { for (const c of this.map.values()) { const e = c._find(key); if (e) return e; } return null; }

  transfer(from, to, x, n = 1) {
    DEV && this.inv.engine.ops.guard('inventory.transfer');
    const a = this.find(from, 'from'), b = this.find(to, 'to');
    if (!(n > 0)) throw codedError('container', `inventory.transfer: count must be a positive number, got ${n}`);
    if (a === b) return 0;
    let moved = 0;
    for (const e of a._of(x)) {   // each entry keeps its data; its key only when the whole entry moves (as setData does)
      const k = Math.min(n - moved, e.count, b._room(e.id, e.data));
      if (k <= 0) continue;
      // part of a stack: the rest stays under the old key in the source, so the moved part needs a new one (two live entries with one key make
      // inventory.entry(key) and room(key) pick the wrong one)
      const keep = k === e.count ? e.key : null;
      a._take(e, k);
      b._put(e.id, k, e.data, keep, false);
      if ((moved += k) >= n) break;
    }
    return moved;
  }

  remove(id) {
    if (id === this.bag.id) throw codedError('container', `The player inventory ('${id}') cannot be removed`);
    return this.map.delete(id);
  }

  /** @internal place a container's starting goods (content setup: the ops guard lets it through) */
  _seed(c) {
    c._entries = [];
    this.inv.engine.ops.allow(() => {
      for (const [item, n] of Object.entries(c._start)) {
        const before = c.count(item);
        c.add(item, n, { silent: true });
        // a start list longer than the room is allowed (a game may start a shelf overfull on purpose), but the goods that did not fit are gone: say so once
        const lost = n - (c.count(item) - before);
        if (lost > 0) warnOnce(`inventory.container('${c.id}'): ${lost} of ${n} '${item}' in its starting items did not fit (capacity ${c.capacity}, maxWeight ${c.maxWeight}) and were not placed. Raise capacity or shorten items if they should all be there`);
      }
    });
    c.seeded = true;
  }
  /** Save: non-player containers that have contents or ever had starting contents placed (an emptied one is still recorded, or a load would treat it as new and place them again) */
  save() {
    const out = {};
    for (const [id, c] of this.map) if (c !== this.bag && (c._entries.length || c.seeded)) out[id] = c._save();
    return out;
  }
  /**
   * A load follows the save: containers missing from the save are cleared, except authored ones (created with items): the save is older than that
   * content, so they get their starting goods again. Decided by the save and the content only, never by what earlier loads did, so the same
   * save loads the same on a fresh page and after an hour of play (review 0.4 modules-a B6)
   */
  load(d) {
    if (d != null && !(isPlainObject(d) && Object.entries(d).every(([id, list]) => id && Array.isArray(list)))) refuseSave('containers', 'the part', 'must be { container id: [{ id, count }] }', d);
    if (d && this.renames.size) d = Object.fromEntries(Object.entries(d).flatMap(([id, v]) => {   // content/renames.js first (null = dropped)
      const b = this.renames.has(id) ? this.renames.get(id) : id;
      return b == null || (b !== id && b in d) ? (b == null ? [] : [[id, v]]) : [[b, v]];
    }));
    for (const c of this.map.values()) if (c !== this.bag && !(c.id in (d || {}))) { if (c._start) this._seed(c); else { c._entries = []; c.seeded = false; } }
    for (const [id, list] of Object.entries(d || {})) { const c = this.get(id); c._load(list); c.seeded = true; }
    // entry keys are numbered across all containers: never hand out a key a loaded container already holds
    for (const c of this.map.values()) for (const e of c._entries) { const n = Number(e.key.split('#')[1]) || 0; if (n > this.inv._seq) this.inv._seq = n; }
  }
}
