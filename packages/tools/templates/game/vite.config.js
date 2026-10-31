// The threedog preset: every *.html is a page, Workers build as ES modules (worker: { format: 'es' }, which the engine's Workers need), dev bridge and error relay.
// Without @threedog/tools, a plain vite config must set worker: { format: 'es' } itself or vite build fails.
import { gameConfig } from '@threedog/tools/vite';

export default gameConfig(import.meta.dirname);
