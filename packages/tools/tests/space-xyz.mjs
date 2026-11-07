// Keeping all three coordinates (design section 8.2), on the real code: collision resolve, the height rule for arrival, path points, a path's own heights.
// The "no way around it" check: every path point has y, whether it came from the navmesh search or from a source without height.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { ENGINE } from '../paths.mjs';

const load = f => import(pathToFileURL(join(ENGINE, f)).href);
const { Collision } = await load('modules/collision/Collision.js');
const { nextPoint, sameLevel, withHeights } = await load('modules/characters/moveHelpers.js');

export const name = 'space: XYZ paths, arrival and floor-aware resolve';

/** Two floors: ground 0, upper 4; height(x, z, refY) picks the highest not above refY plus a step, the top one without refY */
const floors = () => ({ movement: { radius: 0.4, height: 1.8, slopeRatio: 1 }, ground: {}, surface: (x, z, ref) => (ref === undefined || ref >= 3.5 ? 4 : 0) });
/** One height field at 12, whatever the reference */
const hill = () => ({ movement: { height: 1.8 }, surface: () => 12 });

export async function run({ check }) {
  const e = floors(), col = new Collision(e);
  col.addBox([0, 0, 0], { halfWidth: 2, halfDepth: 2, height: 3, y: 4 });   // a wall upstairs
  const below = { x: 1, y: 0, z: 0 };
  check('resolve: a wall upstairs leaves the floor below free', !col.resolve(below) && below.x === 1);
  const above = { x: 1, y: 4, z: 0 };
  check('resolve: the same wall stops a walker on its floor', col.resolve(above) && Math.abs(above.x) >= 2);
  const under = { x: 1, y: 2.5, z: 0 };
  check('resolve: a body reaching into it counts, feet alone do not decide', col.resolve(under));
  const noY = { x: 1, z: 0 };
  check('resolve: a position without y stops as before', col.resolve(noY));
  col.addBox([20, 0, 0], { halfWidth: 2, halfDepth: 2, height: 3 });
  const foot = { x: 21, y: 40, z: 0 };
  check('resolve: a box without y is a footprint at any height, as before', col.resolve(foot));

  check('arrival: no y on the goal asks nothing', sameLevel(e, { y: 40 }, { x: 0, z: 0 }));
  check('arrival: another floor is not arrived', !sameLevel(e, { y: 0 }, { x: 0, y: 4, z: 0 }));
  check('arrival: the floor asked for is', sameLevel(e, { y: 4 }, { x: 0, y: 4, z: 0 }));
  check('arrival: [x, 0, z] on a height field means that ground', sameLevel(hill(), { y: 12 }, { x: 0, y: 0, z: 0 }));

  const spiral = [{ x: 0, y: 2, z: 0 }, { x: 0, y: 4, z: 0 }, { x: 3, y: 4, z: 0 }];
  check('path: a point right overhead is not passed', nextPoint(spiral, 0, 0, 0, 0, 0.5, 1.8) === 0);
  check('path: reached on its own floor it is', nextPoint(spiral, 0, 0, 2, 0, 0.5, 1.8) === 1);
  check('path: a saved path without y still walks', nextPoint([{ x: 0, z: 0 }, { x: 5, z: 0 }], 0, 0, 3, 0, 0.5, 1.8) === 1);

  const p = withHeights(e, [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }], { y: 0 }, { y: 4 });
  check('heights: the start picks the layer, the goal keeps its given y', p[0].y === 0 && p[1].y === 0 && p[2].y === 4);
  const q = withHeights({ ...e, surface: () => -Infinity }, [{ x: 0, z: 0 }], { y: 3 }, {});
  check('heights: the void keeps the height it came from', q[0].y === 3);
  const kept = withHeights(e, [{ x: 0, y: 30, z: 0 }], { y: 0 }, {});
  check('heights: a height the source gave stays (a flight path)', kept[0].y === 30);

  const src = readFileSync(join(ENGINE, 'modules/nav/navPath.js'), 'utf8');
  check('no way around: the navmesh search keeps the whole point', !/\{ x, z \} = at\(/.test(src));
  const paths = ['modules/characters/index.js', 'modules/characters/pathAsync.js'].map(f => readFileSync(join(ENGINE, f), 'utf8')).join('');
  check('no way around: both path entries ask the characters.path rule first', (paths.match(/sourcePath\(e, /g) ?? []).length >= 3);
  const ch = readFileSync(join(ENGINE, 'modules/characters/Character.js'), 'utf8');
  check('no way around: a character moves through the rule, not a stored mover', /const m = this\.mover;[^]*?\bm\.move\(/.test(ch) && !ch.includes('this._mover.move'));
}
