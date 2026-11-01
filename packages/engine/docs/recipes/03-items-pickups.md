# Adding items and pickups

Modules needed: `inventory()` (inventory; the window is the UI part `inventory`, opened with the key the game gives:
`inventory({ ...presets.keys.inventory })` is I / gamepad Y, `keys: []` none; no module binds a key by itself) +
`interactions({ ...presets.interactions.nearest })` (walk up to an item on the ground and press E to pick it up). "Already picked up / how long until
it grows back" is data in world (needs the world module that `openWorld()` includes) and is saved with the game.

## 1. Write data (recommended)
`games/<game>/content/items.js`:
```js
// Items: id -> name, icon, description. stack = how many fit in one slot (default 99; more spill into further slots), weight (optional), color = color when dropped on the ground
export default {
  mushroom: { name: '蘑菇', icon: '🍄', desc: '林子里捡的', color: 0xc0504d },
  coin: { name: '铜币', icon: '🪙', stack: 99999 },   // currency: one slot however much you carry; full buying/selling in recipe 22
};
export const startItems = { coin: 3 };          // what the inventory holds at the start (optional)
```
`content/pickups.js` (a list):
```js
export default [
  { item: 'mushroom', place: 'home', x: 8, z: 3, respawn: 120 },   // respawn: after how many game seconds it grows back (omitted = never again)
  { item: 'coin', x: 40, z: -12, count: 5, auto: true },           // without place it is a world coordinate; count = how many at once; auto = taken by walking into it
  { item: 'sword', x: 12, z: 4, data: { durability: 60 } },        // data = this piece's own data (see "Single pieces"); radius = reach in meters (default 2)
];
```
Remember to `import items, { startItems } from './items.js'` and `import pickups from './pickups.js'` in `content/index.js` and put them in the exported object.

**Data and stable ids**: each pickup is a plain `kind: 'pickup'` record in `engine.world` (needs `world()`, which `openWorld()` includes); the model
is built only near the player and removed when far.
Id: if you write an `id` it is used; otherwise it is `pickup:<item>:<index in the pickups array>`, the same every time for the same content, and
distinguishes the same item placed at the same coordinates. **Write an `id` if the content will keep changing** (inserting a new one in the middle
shifts the later indices).
When picked up, the record is removed from world; one with `respawn` stays and gets an `until` (respawn time, game seconds); while waiting it has no
model, and at that time (also when far away with no model) `until` is cleared and it returns to the ground.
Pickups in content are the world's **initial data**: the save records only what was picked up and what is waiting to respawn; it makes no difference
whether `content.load` runs before or after loading, and picked-up items do not reappear; positions that use a level marker carry a `zone`, so after
changing level and coming back they are still picked up.
`engine.world.remove(id)` deletes one directly.

## 2. In code (dynamic drops, custom models)
```js
engine.inventory.define('gem', { name: '宝石', icon: '💎', color: 0x66ccff });
const gem = engine.inventory.spawnPickup('gem', engine.player.position, { count: 1, respawnSeconds: 0 });   // returns a handle; gem.remove() deletes data and model together
// handle: { id: item, worldId: id in world, object: current model (null when far), remove() }; opts.id lets you write a stable id (spawning again with the same id reuses the existing one)
engine.inventory.add('coin', 2);                // give directly; returns the entry key ('coin'), false if it doesn't fit
engine.inventory.remove('coin', 1);             // returns false if there isn't enough
engine.inventory.has('coin', 2);                // at least 2?
engine.inventory.spawnPickup('ammo', [8, 0, 2], { count: 30, auto: true, radius: 1.2 });   // taken on touch, no key, no prompt
engine.events.on('item:pickup', ({ id, x, z }) => engine.particles?.emit('dust', { x, y: engine.surface(x, z), z }, { count: 10 }));   // events: item:add / item:remove / item:pickup / item:use ('dust' = a particle the game defined)
```
The default reach of pickups is `inventory({ pickupRadius: 2 })`; each pickup can set its own `radius`.

