# engine.swarm — swarm()

(experimental) Makes a swarm of same-kind gameplay objects (swarm() module): engine.swarm({ name, capacity, geometry, material, fields })


## Methods and properties

## Data structures
- **SwarmOptions** Options of engine.swarm(). See recipes/65-swarm.md
  - `name: string` Unique name: shown in describe(), the key in a save
  - `capacity: number` Most objects alive at once; all memory is taken up front
  - `geometry?: import('three').BufferGeometry` Plain three.js geometry, stays the game's to dispose. Leave out with material for a swarm that draws nothing
  - `material?: import('three').Material` Plain three.js material, stays the game's to dispose
  - `fields?: string[]` Number columns beside x, y, z. yaw, pitch, roll (radians, order YXZ) and scale are also drawn by the engine
  - `color?: boolean` Per-object colour: columns r, g, b (linear) and spawn({ color: 0xff8800 })
  - `channel?: string` Time channel of the onStep dt (default 'world')
  - `cell?: number` Grid cell for near, in meters: about the usual query radius (default 2)
  - `save?: boolean` Keep this swarm in saves; otherwise it is empty after a load or new game
- **Swarm** One swarm: what engine.swarm(options) returns. See the top of modules/swarm/Swarm.js for the handle / row rule
  - `name: string` Name given to engine.swarm
  - `capacity: number` Most objects alive at once
  - `channel: string` Time channel of the onStep dt
  - `saved: boolean` Whether this swarm is kept in saves
  - `dropped: number` Spawns refused because the swarm was full, since it was made
  - `data: SwarmData` The columns: data.x[row], data.y[row], data.z[row] (Float32Array), one Float64Array per field, so a field can hold a handle, and data.id[row], the handle of that row (Float64Array). Rows 0 to count - 1 are live. The same object onStep and near pass as d
  - `mesh: THREE.InstancedMesh | null` The swarm's plain THREE.InstancedMesh (null when made without geometry and material); instance index = row. castShadow, layers and the rest are yours
  - `count: number` Objects alive now
  - `spawn(o?: Record<string, number>) → number` — Add one object. Fields left out start at 0 (scale at 1, colour at white). Returns its handle, or -1 when the swarm is full: the object is not added, dropped goes up, and one [swarm-full] warning is printed. May be called from onStep and near callbacks; an object spawned there first moves in the next step. Example: `const h = bullets.spawn({ x: 0, y: 1, z: 0, vx: 8, life: 2 });`
  - `row(handle: number) → number` — Where a handle's object sits now, or -1 if it is gone. A row is good until the next removal outside a callback: read it, use it, drop it. Example: `const i = enemies.row(target); if (i >= 0) aim(enemies.data.x[i], enemies.data.z[i]);`
  - `free(handle: number) → boolean` — Remove an object by handle: d.id[i] inside a callback. False if it was already gone (safe to call twice; -1 from a full spawn too). A row passed by mistake throws [swarm-handle]. Inside onStep and near the object counts as gone at once (near and row skip it) and rows only move when the walk ends. Example: `enemies.near(x, z, 2, (d, i) => { enemies.free(d.id[i]); });`
  - `onStep(fn: SwarmRowFn) → { remove(): void }` — Set the one function that moves this swarm: fn(d, i, dt) for each live row, every fixed step, dt on the swarm's channel. Return false to remove the object; anything else keeps it. Returns a handle: h.remove() takes it off. Set it once at setup, not every step (a second one while one is set throws [swarm-step]). Example: `bullets.onStep((d, i, dt) => { d.x[i] += d.vx[i] * dt; return (d.life[i] -= dt) > 0; });`
  - `near(x: number, z: number, r: number, cb: (d, i, dist2) => (boolean | void)) → number` — Visit the live objects within r meters of (x, z), height ignored: cb(d, i, dist2) with the row and the squared distance; cb returning false stops early. Returns how many were visited. The grid is built on the first query after things moved, so a swarm nobody queries pays nothing. Order is the same every run. Example: `const hit = enemies.near(px, pz, 0.5, (d, i) => { enemies.free(d.id[i]); return false; });`
  - `clear()` — Remove every object (their handles die for good). Inside a callback it applies when the walk ends
  - `dispose()` — Remove this swarm: its mesh leaves the scene and its GPU buffers go. Geometry and material stay, they are the game's. The name is free again
