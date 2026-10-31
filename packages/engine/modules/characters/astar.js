// Grid A* pathfinding (fallback when no navmesh is installed or it is not ready yet). The one A* in the engine:
// engine.characters.findPath calls it with the collision module's walkability, the pathfinding worker (pathJob.js) with a snapshot of it.
// In games use engine.characters.findPath / findPathAsync, do not import this directly. Worker-safe: no imports.

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
export function findPath(walkable, sx, sz, gx, gz, { step = 2, maxNodes = 6000 } = {}) {
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
      path.reverse(); path[path.length - 1] = { x: gx, z: gz };
      return simplify(walkable, path);
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
function simplify(walkable, path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  let a = 0;
  while (a < path.length - 1) {
    let b = path.length - 1;
    while (b > a + 1 && !lineClear(walkable, path[a], path[b])) b--;
    out.push(path[b]); a = b;
  }
  return out;
}
function lineClear(walkable, p, q) {
  const d = Math.hypot(q.x - p.x, q.z - p.z), n = Math.ceil(d / 1.5);
  for (let i = 1; i < n; i++) { const t = i / n; if (!walkable(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)) return false; }
  return true;
}
