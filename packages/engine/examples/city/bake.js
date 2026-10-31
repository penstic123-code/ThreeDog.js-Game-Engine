// Bake list: npm run bake exports what is registered here as scene files.
import { buildBlock } from './block.js';
export const bake = { 'city-block': () => buildBlock() };
