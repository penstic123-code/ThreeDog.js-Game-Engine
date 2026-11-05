// Terrain chunk meshes (flat / smooth / texture shading) and the terrain's vegetation placement (the shared rule code in core/stream/scatter.js).
// Pure computation, no three.js dependency, shared by the main thread and the Worker.
// makeMesher(ctx) takes the height, slope and biome functions from createTerrain and returns { buildChunk, place }.

import { makePlacer } from '../../core/stream/scatter.js';
import { makeColorMap } from './terrainColorMap.js';
import { makeIslandBuilder, faceN } from './terrainIsland.js';

// shape (terrain({ shape }), else null): island chunks come from terrainIsland.js and nothing grows where has(x, z) is false
export function makeMesher({ cfg, CHUNK, RES, CELL, gridH, surface, slope, biomeAt, fbm, faceColor, paintColor, cellType, editedCell, diagOf, userNormal, shape }) {
  const SEED = cfg.seed | 0;
  // lighting normal at a grid point: the game's normalFn, else central difference of the neighboring heights
  const gridNormal = userNormal
    ? (gi, gj) => { const v = userNormal(gi, gj, gridH, CELL), l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
    : (gi, gj) => {
      const dx = (gridH(gi + 1, gj) - gridH(gi - 1, gj)) / (2 * CELL), dz = (gridH(gi, gj + 1) - gridH(gi, gj - 1)) / (2 * CELL), l = Math.hypot(dx, 1, dz);
      return [-dx / l, 1 / l, -dz / l];
    };
  const textured = cfg.shading === 'texture';
  const smoothLight = cfg.shading === 'smooth' || textured && cfg.normals !== 'flat';   // smooth: one normal per grid point; else per triangle
  // with a shape the map is colored from the unmasked height (filtering at the rim reads real ground colors) and void pixels get alpha 0
  const colorMap = textured ? makeColorMap({ cfg, CHUNK, CELL, surface, faceColor, paintColor, cellType, gridNormal, inside: shape?.has }) : null;
  // chunk bounding sphere [x, y, z, r] for heights minH..maxH, grown by boundsPad
  const half = CHUNK / 2, pad = cfg.boundsPad;
  const sphereOf = (ox, oz, minH, maxH) => [ox + half, (minH + maxH) / 2 + pad.up, oz + half, Math.hypot(half, half, (maxH - minH) / 2 + pad.radius)];
  // build one chunk's terrain mesh (flat: one normal and color per triangle; smooth: per grid point; texture: colors come from the color map, vertex colors are white).
  // uv = world xz / chunk size, continuous across chunks for tiling textures
  // keep: an edit's repaint of the color map (see terrainColorMap.js)
  function buildChunk(cx, cz, keep) {
    const n = RES, i0 = cx * n, j0 = cz * n, ox = cx * CHUNK, oz = cz * CHUNK;
    const len = n * n * 18;
    const pos = new Float32Array(len), nor = new Float32Array(len), col = new Float32Array(len), uv = new Float32Array(len / 3 * 2);
    if (textured) col.fill(1);
    const tmp = [0, 0, 0];
    let p = 0, q = 0, minH = Infinity, maxH = -Infinity, painted = textured;   // painted: the whole cell has the painted type's color (texture mode: no vertex colors to compute)
    function vert(x, y, z, nx, ny, nz) {
      pos[p] = x; pos[p + 1] = y; pos[p + 2] = z; nor[p] = nx; nor[p + 1] = ny; nor[p + 2] = nz;
      if (!textured) { col[p] = tmp[0]; col[p + 1] = tmp[1]; col[p + 2] = tmp[2]; }
      p += 3;
      uv[q++] = (ox + x) / CHUNK; uv[q++] = (oz + z) / CHUNK;
    }
    const N = [0, 0, 0];
    function tri(ax, ay, az, bx, by, bz, qx, qy, qz) {
      faceN(ax, ay, az, bx, by, bz, qx, qy, qz, N);
      const nx = N[0], ny = N[1], nz = N[2];
      if (!painted) faceColor((ay + by + qy) / 3, ny, ox + (ax + bx + qx) / 3, oz + (az + bz + qz) / 3, tmp);
      vert(ax, ay, az, nx, ny, nz); vert(bx, by, bz, nx, ny, nz); vert(qx, qy, qz, nx, ny, nz);
    }
    function svert(x, y, z, gi, gj) {
      const nn = gridNormal(gi, gj);
      if (!painted) faceColor(y, nn[1], ox + x, oz + z, tmp);
      vert(x, y, z, nn[0], nn[1], nn[2]);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
      const ha = gridH(i0 + i, j0 + j), hb = gridH(i0 + i + 1, j0 + j), hc = gridH(i0 + i, j0 + j + 1), hd = gridH(i0 + i + 1, j0 + j + 1);
      minH = Math.min(minH, ha, hb, hc, hd); maxH = Math.max(maxH, ha, hb, hc, hd);
      if (!textured) {
        const pt = cellType(i0 + i, j0 + j);
        painted = pt !== undefined;
        if (painted) paintColor(pt, ox + x0 + CELL / 2, oz + z0 + CELL / 2, tmp);
      }
      const d = diagOf(i0 + i, j0 + j, ha, hb, hc, hd);   // 0: b-c, the original cut; 1: a-d
      if (smoothLight) {
        const I = i0 + i, J = j0 + j;
        if (d) {
          svert(x0, ha, z0, I, J); svert(x0, hc, z1, I, J + 1); svert(x1, hd, z1, I + 1, J + 1);
          svert(x0, ha, z0, I, J); svert(x1, hd, z1, I + 1, J + 1); svert(x1, hb, z0, I + 1, J);
        } else {
          svert(x0, ha, z0, I, J); svert(x0, hc, z1, I, J + 1); svert(x1, hb, z0, I + 1, J);
          svert(x1, hb, z0, I + 1, J); svert(x0, hc, z1, I, J + 1); svert(x1, hd, z1, I + 1, J + 1);
        }
      } else if (d) {
        tri(x0, ha, z0, x0, hc, z1, x1, hd, z1);
        tri(x0, ha, z0, x1, hd, z1, x1, hb, z0);
      } else {
        tri(x0, ha, z0, x0, hc, z1, x1, hb, z0);
        tri(x1, hb, z0, x0, hc, z1, x1, hd, z1);
      }
    }
    const out = { pos, nor, col, uv, minH, maxH, sphere: sphereOf(ox, oz, minH, maxH) };
    if (colorMap) out.tex = colorMap(cx, cz, keep);
    return out;
  }

  function inFlatZone(x, z) { for (const f of cfg.flatten) if (Math.hypot(x - f.x, z - f.z) < f.radius * (f.clearRatio ?? 0.8)) return true; return false; }
  // vegetation placement: the shared rule code (core/stream/scatter.js) over this terrain's height, slope, ground types and edits
  const skip = shape ? (x, z) => !shape.has(x, z) || editedCell(x, z) : editedCell;
  const place = makePlacer({ chunk: CHUNK, seed: SEED, surface, slope, typeAt: biomeAt, fbm, skip, flat: cfg.flatten.length ? inFlatZone : null });

  const build = shape ? makeIslandBuilder({ CHUNK, RES, CELL, gridH, faceColor, paintColor, cellType, diagOf, gridNormal, textured, smoothLight, colorMap, shape, sphereOf }) : buildChunk;
  return { buildChunk: build, place };
}
