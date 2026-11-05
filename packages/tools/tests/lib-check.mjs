// lib check: pieces from different places in one game. Why: each piece can be fine alone and still fight the others, and this is the owner's main worry.
// The check reads the game's copies, so editing a copy must clear a clash; that is the guard here, because a check that reads the library would keep
// reporting a problem the game already fixed.
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { addEntry, pullEntry } from '../lib.mjs';
import { checkGame, rendererOf } from '../lib/lib-check.mjs';
import { glb } from './lib-card.mjs';

export const name = 'lib check: a need nothing gives, two writers of one value and code the game\'s renderer cannot run fail with the fix; sizes and styles that do not fit are notes; it reads the game\'s copies, so an edit clears a clash';

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
    put(join(g, 'game', 'pack.js'), "import { inventory } from 'threedog';\nexport const pack = engine => engine.use(inventory());\n");   // installed from game/: the template's home for gameplay code
    const fixed = checkGame(g);
    check('[guard] an edit in the game\'s copy clears the clash, whatever the library still says', !fixed.problems.length && fixed.pulled === 5, fixed.problems.join('\n'));
    const ok = cli();
    check('cli: notes alone exit 0 and are still printed', ok.status === 0 && /share no style tag/.test(ok.stdout), ok.stdout + ok.stderr);

    // [guard] the renderer: found by a test game whose pulled GLSL sky stopped it at start while check said 0 problems and pull said nothing. What makes it pass must be the
    // game's code, not the entry's word: a GLSL entry refused, then copied with --force, then ported in place
    const gpu = join(tmp, 'gpu'), gl = join(tmp, 'gl');
    put(join(gpu, 'package.json'), '{"name":"gpu"}'); put(join(gl, 'package.json'), '{"name":"gl"}');
    put(join(gpu, 'main.js'), "// renderer: 'webgl' in a comment says nothing\nimport 'threedog/tsl';\nconst engine = createEngine({ renderer: 'webgpu', canvas });\n");
    put(join(gl, 'main.js'), "const engine = createEngine({ canvas });\n");
    { const f = join(tmp, 'cfg');
      const say = t => { put(join(f, 'main.js'), t); return rendererOf(f); };
      check('[guard] rendererOf: options held elsewhere are unknown, a nested spread is not', say('createEngine(cfg);') === null && say('createEngine({ ...cfg });') === null && say('createEngine();') === 'webgl' && say('createEngine({ bindings: { ...a } });') === 'webgl'); }
    check('rendererOf: reads the option, no option is WebGL, a game that does not say is unknown', rendererOf(gpu) === 'webgpu' && rendererOf(gl) === 'webgl' && rendererOf(src) === null, [rendererOf(gpu), rendererOf(gl), rendererOf(src)].join());
    put(join(src, 'picture', 'dome.js'), "/** Dome */\nexport function dome(THREE) { return new THREE.ShaderMaterial({ fragmentShader: 'void main(){ gl_FragColor = vec4(1.); }' }); }\n");
    put(join(src, 'picture', 'dome-node.js'), "/** Node dome */\nimport { MeshBasicNodeMaterial } from 'three/webgpu';\nexport function domeNode() { return new MeshBasicNodeMaterial(); }\n");
    put(join(src, 'picture', 'plain.js'), "/** Plain */\nexport function plain(THREE) { return new THREE.MeshStandardMaterial(); }\n");
    const e1 = await add('picture/dome.js', { kind: 'picture' }), e2 = await add('picture/dome-node.js', { kind: 'picture' }), e3 = await add('picture/plain.js', { kind: 'picture' });
    check('an entry says its renderers: GLSL webgl, node material webgpu, plain three.js both', e1.entry.backends.join() === 'webgl' && e2.entry.backends.join() === 'webgpu' && e3.entry.backends.join() === 'webgl,webgpu');
    const refused = (n, game) => pullEntry(n, { game, cwd: tmp, lib }).then(() => '', e => e.message);
    const why = await refused('dome', gpu);
    check('pull refuses GLSL into a WebGPU game, says why and how out, and copies nothing', /nothing copied.*dome draws only on WebGL.*runs on WebGPU.*recipe 56/.test(why) && !existsSync(join(gpu, 'picture', 'dome.js')), why);
    const why2 = await refused('dome-node', gl);
    check('pull refuses a node material into a WebGL game', /dome-node draws only on WebGPU and this game runs on WebGL/.test(why2) && !existsSync(join(gl, 'picture', 'dome-node.js')), why2);
    check('an entry that fits, and plain three.js on either renderer, pull as before', await refused('dome-node', gpu) === '' && await refused('plain', gpu) === '' && await refused('dome', gl) === '' && await refused('plain', gl) === '');
    check('a game that fits has no renderer problem', !checkGame(gpu).problems.length && !checkGame(gl).problems.length, checkGame(gpu).problems.join('\n'));
    await pullEntry('dome', { game: gpu, cwd: tmp, lib, force: true });
    const stuck = checkGame(gpu);
    check('--force copies it, and check fails on the copy with the same words', stuck.problems.some(p => /dome draws only on WebGL/.test(p)), stuck.problems.join('\n'));
    writeFileSync(join(gpu, 'picture', 'dome.js'), "import { MeshBasicNodeMaterial } from 'three/webgpu';\nexport function dome() { return new MeshBasicNodeMaterial(); }\n");
    check('[guard] the game ports its copy: check reads the copy, so the problem is gone', !checkGame(gpu).problems.length, checkGame(gpu).problems.join('\n'));

    // [guard] the printed path is where the file landed: the stored use line names the folder of the game it came from, and following it failed the page load
    await add('picture/plain.js', { kind: 'picture', name: 'old-path', use: "import { plain } from './look/plain.js';", force: true });
    const pull = (...a) => spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', 'pull', 'old-path', ...a], { cwd: gl, encoding: 'utf8', env: { ...process.env, THREEDOG_LIBRARY: lib } });
    const printed = pull().stdout, moved = pull('--to', 'picture/sky/').stdout;
    check('pull prints the path the file landed at, also with --to', /from '\.\/picture\/plain\.js'/.test(printed) && !/look/.test(printed) && /from '\.\/picture\/sky\/plain\.js'/.test(moved) && existsSync(join(gl, 'picture', 'sky', 'plain.js')), printed + moved);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
