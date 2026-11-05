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
  cover actually changed AND at least `interval` seconds (default 1, 4 on a low-tier device; a number the game gives stands) passed since the last check, never every frame. A fixed time of
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
a bright wall, dimmer light under a roof), and every lit pixel takes its own light from the grid, on WebGL and WebGPU, with no shader of your own.
```js
const probes = await engine.bakeProbes({ bounds: { min: [-30, 0, -30], max: [30, 8, 30] }, spacing: 4, include: o => !o.userData.moving });
const file = JSON.stringify(probes.toJSON());                 // ship this (half precision, a few tens of KB)
const shipped = engine.loadProbes(json);                      // at start-up, instead of the bake; either renderer reads either renderer's file
probes.sample(cart.position);                                 // the SH at any point, for a "how dark is it here"
probes.remove();
```
- What it builds: three's probe grid over `bounds` (`LightProbeGridWebGL` or `LightProbeGrid`; step at most `spacing`, at least 2 layers per axis), in the scene as
  `probes.grid`, a plain three.js light: `priority` and `visible` are yours; `intensity` works on WebGPU only, three's WebGL shader ignores it. The light costs almost nothing per frame.
- **Outside the grid there is no probe light**, and with no other ambient light a mesh goes black there. The light reaches half a step past `bounds`, so a roof on the edge is fine.
  Size `bounds` to where things are.
- **Light counted twice**: the bake saw the hemisphere light and the environment, and they still add at run time. Lower them where the probes take over, or bake without them.
  A `material.lightMap` inside the grid doubles the same way. A warning says so when the set is added, and describe keeps saying it.
- Dark bake indoors: `scene.background` is a display color, far weaker than the sun, so a room lit by the sky comes out black. Raise the sky just for the bake
  (a brighter `scene.background` or `backgroundIntensity`, put back after), and keep a little fill for walls that face away from every window.
- Cost: 6 renders per probe at load time, a few probes per task, so the page keeps drawing (`probes.bakeMs` says how long). Bake once and ship the JSON: phones often cannot bake, but
  they all read the file. Meshes `include` rejects are hidden only while the cubes render. Adding a grid recompiles lit materials once, so do it at start-up.
- Check it: `engine.describe().render.probes` (count, step, source, owner, `outside`: lit objects the grid does not hold, `doubled`: what counts twice) and `engine.debug.view('probes')` (a dot per probe in its average color).

## Lightmaps (baked light on what never moves)
The best-looking baked light, and free at run time: it is plain `material.lightMap` on a second UV set, so a file baked on WebGPU draws the same on WebGL. Baking needs a real GPU and Google Chrome on the machine that bakes, not on the player's.
```js
floor.userData.static = true; wall.userData.static = true;   // named meshes that never move
// npx threedog bake light --page "/?bake=1" --out public/light/level.lightmap --size 1024
const baking = new URLSearchParams(location.search).has('bake');  // the bake must see the lights the map replaces
if (!baking) {
  const light = await engine.loadLightmap('light/level.lightmap');   // once the level is built
  hemi.visible = false;                                              // the bake saw it: keep the sun, drop the ambient
}
floor.material.lightMapIntensity = 1.2;                            // plain three.js, yours
```
- What is baked: sky and bounced light, by rays traced from every lightmap texel through the static meshes, so light stops at walls and a pillar shades what stands behind it. The sun stays real-time where it lands, so moving things keep their shadows, and its bounce is in the map. The game's hemisphere or ambient light is the sky during the bake, at the same strength: an open floor comes out as bright as under that light.
- Turning the ambient off: a line that sets `intensity` once is lost if picture code writes it every frame, as the template's `picture/lights.js` does. So hide the light (`visible = false`, which that code leaves alone) or change it where it is written. Do it behind a URL flag as above, not in the palette: with the ambient gone for good, the next bake sees no sky. A bake that sees no light at all stops and writes nothing.
- Instanced and skinned meshes and anything moving cannot hold a lightmap: give them `engine.bakeProbes`. A grid also lights the baked meshes, so where the two overlap the light doubles; keep the grid's `bounds` to where the moving things go, or turn `lightMapIntensity` down.
- Files are large: half precision, 8 MB at 1024, 32 MB at 2048, before the server's compression. Start small.
- Check it: `engine.describe().render.lightmap` lists `skipped` (instanced), `missing` (not found, or changed since the bake: bake again), `moved`, `doubled` (ambient light or a grid on top) and `shared` (an unbaked mesh on a baked material: give it its own).
- WebGPU and TSL: nothing changes. `material.lightMap` is read by node materials too, so there is no separate form.

## Real-time bounced light (WebGPU games only)

Bake first when the scene holds still: probes and lightmaps match it and cost nearly nothing. Real-time bounce is for light that changes while the world stands: a sun that moves, a lamp the player carries, a door that lets a room fill. It needs `renderer: 'webgpu'` chosen when the game starts, and three's real WebGPU backend; there is no WebGL version.

```js
import { voxelGI, temporalAA } from '@threedog/post-effects/tsl';
engine.post.add(voxelGI({ bounds: new THREE.Box3(min, max), intensity: 1 }));
engine.post.add(temporalAA());   // clears the dots; it replaces MSAA while it is on
```

