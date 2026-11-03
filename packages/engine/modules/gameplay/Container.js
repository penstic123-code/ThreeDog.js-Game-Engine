// Container: inventory, chest, corpse and shelf are all this. An actor's bag is the container whose id is the actor's id ('player' for the local user, a net
// peer's actor id, an NPC's id); "the player inventory" is the container of engine.actor. Get or create any with inventory.container(id, opts).
// Contents are entries { key, id, count, data }:
//   items without data share one entry per kind, its key is the item id ('arrow');
//   items with data (durability, upgrade level, rounds in the magazine, freshness: a plain object) get their own key ('sword#3'):
//   stackable ones with equal data share an entry, a stack-1 item is one entry per piece. Keys are unique across containers and kept when moved.
// Every method that takes an item also takes a key: count('sword') counts all swords, count('sword#3') only that one.
// Limits are optional: capacity (slots; an entry uses ceil(count / stack) slots) and maxWeight (sum of item weight × count). Locks and prices stay game rules.
import { fmt, DEV } from '../../core/validate.js';
import { readParams, keysSchema } from '../../core/params.js';
import { failure } from '../../core/opsFail.js';
import { sig, freeze, canTrade, acceptsFrom, putIn, loadEntries } from './boxOps.js';
import { codedError } from '../../core/errorHints.js';

// Developer messages (warned once in DEV): add doesn't throw when full, which an AI would hardly notice
const STRINGS = {
  badData: "{fn}('{id}', …): data must be a plain object of JSON values, e.g. { durability: 80 }; got {got}",
  noKey: "{fn}('{key}'): no entry with that key in container {box} (keys here: {keys}); keys come from add() or list()[i].key",
  keyToAdd: "add('{key}'): add takes an item id, not an entry key. Move an existing piece with inventory.transfer(from, to, '{key}')",
};
const isKey = x => typeof x === 'string' && x.includes('#');
/** A frozen copy of the data the caller passed (the caller's object stays editable and unshared) @internal */
export function copyData(fn, id, data) {
  if (data == null) return undefined;
  if (typeof data !== 'object' || Object.getPrototypeOf(data) !== Object.prototype) throw codedError('container', fmt(STRINGS.badData, { fn, id, got: JSON.stringify(data) ?? typeof data }));
  return freeze(structuredClone(data));
}

export class Container {
  /** @internal Get it via inventory.container(id, opts); don't use new directly */
  constructor(inv, id, { capacity = Infinity, maxWeight = Infinity } = {}) {
    this.inv = inv; this.id = id;
    /** Slot limit (Infinity = no limit) */ this.capacity = capacity;
    /** Weight limit, sum of item weight × count (Infinity = no limit) */ this.maxWeight = maxWeight;
    /** @internal { key, id, count, data, sig } in insertion order */ this._entries = [];
    this.seeded = false;      // starting contents were placed on creation: still saved when emptied, so a load doesn't treat it as new and place them again
    /** @internal authored starting goods (container(id, { items })): what a save older than the content puts back */ this._start = null;
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
    if (!src) throw codedError('container', fmt(STRINGS.noKey, { fn: 'room', key: x, box: this.id, keys: this._keys() }));
    return this._room(src.id, src.data);
  }

  /**
   * Add n (default 1) of an item, optionally with data for these pieces. Partial fit places what fits.
   * Returns the key of the entry they went into ('arrow', or 'sword#3' for an item with data), false if none fit. silent suppresses the toast (only the container of
   * engine.actor, the local user's bag, toasts).
   * @example engine.inventory.container('chest-1').add('bandage', 2)
   * @example const key = engine.inventory.add('sword', 1, { data: { durability: 80, level: 3 } });   // 'sword#7'
   * @param {string} id
   * @param {number} [n]
   * @param {{ data?: Record<string, any>, silent?: boolean }} [opts]
   * @returns {string | false}
   */
  add(id, n = 1, opts = {}) {
    DEV && this.inv.engine.ops.guard(this._local ? 'inventory.add' : 'container.add');
    readParams(`add('${id}')`, keysSchema(['data', 'silent']), opts);
    if (isKey(id)) throw codedError('container', fmt(STRINGS.keyToAdd, { key: id }));
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
    DEV && this.inv.engine.ops.guard(this._local ? 'inventory.remove' : 'container.remove');
    if (!this.has(x, n)) return false;
    let rest = n;
    for (const e of this._of(x)) { const k = Math.min(rest, e.count); this._take(e, k); if (!(rest -= k)) break; }
    return true;
  }

