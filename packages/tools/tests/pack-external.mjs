// Install the npm-packed engine + tools outside the repository and check types, build, preview and docs (see ../pack-external.mjs).
// Slow (npm install of a fresh project), so it only runs when asked: npm test -- pack-external
import { packExternal } from '../pack-external.mjs';

export const name = 'pack-external: npm pack -> install outside the repo -> types, CLI (map, check, test, dev + bridge), vite build + preview';
/** Runs only when named: npm test -- pack-external */
export const optIn = true;

export async function run({ check, browser }) {
  await packExternal({ check, browser });
}
