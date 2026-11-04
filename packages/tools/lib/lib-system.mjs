// Kind `system`: a whole gameplay system as one library entry. A folder systems/<name>/ of a game holds the module code, its content piece, its text,
// its tests and a system.json:
//   { "summary": "...", "module": "tide.js", "plug": "tide({ period: 30 })", "requires": ["world"], "entries": [], "content": "content.js", "text": "text.js" }
//   module: the file with the factory; plug: the call (default: the one exported function); requires: engine modules; entries: other library entries;
//   content: a file whose default export is merged into the game's content; text: a file of i18n strings; tests go in tests/*.mjs as game specs.
// Why a folder and not a module: a module alone leaves its content, text and tests behind, and the next game gets half a system.
// Why add refuses hard-coded art and text: the system goes to a game with another picture and language; a color in it would make every game alike.
// Where a pull puts things: systems/<name>/, a wiring file plugins/<name>.js, tests in tests/specs/<name>-<file> (only that folder is run), one line in
//   content/index.js. Proof: an entry with tests is pulled into an empty game and run there at add (proveEntry); the result stays in entry.json.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentFiles } from './lib-records.mjs';
import { copyTemplates } from './scaffold.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CODE = /\.m?js$/;
const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const ART = [[/\b0x[0-9a-fA-F]{6}\b|['"]#[0-9a-fA-F]{6}['"]/, 'a color'], [/['"`][^'"`\n]*\.(?:png|jpe?g|webp|glb|gltf|ktx2|hdr)['"`]/, 'an art file']];
const TEXT = /\b(?:text|title|message|tooltip)\s*:\s*['"`]|\.textContent\s*=\s*['"`]/;

/** system.json of a folder, or a thrown error that shows what to write */
export function readSystem(dir, who = 'lib add --kind system') {
  const f = join(dir, 'system.json');
  if (!existsSync(f)) throw new Error(`${who}: ${dir} has no system.json. Write one: { "summary": "...", "module": "file.js", "requires": ["world"] }`);
  let s;
  try { s = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { throw new Error(`${who}: ${f} is not JSON (${e.message.split('\n')[0]})`); }
  if (typeof s.module !== 'string' || !existsSync(join(dir, s.module))) throw new Error(`${who}: system.json "module" must name the file with the factory (got ${JSON.stringify(s.module)})`);
  return s;
}

/** Everything that keeps a folder from being a system another game can take; each line says what to do. @param {string} dir @param {any} sys @param {string[]} needed module names the code requires */
export function systemProblems(dir, sys, needed) {
  const out = [], own = new Set([sys.content, sys.text].filter(Boolean));
  for (const f of contentFiles(dir).filter(x => CODE.test(x))) {
    const text = noComments(readFileSync(join(dir, f), 'utf8'));
    for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      const to = relative(dir, resolve(dir, dirname(f), m[1]));
      if (to.startsWith('..')) out.push(`${f} imports ${m[1]}, outside the folder: move that file in, or pass the value as a parameter`);
    }
    if (f.startsWith('tests/') || own.has(f)) continue;   // content and text are where art names and words belong
    for (const [re, what] of ART) { const m = re.exec(text); if (m) out.push(`${f} hard-codes ${what} (${m[0]}): take it as a parameter or a style value, so each game gives its own`); }
    const t = TEXT.exec(text);
    if (t) out.push(`${f} hard-codes text (${t[0]}…): use e.t('key') with the words in i18n (system.json "text")`);
  }
  for (const m of needed) if (!(sys.requires ?? []).includes(m)) out.push(`the code requires module "${m}" but system.json "requires" does not list it: add it`);
  return out;
}

/** Copy a system folder into an entry folder, file by file (fs.cpSync on a folder fails with EIO on some Windows paths) */
export function storeSystem(from, dir) {
  for (const f of contentFiles(from).filter(x => !x.startsWith('node_modules/'))) { mkdirSync(dirname(join(dir, f)), { recursive: true }); copyFileSync(join(from, f), join(dir, f)); }
}

/** Where each entry file goes in a game: [from, to], tests to tests/specs/ because that is the only folder the game's runner reads */
const placesOf = (e, game) => contentFiles(e.dir).map(f => {
  const test = /^tests\/([^/]+\.mjs)$/.exec(f);
  return [join(e.dir, f), test ? join(game, 'tests', 'specs', `${e.name}-${test[1]}`) : join(game, 'systems', e.name, f)];
});

// shortcut: a spread, so a section the game already has (items, say) is replaced by the system's; merge section by section when a real system needs one
/** The content/index.js with the system's content merged in, or null when its shape is not the usual one (the caller prints the line to add) */
function withContent(text, id, path) {
  const m = /export default \{([^}]*)\}/.exec(text);
  if (!m) return null;
  const merged = text.replace(m[0], () => `export default {${m[1].trimEnd()}, ...${id} }`);
  return `import ${id} from '${path}';\n${merged}`;
}

/** Pull a system entry: same all-or-nothing rule as art copy. Returns the shape of copyArt's result plus wiring and contentNote */
export function pullSystem(e, game, { force = false, dry = false, plugText }) {
  const sys = readSystem(e.dir, 'lib pull'), places = placesOf(e, game), id = e.name.replace(/\W+(\w)/g, (_, c) => c.toUpperCase()).replace(/\W/g, '');
  const file = join(game, 'plugins', e.name + '.js'), text = plugText(sys);
  const differs = (to, body) => existsSync(to) && !readFileSync(to).equals(body);
  const conflicts = [...places.filter(([f, to]) => differs(to, readFileSync(f))).map(([, to]) => to), ...(differs(file, Buffer.from(text)) ? [file] : [])];
  const r = { writes: places.filter(([f, to]) => !existsSync(to) || differs(to, readFileSync(f))).map(([from, to]) => ({ from, to })), same: places.filter(([f, to]) => existsSync(to) && !differs(to, readFileSync(f))).map(([, to]) => to),
    conflicts, packages: e.needs?.packages ?? [], missing: [], register: [], wiring: { file, text }, contentNote: null };
  if (dry || (conflicts.length && !force)) return r;
  for (const [from, to] of places) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
  mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text);
  if (sys.content) {
    const index = join(game, 'content', 'index.js'), path = `../systems/${e.name}/${sys.content}`, was = existsSync(index) ? readFileSync(index, 'utf8') : null;
    if (was?.includes(path)) return r;   // pulled before: the line is there
    const now = was && withContent(was, id, path);
    if (now) { writeFileSync(index, now); r.contentNote = `content/index.js now merges systems/${e.name}/${sys.content}`; }
    else r.contentNote = `add to the game's content: import ${id} from '${path}'; and ...${id} in the object content.load gets`;
  }
  return r;
}

/** The node_modules a game resolves threedog from, or null */
function modulesOf(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) { if (existsSync(join(d, 'node_modules', 'threedog'))) return join(d, 'node_modules'); if (dirname(d) === d) return null; }
}

/**
 * Pull an entry into an empty game and run its tests there. Returns what goes in entry.json: { ok, date, result } (result: the runner's last line, or why it did not run).
 * Why a real empty game and a real browser: an entry "works" only if it works without the game it came from; that is the claim being stored.
 * @param {any} e entry @param {string} from the game it came from (its node_modules run the test) @param {(game: string) => Promise<any>} pull pulls e into a game
 */
export async function proveEntry(e, from, pull) {
  const date = new Date().toISOString().slice(0, 10), modules = modulesOf(from), no = result => ({ ok: false, date, result });
  if (!modules) return no(`not run: ${from} has no node_modules with threedog (npm install there, then lib add again)`);
  const game = mkdtempSync(join(tmpdir(), 'threedog-lib-proof-'));
  try {
    copyTemplates(game, { name: 'proof', example: false, openWorld: false });
    symlinkSync(modules, join(game, 'node_modules'), 'junction');
    await pull(game);
    // an empty game has only the template's modules: install what the entry says it needs (the template's own stay as they are)
    const extra = (e.needs?.modules ?? []).filter(m => !['world', 'content', 'settings'].includes(m));
    if (extra.length) {
      const main = join(game, 'main.js'), text = readFileSync(main, 'utf8');
      writeFileSync(main, `import { ${extra.join(', ')} } from 'threedog';\n` + text.replace(/^(engine\.use\(world\(\).*)$/m, `$1\nengine.use(${extra.map(m => m + '()').join(', ')});`));
    }
    const r = spawnSync(process.execPath, [join(HERE, '..', 'bin', 'threedog.mjs'), 'test'], { cwd: game, encoding: 'utf8', timeout: 300000 });
    const lines = `${r.stdout}\n${r.stderr}`.trim().split('\n'), total = lines.filter(l => /^Total: /.test(l)).pop();
    const why = lines.filter(l => l.includes('✗')).slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 400); return { ok: r.status === 0, date, result: [total ?? `the run stopped: ${lines.slice(-2).join(' ').slice(0, 300)}`, r.status ? why : ''].filter(Boolean).join(' · ') };
  } catch (x) { return no(`not run: ${x.message.split('\n')[0]}`); } finally {
    // the junction goes first and alone: removing the temp game must never walk into the real node_modules
    try { rmSync(join(game, 'node_modules')); } catch {}
    if (!existsSync(join(game, 'node_modules'))) rmSync(game, { recursive: true, force: true });
  }
}
