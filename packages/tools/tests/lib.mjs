// threedog lib add / list / pull / page: a personal art library outside the engine. Offline, no browser, temp folders only (never the real home library).
// Why a unit test: the library is only useful if a pulled entry runs where it lands (imports rewritten, textures brought along), a good entry is never
// silently replaced by a different one, and the library location can be moved (a test or a second machine must not touch ~/.threedog).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { TOOLS } from '../paths.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { addEntry, listEntries, pullEntry, writePage, libraryDir } from '../lib.mjs';

// the engine's plugins loader and module type check, found through the installed package (core/ ships with it): createEngine needs a DOM,
// these two do not, and they are exactly what engine.start() runs on the plugins folder
const core = f => import(pathToFileURL(join(dirname(fileURLToPath(import.meta.resolve('threedog'))), 'core', f)).href);
const { Plugins } = await core('engine/plugins.js'), { checkType } = await core('engine/moduleTypes.js');

export const name = 'lib: add copies into an entry with entry.json, list filters by words and names broken entries, pull rewrites imports into another game and writes the plugins/ wiring file for a factory (it plugs at start), a different entry is refused without --force, THREEDOG_LIBRARY moves it';

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
    // [guard] an entry stored with the old kind word 'look' reads as picture
    mkdirSync(join(lib, 'oldlook'), { recursive: true });
    writeFileSync(join(lib, 'oldlook', 'entry.json'), JSON.stringify({ ...e, name: 'oldlook', kind: 'look' }));
    check('[guard] kind "look" (the old word) reads as picture', listEntries(lib, ['oldlook'])[0]?.kind === 'picture');
    rmSync(join(lib, 'oldlook'), { recursive: true });
    check('add: the module, its local import and its texture are copied into <library>/<name>/',
      ['sparks.js', 'parts/rand.js', 'tex/spark.png'].every(f => existsSync(join(lib, 'sparks', f))), JSON.stringify(r.writes));
    check('add: entry.json has name, kind, summary from the first JSDoc line, use line, backends, params and where it came from',
      e.name === 'sparks' && e.kind === 'effect' && e.summary === 'Orange sparks that fall and fade.' && /import \{ sparks \} from '\.\/art\/sparks\.js'/.test(e.use)
      && e.backends.join() === 'webgl,webgpu' && e.params.join() === 'count,spread' && /^game-a \d{4}-\d\d-\d\d$/.test(e.from)
      && e.plug === "import { sparks } from './sparks.js';\nexport default sparks();\n", JSON.stringify(e));
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
    const copied = readFileSync(join(b, 'plugins', 'sparks', 'sparks.js'), 'utf8'), wiring = readFileSync(join(b, 'plugins', 'sparks.js'), 'utf8');
    check('pull: a code entry\'s files land in plugins/<name>/ (not plugged themselves) and the relative imports point at the copies',
      existsSync(join(b, 'plugins', 'sparks', 'parts', 'rand.js')) && existsSync(join(b, 'plugins', 'sparks', 'tex', 'spark.png')) && copied.includes("from './parts/rand.js'") && copied.includes("'./tex/spark.png'") && copied.includes("from 'three'"), copied);
    check('pull: the wiring file plugins/<name>.js calls the factory from the entry\'s plug line', wiring === "import { sparks } from './sparks/sparks.js';\nexport default sparks();\n" && p.wiring?.text === wiring, wiring);
    check('pull: the entry\'s use line comes back, and entry.json / preview are not copied into the game', /sparks/.test(p.entry.use) && !existsSync(join(b, 'plugins', 'sparks', 'entry.json')) && !existsSync(join(b, 'plugins', 'entry.json')));

    // [guard] a factory entry (a module maker with a local helper) pulled into a fresh game plugs at start with no hand-written line:
    // the game's plugins/ top-level files go through engine.plugins exactly as the vite preset hands them over
    const c = join(tmp, 'game-c');
    put(join(c, 'package.json'), '{"name":"game-c","type":"module"}');
    put(join(a, 'systems', 'score.js'), "import { start } from './scoreStart.js';\n/** A score counter module */\nexport function scoreKeeper(o = {}) { return { name: 'score', type: 'rules', install(engine) { return { points: start + (o.bonus ?? 0) }; } }; }\n");
    put(join(a, 'systems', 'scoreStart.js'), 'export const start = 0;\n');
    await addEntry('systems/score.js', { game: a, cwd: tmp, lib, name: 'score-keeper', kind: 'module', noPreview: true, plug: 'scoreKeeper({ bonus: 5 })' });
    const pc = await pullEntry('score-keeper', { game: c, cwd: tmp, lib });
    const top = (await import('node:fs')).readdirSync(join(c, 'plugins')).filter(f => /\.m?js$/.test(f));
    const files = {};
    for (const f of top) files['./plugins/' + f] = await import(pathToFileURL(join(c, 'plugins', f)).href);
    const used = [], fake = { _started: false, _planChange() {}, use(m) { checkType(m); used.push(m); return this; }, modules: new Map() };
    let startErr = '';
    try { const pl = new Plugins(fake); pl.add(files); fake._started = true; pl._plugAll(); } catch (x) { startErr = x.message; }
    check('[guard] pull of a factory entry: only the wiring file is at the top of plugins/, it plugs at start with no error, and --plug arguments reach the factory',
      top.join() === 'score-keeper.js' && !startErr && used.length === 1 && used[0].name === 'score' && used[0].install().points === 5 && pc.wiring?.text.includes('scoreKeeper({ bonus: 5 })'), startErr || JSON.stringify({ top, used: used.map(m => m.name), wiring: pc.wiring }));
    // an entry with no plug line (written before plug lines existed) gets one inferred at pull; --plug on pull wins
    const old = JSON.parse(readFileSync(join(lib, 'score-keeper', 'entry.json'), 'utf8')); delete old.plug;
    writeFileSync(join(lib, 'score-keeper', 'entry.json'), JSON.stringify(old));
    const inferred = await pullEntry('score-keeper', { game: c, cwd: tmp, lib, dry: true, force: true });
    const given = await pullEntry('score-keeper', { game: c, cwd: tmp, lib, dry: true, force: true, plug: 'scoreKeeper({ bonus: 9 })' });
    let badPlug = '';
    try { await pullEntry('score-keeper', { game: c, cwd: tmp, lib, dry: true, plug: 'nothere()' }); } catch (x) { badPlug = x.message; }
    check('pull: an entry without a plug line gets the one exported function called; --plug sets the call; a name no file exports is refused',
      inferred.wiring?.text === "import { scoreKeeper } from './score-keeper/score.js';\nexport default scoreKeeper();\n" && given.wiring?.text.includes('scoreKeeper({ bonus: 9 })')
      && /no file of the entry exports "nothere"/.test(badPlug), JSON.stringify([inferred.wiring, given.wiring, badPlug]));
    const to = await pullEntry('glow-material', { game: b, cwd: tmp, lib, to: 'fx/mine' });
    check('pull --to: another folder of the game', existsSync(join(b, 'fx', 'mine', 'glow.js')) && to.writes.length === 1, JSON.stringify(to.writes));
    let miss = '';
    try { await pullEntry('spark', { game: b, cwd: tmp, lib }); } catch (x) { miss = x.message; }
    check('pull: an unknown name fails with a did-you-mean', /no entry "spark".*did you mean "sparks"/.test(miss), miss);

    // a different entry under the same name is refused, nothing written; --force replaces it whole
    put(join(a, 'art', 'sparks.js'), readFileSync(join(a, 'art', 'sparks.js'), 'utf8') + '\n// v2\n');
    const before = readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8');
    // [guard] a function in a subfolder of art/ was not found by name; adding again replaced what a person wrote into entry.json
    put(join(a, 'art', 'weather', 'rain.js'), "export function rain() { return 1; }\n");
    const deep = await addEntry('rain', { game: a, cwd: tmp, lib, kind: 'effect', noPreview: true });
    check('[guard] lib add finds an exported function in a subfolder and plugs it from there', /from '\.\/weather\/rain\.js'/.test(deep.entry.plug ?? ''), JSON.stringify(deep.entry));
    const entryFile = join(deep.dir, 'entry.json'), edited = { ...JSON.parse(readFileSync(entryFile, 'utf8')), summary: 'Written by hand', use: 'hand use line', mine: 1 };
    writeFileSync(entryFile, JSON.stringify(edited));
    await addEntry('rain', { game: a, cwd: tmp, lib, kind: 'effect', noPreview: true });
    const again = JSON.parse(readFileSync(entryFile, 'utf8'));
    check('[guard] adding again keeps a hand-edited entry.json', again.summary === 'Written by hand' && again.use === 'hand use line' && again.mine === 1, JSON.stringify(again));
    rmSync(deep.dir, { recursive: true });
    const refused = await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true });
    check('add again with changed content: refused, the entry is untouched', refused.refused?.includes('sparks.js') && readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8') === before, JSON.stringify(refused));
    let plugErr = '';
    try { await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true, force: true, plug: 'noSuchFunction()' }); } catch (e) { plugErr = e.message; }
    check('[guard] a --force that fails leaves the old entry as it was', !!plugErr && readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8') === before && existsSync(join(lib, 'sparks', 'entry.json')), plugErr);
    const same = await addEntry('sparks', { game: a, cwd: tmp, lib, noPreview: true, force: true });
    check('add --force: replaces the entry', !same.refused && readFileSync(join(lib, 'sparks', 'sparks.js'), 'utf8').endsWith('// v2\n'));
    // a pull must not overwrite a file the game edited
    writeFileSync(join(b, 'plugins', 'sparks.js'), wiring + '// edited\n');
    const blocked = await pullEntry('sparks', { game: b, cwd: tmp, lib });
    check('pull: a game file that differs (the wiring file, the code changed by --force add) stops the pull, nothing written',
      blocked.conflicts.length === 2 && readFileSync(join(b, 'plugins', 'sparks.js'), 'utf8').endsWith('// edited\n') && !readFileSync(join(b, 'plugins', 'sparks', 'sparks.js'), 'utf8').includes('// v2'), JSON.stringify(blocked.conflicts));

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
    check('cli: pull --dry lists the files and says it is plugged at start, writes nothing', pulled.status === 0 && /would copy "glow"/.test(pulled.stdout) && /would write plugins\/glow\.js \(plugged at engine\.start\(\)/.test(pulled.stdout) && /export default glow\(\)/.test(pulled.stdout) && !existsSync(join(b, 'plugins', 'glow.js')), pulled.stdout + pulled.stderr);

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
    check('list (API): the broken folders are not entries', !listEntries(lib).some(e => /^zz-/.test(e.name)) && listEntries(lib).length === 4, listEntries(lib).map(e => e.name).join());

    // picture entries: one file from picture/ goes in, comes back under picture/ (a .glsl under picture/shaders/); a file with siblings is refused at add
    const lib2 = join(tmp, 'library-picture'), gk = join(tmp, 'game-c');
    put(join(gk, 'package.json'), '{"name":"game-c"}');
    put(join(gk, 'picture', 'lights.js'), '/** Day and night light group */\nexport function makeLights(THREE) { return { update(s) { return s; } }; }\n');
    put(join(gk, 'picture', 'bad.js'), "import { day } from './palette.js';\nexport function makeBad() { return day; }\n");
    put(join(gk, 'picture', 'palette.js'), 'export const day = 1;\n');
    put(join(gk, 'picture', 'shaders', 'flat.glsl'), 'void main() { gl_FragColor = vec4(1.0); }\n');
    await addEntry('picture/lights.js', { game: gk, cwd: gk, lib: lib2, kind: 'picture', noPreview: true });
    await addEntry('picture/shaders/flat.glsl', { game: gk, cwd: gk, lib: lib2, kind: 'picture', noPreview: true });
    let sib = '';
    try { await addEntry('picture/bad.js', { game: gk, cwd: gk, lib: lib2, kind: 'picture', noPreview: true }); } catch (x) { sib = x.message; }
    check('picture: a file that imports a sibling is refused at add, naming the sibling; nothing is stored', /imports siblings/.test(sib) && /palette\.js/.test(sib) && !existsSync(join(lib2, 'bad')), sib);
    const d = join(tmp, 'game-d');
    put(join(d, 'package.json'), '{"name":"game-d"}');
    await pullEntry('lights', { game: d, cwd: d, lib: lib2 });
    await pullEntry('flat', { game: d, cwd: d, lib: lib2 });
    // [guard] a .glsl is no import follower: the entry counted as code, the folder copy found no .js and took the whole entry folder, entry.json included
    check('[guard] picture: pulling a lone .glsl brings that file only, not entry.json', !existsSync(join(d, 'picture', 'shaders', 'entry.json')), readdirSync(join(d, 'picture', 'shaders')).join());
    check('picture: pull puts the file back under picture/ (.glsl under picture/shaders/), not plugins/ or art/',
      readFileSync(join(d, 'picture', 'lights.js'), 'utf8').includes('makeLights') && existsSync(join(d, 'picture', 'shaders', 'flat.glsl')) && !existsSync(join(d, 'plugins')) && !existsSync(join(d, 'art')), [existsSync(join(d,'picture','lights.js')), existsSync(join(d,'picture','shaders','flat.glsl')), existsSync(join(d,'plugins')), existsSync(join(d,'art')), existsSync(join(d,'picture','flat.glsl'))].join());
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
