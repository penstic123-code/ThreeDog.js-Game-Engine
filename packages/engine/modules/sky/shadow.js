// Sky shadow part (mixed into Sky.prototype): shadow params, placing the shadow center at the focus (snapped to a grid or shadow pixels), updating shadows every N frames.
import * as THREE from 'three';
import { shadowTypeOf } from '../../core/shadowTypes.js';

/**
 * The shadow settings to start with: low-tier devices default to a 1024 shadow map (a quarter of the fill cost; the update rate stays,
 * since skipping frames makes wind-swayed shadows stutter); the style's shadow.low overrides that, and sky({ shadow }) wins outright
 */
export function shadowFor(tier, styleShadow = {}, optionShadow = undefined) {
  if (optionShadow) return optionShadow;
  const { low, ...sh } = styleShadow;
  return tier === 'low' ? { ...sh, mapSize: Math.min(sh.mapSize ?? 2048, 1024), ...low } : sh;
}

export const shadowMethods = {
  /**
   * Change shadow params (only the given fields): bias / normalBias prevent banding; updateEvery updates shadows every N frames (1 = every frame);
   * snap snap = shadow center snap grid (meters, or 'texel' to snap to shadow pixels); ahead = meters to shift the shadow center in front of the view;
   * type = 'basic' (hard edge) | 'pcf' | 'vsm' (soft, costlier; switching rebuilds the shadow map and recompiles materials, so do it rarely);
   * radius = edge softness (pcf, vsm; no effect on basic); blurSamples = blur quality (vsm only)
   */
  setShadow(o = {}) {
    const s = this.shadow;
    if (o.type !== undefined) shadowTypeOf(o.type, 'sky.setShadow({ type })');
    for (const k of Object.keys(s)) if (o[k] !== undefined) s[k] = o[k];
    const sm = this.engine.renderer.shadowMap, sun = this.sun.shadow;
    // validate before applying so a typo leaves the previous type in place
    if (o.type !== undefined) { sm.type = shadowTypeOf(o.type, 'sky.setShadow({ type })'); this.engine.shadowType = o.type; }
    else s.type = this.engine.shadowType;
    sun.bias = s.bias; sun.normalBias = s.normalBias; sun.radius = s.radius; sun.blurSamples = s.blurSamples;
    sm.autoUpdate = s.updateEvery <= 1;
    // needed after a type switch when autoUpdate is off: otherwise the rebuilt map stays empty until the next scheduled update
    sm.needsUpdate = true;
    return this;
  },
  /** Call after rendering: when updateEvery > 1, request a shadow update every N frames */
  afterRender() {
    const n = this.shadow.updateEvery;
    if (n > 1 && ++this._shadowFrame >= n) { this._shadowFrame = 0; this.engine.renderer.shadowMap.needsUpdate = true; this._shadowAt?.copy(this.sun.target.position); }
  },

  /** Change shadow resolution (raise temporarily for photo mode) */
  setShadowMapSize(n) { const sh = this.sun.shadow; if (sh.mapSize.x === n) return; sh.mapSize.set(n, n); sh.map?.dispose(); sh.map = null; },

  // Shadow center: the focus (optionally shifted ahead of the view) snapped to a grid or shadow pixels; request an update when the snapped cell changes and shadows are not updated every frame
  _placeShadow(focus, lightDir) {
    const S = this.shadow, tp = this.sun.target.position, cam = this.engine.camera;
    tp.copy(focus);
    if (S.ahead) { cam.getWorldDirection(this._ahead ??= new THREE.Vector3()); this._ahead.y = 0; if (this._ahead.lengthSq() > 1e-6) tp.addScaledVector(this._ahead.normalize(), S.ahead); }
    let key;
    if (S.snap === 'texel') {
      // the light-space right and up axes (matching the shadow camera lookAt), rounded to one shadow pixel along each
      const sc = this.sun.shadow.camera, texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
      const f = this._f ??= new THREE.Vector3(), r = this._r ??= new THREE.Vector3(), u = this._u ??= new THREE.Vector3();
      f.copy(lightDir).negate();
      r.crossVectors(f, cam.up); if (r.lengthSq() < 1e-8) r.set(1, 0, 0); r.normalize();
      u.crossVectors(r, f);
      const a = Math.round(tp.dot(r) / texel), b = Math.round(tp.dot(u) / texel), c = tp.dot(f);
      tp.copy(r).multiplyScalar(a * texel).addScaledVector(u, b * texel).addScaledVector(f, c);
      key = a + ',' + b;
    } else {
      const g = S.snap || 1e-3;
      tp.x = Math.round(tp.x / g) * g; tp.z = Math.round(tp.z / g) * g;
      key = tp.x + ',' + tp.z;
    }
    // when not updating every frame: update early only if the center is over 1/4 of the coverage radius from the last update (teleport, fast movement); otherwise follow the updateEvery cadence
    if (S.updateEvery > 1 && key !== this._snapKey) {
      const sm = this.engine.renderer.shadowMap, last = this._shadowAt ??= tp.clone();
      if (sm.needsUpdate || last.distanceToSquared(tp) > (this.sun.shadow.camera.right / 4) ** 2) { sm.needsUpdate = true; last.copy(tp); }
    }
    this._snapKey = key;
    this.sun.position.copy(tp).addScaledVector(lightDir, this.orbit.distance);
    this.sun.target.updateMatrixWorld();
  },
};
