// Drawing side of a swarm (helper of Swarm.js): one plain THREE.InstancedMesh, its matrices written once per rendered frame from the data columns.
import * as THREE from 'three';
import { engineOwned } from '../../core/scene/things.js';

/** The InstancedMesh of a swarm, in the scene, drawing nothing yet */
export function makeMesh(e, s, geometry, material, color) {
  const cap = s.capacity, mesh = new THREE.InstancedMesh(geometry, material, cap), m = mesh.instanceMatrix.array;
  mesh.name = `swarm:${s.name}`;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // with no turn or scale fields a frame writes only the three translation numbers; the other 13 stay as this identity
  for (let o = 0; o < cap * 16; o += 16) m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1;
  if (color) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
  // three computes the bounds once at the first cull and they go stale as objects fly off, wrongly hiding the swarm; so they are made here and updated in the matrix loop
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  mesh.boundingSphere = new THREE.Sphere();
  e.scene.add(engineOwned('swarm', mesh));
  return mesh;
}

/**
 * Write instance matrices (and colours) of the live rows, a of the way from the last fixed step to the latest, and the bounds. A frame pays for what changed: a row whose
 * yaw / pitch / roll / scale are the numbers its matrix was built from keeps those nine values (no sin or cos: most traffic drives straight), and matrices or colours
 * that did not change are not uploaded (parked cars, coins, a crowd's colours). The numbers are kept per row, not per object: after a swap-remove equal numbers still mean an equal block.
 */
export function writeMesh(s, a) {
  const mesh = s.mesh, n = s._n, d = s.data, m = mesh.instanceMatrix.array, X = d.x, Y = d.y, Z = d.z, PX = s._px, PY = s._py, PZ = s._pz;
  const yaw = d.yaw, pitch = d.pitch, roll = d.roll, sc = d.scale, turns = !!(yaw || pitch || roll);
  const built = turns || sc ? s._built ??= new Float64Array(s.capacity * 4).fill(NaN) : null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, big = sc ? 0 : 1, dirty = false;
  for (let i = 0, o = 0, t = 0; i < n; i++, o += 16, t += 4) {
    const x = PX[i] + (X[i] - PX[i]) * a, y = PY[i] + (Y[i] - PY[i]) * a, z = PZ[i] + (Z[i] - PZ[i]) * a, k = sc ? sc[i] : 1;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
    if (k > big) big = k;
    if (built) {
      const px = pitch ? pitch[i] : 0, py = yaw ? yaw[i] : 0, pz = roll ? roll[i] : 0;
      if (built[t] !== py || built[t + 1] !== px || built[t + 2] !== pz || built[t + 3] !== k) {
        built[t] = py; built[t + 1] = px; built[t + 2] = pz; built[t + 3] = k; dirty = true;
        if (turns) {
          // the formula of three's Euler 'YXZ' (the spec compares it with Matrix4.compose); no Object3D, 50,000 objects cannot allocate each frame
          const ca = Math.cos(px), b = Math.sin(px), c = Math.cos(py), dd = Math.sin(py), e = Math.cos(pz), f = Math.sin(pz);
          const ce = c * e, cf = c * f, de = dd * e, df = dd * f;
          m[o] = (ce + df * b) * k; m[o + 1] = ca * f * k; m[o + 2] = (cf * b - de) * k;
          m[o + 4] = (de * b - cf) * k; m[o + 5] = ca * e * k; m[o + 6] = (df + ce * b) * k;
          m[o + 8] = ca * dd * k; m[o + 9] = -b * k; m[o + 10] = ca * c * k;
        } else { m[o] = k; m[o + 5] = k; m[o + 10] = k; }
      }
    }
    if (m[o + 12] !== x || m[o + 13] !== y || m[o + 14] !== z) { m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; dirty = true; }
  }
  mesh.count = n;
  if (!n) return;
  // upload the live part only: capacity is sized for the peak and most frames use far less
  const im = mesh.instanceMatrix;
  if (dirty) { im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true; }
  const col = mesh.instanceColor;
  if (col) {
    const c = col.array, R = d.r, G = d.g, B = d.b;
    let tinted = false;
    for (let i = 0, o = 0; i < n; i++, o += 3) if (c[o] !== R[i] || c[o + 1] !== G[i] || c[o + 2] !== B[i]) { c[o] = R[i]; c[o + 1] = G[i]; c[o + 2] = B[i]; tinted = true; }
    if (tinted) { col.clearUpdateRanges(); col.addUpdateRange(0, n * 3); col.needsUpdate = true; }
  }
  const g = mesh.geometry.boundingSphere, bs = mesh.boundingSphere, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2, hz = (z1 - z0) / 2;
  bs.center.set(x0 + hx, y0 + hy, z0 + hz);
  bs.radius = Math.hypot(hx, hy, hz) + (g.radius + g.center.length()) * big;
}
