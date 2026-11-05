// Part of content validation (called by content-check.mjs): content/views.js -> { name: { position: [x, y, z], target?: [x, y, z], fov? } }.
// The same rules core/scene/Views.js enforces at run time (it throws on a bad position), reported here before the game starts.
// Unknown keys and the fov range come from the placement field table (rules.js PLACEMENT_FIELDS.views, the one engine.content.fields('views')
// returns); written here by hand is only what a table cannot say: position is required, and it is exactly [x, y, z].
import { pathToFileURL } from 'node:url';
import { abs, CONTENT_FIELDS_REL } from '../paths.mjs';

const { placementShape, entryProblems } = await import(pathToFileURL(abs(CONTENT_FIELDS_REL)).href);
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

/** ctx: { c, err, isObj } */
export function checkViews({ c, err, isObj }) {
  const v = c.views;
  if (v === undefined) return;
  if (!isObj(v)) return err('views', 'views must be an object { name: { position: [x, y, z], target?: [x, y, z], fov? } }');
  for (const [name, d] of Object.entries(v)) {
    const where = `view "${name}"`;
    if (!isObj(d)) { err('views', `${where} must be an object { position, target, fov }`); continue; }
    for (const m of entryProblems(where, d, placementShape('views'))) err('views', m);
    const p = d.position;
    if (!vec3(p)) err('views', `${where}: position must be [x, y, z] numbers, got ${JSON.stringify(p)}`);
    if (d.target !== undefined && !vec3(d.target)) err('views', `${where}: target must be [x, y, z] numbers, got ${JSON.stringify(d.target)}`);
  }
}
