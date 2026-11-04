# Environment lighting

`scene.environment` is plain three.js and stays `null` until your code writes it. The background (the sky dome or a skybox) and the environment lighting are two separate fields.

```js
const env = engine.sky.environment({ into: engine.scene });   // the sky as a map: follows the time of day; env.texture is the live map
engine.scene.environmentIntensity = 0.8;                      // intensity and rotation are three.js
engine.scene.environmentRotation.y = Math.PI / 2;
env.remove();                                                 // takes the map off, frees it
// an asset panorama: plain PMREMGenerator
const pmrem = new THREE.PMREMGenerator(engine.renderer);
engine.assets.useTexture('hdr/studio.hdr', t => { t.mapping = THREE.EquirectangularReflectionMapping; engine.scene.environment = pmrem.fromEquirectangular(t).texture; });
// a PMREM result of your own is used as it is
engine.scene.environment = myPmremTarget.texture;
```
On `renderer: 'webgpu'` take `PMREMGenerator` from `three/webgpu`. A map you made is yours to dispose.

## The sky as a map: `engine.sky.environment({ into?, interval? })`
- Nothing is built before this call. Without `into` nothing is written anywhere: read `handle.texture` (a live getter) and put it on the materials you choose (`material.envMap`).
- With `into`, that object's `.environment` gets the map at each rebuild. A map you write there yourself stays: the rebuilds go on, but only `handle.texture` follows them.
- The dome is rendered into a cube and prefiltered with `PMREMGenerator`. It is rebuilt only when the sky colors, sun direction or cloud
  cover actually changed AND at least `interval` seconds (default 1, 4 times longer on a low-tier device) passed since the last check, never every frame. A fixed time of
  day builds once. A call before the first frame waits for that frame, so the map uses real colors.
- The cube is at least 256 px per face (PMREMGenerator's floor in 0.187), so a low tier saves time by rebuilding less often, or by your `picture/` code skipping the call on `engine.tier === 'low'`.
- An asset map is a fixed photo: it does not dim at night. Write `scene.environmentIntensity` from your own frame code reading `engine.uniforms.uDaylight`.

## What a MeshLambertMaterial does with it (three 0.187 source, not memory)
- `WebGLPrograms` hands `scene.environment` to Standard, Lambert and Phong materials; a Lambert material without its own `envMap` uses the PMREM path.
- `lights_fragment_maps` adds the shader function getIBLIrradiance = PI x (the blurriest PMREM mip in the direction of the world normal) x intensity to the
  diffuse light. So Lambert gets soft, direction-dependent ambient light colored by the environment (sky blue from above, ground color from below).
- No specular: the cube reflection mix in `envmap_fragment` only runs for `ENVMAP_TYPE_CUBE`, not for a PMREM map. Lambert surfaces never get
  reflections from the scene environment (use a Standard / Physical material for that).
- Intensity is `scene.environmentIntensity`, direction offset is `scene.environmentRotation` (Y only here).
- The hemisphere light stays and adds on top. When you turn the environment on, lower your hemisphere light so shadows do not wash out.
- The first frame with an environment recompiles every Lambert program once (the program key gains the env map); do it at start-up, not mid-game.
- Toon, Basic and ShaderMaterial surfaces ignore it.

## Light probes (baked indirect light)
An environment map lights everything as seen from one point. Light probes (`engine.bakeProbes`) record how the light changes from place to place (a colored glow beside
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
  (the engine yields; `probes.own()` says so first, `probes.own(false)` gives it back).
- The probe light adds to the hemisphere light and the environment, which the bake also saw: lower those yourself where the probes take over.
- One SH for the whole scene at a time: objects far from the follow point get that point's light. For per-object light, feed your own probes
  from `sample(pos)`.
- Cost: 6 renders and a GPU read back per probe, at load time (one probe at a time, so the page keeps drawing; `probes.bakeMs` says how long).
  Bake once and ship the JSON. Meshes `include` rejects are hidden only while each cube renders; no render target is left afterwards.
- Check it: `engine.describe().render.probes` (count, step, source, owner, follow, writer) and `engine.debug.view('probes')` (a dot per probe in its average color).
