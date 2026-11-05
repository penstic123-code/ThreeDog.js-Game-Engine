// Grid A* pathfinding (fallback when no navmesh is installed or it is not ready yet). The one A* in the engine:
// engine.characters.findPath calls it with the collision module's walkability, the pathfinding worker (pathJob.js) with a snapshot of it.
// In games use engine.characters.findPath / findPathAsync, do not import this directly. Worker-safe: no imports.

/** Default cell size from the character radius: a small character gets finer cells (never below the 1 m ground raster, never above the old 2 m); no radius = 2 */
const defaultStep = r => r == null ? 2 : Math.min(2, Math.max(1, r * 4));
const defaultNodes = step => Math.round(6000 * Math.max(1, 2 / step) ** 2);   // finer cells need more of them to cover the same distance
/** The step / maxNodes findPath uses for a character radius when the caller gives none (pathAsync sizes its ground raster with the same numbers) */
export const astarDefaults = radius => { const step = defaultStep(radius); return { step, maxNodes: defaultNodes(step) }; };

class MinHeap {
  constructor() { this.a = []; }
  push(n, f) { const a = this.a; a.push([f, n]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top[1]; }
  get size() { return this.a.length; }
}

/**
 * Grid A*: cells of step meters, searches at most maxNodes cells; returns [{ x, z }...] or null if no path.
 * @param {(x: number, z: number) => boolean} walkable can a character stand here (radius already applied)
 */
export function findPath(walkable, sx, sz, gx, gz, { radius, step = defaultStep(radius), maxNodes = defaultNodes(step) } = {}) {
  const sample = 0.12;   // smoothing samples a segment every 0.12 m: one radius apart (the old rule) let a straight leg clip a wall corner by up to 0.3 m between two samples
  if (!walkable(gx, gz)) return null;   // a target inside a wall / water is unreachable: say so instead of a path that ends in the wall
  const key = (i, j) => i * 100003 + j;
  const si = Math.round(sx / step), sj = Math.round(sz / step), gi = Math.round(gx / step), gj = Math.round(gz / step);
  const open = new MinHeap(), g = new Map(), from = new Map(), walk = new Map();
  const ok = (i, j) => { const k = key(i, j); let v = walk.get(k); if (v === undefined) { v = walkable(i * step, j * step); walk.set(k, v); } return v; };
  const h = (i, j) => Math.hypot(i - gi, j - gj);
  g.set(key(si, sj), 0); open.push([si, sj], h(si, sj));
  let n = 0;
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (open.size && n++ < maxNodes) {
    const [i, j] = open.pop();
    if (i === gi && j === gj) {
      const path = []; let k = key(i, j), cur = [i, j];
      while (cur) { path.push({ x: cur[0] * step, z: cur[1] * step }); cur = from.get(k); if (cur) k = key(cur[0], cur[1]); }
      path.reverse(); path[0] = { x: sx, z: sz }; path[path.length - 1] = { x: gx, z: gz };   // real start, not the snapped cell centre (which may even lie behind a wall)
      return simplify(walkable, path, sample);
    }
    const gc = g.get(key(i, j));
    for (const [di, dj, c] of dirs) {
      const ni = i + di, nj = j + dj;
      if (!ok(ni, nj) && !(ni === gi && nj === gj)) continue;
      const nk = key(ni, nj), ng = gc + c;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); from.set(nk, [i, j]); open.push([ni, nj], ng + h(ni, nj)); }
    }
  }
  return null;
}
// drop redundant corners: go straight when two points are directly walkable
function simplify(walkable, path, sample) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let a = 0;
  while (a < path.length - 1) {
    let b = path.length - 1;
    while (b > a + 1 && !lineClear(walkable, path[a], path[b], sample)) b--;
    out.push(path[b]); a = b;
  }
  return out;
}
function lineClear(walkable, p, q, sample) {
  const d = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(d / sample);
  for (let i = 1; i < n; i++) { const t = i / n; if (!walkable(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)) return false; }
  return true;
}
