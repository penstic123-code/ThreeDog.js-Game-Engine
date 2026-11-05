// threedog bake light (light-bake-page.js): the bake itself needs real WebGPU and system Chrome, so it cannot run here. What can be held in place without a GPU is its shape:
// light reaches a texel only along traced rays, and an unlit result stops the bake. The picture was checked by hand on a baked room, see docs/testing/runs.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../paths.mjs';

export const name = 'bake light: light comes from traced rays, and a dark result writes nothing';

export async function run({ check }) {
  const page = readFileSync(join(TOOLS, 'light-bake-page.js'), 'utf8'), cli = readFileSync(join(TOOLS, 'bake-light.mjs'), 'utf8');
  check('[guard] no probe grid in the bake: a grid does not know where walls are, and its probes leak the sky into rooms', !/from '.*LightProbeGrid/.test(page));
  check('[guard] the map is gathered by rays through a BVH of the static meshes', page.includes('raycastFirstHit') && page.includes('new BVHComputeData(copies'));
  check('[guard] a hit on a back face brings nothing: a texel inside a wall must not see out', /hit\.side < 0\.0\) \{ return vec4f\(0\.0, 0\.0, 0\.0, 0\.0\)/.test(page));
  check('[guard] a map with no light is an error before anything is written', /brightest < DARK\) return \{ error:/.test(page) && cli.indexOf('if (r.error)') < cli.indexOf('writeFileSync(OUT'));
  check('a failed shader reaches the terminal: a dropped draw otherwise reads as a dark room', cli.includes('gpuErrors'));
}
