# engine.particles — particles()

Particles (particles() module)


## Methods and properties
- `particles.define(name: string, opts?: ParticleOptions) → ParticleEffect` — Define an effect (same name replaces it, and emitters attached to it move to the new definition); params sit on top of the style pack preset. Returns the effect object: .points is its THREE.Points, .material is the shader material
- `particles.has(name: string) → boolean` — Whether this effect has been defined
- `particles.emit(name: string, position: PositionLike, opts?: { count?, overrides? })` — Burst: emit count particles at once (default 10) at position (Vector3 / Object3D / [x, y, z] / {x, y, z}). overrides affect this batch only (color, speed, direction...; max/texture/blending cannot be changed temporarily)
- `particles.attach(name: string, object3d: THREE.Object3D, opts?: { rate?, offset?, overrides? }) → ParticleEmitter` — Keep emitting while following an object: rate per second, offset in the object's local coordinates [x, y, z] (meters). Returns a handle { remove(), rate, active } (active = false pauses)
- `particles.count(name?: string) → number` — Live particle count (no name = all)
- `particles.clear(name?: string)` — Clear one effect's (or all) particles
- Properties:
  - `effects: Map<string, ParticleEffect>` Defined effects

## Data structures
- **ParticleOptions** Particle effect parameters (style.particles[name] of the style uses the same format too). All optional
  - `max?: number` Maximum alive at once, default 120 (halved on low-end devices)
  - `lifetime?: Range` Seconds each particle lives [min, max]
  - `rate?: number` Default particles per second for attach
  - `speed?: Range` Initial speed (m/s) [min, max]
  - `direction?: number[]` Emission direction [x, y, z]
  - `spread?: number` Maximum angle away from the direction (radians, π = all directions)
  - `area?: number | number[]` Radius of random spread around the spawn point (meters), or a box [x, y, z]
  - `gravity?: number` Vertical acceleration (m/s², negative falls)
  - `drag?: number` Air drag (fraction of speed lost per second)
  - `wind?: number` How much wind affects it
  - `windDir?: number[]` Wind direction [x, y, z]
  - `size?: Range` Size at birth / at death (meters)
  - `color?: ColorLike | ColorLike[]` Color at birth / at death (one color, or [birth, death]; an array, not a tuple, so a plain JS literal [0xffffff, 0xdddddd] type-checks)
  - `opacity?: Range` Opacity at birth / at death, 0–1
  - `texture?: string | Texture | null` Texture (asset name, path or THREE.Texture); a soft round dot if omitted
  - `blending?: Loose<'normal' | 'additive'>` 'normal' / 'additive' (glowing blend, for sparks)
  - `spin?: number` Texture rotation speed (radians/second)
  - `worldSpace?: boolean` With attach, whether particles stay in the world (true) or the emission direction rotates with the object (false)
  - `fog?: boolean` Affected by fog, default true
  - `maxPixels?: number` Largest on-screen size of one particle in pixels (smoke drifting past the camera stays bounded), default 512
- **ParticleEmitter** (extends Handle) Continuous emitter returned by attach() (a handle)
  - `rate: number` Particles per second (can be changed at any time)
  - `active: boolean` false pauses
  - `remove()` — Stop and remove (also removed automatically when the object leaves the scene)
