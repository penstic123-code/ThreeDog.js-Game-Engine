# engine.interactions — interactions(opts?: InteractionsOptions)

Interaction prompts (interactions() module)

- Options `InteractionsOptions`:
  - `action?: string` Default action name, default 'interact'
  - `promptHeight?: number` How high the prompt floats (meters)
  - `radius?: number` Default reach of add() in meters, default 2.5
  - `pick?: InteractionPick` How the interaction in front of the actor is chosen, default 'nearest'. Example: `interactions({ pick: 'aim', radius: 2 }) // first person`

## Methods and properties
- `interactions.add(target: Object3D | PositionLike, opts?: InteractionOptions) → Handle` — Add an interaction: passing an object makes it follow the object, passing a position (Vector3 / [x, y, z] / { x, y, z }) makes a fixed point. Returns a handle { remove() }
- `interactions.byId(id: string) → any` — The interaction with this id, or null. Using one is the op: engine.ops.run('interaction.use', { id }) (no id = the one the actor would pick)
- Properties:
  - `promptHeight: number` How high the prompt floats (meters)
  - `items: any[]` All interactions
  - `radius: number` Default reach of add() in meters (2.5)
  - `pickMode: InteractionPick` How the one in front of the actor is chosen; can be changed at runtime
  - `current: any` The interaction the prompt shows right now (null if none)
  - `options: { action: string; id: string; label: string }[]` One best interaction per key action this frame, for a prompt that lists several keys

## Data structures
- **InteractionOptions**
  - `id?: string` Stable id for the op interaction.use { id } (default: the world record id it was built for, else a running number)
  - `label?: string | (() => string)` Prompt text, or a function returning text
  - `radius?: number` How close the actor must be (meters), default interactions({ radius }) = 2.5
  - `action?: string` Key action name, default 'interact' (E key). Give one object a second verb by adding another interaction with another action
  - `onUse?: (object: Object3D) => void` Called when pressed
  - `enabled?: () => boolean` When this returns false the whole prompt disappears (to show a state such as "growing", don't use enabled: have the label function return different text by state and decide in onUse whether it can be used)
  - `height?: number` How high the prompt floats above the object (meters)
