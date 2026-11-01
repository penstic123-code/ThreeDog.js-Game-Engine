# Terrain outline: islands, floating rocks, a world that ends

`terrain({ shape })` decides where there is ground at all. Without it the ground goes on forever, exactly as before. With it, ground exists only
where `mask > 0`; the rim is cut through the cells in straight lines, walls hang down from it, and an optional underside closes it.

## 1. A floating island with a ragged rim (copy this)

```js
import { createEngine, openWorld } from 'threedog';

const engine = createEngine({ canvas: document.querySelector('canvas') });
engine.use(openWorld({ camera: 'follow', water: false, terrain: {   // water: false -- a floating island has no sea under it
  height: (x, z, n) => 4 + 6 * n.fbm(x * 0.02, z * 0.02),
  shape: {
    mask: (x, z) => 60 - Math.hypot(x, z),                    // > 0 ground: a 60 m disc (meters read best)
    edge: { noise: 8, size: 20, jitter: 0.6, round: 1.5 },    // ragged outline, jagged rim, top bends down 1.5 m at the edge
    side: { depth: 3, ground: 'cliff' },                      // 3 m of cliff band, colored by biomeColors.cliff
    bottom: { depth: (x, z, n, m) => 2 + m * 0.5 + 4 * n.fbm(x * 0.1, z * 0.1), ground: 'rock' },   // hangs lower inland (m grows inward)
  },
} }));
await engine.start();

const home = { x: 0, z: 0 };
engine.events.on('terrain:void', ({ who }) => {   // fell off: the game decides (the engine never respawns)
  if (who === engine.player) engine.player.placeAt(home);
});
```

Colors come from the style pack as usual: add `cliff` and `rock` to `style.terrain.biomeColors` (a name without a color is neutral gray).

## 2. The keys

| key | what | default |
|---|---|---|
| `mask` | `(x, z, n) => number`, > 0 is ground; pure like `height` (runs in workers, settings through `n.params`). Or a gray image `{ url, size: [w, l], center, threshold }`: whiter is ground, value = gray − threshold, outside the image is void | required |
| `edge.noise` / `edge.size` | meters of fbm added to the mask, and its wavelength in meters | 0 / 16 |
| `edge.jitter` | meters of random offset per grid point: a jagged, chipped rim | 0 |
| `edge.round` | meters the top bends down towards the rim; 0 is a hard cliff edge | 0 |
| `side.depth` | wall height below the rim: meters or `(x, z, n) => meters` | 2 |
| `side.ground` / `side.material` | wall color (`biomeColors[ground]`), or a Material / `(engine) => Material` for sides and bottom | `'cliff'` / none |
| `bottom.depth` | underside below the side band: meters or `(x, z, n, m) => meters` (`m` = mask there) | 4 (only with `bottom`) |
| `bottom.ground` | underside color | `'rock'` |
| `voidY` | fall height for `terrain:void` | 50 m under the lowest island chunk loaded |

Without `bottom` the island is open underneath (the cheapest choice when the camera never looks up at it).

## 3. What the rest of the engine does off the outline

- `engine.surface(x, z)` is `-Infinity`, `engine.ground.has(x, z)` is `false`, `engine.slope` is 0, `engine.groundType` is `'void'`.
  Check `has` before placing things: `engine.snapToGround` over the void throws in development instead of writing an infinite y.
  The same holds for every place-it-here entry (`engine.spawn`, content props, pickups, npcs, `character.placeAt`): in development they throw with this advice, in a release build they keep the caller's y (or 0), never `-Infinity` (a save would turn it into NaN). Camera starts, HUD anchors, grid tiles and shot paths fall back to y 0 / the last height and do not throw.
- Characters walk off the rim and fall; pathfinding and spawn search treat the void as not walkable.
- Physics: the top and the walls collide (a rolling barrel stops at a wall, a ball falls off the edge); the underside does not.
- Vegetation never grows off the outline. `engine.terrain.edit` off it does nothing (returns `{ heights: 0, cells: 0 }`); near the rim it
  still digs, and painting works. The outline itself cannot be edited.
- The player and every moving rigid body that drops below `engine.terrain.voidY` get one `terrain:void { who, position }` per fall.
- Global water still draws at its level: a floating island usually turns water off (`water: false` above).

## 4. Limits

- The cut follows cell edges, so detail finer than a cell (`chunkSize / resolution`, 4 m by default) is lost. Keep `edge.size` above a cell,
  or raise `resolution`.
- `shading: 'texture'`: the color map covers the top only (void pixels have alpha 0); sides and bottom use vertex colors or `side.material`.
- The mask is fixed at start; a game that wants the outline to change while playing builds that itself.
