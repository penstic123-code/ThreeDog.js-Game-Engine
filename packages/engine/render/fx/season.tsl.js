// TSL season() (GLSL threedogSeason).
// TSL season: season(color, kind) -> vec3, line for line GLSL threedogSeason (render/effects.js); kind 0 foliage, 1 ground.
// color is the linear surface color as vec3 (a vec4 gives its rgb, like GLSL vec3(c)); with uFoliageMix / uGroundMix > 0 it mixes toward the tint, else multiplies.
import { Fn, vec3, int, select, mix } from 'three/tsl';
import { engineNodes } from './uniforms.tsl.js';

/** The surface color moved by the calendar's season tint (uFoliageTint / uGroundTint, mode by uFoliageMix / uGroundMix) */
export const season = Fn(([color, kind], builder) => {
  const u = engineNodes(builder, 'season');
  const c = vec3(color), ground = int(kind).equal(1);
  const t = select(ground, u.uGroundTint, u.uFoliageTint), m = select(ground, u.uGroundMix, u.uFoliageMix);
  return select(m.greaterThan(0), mix(c, t, m), c.mul(t));
});
