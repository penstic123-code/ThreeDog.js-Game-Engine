# engine.inventory — inventory(opts?: InventoryOptions)

Inventory (inventory() module)

- Options `InventoryOptions`:
  - `action?: string` Action name that opens the inventory, default 'inventory'
  - `keys?: string[]` Keys that open the bag: required unless createEngine({ bindings }) binds the action ([] = no key); presets.keys.inventory has ['KeyI']
  - `pad?: string[]` Gamepad button, none by default; presets.keys.inventory has ['PadY']
  - `pauseGame?: boolean` true: gameplay freezes (engine.freeze) while the inventory window is open, default false. Also settable at runtime: engine.inventory.pauseGame
  - `capacity?: number` Slot limit of the player inventory, default Infinity (no limit)
  - `maxWeight?: number` Weight limit of the player inventory, default Infinity
  - `defaultStack?: number` Default stack limit, default 99

## Methods and properties
- `inventory.of(actor?: string) → Container` — The bag of an actor (default engine.actor): the container with the actor's id, created empty on first use; inside an op pass ctx.actor
- `inventory.define(id: string, def: ItemDef)` — Define an item (chainable)
- `inventory.item(id: string) → ItemDef` — Get an item definition
- `inventory.count(x: string) → number` — How many of an item, or of one entry key
- `inventory.has(x: string, n?: number) → boolean` — Whether there are at least n (default 1)
- `inventory.list() → ItemEntry[]` — Player inventory entries (for custom UI)
- `inventory.get(key: string) → ItemEntry | null` — One player inventory entry by key, or null
- `inventory.add(id: string, n?: number, opts?: { data?, silent? }) → string | false` — Add n to the player inventory (default 1), opts { data, silent }; returns the entry key, false if it does not fit
- `inventory.remove(x: string, n?: number) → boolean` — Remove n (default 1) of an item or entry key, returns false if there are not enough
- `inventory.trade(take: string, give: string, opts?: { takeN?, giveN?, data?, silent? }) → { ok, code?, facts?, nextActions?, took?, gave?, … }` — Atomic trade: take A (id or entry key) and give B in one all-or-nothing step; failure code 'notEnough' / 'full'. Ops: inventory.trade, engine.ops.undo reverses it
- `inventory.setData(key: string, data: Record<string, any> | null, n?: number) → string` — Replace a player inventory entry's data for n pieces (default all); returns the key now holding them
- `inventory.container(id: string, opts?: { capacity?, maxWeight?, items? }) → Container` — Get or create a container (chest, corpse, shelf...); the id can be the id of a world record, and the contents are saved. A second call returns the same one; deleting the world record does not delete the container automatically
- `inventory.transfer(from: Container | string, to: Container | string, item: string, n?: number) → number` — Move n (default 1) of an item or one entry key between containers (pieces keep data and key); moves fewer if the target cannot hold them all, returns how many were actually moved
- `inventory.removeContainer(id: string) → boolean` — Delete a container together with its contents ('player' cannot be deleted), returns whether one was deleted
- Properties:
  - `pauseGame: boolean` true: gameplay freezes while the inventory window is open (set from inventory({ pauseGame }) or at runtime)
  - `defs: Map<string, ItemDef>` Item definitions
  - `capacity: number` Slot limit of the player inventory
  - `bag: Container` Player inventory: the bag of engine.actor (= of())
  - `slotsUsed: number` Slots used

## Data structures
- **ItemDef** Item definition
  - `name?: string` Display name
  - `icon?: string` Icon (text or emoji)
  - `iconUrl?: string` Icon image path
  - `desc?: string` Description
  - `stack?: number` Pieces per slot, default 99 (an entry of 150 uses 2 slots); 1 = every piece with data is its own entry
  - `weight?: number` Weight of one piece, counted against a container's maxWeight (default 0)
  - `use?: (e: any, info: ItemUseEvent) => void` Makes the item usable with the inventory.use op
  - `canUse?: (e: any, info: ItemUseEvent) => true | string` Whether it can be used now: true or a reason string (checked by the op's can)
  - `consume?: boolean` inventory.use removes one piece before calling use
  - `color?: ColorLike` Color of the pickup on the ground
  - `model?: string` Shape on the ground: a model name from an asset pack (file or generator; default: a model named 'pickup:<item id>', else 'pickup', else a gray box)
- **PickupOptions** Parameters of pickups.spawn()
  - `give: string | ((e: Engine, ctx: PickupGiveContext) => any)` What taking it does: an item id goes into the picker's container (inventory.of(actor); needs inventory()); a function (e, { actor, pickup }) => result is an instant effect (no inventory needed; not saved data, so spawn it again on load). Returning { ok: false, code } leaves it on the ground
  - `id?: string` Stable id of this record in world (saves recognize it by this); numbered automatically pickup#1... if omitted, and an existing record with the same id is reused
  - `count?: number` How many you get when picking up, default 1
  - `data?: Record<string, any>` The piece's own data (a dropped sword keeps its durability)
  - `name?: string` Name in the prompt ("Pick up {name}"), default the item's name
  - `model?: string` Shape on the ground: a model name from an asset pack (default the item's model, else 'pickup:<item>', else 'pickup', else a gray box)
  - `color?: ColorLike` Color of the gray placeholder / a geometry-only model (default the item's color, else style.pickup.color)
  - `radius?: number` Reach in meters, default pickups({ radius }) (2)
  - `auto?: boolean` Taken by walking into it (no key press, no prompt), by every actor in pickups.takers
  - `mesh?: Object3D | null` The game's own three.js object for this one pickup (only detached when it goes; otherwise the model name decides the shape)
  - `respawnSeconds?: number` Game seconds until it reappears, 0 = never reappears
  - `bob?: boolean` Bob up and down and rotate, default true
  - `initial?: boolean` Pickup authored in content (needs an id): the initial record of world; saves record only being picked up / waiting to respawn, with identical results whether the load comes before or after this spawn
  - `zone?: string | null` Which zone it belongs to (a level name, see world.zone): the data stays across level changes (a picked-up one stays picked up)
- **PickupHandle** (extends Handle) Handle returned by pickups.spawn(): id is the world record id, object is the current model (null when far away); remove() deletes the pickup (data and model; a model passed in through opts.mesh is only taken off)
  - `id: string` The pickup's world record id (engine.world.get(id)), not the item id (0.2 meaning; the item is `give` when it is a string)
  - `give: string | ((e: Engine, ctx: PickupGiveContext) => any)`
  - `object: Object3D | null`
