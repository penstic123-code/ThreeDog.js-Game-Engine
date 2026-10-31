// Inventory module: define items first, then add/remove. Press I by default to open the inventory window (the 'inventory' UI part). Pickups on the ground use
// spawnPickup() (data lives in engine.world, so install world() first; openWorld() includes it).
//
// inventory.define('fish', { name: '鲫鱼', icon: '🐟', iconUrl: '/textures/fish.png', desc: '河里钓的', stack: 20, weight: 0.5 });
// inventory.add('fish', 2);  inventory.has('fish', 1);  inventory.remove('fish');   // all operate on the player inventory
// One piece with its own data: const key = inventory.add('sword', 1, { data: { durability: 80 } });   // 'sword#1'; count('sword') counts every sword
// Chest / corpse / shelf: inventory.container('chest-1', { capacity: 8 }).add('fish');  inventory.transfer('chest-1', 'player', 'fish', 2);
// Player actions with items are ops: inventory.transfer / inventory.use / inventory.drop (inventoryOps.js).
//
// Look:
// window UI part 'inventory' (engine.ui.set('inventory', false | { drop: true } | yourPart)); body via style.ui.templates.inventory(data, { esc, t, icon })
//   list styling   CSS classes .threedog-win-inventory .threedog-row ... (override in style.ui.css)
//   pickups        style pack style.pickup = { color, size, lift, model: (item, { color, size }) => Object3D | BufferGeometry }, or pass a mesh each time
import { checkOptions, warnMissing, freezeDef, moduleKeys } from '../../core/validate.js';
import { Container } from './Container.js';
import { Containers } from './Containers.js';
import { followRuntimeIds } from '../../core/saveIds.js';
import { spawnPickup, nearestPickup, presentPickups, takeAuto } from './pickups.js';
import { inventoryWindow, windowData, defineInventoryOps } from './inventoryOps.js';

const STRINGS = {
  'zh-CN': { 'inventory.title': '背包', 'inventory.action': '背包', 'inventory.empty': '背包是空的。', 'inventory.full': '背包满了',
    'inventory.got': '获得 {icon} {name} ×{n}', 'inventory.pickup': '捡起 {name}', 'inventory.use': '使用', 'inventory.drop': '丢下' },
  en: { 'inventory.title': 'Inventory', 'inventory.action': 'Inventory', 'inventory.empty': 'Your bag is empty.', 'inventory.full': 'Inventory full',
    'inventory.got': 'Got {icon} {name} ×{n}', 'inventory.pickup': 'Pick up {name}', 'inventory.use': 'Use', 'inventory.drop': 'Drop' },
};

export class Inventory {
  constructor(engine, { action = 'inventory', keys, pad, capacity = Infinity, maxWeight = Infinity, defaultStack = 99, pickupRadius = 2, bobDistance = 60 } = {}) {
    this.engine = engine;
    this.defs = new Map();
    this.defaultStack = defaultStack;
    /** Interact radius of pickups that don't set their own (meters); auto pickups are taken within it */ this.pickupRadius = pickupRadius;
    this.bag = new Container(this, 'player', { capacity, maxWeight, player: true });   // player inventory = the container with id 'player'
    this._containers = new Containers(this, this.bag);
    this.action = action;
    this._meshes = new Map();   // world id -> custom mesh the game passed to spawnPickup (three.js objects can't go in world data)
    // a pickup record gone (taken without respawn, removed, not in a loaded save): its custom mesh is no longer needed for a rebuild
    engine.events.on('world:remove', ({ id }) => this._meshes.delete(id));
    engine.events.on('world:load', () => { for (const id of this._meshes.keys()) if (!engine.world.get(id)) this._meshes.delete(id); });
    this._presented = false;
    this._autoQueue = [];       // auto pickups in reach this step (pickups.js)
    this._seq = 0;              // entry key counter ('sword#7'), saved so keys never repeat
    this.bobDistance = bobDistance;
    engine.i18n.add(STRINGS);
    keys = moduleKeys('inventory()', action, keys, 'inventory', engine.input);   // the game's key or a presets.keys bundle, never a built-in one
    if (keys.length || pad) { engine.input.define(action, keys, 'inventory.action', { pad }); engine.input.touchButton(action, 'inventory.action'); }
    engine.ui.define('inventory', inventoryWindow, { modal: { cancel: e => e.ui.close('inventory'), data: () => windowData(this) } });
    for (const ev of ['i18n:change', 'input:rebind']) engine.events.on(ev, () => this._refresh());
    // pickup state lives in world and is saved with it
    // version 1 is the current shape; raise it with a migrate step when it changes. seq: the numbering of entry keys (sword#3); a save without it continues
    // after the highest key it holds
    engine.saves.register('inventory', { version: 1, save: () => ({ seq: this._seq, items: this.bag._save() }), load: d => {
      this.bag._load(d?.items);
      const top = Math.max(0, ...this.bag._entries.map(x => Number(x.key.split('#')[1]) || 0));
      this._seq = Number.isInteger(d?.seq) && d.seq >= top ? d.seq : top;
      this._refresh();
    } });
    // version 2: container ids that are runtime record ids (a spawned chest) follow the world part's `kind-n` -> `kind#n` rename (world/persist.js)
    engine.saves.register('containers', { version: 2, migrate: { 1: followRuntimeIds }, save: () => this._containers.save(), load: d => this._containers.load(d) });
  }

