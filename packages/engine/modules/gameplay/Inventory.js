// Inventory module: define items first, then add/remove. The game's key (inventory({ keys }) or presets.keys.inventory; none built in) opens the window (the 'inventory' UI part).
// Items lying on the ground are the separate pickups() module (pickups.js): it puts what is picked up into the picker's container.
//
// Every actor has its own container, the one whose id is the actor id ('player' locally, each net peer's actor id, an NPC's id): inventory.of(actor).
// "The player inventory" is the container of engine.actor (inventory.of()); add / remove / count / has / list / get / trade / setData below are short for it.
// inventory.define('fish', { name: '鲫鱼', icon: '🐟', iconUrl: '/textures/fish.png', desc: '河里钓的', stack: 20, weight: 0.5 });
// inventory.add('fish', 2);  inventory.has('fish', 1);  inventory.remove('fish');   // the local user's bag (engine.actor)
// inventory.of(ctx.actor).add('fish');                                                // inside an op: the bag of whoever runs it (a net peer, an NPC)
// One piece with its own data: const key = inventory.add('sword', 1, { data: { durability: 80 } });   // 'sword#1'; count('sword') counts every sword
// Chest / corpse / shelf: inventory.container('chest-1', { capacity: 8 }).add('fish');  inventory.transfer('chest-1', 'player', 'fish', 2);
// Player actions with items are ops: inventory.transfer / inventory.use / inventory.drop (inventoryOps.js).
//
// Look:
// window UI part 'inventory' (engine.ui.set('inventory', false | { drop: true } | yourPart)); body via style.ui.templates.inventory(data, { esc, t, icon })
//   list styling   CSS classes .threedog-win-inventory .threedog-row ... (override in style.ui.css)
import { checkOptions, warnMissing, freezeDef, moduleKeys } from '../../core/validate.js';
import { readParams } from '../../core/params.js';
import { codedError } from '../../core/errorHints.js';
import { Container } from './Container.js';
import { Containers } from './Containers.js';
import { followRuntimeIds } from '../../core/saveIds.js';
import { inventoryWindow, windowData, defineInventoryOps, INVENTORY_STRINGS } from './inventoryOps.js';

export class Inventory {
  constructor(engine, { action = 'inventory', keys, pad, capacity = Infinity, maxWeight = Infinity, defaultStack = 99 } = {}) {
    this.engine = engine;
    this.defs = new Map();
    this.defaultStack = defaultStack;
    // the local user's home bag: the container 'player' (each machine calls its own avatar 'player', net/sync.js), with the module's limits, saved as the
    // 'inventory' part. Other actors' bags are plain containers (net creates one per peer).
    /** @internal */ this.home = new Container(this, 'player', { capacity, maxWeight });
    this._containers = new Containers(this, this.home);
    this.action = action;
    this._seq = 0;              // entry key counter ('sword#7'), saved so keys never repeat
    engine.i18n.add(INVENTORY_STRINGS);
    keys = moduleKeys('inventory()', action, keys, 'inventory', engine.input);   // the game's key or a presets.keys bundle, never a built-in one
    if (keys.length || pad) { engine.input.define(action, keys, 'inventory.action', { pad }); engine.input.touchButton(action, 'inventory.action'); }
    engine.ui.define('inventory', inventoryWindow, { modal: { cancel: e => e.ui.close('inventory'), freeze: () => this.pauseGame, data: () => windowData(this) } });
    for (const ev of ['i18n:change', 'input:rebind']) engine.events.on(ev, () => this._refresh());
    // version 1 is the current shape; raise it with a migrate step when it changes. seq: the numbering of entry keys (sword#3); a save without it continues
    // after the highest key it holds
    engine.saves.register('inventory', { atomic: true, version: 1, save: () => ({ seq: this._seq, items: this.home._save() }), load: d => {
      this.home._load(d?.items);
      const top = Math.max(0, ...this.home._entries.map(x => Number(x.key.split('#')[1]) || 0));
      this._seq = Number.isInteger(d?.seq) && d.seq >= top ? d.seq : top;
      this._refresh();
    } });
    // version 2: container ids that are runtime record ids (a spawned chest) follow the world part's `kind-n` -> `kind#n` rename (world/persist.js)
    engine.saves.register('containers', { atomic: true, version: 2, migrate: { 1: followRuntimeIds }, save: () => this._containers.save(), load: d => this._containers.load(d) });
  }

  /**
   * The container of an actor (default engine.actor): the bag whose id is the actor id, created empty on first use. Inside an op pass ctx.actor, so a net
   * peer or an NPC running it uses its own bag, never the local player's.
   * @example engine.ops.define('fish.catch', { net: 'peer', run: (e, a, ctx) => e.inventory.of(ctx.actor).add('fish') });
   * @param {string} [actor]
   * @returns {Container}
   */
  of(actor = this.engine.actor) { return this._containers.map.get(actor) ?? this._containers.get(actor); }
  /** The player inventory: the container of engine.actor (read live, so it follows a hand-over of control). */
  get bag() { return this.of(); }
  /** Max slots of the player inventory (Infinity = no limit). */
  get capacity() { return this.bag.capacity; }
  set capacity(n) { this.bag.capacity = n; }

