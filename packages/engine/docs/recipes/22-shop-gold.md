# Shop and gold: buy, sell / consign, gold HUD, saving

Requires modules `inventory()` + `dialogue()` + `content()` (the gold HUD needs `hud()`). The engine has no "shop"
module: gold is an ordinary item, a shelf is an ordinary container, and buying and selling are two small ops that dialogue choices (or your own shop
window) run.

## 1. Where to keep gold (pick one)
| Form | Fits | Trade-off |
|---|---|---|
| **A. An item `gold` (recommended)** | Most games | `has / take / give` in content work directly; dialogue choice `if`, quest rewards, pickups and chests all understand it; saved with the inventory; **write `stack: 99999`** so it stays in one slot (by default 99 per slot; more spill into further slots, which only matters when the bag has a `capacity`) |
| B. A counter in `engine.vars` | Very large amounts, no slot wanted, must not be stolen / dropped | `vars.bump('gold', 50)` adds, `vars.counter('gold')` reads, saved with the game; the content `counter` condition can check "enough?", but the content `bump` effect only does +1, so charge money inside an op (`vars.bump('gold', -5)` in its `run`); it cannot be `transfer`red and does not appear in the inventory window |

The rest is written for A.

## 2. Data
`content/items.js`:
```js
export default {
  gold: { name: 'Gold', icon: '🪙', stack: 99999 },   // currency: one slot however much
  medkit: { name: 'Medkit', price: 5 },          // price: read by the shop ops below
};
export const startItems = { gold: 12 };
```
`content/containers.js` (the shelf. `items` is the initial stock, placed only the first time; a shelf that was emptied by looting / selling stays
empty after loading, see recipe 03):
```js
export default { 'shop-trader': { capacity: 6, items: { medkit: 3 } } };
```
Import it in `content/index.js` and put it in the exported object (`containers`).

## 3. Buy, sell / consign (two ops + dialogue choices)
Buying and selling are things the player decides to do, so they are ops (`recipes/23-ops.md`): define them once in `main.js`, and every caller
(dialogue choice, a shop window button, the dev bridge, a test) runs the same `can` / `run`. **Buy** is allowed only when the shelf has stock and the
player has the money; `transfer` returns how many actually moved, and money is charged only for those (a full inventory does not charge for nothing).
**Consign**: the player puts something on the shelf, and the shelf pays when it accepts it.
```js
// main.js (after engine.use(...inventory()...))
const price = (e, item) => e.inventory.item(item).price ?? 1;
engine.ops.define('shop.buy', {
  args: { shop: 'string', item: 'string' },
  can(e, { shop, item }, ctx) {
    if (!e.inventory.container(shop).has(item)) return 'soldOut';
    if (!e.inventory.container(ctx.actor).has('gold', price(e, item))) return 'noMoney';
    return true;
  },
  run(e, { shop, item }, ctx) {
    const got = e.inventory.transfer(shop, ctx.actor, item, 1);
    e.inventory.container(ctx.actor).remove('gold', price(e, item) * got);
    return got;
  },
  reasons: { soldOut: 'Shelf is empty', noMoney: 'Not enough gold' },
});
engine.ops.define('shop.sell', {
  args: { shop: 'string', item: 'string' },
  can: (e, { item }, ctx) => e.inventory.container(ctx.actor).has(item) || 'notInBag',
  run(e, { shop, item }, ctx) {
    const got = e.inventory.transfer(ctx.actor, shop, item, 1);
    e.inventory.container(ctx.actor).add('gold', Math.floor(price(e, item) * 0.6) * got, { silent: true });
    return got;
  },
});
```
In the dialogue, `if: { can: [...] }` shows a choice only when the op would succeed, and `do: { op: [...] }` runs it:
```js
// content/dialogues.js
const buyKit = ['shop.buy', { shop: 'shop-trader', item: 'medkit' }];
const sellKit = ['shop.sell', { shop: 'shop-trader', item: 'medkit' }];
export default {
  trader: {
    speaker: 'Trader',
    nodes: {
      start: {
        text: 'What do you need?',
        choices: [
          { text: 'Buy a medkit (5 gold)', next: 'start', if: { can: buyKit }, do: { op: buyKit } },
          { text: 'Sell a medkit (3 gold)', next: 'start', if: { can: sellKit }, do: { op: sellKit } },
          { text: 'Bye', next: 'end' },
        ],
      },
    },
  },
};
```
- The shelf id (`'shop-trader'`: a market stall, a ship's store, a vending machine) is any string, and the shelf contents are saved. A "shop window" is your own UI drawn from `shelf.list()`; its
  buttons call `engine.ops.run('shop.buy', { shop, item })` and grey out with `engine.ops.can(...)`.
- Prices live on the item (`price` in items.js above), read with `e.inventory.item('medkit').price`; an item without one costs 1 here.
- Items with their own data (a used sword with `durability`, recipe 03): pass the entry key as `item` (`'sword#3'`, from `shelf.list()[i].key`);
  `transfer` moves exactly that piece with its data, and `e.inventory.container(shop).get(item)` reads the data for a price
  (`def.price * data.durability / 100`).
- Show a failure reason to the player through your own i18n string (`e.t('shop.' + r.code)`); the engine shows nothing itself.
- `threedog ops` lists what can be bought right now if you add `offers` (see recipe 23); `threedog op shop.buy shop=shop-trader item=medkit`
  buys from the terminal.

## 4. Gold HUD
Calling `hud.counter` again with the same id = update, and it leaves the DOM alone when the value is unchanged, so calling it every frame is cheap:
```js
engine.onFrame(() => engine.hud.counter('gold', { icon: '🪙', label: 'Gold', value: engine.inventory.count('gold') }));
```
Loading a save replaces the whole inventory, and refreshing every frame follows naturally; no event listener is needed.

## 5. Saving
The inventory (gold included) and every container with contents are saved automatically; a shelf that was sold out is remembered too (`{}`), and
loading does not restock it. You write nothing.
