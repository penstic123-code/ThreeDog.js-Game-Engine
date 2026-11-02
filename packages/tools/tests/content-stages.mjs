// Template stages in content validation, no browser: a throwaway game folder in the OS temp dir goes through checkGame.
// The guard: content-check reads stages with the engine's own rules (modules/content/stages.js), so a stage the engine would throw on
// (no duration before the last, a misspelled key, a duplicate name) and a placement outside the stage range fail `npm run check` before the game runs.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';

export const name = 'content-check: template stages (same rules as the engine, stage is a placeable state field)';

const FILES = {
  'main.js': '\n',
  'content/templates.js': `export default {
    crop: { model: 'm', state: { watered: false }, stages: [{ name: 'seed', duration: 60 }, { name: 'sprout', duration: 90, scale: 0.6 }, { name: 'ripe' }] },
    turret: { model: 'm', stages: [{ name: 'cold' }, { name: 'armed', duraton: 5 }] },
    site: { model: 'm', stages: [{ name: 'frame', duration: 10 }, { name: 'frame', duration: -1 }, { name: 'done', scale: 0 }] },
    door: { model: 'm', canGrow: () => true },
  };\n`,
  'content/props.js': `export default [
    { template: 'crop', id: 'c1', x: 1, z: 1, stage: 2 },
    { template: 'crop', id: 'c2', x: 1, z: 1, stage: 3 },
  ];\n`,
};

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-stages-'));
  try {
    mkdirSync(join(dir, 'content'));
    for (const [f, src] of Object.entries(FILES)) writeFileSync(join(dir, f), src);
    const { errors } = await checkGame(dir);
    const all = errors.join('\n'), has = re => errors.some(e => re.test(e)), none = re => !errors.some(e => re.test(e));
    check('[guard] a stage before the last without duration, and a misspelled stage key, are errors',
      has(/template turret stages\[0\] needs duration/) && has(/template turret stages\[1\]: unknown key 'duraton' \(did you mean 'duration'\?\)/), all);
    check('[guard] duplicate stage names, a non-positive duration and a zero scale are errors',
      has(/template site stages\[1\]: name 'frame' is used by an earlier stage/) && has(/stages\[1\]: duration must be a positive number/) && has(/stages\[2\]: scale must be a positive number/), all);
    check('[guard] stage is a placeable state field with range 0..n-1: stage 3 of a 3-stage crop is an error, stage 2 is fine',
      has(/prop #2 \(template crop\): stage must be <= 2, got 3/) && none(/prop #1\b/), all);
    check('canGrow without stages is an error', has(/template door: canGrow only applies with stages/), all);
    check('a valid stages list passes', none(/template crop( stages|:)/), all);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
