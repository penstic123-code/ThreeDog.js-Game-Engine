# engine.collision — collision(opts?: CollisionOptions)

Lightweight collision (collision() module): no clipping while walking, the camera is not blocked

- Options `CollisionOptions`:
  - `maxClimb?: number` Max walkable slope (height difference / horizontal distance), default 1.1
  - `canopyHeight?: number` A camera above this height (meters) is not considered blocked by trees, default 5
  - `cameraPad?: number` Margin between the camera and obstacles (meters), default 0.5
  - `cameraMin?: number` Nearest camera distance (meters), default 1.5
  - `walkableWaterMargin?: number` Height above the water surface (meters) at which it counts as walkable, default 0.2
  - `cameraOcclusion?: 'colliders' | 'meshes' | 'both'` What camera occlusion checks: 'colliders' (default) / 'meshes' registered static meshes (engine.raycaster) / 'both'

## Methods and properties
- `collision.addCircle(position: PositionLike, opts?: CircleColliderOptions) → Handle` — Add a circle collider (pillar, campfire): position is the center, e.g. addCircle(mesh, { radius: 1 }). Returns a handle { remove() }
- `collision.addBox(position: PositionLike, opts?: BoxColliderOptions) → Handle` — Add a box collider (house, fence): position is the center, e.g. addBox(house, { halfWidth: 3, halfDepth: 2, rotation: 0.3 }). Returns a handle { remove() }
- `collision.addObject(obj: Object3D, opts?: { pad?: number }) → Handle` — Add a collider from an object's bounding box, pad expands outward (meters). Returns a handle { remove() }
- `collision.forEachStatic(fn: (type, data) => void)` — Iterate all static colliders added by hand
- `collision.resolve(pos: { x: number; z: number }, radius?: number) → boolean` — Low level (called every step by character movement): push a character of radius radius (meters) out of obstacles (modifies pos.x/pos.z directly), returns whether it hit anything
- `collision.walkable(position: PositionLike, opts?: { radius?: number }) → boolean` — Whether someone can stand at this position (for pathfinding): not in water, not too steep, not inside an obstacle. radius is the character radius (meters, default engine.movement.radius)
- `collision.walkableAt(x: number, z: number, radius?: number) → boolean` — walkable with plain numbers, allocating nothing (A* inner loops); radius defaults to engine.movement.radius
- `collision.cameraDistance(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, want: number, pad?: number) → number` — Low level (called every frame by the camera): camera occlusion, returns the max allowed distance (meters)
- Properties:
  - `cameraOcclusion: 'colliders' | 'meshes' | 'both'` What camera occlusion checks (see CollisionOptions.cameraOcclusion)
  - `circles: CircleCollider[]` Circle colliders added by hand
  - `boxes: BoxCollider[]` Box colliders added by hand
  - `version: number` +1 each time a static collider is added or removed

## Data structures
- **CircleColliderOptions** Parameters of addCircle() (meters)
  - `radius?: number` Radius, default 0.5
  - `height?: number` Height, default 6
- **BoxColliderOptions** Parameters of addBox() (meters, radians)
  - `halfWidth?: number` Half width (X direction), default 1
  - `halfDepth?: number` Half depth (Z direction), default 1
  - `rotation?: number` Rotation around the Y axis (radians), default 0
  - `height?: number` Height, default 6
  - `y?: number` Bottom height of the box; if omitted it sits on the ground (give it for walls placed on platforms in a level)
