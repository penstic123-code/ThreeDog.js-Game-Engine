// Co-op example game code, shared by the host and every client (the same file runs on all machines; only net({ role }) differs).
// Two players share a chest and a shop. Everything that changes shared state is an op; the ones friends may request say net: 'peer'.
import { createEngine, world, inventory, pickups, net } from '../../index.js';

const PRICE = { apple: 3, bread: 5 };
const SELL = { apple: 2, bread: 3 };

/** Items, the shared chest / shop and the ops. Call on every machine before start. */
export function setupCoop(e) {
  e.inventory.define('apple', { name: 'Apple', stack: 99 }).define('bread', { name: 'Bread', stack: 99 }).define('gold', { name: 'Gold', stack: 9999 });
  const O = e.ops;
  // shared chest: anyone may put in or take out
  O.define('chest.put', {
    net: 'peer', desc: 'Put items into the shared chest', args: { item: 'string', n: 'int?' },
    can: (e, { item, n = 1 }, ctx) => e.inventory.container(ctx.actor).has(item, n) || 'notEnough',
    run: (e, { item, n = 1 }, ctx) => e.inventory.transfer(ctx.actor, 'chest', item, n),
  });
  O.define('chest.take', {
    net: 'peer', desc: 'Take items from the shared chest', args: { item: 'string', n: 'int?' },
    can: (e, { item, n = 1 }) => e.inventory.container('chest').has(item, n) || 'empty',
    run: (e, { item, n = 1 }, ctx) => e.inventory.transfer('chest', ctx.actor, item, n),
  });
  // shop: buy with gold, sell for gold
  O.define('shop.buy', {
    net: 'peer', desc: 'Buy one item from the shop', args: { item: 'string' },
    can(e, { item }, ctx) {
      if (!PRICE[item]) return 'notSold';
      if (!e.inventory.container('shop').has(item)) return 'soldOut';
      return e.inventory.container(ctx.actor).count('gold') >= PRICE[item] || 'noMoney';
    },
    run(e, { item }, ctx) {
      e.inventory.container(ctx.actor).remove('gold', PRICE[item]);
      return e.inventory.transfer('shop', ctx.actor, item, 1);
    },
  });
  O.define('shop.sell', {
    net: 'peer', desc: 'Sell one item to the shop', args: { item: 'string' },
    can: (e, { item }, ctx) => !SELL[item] ? 'notBought' : e.inventory.container(ctx.actor).has(item) || 'notEnough',
    run(e, { item }, ctx) { e.inventory.transfer(ctx.actor, 'shop', item, 1); e.inventory.container(ctx.actor).add('gold', SELL[item]); },
  });
  // a garden plot only its owner may water: the owner check is declared once (owner) instead of written in can
  O.define('plot.water', {
    net: 'peer', desc: 'Water your own plot', args: { id: 'id' }, owner: a => a.id,
    run: (e, { id }) => e.world.set(id, { water: (e.world.get(id).water ?? 0) + 1 }),
  });
  O.define('plot.claim', {
    net: 'peer', desc: 'Claim a free plot', args: { id: 'id' },
    can: (e, { id }) => e.world.get(id).owner == null || 'taken',
    run: (e, { id }, ctx) => e.world.set(id, { owner: ctx.actor }),
  });
  // runs on each machine (UI shortcut); the shop.buy inside it is still a request to the host on a client
  O.define('ui.quickBuy', { net: 'local', desc: 'Buy an apple (button shortcut)', run: e => e.ops.run('shop.buy', { item: 'apple' }) });
  // host only (no net field): a friend asking for free gold is refused with 'notAllowed'
  O.define('cheat.gold', { args: { n: 'int' }, run: (e, { n }, ctx) => e.inventory.container(ctx.actor).add('gold', n) });
}

/** Starting state; only the host creates it, before start (loading time), and clients receive it in the first snapshot. */
export function seedCoop(e) {
  e.inventory.container('chest', { capacity: 8, items: { apple: 4 } });
  e.inventory.container('shop', { capacity: 8, items: { apple: 20, bread: 10 } });
  e.inventory.add('gold', 20, { silent: true });
  e.world.add({ id: 'plot-1', kind: 'plot', position: [4, 0, 0] });
  e.world.add({ id: 'plot-2', kind: 'plot', position: [6, 0, 0] });
}

/**
 * A headless engine with the co-op game installed (the example page shows three of them; tests drive them step by step).
 * Guests get 10 gold each on join (host bookkeeping in onJoin).
 */
export async function makeCoop(role, transport, extra = {}) {
  const e = createEngine({ canvas: document.createElement('canvas'), headless: true, ui: { loading: false }, urlState: false, saveKey: 'coop-' + role + Math.random() });
  e.use(world(), inventory(), pickups(), net({ role, transport, onJoin: (e, p) => { if (!e.inventory.container(p.actor).has('gold')) e.inventory.container(p.actor).add('gold', 10); }, ...extra }));
  setupCoop(e);
  if (role === 'host') seedCoop(e);
  await e.start();
  return e;
}
