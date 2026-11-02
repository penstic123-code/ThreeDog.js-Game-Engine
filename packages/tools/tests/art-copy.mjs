// threedog art copy / list: copying art code from another game into this one (no dependency). Offline, no browser, temp folders only.
// Why a unit test: the copy is only useful if the copied files run where they land. A relative import that still points at the old layout, or a texture
// left behind, breaks the game silently at load time; and overwriting a file the game already edited would destroy its work.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listArt, copyArt } from '../art.mjs';

export const name = 'art: copy rewrites relative imports, brings referenced files, never overwrites without --force; list shows exports';

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-art-'));
  const put = (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); };
  try {
    // the source game: art/tree.js imports a helper inside art/, one outside it (../lib/noise.js), a texture by URL and a public/ model by '/...'
    const old = join(tmp, 'old-game'), now = join(tmp, 'new-game');
    put(join(old, 'package.json'), '{"name":"old-game"}');
    put(join(old, 'art', 'tree.js'), [
      "import * as THREE from 'three';",
      "import { leaves } from './parts/leaves.js';",
      "import { noise } from '../lib/noise';",
      "const bark = new URL('./tex/bark.png', import.meta.url);",
      "const well = '/models/well.glb';",
      '/** A pine tree, height in meters.',
      ' * @param {number} h */',
      'export function pine(h = 4) { return [THREE, leaves, noise, bark, well, h]; }',
      '/** A bare trunk */',
      'export const stump = () => pine(1);',
    ].join('\n'));
    put(join(old, 'art', 'parts', 'leaves.js'), "export const leaves = 1;\n");
    put(join(old, 'art', 'tex', 'bark.png'), 'png');
    put(join(old, 'art', 'rock.js'), '/** A rock */\nexport function rock() { return 0; }\n');
    put(join(old, 'lib', 'noise.js'), 'export const noise = 2;\n');
    put(join(old, 'public', 'models', 'well.glb'), 'glb');
    put(join(now, 'package.json'), '{"name":"new-game"}');

    const l = listArt('../old-game', now);
    const tree = l.modules.find(m => m.file === 'tree.js');
    check('list: the game\'s art/ folder is used, exported functions with their first JSDoc line',
      tree && tree.exports.some(e => e.name === 'pine' && e.doc === 'A pine tree, height in meters.') && tree.exports.some(e => e.name === 'stump' && e.doc === 'A bare trunk'), JSON.stringify(l.modules));
    check('list: asset files inside the art folder are listed', l.assets.includes('tex/bark.png'), JSON.stringify(l.assets));

    const r = copyArt('../old-game', ['pine'], { cwd: now });
    const copied = readFileSync(join(now, 'art', 'tree.js'), 'utf8');
    check('copy by function name: the module, its local imports and the files it names are written',
      ['art/tree.js', 'art/parts/leaves.js', 'art/tex/bark.png', 'art/shared/lib/noise.js', 'public/models/well.glb'].every(p => existsSync(join(now, p))), JSON.stringify(r.writes.map(w => w.to)));
    check('copy: an unnamed module (rock.js) is not copied', !existsSync(join(now, 'art', 'rock.js')));
    check('copy: an import from outside the art folder is rewritten to its new place; inside ones and /... URLs stay',
      copied.includes("from './shared/lib/noise.js'") && copied.includes("from './parts/leaves.js'") && copied.includes("'./tex/bark.png'") && copied.includes("'/models/well.glb'"), copied);
    check('copy: package imports are left as written and reported', copied.includes("from 'three'") && r.packages.includes('three'), JSON.stringify(r.packages));
    check('copy: prints the manifest lines (generator functions as models)',
      r.register[0] === "import { pine, stump } from './art/tree.js';" && /models: \{ pine, stump \}/.test(r.register[1] ?? ''), JSON.stringify(r.register));

    // the game edits its copy: a second copy must not destroy that without --force, and must write nothing at all
    writeFileSync(join(now, 'art', 'tree.js'), copied + '\n// edited by this game');
    rmSync(join(now, 'art', 'parts', 'leaves.js'));
    const again = copyArt('../old-game', ['tree'], { cwd: now });
    check('no --force: an edited file stops the copy and nothing is written (not even the missing helper)',
      again.conflicts.length === 1 && readFileSync(join(now, 'art', 'tree.js'), 'utf8').endsWith('// edited by this game') && !existsSync(join(now, 'art', 'parts', 'leaves.js')), JSON.stringify(again.conflicts));
    const forced = copyArt('../old-game', ['tree'], { cwd: now, force: true });
    check('--force overwrites; identical files are skipped', forced.conflicts.length === 0 && readFileSync(join(now, 'art', 'tree.js'), 'utf8') === copied
      && existsSync(join(now, 'art', 'parts', 'leaves.js')) && forced.same.length >= 1, JSON.stringify(forced));
    let err = '';
    try { copyArt('../old-game', ['nothing-here'], { cwd: now }); } catch (e) { err = e.message; }
    check('an unknown name is an error that names art list', /art list/.test(err), err);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
