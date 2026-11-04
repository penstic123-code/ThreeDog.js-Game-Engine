// A new game opens on the engine's path: three field runs on a template that said only "plain three.js" rewrote save, pause and menus by hand (more code than
// plain three.js). So save, Esc pause and the start screen stay wired in main.js, the "Already here" table stays the first section of CLAUDE.md, every row points
// at a recipe that exists, and the blank template stays genre-free (no player, no camera rig, no ground). Offline, reads files only.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE, TOOLS } from '../paths.mjs';

export const name = 'template engine first: save, pause and start screen wired; the Already here table leads; blank stays genre-free';

const read = (...p) => readFileSync(join(TOOLS, 'templates', ...p), 'utf8');
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

export async function run({ check }) {
  for (const t of ['game', 'openworld']) {
    const main = code(read(t, 'main.js'));
    check(`${t}: autosave wired`, /engine\.saves\.autosave\(/.test(main));
    check(`${t}: the start screen is on (Continue is what loads the autosave)`, /title: \{ title: '__NAME__' \}/.test(main));
    check(`${t}: Esc pauses, not only opens the menu`, /settings(\(|: )\{ freezeWorld: true \}/.test(main));
  }
  check('the template names no style folder or style key: its picture is picture/', !/style\/|style\.\w/.test(read('game', 'DESIGN.md') + read('game', 'tsconfig.json') + read('game', 'assets.js'))
    && read('game', 'tsconfig.json').includes('"picture/**/*"'));
  const blank = code(read('game', 'main.js'));
  check('blank assumes no player, camera rig or ground', !/createPlayer|followCamera|characters\(|openWorld|terrain|setGround/.test(blank));

  const claude = read('game', 'CLAUDE.md'), heads = [...claude.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  check('Already here is the first section of the template CLAUDE.md', heads[0] === 'Already here', heads.join(' | '));
  const table = claude.slice(claude.indexOf('## Already here'), claude.indexOf('## First session'));
  for (const need of ['Save', 'Esc pause', 'quality', 'Input', 'Camera', 'character', 'HUD', 'Sounds', 'Tests']) check(`the table covers: ${need}`, table.includes(need));
  const recipes = readdirSync(join(ENGINE, 'docs', 'recipes')).map(f => f.slice(0, 2));
  const named = [...table.matchAll(/\| ([\d, §]+) \|$/gm)].flatMap(m => m[1].match(/(?<!§)\b\d\d\b/g) ?? []);
  check('the table names recipes, and each exists', named.length >= 6 && named.every(n => recipes.includes(n)), named.join());
}
