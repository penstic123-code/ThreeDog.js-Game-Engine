// NPC entries in content validation, no browser: a throwaway game folder in the OS temp dir goes through checkGame.
// The guard: the check accepts exactly what the runtime does (recipe 02): an NPC with only `start` stands there (the schedule behavior with no
// stops has no goal), and an NPC with neither start nor a schedule has no position and is an error that names both fixes.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame } from '../content-check.mjs';

export const name = 'content-check: NPC position (standing NPC with only start, schedule, behavior)';

const NPCS = `export default {
  clerk: { name: 'Clerk', start: { x: 4, z: 6 }, interact: { op: 'npc.talk' } },
  guard: { name: 'Guard', schedule: [{ at: '07:00', x: 0, z: 0 }, { at: '18:00', x: 5, z: 5 }] },
  cat: { name: 'Cat', start: { x: 1, z: 1 }, behavior: 'wander', mind: { radius: 6 } },
  ghost: { name: 'Ghost' },
};\n`;
const DIALOGUES = "export default { clerk: { nodes: { start: { text: 'Hello.' } } } };\n";

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-npcs-'));
  mkdirSync(join(dir, 'content'));
  writeFileSync(join(dir, 'main.js'), '\n');
  writeFileSync(join(dir, 'content/npcs.js'), NPCS);
  writeFileSync(join(dir, 'content/dialogues.js'), DIALOGUES);
  let r;
  try { r = await checkGame(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  const npcErrs = r.errors.filter(e => /NPC/.test(e)), all = npcErrs.join('\n');
  check('[guard] a standing NPC with only start (no schedule, no behavior) passes', !/NPC clerk/.test(all), all);
  check('a schedule NPC and a behavior + start NPC pass', !/NPC (guard|cat)/.test(all), all);
  check('[guard] an NPC with neither start nor schedule is an error naming both fixes', /NPC ghost has no position: give start .* or a schedule/.test(all), all);
}
