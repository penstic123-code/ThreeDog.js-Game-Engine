// Container: inventory, chest, corpse and shelf are all this. The player inventory is the container with id 'player'; get or create others with
// inventory.container(id, opts).
// Contents are entries { key, id, count, data }:
//   items without data share one entry per kind, its key is the item id ('arrow');
//   items with data (durability, upgrade level, rounds in the magazine, freshness: a plain object) get their own key ('sword#3'):
//   stackable ones with equal data share an entry, a stack-1 item is one entry per piece. Keys are unique across containers and kept when moved.
// Every method that takes an item also takes a key: count('sword') counts all swords, count('sword#3') only that one.
// Limits are optional: capacity (slots; an entry uses ceil(count / stack) slots) and maxWeight (sum of item weight × count). Locks and prices stay game rules.
import { toast } from '../../ui/UI.js';
import { checkOptionsArg, warnOnce, fmt, DEV } from '../../core/validate.js';

// Developer messages (warned once in DEV): add doesn't throw when full, which an AI would hardly notice
const STRINGS = {
  full: 'Container {box} has no room for {id} (capacity {cap} slots, maxWeight {mw}): add returns false. Raise capacity / maxWeight, or remove something first',
  partial: 'Only {fit} of {n} {id} fit in container {box} (stack {stack} per slot, capacity {cap} slots, maxWeight {mw}); add still returns the entry key. Raise capacity / maxWeight or the item\'s stack',
  badData: "{fn}('{id}', …): data must be a plain object of JSON values, e.g. { durability: 80 }; got {got}",
  noKey: "{fn}('{key}'): no entry with that key in container {box} (keys here: {keys}); keys come from add() or list()[i].key",
  badRow: "container '{box}': dropped a saved entry that is not { id: string, count: whole number > 0, data?: plain object } ({got}); the save was edited by hand or is damaged",
  keyToAdd: "add('{key}'): add takes an item id, not an entry key. Move an existing piece with inventory.transfer(from, to, '{key}')",
};
const isKey = x => typeof x === 'string' && x.includes('#');
// order-independent signature: entries with equal data stack together whatever the key order
const sig = v => v === undefined ? '' : v && typeof v === 'object'
  ? (Array.isArray(v) ? `[${v.map(sig)}]` : `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + sig(v[k]))}}`) : JSON.stringify(v);
// data is frozen: a piece's data only changes through setData (guarded like every other saved write), never by editing the object in place
const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };
/** A frozen copy of the data the caller passed (the caller's object stays editable and unshared) @internal */
export function copyData(fn, id, data) {
  if (data == null) return undefined;
  if (typeof data !== 'object' || Object.getPrototypeOf(data) !== Object.prototype) throw new Error(fmt(STRINGS.badData, { fn, id, got: JSON.stringify(data) ?? typeof data }));
  return freeze(structuredClone(data));
}

export class Container {
  /** @internal Get it via inventory.container(id, opts); don't use new directly */
  constructor(inv, id, { capacity = Infinity, maxWeight = Infinity, player = false } = {}) {
    this.inv = inv; this.id = id;
    /** Slot limit (Infinity = no limit) */ this.capacity = capacity;
    /** Weight limit, sum of item weight × count (Infinity = no limit) */ this.maxWeight = maxWeight;
    /** @internal { key, id, count, data, sig } in insertion order */ this._entries = [];
    this._player = player;    // player inventory: shows toasts, emits item:* events, refreshes the inventory window
    this.seeded = false;      // starting contents were placed on creation: still saved when emptied, so a load doesn't treat it as new and place them again
  }

  /** How many of an item (all entries of that id) or of one entry (key). @param {string} x @returns {number} */
  count(x) { let n = 0; for (const e of this._entries) if (e.key === x || e.id === x) n += e.count; return n; }
  /** At least n (default 1) of an item or key? @param {string} x @param {number} [n] @returns {boolean} */
  has(x, n = 1) { return this.count(x) >= n; }
  /** One entry by key: { key, id, count, data, def }, or null. @param {string} key */
  get(key) { const e = this._find(key); return e ? this._view(e) : null; }
  /** Every entry: [{ key, id, count, data, def }] (data is undefined for plain items; for custom UI). */
  list() { return this._entries.map(e => this._view(e)); }
  /** Slots used (an entry of 150 arrows with stack 99 uses 2). */
  get slotsUsed() { let n = 0; for (const e of this._entries) n += Math.ceil(e.count / this.inv.item(e.id).stack); return n; }
  /** Total weight (item weight × count; items without weight weigh 0). */
  get weight() { let w = 0; for (const e of this._entries) w += e.count * (this.inv.item(e.id).weight ?? 0); return w; }

