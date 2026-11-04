// The asset packs this game registers (main.js: engine.assets.manifest(packs)). Kept in their own file so `npm run check` imports the same
// objects and checks the model / sound names content uses against them (one source, no scanning of main.js).
import { assets as scenery } from './art/index.js';   // this example's procedural art: trees, rocks, flowers (pine, rock, ['flower', color]), humanoid, pickup
import { cabin, pickups } from './models.js';

export default [scenery, { name: 'world', models: { cabin, ...pickups } }];
