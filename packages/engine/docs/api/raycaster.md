# engine.raycaster (Raycast) — engine.raycaster is the ray registry (engine.raycast hits whatever is registered here)

- `raycaster.addStatic(obj: THREE.Object3D | THREE.Object3D[], opts?: { occluder?: boolean }) → Handle` — Register a static object and every mesh under it (an array also works; meshes over 256 triangles get a BVH); occluder: true also blocks the camera. Returns a handle { remove() }. Only visible objects are hit; hiding that just swaps in something else on screen (such as the far-away hlod original) is marked userData.rayVisible = true and is still hit. Unregisters automatically on geometry dispose or engine.remove. Example: `engine.raycaster.addStatic(house, { occluder: true });`
- `raycaster.forget(obj: THREE.Object3D)` — Unregister every mesh under the object (engine.remove calls this automatically)
- `raycaster.addProvider(fn: RayProvider) → Handle` — A module merges its own hits (rigid adds rigid bodies; asked only when targets is 'all'). Returns a handle { remove() }
- `raycaster.cast(origin: Vec3Like, dir: Vec3Like, opts?: RaycastOptions) → RayHit | null` — Cast a ray from origin along dir and return the nearest hit or null (same as engine.raycast).
- `raycaster.pick(ndcX: number, ndcY: number, opts?: RaycastOptions) → RayHit | null` — Cast from screen coordinates (-1..1) through the camera (same as engine.pick).
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
