// Sky modifier layers (mixed into Sky.prototype): weather and games each write their own layer with modify(); every frame the sky
// composites them into sky.modifiers and applies the result on top of its own colors and light.
import * as THREE from 'three';
import { checkOptions } from '../../core/validate.js';

const LAYER_KEYS = ['sun', 'ambient', 'fog', 'tint', 'tintAmount', 'horizonTintAmount', 'flash'];
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
    for (const k in values) if (k === 'tint') L.tint.set(values.tint); else if (k in L) L[k] = values[k];
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
