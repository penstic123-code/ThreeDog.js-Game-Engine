// Container internals that need no class state beyond the box they get as `b` (helper of Container.js): the dry runs behind trade / transfer, adding with
// the room check and its dev messages, and reading a saved list.
import { toast } from '../../ui/UI.js';
import { warnOnce, fmt } from '../../core/base/validate.js';

const STRINGS = {
  full: 'Container {box} has no room for {id} (capacity {cap} slots, maxWeight {mw}): add returns false. Raise capacity / maxWeight, or remove something first',
  partial: 'Only {fit} of {n} {id} fit in container {box} (stack {stack} per slot, capacity {cap} slots, maxWeight {mw}); add still returns the entry key. Raise capacity / maxWeight or the item\'s stack',
  badRow: "container '{box}': dropped a saved entry that is not { id: string, count: whole number 1..2^53-1, data?: plain object } ({got}); the save was edited by hand or is damaged",
};
// order-independent signature: entries with equal data stack together whatever the key order
export const sig = v => v === undefined ? '' : v && typeof v === 'object'
  ? (Array.isArray(v) ? `[${v.map(sig)}]` : `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + sig(v[k]))}}`) : JSON.stringify(v);
// data is frozen: a piece's data only changes through setData (guarded like every other saved write), never by editing the object in place
export const freeze = o => { if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o)) freeze(v); } return o; };

export function canTrade(b, take, give, takeN, giveN, data) {
  if (!b.has(take, takeN)) return 'notEnough';
  const sim = Object.create(b); sim._entries = b._entries.map(x => ({ ...x }));
  let rest = takeN;
  for (const en of sim._of(take)) { const k = Math.min(rest, en.count); en.count -= k; if (!(rest -= k)) break; }
  sim._entries = sim._entries.filter(x => x.count > 0);
  return sim._room(give, data) < giveN ? 'full' : true;
}

export function acceptsFrom(b, src, item, n) {
  const sim = Object.create(b), inv = b.inv;
  sim._entries = b._entries.map(x => ({ ...x }));
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

export function putIn(b, id, n, data, key, silent) {
  const def = b.inv.item(id), say = !silent && b._local, t = (k, p) => b.inv.engine.t(k, p);
  const fit = Math.min(n, b._room(id, data)), info = { box: b.id, id, n, fit, stack: def.stack, cap: b.capacity, mw: b.maxWeight };
  if (fit <= 0) { if (say) toast(b.inv.engine, t('inventory.full'), { kind: 'item' }); warnOnce(fmt(STRINGS.full, info)); return false; }
  if (fit < n) warnOnce(fmt(STRINGS.partial, info));
  const out = b._place(id, fit, data, key, b._entries.length);
  if (say) toast(b.inv.engine, t('inventory.got', { icon: def.iconUrl ? '' : (def.icon || ''), name: def.name, n: fit }), { kind: 'item' });
  b._emit('add', id, fit, out);
  return out;
}

export function loadEntries(b, list) {
  const plain = d => d === undefined || (d !== null && typeof d === 'object' && Object.getPrototypeOf(d) === Object.prototype);
  b._entries = [];
  for (const r of Array.isArray(list) ? list : []) {
    const key = r?.key ?? r?.id;
    if (typeof r?.id !== 'string' || !Number.isSafeInteger(r.count) || r.count <= 0 || typeof key !== 'string' || !plain(r.data)) { warnOnce(fmt(STRINGS.badRow, { box: b.id, got: JSON.stringify(r) })); continue; }
    b.inv._known(r.id);   // an id the game no longer defines warns like add() does
    b._entries.push({ key, id: r.id, count: r.count, data: freeze(r.data), sig: sig(r.data) });
  }
}