  /** Max slots of the player inventory (Infinity = no limit). */
  get capacity() { return this.bag.capacity; }
  set capacity(n) { this.bag.capacity = n; }

  /**
   * Get or create a container (chest, corpse, shelf...). The player inventory is the one with id 'player'; all have add / remove / count / has / get / list /
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
   * Move n (default 1) of an item, or of one entry by key, between containers (container or id; player inventory is 'player'). Pieces keep their data and key.
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
  /** Delete a container with its contents ('player' cannot be deleted); returns whether one was deleted. */
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
    if (id.includes('#')) throw new Error(`inventory.define('${id}'): '#' is reserved for entry keys (sword#3); pick an id without it`);
    checkOptions(`inventory.define('${id}')`, def, ['name', 'icon', 'iconUrl', 'desc', 'stack', 'color', 'weight', 'use', 'canUse', 'consume'], { loose: true });   // only near-miss spellings warn
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
   * @example engine.inventory.trade('rusty_key', 'gold_key')   // { ok: true, ... } or { ok: false, reason: 'full' | 'notEnough' }
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

  /**
   * Place a pickup on the ground at position: walk up and press the interact key to take it (needs world() and interactions()); auto: true takes it by walking
   * into it.
   * The data is a plain record of kind 'pickup' in engine.world ({ id, item, count, data?, radius?, auto?, bob, respawn?, until?, zone?, position }, saved with
   * it),
   * the model is built only within bobDistance meters of the player; taking it deletes the record (with respawnSeconds it stays with until = clock.now of the
   * respawn and comes back then).
   * id: without it, auto-numbered (pickup-1...); give a stable id to recognize one in saves (content pickups use `pickup:<item>:<index>`). Existing data with
   * the same id is reused.
   * initial: true = written in content (needs an id; the save records only taken / waiting to respawn); zone = which level it belongs to.
   * data = the piece's own data (a dropped sword keeps its durability); radius = reach in meters (default inventory pickupRadius).
   * Returns a handle { id: item, worldId: id in world, object: current model (null when far), remove() }.
   * @example engine.inventory.spawnPickup('berry', [3, 0, 5], { count: 2, respawnSeconds: 120 })
   * @example engine.inventory.spawnPickup('ammo', [8, 0, 2], { count: 30, auto: true, radius: 1.2 })   // taken on touch
   * @param {string} item
   * @param {any} position
   * @param {Record<string, any>} [opts]
   */
  spawnPickup(item, position, opts = {}) { return spawnPickup(this, item, position, opts); }

  /** Pickup data of an item that is still on the ground, nearest to from (default player) (used by hud's { nearest }); null if none. */
  nearestPickup(item, from) { return nearestPickup(this, item, from); }

