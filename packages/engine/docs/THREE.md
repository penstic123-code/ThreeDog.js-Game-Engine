# When the engine lacks a feature: use three.js directly

The scene, camera, lights, characters and models in the engine are **plain three.js objects** (three 0.187). For anything the engine does not provide,
write it the three.js way you already know, as long as you follow the conventions below.

## Getting three.js objects from the engine

| You want | Use |
|---|---|
| THREE itself | `import { THREE } from 'threedog'` or `engine.THREE` (the same copy the engine uses) |
| Scene / camera / renderer | `engine.scene`, `engine.camera` (PerspectiveCamera), `engine.renderer` (WebGLRenderer) |
| Player, NPCs | `engine.player.object`, `engine.npcs.get('name').object` (Group); position `.position` (Vector3) |
| Pickups, entities | `inventory.spawnPickup(...)` returns a handle with `.object` (Mesh); entity `ent.object` (root Group), `ent.visual` (model) |
| Level | `engine.level.root`; markers `engine.level.marker('spawn').object / .position` |
| Sun, ambient light, sky dome, fog | `engine.sky.sun` (DirectionalLight), `sky.hemi` (HemisphereLight), `sky.dome`, `engine.scene.fog` |
| Water | `engine.water.sea` (Mesh; null when the game sets no water level), `water.material`, `water.bodies.get(body)` |
| Particles, rain/snow | `.points` (THREE.Points) of the value returned by `particles.define(...)`; rain / snow look in the style pack (`style.weather.rain / snow`) |
| Rigid bodies | `engine.rigid.addBox(mesh)` returns a handle `{ object, body, remove() }`, or null before Rapier is ready (object is your mesh; `castShadow` / `receiveShadow` keep the values you set, the engine does not change them) |
| Terrain chunks | `engine.terrain.chunks` (Map; each chunk has `.group` and a `.terrain` mesh) |
| Models, textures, animation | `await engine.assets.model('name or path')` (an Object3D copy), `assets.texture(...)`, `assets.animate(model).mixer` |
| Vehicles, navigation, character controller | `engine.rigid.addVehicle(mesh, ...)` returns `{ body, controller }`; `engine.nav.navMesh / query / tileCache / crowd` (they are destroyed and replaced on rebuild; code that caches them compares `engine.nav.version`); `engine.player.mover.controller` (mover: 'rapier') |
| glTF / compression decoders | `engine.assets.gltf` (GLTFLoader, Meshopt installed), `assets.draco` (DRACOLoader), `assets.ktx2` (KTX2Loader); the last two are created the first time compressed data is met and are null before that |
| Rays | `engine.raycast(origin, direction)` / `engine.pick(ndcX, ndcY)` return three hits (`object` is the mesh, `face` and `point` unchanged); `{ targets: 'all' }` hits rigid bodies too (the hit carries `entry` and `kind: 'rigid'`); the underlying `engine.rays.ray` (THREE.Raycaster, `firstHitOnly` on) |
| Ray acceleration (BVH) | three-mesh-bvh: on import (`import 'threedog'`) the engine replaces `Mesh.prototype.raycast` page-wide, the way three-mesh-bvh recommends, so your own `new THREE.Raycaster()` uses it too (meshes without a `boundsTree` take three's normal path); a registered mesh has `mesh.geometry.boundsTree` (MeshBVH, built only from 256 triangles up) |
| Streamed-in objects | `.object` of the handle returned by `engine.stream.add({ position, build })` (the Object3D that build returned; null before it is built) |
| Post-processing | `engine.post.add({ name, slot, create: ctx => pass })` takes any three.js Pass as a named effect in a slot (`scene` / `hdr` / `ldr` / `final`); `h.enable(false)`, `h.remove()` |
| Where the mouse points | Ground: `screenToGround(engine, input.pointer.ndcX, ndcY)` -> Vector3; objects: `engine.pick(input.pointer.ndcX, ndcY)` (registered static objects; for any object pass `{ targets: [object] }`) |

Returned positions are all `THREE.Vector3` (the camera's `forward()/right()` are planar directions `{x, z}`; positions in photo records are saveable `{x, z}`).
Anywhere a position is accepted it is **one argument**: Vector3 / Object3D / `[x, y, z]` / `{ x, z }` all work, and sizes go in an options object (see
"Interface conventions" in `CONVENTIONS.md`):
`collision.addCircle(mesh, { radius: 1 })`, `collision.addBox(mesh.position, { halfWidth: 2, halfDepth: 1 })`, `particles.emit('dust', mesh, { count: 20 })`,
`triggers.add({ position: mesh })`, `entities.spawn(t, { position: v })`, `npcs.add({ position: v })`, `spawnPickup(id, v)`, `interactions.add(v or mesh, ...)`,
`rigid.impulse(entry, [0, 3, 5])`, `player.placeAt(v)`. Ground sampling `engine.surface(x, z)` also accepts `engine.surface(mesh.position)`.

## Engine conventions when using three.js

1. **Materials use `makeMaterial('role', { color, ... })`**, not `new MeshLambertMaterial` directly. It returns a real three material (the type is
   decided by the style pack); afterwards change `.map`, `.transparent` as usual.
2. **Adding to the scene**: `engine.add(obj)` returns obj so it fits on one line. `engine.scene.add(obj)` is plain three.js that the engine does not
   track, and is just as legal. Plain three.js and templates (`engine.spawn`, content props) are two doors into one scene (`recipes/40-scene.md`).
   `engine.add(obj, { id })` registers the object under a stable id so `engine.thing(id)` can say what it is and what a save keeps. To
   attach to a character use `player.object.add(hat)`.
3. **Per-frame logic goes in `engine.onFrame(dt => ...)`** (movement and timing use `engine.onFixed`); it returns a handle, cancel with `h.remove()`.
   Never call `requestAnimationFrame` or `renderer.render` yourself: the engine owns pausing, fast-forward in tests, post-processing and ordering.
4. **Snap to ground**: get ground height with `engine.surface(x, z)`, or `engine.snapToGround(obj, heightAboveGround)`. Don't raycast the terrain.
   **Rays** always go through `engine.raycast / pick`: level meshes are registered automatically; register your own static objects with
   `engine.rays.addStatic(obj)` or `assets.model(name, { static: true })`.
   When you need a plain `THREE.Raycaster`, it also uses the BVH automatically (as long as the geometry has a boundsTree).
5. **Deleting**: when you no longer need an object use `engine.remove(obj)`: it removes it, unregisters it from `engine.rays` and frees the geometry
   and materials (`obj.removeFromParent()` / `scene.remove` leak GPU memory). To take it off only temporarily and `add` it back later use
   `engine.detach(obj)`. A copy from `assets.model()` shares resources with other copies (`remove` skips them); they are freed together by
   `assets.release(name)`.
6. **Sky lighting is recomputed every frame**: to darken or tint use a modifier layer
   `engine.sky.modify('layer', { sun, ambient, fog, tint, tintAmount })` (multipliers, layers multiply; `null` removes), and don't change
   `sky.sun.intensity` or `sky.modifiers` (the combined result, read-only). Adding your own point lights (street lamps, campfires) is fine.
7. **Camera**: only change properties of `engine.camera`, never replace it with a new camera (post-processing is bound to this one). When a camera
   module is installed it places the camera every frame; to control the view yourself set `engine.cameraOverride = { owner: 'me' }` and set it back to
   `null` when done.
8. Collision: the player only respects `engine.collision` (`addCircle / addBox / addObject(mesh)`); a mesh alone does not block anyone.
9. **Big code-generated things** (a city block, a whole group of houses): write them as a function registered in the manifest
   `assets.manifest({ models: { block: buildBlock } })` and fetch with `assets.model('block')`; in development it is cached automatically, after
   `npm run bake` it reads the file.
   Things needed only nearby use `engine.stream.add({ position, build })`; put long loops in `engine.jobs.add(function* () { ...; yield; })` so they
   are spread over frames and the start does not stall.

## Example: a spinning windmill (plain three.js + engine conventions)
This is the plain three.js door. The same windmill as a template with an id, saved and editable without code, is in `recipes/40-scene.md` §1.

```js
import { THREE, makeMaterial } from 'threedog';
const mill = new THREE.Group(), wood = makeMaterial('building', { color: 0x8a6a4a, flatShading: true });
const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 6, 6), wood);
tower.position.y = 3; tower.castShadow = true;
const blades = new THREE.Group(); blades.position.set(0, 5.5, 1.3);
for (let i = 0; i < 4; i++) {
  const arm = new THREE.Group(), sail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.08), makeMaterial('building', { color: 0xe8e0d0 }));
  sail.position.y = 2; sail.castShadow = true; arm.rotation.z = i * Math.PI / 2; arm.add(sail); blades.add(arm);
}
mill.add(tower, blades);
mill.position.set(20, 0, -10);
engine.snapToGround(mill);                         // snap to ground
engine.add(mill);
engine.collision?.addCircle(mill, { radius: 1.3 }); // block the player (when the collision module is installed)
engine.onFrame(dt => { blades.rotation.z += dt * 1.5; });
```
