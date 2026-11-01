// Part of content validation (called by content-check.mjs): content/views.js -> { name: { position: [x, y, z], target?: [x, y, z], fov? } } ('pos' = old name, still accepted).
// The same rules core/Views.js enforces at run time (it throws on a bad position), reported here before the game starts.
const KEYS = ['position', 'pos', 'target', 'fov'];
const vec3 = v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));

/** ctx: { c, err, isObj } */
export function checkViews({ c, err, isObj }) {
  const v = c.views;
  if (v === undefined) return;
  if (!isObj(v)) return err('views', 'views must be an object { name: { position: [x, y, z], target?: [x, y, z], fov? } }');
  for (const [name, d] of Object.entries(v)) {
    const where = `view "${name}"`;
    if (!isObj(d)) { err('views', `${where} must be an object { position, target, fov }`); continue; }
    for (const k of Object.keys(d)) if (!KEYS.includes(k)) err('views', `${where} has an unknown key "${k}" (known: ${KEYS.join(', ')})`);
    const p = d.position ?? d.pos;
    if (!vec3(p)) err('views', `${where}: position must be [x, y, z] numbers, got ${JSON.stringify(p)}`);
    if (d.target !== undefined && !vec3(d.target)) err('views', `${where}: target must be [x, y, z] numbers, got ${JSON.stringify(d.target)}`);
    if (d.fov !== undefined && !(typeof d.fov === 'number' && d.fov > 0 && d.fov < 180)) err('views', `${where}: fov must be degrees between 0 and 180, got ${JSON.stringify(d.fov)}`);
  }
}
