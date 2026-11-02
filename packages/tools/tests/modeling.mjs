// bakeVertexAO on small geometries built in the test (no browser): a lone convex box stays lit, a box standing on a ground occluder darkens at
// its foot and not at its top, existing colors are multiplied, the index is left alone, and the same seed gives the same colors.
import * as THREE from 'three';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE } from '../paths.mjs';
// the file itself, not the 'threedog' entry: the entry pulls in the whole engine (DOM code) and this function needs only three + three-mesh-bvh
const { bakeVertexAO } = await import(pathToFileURL(join(ENGINE, 'render/modeling.js')).href);

export const name = 'modeling: bakeVertexAO darkens contact areas, keeps convex sides lit, deterministic';

/** Mean color of the vertices whose position matches pick(p) */
function mean(g, pick) {
  const p = g.attributes.position, c = g.attributes.color, v = new THREE.Vector3();
  let s = 0, k = 0;
  for (let i = 0; i < p.count; i++) if (pick(v.fromBufferAttribute(p, i))) { s += c.getX(i); k++; }
  return k ? s / k : NaN;
}

export async function run({ check }) {
  const lone = bakeVertexAO(new THREE.BoxGeometry(1, 1, 1), { samples: 32 });
  check('a lone convex box gets a white color attribute, no occlusion', lone.attributes.color && mean(lone, () => true) > 0.999);

  const box = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);   // standing on y = 0
  const ground = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2);
  const g = box(), index = Array.from(g.index.array);
  bakeVertexAO(g, { samples: 64, occluders: [ground] });
  const sideFoot = mean(g, v => v.y < 0.01 && Math.abs(v.x) > 0.49), top = mean(g, v => v.y > 0.99);
  check('side vertices at the foot darken against the ground occluder', sideFoot < 0.8, `foot ${sideFoot.toFixed(3)}`);
  check('top vertices (out of radius of the ground) stay lit', top > 0.999, `top ${top.toFixed(3)}`);
  check('the index is untouched (the BVH works on a copy)', Array.from(g.index.array).every((x, i) => x === index[i]));

  const tinted = box(); tinted.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(tinted.attributes.position.count * 3).fill(0.5), 3));
  bakeVertexAO(tinted, { samples: 64, occluders: [ground] });
  const tFoot = mean(tinted, v => v.y < 0.01 && Math.abs(v.x) > 0.49);
  check('existing colors are multiplied, not replaced', Math.abs(tFoot - sideFoot * 0.5) < 1e-6, `${tFoot} vs ${sideFoot * 0.5}`);

  const again = bakeVertexAO(box(), { samples: 64, occluders: [ground] });
  check('same seed, same colors', again.attributes.color.array.every((x, i) => x === g.attributes.color.array[i]));
  const none = bakeVertexAO(box(), { samples: 64, occluders: [ground], strength: 0 });
  check('strength 0 leaves the colors white', mean(none, () => true) > 0.999);
}
