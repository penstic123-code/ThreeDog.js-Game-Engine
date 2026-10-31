// Terrain chunk meshes (flat/smooth shading) and vegetation placement (instance matrices, colors, collision circles). Pure computation, no three.js dependency, shared by the main thread and the Worker.
// makeMesher(ctx) takes the height, slope and biome functions from createTerrain and returns { buildChunk, place }.

// mulberry32 whose state can be reset: each placement attempt gets its own stream, so skipping an attempt (edited ground, failed rule)
// never shifts the random numbers of later attempts -- the other trees stay put and felled-tree ids stay valid
import { mulberry32 } from '../../core/mulberry32.js';

function stream() {
  const st = { state: 0 };
  const rnd = () => mulberry32(st);
  rnd.seed = s => { st.state = s | 0; };
  return rnd;
}

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

  // place one kind of vegetation in a chunk by rule. Returns instance matrices (column-major), instance colors, collision circles (world x, z, radius)
  function place(cx, cz, rule, density = 1) {
    const r = { perChunk: 100, minHeight: 1.5, maxHeight: 40, maxSlope: 0.6, cluster: 'none', scale: [0.8, 1.2], stretch: [1, 1], sink: 0.1,
      tintJitter: 0.1, tints: [], salt: 0, biomes: null, collider: 0, avoidFlat: true, ...rule };
    const base = Math.imul(cx, 92821) ^ Math.imul(cz, 68917) ^ SEED ^ Math.imul(r.salt + 1, 40503), rnd = stream();
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const attempts = Math.round(r.perChunk * density);
    const m = new Float32Array(attempts * 16), c = new Float32Array(attempts * 3), k = new Float32Array(r.collider ? attempts * 3 : 0), ids = new Uint32Array(attempts);
    let n = 0;
    for (let a = 0; a < attempts; a++) {
      rnd.seed(base ^ Math.imul(a + 1, 0x9E3779B1));
      const lx = rnd() * CHUNK, lz = rnd() * CHUNK, wx = ox + lx, wz = oz + lz;
      if (editedCell(wx, wz)) continue;   // dug, raised or painted ground: what grew there is gone
      const roll = rnd();
      if (r.cluster !== 'none') {
        const f = fbm(wx * 0.008 + 9, wz * 0.008 - 4, 3);
        let t = Math.min(1, Math.max(0, (f - 0.38) / 0.24));
        if (r.cluster === 'meadow') t = 1 - t;
        if (roll > t * t * 0.9 + 0.03) continue;
      } else if (roll > (r.chance ?? 1)) continue;
      const h = surface(wx, wz), sl = slope(wx, wz);
      if (h < r.minHeight || h > r.maxHeight || sl > r.maxSlope) continue;
      if (r.biomes) { const b = biomeAt(wx, wz, h, sl); const w = r.biomes[b]; if (!w || rnd() > w) continue; }
      if (r.avoidFlat && cfg.flatten.length && inFlatZone(wx, wz)) continue;
      const s = r.scale[0] + rnd() * (r.scale[1] - r.scale[0]);
      const sy = s * (r.stretch[0] + rnd() * (r.stretch[1] - r.stretch[0]));
      const yaw = rnd() * Math.PI * 2, co = Math.cos(yaw), si = Math.sin(yaw);
      const o = n * 16;
      m[o] = co * s; m[o + 1] = 0; m[o + 2] = -si * s; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = si * s; m[o + 9] = 0; m[o + 10] = co * s; m[o + 11] = 0;
      m[o + 12] = lx; m[o + 13] = h - r.sink * s; m[o + 14] = lz; m[o + 15] = 1;
      const jt = r.tintJitter;
      let tr = 1 - jt / 2 + rnd() * jt, tg = 1 - jt / 2 + rnd() * jt, tb = 1 - jt / 2 + rnd() * jt;
      const pick = rnd(); let acc = 0;
      for (const t of r.tints) { acc += t.chance; if (pick < acc) { tr = t.color[0]; tg = t.color[1]; tb = t.color[2]; break; } }
      c[n * 3] = tr; c[n * 3 + 1] = tg; c[n * 3 + 2] = tb;
      if (r.collider) { k[n * 3] = wx; k[n * 3 + 1] = wz; k[n * 3 + 2] = r.collider * s; }
      ids[n] = a;   // stable id: attempt index. Independent of density under one seed (density only sets how many attempts), felled-tree records rely on it
      n++;
    }
    return { m: m.slice(0, n * 16), c: c.slice(0, n * 3), k: k.slice(0, r.collider ? n * 3 : 0), ids: ids.slice(0, n), n };
  }

  return { buildChunk, place };
}
