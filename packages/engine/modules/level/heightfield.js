// Level heightfield: project walkable meshes onto a horizontal grid, storing per grid point the highest surface height and ground type.
// Equivalent to casting a ray down at every grid point and taking the highest hit, but it stamps triangles directly,
// so no ray acceleration structure is needed; tens of thousands of triangles take only tens of ms. Height queries are then O(1) bilinear interpolation.
//
// Internal to the level module only:
//   const hf = buildHeightfield(meshes, { cellSize: 0.5, outside: 0, typeOf });
//   hf.height(x, z, refY?) / hf.slope(x, z) / hf.type(x, z)
//
// Multi-layer (bridges, caves, interiors): up-facing surfaces more than layerGap apart at one grid point each get a layer (layerGap defaults to character height: a gap too low to stand in, like a crate on the ground, is not a layer). The top layer stays in H/T;
// other layers are stored only for points that have several (extra: point index -> [{ y, t }]); single-layer levels pay no extra memory or time.
// height(x, z, refY) with a reference height picks the highest layer not above refY + stepUp.
import * as THREE from 'three';
import { MOVEMENT_DEFAULTS } from '../../core/movement.js';
import { warnOnce } from '../../core/validate.js';
import { coded } from '../../core/errorHints.js';

// Step-height default comes from the shared movement params (core/movement.js); level passes engine.movement.stepHeight, don't hardcode it elsewhere
const STEP_UP = MOVEMENT_DEFAULTS.stepHeight, LAYER_GAP = MOVEMENT_DEFAULTS.height;   // step height, min gap between layers (character height)

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * meshes   walkable meshes (world matrices must be up to date)
 * cellSize cell edge length (m); auto-enlarged for huge scenes so memory stays bounded (capped at maxCells grid points)
 * outside  height returned outside the mesh or at points with no surface
 * typeOf(mesh, materialIndex) -> ground type string
 * sharpEdge corner-height difference within a cell (m) above which it is a cliff/wall edge: no interpolation, take the nearest corner,
 *           otherwise a 2 m platform edge would smear into a 0.5 m wide slope the character could climb in tiny steps
 */