  /**
   * How many more fit (0 = none, Infinity = no limit): of an item without data, of an item with this data, or of the same kind as an existing entry key.
   * @example chest.room('arrow')  ·  chest.room('tomato', { quality: 2 })  ·  engine.inventory.container('player').room('sword#3')
   * @param {string} x
   * @param {Record<string, any>} [data]
   * @returns {number}
   */
  room(x, data) {
    if (!isKey(x)) return this._room(x, data === undefined ? undefined : copyData('room', x, data));
    const src = this.inv._containers.entry(x);
    if (!src) throw new Error(fmt(STRINGS.noKey, { fn: 'room', key: x, box: this.id, keys: this._keys() }));
    return this._room(src.id, src.data);
  }

  /**
   * Add n (default 1) of an item, optionally with data for these pieces. Partial fit places what fits.
   * Returns the key of the entry they went into ('arrow', or 'sword#3' for an item with data), false if none fit. silent suppresses the toast (only the player
   * inventory toasts).
   * @example engine.inventory.container('chest-1').add('bandage', 2)
   * @example const key = engine.inventory.add('sword', 1, { data: { durability: 80, level: 3 } });   // 'sword#7'
   * @param {string} id
   * @param {number} [n]
   * @param {{ data?: Record<string, any>, silent?: boolean }} [opts]
   * @returns {string | false}
   */
  add(id, n = 1, opts = {}) {
    DEV && this.inv.engine.ops.guard(this._player ? 'inventory.add' : 'container.add');
    checkOptionsArg(`add('${id}')`, opts, ['data', 'silent']);
    if (isKey(id)) throw new Error(fmt(STRINGS.keyToAdd, { key: id }));
    this.inv._known(id);
    return this._put(id, n, copyData('add', id, opts?.data), null, !!opts?.silent);
  }

  /**
   * Remove n (default 1) of an item or of one entry (key); returns false if there aren't enough. By item id, plain pieces go first, then pieces with data,
   * oldest first.
   * @example bag.remove('arrow', 3)  ·  bag.remove('sword#3')   // exactly that sword
   * @param {string} x
   * @param {number} [n]
   * @returns {boolean}
   */
  remove(x, n = 1) {
    DEV && this.inv.engine.ops.guard(this._player ? 'inventory.remove' : 'container.remove');
    if (!this.has(x, n)) return false;
    let rest = n;
    for (const e of this._of(x)) { const k = Math.min(rest, e.count); this._take(e, k); if (!(rest -= k)) break; }
    return true;
  }

  /**
   * Trade: take A out and put B in as ONE all-or-nothing step (swap a key for a better key, replace an item when the bag is full).
   * It first checks (on a copy) that A is there and that B fits once A is gone; if either fails nothing changes and you get { ok: false, reason }.
   * reason: 'notEnough' (you do not hold takeN of take) or 'full' (B would not fit even after A is removed).
   * take is an item id or an entry key ('sword#3'); give is an item id (never a key). Removal goes plain pieces first, like remove().
   * On success: { ok: true, took: [{ id, count, data? }], gave: entry key of B, giveId, giveN }. engine.ops.undo('inventory.trade', args, value) reverses it.
   * @example const r = bag.trade('rusty_key', 'gold_key'); if (!r.ok) say(r.reason);   // 'full' / 'notEnough'
   * @example engine.inventory.container('chest-1').trade('arrow', 'bolt', { takeN: 10, giveN: 10, data: { tip: 'iron' } })
   * @param {string} take
   * @param {string} give
   * @param {{ takeN?: number, giveN?: number, data?: Record<string, any>, silent?: boolean }} [opts]
   * @returns {{ ok: boolean, reason?: string, took?: { id: string, count: number, data?: any }[], gave?: string, giveId?: string, giveN?: number }}
   */
  trade(take, give, opts = {}) {
    DEV && this.inv.engine.ops.guard(this._player ? 'inventory.trade' : 'container.trade');
    checkOptionsArg(`trade('${take}', '${give}')`, opts, ['takeN', 'giveN', 'data', 'silent']);
    const { takeN = 1, giveN = 1 } = opts;
    if (!(takeN > 0) || !(giveN > 0)) throw new Error(`trade('${take}', '${give}'): takeN and giveN must be positive numbers, got takeN ${takeN}, giveN ${giveN}. Example: bag.trade('rusty_key', 'gold_key', { takeN: 1, giveN: 1 })`);
    if (isKey(give)) throw new Error(fmt(STRINGS.keyToAdd, { key: give }));
    this.inv._known(give);
    const data = copyData('trade', give, opts.data), why = this._canTrade(take, give, takeN, giveN, data);
    if (why !== true) return { ok: false, reason: why };
    const took = [];
    let rest = takeN;
    for (const en of this._of(take)) {
      const k = Math.min(rest, en.count);
      took.push({ id: en.id, count: k, ...(en.data !== undefined && { data: en.data }) });
      this._take(en, k);
      if (!(rest -= k)) break;
    }
    const gave = this._put(give, giveN, data, null, !!opts.silent);
    return { ok: true, took, gave, giveId: give, giveN };
  }

