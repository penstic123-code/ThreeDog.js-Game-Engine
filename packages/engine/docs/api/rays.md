# engine.rays (Rays) — engine.rays is the ray registry (engine.raycast hits whatever is registered here)

- `rays.addStatic(obj: THREE.Object3D | THREE.Object3D[], opts?: { occluder?: boolean }) → Handle` — Register a static object and every mesh under it (an array also works; meshes over 256 triangles get a BVH); occluder: true also blocks the camera. Returns a handle { remove() }. Only visible objects are hit. Something that is merely not drawn is still hit: batched originals, far hlod originals and the full model of a far assets.lod sit on a reserved layer, with their visible true. Unregisters automatically on geometry dispose or engine.remove. Example: `engine.rays.addStatic(house, { occluder: true });`
- `rays.forget(obj: THREE.Object3D)` — Unregister every mesh under the object (engine.remove calls this automatically)
- `rays.addProvider(fn: RayProvider) → Handle` — A module merges its own hits (rigid adds rigid bodies; asked only when targets is 'all'). Returns a handle { remove() }
- Properties:
  - `statics: Map<THREE.Object3D, { refs: number; occ: number }>` Registered mesh -> { refs: registration count, occ: camera-blocker registration count }
  - `ray: any` The three.js Raycaster (firstHitOnly is on)

## Data structures
- **RaycastOptions** Parameters of engine.raycast()
  - `far?: number` Maximum distance (meters), default unlimited
  - `targets?: 'static' | 'all' | Object3D[]` What to hit: 'static' registered static objects (default) / 'all' plus what modules merge in (with rigid installed this includes rigid bodies, hits carry entry and kind: 'rigid') / an array of objects
  - `filter?: (hit: RayHit) => boolean` Hits for which this returns false are skipped
  - `occluders?: boolean` Hit only meshes that block the camera (level buildings, hidden col_ collision meshes); used by collision's cameraOcclusion
- **RayHit** Ray hit: point is the hit point, distance in meters, normal the surface direction, object the mesh hit; entry/kind come from the module that merged the hit in (e.g. a rigid body)
  - `point: Vector3`
  - `distance: number`
  - `normal: Vector3 | null`
  - `object: Object3D | null`
  - `face: any`
  - `entry?: any`
  - `kind?: string`
  - `thing?: HitThing` Point -> thing, computed when read: the world record the hit belongs to (a batched instance resolves to its original), where it was authored and what to edit. Example: `const t = engine.pick(0, 0)?.thing;   // { id: 'chest-home', kind: 'chest', template: 'chest', definedAt: 'content/props.js:14', ... }`
