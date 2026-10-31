# engine.entities — entities()

Entities: single stateful, saved objects such as saplings, campfires and chests; the data is a record of engine.world, the model is built only when nearby (entities() module)


## Methods and properties
- `entities.define(type: string, def: EntityDef<S>)` — Define an entity type
- `entities.spawn(type: string, data?: EntitySpawnData) → Entity | null` — Spawn an entity (returns null if the type is not defined)
- `entities.nearest(position: PositionLike, opts?: { radius?, type? }) → Entity | null` — The entity nearest to position within radius meters (default 3) (type restricts to one type)
- `entities.clear()` — Delete all entities
- `entities.setStage(ent: Entity, i: number)` — Jump straight to a growth stage
- Also: `entities.get(id: string) → Entity | null`, `entities.byType(type: string) → Entity[]`, `entities.list() → Entity[]`, `entities.remove(id: string) → boolean`
- Properties:
  - `types: Map<string, EntityDef>` Type definitions
  - `now: number` Game seconds (= engine.clock.now)

## Data structures
- **EntityDef** Entity type definition: engine.entities.define('sapling', {...})
  - `create: (engine: Engine, ent: Entity<S>) => Object3D` Create the model (required), returns a THREE.Object3D
  - `state?: S` Default state (merged with the state given at spawn)
  - `stages?: EntityStage[]` Growth stages
  - `canGrow?: (ent: Entity<S>, engine: Engine) => boolean` Growth stops when this returns false
  - `update?: (dt: number, ent: Entity<S>, engine: Engine) => void` Called every fixed step (dt in seconds); runs only near the player, far away only growth is caught up
  - `interact?: EntityInteract` Interaction
  - `collider?: number` Circular collision radius (meters, needs the collision module; follows the model, exists only near the player)
  - `colliderHeight?: number` Collision height (meters), default 3
  - `dispose?: (ent: Entity<S>, engine: Engine) => void` Cleanup when the model is torn down (called both when walking away and on deletion; don't clear data while the data still exists)
  - `save?: boolean` false = not saved (temporary things, cleared on load), default true
- **EntityStage** Growth stage
  - `name: string` Stage name, e.g. 'seed'
  - `duration?: number` How many game seconds to stay in this stage (leave out on the last one = stay here forever)
  - `scale?: number` Model size multiplier
  - `model?: (engine: Engine, ent: Entity) => Object3D` Swap the model
- **EntityInteract** Entity interaction settings (needs the interactions module)
  - `label?: string | ((ent: Entity, engine: Engine) => string)` Prompt text: an i18n key, plain text, or a function ent => text
  - `action?: string` Interaction action name, default 'interact'
  - `radius?: number` How close you must be to interact (meters), default 2.5
  - `height?: number` How high the prompt floats (meters)
  - `enabled?: (ent: Entity, engine: Engine) => boolean` Whether it can be interacted with
  - `onUse?: (ent: Entity, engine: Engine) => void` When the interact key is pressed
- **EntitySpawnData** Parameters of spawn()
  - `id?: string` Specify the id (generated automatically if omitted)
  - `position?: PositionLike` Position: Vector3 / object / [x, y, z] / { x, z } ({ x, z } without y snaps to the ground), default origin
  - `rotation?: number` Heading (radians)
  - `state?: Record<string, any>` Initial state (merged onto the default state)
  - `extra?: Record<string, any>` Extra data (ent.data, saved)
- **Entity** An entity: x / y / z / rotation / state / data read engine.world data directly (kind is 'entity:<type>'); object / visual exist only near the player
  - `id: string`
  - `type: string`
  - `def: EntityDef<S>`
  - `x: number` Position (meters)
  - `z: number`
  - `y: number`
  - `rotation: number`
  - `state: S & { stage?: number; stageAt?: number }` State (stage is the current stage index, stageAt the time it was entered); change values with ent.set() so that events fire
  - `object: Object3D | null` Root node (heading and interactions hang on it); null when there is no model far away, built the frame after spawn
  - `visual: Object3D | null` Model (a child of the root node)
  - `data: Record<string, any>` Extra data
  - `stageName: string | null` Current stage name
  - `set(key: string, value: any)` — Change one state value (emits the entity:state event)
  - `remove() → boolean` — Delete this entity