  /**
   * Replace the data of an entry (null = no data). n pieces (default all of the entry) change; fewer than all splits them into their own entry.
   * Returns the key now holding the changed pieces: the same key when a whole entry changes, a merged or new key otherwise. Limits are not checked (the pieces
   * are already inside).
   * @example
   * const s = bag.get(key);                                                     // { key, id, count, data, def }
   * bag.setData(key, { ...s.data, durability: s.data.durability - 1 });        // data objects are frozen: always pass a new one
   * @param {string} key
   * @param {Record<string, any> | null} data
   * @param {number} [n]
   * @returns {string}
   */
  setData(key, data, n) {
    DEV && this.inv.engine.ops.guard(this._player ? 'inventory.setData' : 'container.setData');
    const e = this._find(key);
    if (!e) throw new Error(fmt(STRINGS.noKey, { fn: 'setData', key, box: this.id, keys: this._keys() }));
    const d = copyData('setData', e.id, data), k = Math.min(n ?? e.count, e.count), at = this._entries.indexOf(e);
    const keep = k === e.count && e.data !== undefined ? e.key : null;   // a whole entry keeps its key, so references held by the game stay valid
    e.count -= k;
    if (!e.count) this._entries.splice(at, 1);
    const out = this._place(e.id, k, d, keep, at);
    if (this._player) this.inv._refresh();
    return out;
  }

  /**
   * Listen to changes of this container, returns a handle { remove() }. type 'add' | 'remove', callback gets { id: item, key: entry key, count: change amount,
   * total: current count of the item }
   * @example engine.inventory.container('chest-1').on('remove', ({ id, count }) => console.log('taken', id, count))
   * @param {'add' | 'remove'} type
   * @param {(e: { id: string, key: string, count: number, total: number }) => void} fn
   */
  on(type, fn) {
    if (type !== 'add' && type !== 'remove') throw new Error(`container.on events are only 'add' and 'remove', got '${type}'. Use one of them.`);
    const ev = this._player ? `item:${type}` : `container:${type}`;
    return this.inv.engine.events.on(ev, e => { if (this._player || e.container === this.id) fn({ id: e.id, key: e.key, count: e.count, total: e.total }); });
  }