## Single pieces: durability, upgrade level, ammo in the magazine, freshness
An item can carry its own data (a plain object). Pieces with different data never mix; stackable pieces with equal data share an entry; a `stack: 1`
item with data is one entry per piece.
Each entry has a **key**: the item id for plain items (`'arrow'`), `'<item>#<n>'` for pieces with data (`'sword#3'`). Every call that takes an item
also takes a key.
```js
const I = engine.inventory;
I.define('sword', { name: 'Sword', stack: 1 });
const key = I.add('sword', 1, { data: { durability: 80, level: 3 } });   // 'sword#7'
I.count('sword');                               // every sword, with or without data
I.get(key);                                     // { key, id: 'sword', count: 1, data: { durability: 80, level: 3 }, def }
I.list();                                       // every entry: [{ key, id, count, data, def }] for your own UI
// change it inside an op or fixed step (data objects are frozen: always pass a new one; the key stays the same)
const s = I.get(key); I.setData(key, { ...s.data, durability: s.data.durability - 1 });
I.transfer('player', 'chest-1', key);           // exactly this sword; it keeps its data and key
I.remove(key);                                  // exactly this one; I.remove('sword') takes plain ones first, then the oldest
I.add('tomato', 5, { data: { quality: 2 } });   // stackable: equal data joins the same entry
I.setData('tomato#4', { quality: 1 }, 2);       // only 2 of that stack change: they split off under a new key (returned)
```
Data and keys are saved with the container. Which piece a player means is chosen by key (a click on a row of `list()`), so ops take `item` as an id or a key.

## Limits (all optional, none by default)
`inventory({ ...presets.keys.inventory, capacity, maxWeight })` for the player and `inventory.container(id, { capacity, maxWeight })` for others:
`capacity` = slots (an entry uses `ceil(count / stack)`), `maxWeight` = sum of item `weight` × count. `room(item)` says how many more fit; `weight`
and `slotsUsed` read the totals. Locks, prices and "only one equipped" are game rules: check them in your op's `can`.

## Using and dropping (ops)
```js
I.define('potion', { name: 'Potion', consume: true, use: (e, { actor, key, data }) => heal(actor, 30), canUse: (e, { actor }) => hp(actor) < 100 || 'full' });
engine.ops.run('inventory.use', { item: 'potion' });        // runs canUse / use; consume removes one first; emits item:use
engine.ops.run('inventory.drop', { item: 'sword#7' });      // a pickup at the actor's feet, keeps its data
```
Both act on `ctx.actor`'s container (`'player'` by default).

**Replace an item when the bag is full**: `inventory.trade` takes A and gives B as one all-or-nothing step (it checks that B fits once A is gone), and
can be undone.
```js
const r = engine.ops.run('inventory.trade', { take: 'rusty_key', give: 'gold_key' });   // also takeN / giveN; take may be an entry key ('sword#3')
if (!r.ok) say(r.reason);                                                              // 'notEnough' (A missing) | 'full' (B does not fit even after A leaves)
engine.ops.undo('inventory.trade', { take: 'rusty_key', give: 'gold_key' }, r.value);   // gives A back (with its data), takes B away
engine.inventory.trade('rusty_key', 'gold_key');                                       // the same from code; a container has .trade() too
```
**Why a pickup failed**: a pickup's `interaction.use` returns the reason as the op value:
`const r = engine.ops.run('interaction.use'); if (r.ok && r.value?.ok === false) say(r.value.reason);   // 'full'` (the item stays on the ground).

