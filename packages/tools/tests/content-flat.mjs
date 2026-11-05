// Flat content in content validation, no browser: a throwaway game folder in the OS temp dir goes through checkGame.
// The guard: the three mistakes flat entries invite stop at `threedog check`: a place that was renamed or deleted under its entries, a `rot` on a place that
// is no number, a `source` that is no string. The good form of each stays silent.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';

export const name = 'content-check: flat content (source, place rot, entry with a missing place)';

const FILES = {
  'main.js': '\n',
  'content/places.js': "export default { 'stall-1': { x: 4, z: 2, rot: 1.57 }, 'nest-1': { x: 9, z: 0, rot: 'east' } };\n",
  'content/templates.js': "export default { chest: { model: 'm' } };\n",
  'content/props.js': `export default [
    { id: 'stall-1-chest', template: 'chest', place: 'stall-1', x: 1, source: 'stall' },
    { id: 'stall-1-lamp', model: 'm', place: 'stall-1', z: 1, source: 'stall' },
    { id: 'stall-2-chest', template: 'chest', place: 'stall-2', x: 1, source: 'stall' },
    { id: 'stall-1-sign', model: 'm', place: 'stall-1', source: 7 },
    { id: 'stall-1-box', template: 'chest', place: 'stall-1', source: ['stall'] },
  ];\n`,
};

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-flat-'));
  try {
    mkdirSync(join(dir, 'content'));
    for (const [f, src] of Object.entries(FILES)) writeFileSync(join(dir, f), src);
    const { errors } = await checkGame(dir);
    const all = errors.join('\n'), has = re => errors.some(e => re.test(e)), none = re => !errors.some(e => re.test(e));
    check('[guard] an entry whose place is gone is an error naming the entry, the place and the places that exist',
      has(/prop #3 uses place stall-2, which does not exist \(existing places: .*stall-1/), all);
    check('[guard] a place rot that is no number is an error; a number passes', has(/place nest-1: rot must be a number/) && none(/place stall-1/), all);
    check('[guard] source must be a string, on a plain prop and on a template entry', has(/prop #4: source should be string/) && has(/prop #5 \(template chest\): source should be string/), all);
    check('a flat entry with a string source passes', none(/prop #1\b/) && none(/prop #2\b/), all);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
