// Terrain chunk meshes (flat/smooth shading) and the terrain's vegetation placement (the shared rule code in core/scatter.js).
// Pure computation, no three.js dependency, shared by the main thread and the Worker.
// makeMesher(ctx) takes the height, slope and biome functions from createTerrain and returns { buildChunk, place }.

import { makePlacer } from '../../core/scatter.js';

export function makeMesher({ cfg, CHUNK, RES, CELL, gridH, surface, slope, biomeAt, fbm, faceColor, paintColor, cellType, editedCell }) {
  const SEED = cfg.seed | 0;
  // build one chunk's terrain mesh (flat: one normal and color per triangle; smooth: per grid point). uv = world xz / chunk size, continuous across chunks for tiling textures
  function buildChunk(cx, cz) {
    const n = RES, i0 = cx * n, j0 = cz * n, ox = cx * CHUNK, oz = cz * CHUNK;
    const len = n * n * 18;
    const pos = new Float32Array(len), nor = new Float32Array(len), col = new Float32Array(len), uv = new Float32Array(len / 3 * 2);
    const tmp = [0, 0, 0];
    let p = 0, q = 0, minH = Infinity, maxH = -Infinity, painted = false;   // painted: the whole cell has the painted type's color
    function vert(x, y, z, nx, ny, nz) {
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z; nor[p] = nx; nor[p + 1] = ny; nor[p + 2] = nz;
      col[p] = tmp[0]; col[p + 1] = tmp[1]; col[p + 2] = tmp[2]; p += 3;
      uv[q++] = (ox + x) / CHUNK; uv[q++] = (oz + z) / CHUNK;
    }
    function tri(ax, ay, az, bx, by, bz, qx, qy, qz) {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = qx - ax, vy = qy - ay, vz = qz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (!painted) faceColor((ay + by + qy) / 3, ny, ox + (ax + bx + qx) / 3, oz + (az + bz + qz) / 3, tmp);
      vert(ax, ay, az, nx, ny, nz); vert(bx, by, bz, nx, ny, nz); vert(qx, qy, qz, nx, ny, nz);
    }
    const smoothShade = cfg.shading === 'smooth';
    const gridNormal = (gi, gj) => {   // smooth mode: grid-point normal (from neighboring height differences)
      const dx = (gridH(gi + 1, gj) - gridH(gi - 1, gj)) / (2 * CELL), dz = (gridH(gi, gj + 1) - gridH(gi, gj - 1)) / (2 * CELL), l = Math.hypot(dx, 1, dz);
      return [-dx / l, 1 / l, -dz / l];
    };
    function svert(x, y, z, gi, gj) {
      const nn = gridNormal(gi, gj);
      if (!painted) faceColor(y, nn[1], ox + x, oz + z, tmp);
      vert(x, y, z, nn[0], nn[1], nn[2]);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const ha = gridH(i0 + i, j0 + j), hb = gridH(i0 + i + 1, j0 + j), hc = gridH(i0 + i, j0 + j + 1), hd = gridH(i0 + i + 1, j0 + j + 1);
      minH = Math.min(minH, ha, hb, hc, hd); maxH = Math.max(maxH, ha, hb, hc, hd);
      const pt = cellType(i0 + i, j0 + j);
      painted = pt !== undefined;
      if (painted) paintColor(pt, ox + x0 + CELL / 2, oz + z0 + CELL / 2, tmp);
      if (smoothShade) {
        const I = i0 + i, J = j0 + j;
        svert(x0, ha, z0, I, J); svert(x0, hc, z1, I, J + 1); svert(x1, hb, z0, I + 1, J);
        svert(x1, hb, z0, I + 1, J); svert(x0, hc, z1, I, J + 1); svert(x1, hd, z1, I + 1, J + 1);
      } else {
        tri(x0, ha, z0, x0, hc, z1, x1, hb, z0);
        tri(x1, hb, z0, x0, hc, z1, x1, hd, z1);
      }
    }
    const half = CHUNK / 2;
    return { pos, nor, col, uv, minH, maxH, sphere: [ox + half, (minH + maxH) / 2 + 3, oz + half, Math.hypot(half, half, (maxH - minH) / 2 + 8)] };
  }

  function inFlatZone(x, z) { for (const f of cfg.flatten) if (Math.hypot(x - f.x, z - f.z) < f.radius * (f.clearRatio ?? 0.8)) return true; return false; }
  // vegetation placement: the shared rule code (core/scatter.js) over this terrain's height, slope, ground types and edits
  const place = makePlacer({ chunk: CHUNK, seed: SEED, surface, slope, typeAt: biomeAt, fbm, skip: editedCell, flat: cfg.flatten.length ? inFlatZone : null });

  return { buildChunk, place };
}
