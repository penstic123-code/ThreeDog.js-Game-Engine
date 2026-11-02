// Screen point -> ground point. What clicking the ground means for click-to-move, the rts camera and grid placement. In core because several modules use it.
import * as THREE from 'three';

const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();

/**
 * Screen coordinates -> point on the ground (for click-to-move). Samples engine.surface along the ray, then bisects once it crosses the ground.
 * ndcX/ndcY are screen coordinates in -1..1 (input.pointer.ndcX/ndcY). Returns null if the ray points up or the ground is too far.
 * @param {any} e engine
 * @param {number} ndcX
 * @param {number} ndcY
 * @param {{ maxDistance?: number }} [opts]
 * @returns {THREE.Vector3 | null}
 */
export function screenToGround(e, ndcX, ndcY, { maxDistance = 1500 } = {}) {
  const cam = e.camera;
  cam.updateMatrixWorld();
  _ray.setFromCamera(_ndc.set(ndcX, ndcY), cam);
  const o = _ray.ray.origin, d = _ray.ray.direction;
  const above = t => o.y + d.y * t - e.surface(o.x + d.x * t, o.z + d.z * t);
  let t0 = 0, h0 = above(0);
  if (h0 < 0) return new THREE.Vector3(o.x, e.surface(o.x, o.z), o.z);   // camera is underground
  let t = 0;
  while (t < maxDistance) {
    // Step size: faster the higher above ground (estimated from descent rate), but at most 8 m and at least 0.25 m
    const step = d.y < -1e-3 ? Math.min(8, Math.max(0.25, h0 / -d.y * 0.5)) : 8;
    t = t0 + step;
    const h = above(t);
    if (h <= 0) {
      let a = t0, b = t;
      for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (above(m) > 0) a = m; else b = m; }
      const x = o.x + d.x * b, z = o.z + d.z * b;
      return new THREE.Vector3(x, e.surface(x, z), z);
    }
    t0 = t; h0 = h;
    if (d.y >= 0 && h0 > 2000) break;
  }
  return null;
}
