// Pure worker functions (core/threadPure.js): a terrain({ height }) that reads an outer variable must not lose it silently. The "no way around it"
// check: the error names closures as unsupported and shows the terrain({ params }) data form, so an AI fixes it in one step.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

const { compilePure } = await import(pathToFileURL(join(ENGINE, 'core/threadPure.js')).href);

export const name = 'pure functions: a closure in terrain({ height }) throws with the params form';

export async function run({ check }) {
  const hill = 30;
  const msg = f => { try { compilePure(f, 'terrain({ height })'); return ''; } catch (e) { return e.message; } };
  const m = msg((x, z, n) => hill * n.noise(x, z));
  check('[guard] terrain height reading an outer variable: says closures are not supported and shows terrain({ params }) / n.params',
    /closures are not supported/.test(m) && /terrain\(\{ params:/.test(m) && /n\.params\./.test(m) && /'hill'/.test(m), m);
  check('a self-contained height compiles', msg((x, z, n) => 4 + 30 * n.fbm(x * 0.004, z * 0.004)) === '');
}
