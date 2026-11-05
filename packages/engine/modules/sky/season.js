// Sky season tint (helper of Sky.js): blends engine.sky.seasonTints into the engine's foliage / ground tint uniforms every frame.
// The season itself is the calendar's (modules/calendar): the sky only reads which season it is and how far along, to draw it.
import * as THREE from 'three';

// This season's color, blending to the next season over the last 20% of the season
const c1 = new THREE.Color(), c2 = new THREE.Color();
export function applySeason(sky, uniforms) {
  // no seasons in this game's calendar (or no calendar: sky alone is a fixed time): the season colors never apply, the tint stays neutral
  const S = sky.seasonTints, cal = sky.engine.calendar;
  if (!S || !cal?.seasons.length) {
    // nothing is written while no tint was ever drawn (a game may write these uniforms itself); a tint just taken away goes back to neutral
    if (sky._seasoned) { sky._seasoned = false; uniforms.uFoliageTint.value.setRGB(1, 1, 1); uniforms.uGroundTint.value.setRGB(1, 1, 1); uniforms.uFoliageMix.value = uniforms.uGroundMix.value = 0; }
    return;
  }
  sky._seasoned = true;
  const cur = S[cal.season] || {}, next = S[cal.seasons[(cal.seasonIndex + 1) % cal.seasons.length]] || {};
  const k = Math.max(0, (cal.seasonProgress - 0.8) / 0.2);
  // mode 'multiply' (default): the color multiplies the surface. mode 'mix': the surface moves `strength` of the way to the color (orange on green
  // leaves stays orange instead of turning muddy); a season without a color for the part leaves it alone
  const mix = S.mode === 'mix', strength = S.strength ?? 0.5;
  const blend = (key, out, amount) => {
    const a = cur[key], b = next[key];
    c1.set(a ?? (mix ? b : null) ?? 0xffffff); c2.set(b ?? (mix ? a : null) ?? 0xffffff); out.copy(c1).lerp(c2, k);
    amount.value = mix ? strength * ((a != null ? 1 - k : 0) + (b != null ? k : 0)) : 0;
  };
  blend('foliage', uniforms.uFoliageTint.value, uniforms.uFoliageMix); blend('ground', uniforms.uGroundTint.value, uniforms.uGroundMix);
}
