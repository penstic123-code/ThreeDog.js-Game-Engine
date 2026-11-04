// Kind system: one folder that carries a whole gameplay system to another game, and proves it runs there.
// The fixture tests/fixtures/lib-system is a small working system, kept here and not in anyone's library.
// Why the proof is run for real: "stored" and "works elsewhere" are different claims, and only an empty game and a browser can back the second.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TOOLS } from '../paths.mjs';
import { addEntry, pullEntry, entries } from '../lib.mjs';
import { contentFiles, readRecords } from '../lib/lib-records.mjs';
import { storeSystem } from '../lib/lib-system.mjs';

export const name = 'lib system: add refuses hard-coded art, text, outside imports and unlisted requires; pull lands the folder, wiring, tests and one content line; an entry with tests is proved in an empty game and the result is stored';

export async function run({ check }) {
  const tmp = mkdtempSync(join(tmpdir(), 'threedog-lib-sys-'));
  try {
    const src = join(tmp, 'src'), g = join(tmp, 'game'), lib = join(tmp, 'library');
    storeSystem(join(TOOLS, 'tests', 'fixtures', 'lib-system'), src);
    mkdirSync(join(g, 'content'), { recursive: true });
    writeFileSync(join(g, 'package.json'), '{"name":"game"}');
    writeFileSync(join(g, 'content', 'index.js'), "import places from './places.js';\n\nexport default { places };\n");
    const add = (o = {}) => addEntry('systems/tide', { game: src, cwd: src, lib, kind: 'system', noPreview: true, noProof: true, ...o });

    // [guard] each thing that would keep it from another game stops the add, nothing stored
    const code = join(src, 'systems', 'tide', 'tide.js'), good = readFileSync(code, 'utf8');
    const refused = async text => { writeFileSync(code, text); let m = ''; try { await add(); } catch (x) { m = x.message; } writeFileSync(code, good); return m; };
    const color = await refused(good.replace('let t = 0;', 'let t = 0; const c = 0xff8800;'));
    const words = await refused(good.replace("const api = { level: 0 };", "const api = { level: 0, hint: { text: 'High tide' } };"));
    const outside = await refused(good.replace("import { words } from './text.js';", "import { words } from './text.js';\nimport '../other.js';"));
    const req = await refused(good.replace("requires: ['world']", "requires: ['world', 'hud']"));
    check('[guard] add refuses a color, naming the file and the way out', /tide\.js hard-codes a color.*parameter/.test(color), color);
    check('[guard] add refuses text in the code', /hard-codes text.*e\.t\('key'\)/.test(words), words);
    check('[guard] add refuses an import from outside the folder', /outside the folder/.test(outside), outside);
    check('[guard] add refuses a required module system.json does not list', /requires module "hud".*add it/.test(req), req);
    check('a refused system stores nothing', !existsSync(join(lib, 'tide')));
    let noJson = '';
    try { await addEntry('content', { game: src, cwd: src, lib, kind: 'system', noPreview: true }); } catch (x) { noJson = x.message; }
    mkdirSync(join(src, 'bare'));
    try { await addEntry('bare', { game: src, cwd: src, lib, kind: 'system', noPreview: true }); } catch (x) { noJson = x.message; }
    check('a folder without system.json is refused with what to write', /has no system\.json.*Write one/.test(noJson), noJson);

    const r = await add();
    check('add: nothing but the folder is stored', contentFiles(join(lib, 'tide')).length === 5, contentFiles(join(lib, 'tide')).join());
    check('add: the whole folder is stored with its card; system.json requires are needs', ['tide.js', 'text.js', 'content.js', 'system.json', 'tests/tide.mjs'].every(f => existsSync(join(lib, 'tide', f)))
      && r.entry.kind === 'system' && r.entry.needs.modules.join() === 'world' && r.entry.provides.modules.join() === 'tide' && !r.entry.proof, JSON.stringify(r.entry));

    const p = await pullEntry('tide', { game: g, cwd: g, lib });
    check('pull: the folder lands in systems/<name>/ and the tests where the game runs them', existsSync(join(g, 'systems', 'tide', 'tide.js')) && existsSync(join(g, 'tests', 'specs', 'tide-tide.mjs')) && !existsSync(join(g, 'systems', 'tide', 'tests')), JSON.stringify(p.writes.length));
    check('pull: the wiring file calls the plug line through systems/', readFileSync(join(g, 'plugins', 'tide.js'), 'utf8') === "import { tide } from '../systems/tide/tide.js';\nexport default tide({ period: 30 });\n", readFileSync(join(g, 'plugins', 'tide.js'), 'utf8'));
    const index = readFileSync(join(g, 'content', 'index.js'), 'utf8');
    check('pull: the content piece joins content/index.js', index.startsWith("import tide from '../systems/tide/content.js';\n") && /export default \{ places, \.\.\.tide \}/.test(index), index);
    await pullEntry('tide', { game: g, cwd: g, lib });
    check('pull again: content/index.js is not touched twice', readFileSync(join(g, 'content', 'index.js'), 'utf8') === index);
    check('pull: the record holds every file, the wiring and the tests; content/index.js stays the game\'s', Object.keys(readRecords(g)[0].files).includes('tests/specs/tide-tide.mjs') && Object.keys(readRecords(g)[0].files).includes('plugins/tide.js') && !Object.keys(readRecords(g)[0].files).includes('content/index.js'));

    // [guard] the proof: the real runner in an empty game. A broken system must come back not ok, so the stored mark means something
    const realModules = join(TOOLS, '..', '..');
    const proved = await addEntry('systems/tide', { game: realModules, cwd: src, lib, kind: 'system', noPreview: true, force: true });
    check('[guard] an entry with tests is proved in an empty game and the result stored', proved.entry.proof?.ok === true && /passed/.test(proved.entry.proof.result) && entries(lib).find(e => e.name === 'tide').proof?.ok === true, JSON.stringify(proved.entry?.proof));
    writeFileSync(code, good.replace("name: 'tide'", "name: 'tides'"));
    const broken = await addEntry('systems/tide', { game: realModules, cwd: src, lib, kind: 'system', noPreview: true, force: true });
    check('[guard] a system that does not work there is stored as not proved, with the reason', broken.entry.proof?.ok === false && !!broken.entry.proof.result, JSON.stringify(broken.entry?.proof));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
