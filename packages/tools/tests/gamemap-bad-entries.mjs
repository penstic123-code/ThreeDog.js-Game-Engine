// A content entry of the wrong shape, in the map (no browser). Why: the map runs before the content check, so a stack from it stood in front of the message that says
// what to fix. Each entry here threw once. The promise: the good entries stay, the bad one is a named hole that points at threedog check, and threedog check names it too.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gameMap } from '../gamemap.mjs';
import { checkGame } from '../content-check.mjs';

export const name = '[guard] map: a bad content entry is a hole pointing at threedog check, never a stack';

const BAD = {
  'quest without steps': ['quests', { a: { title: 'x' } }, 'quests.a'], 'quest null': ['quests', { a: null }, 'quests.a'], 'quest steps a string': ['quests', { a: { steps: 'x' } }, 'quests.a'],
  'step null': ['quests', { a: { steps: [null] } }, 'quests.a'], 'step all a number': ['quests', { a: { steps: [{ all: 3 }] } }, 'quests.a'], 'a null part of all': ['quests', { a: { steps: [{ all: [null] }] } }, 'quests.a'],
  'action without keys': ['actions', { a: { label: 'Dash' } }, 'actions.a'], 'action null': ['actions', { a: null }, 'actions.a'], 'action keys a string': ['actions', { a: { keys: 'KeyK' } }, 'actions.a'],
  'trigger null': ['triggers', { a: null }, 'triggers.a'], 'vegetation null': ['vegetation', { a: null }, 'vegetation.a'], 'template null': ['templates', { a: null }, 'templates.a'],
  'prop null': ['props', [null], 'props[0]'], 'props not a list': ['props', { a: 1 }, 'props'], 'pickup null': ['pickups', [null], 'pickups[0]'],
  'item null': ['items', { a: null }, 'items.a'], 'npc null': ['npcs', { a: null }, 'npcs.a'], 'dialogue null': ['dialogues', { a: null }, 'dialogues.a'],
};

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'map-holes-'));
  try {
    mkdirSync(join(dir, 'content'));
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'main.js'), "import { createEngine } from 'threedog';\n");
    for (const [label, [kind, value, hole]] of Object.entries(BAD)) {
      const r = await gameMap(dir, { [kind]: value });
      check(`${label}: the map names the hole and threedog check`, r.content?.includes(`- ${hole}`) && /threedog check/.test(r.content), r.error ?? 'no hole in the map');
      writeFileSync(join(dir, `content/${kind}.js`), `export default ${JSON.stringify(value)};\n`);
      check(`${label}: threedog check names it`, (await checkGame(dir)).errors.length > 0);
      rmSync(join(dir, `content/${kind}.js`));
    }
    const mixed = await gameMap(dir, { quests: { good: { title: 'Good', steps: [{ text: 'Go' }] }, bad: {} }, actions: { dash: { keys: ['KeyK'], label: 'Dash' }, odd: null } });
    check('the good entries next to a bad one stay', /Good/.test(mixed.content ?? '') && /KeyK/.test(mixed.content ?? '') && /- quests\.bad/.test(mixed.content ?? ''), mixed.error);
    const fine = await gameMap(dir, { quests: { good: { title: 'Good', steps: [{ text: 'Go' }] } } });
    check('a sound game has no holes section', !!fine.content && !/could not read/.test(fine.content), fine.error);
    // what no shape test sees: the last line of defence is still a sentence
    const odd = await gameMap(dir, { get quests() { throw new Error('odd'); } });
    check('anything else comes back as a message, not a throw', /threedog check/.test(odd.error ?? ''), JSON.stringify(odd));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
