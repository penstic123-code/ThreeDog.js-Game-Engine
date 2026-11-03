// threedog lib: your own library of art and techniques from earlier games (models, textures, materials, shaders, effects, modules).
//   threedog lib add <file|folder|exportName> [-w game] [--name n] [--summary "..."] [--kind k] [--use "..."] [--backends webgl,webgpu]
//                    [--preview <scene-url|image.png>] [--no-preview] [--force] [--lib dir]
//                                               copy a piece of a game into the library (its local imports and the textures / models it names come along)
//   threedog lib list [words…] [--lib dir]      one line per entry: name, kind, summary, backends; words narrow the list (all must match);
//                                               an entry whose entry.json cannot be read is named with the reason at the end (exit 1)
//   threedog lib pull <name> [-w game] [--to dir/] [--force] [--dry] [--lib dir]
//                                               copy an entry into this game (same copy as `threedog art copy`) and print its use line.
//                                               Code (shader / material / effect / module) lands in plugins/ by default, so it is plugged at
//                                               engine.start() with no line in main.js (engine.plugins); models and textures land in art/
//   threedog lib page [--lib dir]               write <library>/index.html: every preview with its summary and use line (open it in a browser)
// Where: ~/.threedog/library by default; THREEDOG_LIBRARY or --lib <dir> moves it. One folder per entry: the copied files, entry.json
//   ({ name, kind, summary, use, backends, params?, from }) and preview.png when one could be made.
// Why outside the engine: the engine ships no art. The library is your own work from your own games; it is never installed with threedog.
// Why copy and not link: `pull` puts files into the game and the game adapts them (that is what keeps games from all looking alike). Nothing
//   links back, there is no update command, and an entry changes only when you `add` again (with --force when the content differs).
// Previews: a model or texture gets the gallery's headless turntable shot when the game registers it (assets.js); a code entry gets one only
//   with --preview <url of a running scene> (shot of that page) or --preview picture.png. Without either the entry has no preview, and says so.
import { existsSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { join, resolve, basename, relative, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { copyArt, exportsOf, gameRoot } from './art.mjs';
import { parseOptions } from './lib/cli-args.mjs';
import { closest } from './lib/text.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const KINDS = ['model', 'texture', 'material', 'shader', 'effect', 'module', 'other'];
const NAME = /^[A-Za-z0-9][\w.-]*$/, CODE = /\.m?js$/, MODEL = /\.(glb|gltf)$/i, TEXTURE = /\.(png|jpe?g|webp|avif|gif|ktx2|basis|hdr|exr|svg)$/i;
const posix = p => p.split(sep).join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The library folder: --lib, else THREEDOG_LIBRARY, else ~/.threedog/library */
export function libraryDir({ lib, env = process.env } = {}) {
  return resolve(lib ?? env.THREEDOG_LIBRARY ?? join(homedir(), '.threedog', 'library'));
}

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
      else ok.push({ ...e, dir: join(lib, d.name) });
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
async function gameOf(w, cwd) {
  if (w === undefined) return gameRoot(cwd) ?? resolve(cwd);
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

/** Entry kinds that are code a plugins/ file can export (lib pull puts them there) */
const PLUGGABLE = ['shader', 'material', 'effect', 'module'];

/** What the copied files say about the entry: kind, backends (as far as the code shows), summary, params */
function infer(dir, picked, key) {
  const files = readdirSync(dir, { recursive: true }).map(f => join(dir, String(f))).filter(f => statSync(f).isFile());
  const text = files.filter(f => CODE.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
  const kind = picked.some(f => CODE.test(f))
    ? (/\bShaderMaterial\b|\bonBeforeCompile\b|\bwgsl\b|three\/tsl|NodeMaterial/.test(text) ? 'shader'
      : /particle|emitter|\bfx\b|effect|trail|spark/i.test(text.slice(0, 4000) + key) ? 'effect'
      : /Material\s*\(/.test(text) && !/new (THREE\.)?Mesh\b/.test(text) ? 'material' : 'module')
    : picked.some(f => MODEL.test(f)) ? 'model' : picked.some(f => TEXTURE.test(f)) ? 'texture' : 'other';
  // backends: only what the code shows. WebGPU-only and WebGL-only APIs are named; plain three.js code works on both
  const webgpu = /\bwgsl\b|StorageBufferAttribute|renderer\.compute/.test(text);
  const webgl = /\bShaderMaterial\b|\bRawShaderMaterial\b|\bonBeforeCompile\b|\bglsl\b|gl_FragColor|WebGLRenderTarget/.test(text);
  const backends = webgpu && !webgl ? ['webgpu'] : webgl && !webgpu ? ['webgl'] : ['webgl', 'webgpu'];
  const exps = picked.filter(f => CODE.test(f)).flatMap(f => exportsOf(readFileSync(f, 'utf8')));
  const params = [...new Set(picked.filter(f => CODE.test(f)).flatMap(f => { const p = paramsOf(readFileSync(f, 'utf8')); return exps.filter(e => p[e.name]).flatMap(e => p[e.name]); }))];
  return { kind, backends, summary: (exps.find(e => e.doc) ?? {}).doc ?? '', params };
}

/** Preview picture for a new entry: a given image, a shot of a running scene, or the gallery's turntable for a registered asset. Returns a note */
function makePreview(entryDir, { game, preview, key, kind }) {
  const out = join(entryDir, 'preview.png');
  try {
    if (preview && /\.png$/i.test(preview) && existsSync(resolve(preview))) { copyFileSync(resolve(preview), out); return 'preview: copied ' + preview; }
    if (preview) {   // a running scene: the shot tool opens a full URL as given (no build)
      const r = spawnSync(process.execPath, [join(HERE, 'shot.mjs'), preview, '--out', 'lib-preview.png', '--no-look'], { cwd: game, encoding: 'utf8', timeout: 120000 });
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

/**
 * Copy a piece of a game into the library. target = a file, a folder (relative to cwd, the game, or its art/) or an exported function name.
 * Returns { name, dir, entry, writes, note, packages, missing } or { name, dir, refused } (paths whose content differs; nothing written).
 */
export async function addEntry(target, { game: w, cwd = process.cwd(), lib, name, summary, kind, use, backends, preview, noPreview = false, force = false } = {}) {
  if (!target) throw new Error('lib add: name what to add: a file, a folder or an exported function name of the game');
  const game = await gameOf(w, cwd), L = libraryDir({ lib });
  const asPath = [resolve(cwd, target), resolve(game, target), resolve(game, 'art', target)].find(p => existsSync(p));
  const source = asPath ?? game, names = asPath ? [] : [target];
  const key = name ?? (asPath ? basename(asPath).replace(/\.[^.]+$/, '') : target);
  if (!NAME.test(key)) throw new Error(`lib add: "${key}" is not a usable entry name (letters, digits, - _ . ; pass --name)`);
  if (kind && !KINDS.includes(kind)) throw new Error(`lib add: --kind is one of ${KINDS.join(', ')}`);
  const dir = join(L, key), exists = existsSync(join(dir, 'entry.json'));
  // plan first against the existing entry: a changed file stops everything (same all-or-nothing rule as art copy)
  const plan = copyArt(source, names, { to: '.', game: dir, dry: true, cwd });
  if (exists && !force && (plan.conflicts.length || (summary && JSON.parse(readFileSync(join(dir, 'entry.json'), 'utf8')).summary !== summary)))
    return { name: key, dir, refused: plan.conflicts.length ? plan.conflicts.map(c => posix(relative(dir, c))) : ['entry.json (another summary)'] };
  if (exists && force) rmSync(dir, { recursive: true, force: true });   // --force replaces the whole entry: no stale file of the old one stays
  const r = copyArt(source, names, { to: '.', game: dir, cwd });
  const got = infer(dir, r.picked, key);
  // the use line is what pull prints: the import line a pull into art/ would give (named function only when one was asked for), else the manifest line
  const probe = copyArt(dir, [], { to: 'art', game: join(tmpdir(), 'threedog-lib-probe'), dry: true });
  const imports = probe.register.filter(l => l.startsWith('import')).map(l => names[0] && CODE.test(l) ? l.replace(/\{[^}]*\}/, `{ ${names[0]} }`) : l);
  const entry = { name: key, kind: kind ?? got.kind, summary: summary ?? got.summary, use: use ?? (imports.length ? imports.join(' ') + (names[0] ? ` // ${names[0]}(...)` : '') : probe.register.join(' ')),
    backends: backends ?? got.backends, ...(got.params.length ? { params: got.params } : {}), from: `${basename(gameRoot(game) ?? game)} ${new Date().toISOString().slice(0, 10)}` };
  writeFileSync(join(dir, 'entry.json'), JSON.stringify(entry, null, 2) + '\n');
  const note = noPreview ? 'no preview (--no-preview)' : makePreview(dir, { game, preview, key: basename(asPath ?? key).replace(/\.[^.]+$/, ''), kind: entry.kind });
  return { name: key, dir, entry, writes: r.writes.map(x => posix(relative(dir, x.to))), note, packages: r.packages, missing: r.missing };
}

/** Entries matching every word of the query (name, kind, summary, backends, use) */
export function listEntries(lib, query = []) {
  const words = query.flatMap(q => String(q).toLowerCase().split(/\s+/)).filter(Boolean);
  return entries(lib).filter(e => { const hay = [e.name, e.kind, e.summary, ...(e.backends ?? []), e.use].join(' ').toLowerCase(); return words.every(w => hay.includes(w)); });
}

/** Copy an entry into a game: the same copy as art copy, from the entry folder. Returns art copy's result plus { entry, game } */
export async function pullEntry(name, { game: w, cwd = process.cwd(), lib, to, force = false, dry = false } = {}) {
  const L = libraryDir({ lib }), all = entries(L), e = all.find(x => x.name === name);
  if (!e) {
    const near = closest(name, all.map(x => x.name));
    throw new Error(`lib pull: no entry "${name}" in ${L}` + (near ? ` (did you mean "${near}"?)` : all.length ? ` (threedog lib list shows ${all.length})` : ' (the library is empty: threedog lib add …)'));
  }
  const game = await gameOf(w, cwd);
  to ??= PLUGGABLE.includes(e.kind) ? 'plugins' : 'art';   // the plugins folder plugs code by what it exports (engine.plugins)
  return { entry: e, game, to, ...copyArt(e.dir, [], { to, force, dry, cwd: game, game }) };
}

/** Write <library>/index.html: previews, summaries and use lines of all entries. Returns the file */
export function writePage(lib) {
  const list = entries(lib);
  const card = e => `<article><div class="pv">${existsSync(join(e.dir, 'preview.png')) ? `<img src="${esc(e.name)}/preview.png" alt="${esc(e.name)}" width="256" height="256">` : '<span>no preview</span>'}</div>
<h2>${esc(e.name)} <small>${esc(e.kind)}</small></h2><p>${esc(e.summary)}</p><p class="b">${esc((e.backends ?? []).join(' · '))}${e.params?.length ? ' · params: ' + esc(e.params.join(', ')) : ''}</p><code>${esc(e.use)}</code><p class="b">from ${esc(e.from)}</p></article>`;
  const f = join(lib, 'index.html');
  mkdirSync(lib, { recursive: true });
  writeFileSync(f, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>threedog library</title>
<style>body{font:14px sans-serif;background:#1d1d20;color:#ddd;margin:16px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}article{background:#2a2a2f;padding:10px;border-radius:6px}
.pv{height:256px;display:flex;align-items:center;justify-content:center;background:#111}h2{margin:8px 0 2px;font-size:16px}small{color:#9ab}p{margin:4px 0}.b{color:#999;font-size:12px}code{display:block;word-break:break-all;font-size:12px;color:#cfe}</style>
<h1>threedog library <small>${list.length} entr${list.length === 1 ? 'y' : 'ies'}</small></h1><main>
${list.map(card).join('\n')}</main>\n`);
  return f;
}

async function cli(argv) {
  const [sub, ...rest] = argv;
  const usage = 'Usage: threedog lib add <file|folder|exportName> [-w game] [--name n] [--summary s] [--kind k] [--use s] [--preview url|png] [--force] · lib list [words] · lib pull <name> [-w game] [--to dir/ (default plugins/ for code, art/ for models and textures)] [--force] [--dry] · lib page · --lib <dir> (default ~/.threedog/library, or THREEDOG_LIBRARY)';
  const cwd = process.cwd();
  const spec = { add: { workspace: true, positional: true, flags: ['force', 'no-preview'], values: ['lib', 'name', 'summary', 'kind', 'use', 'backends', 'preview'] },
    list: { positional: true, values: ['lib'] }, pull: { workspace: true, positional: true, flags: ['force', 'dry'], values: ['lib', 'to'] }, page: { values: ['lib'] } }[sub];
  if (!spec) { console.log(usage); return sub ? 1 : 0; }
  try {
    const { opt, rest: pos, workspace } = parseOptions(rest, spec);
    const lib = libraryDir({ lib: opt.lib });
    if (sub === 'add') {
      if (pos.length !== 1) throw new Error('lib add takes exactly one thing to add (a file, a folder or an exported function name)');
      const r = await addEntry(pos[0], { game: workspace, cwd, lib: opt.lib, name: opt.name, summary: opt.summary, kind: opt.kind, use: opt.use,
        backends: opt.backends ? String(opt.backends).split(',') : undefined, preview: opt.preview, noPreview: !!opt['no-preview'], force: !!opt.force });
      if (r.refused) { console.error(`✗ nothing added: entry "${r.name}" already exists with different content (--force replaces it):\n` + r.refused.map(c => '  ' + c).join('\n')); return 1; }
      console.log(`added "${r.name}" (${r.entry.kind}) to ${r.dir}: ${r.writes.length} file(s)\n  ${r.entry.summary || '(no summary: pass --summary "...")'}\n  use: ${r.entry.use}\n  ${r.note}`);
      if (r.missing.length) console.log('Not found in the source (left as written):\n' + r.missing.map(m => '  ' + m).join('\n'));
      if (r.packages.length) console.log('Package imports (a game that pulls this needs them): ' + r.packages.join(', '));
      return 0;
    }
    if (sub === 'list') {
      const list = listEntries(lib, pos), broken = brokenLine(readLibrary(lib).broken);
      if (!list.length) console.log(pos.length ? `no entry matches "${pos.join(' ')}" in ${lib}` : broken ? `no readable entry in ${lib}` : `the library is empty (${lib}): threedog lib add <file|folder|exportName> -w <game>`);
      for (const e of list) console.log(`${e.name}  [${e.kind}]  ${e.summary}  (${(e.backends ?? []).join(', ')})`);
      if (broken) console.log(`✗ ${broken}`);
      return broken ? 1 : 0;
    }
    if (sub === 'pull') {
      if (pos.length !== 1) throw new Error('lib pull takes one entry name (threedog lib list shows them)');
      const r = await pullEntry(pos[0], { game: workspace, cwd, lib: opt.lib, to: opt.to, force: !!opt.force, dry: !!opt.dry });
      if (r.conflicts.length && !opt.force) {
        console.error(`✗ nothing copied: ${r.conflicts.length} file(s) already exist with different content (--force overwrites them):\n` + r.conflicts.map(c => '  ' + posix(relative(cwd, c))).join('\n'));
        return 1;
      }
      console.log(`${opt.dry ? 'would copy' : 'copied'} "${r.entry.name}": ${r.writes.length} file(s)${r.same.length ? ` (${r.same.length} already identical)` : ''}`);
      for (const w of r.writes) console.log('  ' + posix(relative(cwd, w.to)));
      if (r.packages.length) console.log(`Package imports kept as they are (this game needs them installed): ${r.packages.join(', ')}`);
      if (r.missing.length) console.log('Not found in the entry (fix by hand):\n' + r.missing.map(m => '  ' + m).join('\n'));
      console.log(r.to === 'plugins' ? 'Plugged at engine.start() from plugins/ (describe().slots lists it). If the file exports a function, export its result instead: export default makeIt({ ... })' : `use: ${r.entry.use}`);
      if (r.register.length) console.log('Register (in the game code that sets up assets):\n' + r.register.map(l => '  ' + l).join('\n'));
      console.log('The copies are this game\'s own now: adapt them to its look; nothing links back and nothing updates them.');
      return 0;
    }
    const f = writePage(lib);
    console.log(`wrote ${f} (${entries(lib).length} entries): open it in a browser`);
    return 0;
  } catch (e) { console.error('✗ ' + e.message); return 1; }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(await cli(process.argv.slice(2)));
