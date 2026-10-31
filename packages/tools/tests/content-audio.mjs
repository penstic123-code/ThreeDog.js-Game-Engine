// Content validation for the audio table of content (no browser): a throwaway game folder in the OS temp dir goes through checkGame.
// Guards (cannot be bypassed): a function anywhere in content audio and a sound written as a file path are errors, the same as models;
// a measure comparison outside gt / gte / lt / lte and an unknown volume key are errors; a rule playing an undefined sound warns.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';

export const name = 'content-check: audio in content (data only, sounds by asset name, measure comparisons)';

const FILES = {
  'main.js': '\n',
  'content/audio.js': `export default {
    sounds: { wind: 'synth', door: '/sfx/door.ogg', hit: ['hit1', 'hit2'] },
    ambience: [
      { sound: 'wind', volume: { base: 0.05, add: { wind: 0.08 }, max: 0.5 } },
      { sound: 'wind', when: e => true },
      { sound: 'wind', when: { daylight: { above: 0.1 } }, volume: { base: 0.1, cap: 1 } },
      { sound: 'nope' },
    ],
    music: { tracks: { day: 'music-day' }, rules: [{ track: 'day', when: { time: 'day' } }] },
    footsteps: { default: 'wind' },
  };\n`,
};

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-audio-'));
  try {
    mkdirSync(join(dir, 'content'));
    for (const [f, src] of Object.entries(FILES)) writeFileSync(join(dir, f), src);
    const { errors, warnings } = await checkGame(dir);
    const has = re => errors.some(e => re.test(e)), all = [...errors, ...warnings].join('\n');
    check('[guard] a function in content audio is an error naming where', has(/audio\.js: audio\.ambience\.1\.when is a function/), all);
    check('[guard] a sound written as a file path is an error with the asset pack form', has(/audio\.sounds\.door names the file "\/sfx\/door\.ogg"/), all);
    check('a measure comparison outside gt / gte / lt / lte is an error', has(/when\.daylight of ambience rule #3/), all);
    check('an unknown volume key is an error', has(/volume of ambience rule #3 has an unknown key "cap"/), all);
    check('a rule playing a sound the table does not define warns', warnings.some(w => /ambience rule #4 plays "nope"/.test(w)), all);
    check('data-only rules, asset names and footsteps pass', errors.length === 4, errors.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
