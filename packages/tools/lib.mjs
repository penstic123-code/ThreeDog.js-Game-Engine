// threedog lib: your own library of art and techniques from earlier games (models, textures, materials, shaders, effects, modules).
//   threedog lib add <file|folder|exportName> [-w game] [--name n] [--summary "..."] [--kind k] [--use "..."] [--backends webgl,webgpu]
//                    [--plug "makeIt({ ... })"] [--style toon,warm] [--usage "..."] [--no-proof] [--preview <scene-url|image.png>] [--no-preview] [--force] [--lib dir]
//                                               copy a piece of a game into the library (its local imports and the textures / models it names come along)
//   threedog lib list [words…] [--card] [-w game] [--lib dir]  one line per entry: name, kind, summary, backends and, when this game pulled it, whether its copy
//                                               changed; words narrow the list (all must match); --card prints each entry's card under it; an entry whose entry.json cannot be read is named with the reason at the end (exit 1)
//   threedog lib pull <name> [-w game] [--to dir/] [--plug "makeIt({ ... })"] [--force] [--dry] [--lib dir]
//                                               copy an entry into this game (same copy as `threedog art copy`) and print its use line, its import path set to where the file landed.
//                                               An entry that cannot draw on this game's renderer is refused with nothing copied (--force copies it to port by hand; lib check fails until then).
//                                               Code (shader / effect / module) is plugged at engine.start() with no line in main.js
//                                               (engine.plugins): its files land in plugins/<name>/ (a subfolder: not plugged itself) and pull
//                                               writes the wiring file plugins/<name>.js from the entry's plug line. Models and textures land in art/, a material in picture/ (it goes on a mesh in plain code, the plugins folder takes none)
//   (kind system: a whole gameplay system, a folder with a system.json: lib/lib-system.mjs. add checks it and proves it in an empty game when it has tests, --no-proof skips that)
//   (kind picture: one plain file from picture/ that stands alone, or a .glsl; pull puts it back under picture/ (picture/shaders/ for .glsl); a file that imports siblings is refused at add)
//   threedog lib status [-w game] [--lib dir]   what this game pulled: changed or not, newer in the library or not (it reports; it never changes a game file)
//   threedog lib check [-w game]                do the pulled things fit together: missing needs, two writers of one value and code the game's renderer cannot run fail, sizes and styles are notes (lib/lib-check.mjs)
//   threedog lib page [--lib dir]               write <library>/index.html: every preview with its summary and use line (open it in a browser)
// Where: ~/.threedog/library by default; THREEDOG_LIBRARY or --lib <dir> moves it. One folder per entry: the copied files, entry.json
//   ({ name, kind, summary, use, backends, params?, plug?, from, and the card: needs, provides, writes, size, style, usage; lib/lib-card.mjs }) and
//   preview.png when one could be made. The card is measured at add; an older entry without one gets it from its files when read.
// plug: how a code entry plugs in, as the text of its plugins/ wiring file with imports relative to the entry folder, e.g.
//   "import { makeWater } from './water.js';\nexport default makeWater();". Why a wiring file: library code usually exports a factory, and a
//   function is never a plugin (core/engine/plugins.js: it does not say where it plugs in), so a pulled factory needs one line that calls it. lib add
//   writes the line (--plug "makeWater({ size: 4 })", else the exported function asked for, else the one exported function, else a re-export
//   of a file's default value); pull writes it for an older entry the same way. Edit entry.json or the game's copy to change the arguments.
// Why outside the engine: the engine ships no art. The library is your own work from your own games; it is never installed with threedog.
// Why copy and not link: `pull` puts files into the game and the game adapts them (that is what keeps games from all looking alike). Nothing
//   links back, there is no update command, and an entry changes only when you `add` again (with --force when the content differs).
//   The game keeps a note of each pull in .threedog-lib.json (lib/lib-records.mjs): a record of where a copy came from, not a link.
// Previews: a model or texture gets the gallery's headless turntable shot when the game registers it (assets.js); a code entry gets one only
//   with --preview <url of a running scene> (shot of that page) or --preview picture.png. Without either the entry has no preview, and says so.
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, renameSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { copyArt, exportsOf, gameRoot } from './art.mjs';
import { changeWords, contentFiles, pullStatus, readRecords, recordPull } from './lib/lib-records.mjs';
import { backendsOf, cardLines, cardOf, sizeNotes } from './lib/lib-card.mjs';
import { checkGame, misfit, rendererOf } from './lib/lib-check.mjs';
import { proveEntry, pullSystem, readSystem, storeSystem, systemProblems } from './lib/lib-system.mjs';
import { parseOptions } from './lib/cli-args.mjs';
import { closest } from './lib/text.mjs';
import { posix } from './paths.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const KINDS = ['model', 'texture', 'material', 'shader', 'effect', 'module', 'system', 'picture', 'other'];
const NAME = /^[A-Za-z0-9][\w.-]*$/, CODE = /\.m?js$/, MODEL = /\.(glb|gltf)$/i, TEXTURE = /\.(png|jpe?g|webp|avif|gif|ktx2|basis|hdr|exr|svg)$/i;
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The library folder: --lib, else THREEDOG_LIBRARY, else ~/.threedog/library */
export function libraryDir({ lib, env = process.env } = {}) {
  return resolve(lib ?? env.THREEDOG_LIBRARY ?? join(homedir(), '.threedog', 'library'));
}

