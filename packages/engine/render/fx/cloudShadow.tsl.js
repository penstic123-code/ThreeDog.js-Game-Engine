// TSL cloudShadow() (GLSL threedogCloudShadow).
// TSL cloud shadow: cloudShadow(worldPos) -> float, line for line GLSL threedogCloudShadow (render/effects.js).
// worldPos is a world-space position (usually positionWorld in TSL); returns a 0-1 light factor, 1 = not under a cloud. Multiply it into direct light (lighting slot).
import { Fn, float, smoothstep } from 'three/tsl';
import { noise } from './noise.tsl.js';
import { engineNodes } from './uniforms.tsl.js';
import { CLOUD } from '../fxNumbers.js';

/** Light factor 0-1 under the engine's drifting clouds (uCloud cover, uCloudShadow darkest, uCloudScale, uCloudSpeed) */
export const cloudShadow = Fn(([worldPos], builder) => {
  const u = engineNodes(builder, 'cloudShadow');
  const p = worldPos.xz.mul(u.uCloudScale).add(u.uCloudSpeed.mul(u.uTime));
  const n = noise(p).mul(CLOUD.weight).add(noise(p.mul(CLOUD.octave)).mul(CLOUD.weight2));
  const c = smoothstep(float(1).sub(u.uCloud), float(1).sub(u.uCloud).add(CLOUD.edge), n);
  return float(1).sub(c.mul(u.uCloudShadow));
});
