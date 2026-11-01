# Environment lighting

The engine gives the mechanism and sets nothing: `scene.environment` is `null` until a style pack or the game asks for one, so the plain low-poly
Lambert look is unchanged. The background (the sky dome or `sky.skybox`) and the environment lighting are two separate fields.

```js
engine.look.env.replace('sky');                                  // lit by the procedural sky; follows the time of day
engine.look.env.set({ intensity: 0.8 });
engine.look.env.replace('hdr/studio.hdr'); engine.look.env.set({ intensity: 1, rotation: Math.PI / 2 });   // an HDR / panorama asset (equirectangular)
engine.look.env.set({ intensity: 0.5 });                  // fields given change, the rest stay
engine.look.env.replace(false);                           // off, GPU memory released
engine.sky.environment;                                         // { source, intensity, rotation, interval, builds } or null
```
A pack gives defaults in `sky.environment` (same fields, plus `low`), the game overrides with `sky({ environment: {...} })` or at run time with
`look.env.replace(...)` / `look.env.set(...)`. `low: false` turns it off on low-tier devices; any other `low` object replaces fields there.

## Sources
- `'sky'`: the dome is rendered into a cube and prefiltered with `PMREMGenerator`. It is rebuilt only when the sky colors, sun direction or cloud
  cover actually changed AND at least `interval` seconds (default 1, low tier 4x) passed since the last check, never every frame. A fixed time of
  day builds once. The first build waits for the first frame so it uses real colors. With `sky.skybox` use the skybox asset name as `source`.
- an asset name or path: `.hdr` loads through three's `HDRLoader` (float, linear), `.jpg` / `.png` / `.ktx2` as ordinary textures. The asset system
  owns the texture; the engine owns only the prefiltered copy and disposes it on `look.env.replace(false)`, on a new source and on `engine.dispose()`.
- The cube is at least 256 px per face (PMREMGenerator's floor in 0.187), so a low tier saves time by rebuilding less often or by turning it off, not
  by a smaller cube.

## What a MeshLambertMaterial does with it (three 0.187 source, not memory)
- `WebGLPrograms` hands `scene.environment` to Standard, Lambert and Phong materials; a Lambert material without its own `envMap` uses the PMREM path.
- `lights_fragment_maps` adds the shader function getIBLIrradiance = PI x (the blurriest PMREM mip in the direction of the world normal) x intensity to the
  diffuse light. So Lambert gets soft, direction-dependent ambient light colored by the environment (sky blue from above, ground color from below).
- No specular: the cube reflection mix in `envmap_fragment` only runs for `ENVMAP_TYPE_CUBE`, not for a PMREM map. Lambert surfaces never get
  reflections from the scene environment (use a Standard / Physical material for that).
- Intensity is `scene.environmentIntensity`, direction offset is `scene.environmentRotation` (Y only here).
- The hemisphere light stays and adds on top. When you turn the environment on, lower the ambient column of `sky.keyframes` (or
  `sky.modify('env', { ambient: 0.5 })`, [recipe 52](52-look.md#skymodify-vs-looklights)) so shadows do not wash out.
- The first frame with an environment recompiles every Lambert program once (the program key gains the env map); do it at start-up, not mid-game.
- Toon, Basic and ShaderMaterial surfaces ignore it.