/** An entry with its card and renderers: what entry.json says wins; one stored before they existed gets them from its files */
const withCard = e => {
  const files = contentFiles(e.dir).map(f => join(e.dir, f));
  const card = e.usage !== undefined ? e : { ...cardOf(files, { use: e.use, plug: e.plug, summary: e.summary, tags: e.style?.tags }), ...e };
  return e.backends?.length ? card : { ...card, backends: backendsOf(files) };
};

/** The library read once: entries [{ ...entry.json, dir }] sorted by name, and broken [{ folder, why }]: a folder whose entry.json cannot be read,
 *  is not JSON or has no name (lib list names them; they used to drop out of the list silently). A folder without entry.json is not an entry */
export function readLibrary(lib) {
  const ok = [], broken = [];
  if (!existsSync(lib)) return { entries: ok, broken };
  for (const d of readdirSync(lib, { withFileTypes: true })) {
    if (!d.isDirectory() || !existsSync(join(lib, d.name, 'entry.json'))) continue;
    try {
      const e = JSON.parse(readFileSync(join(lib, d.name, 'entry.json'), 'utf8'));
      if (typeof e?.name !== 'string' || !e.name) broken.push({ folder: d.name, why: 'entry.json has no "name"' });
      else ok.push(withCard({ ...e, kind: e.kind === 'look' ? 'picture' : e.kind, dir: join(lib, d.name) }));   // 'look' was the old name of picture; a library stored before the rename still reads
    } catch (err) { broken.push({ folder: d.name, why: `entry.json: ${err.message.split('\n')[0]}` }); }
  }
  return { entries: ok.sort((a, b) => a.name.localeCompare(b.name)), broken };
}
/** Every readable entry, sorted by name (readLibrary also returns the broken ones) */
export const entries = lib => readLibrary(lib).entries;
/** One line naming the broken entries and why, or '' */
export const brokenLine = broken => broken.length
  ? `${broken.length} entr${broken.length === 1 ? 'y' : 'ies'} could not be read (fix or delete the folder, or lib add it again with --force): ${broken.map(b => `${b.folder} (${b.why})`).join('; ')}` : '';

/** The game folder named by -w (a path, or a workspace name of this monorepo), else the game around cwd */
export async function gameOf(w, cwd) {
  if (w === undefined) {
    const game = gameRoot(cwd) ?? resolve(cwd), pkg = join(game, 'package.json');
    // a repository root is not a game: art board wrote its page into the root's .threedog, outside every game
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, 'utf8')).workspaces) throw new Error(`${game} is a repository root, not a game: run this in the game's folder or name it with -w <game>`);
    return game;
  }
  const p = resolve(cwd, w);
  if (existsSync(p) && statSync(p).isDirectory()) return gameRoot(p) ?? p;
  const { findWorkspace } = await import('./paths.mjs'), d = findWorkspace(w);
  if (!d) throw new Error(`lib: game "${w}" not found (a folder path or a workspace name)`);
  return d;
}

/** Parameter names from the JSDoc above each exported function: { fn: ['a', 'b'] } */
function paramsOf(text) {
  const out = {};
  for (const m of text.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g))
    out[m[2]] = [...m[1].matchAll(/@param\s+(?:\{[^}]*\}\s+)?\[?([\w$]+)/g)].map(p => p[1]);
  return out;
}

/** What a copy out of an entry folder has to name: nothing for code (its imports bring the rest), every file for an entry without code (a lone .glsl too): a folder copy would take entry.json and the preview along */
function namesIn(dir) {
  const all = contentFiles(dir);
  return all.some(f => CODE.test(f)) ? [] : all;
}

/** Entry kinds that are code a plugins/ file can export (lib pull puts them there) */
const PLUGGABLE = ['shader', 'effect', 'module'];

/** Does this module text export the name (function, const, class, or export { name })? */
const exportsName = (text, id) => { const n = id.replace(/\$/g, '\\$'); return new RegExp(`export\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var|class)\\s+${n}(?![\\w$])|export\\s*\\{[^}]*\\b${n}(?![\\w$])`).test(text); };

/**
 * The plug line of a code entry: the text of its plugins/ wiring file, imports relative to the entry folder, or null when it cannot be told.
 * call: an expression like "makeWater({ size: 4 })" (its leading name must be exported by a file of the entry, subfolders too); fn: an exported
 * function name to call with no arguments. Without either: the one exported function, else a re-export of the one file's default value.
 * @param {string} dir the entry folder @param {{ call?: string, fn?: string, who?: string }} o who: the command, for the error
 */
