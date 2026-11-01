// Sky modifier layers (mixed into Sky.prototype): weather and games each write their own layer with modify(); every frame the sky
// composites them into sky.modifiers and applies the result on top of its own colors and light. A layer may also lay a cover color
// (snow, ash, frost) over the foliage / ground season tint (applyCover).
import * as THREE from 'three';
import { checkOptions } from '../../core/validate.js';

const LAYER_KEYS = ['sun', 'ambient', 'fog', 'tint', 'tintAmount', 'horizonTintAmount', 'flash', 'foliageCover', 'groundCover', 'coverAmount'];
/** A layer that changes nothing (also the starting value of sky.modifiers) */
export const blankLayer = () => ({ sun: 1, ambient: 1, fog: 1, tint: new THREE.Color(0x888888), tintAmount: 0, horizonTintAmount: 0, flash: 0 });

export const layerMethods = {
  /** Write a modifier layer (only the given fields); null removes it. See the JSDoc on Sky.modify */
  modify(owner, values) {
    if (values == null) { this._layers.delete(owner); this._checked.delete(owner); return this; }
    // a per-frame writer (weather) reuses one object: its keys are checked once, not every frame
    if (this._checked.get(owner) !== values) { checkOptions(`sky.modify('${owner}')`, values, LAYER_KEYS); this._checked.set(owner, values); }
    let L = this._layers.get(owner);
    if (!L) this._layers.set(owner, L = blankLayer());
    for (const k in values) {
      if (k === 'tint') L.tint.set(values.tint);
      else if (k === 'foliageCover' || k === 'groundCover') L[k] = values[k] == null ? null : (L[k] ?? new THREE.Color()).set(values[k]);
      else if (k in L || k === 'coverAmount') L[k] = values[k];
    }
    return this;
  },

  // composite all layers -> modifiers: sun / ambient / fog multiply; tint blends weighted by tintAmount; flash takes the max
  _combine() {
    const M = this.modifiers;
    M.sun = M.ambient = M.fog = 1; M.flash = 0;
    let r = 0, g = 0, b = 0, w = 0, keep = 1, keepH = 1;
    for (const L of this._layers.values()) {
      M.sun *= L.sun; M.ambient *= L.ambient; M.fog *= L.fog; M.flash = Math.max(M.flash, L.flash);
      const a = Math.max(L.tintAmount, L.horizonTintAmount);
      r += L.tint.r * a; g += L.tint.g * a; b += L.tint.b * a; w += a;
      keep *= 1 - L.tintAmount; keepH *= 1 - L.horizonTintAmount;
    }
    if (w > 0) M.tint.setRGB(r / w, g / w, b / w);
    M.tintAmount = 1 - keep; M.horizonTintAmount = 1 - keepH;
  },
};

const tmp = new THREE.Color(), acc = new THREE.Color();
/**
 * Lay the layers' cover colors over the season tint uniforms (after applySeason), reusing the season patch instead of a second
 * shader pass. Nothing is touched while no layer covers, so the default look and a game that writes the tint uniforms itself keep
 * working. The patch draws mix(color, tint, m) (multiply when m is 0); a cover of amount a over mix m1 is again one mix:
 * m = 1 - (1 - m1)(1 - a), tint = (T1 m1 (1 - a) + cover a) / m. A season in 'multiply' mode (m1 = 0) gives way to the cover.
 */
export function applyCover(sky, U) {
  let on = false;
  // no calendar seasons: nothing rewrites the tint every frame, so start from neutral (and return to it once the cover is gone)
  const calendar = sky.seasonStyle && sky.seasons.length;
  for (const [part, T, mix] of [['foliageCover', U.uFoliageTint, U.uFoliageMix], ['groundCover', U.uGroundTint, U.uGroundMix]]) {
    let a = 0, keep = 1; acc.setRGB(0, 0, 0);
    for (const L of sky._layers.values()) {
      const c = L[part], k = c ? Math.min(1, Math.max(0, L.coverAmount ?? 0)) : 0;
      if (k > 0) { acc.add(tmp.copy(c).multiplyScalar(k)); a += k; keep *= 1 - k; }
    }
    if (!calendar && (a > 0 || sky._covered)) { T.value.setRGB(1, 1, 1); mix.value = 0; }
    if (a <= 0) continue;
    on = true;
    const amt = 1 - keep, m1 = mix.value, m = 1 - (1 - m1) * (1 - amt);
    acc.multiplyScalar(amt / a);   // the layers' weighted cover color, times the combined amount
    T.value.multiplyScalar(m1 * (1 - amt)).add(acc).multiplyScalar(1 / m);
    mix.value = m;
  }
  sky._covered = on;
}
