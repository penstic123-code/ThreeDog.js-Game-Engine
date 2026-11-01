# engine.vegetation — vegetation(opts?: VegetationModuleOptions)

Vegetation (vegetation() module; grows on terrain or on any ground provider)

- Options `VegetationModuleOptions`:
  - `chunkSize?: number` Chunk edge (meters), default 32
  - `viewChunks?: number` Rings of chunks drawn around each stream source, default 3
  - `density?: number` Placement attempts multiplier, default 1
  - `area?: { min: number[]; max: number[] } | null` Where it may grow: { min: [x, z], max: [x, z] }; default anywhere the ground is
  - `seed?: number` Placement seed, default 1

## Methods and properties
- `vegetation.rebuild()` — Place every chunk again: after changing the ground behind the same provider (a ground function reading game state). A new setGround or level is followed automatically
- `vegetation.setShadowRing(name: string, ring: number)` — Change at runtime how far a vegetation kind casts shadows: within `ring` chunk rings of the player (0 = only the chunk you stand in, 1 = the default, larger = further and dearer). Takes effect at once; the add() option shadowRing is only the starting value. An unknown name warns with the known ones. Example: `engine.vegetation.setShadowRing('tree', 0);   // graphics setting "shadows: low": trees shadow only the nearest chunk`
- `vegetation.add(name: string, opts: VegetationOptions) → Species` — Register a kind of vegetation
- `vegetation.removeInstance(species: string, cx: number, cz: number, id: number, opts?: { regrowSeconds?: number }) → string` — Remove one (chop a tree). regrowSeconds: grows back after this many game seconds, 0 = permanent. The record is saved with the save (save key 'vegetation'). Returns the entry name
- `vegetation.restoreInstance(species: string, cx: number, cz: number, id: number)` — Restore one
- `vegetation.instanceAt(position: PositionLike, opts?: { radius?, species? }) → VegetationHit | null` — The one nearest to position within radius meters (default 2) (species restricts to one kind), null if none
- Also: `vegetation.get(name: string) → Species | undefined`, `vegetation.list() → Species[]`, `vegetation.isRemoved(species: string, cx: number, cz: number, id: number) → boolean`

## Data structures
- **VegetationOptions** Parameters of engine.vegetation.add(name, {...})
  - `geometry?: BufferGeometry` High-detail model (this or model is required)
  - `model?: Object3D` Multi-material model (one material per mesh, e.g. bark trunk + leaf cards); still one InstancedMesh per species. Its materials are cloned
  - `lodGeometry?: BufferGeometry | Object3D` Low-detail model, switched to beyond lodRing rings; with model an Object3D with the same mesh order, or a geometry drawn with the first material
  - `rule?: VegetationRule` Placement rule
  - `wind?: number` Wind sway amplitude, 0 = still
  - `nearOnly?: boolean` Only generated near the player (grass, flowers)
  - `maxRing?: number` No longer drawn beyond this many rings
  - `fade?: false | { start?: number; end?: number }` Distance fade of a near-only species (grass, flowers, pebbles, debris ...): instances shrink out over a band in metres from the player instead of popping per chunk at the ring edge. Default for nearOnly: end = maxRing x chunk size, start = 65% of it. `false` keeps the hard ring edge (also the default for species that are not nearOnly).
  - `lodRing?: number` Switch to the low-detail model beyond this many rings, default 1
  - `castShadow?: boolean` Cast shadows
  - `shadowRing?: number` Cast shadows within this many rings
  - `receiveShadow?: boolean` Receive shadows, default true
  - `material?: Material` Custom material, any three.js material (default: the style pack's 'vegetation' role); wind, cloud shadows and season tint are added to it
  - `effects?: boolean` false: leave a custom material untouched (no wind / clouds / season added)
  - `doubleSided?: boolean` Double-sided rendering
- **VegetationRule** Vegetation placement rule (must be JSON-able, no functions)
  - `perChunk?: number` Placement attempts per chunk, default 100
  - `chance?: number` Success probability of each attempt 0–1 (when cluster is 'none'), default 1
  - `minHeight?: number` Altitude range (meters); default unlimited both ways (a terrain game names its band above the water, e.g. minHeight: 1.5)
  - `maxHeight?: number`
  - `maxSlope?: number` Max slope
  - `cluster?: 'forest' | 'meadow' | 'none'` Clustering: 'forest' grows into woods / 'meadow' grows in open ground / 'none' even
  - `scale?: number[]` Size range [min, max] multiplier
  - `stretch?: number[]` Height stretch [min, max] multiplier
  - `sink?: number` How deep to bury into the ground (meters, multiplied by size)
  - `tintJitter?: number` Random color jitter 0–1
  - `tints?: { color: number[]; chance: number }[]` Special color: color [r, g, b] multiplier, chance probability
  - `biomes?: Record<string, number> | null` Which ground types it grows on: { type: probability 0–1 } (engine.groundType: a terrain groundType, a level mesh's groundType property or material name); omitted = grows anywhere
  - `collider?: number` Collision circle radius (meters, multiplied by size), 0 = no collision
  - `avoidFlat?: boolean` Avoid flattened plots (villages), default true
  - `salt?: number` Random seed offset (default computed from the name)