function plugOf(dir, { call, fn, who = 'lib' } = {}) {
  const files = readdirSync(dir).filter(f => CODE.test(f) && statSync(join(dir, f)).isFile()).sort().map(f => ({ f, text: readFileSync(join(dir, f), 'utf8') }));
  const head = call ? (/^\s*([A-Za-z_$][\w$]*)/.exec(call) ?? [])[1] : fn;
  if (call && !head) throw new Error(`${who} --plug: "${call}" does not start with the name of an exported function (e.g. --plug "makeWater({ size: 4 })")`);
  if (head) {
    const code = contentFiles(dir).filter(f => CODE.test(f)), at = code.find(f => exportsName(readFileSync(join(dir, f), 'utf8'), head));
    if (!at) throw new Error(`${who} --plug: no file of the entry exports "${head}" (files: ${code.join(', ') || 'none'})`);
    return `import { ${head} } from './${at}';\nexport default ${call ?? head + '()'};\n`;
  }
  const values = files.filter(x => /export\s+default\b/.test(x.text) && !exportsOf(x.text).some(e => e.name === 'default'));
  if (files.length === 1 && values.length === 1) return `export { default } from './${files[0].f}';\n`;
  const fns = files.flatMap(x => exportsOf(x.text).map(e => ({ ...e, f: x.f })));
  if (fns.length !== 1) return null;
  const [{ name: n, f }] = fns;
  return n === 'default' ? `import make from './${f}';\nexport default make();\n` : `import { ${n} } from './${f}';\nexport default ${n}();\n`;
}

