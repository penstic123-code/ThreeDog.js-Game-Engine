// @ts-check
// Test yard: one small valley with every part of the picture, so a look change can be judged before the game has a level. Delete this file when it does.
// Use: in main.js import { sampler } from this file and call sampler(engine, picture) after createPicture. Views: overview, bank, close (threedog shot --view bank).
// The rule of the layout is density, not position: wide grass stays empty, and detail gathers where the land changes: along the water and in a few tree groups.

/** Curve of the river across the map, as z for a given x. @param {number} x */
const riverZ = x => 16 * Math.sin(x * 0.04 + 2.3) + 7 * Math.sin(x * 0.095) + 8;
const POND = { x: 34, z: -24, r: 9 };
/** Tree groups: [x, z, radius, how many]. */
const GROVES = [[-16, -14, 13, 34], [22, 22, 11, 22], [-46, 28, 9, 14], [54, 6, 8, 11], [-4, 44, 7, 9], [50, -44, 10, 14]];

/** @param {number} a @param {number} b @param {number} t */
const ease = (a, b, t) => { const k = Math.min(1, Math.max(0, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
/** Meters from the river's edge, with its width changing along the way; negative in the water. @param {number} x @param {number} z */
const riverEdge = (x, z) => Math.abs(z - riverZ(x)) / Math.hypot(1, riverZ(x + 0.5) - riverZ(x - 0.5)) - (5 + 1.6 * Math.sin(x * 0.07 + 1));
/** Meters from the pond's edge, wobbling so it is not a circle. @param {number} x @param {number} z */
const pondEdge = (x, z) => {
  const a = Math.atan2(z - POND.z, x - POND.x);
  return Math.hypot(x - POND.x, (z - POND.z) * 1.25) - POND.r * (1 + 0.16 * Math.sin(a * 3 + 1) + 0.09 * Math.sin(a * 5));
};
/** @param {number} x @param {number} z */
const edge = (x, z) => Math.min(riverEdge(x, z), pondEdge(x, z));
/** Gentle swells that never come near the water level. @param {number} x @param {number} z */
const swell = (x, z) => 1.5 + 0.7 * Math.sin(x * 0.05 + 1) * Math.cos(z * 0.06) + 0.45 * Math.sin(x * 0.11 - z * 0.08);
/** @param {number} x @param {number} z */
const heightAt = (x, z) => -1.4 + (swell(x, z) + 1.4) * ease(-3, 5, edge(x, z));
/** 1 at the water's edge, 0 about four meters inland. @param {number} x @param {number} z */
const bankAt = (x, z) => 1 - ease(0, 4, edge(x, z));
/** @param {number} x @param {number} z */
const lushAt = (x, z) => Math.max(...GROVES.map(([gx, gz, r]) => 1 - ease(r * 0.5, r * 1.5, Math.hypot(x - gx, z - gz))));

/** @param {any} engine @param {any} picture */
export function sampler(engine, picture) {
  const { materials: mat, props: P, palette } = picture, leaves = palette.leaves;
  // its own seed, not engine.random: this yard is what a look change is judged on, so the same trees must stand in every shot
  const r = { range: P.dice(7) };
  picture.ground({ heightAt, bankAt, lushAt });
  picture.water({ heightAt });

  /** @template T @param {T[]} a @returns {T} */
  const pick = a => a[Math.floor(r.range(0, a.length))];
  /** @type {any[]} */
  const list = [];
  /** @param {any} geo @param {number} x @param {number} z */
  const put = (geo, x, z) => list.push(P.put(geo, x, heightAt(x, z) - 0.1, z));
  const leaf = () => leaves[pick([0, 0, 1, 1, 1, 2, 2, 3, 3, 4])];
  let seed = 1;

  // Tree groups: big trees near the middle of a group, small ones and bushes at its rim
  for (const [gx, gz, radius, count] of GROVES) {
    for (let i = 0; i < count; i++) {
      const a = r.range(0, 6.28), far = Math.sqrt(r.range(0, 1)), x = gx + Math.cos(a) * far * radius, z = gz + Math.sin(a) * far * radius;
      if (edge(x, z) < 2) continue;
      put(P.tree({ kind: pick(['round', 'round', 'dome', 'dome', 'crowd', 'tall']), height: r.range(5.5, 8.5) * (1.1 - 0.4 * far), seed: seed++, leaf: leaf() }), x, z);
      if (i % 2) put(P.bush({ size: r.range(0.9, 1.7), seed: seed++, leaf: leaf() }), x + r.range(-3, 3), z + r.range(-3, 3));
    }
  }
  // A few lone trees, so the open grass has scale. Far apart on purpose: more of them and the grass stops being quiet
  for (const [x, z] of [[-30, -38], [6, -34], [-58, -6], [34, 44], [-22, 40], [66, -22]]) put(P.tree({ kind: pick(['round', 'dome', 'crowd']), height: r.range(5, 7), seed: seed++, leaf: leaf() }), x, z);

  // The banks: reeds, stones and small bushes, kept to a thin strip by the water
  for (let i = 0; i < 26000; i++) {
    const x = r.range(-110, 110), z = r.range(-110, 110), e = edge(x, z);
    if (e < -0.4 || e > 3) continue;
    const roll = r.range(0, 1);
    if (roll < 0.55) put(P.reeds({ height: r.range(1, 1.8), seed: seed++ }), x, z);
    else if (roll < 0.8) put(P.rock({ size: r.range(0.35, 0.9), seed: seed++ }), x, z);
    else if (e > 0.8) put(P.bush({ size: r.range(0.7, 1.3), seed: seed++, leaf: leaf() }), x, z);
  }
  // Larger pale rocks in small heaps, a few by the water and one or two out on the grass
  for (const [x, z, n] of [[-4, 8, 4], [-38, 12, 3], [16, 2, 3], [24, -16, 4], [44, -12, 3], [62, 30, 2], [-14, 26, 1], [-52, -30, 2]]) {
    for (let i = 0; i < n; i++) put(P.rock({ size: r.range(0.7, 1.7), seed: seed++ }), x + r.range(-2.5, 2.5), z + r.range(-2.5, 2.5));
  }
  engine.scene.add(P.plant(list, mat.prop));

  // Named cameras for screenshots: threedog shot --view bank
  // overview: far away through a narrow lens, so near trees do not balloon and the map reads as one flat field
  /** @type {Record<string, [number[], number[], number]>} */
  const views = { overview: [[-16, 96, 104], [4, 0, 6], 25], bank: [[34, 22, 46], [12, 0, 12], 30], close: [[-38, 16, 18], [-16, 2, -10], 32] };
  for (const [name, [position, target, fov]] of Object.entries(views)) engine.views?.define(name, { position, target, fov });
  engine.camera.fov = views.overview[2]; engine.camera.updateProjectionMatrix();
  engine.camera.position.set(...views.overview[0]);
  engine.camera.lookAt(...views.overview[1]);
}
