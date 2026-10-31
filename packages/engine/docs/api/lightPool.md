# engine.lightPool — lightPool(opts?: LightPoolOptions)

Light pool: many light sources, a fixed number of real lights (lightPool() module)

- Options `LightPoolOptions`:
  - `point?: number` Real PointLights, default 8
  - `spot?: number` Real SpotLights, default 0 (sources added with type: 'spot' use them)
  - `shadows?: number` How many of the point lights cast shadows, default 0; only sources added with castShadow: true get them
  - `every?: number` Seconds between choosing which sources get the lights, default 0.1 (fading and following run every frame)
  - `fade?: number` Seconds a light takes to fade in or out when it moves to another source, default 0.3
  - `focus?: PositionLike | null` Measure distance from this object / position instead of the camera (e.g. the player in a top-down game)

## Methods and properties
- `lightPool.add(position: PositionLike, opts?: LightSourceOptions) → LightSource` — Register a light source at a position (an Object3D: it follows that object every frame). Example: `const torch = engine.lightPool.add(torchMesh, { color: 0xffa040, intensity: 4, distance: 8, glow: haloSprite }); torch.set({ intensity: 0 });   // put out: its light goes to another torch`
- `lightPool.usage() → LightPoolUsage` — What the pool is doing now (also in describe().lightPool)
- Properties:
  - `lights: Object3D[]` The real three.js lights, created once at install and never added, removed or hidden (the pool sets their position, color, intensity)
  - `focus: PositionLike | null` Distance is measured from this object / position; null = the camera

## Data structures
- **LightSourceOptions** Options of lightPool.add(position, opts): one light source (a torch, lamp, campfire, muzzle flash...)
  - `name?: string` Name shown in lightPool.usage()
  - `type?: 'point' | 'spot'` 'point' (default) or 'spot' (needs lightPool({ spot: n }))
  - `color?: ColorLike` Light color, default white
  - `intensity?: number` three.js intensity at full strength, default 1; 0 = off (it gives its light away)
  - `distance?: number` three.js light distance (range, meters), default 10; also the scale of the distance score
  - `decay?: number` three.js decay, default 2
  - `priority?: number` Weight in the choice, default 1: 3 = picked over a 1 three times as bright at the same distance (a quest lamp, a muzzle flash)
  - `castShadow?: boolean` May take one of the shadow-casting lights (lightPool({ shadows })), default false; fixed when added
  - `angle?: number` Spot cone half-angle (radians), default PI / 4
  - `penumbra?: number` Spot penumbra 0-1, default 0.3
  - `target?: PositionLike | null` Spot aim: a position or an Object3D it follows; default straight down
  - `flicker?: ((time: number, index: number) => number) | null` Brightness factor each frame (time = presentation seconds, index = the source's number): (t, i) => 0.85 + 0.15 * Math.sin(t * 13 + i)
  - `glow?: Material | Object3D | null` Stand-in shown while the source has no real light: a halo Sprite / Mesh (its material's opacity) or an emissive material (emissiveIntensity) scaled from its value at add() down to 0 as the real light fades in. Give each source its own material
- **LightSourcePatch** What lightPool.add().set(patch) can change (type and castShadow are fixed when added)
  - `position?: PositionLike` New position, or an Object3D to follow
  - `name?: string`
  - `color?: ColorLike`
  - `intensity?: number`
  - `distance?: number`
  - `decay?: number`
  - `priority?: number`
  - `angle?: number`
  - `penumbra?: number`
  - `target?: PositionLike | null`
  - `flicker?: ((time: number, index: number) => number) | null`
  - `glow?: Material | Object3D | null`
- **LightSource** Handle returned by lightPool.add()
  - `light: Object3D | null` The real light lighting this source now, null while it has none
  - `weight: number` How much of its light it has now, 0-1
  - `set(patch: LightSourcePatch) → LightSource` — Change the source; returns the same handle
  - `remove()` — Unregister: its light fades out and moves on, the stand-in is put back (safe to call twice)
- **LightPoolUsage** lightPool.usage(): what the pool is doing now
  - `sources: number` Registered sources
  - `lit: number` Real lights lighting a source now
  - `slots: { type, shadow, source, weight }[]` One per real light: its kind, whether it casts shadows, the source it holds (name or number, null = idle) and its fade 0-1
