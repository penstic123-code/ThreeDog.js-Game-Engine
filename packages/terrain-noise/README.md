# @threedog/terrain-noise

Optional terrain generator for [threedog](https://www.npmjs.com/package/threedog): noise hills, `island`, `canyon` or `flat` shapes, rivers and a biome rule table. It decides the shape of the world only; ground colors belong to the game's style (keyed by the biome names). Without it the engine's ground is flat.

```sh
npm install @threedog/terrain-noise@0.7
```

This describes 0.7.1: `npm install @threedog/terrain-noise@0.7` (games made in the [repository](https://github.com/penstic123-code/ThreeDog.js-Game-Engine) already have it).

```js
import { openWorld } from 'threedog';
import { terrainPreset } from '@threedog/terrain-noise';

engine.use(openWorld({ seed: 7, camera: 'follow', terrain: terrainPreset({ shape: 'island' }) }));
```

Also exported: `riverAt(x, z, n)`, `BIOMES` (the default rule table) and `terrainStrings`. Types are in `index.d.ts`. The height and ground-type functions run in terrain workers, so a game's own replacements must be pure (read only their parameters and `Math`).

Docs ship with the engine: `node_modules/threedog/docs/AI.md` and `docs/recipes/`. Peer dependency: `threedog`. MIT license.
