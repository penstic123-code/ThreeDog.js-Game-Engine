# Environment lighting

The engine gives the mechanism and sets nothing: `scene.environment` is `null` until a style or the game asks for one, so the default look
(lit by the sun and hemisphere lights only) is unchanged. The background (the sky dome or `sky.skybox`) and the environment lighting are two separate fields.

```js
engine.look.env.replace('sky');                                  // lit by the procedural sky; follows the time of day
engine.look.env.set({ intensity: 0.8 });
engine.look.env.replace('hdr/studio.hdr'); engine.look.env.set({ intensity: 1, rotation: Math.PI / 2 });   // an HDR / panorama asset (equirectangular)
engine.look.env.set({ intensity: 0.5 });                  // fields given change, the rest stay
engine.look.env.replace(myPmremTarget);                  // your own map: a PMREM target / texture is used as is, a Texture (equirect) or CubeTexture is prefiltered; never disposed by the engine
engine.look.env.replace(false);                           // sky map off, GPU memory released; the room map of look.lights env.share (under a sky; env.intensity without one, 0 = none) is back
engine.sky.environment;                                         // { source, intensity, rotation, interval, builds } or null
```
A pack gives defaults in `sky.environment` (same fields, plus `low`), the game overrides with `sky({ environment: {...} })` or at run time with
`look.env.replace(...)` / `look.env.set(...)`. `low: false` turns it off on low-tier devices; any other `low` object replaces fields there.
Removing a game layer (`h.remove()`) falls back to the pack's env, and with none to the render baseline's neutral room map (`look.lights` `env.share` of the ambient under a sky, `env.intensity` without one; 0.5 under every pack), not to no environment; a pack that wants none sets `env.share: 0` and `env.intensity: 0`.

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
  `engine.mod('look.lights.hemi.intensity', { owner: 'env', mul: 0.5 })`, [recipe 52](52-look.md#how-look-values-stack)) so shadows do not wash out.
- The first frame with an environment recompiles every Lambert program once (the program key gains the env map); do it at start-up, not mid-game.
- Toon, Basic and ShaderMaterial surfaces ignore it.

## Light probes (baked indirect light)
An environment map lights everything as seen from one point. Light probes record how the light changes from place to place (a colored glow beside
a bright wall, dimmer light under a roof) and feed it to the same lit materials, with no shader of their own.
```js
const probes = await engine.bakeProbes({ bounds: { min: [-30, 0, -30], max: [30, 8, 30] }, spacing: 4, include: o => !o.userData.moving });
const file = JSON.stringify(probes.toJSON());                 // ship this; at start-up engine.loadProbes(json) replaces the bake
const shipped = engine.loadProbes(json, { follow: engine.player.root });   // follow: 'focus' (default) | 'camera' | an Object3D | () => position | false
probes.sample(cart.position, cartProbe);                      // the SH at any point, into a LightProbe of your own
probes.remove();
```
- What it builds: a grid over `bounds` (step at most `spacing`; `height: 1.5` instead gives one layer that far above the ground), one cube render
  per point turned into spherical harmonics by three's `LightProbeGenerator`, and one scene `LightProbe` whose SH is interpolated at the `follow`
  point every frame. `probes.probe` is that LightProbe; its `intensity` is yours (three's default 1). Writing its `sh` yourself takes it over
  (the engine yields; `look.lights.manual('probes')` says so first).
- The probe light adds to the hemisphere light and the environment, which the bake also saw: lower those yourself where the probes take over.
- One SH for the whole scene at a time: objects far from the follow point get that point's light. For per-object light, feed your own probes
  from `sample(pos)`.
- Cost: 6 renders and a GPU read back per probe, at load time (one probe at a time, so the page keeps drawing; `probes.bakeMs` says how long).
  Bake once and ship the JSON. Meshes `include` rejects are hidden only while each cube renders; no render target is left afterwards.
- Check it: `engine.describe().render.probes` (count, step, source, owner, follow, writer) and `engine.debug.view('probes')` (a dot per probe in its average color).
