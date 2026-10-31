# engine.inventory — inventory(opts?: InventoryOptions)

Inventory (inventory() module)

- Options `InventoryOptions`:
  - `action?: string` Action name that opens the inventory, default 'inventory'
  - `keys?: string[]` Keys that open the bag: required unless createEngine({ bindings }) binds the action ([] = no key); presets.keys.inventory has ['KeyI']
  - `pad?: string[]` Gamepad button, none by default; presets.keys.inventory has ['PadY']
  - `pauseGame?: boolean` true: gameplay freezes (engine.freeze) while the inventory window is open, default false. Also settable at runtime: engine.inventory.pauseGame
  - `bobDistance?: number` Pickups float and spin only within this distance (meters) of the focus, default 60
  - `capacity?: number` Slot limit of the player inventory, default Infinity (no limit)
  - `maxWeight?: number` Weight limit of the player inventory, default Infinity
  - `pickupRadius?: number` Reach of pickups that do not set their own radius (meters), default 2
  - `defaultStack?: number` Default stack limit, default 99

## Methods and properties
- `inventory.define(id: string, def: ItemDef)` — Define an item (chainable)
- `inventory.item(id: string) → ItemDef` — Get an item definition
- `inventory.count(x: string) → number` — How many of an item, or of one entry key
- `inventory.has(x: string, n?: number) → boolean` — Whether there are at least n (default 1)
- `inventory.list() → ItemEntry[]` — Player inventory entries (for custom UI)
- `inventory.get(key: string) → ItemEntry | null` — One player inventory entry by key, or null
- `inventory.add(id: string, n?: number, opts?: { data?, silent? }) → string | false` — Add n to the player inventory (default 1), opts { data, silent }; returns the entry key, false if it does not fit
- `inventory.remove(x: string, n?: number) → boolean` — Remove n (default 1) of an item or entry key, returns false if there are not enough
- `inventory.trade(take: string, give: string, opts?: { takeN?, giveN?, data?, silent? }) → { ok, reason?, took?, gave?, giveId?, giveN? }` — Atomic trade: take A (id or entry key) and give B in one all-or-nothing step; reason 'notEnough' / 'full'. Ops: inventory.trade, engine.ops.undo reverses it
- `inventory.setData(key: string, data: Record<string, any> | null, n?: number) → string` — Replace a player inventory entry's data for n pieces (default all); returns the key now holding them
- `inventory.container(id: string, opts?: { capacity?, maxWeight?, items? }) → Container` — Get or create a container (chest, corpse, shelf...); the id can be the id of a world record, and the contents are saved. A second call returns the same one; deleting the world record does not delete the container automatically
- `inventory.transfer(from: Container | string, to: Container | string, item: string, n?: number) → number` — Move n (default 1) of an item or one entry key between containers (pieces keep data and key); moves fewer if the target cannot hold them all, returns how many were actually moved
- `inventory.removeContainer(id: string) → boolean` — Delete a container together with its contents ('player' cannot be deleted), returns whether one was deleted
- `inventory.spawnPickup(id: string, position: PositionLike, opts?: PickupOptions) → PickupHandle` — Place a pickup on the ground at position; its y, if any, is the reference height on multi-layer ground (needs the interactions module unless auto): spawnPickup('berry', v, { count: 2 }). Returns a handle, remove() deletes it
- `inventory.nearestPickup(id: string, from?: PositionLike) → WorldRecord | null` — The data of the nearest pickup of an item still on the ground to from (default the player) (a world record of kind 'pickup'), null if none
- Properties:
  - `pauseGame: boolean` true: gameplay freezes while the inventory window is open (set from inventory({ pauseGame }) or at runtime)
  - `defs: Map<string, ItemDef>` Item definitions
  - `capacity: number` Slot limit of the player inventory
  - `bag: Container` Player inventory (= container('player'))
  - `pickupRadius: number` Reach of pickups that do not set their own (meters)
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
- **PickupOptions** Parameters of spawnPickup()
  - `id?: string` Stable id of this record in world (saves recognize it by this); numbered automatically pickup#1... if omitted, and an existing record with the same id is reused
  - `count?: number` How many you get when picking up, default 1
  - `data?: Record<string, any>` The piece's own data (a dropped sword keeps its durability)
  - `radius?: number` Reach in meters, default inventory pickupRadius (2)
  - `auto?: boolean` Taken by walking into it (no key press, no prompt)
  - `mesh?: Object3D | null` Custom model (the style pack's style.pickup is used if omitted)
  - `respawnSeconds?: number` Game seconds until it reappears, 0 = never reappears
  - `bob?: boolean` Bob up and down and rotate, default true
  - `initial?: boolean` Pickup authored in content (needs an id): the initial record of world; saves record only being picked up / waiting to respawn, with identical results whether the load comes before or after this spawn
  - `zone?: string | null` Which zone it belongs to (a level name, see world.zone): the data stays across level changes (a picked-up one stays picked up)
- **PickupHandle** (extends Handle) Handle returned by spawnPickup(): id is the item, worldId is the id of this record in engine.world, object is the current model (null when far away); remove() deletes the pickup (data and model; a model passed in through opts.mesh is only taken off)
  - `id: string`
  - `worldId: string`
  - `object: Object3D | null`
