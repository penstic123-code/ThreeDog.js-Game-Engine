# engine.collider3d — collider3d()

(experimental) Collision on all three axes (the collider3d slot, held by rigid() unless replaced)


## Methods and properties
- `collider3d.addSolid(opts: { position, size?, radius?, rotation?, friction? }) → Handle` — A fixed solid turned any way. size [x, y, z] for a box or radius for a ball; rotation [x, y, z] radians or a quaternion. Callable before start(); newGame and a load keep it. engine.collision does not know it
- `collider3d.overlap(position: PositionLike, radius?: number) → boolean` — Is a ball here inside something solid. Skips the player's capsule
- `collider3d.sweep(from: PositionLike, to: PositionLike, radius?: number) → SweepHit | null` — Move a ball from there to there: null when clear, else the first hit. Skips the player's capsule
