// The world example's own art: procedural models built in code (trees, rocks, grass, flowers, the 'humanoid' body, the 'pickup' shape).
// An asset pack, not a style: content names the models (pine, ['flower', color], humanoid), and how they are shaded comes from the style's
// material roles (style/index.js). engine.assets.manifest(assets) registers them; `models` is the same generators as a plain name -> function map.
import { models as scenery } from './models.js';
import { humanoid } from './humanoid.js';
import { pickup } from './shapes.js';

/** The procedural models as a plain name -> generator map */
export const models = { ...scenery, humanoid, pickup };
/** Asset pack: engine.assets.manifest(assets) registers pine, roundTree, rock, flower, grass, humanoid, pickup... as model names */
export const assets = { name: 'world-art', models };