  /**
   * Get or create a container (chest, corpse, shelf, an actor's bag...). An actor's bag is the one with the actor's id (inventory.of(actor)); all have add / remove / count / has / get / list /
   * room / setData / on with the same rules.
   * id is any string (a world record id, 'shop-bakery'...); contents are saved. Far chests have no model but keep contents; a container created first by a load
   * gets its limits by calling this again.
   * Containers are not removed when their world record is (the game decides whether to keep a searched corpse): `engine.events.on('world:remove', ({ id }) =>
   * engine.inventory.removeContainer(id))`.
   * Limits are optional and off by default: capacity (slots, an entry uses ceil(count / stack)) and maxWeight (item weight × count). Locks and prices are game
   * rules checked in its ops.
   * @example
   * const chest = engine.inventory.container('chest-1', { capacity: 8 });   // a second call returns the same one
   * chest.add('bandage', 2);
   * // with starting contents: placed only when this container is first created (if the save already has it, the save wins; not refilled after being emptied
   * and loaded)
   * engine.inventory.container('pack', { maxWeight: 30, items: { bandage: 2 } });
   * engine.inventory.transfer(chest, 'player', 'bandage', 1);   // returns how many were actually moved
   * @param {string} id
   * @param {{ capacity?: number, maxWeight?: number, items?: Record<string, number> }} [opts] capacity = slots, maxWeight = weight limit, both default
   * Infinity; items = starting contents { itemId: count } (placed only the first time)
   * @returns {Container}
   */
  container(id, opts) { return this._containers.get(id, opts); }
  /**
   * @internal content/renames.js: containers saved under an old authored id move to the new one (content.load calls it before adding containers)
   * @param {Record<string, string | null>} map
   * @returns {void}
   */
  renameIds(map) { this._containers.rename(map); }
  /**
   * Move n (default 1) of an item, or of one entry by key, between containers (container or id; an actor's bag has the actor's id). Pieces keep their data and key.
   * Moves fewer if the target is full, returns how many moved (0 = none). Players moving items run the op instead: engine.ops.run('inventory.transfer', { from,
   * to, item, n }).
   * @example engine.inventory.transfer('player', 'chest-1', 'sword#3')   // exactly that sword
   * @param {Container | string} from
   * @param {Container | string} to
   * @param {string} item  item id or entry key
   * @param {number} [n]
   * @returns {number}
   */
  transfer(from, to, item, n = 1) { return this._containers.transfer(from, to, item, n); }
  /** Delete a container with its contents (the home bag 'player' cannot be deleted); returns whether one was deleted. */
  removeContainer(id) { return this._containers.remove(id); }

  /**
   * Define an item. stack = pieces per slot (default 99); weight counts against maxWeight; use(e, { actor, item, key, data }) makes it usable with the
   * inventory.use op (canUse returns true or a reason, consume: true removes one first). Games may add their own fields (price...).
   * The definition is shared by every piece and frozen; per-piece state (durability, ammo) goes in entry data: add('sword', 1, { data: { durability: 40 } }).
   * @example engine.inventory.define('potion', { name: 'Potion', icon: '🧪', weight: 0.2, consume: true, use: (e, { actor }) => heal(actor, 30) })
   * @param {string} id
   * @param {Record<string, any>} def
   * @returns {this}
   */
  define(id, def) {
    if (id.includes('#')) throw codedError('inventory-misuse', `inventory.define('${id}'): '#' is reserved for entry keys (sword#3); pick an id without it`);
    // shape only accepts a model name from assets (same path as content); the old mesh function is no longer read, and using it says how to fix it, instead of silently becoming a grey box
    if (def.mesh !== undefined) throw codedError('item-mesh', `inventory.define('${id}'): mesh is not an item field; register the shape in an asset pack (engine.assets.manifest({ models: { ${id}: fn } })) and write model: '${id}'`);
    checkOptions(`inventory.define('${id}')`, def, ['name', 'icon', 'iconUrl', 'desc', 'stack', 'color', 'weight', 'use', 'canUse', 'consume', 'model'], { loose: true });   // only near-miss spellings warn
    this.defs.set(id, freezeDef({ stack: this.defaultStack, name: id, ...def })); return this;   // shared by every entry of this item: read-only
  }
  // using an undefined item: warn when other items are defined (none defined means the game doesn't use define)
  _known(id) { if (this.defs.size && !this.defs.has(id)) warnMissing('item', id, [...this.defs.keys()]); }
  /** An item definition by id (a bare { name, stack } for an unknown id) */
  item(id) { return this.defs.get(id) || { name: id, stack: this.defaultStack }; }
  /** How many of an item (or of one entry key) the player has. */
  count(id) { return this.bag.count(id); }
  has(id, n = 1) { return this.bag.has(id, n); }
  /**
   * Atomic trade in the player inventory: take A and give B in one step, or change nothing (see Container.trade). Players run the op:
   * engine.ops.run('inventory.trade', { take, give }).
   * @example engine.inventory.trade('rusty_key', 'gold_key')   // { ok: true, ... } or { ok: false, code: 'full' | 'notEnough', facts, nextActions }
   * @param {string} take
   * @param {string} give
   * @param {{ takeN?: number, giveN?: number, data?: Record<string, any>, silent?: boolean }} [opts]
   */
  trade(take, give, opts) { return this.bag.trade(take, give, opts); }
  get slotsUsed() { return this.bag.slotsUsed; }
  /** Player inventory entries: [{ key, id, count, data, def }] (for custom UI). */
  list() { return this.bag.list(); }
  /** One player inventory entry by key: { key, id, count, data, def } or null. */
  get(key) { return this.bag.get(key); }
  /** Add n (default 1) to the player inventory, opts { data, silent }; returns the entry key, false if it doesn't fit. */
  add(id, n = 1, opts) { return this.bag.add(id, n, opts); }
  /** Remove n (default 1) of an item or entry key from the player inventory; returns false if not enough. */
  remove(id, n = 1) { return this.bag.remove(id, n); }
  /** Replace the data of a player inventory entry (see Container.setData); returns the key holding the changed pieces. */
  setData(key, data, n) { return this.bag.setData(key, data, n); }

