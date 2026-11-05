// @ts-check
// Test yard: one small scene with every part of the picture, so a look change can be judged before the game has a level. Delete this file when it does.
// Use: in main.js import { sampler } from this file and call sampler(engine, picture) after createPicture. Views: overview, shore, close (threedog shot --view shore).
/** @param {number} x @param {number} z @param {number} cx @param {number} cz @param {number} r @param {number} h */
const hill = (x, z, cx, cz, r, h) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));
/** A rolling field with a lake on one side. @param {number} x @param {number} z */
const heightAt = (x, z) => 0.9 + hill(x, z, -22, -18, 16, 4) + hill(x, z, 24, -26, 18, 3) + 0.25 * Math.sin(x * 0.17) * Math.cos(z * 0.13) - hill(x, z, 20, 20, 19, 3.2);
/** A curved path across the field: 1 in the middle, 0 two meters out. @param {number} x @param {number} z */
const pathAt = (x, z) => Math.max(0, 1 - Math.abs(z + 6 - 7 * Math.sin(x * 0.09)) / 2);

/** @param {any} engine @param {any} picture */
export function sampler(engine, picture) {
  const { materials: mat, props: P } = picture, level = 0;
  picture.ground({ size: 360, segments: 480, heightAt, pathAt, waterLevel: level });
  picture.water({ size: 120, segments: 240, level, heightAt });
  /** @param {any} thing @param {number} x @param {number} z @param {number} [turn] */
  const put = (thing, x, z, turn = 0) => { thing.position.set(x, heightAt(x, z), z); thing.rotation.y = turn; engine.scene.add(thing); return thing; };

  const trees = [[-12, -16, 6, 1], [-18, -6, 5, 2], [-7, -24, 5.5, 3], [6, -18, 4.5, 4], [14, -14, 6.5, 5], [-24, 6, 6, 6], [-14, 12, 5, 7], [-30, -14, 6, 8], [22, -8, 5, 9], [-6, 16, 4.6, 10]];
  trees.forEach(([x, z, height, seed]) => put(P.tree(mat, { height, seed, leaf: seed % 3 ? mat.leaf : mat.leafDark }), x, z));
  [[-4, -13, 1.1, 1], [9, -11, 0.9, 2], [-9, 7, 1.3, 3], [3, 8, 0.8, 4]].forEach(([x, z, size, seed]) => put(P.bush(mat, { size, seed }), x, z));
  [[5, 7, 1, 2], [8.5, 11, 1.5, 3], [0, 14, 0.7, 4], [-16, -2, 0.9, 5]].forEach(([x, z, size, seed]) => put(P.rock(mat, { size, seed }), x, z));
  put(P.hut(mat), 0, -15, 0.25);
  put(P.fence(mat, { length: 9 }), -4.5, -10.5, 0.12);
  put(P.lamp(mat), 5.5, -9);
  // tufts anywhere above the sand and off the path; engine.random keeps the same yard on every run
  const places = [], r = engine.random;
  while (places.length < 900) {
    const x = r.range(-40, 40), z = r.range(-34, 24), y = heightAt(x, z);
    if (y > level + 0.75 && pathAt(x, z) < 0.1) places.push([x, y, z, r.range(0.8, 1.5)]);
  }
  engine.scene.add(P.tufts(mat, { places }));

  // Named cameras for screenshots: threedog shot --view shore
  const views = { overview: [[-2, 12, 34], [0, 1, -6]], shore: [[4, 2.6, 15], [17, 0.2, 8]], close: [[-3, 2, -6], [1, 1.6, -15]] };
  for (const [name, [position, lookAt]] of Object.entries(views)) engine.views?.define(name, { position, target: lookAt });
  engine.camera.position.set(...views.overview[0]);
  engine.camera.lookAt(...views.overview[1]);
}