## The inventory window (UI part `inventory`)
`inventory({ ...presets.keys.inventory, pauseGame: true })` freezes gameplay (`engine.freeze`, the same mechanism as flow's `paused`) while the window
is open; default `false` (the world keeps running behind the window). Switchable at runtime: `engine.inventory.pauseGame = true`.

The window is a UI part (recipe 26): the engine opens and closes it (the key from `inventory({ keys })`, Esc, input lock), the part only draws
`{ title, hint, items: list(), capacity, used, weight, maxWeight }`.
```js
engine.ui.set('inventory', false);                         // no window at all (the key does nothing, no DOM)
engine.ui.set('inventory', { drop: true });               // default window plus a Drop button per row (Use appears for items with use)
engine.ui.set('inventory', (engine) => {                  // your own: grid, drag and drop, anything
  const el = document.createElement('div'); engine.uiRoot.appendChild(el);
  el.onclick = ev => { const key = ev.target.dataset.key; if (key) engine.ops.run('inventory.use', { item: key }); };   // buttons run ops
  return { show: d => { el.hidden = false; el.innerHTML = d.items.map(i => `<button data-key="${i.key}">${i.def.name} ×${i.count}</button>`).join(''); },
    update: d => { el.innerHTML = d.items.map(i => `<button data-key="${i.key}">${i.def.name} ×${i.count}</button>`).join(''); },
    hide: () => { el.hidden = true; }, dispose: () => el.remove() };
});
engine.ui.open('inventory'); engine.ui.close('inventory');   // open / close from code
```
The default look of items on the ground comes from the style pack's `style.pickup` (color, glow, size); a single item uses its own `color`; for a
custom model pass `{ mesh }` (a three.js object cannot go into a save, so after loading it falls back to the default look).
To give / take items in content use the effect words: `{ give: { coin: 2 } }`, `{ take: { mushroom: 3 } }`; condition words:
`{ has: { mushroom: 3 } }`, `{ lacks: { coin: 1 } }`.

## Chests / corpses / shelves (multiple containers)
The player inventory is just one container (id `'player'`). Chests, corpses, shelves and ammo boxes all use `inventory.container(id, { capacity })` to
get or create one (calling again with the same id returns the same one); limits as above. A container has the same
`add / remove / count / has / get / list / setData` as the inventory, plus `room(id)` (how many more fit) and `on('add' | 'remove', fn)` (returns a handle).
```js
const I = engine.inventory;
const chest = I.container('chest-1', { capacity: 8 });
chest.add('bandage', 2);                      // returns false if it doesn't fit (if part fits, that part is added)
I.transfer(chest, 'player', 'bandage', 1);    // a container or a container id both work; returns how many were actually moved (fewer / 0 if the inventory is full)
I.transfer('player', chest, 'coin', 5);       // shelves and money boxes work the same way
chest.on('remove', ({ id, count }) => console.log('taken', id, count));   // changes to the player inventory are item:add / item:remove; other containers emit container:add / container:remove (with an extra container id)
```
- **Relation to world**: a container id can be a world record's id directly (for example `'prop:chest:3'`, a zombie's id). Containers do not depend on
  models: a far-away chest has no model but its contents still exist; contents are saved (containers that hold something, and those that were given
  initial goods). Loading creates the containers first, and a later `container(id, { capacity })` in code just fills in the slot count, in either order.
- **Deleting a world record does not delete its container automatically** (whether to keep a searched corpse is up to the game). To clear both:
  `engine.events.on('world:remove', ({ id }) => I.removeContainer(id))`.
- **Pre-filled contents (initial semantics)**: goods are placed only the **first** time; on load the save wins, and a searched-empty container is not
  refilled after loading. Write `content/containers.js` in content (`export default { 'chest-1': { capacity: 8, items: { bandage: 2 } } }`, and put it
  in the export of `content/index.js`), or in code `I.container('chest-1', { capacity: 8, items: { bandage: 2 } })`. For an already existing container
  (created first by loading, or already created this session) `items` is not placed again; a container that was given goods goes into the save even
  when searched empty (`{}`), so after a refresh and load it is empty and not refilled. Don't fill with `container(id).add(...)` at startup: a
  container with nothing in it is not saved, so after a refresh it would be treated as new and filled again. A container id is any string and all are
  saved ('shop-bakery' and 'prop:chest:3' alike).
- **UI**: the engine only makes the player inventory window; for a chest UI draw `chest.list()` yourself, and clicking an entry runs
  `engine.ops.run('inventory.transfer', { from: 'chest-1', to: 'player', item: entry.key })`.
- Non-empty containers appear in `describe()` under `inventory.containers`.

## 3. Verify
- `npm run check`: an undefined item id in pickups or a missing place name is an error. After `npm run map`, GAMEMAP.md has the item table and the pickup count.
- Find the nearest of an item: `engine.inventory.nearestPickup('berry')` (world data, found even when far); all of them:
  `engine.world.query({ kind: 'pickup' })`.
- `describe()`: `inventory.items` (key -> count, or `{ count, data }` for pieces with data), `inventory.slots`; items still on the ground appear in
  `nearby` with `kind: 'pickup'` and `id`.
  Text version: `npm run shot -- / --pos x,z --describe-only` shows the pickup entries in "nearby" and an `inventory: {...}` line.
- Simulate picking up (in tests): put the player next to the item with `engine.player.placeAt({ x, z })`, run `engine.ops.run('interaction.use')` (no
  id = the nearest interaction) after `engine.step(0.2)`, then check `engine.inventory.count(id)`. Auto pickups need only `engine.step(0.2)` with the
  player inside the radius.
