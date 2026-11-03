// threedog lib add / list / pull / page: a personal art library outside the engine. Offline, no browser, temp folders only (never the real home library).
// Why a unit test: the library is only useful if a pulled entry runs where it lands (imports rewritten, textures brought along), a good entry is never
// silently replaced by a different one, and the library location can be moved (a test or a second machine must not touch ~/.threedog).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { addEntry, listEntries, pullEntry, writePage, libraryDir } from '../lib.mjs';

export const name = 'lib: add copies into an entry with entry.json, list filters by words and names broken entries, pull rewrites imports into another game, a different entry is refused without --force, THREEDOG_LIBRARY moves it';

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-lib-'));
  const put = (p, t) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, t); };
  try {
    const a = join(tmp, 'game-a'), b = join(tmp, 'game-b'), lib = join(tmp, 'library');
    put(join(a, 'package.json'), '{"name":"game-a"}');
    put(join(a, 'art', 'sparks.js'), [
      "import * as THREE from 'three';",
      "import { rand } from './parts/rand.js';",
      "const tex = new URL('./tex/spark.png', import.meta.url);",
      '/** Orange sparks that fall and fade.',
      ' * @param {number} count how many',
      ' * @param {number} spread meters */',
      'export function sparks(count = 20, spread = 1) { return [THREE, rand, tex, count, spread]; }',
    ].join('\n'));
    put(join(a, 'art', 'parts', 'rand.js'), 'export const rand = 1;\n');
    put(join(a, 'art', 'tex', 'spark.png'), 'png');
    put(join(a, 'art', 'glow.js'), "/** Glow shader */\nexport const glow = () => new THREE.ShaderMaterial({ fragmentShader: 'gl_FragColor = vec4(1.0);' });\n");
    put(join(b, 'package.json'), '{"name":"game-b"}');

    // add by exported function name: the module, its helper and its texture come along, entry.json describes it
    const r = await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true });
    const e = JSON.parse(readFileSync(join(lib, 'sparks', 'entry.json'), 'utf8'));
    check('add: the module, its local import and its texture are copied into <library>/<name>/',
      ['sparks.js', 'parts/rand.js', 'tex/spark.png'].every(f => existsSync(join(lib, 'sparks', f))), JSON.stringify(r.writes));
    check('add: entry.json has name, kind, summary from the first JSDoc line, use line, backends, params and where it came from',
      e.name === 'sparks' && e.kind === 'effect' && e.summary === 'Orange sparks that fall and fade.' && /import \{ sparks \} from '\.\/art\/sparks\.js'/.test(e.use)
      && e.backends.join() === 'webgl,webgpu' && e.params.join() === 'count,spread' && /^game-a \d{4}-\d\d-\d\d$/.test(e.from), JSON.stringify(e));
    check('add: the preview note says there is none for a code entry', /no preview/.test(r.note), r.note);

    // a shader file by path, with the backend the code shows
    await addEntry('art/glow.js', { game: a, cwd: tmp, lib, name: 'glow-material', noPreview: true });
    const g = JSON.parse(readFileSync(join(lib, 'glow-material', 'entry.json'), 'utf8'));
    check('add by file path: --name, kind shader and backends webgl are read from the code', g.kind === 'shader' && g.backends.join() === 'webgl', JSON.stringify(g));

    // list / query
    check('list: every entry, one per name', listEntries(lib).map(x => x.name).join() === 'glow-material,sparks');
    check('list: words must all match (name, kind, summary, backends)', listEntries(lib, ['sparks']).length === 1 && listEntries(lib, ['orange', 'fade']).length === 1
      && listEntries(lib, ['orange', 'shader']).length === 0 && listEntries(lib, ['webgl']).length === 2 && listEntries(lib, ['shader']).length === 1);

    // pull into another game: imports rewritten for the new layout, texture beside it, no link back
    const p = await pullEntry('sparks', { game: b, cwd: tmp, lib });
    const copied = readFileSync(join(b, 'plugins', 'sparks.js'), 'utf8');
    check('pull: the files land in the game\'s plugins/ (a code entry) and the relative imports point at the copies',
      existsSync(join(b, 'plugins', 'parts', 'rand.js')) && existsSync(join(b, 'plugins', 'tex', 'spark.png')) && copied.includes("from './parts/rand.js'") && copied.includes("'./tex/spark.png'") && copied.includes("from 'three'"), copied);
    check('pull: the entry\'s use line comes back, and entry.json / preview are not copied into the game', /sparks/.test(p.entry.use) && !existsSync(join(b, 'plugins', 'entry.json')));
    const to = await pullEntry('glow-material', { game: b, cwd: tmp, lib, to: 'fx/mine' });
    check('pull --to: another folder of the game', existsSync(join(b, 'fx', 'mine', 'glow.js')) && to.writes.length === 1, JSON.stringify(to.writes));
    let miss = '';
    try { await pullEntry('spark', { game: b, cwd: tmp, lib }); } catch (x) { miss = x.message; }
    check('pull: an unknown name fails with a did-you-mean', /no entry "spark".*did you mean "sparks"/.test(miss), miss);

    // a different entry under the same name is refused, nothing written; --force replaces it whole
    put(join(a, 'art', 'sparks.js'), readFileSync(join(a, 'art', 'sparks.js'), 'utf8') + '\n// v2\n');
    const before = readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8');
    const refused = await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true });
    check('add again with changed content: refused, the entry is untouched', refused.refused?.includes('sparks.js') && readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8') === before, JSON.stringify(refused));
    const same = await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true, force: true });
    check('add --force: replaces the entry', !same.refused && readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8').endsWith('// v2\n'));
    // a pull must not overwrite a file the game edited
    writeFileSync(join(b, 'plugins', 'sparks.js'), copied + '\n// edited');
    const blocked = await pullEntry('sparks', { game: b, cwd: tmp, lib });
    check('pull: a game file that differs stops the pull, nothing written', blocked.conflicts.length === 1 && readFileSync(join(b, 'plugins', 'sparks.js'), 'utf8').endsWith('// edited'));

    // the page lists every entry
    const html = readFileSync(writePage(lib), 'utf8');
    check('page: index.html names every entry with its summary', html.includes('sparks') && html.includes('glow-material') && html.includes('Orange sparks that fall and fade.'));

    // the location: --lib, then THREEDOG_LIBRARY, then the home folder
    check('library location: --lib wins over THREEDOG_LIBRARY, which wins over ~/.threedog/library',
      libraryDir({ lib, env: { THREEDOG_LIBRARY: join(tmp, 'other') } }) === lib && libraryDir({ env: { THREEDOG_LIBRARY: join(tmp, 'other') } }) === join(tmp, 'other')
      && /\.threedog[\\/]library$/.test(libraryDir({ env: {} })));
    // the real command line: THREEDOG_LIBRARY moves the library, an unknown option fails, --help prints the header
    const cli = (args, env = {}) => spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', ...args], { cwd: b, encoding: 'utf8', env: { ...process.env, ...env } });
    const ls = cli(['list', 'orange'], { THREEDOG_LIBRARY: lib });
    check('cli: THREEDOG_LIBRARY is the library; list prints name, kind, summary, backends on one line', ls.status === 0 && /^sparks {2}\[effect\] {2}Orange sparks that fall and fade\. {2}\(webgl, webgpu\)/m.test(ls.stdout), ls.stdout + ls.stderr);
    const empty = cli(['list'], { THREEDOG_LIBRARY: join(tmp, 'nothing') });
    check('cli: an empty library says so and how to fill it', /library is empty.*lib add/.test(empty.stdout), empty.stdout);
    const typo = cli(['list', '--libb', lib]);
    check('cli: an unknown option fails naming the options', typo.status === 1 && /unknown option --libb/.test(typo.stderr), typo.stderr);
    const help = spawnSync(process.execPath, [join(TOOLS, 'bin', 'threedog.mjs'), 'lib', '--help'], { encoding: 'utf8' });
    check('cli: --help prints the usage from the script header', help.status === 0 && /threedog lib add/.test(help.stdout) && /threedog lib pull/.test(help.stdout), help.stdout);
    const added = cli(['add', 'glow', '-w', a, '--summary', 'Plain glow', '--no-preview'], { THREEDOG_LIBRARY: lib });
    check('cli: add -w <game> by name prints the entry, its use line and that there is no preview', added.status === 0 && /added "glow"/.test(added.stdout) && /use: /.test(added.stdout) && /no preview/.test(added.stdout), added.stdout + added.stderr);
    const pulled = cli(['pull', 'glow', '--dry'], { THREEDOG_LIBRARY: lib });
    check('cli: pull --dry lists the files and says it is plugged at start, writes nothing', pulled.status === 0 && /would copy "glow"/.test(pulled.stdout) && /Plugged at engine.start/.test(pulled.stdout) && !existsSync(join(b, 'plugins', 'glow.js')), pulled.stdout + pulled.stderr);

    // a bad name or kind fails before anything is written
    let bad = '';
    try { await addEntry('sparks', { game: a, cwd: tmp, lib, name: '../escape', noPreview: true }); } catch (x) { bad = x.message; }
    check('add: a name that could leave the library folder is refused', /not a usable entry name/.test(bad) && !existsSync(join(tmp, 'escape')), bad);

    // [guard] a broken entry is listed with its reason, not dropped from the list (an entry.json that is not JSON, one without a name)
    put(join(lib, 'zz-bad-json', 'entry.json'), '{ "name": "zz-bad-json", ');
    put(join(lib, 'zz-no-name', 'entry.json'), '{ "kind": "shader" }');
    const lsBroken = cli(['list'], { THREEDOG_LIBRARY: lib });
    check('[guard] cli: list still prints the good entries, then names each broken one with why, and exits 1',
      lsBroken.status === 1 && /^sparks /m.test(lsBroken.stdout) && /2 entries could not be read/.test(lsBroken.stdout)
      && /zz-bad-json \(entry\.json: /.test(lsBroken.stdout) && /zz-no-name \(entry\.json has no "name"\)/.test(lsBroken.stdout), lsBroken.stdout + lsBroken.stderr);
    check('list (API): the broken folders are not entries', !listEntries(lib).some(e => /^zz-/.test(e.name)) && listEntries(lib).length === 3, listEntries(lib).map(e => e.name).join());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