  /**
   * Trade: take A out and put B in as ONE all-or-nothing step (swap a key for a better key, replace an item when the bag is full).
   * It first checks (on a copy) that A is there and that B fits once A is gone; if either fails nothing changes and you get { ok: false, code, facts, nextActions }.
   * code: 'notEnough' (you do not hold takeN of take) or 'full' (B would not fit even after A is removed).
   * take is an item id or an entry key ('sword#3'); give is an item id (never a key). Removal goes plain pieces first, like remove().
   * On success: { ok: true, took: [{ id, count, data? }], gave: entry key of B, giveId, giveN }. engine.ops.undo('inventory.trade', args, value) reverses it.
   * @example const r = bag.trade('rusty_key', 'gold_key'); if (!r.ok) say(r.code);   // 'full' / 'notEnough'
   * @example engine.inventory.container('chest-1').trade('arrow', 'bolt', { takeN: 10, giveN: 10, data: { tip: 'iron' } })
   * @param {string} take
   * @param {string} give
   * @param {{ takeN?: number, giveN?: number, data?: Record<string, any>, silent?: boolean }} [opts]
   * @returns {{ ok: boolean, code?: string, facts?: object, nextActions?: any[], took?: { id: string, count: number, data?: any }[], gave?: string, giveId?: string, giveN?: number }}
   */
  trade(take, give, opts = {}) {
    DEV && this.inv.engine.ops.guard(this._local ? 'inventory.trade' : 'container.trade');
    readParams(`trade('${take}', '${give}')`, keysSchema(['takeN', 'giveN', 'data', 'silent']), opts);
    const { takeN = 1, giveN = 1 } = opts;
    if (!(takeN > 0) || !(giveN > 0)) throw codedError('container', `trade('${take}', '${give}'): takeN and giveN must be positive numbers, got takeN ${takeN}, giveN ${giveN}. Example: bag.trade('rusty_key', 'gold_key', { takeN: 1, giveN: 1 })`);
    if (isKey(give)) throw codedError('container', fmt(STRINGS.keyToAdd, { key: give }));
    this.inv._known(give);
    const data = copyData('trade', give, opts.data), why = this._canTrade(take, give, takeN, giveN, data);
    if (why !== true) return failure(why);
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
    DEV && this.inv.engine.ops.guard(this._local ? 'inventory.setData' : 'container.setData');
    const e = this._find(key);
    if (!e) throw codedError('container', fmt(STRINGS.noKey, { fn: 'setData', key, box: this.id, keys: this._keys() }));
    const d = copyData('setData', e.id, data), k = Math.min(n ?? e.count, e.count), at = this._entries.indexOf(e);
    const keep = k === e.count && e.data !== undefined ? e.key : null;   // a whole entry keeps its key, so references held by the game stay valid
    e.count -= k;
    if (!e.count) this._entries.splice(at, 1);
    const out = this._place(e.id, k, d, keep, at);
    if (this._local) this.inv._refresh();
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
    if (type !== 'add' && type !== 'remove') throw codedError('container', `container.on events are only 'add' and 'remove', got '${type}'. Use one of them.`);
    return this.inv.engine.events.on(`item:${type}`, e => { if (e.container === this.id) fn({ id: e.id, key: e.key, count: e.count, total: e.total, actor: e.actor }); });
  }
  /** @internal The local user's bag (the container of engine.actor): the one that toasts and redraws the inventory window. Read live, so handing control
   *  to another actor moves the window and toasts to that actor's bag */
  get _local() { return this.id === this.inv.engine.actor; }

  // ---------- internal ----------
/** Dry run of trade: true, or 'notEnough' / 'full'. Removes A from a copy, then asks that copy whether B fits (the same trick transfer uses) @internal */
  _canTrade(take, give, takeN, giveN, data) { return canTrade(this, take, give, takeN, giveN, data); }
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
  _accepts(src, item, n) { return acceptsFrom(this, src, item, n); }
/** Add without the guard (add and transfer); key = keep this key for a new entry (moved pieces) @internal */
  _put(id, n, data, key, silent) { return putIn(this, id, n, data, key, silent); }
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
  /**
   * Every container emits item:add / item:remove with { container, actor, id, key, count, total }: container = this id, actor = who did it (the running op's
   * actor, else engine.actor). One event for every bag, so a quest or sound listens to "the local bag" with container === engine.actor and a host sees each
   * peer's bag change, instead of only one hard-wired 'player' bag having events @internal
   */
  _emit(type, id, count, key) {
    const e = this.inv.engine;
    e.events.emit(type === 'add' ? 'item:add' : 'item:remove', { container: this.id, actor: e.ops.actor, id, key, count, total: this.count(id) });
    if (this._local) this.inv._refresh();
  }
  /** Save form: plain { id, count }, with data { id, count, key, data } @internal */
  _save() { return this._entries.map(e => e.data === undefined ? { id: e.id, count: e.count } : { id: e.id, count: e.count, key: e.key, data: e.data }); }
/** Read a saved list. Saves can come from a file the player imported, so each row is checked; a bad row is dropped with a warning @internal */
  _load(list) { loadEntries(this, list); }
}
