// Material provenance for engine.inspect.scene(): "why is this mesh the wrong colour?" Diagnostics only: reads the material, never changes it.
// Where the spec came from is userData.materialSource, recorded by makeMaterial (materials without it were not made by makeMaterial).
const hex = c => '#' + c.getHexString();
const MAPS = ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'lightMap', 'gradientMap'];
const SIDES = ['front', 'back', 'double'];

/**
 * @param {any} m a three.js material
 * @param {any} [o] the mesh that uses it (its userData.purpose is the fallback role)
 */
export function materialInfo(m, o) {
  const src = m.userData?.materialSource, white = !m.color || m.color.getHex() === 0xffffff;
  const maps = MAPS.filter(k => m[k]).map(k => k === 'map' ? 'map (base colour)' : k === 'normalMap' || k === 'bumpMap' ? `${k} (detail, no colour)` : k);
  const vc = !!m.vertexColors, hasMap = !!m.map;
  const base = hasMap ? (white ? 'map' : `map x color ${hex(m.color)}`) : m.color ? `color ${hex(m.color)}` : 'no color';
  const colorPath = `${base} (vertexColors ${vc ? 'on: also multiplied by the geometry color attribute' : 'off'})`;
  const notes = [];
  if (hasMap && !white) notes.push(`map already carries colour and color ${hex(m.color)} is not white: the result is map x color (fine when it is a tint)`);
  if (vc && o?.geometry && !o.geometry.attributes?.color) notes.push('vertexColors is on but the geometry has no color attribute: it renders black');
  return {
    role: src?.role ?? m.userData?.purpose ?? o?.userData?.purpose ?? null,
    from: src?.from ?? 'unknown (not made by makeMaterial)', keys: src?.keys ?? [],
    type: m.type, color: m.color ? hex(m.color) : null, maps, vertexColors: vc,
    side: SIDES[m.side] ?? m.side, transparent: !!m.transparent, opacity: m.opacity,
    colorPath, ...(notes.length && { notes }),
  };
}

/** One-line text of materialInfo for a list */
export const infoLine = i => `${i.role ?? '-'} from ${i.from}${i.keys.length ? ` [${i.keys.join(',')}]` : ''} · ${i.type} ${i.color ?? ''} · ${i.colorPath}`
  + `${i.maps.length ? ' · ' + i.maps.join(', ') : ''}${i.side !== 'front' ? ' · side ' + i.side : ''}${i.transparent || i.opacity < 1 ? ` · transparent=${i.transparent} opacity ${i.opacity}` : ''}`
  + (i.notes ? '\n      note: ' + i.notes.join('; ') : '');
