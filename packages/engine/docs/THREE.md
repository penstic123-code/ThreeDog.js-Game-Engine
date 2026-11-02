# When the engine lacks a feature: use three.js directly

The scene, camera, lights, characters and models in the engine are **plain three.js objects** (three 0.187). For anything the engine does not provide,
write it the three.js way you already know, as long as you follow the conventions below.
Looks (materials, shaders, textures, lights, post passes) are always this route; engine look features are optional extras on top.

## What importing the engine changes in three.js (page-wide)
Everything else in three is untouched. These four are global because three has no per-object hook for them:

| Change | When | Effect on your code | Turn it off |
|---|---|---|---|
| `Mesh.prototype.raycast` = three-mesh-bvh `acceleratedRaycast`; `BufferGeometry.prototype.computeBoundsTree / disposeBoundsTree` added | On `import 'threedog'` | Same hits as three. Only a geometry with a `boundsTree` takes the fast path; the engine builds one for registered static meshes from 256 triangles up | Per mesh: `mesh.geometry.disposeBoundsTree()` (three's path again). Page-wide: not possible |
| `Mesh.prototype.customDepthMaterial / customDistanceMaterial` become accessors | On import | Unassigned, they return a shadow material only for a mesh whose material carries a vertex-moving engine patch (wind), so its shadow sways too; otherwise `undefined` as in three | Assign your own: `mesh.customDepthMaterial = new THREE.MeshDepthMaterial()` (a still shadow) or any depth material; an assignment always wins, `undefined` returns to the default. Page-wide: not possible |
| `THREE.ShaderChunk.fog_pars_vertex / fog_vertex / fog_pars_fragment / fog_fragment` replaced | Only when a sky fog is `kind: 'exp'`, `'height'` or has `glsl` (default `'linear'` / `'exp2'`: untouched) | Every material on the page uses that fog math (yours too) | Use `'linear'` / `'exp2'` without `glsl`, or `sky({ fog: false })`; the originals return when the last engine using it is disposed |
| `THREE.ShaderChunk.threedog_*` added (new names, nothing replaced) | On import | None until you `#include` one | - |


## Getting three.js objects from the engine

| You want | Use |
|---|---|
| THREE itself | `import { THREE } from 'threedog'` or `engine.THREE` (the same copy the engine uses) |
| Scene / camera / renderer | `engine.scene`, `engine.camera` (PerspectiveCamera), `engine.renderer` (WebGLRenderer) |
| Player, NPCs | `engine.player.object`, `engine.npcs.get('name').object` (Group); position `.position` (Vector3) |
| Pickups, template instances | `pickups.spawn(...)` returns a handle with `.object` (Mesh); a template instance's model is `engine.world.view(id)` (exists only near) |
| Level | `engine.level.root`; markers `engine.level.marker('spawn').object / .position` |
| Sun, ambient light, sky dome, fog | `engine.lights.sun` (DirectionalLight), `engine.lights.hemi` (HemisphereLight), `engine.sky.dome`, `engine.scene.fog` |
| Water | `engine.water.sea` (Mesh; null when the game sets no water level), `water.material`, `water.bodies.get(body)` |
| Particles, weather particles | `.points` (THREE.Points) of the value returned by `particles.define(...)`; the weather's look in the style (`style.weather`) |
| Rigid bodies | `engine.rigid.addBox(mesh)` returns a handle `{ object, body, remove() }`, or null before Rapier is ready (object is your mesh; `castShadow` / `receiveShadow` keep the values you set, the engine does not change them) |
| Terrain chunks | `engine.terrain.chunks` (Map; each chunk has `.group` and a `.terrain` mesh) |
| Models, textures, animation | `await engine.assets.model('name or path')` (an Object3D copy), `assets.texture(...)`, `assets.animate(model).mixer` |
| Vehicles, navigation, character controller | `engine.rigid.addWheeled(mesh, ...)` returns `{ body, controller }`; `engine.nav.navMesh / query / tileCache / crowd` (they are destroyed and replaced on rebuild; code that caches them compares `engine.nav.version`); `engine.player.mover.controller` (mover: 'rapier') |
| glTF / compression decoders | `engine.assets.gltf` (GLTFLoader, Meshopt installed), `assets.draco` (DRACOLoader), `assets.ktx2` (KTX2Loader); the last two are created the first time compressed data is met and are null before that |
| Rays | `engine.raycast(origin, direction)` / `engine.pick(ndcX, ndcY)` return three hits (`object` is the mesh, `face` and `point` unchanged); `{ targets: 'all' }` hits rigid bodies too (the hit carries `entry` and `kind: 'rigid'`); the underlying `engine.rays.ray` (THREE.Raycaster, `firstHitOnly` on) |
| Ray acceleration (BVH) | three-mesh-bvh: on import (`import 'threedog'`) the engine replaces `Mesh.prototype.raycast` page-wide, the way three-mesh-bvh recommends, so your own `new THREE.Raycaster()` uses it too (meshes without a `boundsTree` take three's normal path); a registered mesh has `mesh.geometry.boundsTree` (MeshBVH, built only from 256 triangles up) |
| Streamed-in objects | `.object` of the handle returned by `engine.stream.add({ position, build })` (the Object3D that build returned; null before it is built) |
| Post-processing | `engine.look.post.add({ name, slot, create: ctx => pass })` adds any three.js Pass as a named effect in a slot (`scene` / `hdr` / `ldr` / `final`) next to the style's chain; `replace([...])` swaps the whole chain; `look.post.set({ 'name.enabled': false })` |
| Where the mouse points | Ground: `screenToGround(engine, input.pointer.ndcX, ndcY)` -> Vector3; objects: `engine.pick(input.pointer.ndcX, ndcY)` (registered static objects; for any object pass `{ targets: [object] }`) |

Returned positions are all `THREE.Vector3` (the camera's `forward()/right()` are planar directions `{x, z}`; positions in photo records are saveable `{x, z}`).
Anywhere a position is accepted it is **one argument**: Vector3 / Object3D / `[x, y, z]` / `{ x, z }` all work, and sizes go in an options object (see
"Interface conventions" in `CONVENTIONS.md`):
`collision.addCircle(mesh, { radius: 1 })`, `collision.addBox(mesh.position, { halfWidth: 2, halfDepth: 1 })`, `particles.emit('dust', mesh, { count: 20 })`,
`triggers.add({ position: mesh })`, `content.spawn(name, v)`, `npcs.add({ position: v })`, `pickups.spawn(v, { give })`, `interactions.add(v or mesh, ...)`,
`rigid.impulse(entry, [0, 3, 5])`, `player.placeAt(v)`. Ground sampling `engine.surface(x, z)` also accepts `engine.surface(mesh.position)`.

## Engine conventions when using three.js

1. **Materials**: `new THREE.MeshStandardMaterial(...)` is fine. Use `makeMaterial('role', { color, ... })` when you want the style's material
   for a role (it returns a real three material; the type is decided by the style); afterwards change `.map`, `.transparent` as usual.
   Your own shader code works as in three.js: `ShaderMaterial`, `onBeforeCompile` (also on an engine material: yours runs first, the engine's
   wind / clouds / season patches after it). The engine adds effects only to materials it made; yours opt in with `applyEffects(mat, { wind: 0.03 })`.
   One exception, named: with cascaded shadows on (`look.shadow.set({ cascades: 3 })`) every built-in lit material gets the `csm` patch, or it would
   be lit N times; a lit `ShaderMaterial` of yours joins with `engine.look.shadow.include(mat)` (recipe 45).
2. **Adding to the scene**: `engine.add(obj)` returns obj so it fits on one line. `engine.scene.add(obj)` is plain three.js that the engine does not
   track, and is just as legal. Plain three.js and templates (`engine.content.spawn`, content props) are two doors into one scene (`recipes/40-scene.md`).
   `engine.add(obj, { id })` registers the object under a stable id so `engine.thing(id)` can say what it is and what a save keeps. To
   attach to a character use `player.object.add(hat)`.
3. **Per-frame logic goes in `engine.onFrame(dt => ...)`** (movement and timing use `engine.onFixed`); it returns a handle, cancel with `h.remove()`.
   Don't start your own `requestAnimationFrame` loop or render the main frame yourself: the engine owns pausing, fast-forward in tests,
   post-processing and ordering. Rendering into your own render target is fine (mirror, minimap, portal, picking): do it in
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
6. **Sky lighting is recomputed every frame**, and you choose how much of it to keep: adjust it and keep the day cycle with a modifier layer
   `engine.mod('sky.sunLight', { owner: 'cave', mul: 0.3 })` (also `sky.ambient` / `sky.fog`; entries multiply; `remove()` ends it) or `look.lights.set(...)`;
   take a value with `engine.look.lights.manual('sun')` and then set `engine.lights.sun.intensity` yourself (`manual('sun', false)` gives it back).
   Writing it directly without `manual` also takes it (the engine stops writing it and warns once). Every engine-written value: recipe 52
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
10. **One copy of the engine and of three per page**: `resolve: { dedupe: ['threedog', 'three'] }` in vite.config.js. A second engine copy
   (a pack that lists threedog under `dependencies` instead of `peerDependencies`, a linked plus an installed copy) breaks shadows of wind and
   cascaded-shadow materials; the engine warns once at load, naming both paths [engine-two-copies].

## Example: a spinning windmill (plain three.js + engine conventions)
This is the plain three.js door: three's own materials, no style needed (`makeMaterial('building')` instead gives the pack's material for a role, when you want it unified with the pack). The same windmill as a template with an id, saved and editable without code, is in `recipes/40-scene.md` §1.

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
engine.add(mill);
engine.collision?.addCircle(mill, { radius: 1.3 }); // block the player (when the collision module is installed)
engine.onFrame(dt => { blades.rotation.z += dt * 1.5; });
```
