// Sky shadow part (mixed into Sky.prototype): shadow params, placing the shadow center at the focus (snapped to a grid or shadow pixels), updating shadows every N frames.
import * as THREE from 'three';
import { checkCascades, syncCascades } from './cascades.js';
import { setShadowUpdate, shadowUpdatePending, isWebGPU } from '../../render/backend.js';

/**
 * Default sun shadow depth bias. three adds it in the shadow camera's 0-1 depth, which here spans near 1 to far 420 m, so it is a world offset of
 * bias x 419 m: the old -0.0006 was 25 cm, and anything resting on the ground (a character's body, a crate, a step) lost the shadow at its base
 * (demo finding 2026-11-02: "daytime shadows weak"). 2 cm keeps the contact shadow; acne is held by normalBias (0.04 m, measured on a sphere at low sun)
 */
export const SKY_BIAS = -0.00005;

/**
 * The shadow settings to start with: low-tier devices default to a 1024 shadow map (a quarter of the fill cost; the update rate stays,
 * since skipping frames makes wind-swayed shadows stutter) and one shadow map (cascades redraw the casters once per cascade); the style's
 * shadow.low overrides that, and sky({ shadow }) wins outright except for cascades, which stay at 1 on low unless its low.cascades says so
 */
export function shadowFor(tier, styleShadow = {}, optionShadow = undefined) {
  if (optionShadow) { const { low, ...sh } = optionShadow; return tier === 'low' ? { ...sh, cascades: low?.cascades ?? 1 } : sh; }
  const { low, ...sh } = styleShadow;
  return tier === 'low' ? { ...sh, mapSize: Math.min(sh.mapSize ?? 2048, 1024), cascades: 1, ...low } : sh;
}

export const shadowMethods = {
  /** Apply shadow fields (engine.look.shadow.set(o): bias / normalBias, updateEvery, snap, ahead, radius, blurSamples, cascades / maxFar / fade / lightMargin / split; lookShadow.js calls this) to the sun and the cascades (look.shadow's apply; the part checked the values when it took them) */
  _applyShadow(o) {
    const s = this.shadow;
    checkCascades(this, o);
    for (const k of Object.keys(s)) if (o[k] !== undefined) s[k] = o[k];
    const sun = this._sun.shadow;
    sun.bias = s.bias; sun.normalBias = s.normalBias; sun.radius = s.radius; sun.blurSamples = s.blurSamples;
    if (o.extent !== undefined) { const c = sun.camera; c.left = c.bottom = -s.extent; c.right = c.top = s.extent; c.updateProjectionMatrix(); }   // one map only: cascades size their own
    syncCascades(this);
    // after the cascades: on WebGPU the switch is per light, so the cascade lights just made get it too (render/backend.js).
    // now: needed after a type switch when autoUpdate is off, otherwise the rebuilt map stays empty until the next scheduled update
    setShadowUpdate(this.engine.renderer, this.engine.scene, { auto: s.updateEvery <= 1, now: true });
    return this;
  },
  /** Call after rendering: when updateEvery > 1, request a shadow update every N frames */
  afterRender() {
    const n = this.shadow.updateEvery;
    if (n > 1 && ++this._shadowFrame >= n) { this._shadowFrame = 0; setShadowUpdate(this.engine.renderer, this.engine.scene, { now: true }); this._shadowAt?.copy(this._sun.target.position); }
  },

  /**
   * Change shadow resolution (raise temporarily for photo mode); with cascades, every cascade's map. Why each one: the cascades copied the
   * sun's size only when built (WebGL: extra lights; WebGPU: the node's per-cascade shadows), so a later change reached the nearest one at most.
   * WebGL allocates a map only while shadow.map is null; WebGPU's shadow node resizes its own map from mapSize on every redraw.
   */
  setShadowMapSize(n) {
    const gpu = isWebGPU(this.engine.renderer), sun = this._sun;
    let changed = false;
    for (const sh of [sun.shadow, ...(this.csm?.lights ?? []).filter(l => l !== sun).map(l => l.shadow)]) {
      if (sh.mapSize.x === n) continue;
      sh.mapSize.set(n, n); changed = true;
      if (!gpu) { sh.map?.dispose(); sh.map = null; }
    }
    if (changed) setShadowUpdate(this.engine.renderer, this.engine.scene, { now: true });   // a resized map is empty until redrawn (updateEvery > 1)
  },

  // Shadow center: the focus (optionally shifted ahead of the view) snapped to a grid or shadow pixels; request an update when the snapped cell changes and shadows are not updated every frame
  _placeShadow(focus, lightDir) {
    const S = this.shadow, tp = this._sun.target.position, cam = this.engine.camera;
    // owned (core/owned.js): a game that aims the sun itself keeps its direction (the box still follows); one that places the target keeps it
    if (!this._oSunDir.on) lightDir = (this._gameDir ??= new THREE.Vector3()).subVectors(this._sun.position, tp).normalize();
    const follow = S.follow ?? 'focus';
    if (!this._oFollow.on || follow === false) { this._sun.position.copy(tp).addScaledVector(lightDir, this.orbit.distance); this._sun.target.updateMatrixWorld(); return; }
    if (follow === 'camera') tp.copy(cam.position);
    else if (follow?.isObject3D) follow.getWorldPosition(tp);
    else if (typeof follow === 'function') tp.copy(follow());
    else tp.copy(focus);
    if (S.ahead) { cam.getWorldDirection(this._ahead ??= new THREE.Vector3()); this._ahead.y = 0; if (this._ahead.lengthSq() > 1e-6) tp.addScaledVector(this._ahead.normalize(), S.ahead); }
    let key;
    if (S.snap === 'texel') {
      // the light-space right and up axes (matching the shadow camera lookAt), rounded to one shadow pixel along each
      const sc = this._sun.shadow.camera, texel = (sc.right - sc.left) / this._sun.shadow.mapSize.x;
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
      const e = this.engine, last = this._shadowAt ??= tp.clone();
      if (shadowUpdatePending(e.renderer, e.scene) || last.distanceToSquared(tp) > (this._sun.shadow.camera.right / 4) ** 2) { setShadowUpdate(e.renderer, e.scene, { now: true }); last.copy(tp); }
    }
    this._snapKey = key;
    this._sun.position.copy(tp).addScaledVector(lightDir, this.orbit.distance);
    this._sun.target.updateMatrixWorld();
  },
};
