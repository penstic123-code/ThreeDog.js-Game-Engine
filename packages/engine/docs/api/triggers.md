# engine.triggers — triggers(opts?: TriggersOptions)

Trigger zones (triggers() module)

- Options `TriggersOptions`:
  - `action?: string` Action name that toggles the debug view 'triggers' (engine.debug.view), default 'triggersDebug'
  - `keys?: string[]` Key that toggles that view: default ['F4'] in dev builds, none in release builds

## Methods and properties
- `triggers.list() → Trigger[]` — All trigger zones (a new array)
- `triggers.add(opts?: TriggerOptions) → Trigger` — Add a trigger zone
- `triggers.clear()` — Delete all (delete a single one with trigger.remove())
- `triggers.byTag(tag: string) → Trigger[]` — Find by tag
- `triggers.fromMarkers(opts?: TriggerOptions) → Trigger[]` — Every trigger_xxx marker in the level becomes a trigger zone with tag xxx; opts is shared by all of them

## Data structures
- **TriggerOptions** Trigger zone parameters
  - `shape?: 'cylinder' | 'sphere' | 'box'` Shape: 'cylinder' upright cylinder (default) / 'sphere' / 'box' cuboid
  - `position?: PositionLike` Center { x, y, z } / [x, y, z] / Vector3 / object (meters); for box and cylinder y is the bottom height; without y the ground height is used
  - `radius?: number` Sphere/cylinder radius (meters), default 1.5
  - `size?: number[]` Box size [width, height, depth] (meters), default [2, 2, 2]
  - `height?: number` Cylinder height (meters), default 3
  - `rotation?: number` Box rotation around the Y axis (radians)
  - `onEnter?: ((t, who, id) => void) | null` Called on entering; who is the position that entered, id the world record id of who it is (engine.actor for the default who, an id given in who, object.userData.id, null for a bare position)
  - `onExit?: ((t, who, id) => void) | null` Called on leaving; id = who was inside
  - `onStay?: ((dt, t, who, id) => void) | null` Called every fixed step while inside (dt in seconds)
  - `once?: boolean` Fire on the first enter only (exit follows at once); the zone stays with used = true, and a new playthrough (engine.session) re-arms it
  - `enabled?: boolean` false pauses detection
  - `tag?: string` Name (carried in events)
  - `who?: string | Vector3 | Object3D | { x, y, z } | (() => Array<string | Obje…) | null` Who can trigger it: engine.actor by default; or an actor id, a position, an object (its position is used), or a function returning an array of those (several actors: () => [e.actor, ...e.net.peers.map(p => p.actor)])
  - `cooldown?: number` Seconds after leaving during which entering does not fire again, default 0
  - `userData?: Record<string, any>` Custom data
- **Trigger** A trigger zone (the return value of add())
  - `shape: 'cylinder' | 'sphere' | 'box'`
  - `x: number` Position (meters)
  - `y: number`
  - `z: number`
  - `radius: number`
  - `height: number`
  - `rotation: number`
  - `tag: string`
  - `inside: boolean` Whether the player is inside now
  - `enabled: boolean` Can be changed at any time: false pauses detection
  - `once: boolean`
  - `used: boolean` A once zone that already fired this playthrough
  - `cooldown: number`
  - `userData: Record<string, any>`
  - `onEnter: TriggerOptions['onEnter']`
  - `onExit: TriggerOptions['onExit']`
  - `onStay: TriggerOptions['onStay']`
  - `remove()` — Delete this trigger zone
  - `contains(p: { x: number; y: number; z: number }) → boolean` — Whether a point is inside