export function buildHeightfield(meshes, { cellSize = 0.5, outside = 0, maxCells = 4e6, typeOf = () => 'default', sharpEdge = 0.6, layerGap = LAYER_GAP, stepUp = STEP_UP } = {}) {
  const bounds = new THREE.Box3();
  for (const m of meshes) bounds.expandByObject(m);
  if (bounds.isEmpty()) return emptyField(outside);

  let cell = cellSize, nx, nz;
  const w = bounds.max.x - bounds.min.x, d = bounds.max.z - bounds.min.z;
  for (;;) {
    nx = Math.max(2, Math.ceil(w / cell) + 1); nz = Math.max(2, Math.ceil(d / cell) + 1);
    if (nx * nz <= maxCells) break;
    cell *= 1.5;
  }
  if (cell !== cellSize) warnOnce(coded('level-size', `Level too large for cellSize ${cellSize} m: the heightfield cell was enlarged to ${cell.toFixed(2)} m (coarser ground). Pass that cellSize on purpose, or split the level`));
  const minX = bounds.min.x, minZ = bounds.min.z;
  const H = new Float32Array(nx * nz).fill(-Infinity);
  const T = new Uint16Array(nx * nz);          // ground type index into the types array
  const types = ['default'], typeIndex = new Map([['default', 0]]);
  const EPS = 1e-4;
  const extra = new Map();                     // multi-layer: point index -> layers other than the top [{ y, t }]

  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g?.attributes?.position;
    if (!pos) continue;
    const idx = g.index, mw = mesh.matrixWorld;
    const triCount = (idx ? idx.count : pos.count) / 3;
    // multi-material mesh: find each triangle's material via geometry.groups
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : null;
    let curType = typeId(typeOf(mesh, 0)), gi = 0;
    for (let t = 0; t < triCount; t++) {
      if (groups) {
        const v0 = t * 3;
        while (gi < groups.length && v0 >= groups[gi].start + groups[gi].count) gi++;
        curType = gi < groups.length ? typeId(typeOf(mesh, groups[gi].materialIndex)) : 0;
      }
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(mw);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(mw);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      const ax = _a.x, az = _a.z, bx = _b.x, bz = _b.z, cx = _c.x, cz = _c.z;
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;           // vertical faces (wall sides) are invisible from above
      const up = (_b.z - _a.z) * (_c.x - _a.x) - (_b.x - _a.x) * (_c.z - _a.z) > 0;   // only up-facing faces count as an extra layer (a box bottom is not walkable)
      const ia = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - minX) / cell - 1e-6));
      const ib = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cell + 1e-6));
      const ja = Math.max(0, Math.ceil((Math.min(az, bz, cz) - minZ) / cell - 1e-6));
      const jb = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cell + 1e-6));
      for (let j = ja; j <= jb; j++) {
        const pz = minZ + j * cell;
        for (let i = ia; i <= ib; i++) {
          const px = minX + i * cell;
          const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
          if (l1 < -EPS) continue;
          const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
          if (l2 < -EPS) continue;
          const l3 = 1 - l1 - l2;
          if (l3 < -EPS) continue;
          const y = l1 * _a.y + l2 * _b.y + l3 * _c.y, k = j * nx + i;
          const top = H[k];
          if (top === -Infinity) { H[k] = y; T[k] = curType; continue; }
          if (y > top) {
            if (y - top > layerGap && up) addLayer(k, top, T[k]);   // the old top layer becomes a lower layer
            H[k] = y; T[k] = curType;
          } else if (top - y > layerGap && up) addLayer(k, y, curType);
        }
      }
    }
  }
  for (let k = 0; k < H.length; k++) if (H[k] === -Infinity) H[k] = outside;

  // record an extra layer; within layerGap of an existing layer counts as the same layer, keep the higher
  function addLayer(k, y, t) {
    let a = extra.get(k);
    if (!a) extra.set(k, a = []);
    for (const l of a) if (Math.abs(l.y - y) <= layerGap) { if (y > l.y) { l.y = y; l.t = t; } return; }
    a.push({ y, t });
  }

  function typeId(name) {
    let id = typeIndex.get(name);
    if (id === undefined) { id = types.length; types.push(name); typeIndex.set(name, id); }
    return id;
  }

  // highest layer below limit lim at a point; if none, take the lowest layer (so a cave with only a ceiling overhead still has a floor)
  function layerAt(k, lim) {
    const a = extra.get(k);
    if (!a || H[k] <= lim) return H[k];
    let best = -Infinity, low = H[k];
    for (const l of a) { if (l.y <= lim && l.y > best) best = l.y; if (l.y < low) low = l.y; }
    return best > -Infinity ? best : low;
  }

  const maxI = nx - 1, maxJ = nz - 1;
  return {
    cell, nx, nz, minX, minZ, H, T, types, bounds, extra,
    /** Bilinear height; outside the grid returns outside. With refY: highest layer not above refY + stepUp; without, the top layer */
    height(x, z, refY) {
      const fx = (x - minX) / cell, fz = (z - minZ) / cell;
      if (!(fx >= 0 && fz >= 0 && fx <= maxI && fz <= maxJ)) return outside;
      const i = Math.min(maxI - 1, fx | 0), j = Math.min(maxJ - 1, fz | 0), tx = fx - i, tz = fz - j, k = j * nx + i;
      let h00 = H[k], h10 = H[k + 1], h01 = H[k + nx], h11 = H[k + nx + 1];
      if (refY !== undefined && extra.size && (extra.has(k) || extra.has(k + 1) || extra.has(k + nx) || extra.has(k + nx + 1))) {
        const lim = refY + stepUp;
        h00 = layerAt(k, lim); h10 = layerAt(k + 1, lim); h01 = layerAt(k + nx, lim); h11 = layerAt(k + nx + 1, lim);
      }
      if (Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11) > sharpEdge) return tz < 0.5 ? (tx < 0.5 ? h00 : h10) : (tx < 0.5 ? h01 : h11);
      return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    },
    /** Slope = height change / horizontal distance (same as the terrain module) */
    slope(x, z) {
      const fx = (x - minX) / cell, fz = (z - minZ) / cell;
      if (!(fx >= 0 && fz >= 0 && fx <= maxI && fz <= maxJ)) return 0;
      const i = Math.min(maxI - 1, fx | 0), j = Math.min(maxJ - 1, fz | 0), tx = fx - i, tz = fz - j, k = j * nx + i;
      const h00 = H[k], h10 = H[k + 1], h01 = H[k + nx], h11 = H[k + nx + 1];
      const gx = ((h10 - h00) * (1 - tz) + (h11 - h01) * tz) / cell, gz = ((h01 - h00) * (1 - tx) + (h11 - h10) * tx) / cell;
      return Math.sqrt(gx * gx + gz * gz);
    },
    /** Ground type at the nearest grid point */
    type(x, z) {
      const fx = (x - minX) / cell, fz = (z - minZ) / cell;
      // same bounds as height / slope: rounding alone would give a point up to half a cell outside the grid the edge's type while
      // height already says "outside", and a rule picking that type would plant on the outside plane next to the floor
      if (!(fx >= 0 && fz >= 0 && fx <= maxI && fz <= maxJ)) return 'default';
      const i = Math.round(fx), j = Math.round(fz);
      return types[T[j * nx + i]];
    },
  };
}

function emptyField(outside) {
  return { cell: 1, nx: 0, nz: 0, minX: 0, minZ: 0, H: new Float32Array(0), T: new Uint16Array(0), types: ['default'], bounds: new THREE.Box3(),
    height: () => outside, slope: () => 0, type: () => 'default' };
}
