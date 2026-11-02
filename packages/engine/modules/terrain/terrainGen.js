// Pure computation: terrain height (a game's height function, a height map, or flat y = 0), ground types, flattened plots, chunk meshes,
// vegetation placement (with colliders).
// No three.js dependency; the main thread and the Worker share this code, so results are identical.
// Note: the config here must be serializable because it is passed to the Worker: a game's own height / groundType function travels as source text (threads.pure rules).
// Edits (dig, raise, paint) are an overlay of grid-point heights and cell ground types on top of the generated terrain; see terrainEdit.js.
// Split: defaults in terrainDefaults.js; chunk meshes and vegetation placement in terrainMesh.js (neither depends on three.js).
import { DEFAULT_TERRAIN } from './terrainDefaults.js';
import { makeMesher } from './terrainMesh.js';
import { makeShape } from './terrainShape.js';
import { grayAt } from '../../core/grayMap.js';
import { makeNoise } from '../../core/scatter.js';
import { compilePure } from '../../core/threadPure.js';
import { codedError } from '../../core/errorHints.js';
export { DEFAULT_TERRAIN } from './terrainDefaults.js';

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexToLinear = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map(srgbToLinear);

export function createTerrain(userCfg = {}) {
  const cfg = { ...DEFAULT_TERRAIN, ...userCfg, colors: { ...DEFAULT_TERRAIN.colors, ...(userCfg.colors || {}) }, boundsPad: { ...DEFAULT_TERRAIN.boundsPad, ...(userCfg.boundsPad || {}) } };
  for (const [k, ok] of [['shading', ['smooth', 'flat', 'texture']], ['diagonal', ['fixed', 'adaptive', 'alternate']], ['normals', [null, 'smooth', 'flat']]])
    if (!ok.includes(cfg[k])) throw codedError('terrain-option', `terrain({ ${k} }) must be ${ok.filter(Boolean).map(v => `'${v}'`).join(' | ')}, got ${JSON.stringify(cfg[k])}`);
  const SEED = cfg.seed | 0, CHUNK = cfg.chunkSize, RES = cfg.resolution, CELL = CHUNK / RES, WATER = cfg.waterLevel;
  const PAL = {};
  for (const k in cfg.colors) PAL[k] = hexToLinear(cfg.colors[k]);

  const { hash: hash2, noise: vnoise, fbm } = makeNoise(SEED);   // shared with vegetation cluster rules on any ground
  const smooth = t => t * t * (3 - 2 * t);

  function heightmapHeight(x, z) {
    const H = cfg.heightmap, [sx, sz] = H.size, [cx0, cz0] = H.center || [0, 0];
    const u = (x - cx0) / sx + 0.5, v = (z - cz0) / sz + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return H.outside ?? (Number.isFinite(WATER) ? WATER - 5 : H.min ?? 0);   // outside the map: under the water, or the map's floor without water
    return (H.min ?? 0) + grayAt(H, u, v) * ((H.max ?? 60) - (H.min ?? 0));
  }
  // helpers handed to a game's own height / groundType function: it runs in a worker and cannot import or close over anything
  const NOISE = { fbm, noise: vnoise, hash: hash2, seed: SEED, waterLevel: WATER, params: cfg.params ?? {} };
  const userHeight = cfg.height && compilePure(cfg.height, 'terrain({ height })').call;
  const userType = cfg.groundType && compilePure(cfg.groundType, 'terrain({ groundType })').call;
  const userNormal = cfg.normalFn && compilePure(cfg.normalFn, 'terrain({ normalFn })').call;
  // no generator of its own: the engine draws flat ground at y = 0 (a placeholder; the terrain module warns in dev)
  const naturalHeight = userHeight ? (x, z) => userHeight(x, z, NOISE) : cfg.heightmap?.data ? heightmapHeight : () => 0;
  function rawHeight(x, z) {
    let h = naturalHeight(x, z);
    for (const f of cfg.flatten) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d >= f.radius) continue;
      const target = f.height ?? (f._h ??= naturalHeight(f.x, f.z));
      const t = d < f.radius * 0.6 ? 1 : smooth(1 - (d - f.radius * 0.6) / (f.radius * 0.4));
      h = h + (target - h) * t;
    }
    return h;
  }

  // edit overlay: grid key -> height (grid point i*CELL, j*CELL) and cell key -> ground type (cell [i, i+1) x [j, j+1)). The main thread holds every edit;
  // a worker gets only those around the chunk it builds (setEdits), which is all buildChunk / place read
  const key = (i, j) => (i + 50000) * 100000 + (j + 50000);
  let EH = new Map(), ET = new Map();
  function setEdits(d) {
    EH = new Map(); ET = new Map();
    if (!d) return;
    for (let n = 0; n < d.h.length; n += 3) EH.set(key(d.h[n], d.h[n + 1]), d.h[n + 2]);
    for (const [i, j, t] of d.t) ET.set(key(i, j), t);
  }
  /** main thread: share the editor's maps (it writes them in place) */
  function useEdits(eh, et) { EH = eh; ET = et; }
  const cellType = (i, j) => ET.size ? ET.get(key(i, j)) : undefined;
  // a cell whose shape or type was edited: vegetation does not grow there
  function editedCell(x, z) {
    if (!EH.size && !ET.size) return false;
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    return ET.has(key(i, j)) || EH.has(key(i, j)) || EH.has(key(i + 1, j)) || EH.has(key(i, j + 1)) || EH.has(key(i + 1, j + 1));
  }
  // world outline (terrain({ shape })): only built when the game passes one, so the default ground runs none of it
  const SHAPE = cfg.shape ? makeShape(cfg.shape, { CELL, NOISE, key, hash: hash2, fbm }) : null;
  const gridRaw = SHAPE?.drop ? (i, j) => rawHeight(i * CELL, j * CELL) - SHAPE.drop(i, j) : (i, j) => rawHeight(i * CELL, j * CELL);
  const cache = new Map();
  function gridH(i, j) {
    const k = key(i, j);
    if (EH.size) { const e = EH.get(k); if (e !== undefined) return e; }
    let h = cache.get(k);
    if (h === undefined) { if (cache.size > 400000) cache.clear(); h = gridRaw(i, j); cache.set(k, h); }
    return h;
  }
  // height exactly matching the low-poly triangles (characters and vegetation use it, so nothing floats)
  // diagonal of a cell: 0 = b-c (the original cut), 1 = a-d; the mesh and surface() read this one function, so characters never float or sink
  const DIAG = cfg.diagonal;
  const diagOf = DIAG === 'fixed' ? () => 0
    : DIAG === 'alternate' ? (i, j) => (i + j) & 1
    : (i, j, ha, hb, hc, hd) => (Math.abs(ha - hd) < Math.abs(hb - hc) ? 1 : 0);
  function surface(x, z) {
    const gx = x / CELL, gz = z / CELL, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const ha = gridH(i, j), hb = gridH(i + 1, j), hc = gridH(i, j + 1), hd = gridH(i + 1, j + 1);
    if (diagOf(i, j, ha, hb, hc, hd)) return fz >= fx ? ha + (hc - ha) * fz + (hd - hc) * fx : ha + (hb - ha) * fx + (hd - hb) * fz;
    return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }
  function slope(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const ha = gridH(i, j), hb = gridH(i + 1, j), hc = gridH(i, j + 1), hd = gridH(i + 1, j + 1);
    return Math.max(Math.abs(hb - ha), Math.abs(hc - ha), Math.abs(hd - hb), Math.abs(hd - hc)) / CELL;
  }

  // ground type: a painted cell's type, else the game's groundType function, else 'default'
  function biomeAt(x, z, h = surface(x, z), sl = 0) {
    return cellType(Math.floor(x / CELL), Math.floor(z / CELL)) ?? naturalBiome(x, z, h, sl);
  }
  function naturalBiome(x, z, h, sl) {
    return (userType && userType(x, z, h, sl, NOISE)) ?? 'default';
  }

  // a ground type the style gives no color: one flat neutral gray (no noise blend, no jitter)
  const FALLBACK = [0.5, 0.5, 0.5], GRAY = [FALLBACK];
  const pal = names => names.map(n => PAL[n] || FALLBACK);
  const BCOL = {}; for (const k in cfg.biomeColors) BCOL[k] = pal(cfg.biomeColors[k]);
  const STEEP = cfg.steep.map(s => ({ ny: s.maxNormalY, c: pal(s.colors) }));
  // natural color (painted cells are colored by paintColor per whole cell, so a painted type never bleeds into a neighbor's vertex)
  function faceColor(h, ny, x, z, out) {
    let cols = null;
    for (const s of STEEP) if (ny < s.ny) { cols = s.c; break; }
    return mix(cols || BCOL[naturalBiome(x, z, h, 1 - ny)] || GRAY, x, z, out);
  }
  const paintColor = (type, x, z, out) => mix(BCOL[type] || GRAY, x, z, out);
  // Ground color variation (style.terrain.variation, plain data so it travels to workers): defaults are the original look.
  // blend: wavelength of the two-color noise; jitter: per-cell brightness grain; patches: optional large painterly color blocks
  const V = cfg.variation || {}, BL = V.blend || {}, JT = V.jitter || {}, PT = V.patches;
  const bFreq = BL.size ? 1 / BL.size : 0.03, bStrength = BL.strength ?? 1, jInv = JT.size ? 1 / JT.size : 3, jMin = JT.min ?? 0.92, jRange = JT.range ?? 0.12;
  const pFreq = PT ? 1 / (PT.size || 90) : 0, pLevels = PT?.levels | 0, pTint = PT?.tint != null ? hexToLinear(PT.tint) : null;
  function mix(cols, x, z, out) {
    if (cols === GRAY) { out[0] = out[1] = out[2] = FALLBACK[0]; return out; }
    const a = cols[0], b = cols[1] || a;
    let t = cols.length > 1 ? vnoise(x * bFreq, z * bFreq) : 0;
    if (bStrength !== 1) t = Math.min(1, Math.max(0, 0.5 + (t - 0.5) * bStrength));
    const j = jMin + hash2(Math.floor(x * jInv), Math.floor(z * jInv), 7) * jRange;
    out[0] = (a[0] + (b[0] - a[0]) * t) * j; out[1] = (a[1] + (b[1] - a[1]) * t) * j; out[2] = (a[2] + (b[2] - a[2]) * t) * j;
    if (PT) patch(x, z, out);
    return out;
  }
  // Second, much larger noise (own offsets so it is not correlated with the blend): levels > 0 snaps it to flat blocks (brush strokes
  // instead of soft clouds). Brightens/darkens by strength, or pulls towards `tint` where the noise is high.
  function patch(x, z, out) {
    let n = vnoise(x * pFreq + 91.7, z * pFreq + 17.3);
    if (pLevels > 0) n = Math.floor(n * pLevels) / pLevels;
    const s = PT.strength ?? 0.15;
    if (pTint) { const k = n * s; for (let i = 0; i < 3; i++) out[i] += (pTint[i] - out[i]) * k; }
    else { const k = 1 + (n - 0.5) * 2 * s; out[0] *= k; out[1] *= k; out[2] *= k; }
  }

  const { buildChunk, place } = makeMesher({ cfg, CHUNK, RES, CELL, gridH, surface, slope, biomeAt, fbm, faceColor, paintColor, cellType, editedCell, diagOf, userNormal, shape: SHAPE });
  // the void: no height (-Infinity), no slope, ground type 'void'; the mesher above keeps the unmasked functions (rim colors, outside corners)
  const has = SHAPE ? SHAPE.has : () => true;
  const query = SHAPE ? {
    surface: (x, z) => (has(x, z) ? surface(x, z) : -Infinity),
    slope: (x, z) => (has(x, z) ? slope(x, z) : 0),
    biomeAt: (x, z, h, sl) => (has(x, z) ? biomeAt(x, z, h, sl) : 'void'),
  } : { surface, slope, biomeAt };
  return { config: cfg, CHUNK, RES, CELL, waterLevel: WATER, ...query, has, shape: SHAPE, fbm, noise: NOISE, buildChunk, place, gridH, setEdits, useEdits, key };
}
