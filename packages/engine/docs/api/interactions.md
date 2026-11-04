# engine.interactions — interactions(opts?: InteractionsOptions)

Interaction prompts (interactions() module)

- Options `InteractionsOptions`:
  - `action?: string` Default action name, default 'interact'
  - `promptHeight?: number` How high the prompt floats (meters)
  - `radius?: number` Default reach of add() in meters, default 2.5
  - `pick: InteractionPick` Required, no default: how the interaction in front of the actor is chosen. presets.interactions.* fill it. Example: `interactions({ pick: 'aim', keys: ['KeyE'], radius: 2 }) // first person`

## Methods and properties
- `interactions.add(target: Object3D | PositionLike, opts?: InteractionOptions) → Handle` — Add an interaction: passing an object makes it follow the object, passing a position (Vector3 / [x, y, z] / { x, y, z }) makes a fixed point. Returns a handle { remove() }
- `interactions.get(id: string) → any` — The interaction with this id, or null. Using one is the op: engine.ops.run('interaction.use', { id }) (no id = the one the actor would pick)
- Properties:
  - `promptHeight: number` How high the prompt floats (meters)
  - `items: any[]` All interactions in the order added (a fresh array each read; get(id) finds one without it)
  - `radius: number` Default reach of add() in meters (2.5)
  - `pickMode: InteractionPick` How the one in front of the actor is chosen; can be changed at runtime
  - `current: any` The interaction the prompt shows right now (null if none)
  - `options: { action: string; id: string; label: string }[]` One best interaction per key action this frame, for a prompt that lists several keys
  - `holding: { id, action, seconds, progress } | null` The hold in progress (progress 0-1), null when none

## Data structures
- **InteractionOptions**
  - `id?: string` Stable id for the op interaction.use { id } (default: the world record id it was built for, else a running number)
  - `label?: string | ((object, ctx) => string)` Prompt text, or a function (object, { actor }) returning text; actor = world record id of who looks at it
  - `radius?: number` How close the actor must be (meters), default interactions({ radius }) = 2.5
  - `action?: string` Key action name, default 'interact' (E key). Give one object a second verb by adding another interaction with another action
  - `onUse?: (object: Object3D, ctx: { actor: string }) => any` Called when used, with who uses it (ctx.actor of interaction.use: the local user, a net peer, an NPC). Its return value is the op's value; { ok: false, code } fails the op with that code
  - `enabled?: (object: Object3D, ctx: { actor: string }) => boolean` When this returns false the whole prompt disappears (to show a state such as "growing", don't use enabled: have the label function return different text by state and decide in onUse whether it can be used)
  - `height?: number` How high the prompt floats above the object (meters)
  - `hold?: number` Seconds the key must stay down before onUse runs (0 = a press). The engine counts it and interrupts it on release, leaving reach, enabled() false or locked input (interaction:hold / interaction:interrupt); the prompt gets progress 0-1. The op interaction.use itself is the completed use
  - `approach?: boolean` Walk the player there first (walkTo, stops 1.2 m away), then use it; with radius: Infinity it can be used from anywhere (point-and-click)
  - `once?: boolean` Hide the object after a use and allow no second one (onUse returning { ok: false } leaves it). Saved under id, else the object's name; development throws when it has neither
  - `counter?: string` Name of a HUD counter each use adds 1 to (hud.add; nothing without hud()). Saved
