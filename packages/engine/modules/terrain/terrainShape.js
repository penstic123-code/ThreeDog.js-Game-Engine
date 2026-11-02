// World outline (terrain({ shape })): which grid points have ground, the marching-squares cut of a boundary cell, and the side / bottom depths.
// Pure computation, no three.js: the Worker builds island chunks with it and the main thread answers engine.ground.has / surface with the same
// code, so a query and the drawn mesh never disagree about where the edge is. Only created when a game passes shape (the default ground never
// runs any of this).
//
// The mask lives on grid points (like heights): its value there is the game's mask (function or gray image) plus the edge noise and jitter.
// A cell with all four corners > 0 is ground, all four <= 0 is void; a mixed cell is cut along straight lines whose ends sit where the mask
// crosses 0 on the cell edges (linear interpolation). Two chunks compute a shared edge from the same two grid values, so the cut is seamless.
import { compilePure } from '../../core/threadPure.js';
import { grayAt } from '../../core/grayMap.js';

// corner loop a(0,0) b(1,0) d(1,1) c(0,1): counter-clockwise in (x, z); polygons keep that winding
const LX = [0, 1, 1, 0], LZ = [0, 0, 1, 1];

/**
 * @param {any} S the shape config (functions already source text or functions; an image mask carries data)
 * @param {{ CELL: number, NOISE: any, key: (i: number, j: number) => number, hash: Function, fbm: Function }} ctx
 */
/**
 * Walk the edges of a cut-cell polygon P (flat [x, z, tag, x, z, tag, ...], closed): fn(ax, az, bx, bz, k) per edge a -> b, k = a's index.
 * fn returning true stops the walk; returns whether it stopped. The one edge loop inPoly (here) and the island builder's clip share.
 */
export function forEdges(P, fn) {
  const n = P.length;
  for (let k = 0; k < n; k += 3) if (fn(P[k], P[k + 1], P[(k + 3) % n], P[(k + 4) % n], k)) return true;
  return false;
}

export function makeShape(S, { CELL, NOISE, key, hash, fbm }) {
  const pure = (v, label) => (typeof v === 'function' || typeof v === 'string' ? compilePure(v, label).call : null);
  const userMask = pure(S.mask, 'terrain({ shape: { mask } })');
  const img = !userMask && S.mask?.data ? S.mask : null;
  // an image mask still loading (main thread before init): ground everywhere, so nothing falls before the real outline arrives
  const raw = userMask ? (x, z) => userMask(x, z, NOISE) : img ? (x, z) => sample(img, x, z) : () => 1;
  const E = S.edge || {}, amp = E.noise ?? 0, freq = 1 / (E.size ?? 16), jit = E.jitter ?? 0, round = E.round ?? 0;
  const side = S.side ?? {}, bottom = S.bottom ?? null;
  const sideFn = pure(side.depth, 'terrain({ shape: { side: { depth } } })'), sideNum = sideFn ? 0 : side.depth ?? 2;
  const botFn = bottom && pure(bottom.depth, 'terrain({ shape: { bottom: { depth } } })'), botNum = botFn ? 0 : bottom?.depth ?? 4;

  const cache = new Map();
  /** mask value at grid point (i, j): > 0 ground */
  function maskG(i, j) {
    const k = key(i, j);
    let m = cache.get(k);
    if (m === undefined) {
      const x = i * CELL, z = j * CELL;
      m = raw(x, z);
      // own offsets so the rim noise is not the height noise; jitter is per grid point (deterministic: a hash of the indices)
      if (amp) m += amp * (2 * fbm(x * freq + 31.7, z * freq - 11.3, 3) - 1);
      if (jit) m += jit * (2 * hash(i, j, 911) - 1);
      if (cache.size > 400000) cache.clear();
      cache.set(k, m);
    }
    return m;
  }
  /** edge.round: the top bends down by up to `round` meters towards the rim (soft edge); 0 keeps a hard cliff edge */
  const drop = round ? (i, j) => { const t = Math.min(1, Math.max(0, maskG(i, j)) / round); return round * (1 - t) * (1 - t); } : null;

  /**
   * Cut of cell (i, j): null = all ground, [] = all void, else convex polygons as flat [fx, fz, crossing, ...] in cell units (0..1),
   * counter-clockwise in (x, z); crossing = 1 marks a point on the rim (where the mask is 0)
   */
  function cut(i, j) {
    const v = [maskG(i, j), maskG(i + 1, j), maskG(i + 1, j + 1), maskG(i, j + 1)];
    const ins = (v[0] > 0) + (v[1] > 0) + (v[2] > 0) + (v[3] > 0);
    if (ins === 4) return null;
    if (ins === 0) return [];
    const L = [];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) & 3;
      if (v[k] > 0) L.push(LX[k], LZ[k], 0);
      if ((v[k] > 0) !== (v[n] > 0)) { const t = v[k] / (v[k] - v[n]); L.push(LX[k] + (LX[n] - LX[k]) * t, LZ[k] + (LZ[n] - LZ[k]) * t, 1); }
    }
    // saddle (opposite corners ground) with a void center: two separate corners instead of one hexagon
    if (ins === 2 && (v[0] > 0) === (v[2] > 0) && v[0] + v[1] + v[2] + v[3] <= 0) {
      const s = L[2] ? 3 : 0;   // the list starts with a crossing when corner a is void
      const rot = L.slice(s).concat(L.slice(0, s));   // now [corner, X, X, corner, X, X]
      return [rot.slice(15).concat(rot.slice(0, 6)), rot.slice(6, 15)];
    }
    return [L];
  }
  function inPoly(P, fx, fz) {
    return !forEdges(P, (ax, az, bx, bz) => (bx - ax) * (fz - az) - (bz - az) * (fx - ax) < -1e-9);
  }
  /** Is there ground at (x, z) (the same cut the mesh is built from) */
  function has(x, z) {
    const gx = x / CELL, gz = z / CELL, i = Math.floor(gx), j = Math.floor(gz);
    const polys = cut(i, j);
    if (polys === null) return true;
    for (const P of polys) if (inPoly(P, gx - i, gz - j)) return true;
    return false;
  }
  /** mask between grid points (bilinear), for bottom.depth's m */
  function maskAt(i, j, fx, fz) {
    return (maskG(i, j) * (1 - fx) + maskG(i + 1, j) * fx) * (1 - fz) + (maskG(i, j + 1) * (1 - fx) + maskG(i + 1, j + 1) * fx) * fz;
  }
  const sideDepth = sideFn ? (x, z) => sideFn(x, z, NOISE) : () => sideNum;
  const bottomDepth = !bottom ? null : botFn ? (x, z, m) => botFn(x, z, NOISE, m) : () => botNum;
  return { maskG, cut, has, maskAt, drop, sideDepth, bottomDepth, sideGround: side.ground ?? 'cliff', bottomGround: bottom?.ground ?? 'rock', voidY: S.voidY ?? null };
}

// gray image mask: value = gray - threshold (outside the image: no ground)
function sample(M, x, z) {
  const [sx, sz] = M.size, [cx0, cz0] = M.center || [0, 0], th = M.threshold ?? 0.5;
  const u = (x - cx0) / sx + 0.5, v = (z - cz0) / sz + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return -th;
  return grayAt(M, u, v) - th;
}
