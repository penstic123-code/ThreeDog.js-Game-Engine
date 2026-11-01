// Part of content validation: the markers and template nodes inside the game's level glb files (art/models and public/models), read statically,
// so content needs no hand-written description of Blender markers. Skips quietly when there is no glb or @gltf-transform is not installed.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { hasReader, readModel } from '../assets-check/read.mjs';
import { levelManifest, checkAgainstContent } from '../assets-check/level.mjs';

/** Level glb files of a game folder: the Blender source wins over the compressed copy of the same name */
export function levelFiles(dir) {
  const byName = new Map();
  for (const sub of ['public/models', 'art/models']) {
    const d = join(dir, sub);
    if (existsSync(d)) for (const f of readdirSync(d)) if (/\.glb$/i.test(f)) byName.set(f, join(d, f));
  }
  return [...byName.values()];
}

/** @returns {Promise<{ levels: any[], places: Record<string, any>, tags: Set<string>, errors: string[] }>} places: every marker name the glbs define (usable as { place }) */
export async function glbLevels(dir, content) {
  const out = { levels: [], places: {}, tags: new Set(), errors: [] };
  const files = hasReader() ? levelFiles(dir) : [];
  for (const f of files) {
    let m;
    try { m = checkAgainstContent(levelManifest((await readModel(f)).doc, f), content); }
    catch (e) { out.errors.push(`${f}: the model cannot be read (${e.message})`); continue; }
    out.levels.push(m);
    for (const list of [m.spawns, m.npcs, m.markers, m.triggers]) for (const p of list) out.places[p.name] = { x: p.position[0], z: p.position[2] };
    for (const t of m.triggers) out.tags.add(t.tag);
    for (const i of m.issues) if (i.severity === 'error') out.errors.push(`${f}: ${i.msg}`);
  }
  return out;
}
