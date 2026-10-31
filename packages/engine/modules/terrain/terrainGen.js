// Pure computation: terrain height, biomes, rivers, flattened plots, chunk meshes, vegetation placement (with colliders).
// No three.js dependency; the main thread and the Worker share this code, so results are identical.
// Note: the config here must be serializable because it is passed to the Worker: a game's own height / groundType function travels as source text (threads.pure rules).
// Edits (dig, raise, paint) are an overlay of grid-point heights and cell ground types on top of the generated terrain; see terrainEdit.js.
// Split: defaults in terrainDefaults.js; chunk meshes and vegetation placement in terrainMesh.js (neither depends on three.js).
import { DEFAULT_TERRAIN } from './terrainDefaults.js';
import { makeMesher } from './terrainMesh.js';
import { compilePure } from '../../core/threadPure.js';
export { DEFAULT_TERRAIN, DEFAULT_BIOMES, DEFAULT_BIOME_COLORS, BIOMES } from './terrainDefaults.js';

const srgbToLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexToLinear = h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map(srgbToLinear);

export function createTerrain(userCfg = {}) {
  const cfg = { ...DEFAULT_TERRAIN, ...userCfg, colors: { ...DEFAULT_TERRAIN.colors, ...(userCfg.colors || {}) } };
  const SEED = cfg.seed | 0, CHUNK = cfg.chunkSize, RES = cfg.resolution, CELL = CHUNK / RES, WATER = cfg.waterLevel;
  const PAL = {};
  for (const k in cfg.colors) PAL[k] = hexToLinear(cfg.colors[k]);

  function hash2(x, z, salt = 0) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + SEED + Math.imul(salt, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, oct = 4) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  const smooth = t => t * t * (3 - 2 * t);

  const N = { ...DEFAULT_TERRAIN.noise, ...(cfg.noise || {}) };
  function hillsHeight(x, z) {
    const base = fbm(x * N.baseScale, z * N.baseScale, 4);
    const hills = fbm(x * N.hillScale + 71, z * N.hillScale - 33, 3);
    const m = Math.max(0, fbm(x * N.mountainScale + 500, z * N.mountainScale + 200, 4) - N.mountainThreshold);
    return ((base - N.seaBias) * N.baseAmp + (hills - 0.5) * N.hillAmp) * cfg.heightScale + m * m * N.mountainAmp * cfg.mountains;
  }
  function heightmapHeight(x, z) {
    const H = cfg.heightmap, [sx, sz] = H.size, [cx0, cz0] = H.center || [0, 0];
    const u = (x - cx0) / sx + 0.5, v = (z - cz0) / sz + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return H.outside ?? WATER - 5;
    const fx = u * (H.width - 1), fz = v * (H.height - 1), i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const at = (a, b) => H.data[Math.min(H.height - 1, b) * H.width + Math.min(H.width - 1, a)];
    const h = at(i, j) * (1 - tx) * (1 - tz) + at(i + 1, j) * tx * (1 - tz) + at(i, j + 1) * (1 - tx) * tz + at(i + 1, j + 1) * tx * tz;
    return (H.min ?? 0) + h * ((H.max ?? 60) - (H.min ?? 0));
  }
  // helpers handed to a game's own height / groundType function: it runs in a worker and cannot import or close over anything
  const NOISE = { fbm, noise: vnoise, hash: hash2, seed: SEED };
  const userHeight = cfg.height && compilePure(cfg.height, 'terrain({ height })').call;
  const userType = cfg.groundType && compilePure(cfg.groundType, 'terrain({ groundType })').call;
  function naturalHeight(x, z) {
    if (userHeight) return userHeight(x, z, NOISE);
    switch (cfg.shape) {
      case 'flat': return (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 2 * cfg.heightScale + 4;
      case 'heightmap': return cfg.heightmap ? heightmapHeight(x, z) : 4;
      case 'island': {
        const I = { ...DEFAULT_TERRAIN.island, ...(cfg.island || {}) };
        const d = Math.hypot(x - I.center[0], z - I.center[1]), t = Math.min(1, Math.max(0, (d - I.radius) / I.falloff));
        return hillsHeight(x, z) * (1 - t) + 6 * (1 - t) - I.depth * smooth(t);
      }
      case 'canyon': {
        const C = { ...DEFAULT_TERRAIN.canyon, ...(cfg.canyon || {}) };
        const r = Math.abs(fbm(x * C.scale + 13, z * C.scale - 7, 4) - 0.5) * 2;
        const terrace = Math.floor(fbm(x * 0.01, z * 0.01, 2) * 4) / 4;
        return C.plateau + terrace * 8 - C.depth * Math.pow(1 - Math.min(1, r * 3), 2);
      }
      default: return hillsHeight(x, z);
    }
  }
  // rivers: thin bands where noise is near 0.5 are dug below the water surface
  function riverFactor(x, z) {
    if (!cfg.rivers) return 0;
    const r = Math.abs(fbm(x * 0.0022 + 40, z * 0.0022 - 70, 3) - 0.5);
    const w = cfg.riverWidth, bank = w * 2.2;
    return r >= bank ? 0 : smooth(1 - r / bank) * (r < w ? 1 : 0.85);
  }
  function rawHeight(x, z) {
    let h = naturalHeight(x, z);
    const rf = riverFactor(x, z);
    if (rf > 0) h = h + (WATER - 1.6 - h) * Math.min(1, rf * 1.25);
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
  const cache = new Map();
  function gridH(i, j) {
    const k = key(i, j);
    if (EH.size) { const e = EH.get(k); if (e !== undefined) return e; }
    let h = cache.get(k);
    if (h === undefined) { if (cache.size > 400000) cache.clear(); h = rawHeight(i * CELL, j * CELL); cache.set(k, h); }
    return h;
  }
  // height exactly matching the low-poly triangles (characters and vegetation use it, so nothing floats)
  function surface(x, z) {
    const gx = x / CELL, gz = z / CELL, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const ha = gridH(i, j), hb = gridH(i + 1, j), hc = gridH(i, j + 1), hd = gridH(i + 1, j + 1);
    return fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  }
  function slope(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    const ha = gridH(i, j), hb = gridH(i + 1, j), hc = gridH(i, j + 1), hd = gridH(i + 1, j + 1);
    return Math.max(Math.abs(hb - ha), Math.abs(hc - ha), Math.abs(hd - hb), Math.abs(hd - hc)) / CELL;
  }

  // biomes: decided by the rule table from temperature, moisture (two low-frequency noises), altitude, slope, river
  function test(c, v) {
    if (c.any) return c.any.some(x => test(x, v));
    return !((c.minHeight != null && v.h < c.minHeight) || (c.maxHeight != null && v.h > c.maxHeight) ||
      (c.maxAboveWater != null && v.h >= WATER + c.maxAboveWater) || (c.minSlope != null && v.sl < c.minSlope) ||
      (c.minTemp != null && v.temp() < c.minTemp) || (c.maxTemp != null && v.temp() > c.maxTemp) ||
      (c.minMoist != null && v.moist() < c.minMoist) || (c.maxMoist != null && v.moist() > c.maxMoist) ||
      (c.minRiver != null && v.river() < c.minRiver));
  }
  function biomeAt(x, z, h = surface(x, z), sl = 0) {
    return cellType(Math.floor(x / CELL), Math.floor(z / CELL)) ?? naturalBiome(x, z, h, sl);
  }
  function naturalBiome(x, z, h, sl) {
    if (userType) { const t = userType(x, z, h, sl, NOISE); if (t != null) return t; }
    let t, m, r;   // computed on demand; skipped if no rule uses them
    const v = { h, sl, temp: () => t ??= fbm(x * cfg.tempScale + 300, z * cfg.tempScale - 90, 3) - h * cfg.tempLapse,
      moist: () => m ??= fbm(x * cfg.moistScale - 200, z * cfg.moistScale + 100, 3), river: () => r ??= riverFactor(x, z) };
    for (const rule of cfg.biomes) if (test(rule, v)) return rule.name;
    return cfg.biomes[cfg.biomes.length - 1].name;
  }

  const FALLBACK = [0.5, 0.5, 0.5];
  const pal = names => names.map(n => PAL[n] || FALLBACK);
  const BCOL = {}; for (const k in cfg.biomeColors) BCOL[k] = pal(cfg.biomeColors[k]);
  const STEEP = cfg.steep.map(s => ({ ny: s.maxNormalY, c: pal(s.colors) }));
  // natural color (painted cells are colored by paintColor per whole cell, so a painted type never bleeds into a neighbor's vertex)
  function faceColor(h, ny, x, z, out) {
    let cols = null;
    for (const s of STEEP) if (ny < s.ny) { cols = s.c; break; }
    return mix(cols || BCOL[naturalBiome(x, z, h, 1 - ny)] || [FALLBACK], x, z, out);
  }
  const paintColor = (type, x, z, out) => mix(BCOL[type] || [FALLBACK], x, z, out);
  function mix(cols, x, z, out) {
    const a = cols[0], b = cols[1] || a, t = cols.length > 1 ? vnoise(x * 0.03, z * 0.03) : 0;
    const j = 0.92 + hash2(Math.floor(x * 3), Math.floor(z * 3), 7) * 0.12;
    out[0] = (a[0] + (b[0] - a[0]) * t) * j; out[1] = (a[1] + (b[1] - a[1]) * t) * j; out[2] = (a[2] + (b[2] - a[2]) * t) * j;
    return out;
  }

  const { buildChunk, place } = makeMesher({ cfg, CHUNK, RES, CELL, gridH, surface, slope, biomeAt, fbm, faceColor, paintColor, cellType, editedCell });
  return { config: cfg, CHUNK, RES, CELL, waterLevel: WATER, surface, slope, biomeAt, riverFactor, fbm, buildChunk, place, gridH, setEdits, useEdits, key };
}