  /** Next entry key for an item with data @internal */
  _newKey(id) { return `${id}#${++this._seq}`; }
  /** Redraw the inventory part if it is open @internal */
  _refresh() { const ui = this.engine.ui; if (ui.isOpen('inventory')) ui.get('inventory')?.update(windowData(this)); }
}

const INVENTORY_PARAMS = {
  action: { type: 'string', default: 'inventory', desc: 'input action that opens the bag' },
  keys: { type: 'array', optional: true, desc: 'keys that open the bag (required unless createEngine({ bindings }) binds the action; [] = no key)' },
  pad: { type: 'array', optional: true, desc: 'gamepad buttons that open the bag' },
  capacity: { type: 'number', optional: true, min: 0, desc: 'slot limit of the player inventory (default Infinity = no limit)' },
  maxWeight: { type: 'number', optional: true, min: 0, desc: 'weight limit of the player inventory (default Infinity = no limit)' },
  defaultStack: { type: 'number', default: 99, min: 1, desc: 'stack limit of items that set none' },
  pauseGame: { type: 'bool', optional: true, desc: 'true: gameplay freezes while the window is open (default false)' },
};

/**
 * Inventory module. Installs engine.inventory, the 'inventory' UI part and the ops inventory.transfer / use / drop / trade (drop needs pickups()); items
 * on the ground are the pickups() module.
 * Options: action / keys / pad (the open key: required, keys: [] for none; presets.keys.inventory has I / gamepad Y), capacity / maxWeight / defaultStack (bag
 * limits of the home bag 'player'),
 * pauseGame (default false): true freezes gameplay while the window is open (monsters, timers and the game clock stop; the picture and UI stay alive).
 * @example engine.use(inventory({ ...presets.keys.inventory, pauseGame: true }))   // opening the bag with I stops the world until it closes
 */
export function inventory(opts = {}) {
  const o = readParams('inventory', INVENTORY_PARAMS, opts);
  let inv = null;
  return {
    name: 'inventory', label: 'Inventory', params: INVENTORY_PARAMS, options: o, noSkip: 'no timers or spatial state',
    install(e) {
      inv = new Inventory(e, opts);
      // pauseGame: true freezes gameplay (engine.freeze('ui-inventory'), the part's own owner; the same mechanism flow's 'paused' and settings({ freezeWorld }) use) while the window is open.
      // Rendering and UI go on; the freeze is released when the window closes or the inventory is turned off with engine.ui.set('inventory', false).
      if (opts.pauseGame != null && typeof opts.pauseGame !== 'boolean') throw codedError('inventory-misuse', `inventory({ pauseGame: ${JSON.stringify(opts.pauseGame)} }): pauseGame must be true or false. Example: engine.use(inventory({ pauseGame: true }))`);
      inv.pauseGame = !!opts.pauseGame;   // also settable at runtime: engine.inventory.pauseGame = true
      defineInventoryOps(e, inv);
      return inv;
    },
    frame(dt, e) {   // the inventory key toggles the part; while open the part holds the input lock, so the close press is read raw
      const open = e.ui.isOpen('inventory');
      if (open ? e.input.pressedRaw(inv.action) : e.input.pressed(inv.action)) { if (open) e.ui.close('inventory'); else e.ui.open('inventory'); }
    },
    describe(e) {
      const show = c => Object.fromEntries(c._entries.map(x => [x.key, x.data === undefined ? x.count : { count: x.count, data: x.data }]));
      const boxes = Object.fromEntries([...inv._containers.map].filter(([, c]) => c !== inv.bag && c._entries.length).map(([id, c]) => [id, show(c)]));
      return { items: show(inv.bag), slots: inv.capacity === Infinity ? `${inv.slotsUsed}` : `${inv.slotsUsed}/${inv.capacity}`, ...(inv.bag.weight && { weight: `${inv.bag.weight}/${inv.bag.maxWeight}` }), ...(Object.keys(boxes).length && { containers: boxes }) };
    },
  };
}
