// lib check: pieces from different places in one game. Why: each piece can be fine alone and still fight the others, and this is the owner's main worry.
// The check reads the game's copies, so editing a copy must clear a clash; that is the guard here, because a check that reads the library would keep
// reporting a problem the game already fixed.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { addEntry, pullEntry } from '../lib.mjs';
import { checkGame } from '../lib/lib-check.mjs';
import { glb } from './lib-card.mjs';

export const name = 'lib check: a need nothing gives and two writers of one value fail with the fix; sizes and styles that do not fit are notes; it reads the game\'s copies, so an edit clears a clash';

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-lib-check-'));
  const put = (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); };
  try {
    const src = join(tmp, 'source'), g = join(tmp, 'game'), lib = join(tmp, 'library');
    put(join(src, 'package.json'), '{"name":"source"}');
    put(join(g, 'package.json'), '{"name":"game","dependencies":{"threedog":"*"}}');
    put(join(g, 'main.js'), "import { world } from 'threedog';\nengine.use(world());\n");
    const sky = n => `/** ${n} */\nexport function ${n}(THREE, scene) { scene.fog = new THREE.Fog(0x808080, 1, 9); return { update() {} }; }\n`;
    put(join(src, 'picture', 'mist.js'), sky('mist'));
    put(join(src, 'picture', 'haze.js'), sky('haze'));
    put(join(src, 'systems', 'fishing.js'), "/** Fishing */\nexport function fishing() { return { name: 'fishing', type: 'rules', requires: ['world', 'inventory'], install() { return {}; } }; }\n");
    put(join(src, 'art', 'hero.glb'), glb([-0.3, 0, -0.3], [0.3, 1.8, 0.3]));
    put(join(src, 'art', 'tower.glb'), glb([-30, 0, -30], [30, 400, 30]));
    const add = (f, o) => addEntry(f, { game: src, cwd: tmp, lib, noPreview: true, ...o });
    await add('picture/mist.js', { kind: 'picture', style: ['painted'] });
    await add('picture/haze.js', { kind: 'picture', style: ['pixel'] });
    await add('systems/fishing.js', { name: 'fishing', kind: 'module' });
    await add('art/hero.glb', {});
    await add('art/tower.glb', {});
    for (const n of ['mist', 'haze', 'fishing', 'hero', 'tower']) await pullEntry(n, { game: g, cwd: tmp, lib });

    const r = checkGame(g), has = (l, re) => l.some(x => re.test(x));
    check('a module nothing installs is a problem with the line that installs it; a module the game uses is not',
      has(r.problems, /fishing needs module "inventory".*engine\.use\(inventory\(\)\)/) && !has(r.problems, /"world"/), r.problems.join('\n'));
    check('two entries writing one value is a problem naming both', has(r.problems, /mist and haze both write scene\.fog|haze and mist both write scene\.fog/), r.problems.join('\n'));
    check('sizes that do not fit are a note, not a problem', has(r.notes, /tower \(400 m\) is over 100 times/) && has(r.notes, /tower is 400 m long.*centimeters/) && !has(r.problems, /tower/), r.notes.join('\n'));
    check('styles with no tag in common are a note', has(r.notes, /share no style tag/) && !has(r.problems, /style/), r.notes.join('\n'));

    const cli = () => spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', 'check'], { cwd: g, encoding: 'utf8', env: { ...process.env, THREEDOG_LIBRARY: lib } });
    const bad = cli();
    check('cli: problems exit 1 and print the fix', bad.status === 1 && /both write scene\.fog/.test(bad.stdout + bad.stderr), bad.stdout + bad.stderr);

    // [guard] the check reads the copies: the game drops the fog line from one, and installs the module; nothing is a problem any more
    const haze = join(g, 'picture', 'haze.js');
    writeFileSync(haze, readFileSync(haze, 'utf8').replace('scene.fog = new THREE.Fog(0x808080, 1, 9); ', ''));
    put(join(g, 'main.js'), "import { world, inventory } from 'threedog';\nengine.use(world(), inventory());\n");
    const fixed = checkGame(g);
    check('[guard] an edit in the game\'s copy clears the clash, whatever the library still says', !fixed.problems.length && fixed.pulled === 5, fixed.problems.join('\n'));
    const ok = cli();
    check('cli: notes alone exit 0 and are still printed', ok.status === 0 && /share no style tag/.test(ok.stdout), ok.stdout + ok.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