- `bounds` is the world box to voxelize. Keep it tight: the same voxels spread over a town are too coarse for a room. `describe().render.post` gives `voxelSize`; judge it against the smallest thing that should throw color.
- Lights can move every frame. Geometry cannot: moving things go outside the volume (`setup: gi => gi.volume.layers...`), and a rare change (a wall falls) calls `gi.needsUpdate = true`, a stall of many milliseconds.
- It bounces direct light only, so sky light stays yours: a low hemisphere or environment light, judged by eye once the bounce is on. How to judge: a colored wall should tint what stands next to it, and a sunlit floor should lift the ceiling, without the shadows turning flat. A cartoon look may want one soft bounce; a realistic interior wants more with less fill.
- Changing any post effect (add, remove, on / off, a setting that rebuilds) rebuilds the chain, and that voxelizes the scene again: a stall. Set the chain at a scene change, not during play.
- `occlusion` (0 to 1) darkens corners from the voxels. It darkens direct light too, which is why it starts at 0.
- It costs real frame time on weak GPUs, so it declares `skipOnLowTier` and is held off on `engine.tier === 'low'`. It is also held on a device that fell back from WebGPU and under `forceWebGL: true`. Nothing breaks, `describe().render.post` says `held` and why, so give those players probes or a lightmap as the base. A game that chose `WebGLRenderer` gets a named error instead, as for the other effects of this page.
- Does not work: metal gets a diffuse bounce instead of a reflection; anything moving is not in the bounce; transparent things are not handled; one volume does not cover a big open world.

What runs where, for the four effects above (`voxelGI`, `temporalAA`, `sunShafts`, `lightVolumes`). Held means the game's `enabled` stays as written, the effect costs nothing, and `describe().render.post` says why:

| Case | voxelGI | temporalAA, sunShafts, lightVolumes |
|---|---|---|
| Real WebGPU | runs (held on `engine.tier` 'low') | run |
| WebGL2 backend (no WebGPU in the browser, or `forceWebGL: true`) | held | run |
| Fell back to `WebGLRenderer` (`start()` found no WebGPU) | held | held |
| Game chose WebGL (`--webgl`, `WebGLRenderer`) | throws by name | throw by name |

## Light you can see in the air

Pick by the light. These two are WebGPU only; a WebGL game keeps the depth haze of recipe 59.

```js
import { sunShafts, lightVolumes } from '@threedog/post-effects/tsl';
engine.post.add(sunShafts({ light: engine.lights.sun }));                // sun through gaps
engine.post.add(lightVolumes({ bounds: new THREE.Box3(min, max) }));    // spot cones, point glows
```

- `sunShafts` (three's `GodraysNode`) marches the sun's shadow map, so the sun and whatever makes the gaps must cast shadows. It is made for air that is mostly in shadow: a room with a window, a forest. In open daylight every pixel of air is lit and it reads as haze; there, lower `density` or leave it out. Raise `density` until the beam reads against the dark behind it, and stop before the far wall washes out. A misty horror game and a clean sunny one will end far apart.
- `lightVolumes` (three's `VolumeNodeMaterial`) fills a box of air and lights it from point and spot lights, shadows included. **The sun does nothing here**, three skips lights at infinity. It is dithered, so run `temporalAA` after it. `scattering: (tsl, { positionRay, density }) => ...` gives density per point for smoke or ground fog; multiply by `uniforms(engine).uWeatherFog` from `threedog/tsl` to follow the weather.
- Does not work: shafts from more than one light at once, cones through transparent glass, and either effect on WebGLRenderer (`engine.post.add` throws by name there). If you need crisp sun beams in open air, a spot light aimed along the sun with `lightVolumes` gives a shaft you can place by hand.

## Occlusion culling

`engine.occlusion.enabled = true` skips the engine's big things while something hides them: hlod cells and `engine.batching` groups. Works on both renderers. Ordinary objects are not watched. Turn it on only when heavy things stand behind others (a walled town, a building full of rooms). In a scene of many small things it is a loss: each box costs CPU, more so on WebGPU. Measure with `describe().render.occlusion` (`hidden`, `trianglesSkipped`) and the frame time, on and off.

- Three things share the word occlusion and are separate: occlusion culling (this section) skips drawing what is hidden; camera occlusion (`cameraOcclusion` of `collision()`, recipe 21) moves the camera so a wall does not stand between it and the player; `voxelGI`'s `occlusion` only darkens corners of its bounced light.
- Hidden things stay in shadows, in `engine.rays` and in `voxelGI`'s volume, and `visible` stays yours. Nothing else sees them while hidden: a second camera of yours and a `THREE.Raycaster` of your own do not (their layers lack it; enable `RESERVED_LAYERS.occlusionHidden` from `threedog/layers` if they must).
- **Step mode hides nothing.** The answers arrive over drawn frames, so under `threedog step` / `engine.step()` (no real frames) `hidden` stays 0 and `inspect perf` counts every draw (about double a real-time run in one test). Judge occlusion with `threedog resume` and real time, never from a step-mode reading.
- Answers come a few frames late. Camera moves and cuts are covered. A big occluder that moves fast (a falling wall, a gate thrown open) can show a gap of a few frames.

