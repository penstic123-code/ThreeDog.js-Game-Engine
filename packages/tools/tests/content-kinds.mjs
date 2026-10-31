// Content validation for game content kinds and the newer quest shapes (no browser): a throwaway game folder in the OS temp dir
// goes through checkGame (content-check) and the GAMEMAP kind section, so both read the same contentFiles() + rules.js kinds table.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkGame, loadGame } from '../content-check.mjs';
import { kindMapLines } from '../content-check/kinds.mjs';

export const name = 'content-check: game content kinds (rules.js kinds), quest all / optional / fail, positions with floor';

const FILES = {
  'main.js': "engine.quests.start('q1'); engine.quests.start('q2');\n",
  'content/rules.js': `export default { kinds: {
    recipes: { desc: 'crafting recipes', load() {}, map: d => Object.entries(d).map(([id, r]) => id + ' -> ' + r.makes),
      check(data, ctx) { for (const [id, r] of Object.entries(data)) if (!ctx.data.items?.[r.makes]) ctx.err('recipe ' + id + ' makes unknown item ' + r.makes); } },
    waves: { desc: 'enemy waves', load() {} },
    items: { desc: 'clash', load() {} },
  } };\n`,
  'content/items.js': "export default { bread: { name: 'Bread' } };\n",
  'content/recipes.js': "export default { toast: { makes: 'bred' }, loaf: { makes: 'bread' } };\n",
  'content/waves.js': "export default [{ id: 'w1' }, { id: 'w2' }];\n",
  'content/enemies.js': 'export default {};\n',
  'content/quests.js': `export default {
    q1: { title: 'a', steps: [{ text: 's', done: { flag: 'x' }, optional: true }], onFail: { setFlag: 'y' } },
    q2: { title: 'b', steps: [{ all: [{ text: 'p', done: { flag: 'x' }, optional: true }] }], fail: { flagg: 'z' } },
  };\n`,
  'content/props.js': "export default [{ model: 'm', x: 0, z: 0, floor: 'two' }];\n",
};

export async function run({ check }) {
  const dir = mkdtempSync(join(tmpdir(), 'threedog-kinds-'));
  try {
    mkdirSync(join(dir, 'content'));
    for (const [f, src] of Object.entries(FILES)) writeFileSync(join(dir, f), src);
    const { errors, warnings } = await checkGame(dir);
    const has = re => errors.some(e => re.test(e));
    check('[guard] a registered kind file is read (not "unknown"), an unregistered one is refused with how to register it',
      !errors.some(e => /recipes\.js: unknown content|waves\.js: unknown content/.test(e)) && has(/enemies\.js: unknown content "enemies".*kinds: \{ enemies:/), errors.join('\n'));
    check("the kind's own check runs and points at its file", has(/recipes\.js: recipe toast makes unknown item bred/) && !has(/recipe loaf/), errors.join('\n'));
    check('a kind named like an engine file is an error', has(/kind "items" is an engine content file name/), errors.join('\n'));
    check('quests: optional on a plain step, only-optional parallel step, bad fail word are errors; onFail without fail warns',
      has(/step #1 of quest q1 has optional/) && has(/step #1 of quest q2 has only optional goals/) && has(/fail of quest q2 has an unknown word "flagg"/)
      && warnings.some(w => /quest q1 has onFail but no fail/.test(w)), [...errors, ...warnings].join('\n'));
    check('positions: floor must be a number', has(/floor of prop #1 must be a number/), errors.join('\n'));
    const { data } = await loadGame(dir);
    const map = kindMapLines(data, s => s).join('\n');
    check('GAMEMAP lists each kind with map() lines or its ids', map.includes('**recipes**') && map.includes('toast -> bred') && map.includes('2 entries: w1, w2'), map);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
