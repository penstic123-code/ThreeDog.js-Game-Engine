// Find, import and merge a style for `threedog style check`: a pack name (lowpoly), a package name (@threedog/style-x), a folder or a file.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, rel, styleDir, styleName } from '../paths.mjs';

const engineUrl = p => import(pathToFileURL(join(ENGINE, p)).href);

/** Entry file of a target string, or throws with the way out */
export function resolveEntry(target) {
  const tries = [resolve(target), ...(styleName(target) ? [styleDir(styleName(target))] : []), ...(/^[a-z0-9-]+$/.test(target) ? [styleDir(target)] : [])];
  for (const p of tries) {
    if (!existsSync(p)) continue;
    if (!statSync(p).isDirectory()) return p;
    const pkg = existsSync(join(p, 'package.json')) ? JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')) : {};
    const main = join(p, pkg.main ?? 'index.js');
    if (existsSync(main)) return main;
  }
  throw new Error(`no style found for "${target}": give a pack name (lowpoly), a package (@threedog/style-x), a folder with index.js, or a .js file whose default export is the style`);
}

/** The .js files the pack is made of (an index.js entry: its folder, without node_modules; any other file: just itself), as { file, text } */
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
