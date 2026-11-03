// Find, import and merge a style for `threedog style check`: a style folder or file, or a game (folder or workspace name) whose style/ folder is meant.
// A look is a folder, not a package, so there is no style name to look up: a path, or the game that owns the style/ folder.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, rel, GAME_STYLE_DIR, findWorkspace } from '../paths.mjs';

const engineUrl = p => import(pathToFileURL(join(ENGINE, p)).href);

/** The workspace a bare name points at, or null (an ambiguous name throws in findWorkspace; here it just means "not this way") */
const workspace = name => { try { return findWorkspace(name); } catch { return null; } };

/** Entry file of a target string, or throws with the way out */
export function resolveEntry(target) {
  // order: the path itself (a style folder or file), then that path's style/ (a game folder, '.' inside a game), then a workspace's style/
  const ws = workspace(target);
  const tries = [resolve(target), join(resolve(target), GAME_STYLE_DIR), ...(ws ? [join(ws, GAME_STYLE_DIR)] : [])];
  for (const p of tries) {
    if (!existsSync(p)) continue;
    if (!statSync(p).isDirectory()) return p;
    // a folder's entry is its index.js only (never package.json "main": in a game folder that would be main.js, not the look)
    if (existsSync(join(p, 'index.js'))) return join(p, 'index.js');
  }
  throw new Error(`no style found for "${target}": give a style folder with index.js (a game's ${GAME_STYLE_DIR}/), a .js file whose default export is the style, or a game (its folder or workspace name) to check its ${GAME_STYLE_DIR}/ folder`);
}

/** The .js files the style is made of (an index.js entry: its folder, without node_modules; any other file: just itself), as { file, text } */
export function sourcesOf(entry) {
  const files = [];
  const go = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (e.isDirectory()) go(join(d, e.name)); else if (['.js', '.mjs'].includes(extname(e.name))) files.push(join(d, e.name));
    }
  };
  if (/index\.m?js$/.test(entry)) go(dirname(entry)); else files.push(entry);
  return files.map(file => ({ file, text: readFileSync(file, 'utf8') }));
}

const names = o => (o && typeof o === 'object' ? new Set(Object.keys(o)) : new Set());
/** Asset names a module registers: its `assets` export (an AssetManifest) and the generator map `models` */
export function assetNames(mod) {
  const a = mod?.assets ?? {};
  return { models: new Set([...names(a.models), ...names(mod?.models)]), textures: names(a.textures), fonts: names(a.fonts), sounds: names(a.sounds) };
}

/** Import the entry; returns { style (merged), mod, closest, purposes, tools } */
export async function loadStyle(entry) {
  const mod = await import(pathToFileURL(entry).href);
  if (mod.default === undefined) throw new Error(`${rel(entry) || entry} has no default export: export default the style object (or a list of parts)`);
  const [{ styleFrom }, { closest }, materials] = await Promise.all([engineUrl('core/styleParts.js'), engineUrl('core/validate.js'), Promise.resolve(readFileSync(join(ENGINE, 'render', 'materials.js'), 'utf8'))]);
  const purposes = [...(/MATERIAL_PURPOSES = \[([^\]]*)\]/.exec(materials)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  return { style: styleFrom(mod.default), mod, closest, purposes };
}
