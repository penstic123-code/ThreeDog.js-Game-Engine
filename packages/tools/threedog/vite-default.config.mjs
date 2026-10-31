// Vite config used by threedog dev / build / preview for a game folder that has no vite.config.js of its own: the threedog preset
// (gameConfig: Workers as ES modules, every *.html as a page, error relay, dev bridge, model cache) on the current folder.
import { gameConfig } from '../vite/gameConfig.js';

export default gameConfig(process.cwd());
