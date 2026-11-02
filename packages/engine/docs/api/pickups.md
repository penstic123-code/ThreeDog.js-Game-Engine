# engine.pickups — pickups(opts?: PickupsOptions)

pickups()

- Options `PickupsOptions`:
  - `radius?: number` Reach of pickups that do not set their own radius (meters), default 2
  - `showDistance?: number` Pickups have a model, float and spin only within this distance (meters) of the stream sources, default 60
  - `takers?: (e: Engine) => string[]` Who walks into auto pickups (actor ids); default engine.actor, plus net peers on a host

## Methods and properties
- `pickups.spawn(position: PositionLike, opts: PickupOptions) → PickupHandle` — Place a pickup on the ground at position; its y, if any, is the reference height on multi-layer ground (needs the interactions module unless auto): spawn(v, { give: 'berry', count: 2 }). Returns a handle, remove() deletes it
- `pickups.nearest(item?: string | null, from?: PositionLike) → WorldRecord | null` — The data of the nearest pickup still on the ground to from (default engine.actorPosition()), of one item id or any; null if none
- Properties:
  - `radius: number` Reach of pickups that do not set their own (meters)
  - `takers: (e: Engine) => string[]` Who walks into auto pickups: default engine.actor plus net peers on a host, none on a client
