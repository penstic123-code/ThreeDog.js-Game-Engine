# Write three.js; the engine adopts it

The scene, camera, lights, characters and models in the engine are **plain three.js objects** (three 0.187). Write the three.js you already
know: what the engine can see, it plugs in with no extra call. Only where it cannot know your intent do you write one line.
Picture work (materials, shaders, textures, lights, post passes) always take this route first; engine picture features are optional conveniences on top.
This is the one place that order is stated: a material is `new THREE.*Material` / `ShaderMaterial` before a slot patch, a post
pass is a three.js Pass (`engine.post.add(pass)`) before a ready-made effect.

| You write (plain three.js) | The engine does | The one line, only when you mean it |
|---|---|---|
| `engine.scene.add(obj)` / `group.add(obj)` | registers each root under the scene like `engine.add`: `engine.thing`, `describe().scene`, `thing.set` / `thing.remove` | a stable id so a save finds it: `engine.add(obj, { id: 'mill' })` |
| `new THREE.PointLight(...)` / `SpotLight` added to the scene | a real light, adopted as a thing; counted by `engine.budget` `lights` / `shadowLights`, listed in `describe().render.lights`; a casting light at intensity 0 stops redrawing its shadow map; weather and day-night leave its values alone | many sources, few real lights: `lightPool` (recipe 52) |
| `new THREE.MeshStandardMaterial(...)` | scene fog (height fog too), cascaded shadows | wind sway: `applyEffects(mat, { wind: 0.03 })` |
| `engine.post.add(pass)`, the one way into the chain (the other renderer's form: recipe 56) | slots it after the scene render and before tone mapping (FXAA / SMAA last), or after tone mapping when you added it after an OutputPass; a pass that renders `engine.scene` itself (RenderPixelatedPass, SSAA, TAA) replaces the scene render, so the scene is drawn once; skips a RenderPass / OutputPass it already has; listed in `post.list()`; `remove()` leaves it undisposed | a settings name and position: `add(pass, { name: 'glow', order })`, then `engine.post.get({ glow: false })` |
| your own `EffectComposer` / `renderer.render` of the whole canvas, every frame | yields the frame (stops drawing its own, warns once `[own-frame]`); delete your render call to hand it back. A minimap / HUD layer on top (scissor, smaller viewport, or `autoClear = false` with another scene) is not a takeover | - |
| `renderer.setSize` / `setPixelRatio` yourself | the post chain follows on its next draw | - |
| `scene.fog.far = 80`, `sun.intensity = 3`, `renderer.toneMappingExposure = 1.4` | stays: the engine never writes these on its own | - |
| one file per piece in `plugins/` next to index.html (`export default mesh`, a Pass, a post effect such as `grain()`, a module; never a bare function; a Material goes on its mesh in `picture/`) | plugs each at `engine.start()` by what it exports, through the same calls as above (`scene.add`, `engine.post.add`, `engine.use`); order by file name or a `plugins.json` beside them; anything else is a `[plugin-shape]` error naming the file, what it found and the fix (a factory: `export default makeIt({ ... })`; a module with no `type`: add one) | switch one off: `plugins.json` `"off": ["20-bloom"]` or `engine.plugins.off('20-bloom')` |
| a static mesh you want `engine.pick` to hit | - | `engine.rays.addStatic(obj)` (a BVH only pays off for things that do not move) |

`describe().slots` is the one table of what is plugged in where: each row is `{ slot, plugged, file, on, affects }`, for the plugins folder,
`scene.add` roots (with the file:line that added them), `engine.post.add` effects, modules and plain lights. Without the vite preset, hand the folder over
yourself: `engine.plugins.add(import.meta.glob('./plugins/*.js', { eager: true }))` before `engine.start()`.

## What the engine changes in three.js (Global changes)
Everything else in three is untouched. Every change below is listed in `describe().threePatches` (`{ id, what, scope, on, offable, lost }`);
an offable one is undone page-wide with `threePatches.off(id)` (`import { threePatches } from 'threedog'`), call it before creating the objects
that should not see it. It is page-wide: every engine on the page loses the change, and `engine.dispose()` does not undo it (disposing one engine never touches a change another engine or library relies on). A wrapper another library put on `Object3D.prototype.add` stays when `scene-add-hook` is turned off. `lost` says what stops working; a change that cannot be undone says why and `off` throws.

| id | Change | Effect on your code | Off |
|---|---|---|---|
| `shadow-accessors` | `Mesh.prototype.customDepthMaterial / customDistanceMaterial` become accessors | Unassigned, they return a shadow material only for a mesh whose material carries a vertex-moving engine patch (wind), so its shadow sways too; otherwise `undefined` as in three. An assignment always wins | yes |
| `node-setup-position` | `NodeMaterial.prototype.setupPosition` wrapped | WebGPU only: runs the engine's vertex-moving patches (wind) first; other node materials unchanged | yes |
| `scene-add-hook` | `Object3D.prototype.add / remove` wrapped (page-wide) | None to the call itself; the engine sees what enters and leaves its scene at any depth (adopting `scene.add`, fog, cascades, cloud shadow, light counts). Another library wrapping the same methods stacks with it | yes (`scene.add` no longer adopted) |
| `mesh-material-accessor` | `material` on each object entering the engine's scene: an own get / set on that object (a class accessor, e.g. troika text, still runs) | In devtools `mesh.material` shows as an accessor; `mesh.material = other` works as in three and is seen | yes (new objects) |
| `material-compile-accessor` | `onBeforeCompile` / `customProgramCacheKey` on each material the engine patches (what applyEffects was asked for, wind, fog) | Your own hook, assigned before or after, runs first, then the engine's | yes (new materials) |
| `renderer-render` | `engine.renderer.render` (that instance only) wrapped | Counts your full-canvas draws so the engine yields the frame; a scissored / smaller-viewport / `autoClear = false` layer (minimap, HUD) does not count | yes |
| `shader-chunks` | `THREE.ShaderChunk.threedog_*` added (new names, nothing replaced) | None until you `#include` one | no (the engine's patches include them) |
| `light-idle-shadow` | `shadow.autoUpdate` of your shadow-casting point / spot lights: off while intensity is 0, back on when lit | Only lights whose autoUpdate was on; writing autoUpdate yourself hands the light back; `light.userData.idleShadow = false` opts one out; `describe().render.lights` shows `shadowIdled` | yes |
| `picture-writers` | Dev server only (absent from bundles and release builds): an own get / set on the picture values of objects in the engine's scene (light intensity / color / position, `scene.fog` and its values, tone and exposure, environment, background, material color / emissive / opacity), and on the `r g b` / `x y z` of those colors and positions | Every read and write goes through unchanged; in devtools these show as accessors. A write records who made it for `describe('picture').writers` and `engine.explain({ picture })` | yes: `threePatches.off('picture-writers')`, accessors stay and only pass values through |
| `post-shadow-hold` | `render` of the first pass of the WebGL post chain wrapped (it may be your own Pass) | None to what the pass draws; shadow maps redraw once a frame | yes |
| `post-background-tone` | `onBeforeRender` of three's own background mesh, while the engine draws straight to the canvas | A texture background is tone-mapped as it is through the post chain; your own `renderer.render` keeps three's rule | yes |
| `node-twin-dress` | `renderer.library.fromMaterial` of a WebGPURenderer wrapped | WebGPU only: the node twin of a classic material gets its patches | no (patched materials would lose their picture on WebGPU) |
| `node-builder-hook` | `renderer.debug.onNodeBuilderCreated` of a WebGPURenderer wrapped | WebGPU only: your own hook still runs; a later write of yours replaces the engine's | yes |
| `device-lost-hook` | `renderer.onDeviceLost` of a WebGPURenderer wrapped | WebGPU only: three's hook still runs; a later write of yours replaces the engine's | yes |
| `webgpu-record-sweep` | A `'dispose'` event sent to objects drawn earlier that have left every Scene for a few seconds, found through WebGPURenderer's private record list | WebGPU only: your `'dispose'` listener on such an object runs; drawing it again rebuilds its record | yes |
| `hlod-visible` | `visible` on meshes registered with `engine.hlod.add` (and their `xxx_LOD1` nodes): an own get / set | Reads "your value and not hidden far"; your writes keep your value | per handle: `remove()` |


## Getting three.js objects from the engine

| You want | Use |
|---|---|
| THREE itself | `import { THREE } from 'threedog'` or `engine.THREE` (the same copy the engine uses) |
| Scene / camera / renderer | `engine.scene`, `engine.camera` (PerspectiveCamera), `engine.renderer` (WebGLRenderer) |
| Player, NPCs | `engine.player.object`, `engine.npcs.get('name').object` (Group); position `.position` (Vector3) |
| Pickups, template instances | `pickups.spawn(...)` returns a handle with `.object` (Mesh); a template instance's model is `engine.world.view(id)` (exists only near) |
| Level | `engine.level.root`; markers `engine.level.marker('spawn').object / .position` |
| Sun, ambient light, sky dome, fog | `engine.lights.sun` (DirectionalLight), `engine.lights.hemi` (HemisphereLight), `engine.sky.dome`, `engine.scene.fog` |
| Water | `engine.water.sea` (Mesh; null when the game sets no water level), `water.material` (get / set), `water.uniforms`, `water.bodies.get(body)` |
| Particles, weather particles | `.points` and `.material` of the value returned by `particles.define(...)`; `engine.weather.particles[field].material` (the plain material of a weather field) |
| Rigid bodies | `engine.rigid.addBox(mesh)` returns a handle `{ object, body, remove() }`, or null before Rapier is ready (object is your mesh; `castShadow` / `receiveShadow` keep the values you set, the engine does not change them) |
| Terrain chunks | `engine.terrain.chunks` (Map of chunk data); a chunk's three.js objects: `engine.terrainDraw.meshes.get(chunk)` (`{ group, mesh }`) |
| Models, textures, animation | `await engine.assets.model('name or path')` (an Object3D copy), `assets.texture(...)`, `assets.animate(model).mixer` |
| Vehicles, navigation, character controller | `engine.rigid.addWheeled(mesh, ...)` returns `{ body, controller }`; `engine.nav.navMesh / query / tileCache / crowd` (they are destroyed and replaced on rebuild; code that caches them compares `engine.nav.version`); `engine.player.mover.controller` (mover: 'rapier') |
| glTF / compression decoders | `engine.assets.gltf` (GLTFLoader, Meshopt installed), `assets.draco` (DRACOLoader), `assets.ktx2` (KTX2Loader); the last two are created the first time compressed data is met and are null before that |
| Rays | `engine.raycast(origin, direction)` / `engine.pick(ndcX, ndcY)` return three hits (`object` is the mesh, `face` and `point` unchanged); `{ targets: 'all' }` hits rigid bodies too (the hit carries `entry` and `kind: 'rigid'`); the underlying `engine.rays.ray` (THREE.Raycaster, `firstHitOnly` on) |
| Ray acceleration (BVH) | three-mesh-bvh, without touching three's prototypes: a static mesh the engine registers (from 256 triangles up) gets `mesh.geometry.boundsTree` and its own `mesh.raycast`, so `engine.raycast / pick` are fast and your own `new THREE.Raycaster()` is plain three. Page-wide BVH for your rays: three-mesh-bvh's documented setup (`Mesh.prototype.raycast = acceleratedRaycast`, ...) |
| Streamed-in objects | `.object` of the handle returned by `engine.stream.add({ position, build })` (the Object3D that build returned; null before it is built) |
| Post-processing | `engine.post.add(pass)`, the one way in (a Pass, or an effect `{ name, slot, create: ctx => pass }` plus its twin for the other renderer, recipe 56; slots `scene` / `hdr` / `tone` / `ldr` / `final`; on / off and params with its handle); `engine.post.own()` hands over the whole chain |
| Where the mouse points | Ground: `screenToGround(engine, input.pointer.ndcX, ndcY)` -> Vector3; objects: `engine.pick(input.pointer.ndcX, ndcY)` (registered static objects; for any object pass `{ targets: [object] }`) |

Returned positions are all `THREE.Vector3` (the camera's `forward()/right()` are planar directions `{x, z}`; positions in photo records are saveable `{x, z}`).
Anywhere a position is accepted it is **one argument**: Vector3 / Object3D / `[x, y, z]` / `{ x, z }` all work, and sizes go in an options object (see
"Interface conventions" in `CONVENTIONS.md`):
`collision.addCircle(mesh, { radius: 1 })`, `collision.addBox(mesh.position, { halfWidth: 2, halfDepth: 1 })`, `particles.emit('dust', mesh, { count: 20 })`,
`triggers.add({ position: mesh })`, `content.spawn(name, v)`, `npcs.add({ position: v })`, `pickups.spawn(v, { give })`, `interactions.add(v or mesh, ...)`,
`rigid.impulse(entry, [0, 3, 5])`, `player.placeAt(v)`. Ground sampling `engine.surface(x, z)` also accepts `engine.surface(mesh.position)`.

## Engine conventions when using three.js

1. **Materials**: `new THREE.MeshStandardMaterial(...)` is the way; afterwards change `.map`, `.transparent` as usual.
   Your own shader code works as in three.js: `ShaderMaterial`, `onBeforeCompile` (also on an engine material: yours runs first, the engine's
   wind / clouds / season patches after it). The engine adds effects only to materials it made; yours opt in with `applyEffects(mat, { wind: 0.03 })`.
   One exception, named: with cascaded shadows on (`engine.shadows.cascades(light)`) every built-in lit material gets the `csm` patch, or it would
   be lit N times; a lit `ShaderMaterial` of yours joins with `engine.shadows.include(mat)` (recipe 45).
2. **Adding to the scene**: `engine.scene.add(obj)` is all it takes: every root under the scene is registered (`engine.thing(obj)` says what it
   is and what a save keeps). `engine.add(obj, { id })` is only for a stable id, so `thing.set` changes to it are saved. Plain three.js and
   templates (`engine.content.spawn`, content props) are two doors into one scene (`recipes/40-scene.md`). To attach to a character use `player.object.add(hat)`.
3. **Per-frame logic goes in `engine.onFrame(dt => ...)`** (movement and timing use `engine.onFixed`); it returns a handle, cancel with `h.remove()`.
   Don't start your own `requestAnimationFrame` loop: the engine owns pausing, fast-forward in tests and ordering. Rendering the canvas
   yourself (own `EffectComposer`) takes the frame over: the engine stops drawing it and its post chain, adaptive resolution and photo mode stop applying. Rendering into your own render target is fine (mirror, minimap, portal, picking): do it in
   `engine.onRender(({ renderer, scene, camera, dt }) => ...)`, which runs after the camera update and batching, just before the frame
   (`{ when: 'after' }` runs right after it). Plain three.js idioms and where each goes: `recipes/54-three-idioms.md`.
4. **Snap to ground**: get ground height with `engine.surface(x, z)`, or `engine.snapToGround(obj, heightAboveGround)`. Don't raycast the terrain.
   **Rays** always go through `engine.raycast / pick`: level meshes are registered automatically; register your own static objects with
   `engine.rays.addStatic(obj)` or `assets.model(name, { static: true })`.
   When you need a plain `THREE.Raycaster`, it also uses the BVH automatically (as long as the geometry has a boundsTree).
5. **Deleting**: when you no longer need an object use `engine.remove(obj)`: it removes it, unregisters it from `engine.rays` and frees the geometry
   and materials (`obj.removeFromParent()` / `scene.remove` leak GPU memory). To take it off only temporarily and `add` it back later use
   `engine.detach(obj)`. A copy from `assets.model()` shares resources with other copies (`remove` skips them); they are freed together by
   `assets.release(name)`.
6. **The sky lights nothing**: it computes signals and draws the dome, and your `picture/` code writes the lights, the fog and the exposure (recipe 62); weather gives `uWeatherLight` / `uWeatherFog` to multiply in. Every engine-written value: recipe 52
   "Who writes it". Adding your own point lights (street lamps, campfires) is fine.
7. **Camera**: only change properties of `engine.camera`, never replace the object (post-processing is bound to it; `engine.setCamera('follow')` swaps the camera *module*, not the object). When a camera
   module is installed it places the camera every frame; to control the view yourself take it with `const cam = engine.takeCamera('me')` and `cam.remove()` it
   (`engine.cameraOverride` is read-only: it shows the holder in charge, or `null`).
8. Collision: the player only respects `engine.collision` (`addCircle / addBox / addObject(mesh)`); a mesh alone does not block anyone.
9. **Big code-generated things** (a city block, a whole group of houses): write them as a function registered in the manifest
   `assets.manifest({ models: { block: buildBlock } })` and fetch with `assets.model('block')`; in development it is cached automatically, after
   `npm run bake` it reads the file.
   Things needed only nearby use `engine.stream.add({ position, build })`; put long loops in `engine.jobs.add(function* () { ...; yield; })` so they
   are spread over frames and the start does not stall.
   Smooth normals on built shapes: a non-indexed geometry (`geometry.toNonIndexed()`, a `mergeGeometries` result where one part has no index) gives
   every triangle its own vertices, so `geometry.computeVertexNormals()` shades each face flat (a low-poly look). Weld first with `mergeVertices` from
   `three/addons/utils/BufferGeometryUtils.js` (per part, so hard edges between parts stay), then compute the normals.
10. **One copy of the engine and of three per page**: `resolve: { dedupe: ['threedog', 'three'] }` in vite.config.js. A second engine copy
   (a pack that lists threedog under `dependencies` instead of `peerDependencies`, a linked plus an installed copy) breaks shadows of wind and
   cascaded-shadow materials; the engine warns once at load, naming both paths [engine-two-copies].

## Example: a spinning windmill (plain three.js + engine conventions)
This is the plain three.js door: three's own materials. The same windmill as a template with an id, saved and editable without code, is in `recipes/40-scene.md` §1.

```js
import { THREE } from 'threedog';
const mill = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9, flatShading: true });
const cloth = new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 1 });
const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 6, 6), wood);
tower.position.y = 3; tower.castShadow = true;
const blades = new THREE.Group(); blades.position.set(0, 5.5, 1.3);
for (let i = 0; i < 4; i++) {
  const arm = new THREE.Group(), sail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.08), cloth);
  sail.position.y = 2; sail.castShadow = true; arm.rotation.z = i * Math.PI / 2; arm.add(sail); blades.add(arm);
}
mill.add(tower, blades);
mill.position.set(20, 0, -10);
engine.snapToGround(mill);                         // snap to ground
engine.scene.add(mill);                            // registered like engine.add; engine.add(mill, { id: 'mill' }) also keeps thing.set changes in saves
engine.collision?.addCircle(mill, { radius: 1.3 }); // block the player (when the collision module is installed)
engine.onFrame(dt => { blades.rotation.z += dt * 1.5; });
```
