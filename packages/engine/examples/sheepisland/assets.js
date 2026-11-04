// The asset packs this game registers (main.js: engine.assets.manifest(packs)). Kept in their own file so `npm run check` imports the same
// objects and checks the model / sound names content uses against them (one source, no scanning of main.js).
import { models } from './models.js';   // roundTree, sheep, wheatTuft

export default [{ name: 'sheepisland', models }];