/** What the copied files say about the entry: kind, backends (lib-card.mjs), summary, params */
function infer(dir, picked, key) {
  const files = readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile());
  const text = files.filter(f => CODE.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
  const kind = picked.some(f => CODE.test(f))
    ? (/\bShaderMaterial\b|\bonBeforeCompile\b|\bwgsl\b|three\/tsl|NodeMaterial/.test(text) ? 'shader'
      : /particle|emitter|\bfx\b|effect|trail|spark/i.test(text.slice(0, 4000) + key) ? 'effect'
      : /Material\s*\(/.test(text) && !/new (THREE\.)?Mesh\b/.test(text) ? 'material' : 'module')
    : picked.some(f => MODEL.test(f)) ? 'model' : picked.some(f => TEXTURE.test(f)) ? 'texture' : 'other';
  const exps = picked.filter(f => CODE.test(f)).flatMap(f => exportsOf(readFileSync(f, 'utf8')));
  const params = [...new Set(picked.filter(f => CODE.test(f)).flatMap(f => { const p = paramsOf(readFileSync(f, 'utf8')); return exps.filter(e => p[e.name]).flatMap(e => p[e.name]); }))];
  return { kind, backends: backendsOf(files), summary: (exps.find(e => e.doc) ?? {}).doc ?? '', params };
}

/** Preview picture for a new entry: a given image, a shot of a running scene, or the gallery's turntable for a registered asset. Returns a note */
function makePreview(entryDir, { game, preview, key, kind }) {
  const out = join(entryDir, 'preview.png');
  try {
    if (preview && /\.png$/i.test(preview) && existsSync(resolve(preview))) { copyFileSync(resolve(preview), out); return 'preview: copied ' + preview; }
    if (preview) {   // a running scene: the shot tool opens a full URL as given (no build)
      const r = spawnSync(process.execPath, [join(HERE, 'shot.mjs'), preview, '--out', 'lib-preview.png', '--no-picture'], { cwd: game, encoding: 'utf8', timeout: 120000 });
      const f = join(game, '.threedog', 'shots', 'lib-preview.png');
      if (r.status === 0 && existsSync(f)) { copyFileSync(f, out); return 'preview: shot of ' + preview; }
      return `no preview: the shot of ${preview} failed (${(r.stderr || r.stdout || '').trim().split('\n').pop()})`;
    }
    if (kind === 'model' || kind === 'texture') {
      const r = spawnSync(process.execPath, [join(HERE, 'gallery.mjs'), '--shots', '--only', key, '--size', '256'], { cwd: game, encoding: 'utf8', timeout: 180000 });
      const dir = join(game, '.threedog', 'gallery');
      const f = existsSync(dir) ? readdirSync(dir).filter(n => n.startsWith(key + '-') && /\.png$/.test(n) && !/-(silhouette|value)\.png$/.test(n)).sort()[0] : null;
      if (r.status === 0 && f) { copyFileSync(join(dir, f), out); return 'preview: gallery turntable ' + f; }
      return `no preview: the gallery has no "${key}" in this game (register it in assets.js to get a turntable shot), or the shot failed`;
    }
  } catch (e) { return 'no preview: ' + e.message; }
  return 'no preview (code entry: add --preview <url of a running scene> or --preview picture.png)';
}

/** Take an entry's folder out of the way while a new one is built: back() puts it as it was, done() drops the old one (a --force that failed lost the entry) */
function setAside(dir, had) {
  const old = dir + '.replaced';
  rmSync(old, { recursive: true, force: true });
  if (had) renameSync(dir, old);
  return { back() { rmSync(dir, { recursive: true, force: true }); if (had) renameSync(old, dir); }, done() { rmSync(old, { recursive: true, force: true }); } };
}

/**
 * Copy a piece of a game into the library. target = a file, a folder (relative to cwd, the game, or its art/) or an exported function name.
 * Returns { name, dir, entry, writes, note, packages, missing } or { name, dir, refused } (paths whose content differs; nothing written).
 */
export async function addEntry(target, o = {}) {
  const held = {};
  try { const r = await storeEntry(target, o, held); held.aside?.done(); return r; } catch (e) { held.aside?.back(); throw e; }
}

async function storeEntry(target, { game: w, cwd = process.cwd(), lib, name, summary, kind, use, backends, plug, style, usage, preview, noPreview = false, noProof = false, force = false } = {}, held) {
  if (!target) throw new Error('lib add: name what to add: a file, a folder or an exported function name of the game');
  const game = await gameOf(w, cwd), L = libraryDir({ lib });
  const asPath = [resolve(cwd, target), resolve(game, target), resolve(game, 'art', target)].find(p => existsSync(p));
  const source = asPath ?? game, names = asPath ? [] : [target];
  const key = name ?? (asPath ? basename(asPath).replace(/\.[^.]+$/, '') : target);
  if (!NAME.test(key)) throw new Error(`lib add: "${key}" is not a usable entry name (letters, digits, - _ . ; pass --name)`);
  if (kind && !KINDS.includes(kind)) throw new Error(`lib add: --kind is one of ${KINDS.join(', ')}`);
  if (backends?.some(b => !['webgl', 'webgpu'].includes(b))) throw new Error(`lib add: --backends takes webgl, webgpu or both, not "${backends.join(',')}"`);
  const dir = join(L, key), exists = existsSync(join(dir, 'entry.json'));
  if (kind === 'system') return addSystem(asPath, { game, key, dir, exists, summary, use, style, usage, plug, backends, noPreview, noProof, preview, force }, held);
  // plan first against the existing entry: a changed file stops everything (same all-or-nothing rule as art copy)
  const plan = copyArt(source, names, { to: '.', game: dir, dry: true, cwd });
  // a picture entry is one plain file (or one .glsl) that stands alone: a file that imports siblings (./palette.js) would pull in files the entry
  // does not name, and the next game gets a half. Say so now instead of storing it
  const parts = plan.writes.length + plan.same.length + plan.conflicts.length;
  if (kind === 'picture' && parts > 1 && !force)
    throw new Error(`lib add --kind picture: ${basename(asPath ?? key)} imports siblings, so it cannot stand alone (${[...plan.writes, ...plan.same.map(to => ({ to })), ...plan.conflicts.map(to => ({ to }))].map(x => posix(relative(dir, x.to ?? x))).join(', ')}). A picture entry is one file: pass the palette in as a parameter of its function, or put the pieces in one file; --force stores them together anyway`);
  if (exists && !force && (plan.conflicts.length || (summary && JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')).summary !== summary)))
    return { name: key, dir, refused: plan.conflicts.length ? plan.conflicts.map(c => posix(relative(dir, c))) : ['entry.json (another summary)'] };
  if (force || !exists) held.aside = setAside(dir, exists);   // --force replaces the whole entry: no stale file of the old one stays
  const r = copyArt(source, names, { to: '.', game: dir, cwd });
  const got = infer(dir, r.picked, key);
  const k = kind ?? got.kind, line = plug || PLUGGABLE.includes(k) ? plugOf(dir, { call: plug, fn: names[0], who: 'lib add' }) : null;
  // the use line is what pull prints: the import line a pull into art/ would give (named function only when one was asked for), else the manifest line
  const home = k === 'picture' || k === 'material' ? 'picture' : 'art';   // picture and material entries land in picture/, everything else in art/
  const probe = copyArt(dir, namesIn(dir), { to: home, game: join(tmpdir(), 'threedog-lib-probe'), dry: true });
  const imports = probe.register.filter(l => l.startsWith('import')).map(l => names[0] && /\.m?js'/.test(l) ? l.replace(/\{[^}]*\}/, `{ ${names[0]} }`) : l);
  const entry = { name: key, kind: k, summary: summary ?? got.summary, use: use ?? (imports.length ? imports.join(' ') + (names[0] ? ` // ${names[0]}(...)` : '') : probe.register.join(' ')),
    backends: backends ?? got.backends, ...(got.params.length ? { params: got.params } : {}), ...(line ? { plug: line } : {}), from: `${basename(gameRoot(game) ?? game)} ${new Date().toISOString().slice(0, 10)}` };
  Object.assign(entry, cardOf(contentFiles(dir).map(f => join(dir, f)), { packages: r.packages, tags: style, usage, use: entry.use, plug: line ?? undefined, summary: entry.summary }));
  // adding again without --force keeps what the entry says (hand edits included, as the header promises); only what this command was told, or what comes from the files, changes
  if (exists && !force) {
    const told = { kind, use, backends, plug: plug && line, usage, ...(style && { style: entry.style }) };
    const was = JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')), { needs, provides, writes, size } = entry;
    Object.assign(entry, was, Object.fromEntries(Object.entries(told).filter(([, v]) => v !== undefined)), { needs, provides, writes, size });
  }
  writeFileSync(join(dir, 'entry.json'), JSON.stringify(entry, null, 2) + '\n');
  const note = noPreview ? 'no preview (--no-preview)' : makePreview(dir, { game, preview, key: basename(asPath ?? key).replace(/\.[^.]+$/, ''), kind: entry.kind });
  return { name: key, dir, entry, writes: r.writes.map(x => posix(relative(dir, x.to))), note, packages: r.packages, missing: r.missing, notes: sizeNotes(key, entry.size) };
}

/** Store a system folder as an entry: checked first, nothing written when it cannot go to another game (--force stores it anyway) */
async function addSystem(from, { game, key, dir, exists, summary, use, style, usage, plug, backends, noPreview, noProof, preview, force }, held) {
  if (!from || !statSync(from).isDirectory()) throw new Error(`lib add --kind system: name the system's folder (systems/${key}/), it holds system.json, the code, content, text and tests`);
  const sys = readSystem(from), files = contentFiles(from).map(f => join(from, f)), code = cardOf(files, {});
  const problems = systemProblems(from, sys, code.needs.modules);
  if (problems.length && !force) throw new Error(`lib add --kind system: ${key} cannot go to another game yet (--force stores it anyway):\n${problems.map(p => '  ' + p).join('\n')}`);
  if (exists && !force) return { name: key, dir, refused: ['entry already exists'] };
  held.aside = setAside(dir, exists);
  storeSystem(from, dir);
  const tests = contentFiles(dir).filter(f => /^tests\/[^/]+\.mjs$/.test(f)), call = plug ?? sys.plug;
  const line = plugOf(dir, { call, who: 'lib add' });
  const entry = { name: key, kind: 'system', summary: summary ?? sys.summary ?? '', use: use ?? `threedog lib pull ${key}: systems/${key}/ plus plugins/${key}.js`, backends: backends ?? backendsOf(contentFiles(dir).map(f => join(dir, f))), ...(line ? { plug: line } : {}), from: `${basename(gameRoot(game) ?? game)} ${new Date().toISOString().slice(0, 10)}` };
  const packages = [...new Set(contentFiles(dir).filter(f => CODE.test(f)).flatMap(f => [...readFileSync(join(dir, f), 'utf8').matchAll(/from\s*['"]([^.'"][^'"]*)['"]/g)].map(m => m[1].split('/')[0])))];
  Object.assign(entry, cardOf(contentFiles(dir).map(f => join(dir, f)), { packages, entries: sys.entries, tags: style, usage, use: entry.use, plug: line ?? undefined, summary: entry.summary }));
  entry.needs.modules = [...new Set([...entry.needs.modules, ...(sys.requires ?? [])])].sort();
  if (tests.length && !noProof) entry.proof = await proveEntry({ ...entry, dir }, game, into => pullEntryFrom({ ...entry, dir }, into));
  writeFileSync(join(dir, 'entry.json'), JSON.stringify(entry, null, 2) + '\n');
  const note = noPreview ? 'no preview (--no-preview)' : makePreview(dir, { game, preview, key, kind: 'system' });
  return { name: key, dir, entry, writes: contentFiles(dir), note, packages, missing: [], notes: [] };
}

/** Pull an entry not yet readable from the library (its entry.json comes last, after its proof) */
const pullEntryFrom = (e, game) => pullSystem(e, game, { plugText: () => e.plug.replace(/(from\s*['"])\.\//g, `$1../systems/${e.name}/`) });

/** Entries matching every word of the query (name, kind, summary, backends, use, style tags) */
export function listEntries(lib, query = []) {
  const words = query.flatMap(q => String(q).toLowerCase().split(/\s+/)).filter(Boolean);
  return entries(lib).filter(e => { const hay = [e.name, e.kind, e.summary, ...(e.backends ?? []), e.use, ...(e.style?.tags ?? [])].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); });
}

/**
 * Copy an entry into a game: the same copy as art copy, from the entry folder. A code entry going to plugins/ (the default) lands in
 * plugins/<name>/ and gets the wiring file plugins/<name>.js (its plug line, or --plug). Returns art copy's result plus
 * { entry, game, to, wiring: { file, text } | null }; a wiring file the game changed is a conflict like any other (nothing written).
 */
export async function pullEntry(name, { game: w, cwd = process.cwd(), lib, to, plug, force = false, dry = false } = {}) {
  const L = libraryDir({ lib }), all = entries(L), e = all.find(x => x.name === name);
  if (!e) {
    const near = closest(name, all.map(x => x.name));
    throw new Error(`lib pull: no entry "${name}" in ${L}` + (near ? ` (did you mean "${near}"?)` : all.length ? ` (threedog lib list shows ${all.length})` : ' (the library is empty: threedog lib add …)'));
  }
  const game = await gameOf(w, cwd);
  readRecords(game);   // a record file that cannot be read stops the pull here, before any file moves
  // here and not only in lib check: the game stops at start the moment the copy is used, so the time to say so is before the copy lands
  const wrong = misfit(name, e.backends, rendererOf(game));
  if (wrong && !force) throw new Error(`lib pull: nothing copied. ${wrong}. --force copies it anyway to port by hand; lib check fails until the copy fits`);
  // a picture entry goes to picture/ (a .glsl file to picture/shaders/); code that plugs goes to plugins/; the rest to art/
  to ??= e.kind === 'picture' ? (readdirSync(e.dir).some(f => /\.glsl$/.test(f)) ? 'picture/shaders' : 'picture') : e.kind === 'material' ? 'picture' : PLUGGABLE.includes(e.kind) ? 'plugins' : 'art';   // the plugins folder plugs code by what it exports (engine.plugins)
  if (e.kind === 'system') {
    const plugText = sys => { const text = (plug ? plugOf(e.dir, { call: plug, who: 'lib pull' }) : e.plug ?? plugOf(e.dir, { call: sys.plug, who: 'lib pull' })); if (!text) throw new Error(`lib pull: ${name} does not say what to call: add "plug" to its system.json, or pass --plug "makeIt({ ... })"`); return text.replace(/(from\s*['"])\.\//g, `$1../systems/${e.name}/`); };
    const r = await pullSystem(e, game, { force, dry, plugText });
    if (!dry && (force || !r.conflicts.length)) recordPull(game, e, [...r.writes.map(x => x.to), ...r.same, r.wiring.file]);
    return { entry: e, game, to: 'plugins', ...r };
  }
  // every file that landed goes into the game's record; a dry run or a stopped pull changed nothing, so it notes nothing
  const noted = (r, wiring = null) => { if (!dry && (force || !r.conflicts.length)) recordPull(game, e, [...r.writes.map(x => x.to), ...r.same, ...(wiring ? [wiring] : [])]); return r; };
  if (to.replace(/[\\/]+$/, '') !== 'plugins') return { entry: e, game, to, wiring: null, ...noted(copyArt(e.dir, namesIn(e.dir), { to, force, dry, cwd: game, game })) };
  // plugins/: the files in a subfolder (the folder plugs only its top-level files), and one wiring file that calls the entry's factory
  const text = (plug ? plugOf(e.dir, { call: plug, who: 'lib pull' }) : e.plug ?? plugOf(e.dir, { who: 'lib pull' }))?.replace(/(from\s*['"])\.\//g, `$1./${e.name}/`) ?? null;
  const file = join(game, 'plugins', e.name + '.js'), clash = text && existsSync(file) && readFileSync(file, 'utf8') !== text ? [file] : [];
  const plan = copyArt(e.dir, [], { to: `plugins/${e.name}`, force, dry: true, cwd: game, game });
  if (!force && (plan.conflicts.length || clash.length)) return { entry: e, game, to: 'plugins', wiring: null, ...plan, conflicts: [...plan.conflicts, ...clash] };
  const r = dry ? plan : copyArt(e.dir, [], { to: `plugins/${e.name}`, force, cwd: game, game });
  if (text && !dry) { mkdirSync(join(game, 'plugins'), { recursive: true }); writeFileSync(file, text); }
  return { entry: e, game, to: 'plugins', ...noted(r, text ? file : null), wiring: text ? { file, text } : null };
}

/**
 * The use line with its import paths set to where this pull put the files, from the game's root (main.js). The stored line names the path in the game the entry came
 * from, and --to can move a file, so only the pull knows the real path.
 */
function useLine(use, game, landed) {
  return String(use ?? '').replace(/(['"])\.{1,2}\/[^'"]*?([^'"/]+\.m?js)\1/g, (all, q, file) => {
    const at = landed.find(p => basename(p) === file);
    return at ? `${q}./${posix(relative(game, at))}${q}` : all;
  });
}

/** The shell of a static preview page: dark card grid, used by `lib page` and `art board`. style and body are added as they are */
export const htmlPage = ({ title, style = '', body }) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:14px sans-serif;background:#1d1d20;color:#ddd;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}article{background:#2a2a2f;padding:10px;border-radius:6px}
.pv{height:256px;display:flex;align-items:center;justify-content:center;background:#111}h2{margin:8px 0 2px;font-size:16px}small{color:#9ab}p{margin:4px 0}.b{color:#999;font-size:12px}code{display:block;word-break:break-all;font-size:12px;color:#cfe}${style}</style>
${body}`;

/** Write <library>/index.html: previews, summaries and use lines of all entries. Returns the file */
export function writePage(lib) {
  const list = entries(lib);
  const card = e => `<article><div class="pv">${existsSync(join(e.dir, 'preview.png')) ? `<img src="${esc(e.name)}/preview.png" alt="${esc(e.name)}" width="256" height="256">` : '<span>no preview</span>'}</div>
<h2>${esc(e.name)} <small>${esc(e.kind)}</small></h2><p>${esc(e.summary)}</p><p class="b">${esc((e.backends ?? []).join(' · '))}${e.params?.length ? ' · params: ' + esc(e.params.join(', ')) : ''}</p><code>${esc(e.use)}</code><p class="b">from ${esc(e.from)}</p></article>`;
  const f = join(lib, 'index.html');
  mkdirSync(lib, { recursive: true });
  writeFileSync(f, htmlPage({ title: 'threedog library', body: `<h1>threedog library <small>${list.length} entr${list.length === 1 ? 'y' : 'ies'}</small></h1><main>
${list.map(card).join('\n')}</main>\n` }));
  return f;
}

async function cli(argv) {
  const [sub, ...rest] = argv;
  const usage = 'Usage: threedog lib add <file|folder|exportName> [-w game] [--name n] [--summary s] [--kind k] [--use s] [--plug "makeIt({ ... })"] [--style a,b] [--usage s] [--no-proof] [--preview url|png] [--force] · lib list [words] [--card] [-w game] · lib status [-w game] · lib check [-w game] · lib pull <name> [-w game] [--to dir/ (default plugins/ for code, art/ for models and textures)] [--plug "makeIt({ ... })"] [--force] [--dry] · lib page · --lib <dir> (default ~/.threedog/library, or THREEDOG_LIBRARY)';
  const cwd = process.cwd();
  const spec = { add: { workspace: true, positional: true, flags: ['force', 'no-preview', 'no-proof'], values: ['lib', 'name', 'summary', 'kind', 'use', 'backends', 'plug', 'style', 'usage', 'preview'] },
    list: { workspace: true, positional: true, flags: ['card'], values: ['lib'] }, status: { workspace: true, values: ['lib'] }, check: { workspace: true }, pull: { workspace: true, positional: true, flags: ['force', 'dry'], values: ['lib', 'to', 'plug'] }, page: { values: ['lib'] } }[sub];
  if (!spec) { console.log(usage); return sub ? 1 : 0; }
  try {
    const { opt, rest: pos, workspace } = parseOptions(rest, spec);
    const lib = libraryDir({ lib: opt.lib });
    if (sub === 'check') {
      const game = await gameOf(workspace, cwd), r = checkGame(game);
      if (!r.pulled) { console.log(`${game} has pulled nothing from a library: nothing to check`); return 0; }
      for (const p of r.problems) console.log('✗ ' + p);
      for (const n of r.notes) console.log('! ' + n);
      console.log(`${r.pulled} pulled: ${r.problems.length} problem(s), ${r.notes.length} note(s). It reads this game's copies; a value set through a helper is not seen.`);
      return r.problems.length ? 1 : 0;
    }
    if (sub === 'add') {
      if (pos.length !== 1) throw new Error('lib add takes exactly one thing to add (a file, a folder or an exported function name)');
      const r = await addEntry(pos[0], { game: workspace, cwd, lib: opt.lib, name: opt.name, summary: opt.summary, kind: opt.kind, use: opt.use, plug: opt.plug, style: opt.style ? String(opt.style).split(',') : undefined, usage: opt.usage,
        backends: opt.backends ? String(opt.backends).split(',') : undefined, preview: opt.preview, noPreview: !!opt['no-preview'], noProof: !!opt['no-proof'], force: !!opt.force });
      if (r.refused) { console.error(`✗ nothing added: entry "${r.name}" already exists with different content (--force replaces it):\n` + r.refused.map(c => '  ' + c).join('\n')); return 1; }
      console.log(`added "${r.name}" (${r.entry.kind}) to ${r.dir}: ${r.writes.length} file(s)\n  ${r.entry.summary || '(no summary: pass --summary "...")'}\n  use: ${r.entry.use}${r.entry.plug ? `\n  plug (the plugins/ file lib pull writes): ${r.entry.plug.trim().replace(/\n/g, ' ')}` : ''}\n  ${r.note}`);
      console.log(cardLines(r.entry).map(l => '  ' + l).join('\n'));
      for (const n of r.notes) console.log('! ' + n);
      if (r.entry.proof) console.log(`${r.entry.proof.ok ? '✓ proved in an empty game' : '✗ NOT proved in an empty game'}: ${r.entry.proof.result}`);
      if (r.missing.length) console.log('Not found in the source (left as written):\n' + r.missing.map(m => '  ' + m).join('\n'));
      if (r.packages.length) console.log('Package imports (a game that pulls this needs them): ' + r.packages.join(', '));
      return 0;
    }
    if (sub === 'list') {
      const list = listEntries(lib, pos), broken = brokenLine(readLibrary(lib).broken);
      if (!list.length) console.log(pos.length ? `no entry matches "${pos.join(' ')}" in ${lib}` : broken ? `no readable entry in ${lib}` : `the library is empty (${lib}): threedog lib add <file|folder|exportName> -w <game>`);
      const game = await gameOf(workspace, cwd).catch(() => null);   // at a repository root there is no game to compare with, the list still stands
      const here = game ? pullStatus(game, entries(lib)) : [];
      for (const e of list) { const s = here.find(x => x.entry === e.name); console.log(`${e.name}  [${e.kind}]  ${e.summary}  (${(e.backends ?? []).join(', ')})${e.kind === 'system' ? (e.proof?.ok ? '  proved' : '  not proved') : ''}${s ? `  pulled here, ${changeWords(s)}` : ''}`); if (opt.card) console.log(cardLines(e).map(l => '  ' + l).join('\n')); }
      if (broken) console.log(`✗ ${broken}`);
      return broken ? 1 : 0;
    }
    if (sub === 'pull') {
      if (pos.length !== 1) throw new Error('lib pull takes one entry name (threedog lib list shows them)');
      const r = await pullEntry(pos[0], { game: workspace, cwd, lib: opt.lib, to: opt.to, plug: opt.plug, force: !!opt.force, dry: !!opt.dry });
      if (r.conflicts.length && !opt.force) {
        console.error(`✗ nothing copied: ${r.conflicts.length} file(s) already exist with different content (--force overwrites them):\n` + r.conflicts.map(c => '  ' + posix(relative(cwd, c))).join('\n'));
        return 1;
      }
      console.log(`${opt.dry ? 'would copy' : 'copied'} "${r.entry.name}": ${r.writes.length} file(s)${r.same.length ? ` (${r.same.length} already identical)` : ''}`);
      for (const w of r.writes) console.log('  ' + posix(relative(cwd, w.to)));
      if (r.packages.length) console.log(`Package imports kept as they are (this game needs them installed): ${r.packages.join(', ')}`);
      if (r.missing.length) console.log('Not found in the entry (fix by hand):\n' + r.missing.map(m => '  ' + m).join('\n'));
      if (r.contentNote) console.log(r.contentNote);
      if (r.to !== 'plugins') console.log(`use (paths from the game's root, as main.js imports it): ${useLine(r.entry.use, r.game, [...r.writes.map(w => w.to), ...r.same])}`);
      else if (r.wiring) console.log(`${opt.dry ? 'would write' : 'wrote'} ${posix(relative(cwd, r.wiring.file))} (plugged at engine.start(); describe().slots lists it):\n` + r.wiring.text.trim().split('\n').map(l => '  ' + l).join('\n') + '\nChange the arguments there; the code itself is in ' + posix(relative(cwd, join(r.game, r.entry.kind === 'system' ? 'systems' : 'plugins', r.entry.name))) + '/');
      else console.log(`No plug line: the entry does not say what to call. Pull again with --plug "makeIt({ ... })" (an exported function of plugins/${r.entry.name}/), or write plugins/${r.entry.name}.js yourself: import { makeIt } from './${r.entry.name}/file.js'; export default makeIt();`);
      if (r.register.length && r.entry.kind !== 'picture') console.log('Register (in the game code that sets up assets):\n' + r.register.map(l => '  ' + l).join('\n'));
      for (const n of sizeNotes(r.entry.name, r.entry.size)) console.log('! ' + n);
      console.log('The copies are this game\'s own now: adapt them to its picture; nothing links back and nothing updates them.');
      return 0;
    }
    if (sub === 'status') {
      const game = await gameOf(workspace, cwd), rows = pullStatus(game, entries(lib));
      if (!rows.length) console.log(`${game} has pulled nothing from a library (threedog lib list shows what there is)`);
      for (const s of rows) {
        console.log(`${s.entry}  [${s.kind}]  ${changeWords(s)}, ${{ same: 'same as the library', newer: 'NEWER in the library', gone: 'no longer in the library' }[s.library]}  (from ${s.from}, pulled ${s.pulled})`);
        for (const f of s.changed) console.log(`  changed here: ${f}`);
        for (const f of s.missing) console.log(`  deleted here: ${f}`);
      }
      if (rows.some(s => s.library === 'newer')) console.log('Nothing was changed. To see what a newer entry would touch: threedog lib pull <name> --dry; --force replaces this game\'s copies, edits included.');
      return 0;
    }
    const f = writePage(lib);
    console.log(`wrote ${f} (${entries(lib).length} entries): open it in a browser`);
    return 0;
  } catch (e) { console.error('✗ ' + e.message); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await cli(process.argv.slice(2)));
