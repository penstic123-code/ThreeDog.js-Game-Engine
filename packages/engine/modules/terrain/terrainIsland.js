// Island chunks (terrain({ shape })): the chunk mesh when the world has an outline. Its own function instead of branches in buildChunk, so the
// default ground keeps its exact bytes. Pure computation, no three.js (runs in the Worker).
//
// Top: every ground cell (or the part of a boundary cell the marching-squares cut keeps, terrainShape.js) is split along the cell's diagonal
// and fanned into triangles whose heights lie on the same two planes engine.surface reads, so feet and the drawn ground agree up to the rim.
// Side: each rim segment is pushed down by side.depth (flat outward normal, side.ground color). Bottom (optional): every top vertex again,
// side.depth + bottom.depth lower, winding reversed; a second band of wall joins the side to it. Vertex order: top, side, bottom -- `top`
// and `solid` count vertices so the texture-shading material covers only the top and collision leaves the bottom out.
import { forEdges } from './terrainShape.js';

/** Unit normal of triangle a, b, q into o (buildChunk's flat triangles use it too) */
export function faceN(ax, ay, az, bx, by, bz, qx, qy, qz, o) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; o[0] = nx / l; o[1] = ny / l; o[2] = nz / l;
  return o;
}

export function makeIslandBuilder({ CHUNK, RES, CELL, gridH, faceColor, paintColor, cellType, diagOf, gridNormal, textured, smoothLight, colorMap, shape, sphereOf }) {
  const { cut, maskAt, sideDepth, bottomDepth, sideGround, bottomGround } = shape;
  const FULL = [[0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]];
  const bucket = () => ({ p: [], n: [], c: [] });
  const put = (B, x, y, z, nx, ny, nz, c) => { B.p.push(x, y, z); B.n.push(nx, ny, nz); B.c.push(c[0], c[1], c[2]); };
  const WHITE = [1, 1, 1];
  // keep the part of convex polygon P on one side of the cell diagonal (s >= 0 for sign 1, s <= 0 for sign -1)
  function clip(P, d, sign) {
    const s = (fx, fz) => sign * (d ? fz - fx : 1 - fx - fz), out = [];
    forEdges(P, (ax, az, bx, bz, k) => {
      const sa = s(ax, az), sb = s(bx, bz);
      if (sa >= 0) out.push(ax, az, P[k + 2]);
      if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) { const t = sa / (sa - sb); out.push(ax + (bx - ax) * t, az + (bz - az) * t, 0); }
    });
    return out;
  }

  return function buildIslandChunk(cx, cz) {
    const n = RES, i0 = cx * n, j0 = cz * n, ox = cx * CHUNK, oz = cz * CHUNK;
    const top = bucket(), wall = bucket(), under = bucket();
    const paint = [0, 0, 0], col = [0, 0, 0], nrm = [0, 0, 0], V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const I = i0 + i, J = j0 + j, polys = cut(I, J) ?? FULL;
      if (!polys.length) continue;
      const x0 = i * CELL, z0 = j * CELL;
      const ha = gridH(I, J), hb = gridH(I + 1, J), hc = gridH(I, J + 1), hd = gridH(I + 1, J + 1), d = diagOf(I, J, ha, hb, hc, hd);
      // the two triangle planes of the cell, chosen exactly as surface() chooses them
      const H = d ? (fx, fz) => (fz >= fx ? ha + (hc - ha) * fz + (hd - hc) * fx : ha + (hb - ha) * fx + (hd - hb) * fz)
        : (fx, fz) => (fx + fz <= 1 ? ha + (hb - ha) * fx + (hc - ha) * fz : hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz));
      const pt = textured ? undefined : cellType(I, J);
      if (pt !== undefined) paintColor(pt, ox + x0 + CELL / 2, oz + z0 + CELL / 2, paint);   // a painted cell is one color
      const g = smoothLight ? [gridNormal(I, J), gridNormal(I + 1, J), gridNormal(I, J + 1), gridNormal(I + 1, J + 1)] : null;
      const below = (fx, fz, y) => y - sideDepth(ox + x0 + fx * CELL, oz + z0 + fz * CELL);
      const tri = (P, a, b, q) => {
        for (let k = 0; k < 3; k++) { const s = [a, b, q][k], fx = P[s], fz = P[s + 1]; V[k][0] = x0 + fx * CELL; V[k][1] = H(fx, fz); V[k][2] = z0 + fz * CELL; }
        for (const v of V) { maxH = Math.max(maxH, v[1]); minH = Math.min(minH, v[1]); }
        if (smoothLight) {
          for (let k = 0; k < 3; k++) {
            const s = [a, b, q][k], fx = P[s], fz = P[s + 1], v = V[k];
            for (let c = 0; c < 3; c++) nrm[c] = (g[0][c] * (1 - fx) + g[1][c] * fx) * (1 - fz) + (g[2][c] * (1 - fx) + g[3][c] * fx) * fz;
            const l = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
            const c3 = textured ? WHITE : pt !== undefined ? paint : faceColor(v[1], nrm[1] / l, ox + v[0], oz + v[2], col);
            put(top, v[0], v[1], v[2], nrm[0] / l, nrm[1] / l, nrm[2] / l, c3);
          }
        } else {
          faceN(V[0][0], V[0][1], V[0][2], V[1][0], V[1][1], V[1][2], V[2][0], V[2][1], V[2][2], nrm);
          const c3 = textured ? WHITE : pt !== undefined ? paint
            : faceColor((V[0][1] + V[1][1] + V[2][1]) / 3, nrm[1], ox + (V[0][0] + V[1][0] + V[2][0]) / 3, oz + (V[0][2] + V[1][2] + V[2][2]) / 3, col);
          for (const v of V) put(top, v[0], v[1], v[2], nrm[0], nrm[1], nrm[2], c3);
        }
        if (bottomDepth) {   // the same triangle hung below, reversed
          const B = [0, 2, 1].map(k => {
            const s = [a, b, q][k], fx = P[s], fz = P[s + 1], v = V[k];
            return [v[0], below(fx, fz, v[1]) - bottomDepth(ox + v[0], oz + v[2], Math.max(0, maskAt(I, J, fx, fz))), v[2]];
          });
          faceN(B[0][0], B[0][1], B[0][2], B[1][0], B[1][1], B[1][2], B[2][0], B[2][1], B[2][2], nrm);
          paintColor(bottomGround, ox + (B[0][0] + B[1][0] + B[2][0]) / 3, oz + (B[0][2] + B[1][2] + B[2][2]) / 3, col);
          for (const v of B) { minH = Math.min(minH, v[1]); put(under, v[0], v[1], v[2], nrm[0], nrm[1], nrm[2], col); }
        }
      };
      for (const P of polys) {
        for (const piece of [clip(P, d, 1), clip(P, d, -1)])
          for (let k = 3; k + 3 < piece.length; k += 3) tri(piece, 0, k + 3, k);   // fan, clockwise in (x, z) like buildChunk: normal up
        // rim: consecutive crossings of the counter-clockwise polygon; outward is to the right of P -> Q. A segment that crosses the
        // cell diagonal is walled in two pieces: the top bends there (two planes), and one straight wall edge would leave a triangular
        // slit under the rim -- wide when edge.round bends the top down
        const L = P.length, sd = (fx, fz) => (d ? fz - fx : 1 - fx - fz);
        for (let k = 0; k < L; k += 3) {
          const q = (k + 3) % L;
          if (!P[k + 2] || !P[q + 2]) continue;
          const sp = sd(P[k], P[k + 1]), sq = sd(P[q], P[q + 1]);
          if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
            const t = sp / (sp - sq), mx = P[k] + (P[q] - P[k]) * t, mz = P[k + 1] + (P[q + 1] - P[k + 1]) * t;
            rim(P[k], P[k + 1], mx, mz); rim(mx, mz, P[q], P[q + 1]);
          } else rim(P[k], P[k + 1], P[q], P[q + 1]);
        }
      }
      // one wall piece under the rim from (pf) to (qf), cell units
      function rim(pfx, pfz, qfx, qfz) {
        const px = x0 + pfx * CELL, pz = z0 + pfz * CELL, qx = x0 + qfx * CELL, qz = z0 + qfz * CELL;
        const dx = qx - px, dz = qz - pz, l = Math.hypot(dx, dz);
        if (l < 1e-9) return;
        const nx = dz / l, nz = -dx / l, pTop = H(pfx, pfz), qTop = H(qfx, qfz);
        const pMid = below(pfx, pfz, pTop), qMid = below(qfx, qfz, qTop);
        paintColor(sideGround, ox + (px + qx) / 2, oz + (pz + qz) / 2, col);
        band(wall, px, pz, qx, qz, pTop, qTop, pMid, qMid, nx, nz, col);
        maxH = Math.max(maxH, pTop, qTop); minH = Math.min(minH, pMid, qMid);
        if (bottomDepth) {
          const pLow = pMid - bottomDepth(ox + px, oz + pz, 0), qLow = qMid - bottomDepth(ox + qx, oz + qz, 0);
          paintColor(bottomGround, ox + (px + qx) / 2, oz + (pz + qz) / 2, col);
          band(wall, px, pz, qx, qz, pMid, qMid, pLow, qLow, nx, nz, col);
          minH = Math.min(minH, pLow, qLow);
        }
      }
    }
    const nTop = top.p.length / 3, nWall = wall.p.length / 3, all = top.p.length + wall.p.length + under.p.length;
    const pos = new Float32Array(all), nor = new Float32Array(all), clr = new Float32Array(all), uv = new Float32Array(all / 3 * 2);
    let o = 0;
    for (const B of [top, wall, under]) { pos.set(B.p, o); nor.set(B.n, o); clr.set(B.c, o); o += B.p.length; }
    for (let k = 0, q = 0; k < all; k += 3) { uv[q++] = (ox + pos[k]) / CHUNK; uv[q++] = (oz + pos[k + 2]) / CHUNK; }
    if (!all) minH = maxH = 0;   // a chunk wholly in the void: an empty mesh, still 'ready' so loading never waits on it
    const out = { pos, nor, col: clr, uv, minH, maxH, top: nTop, solid: nTop + nWall, sphere: sphereOf(ox, oz, minH, maxH) };
    if (colorMap && nTop) out.tex = colorMap(cx, cz);
    return out;
  };

  // one quad of wall from (p, q) top edge down to the bottom edge, front face outward
  function band(B, px, pz, qx, qz, pT, qT, pB, qB, nx, nz, c) {
    if (pT - pB < 1e-6 && qT - qB < 1e-6) return;
    put(B, px, pT, pz, nx, 0, nz, c); put(B, qx, qT, qz, nx, 0, nz, c); put(B, px, pB, pz, nx, 0, nz, c);
    put(B, qx, qT, qz, nx, 0, nz, c); put(B, qx, qB, qz, nx, 0, nz, c); put(B, px, pB, pz, nx, 0, nz, c);
  }
}
