// Plants with a collider are placed in full at any quality, and only their drawing thins (modules/vegetation/draw.js drawnPlants). Why a test: the count rests on ids rising in
// placement order; if that broke, low quality would draw the wrong plants or all of them, with no error.
// 不许绕开: real placements from the real placer, compared with what a density keeps for the same rule without a collider, which still thins at placement.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';

export const name = 'vegetation thin: low quality draws fewer blocking plants, the records stay whole';
const load = (...p) => import(pathToFileURL(join(ENGINE, ...p)).href);

export async function run({ check }) {
  const { makePlacer } = await load('core', 'stream', 'scatter.js'), { drawnPlants } = await load('modules', 'vegetation', 'draw.js');
  const place = makePlacer({ chunk: 32, seed: 7, surface: () => 5, slope: () => 0, typeAt: () => 'grass', fbm: () => 0.5 });
  const rule = { perChunk: 40, collider: 0.5, salt: 3, avoidFlat: false }, free = { ...rule, collider: 0 };
  const whole = place(1, 2, rule, 1), low = place(1, 2, rule, 0.25);
  check('the record is the same at any density', low.n === whole.n && low.ids.join() === whole.ids.join() && low.m.join() === whole.m.join() && whole.n > 20, String(whole.n));
  check('ids rise in placement order, which the count rests on', whole.ids.every((id, i) => !i || id > whole.ids[i - 1]));
  check('density 1 draws everything', drawnPlants(rule, whole, 1) === whole.n);
  const drawn = drawnPlants(rule, low, 0.25), then = place(1, 2, free, 0.25);
  check('low quality draws what it placed before plants kept their colliders', drawn === then.n && drawn < whole.n, drawn + ' / ' + then.n);
  check('a plant without a collider is already thinned, so it is drawn whole', drawnPlants(free, then, 0.25) === then.n);
  check('positions the game listed never thin', drawnPlants({ ...rule, positions: [[0, 0]] }, whole, 0.25) === whole.n);
}