  /** Register how pickups look and respawn (done once on first use; needs world installed first). @internal */
  _world() { return presentPickups(this); }
  /** Next entry key for an item with data @internal */
  _newKey(id) { return `${id}#${++this._seq}`; }
  /** Redraw the inventory part if it is open @internal */
  _refresh() { const ui = this.engine.ui; if (ui.isOpen('inventory')) ui.get('inventory')?.update(windowData(this)); }
}

/**
 * Inventory module. Installs engine.inventory, the 'inventory' UI part and the ops inventory.transfer / use / drop / trade; ground pickups need world() and
 * interactions().
 * Options: action / keys / pad (the open key: required, keys: [] for none; presets.keys.inventory has I / gamepad Y), capacity / maxWeight / defaultStack (bag
 * limits), pickupRadius / bobDistance (ground pickups),
 * pauseGame (default false): true freezes gameplay while the window is open (monsters, timers and the game clock stop; the picture and UI stay alive).
 * @example engine.use(inventory({ ...presets.keys.inventory, pauseGame: true }))   // opening the bag with I stops the world until it closes
 */
export function inventory(opts = {}) {
  let inv = null;
  return {
    name: 'inventory', label: 'Inventory', optional: ['world'],
    install(e) {
      checkOptions('inventory()', opts, ['action', 'keys', 'pad', 'capacity', 'maxWeight', 'defaultStack', 'pickupRadius', 'bobDistance', 'pauseGame']);
      inv = new Inventory(e, opts);
      // pauseGame: true freezes gameplay (engine.freeze, the same mechanism flow's 'paused' and settings({ freezeWorld }) use) while the window is open.
      // Rendering and UI go on; the freeze is released when the window closes or the inventory is turned off with engine.ui.set('inventory', false).
      if (opts.pauseGame != null && typeof opts.pauseGame !== 'boolean') throw new Error(`inventory({ pauseGame: ${JSON.stringify(opts.pauseGame)} }): pauseGame must be true or false. Example: engine.use(inventory({ pauseGame: true }))`);
      inv.pauseGame = !!opts.pauseGame;   // also settable at runtime: engine.inventory.pauseGame = true
      e.events.on('ui:open', id => { if (id === 'inventory' && inv.pauseGame) e.freeze('inventory'); });
      // always: switching pauseGame off while open must not leave the world frozen
      e.events.on('ui:close', id => { if (id === 'inventory') e.unfreeze('inventory'); });
      defineInventoryOps(e, inv);
      return inv;
    },
    fixed() { takeAuto(inv); },
    frame(dt, e) {   // the inventory key toggles the part; while open the part holds the input lock, so the close press is read raw
      const open = e.ui.isOpen('inventory');
      if (open ? e.input.pressedRaw(inv.action) : e.input.pressed(inv.action)) { if (open) e.ui.close('inventory'); else e.ui.open('inventory'); }
    },
    describe(e, ctx) {
      const w = e.world;   // use the model if present (same object the interactions module reports, merged into one entry); far away only data
      if (w) for (const r of w.query({ kind: 'pickup', near: ctx.center, radius: ctx.radius, where: r => r.until == null })) ctx.near(w.view(r.id) ?? r.position, { name: inv.item(r.item).name, kind: 'pickup', id: r.item });
      const show = c => Object.fromEntries(c._entries.map(x => [x.key, x.data === undefined ? x.count : { count: x.count, data: x.data }]));
      const boxes = Object.fromEntries([...inv._containers.map].filter(([, c]) => c !== inv.bag && c._entries.length).map(([id, c]) => [id, show(c)]));
      return { items: show(inv.bag), slots: inv.capacity === Infinity ? `${inv.slotsUsed}` : `${inv.slotsUsed}/${inv.capacity}`, ...(inv.bag.weight && { weight: `${inv.bag.weight}/${inv.bag.maxWeight}` }), ...(Object.keys(boxes).length && { containers: boxes }) };
    },
  };
}
