// The asset packs this game registers (main.js: engine.assets.manifest(packs)). Kept in their own file so `npm run check` imports the same
// objects and checks the model / sound names content uses against them (one source, no scanning of main.js).
import { assets as worldArt } from '../world/art/index.js';   // the world example's procedural trees / rocks / humanoid
import { woodBlock, stoneBlock, metalBall, glassPanes, shadowStage, room } from './models.js';

export default [worldArt, { name: 'styletest', models: { woodBlock, stoneBlock, metalBall, glassPanes, shadowStage, room } }];   // the names content/templates.js uses
