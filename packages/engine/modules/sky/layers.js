// Sky modifiers on engine.mod stacks: weather and games change the sky's light / fog / tint through the same one entry every other shared quantity
// uses (core/stacks.js), not a sky-only mechanism. Why: two "several systems change one value" mechanisms meant two sets of verbs, owners and end
// rules to learn; on the stacks, ending is h.remove(), timing is { for }, describe().holds.stacks shows who holds what.
//   engine.mod('sky.sunLight', { owner: 'cave', mul: 0.3 })       sunlight multiplier (also 'sky.ambient', 'sky.fog' = fog distance, smaller = denser)
//   engine.mod('sky.flash', { owner: 'storm', add: 0.5 })    lightning brightness (base 0)
//   engine.mod('sky.tint', { owner: 'cave', value: { color: 0x402030, amount: 0.5, horizon: 0.3 } })   sky tint (zenith amount / horizon amount);
//     the color is the tint under the brightest sky row: the sky dims it with its own light, so a grey rain tint stays dark at night
//   engine.mod('sky.cover', { owner: 'ash', value: { ground: 0x555555, foliage?: color, amount: 0.6 } })  cover over the season tint
// Every frame the sky composites them into sky.modifiers (read-only) and applies the result on top of its own colors and light.
// save: false like the old layers: weather rewrites its entries every frame and a game's own state (in the cave?) re-takes its own after a load.
import * as THREE from 'three';

/** A composite that changes nothing (the starting value of sky.modifiers) */
export const blankLayer = () => ({ sun: 1, ambient: 1, fog: 1, tint: new THREE.Color(0x888888), tintAmount: 0, horizonTintAmount: 0, flash: 0 });

/** The sky quantities on engine.stacks (Sky constructor). Guarded: a second sky on the same engine reuses them. */
export function defineSkyStacks(engine) {
  const S = engine.stacks, def = (n, o) => S.has(n) ? S.get(n) : S.define(n, { save: false, ...o });
  return {
    sun: def('sky.sunLight', { min: 0 }), ambient: def('sky.ambient', { min: 0 }), fog: def('sky.fog', { min: 0 }),
    flash: def('sky.flash', { base: 0, min: 0 }),
    tint: def('sky.tint', { kind: 'any' }), cover: def('sky.cover', { kind: 'any' }),
  };
}

const tmp = new THREE.Color(), acc = new THREE.Color();

export const layerMethods = {
  // composite the stacks -> modifiers: sun / ambient / fog / flash are the stacks' own values (mul multiplies, add sums);
  // tint entries blend weighted by their amount
  _combine() {
    const M = this.modifiers, K = this._mods;
    M.sun = K.sun.value(); M.ambient = K.ambient.value(); M.fog = K.fog.value(); M.flash = K.flash.value();
    let r = 0, g = 0, b = 0, w = 0, keep = 1, keepH = 1;
    for (const { value: v } of K.tint.entries()) {
      if (!v || typeof v !== 'object') continue;
      const am = v.amount ?? 0, hz = v.horizon ?? 0, a = Math.max(am, hz);
      if (v.color != null) tmp.set(v.color); else tmp.set(0x888888);
      r += tmp.r * a; g += tmp.g * a; b += tmp.b * a; w += a;
      keep *= 1 - am; keepH *= 1 - hz;
    }
    if (w > 0) M.tint.setRGB(r / w, g / w, b / w);
    M.tintAmount = 1 - keep; M.horizonTintAmount = 1 - keepH;
  },
};

/**
 * Lay the 'sky.cover' entries' colors over the season tint uniforms (after applySeason), reusing the season patch instead of a second
 * shader pass. Nothing is touched while no entry covers, so the default look and a game that writes the tint uniforms itself keep
 * working. The patch draws mix(color, tint, m) (multiply when m is 0); a cover of amount a over mix m1 is again one mix:
 * m = 1 - (1 - m1)(1 - a), tint = (T1 m1 (1 - a) + cover a) / m. A season in 'multiply' mode (m1 = 0) gives way to the cover.
 */
export function applyCover(sky, U) {
  let on = false;
  // no calendar seasons: nothing rewrites the tint every frame, so start from neutral (and return to it once the cover is gone)
  const calendar = sky.seasonStyle && sky.engine.calendar?.seasons.length, list = sky._mods.cover.entries();
  for (const [part, T, mix] of [['foliage', U.uFoliageTint, U.uFoliageMix], ['ground', U.uGroundTint, U.uGroundMix]]) {
    let a = 0, keep = 1; acc.setRGB(0, 0, 0);
    for (const { value: v } of list) {
      const c = v?.[part], k = c != null ? Math.min(1, Math.max(0, v.amount ?? 0)) : 0;
      if (k > 0) { acc.add(tmp.set(c).multiplyScalar(k)); a += k; keep *= 1 - k; }
    }
    if (!calendar && (a > 0 || sky._covered)) { T.value.setRGB(1, 1, 1); mix.value = 0; }
    if (a <= 0) continue;
    on = true;
    const amt = 1 - keep, m1 = mix.value, m = 1 - (1 - m1) * (1 - amt);
    acc.multiplyScalar(amt / a);   // the entries' weighted cover color, times the combined amount
    T.value.multiplyScalar(m1 * (1 - amt)).add(acc).multiplyScalar(1 / m);
    mix.value = m;
  }
  sky._covered = on;
}
