// The sky's shared points: tint, ground cover and the lightning flash, gameplay signals that several owners may hold at once (weather, a cave, an ash fall).
//   engine.mod('sky.flash', { owner: 'storm', add: 0.5, layer: 'effect' })     lightning brightness (base 0)
//   engine.mod('sky.tint', { owner: 'cave', value: { color: 0x402030, amount: 0.5, horizon: 0.3 } })   sky tint (zenith amount / horizon amount);
//     the color is the tint under the brightest sky row: the sky dims it with its own light, so a grey rain tint stays dark at night
//   engine.mod('ground.cover', { owner: 'ash', value: { ground: 0x555555, foliage?: color, amount: 0.6 } })  cover over the season tint
// Tint and cover are blends of every holder (weighted by amount), not one winner, so they are 'any' points holding each owner's data.
// save: false: weather rewrites its entries every frame and a game's own state (in the cave?) re-takes its own after a load.
import * as THREE from 'three';

/** The sky points on engine.stacks (Sky constructor). Guarded: a second sky on the same engine reuses them. */
export function defineSkyPoints(engine) {
  const S = engine.stacks, def = (n, o) => S.has(n) ? S.get(n) : S.define(n, { save: false, ...o });
  return { flash: def('sky.flash', { base: 0, min: 0 }), tint: def('sky.tint', { kind: 'any' }), cover: def('ground.cover', { kind: 'any' }) };
}

const tmp = new THREE.Color(), acc = new THREE.Color();

/** The tint holders blended into one: { color, amount, horizon } (weighted by amount; written into out, nothing allocated) */
export function skyTint(sky, out) {
  let r = 0, g = 0, b = 0, w = 0, keep = 1, keepH = 1;
  for (const { value: v } of sky._points.tint.entries()) {
    if (!v || typeof v !== 'object') continue;
    const am = v.amount ?? 0, hz = v.horizon ?? 0, a = Math.max(am, hz);
    if (v.color != null) tmp.set(v.color); else tmp.set(0x888888);
    r += tmp.r * a; g += tmp.g * a; b += tmp.b * a; w += a;
    keep *= 1 - am; keepH *= 1 - hz;
  }
  if (w > 0) out.color.setRGB(r / w, g / w, b / w);
  out.amount = 1 - keep; out.horizon = 1 - keepH;
  return out;
}

/**
 * Lay the 'ground.cover' entries' colors over the season tint uniforms (after applySeason), reusing the season patch instead of a second
 * shader pass. Nothing is touched while no entry covers, so the default picture and a game that writes the tint uniforms itself keep
 * working. The patch draws mix(color, tint, m) (multiply when m is 0); a cover of amount a over mix m1 is again one mix:
 * m = 1 - (1 - m1)(1 - a), tint = (T1 m1 (1 - a) + cover a) / m. A season in 'multiply' mode (m1 = 0) gives way to the cover.
 */
export function applyCover(sky, U) {
  let on = false;
  // no calendar seasons: nothing rewrites the tint every frame, so start from neutral (and return to it once the cover is gone)
  const calendar = sky.seasonTints && sky.engine.calendar?.seasons.length, list = sky._points.cover.entries();
  for (const [part, T, mix] of [['foliage', U.uFoliageTint, U.uFoliageMix], ['ground', U.uGroundTint, U.uGroundMix]]) {
    let a = 0, keep = 1; acc.setRGB(0, 0, 0);
    for (const { value: v } of list) {
      const c = v?.[part], k = c != null ? Math.min(1, Math.max(0, v.amount ?? 0)) : 0;
      if (k > 0) { acc.add(tmp.set(c).multiplyScalar(k)); a += k; keep *= 1 - k; }
    }
    if (!calendar && (a > 0 || sky._covered)) { T.value.setRGB(1, 1, 1); mix.value = 0; }
    U.uCover.value.setComponent(part === 'ground' ? 1 : 0, 1 - keep);   // the amount alone, for a game's own tint (engine.terms.season)
    if (a <= 0) continue;
    on = true;
    const amt = 1 - keep, m1 = mix.value, m = 1 - (1 - m1) * (1 - amt);
    acc.multiplyScalar(amt / a);   // the entries' weighted cover color, times the combined amount
    T.value.multiplyScalar(m1 * (1 - amt)).add(acc).multiplyScalar(1 / m);
    mix.value = m;
  }
  sky._covered = on;
}