  // ---------- internal ----------
  /** Dry run of trade: true, or 'notEnough' / 'full'. Removes A from a copy, then asks that copy whether B fits (the same trick transfer uses) @internal */
  _canTrade(take, give, takeN, giveN, data) {
    if (!this.has(take, takeN)) return 'notEnough';
    const sim = Object.create(this); sim._entries = this._entries.map(x => ({ ...x }));
    let rest = takeN;
    for (const en of sim._of(take)) { const k = Math.min(rest, en.count); en.count -= k; if (!(rest -= k)) break; }
    sim._entries = sim._entries.filter(x => x.count > 0);
    return sim._room(give, data) < giveN ? 'full' : true;
  }
  /** @internal */ _find(key) { return this._entries.find(e => e.key === key) || null; }
  /** @internal */ _keys() { return this._entries.map(e => e.key).join(', ') || 'none'; }
  /** @internal */ _view(e) { return { key: e.key, id: e.id, count: e.count, data: e.data, def: this.inv.item(e.id) }; }
  /** Entries an item id or key refers to; for an id, plain entries first @internal */
  _of(x) {
    if (isKey(x)) return this._entries.filter(e => e.key === x);
    const all = this._entries.filter(e => e.id === x);
    return [...all.filter(e => e.data === undefined), ...all.filter(e => e.data !== undefined)];
  }
  /** Room for an item with this (already copied) data @internal */
  _room(id, data) {
    const def = this.inv.item(id), st = def.stack, s = sig(data);
    const into = (data === undefined || st > 1) && this._entries.find(e => e.id === id && e.sig === s);
    let n = (into ? (st - into.count % st) % st : 0) + Math.max(0, this.capacity - this.slotsUsed) * st;
    if (def.weight > 0) n = Math.min(n, Math.floor((this.maxWeight - this.weight) / def.weight + 1e-9));
    return Math.max(0, n);
  }
  /**
   * How many of item (id or key) from src would really move here, up to n: a dry run on a copy, so entries that share free slots are not counted twice
   * @internal
   */
  _accepts(src, item, n) {
    const sim = Object.create(this), inv = this.inv;
    sim._entries = this._entries.map(x => ({ ...x }));
    sim.inv = Object.create(inv, { _newKey: { value: id => id + '#?' } });   // a dry run hands out no real keys
    let moved = 0;
    for (const en of src._of(item)) {
      if (moved >= n) break;
      const k = Math.min(n - moved, en.count, sim._room(en.id, en.data));
      if (k > 0) sim._place(en.id, k, en.data, en.key, sim._entries.length);
      moved += k;
    }
    return moved;
  }
  /** Add without the guard (add and transfer); key = keep this key for a new entry (moved pieces) @internal */
  _put(id, n, data, key, silent) {
    const def = this.inv.item(id), say = !silent && this._player, t = (k, p) => this.inv.engine.t(k, p);
    const fit = Math.min(n, this._room(id, data)), info = { box: this.id, id, n, fit, stack: def.stack, cap: this.capacity, mw: this.maxWeight };
    if (fit <= 0) { if (say) toast(this.inv.engine, t('inventory.full'), { kind: 'item' }); warnOnce(fmt(STRINGS.full, info)); return false; }
    if (fit < n) warnOnce(fmt(STRINGS.partial, info));
    const out = this._place(id, fit, data, key, this._entries.length);
    if (say) toast(this.inv.engine, t('inventory.got', { icon: def.iconUrl ? '' : (def.icon || ''), name: def.name, n: fit }), { kind: 'item' });
    this._emit('add', id, fit, out);
    return out;
  }
  /** Put k pieces in at index at, merging with an equal entry where the item stacks; returns the key of the last entry used @internal */
  _place(id, k, data, key, at) {
    const s = sig(data), st = this.inv.item(id).stack;
    if (data === undefined || st > 1) {
      let e = this._entries.find(x => x.id === id && x.sig === s);
      if (!e) this._entries.splice(at, 0, e = { key: data === undefined ? id : key ?? this.inv._newKey(id), id, count: 0, data, sig: s });
      e.count += k;
      return e.key;
    }
    let last = '';
    for (let i = 0; i < k; i++) this._entries.splice(at + i, 0, { key: last = i === 0 && key ? key : this.inv._newKey(id), id, count: 1, data, sig: s });
    return last;
  }
  /** Take k out of an entry without the guard @internal */
  _take(e, k) {
    e.count -= k;
    if (!e.count) this._entries.splice(this._entries.indexOf(e), 1);
    this._emit('remove', e.id, k, e.key);
  }
  /** The player inventory emits item:add / item:remove; other containers emit container:add / container:remove (with container = container id). @internal */
  _emit(type, id, count, key) {
    const events = this.inv.engine.events, e = { id, key, count, total: this.count(id) };
    if (this._player) { events.emit(type === 'add' ? 'item:add' : 'item:remove', e); this.inv._refresh(); }
    else events.emit(type === 'add' ? 'container:add' : 'container:remove', { container: this.id, ...e });
  }
  /** Save form: plain { id, count }, with data { id, count, key, data } @internal */
  _save() { return this._entries.map(e => e.data === undefined ? { id: e.id, count: e.count } : { id: e.id, count: e.count, key: e.key, data: e.data }); }
  /** Read a saved list. Saves can come from a file the player imported, so each row is checked; a bad row is dropped with a warning @internal */
  _load(list) {
    const plain = d => d === undefined || (d !== null && typeof d === 'object' && Object.getPrototypeOf(d) === Object.prototype);
    this._entries = [];
    for (const r of Array.isArray(list) ? list : []) {
      const key = r?.key ?? r?.id;
      if (typeof r?.id !== 'string' || !Number.isInteger(r.count) || r.count <= 0 || typeof key !== 'string' || !plain(r.data)) { warnOnce(fmt(STRINGS.badRow, { box: this.id, got: JSON.stringify(r) })); continue; }
      this.inv._known(r.id);   // an id the game no longer defines warns like add() does
      this._entries.push({ key, id: r.id, count: r.count, data: freeze(r.data), sig: sig(r.data) });
    }
  }
}
