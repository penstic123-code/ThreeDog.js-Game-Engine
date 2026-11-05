// @ts-check
// Props: branching trees, bushes, rocks and reeds, each a plain geometry with its colors in the vertices. plant() merges any number of them into one mesh.
// Why geometry and not a Group per tree: a whole forest then costs one draw and one shadow draw, and nothing here moves. A game that needs one tree to fall or sway keeps that
// one as its own mesh: new THREE.Mesh(tree(...), materials.prop). Replace these with your game's own shapes.
import { THREE } from 'threedog';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { palette } from './palette.js';

const A = new THREE.Color(), B = new THREE.Color();

/** A tiny repeatable random source: the same seed draws the same tree. @param {number} seed */
export function dice(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  /** @param {number} [a] @param {number} [b] */
  return (a = 0, b = 1) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return a + (b - a) * (s / 4294967296); };
}

/** Colors a geometry from dark at its lowest point to light at its highest, in place. Why by height: the top of a canopy reads as lit even in shade.
 *  @param {any} geo @param {{ light: number, dark: number }} pair @param {number} [bias] above 1 keeps more of the shape dark */
function shadeByHeight(geo, pair, bias = 1) {
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, pos = geo.attributes.position, c = new Float32Array(pos.count * 3);
  A.setHex(pair.dark); B.setHex(pair.light);
  for (let i = 0; i < pos.count; i++) {
    const t = ((pos.getY(i) - min.y) / Math.max(max.y - min.y, 1e-4)) ** bias, m = A.clone().lerp(B, t);
    c.set([m.r, m.g, m.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** One lumpy ball. Detail 2 is enough: at the size of a character cell, more vertices only cost startup time. @param {number} r @param {number} squash @param {ReturnType<typeof dice>} d */
function lump(r, squash, d) {
  const geo = new THREE.IcosahedronGeometry(1, 2), pos = geo.attributes.position;
  const a = d(0, 6), b = d(0, 6), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i);
    // the offset comes from the vertex's direction alone, so copies of one corner move together and the ball stays closed
    const k = r * (1 + 0.07 * Math.sin(n.x * 3.1 + a) * Math.cos(n.z * 2.7 + b) + 0.04 * Math.sin(n.y * 5.3 + a + b));
    pos.setXYZ(i, n.x * k, n.y * k * squash, n.z * k);
  }
  // normals stay the unit ball's, squashed: computed per face they would facet a shape that should read as round
  const nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) { n.fromBufferAttribute(pos, i).setY(pos.getY(i) / (squash * squash)).normalize(); nor.setXYZ(i, n.x, n.y, n.z); }
  return geo;
}

/** A round limb from a to b, thinner at b. @param {any} a @param {any} b @param {number} r0 @param {number} r1 */
function limb(a, b, r0, r1) {
  const dir = b.clone().sub(a), length = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, length, 6, 1, true).toNonIndexed().translate(0, length / 2, 0);
  geo.deleteAttribute('uv');
  return geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())).translate(a.x, a.y, a.z);
}

/** Directions spread evenly over a ball, each pushed a little off its place. @param {number} n @param {ReturnType<typeof dice>} d */
function spreadOut(n, d) {
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / n, around = i * 2.4 + d(-0.4, 0.4), side = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(around) * side, y + d(-0.15, 0.15), Math.sin(around) * side).normalize();
  });
}

/** How far a direction sits up a lobe: 1 at a lobe's top, falling round to 0 at the crease between two lobes. @param {any} v @param {any[]} lobes */
function lobeHeight(v, lobes) {
  const near = Math.max(...lobes.map(l => v.dot(l))), u = Math.min(1, (1 - near) * lobes.length / 2.4);
  return Math.sqrt(1 - u * u);
}

/** Each kind is a recipe, in parts of the tree's height. fork: where the trunk splits. base, top: where the leaves start and end. spread: how far they reach sideways.
 *  lobes: how many masses break the outline. Few read as a broad old tree, many as a fine one. Add a row for a new silhouette. */
const KINDS = {
  round: { fork: 0.3, base: 0.36, top: 1, spread: 0.36, lobes: 11 },
  dome: { fork: 0.38, base: 0.48, top: 0.94, spread: 0.46, lobes: 13 },
  tall: { fork: 0.16, base: 0.2, top: 1, spread: 0.17, lobes: 16 },
  crowd: { fork: 0.26, base: 0.38, top: 0.96, spread: 0.44, lobes: 8 },
};

/** The leaves of one tree as a single closed mass, with its colors. Why lobes with creases and not a smooth ball, or balls side by side: a smooth shape on a stick reads as a balloon,
 *  and separate balls read as many small balloons. A tree is one mass with a broken outline, lit on its lobes and dark in the creases between them. At the size of a character cell
 *  those creases are all that is left of the leaves, so the color follows them, not only the height.
 *  @param {typeof KINDS[keyof typeof KINDS]} k @param {number} height @param {{ light: number, dark: number }} leaf @param {ReturnType<typeof dice>} d */
function crown(k, height, leaf, d) {
  const raw = new THREE.IcosahedronGeometry(1, 10);
  raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
  const geo = mergeVertices(raw), pos = geo.attributes.position, c = new Float32Array(pos.count * 3), v = new THREE.Vector3();
  const big = spreadOut(k.lobes, d), small = spreadOut(k.lobes * 4, d);
  const wide = k.spread * height, half = (k.top - k.base) * height / 2, middle = (k.top + k.base) * height / 2;
  A.setHex(leaf.dark); B.setHex(leaf.light);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const lobe = lobeHeight(v, big), r = 0.62 + 0.34 * lobe + 0.09 * lobeHeight(v, small);
    // the underside is flatter than the top: leaves hang from limbs, they do not close into a ball
    pos.setXYZ(i, v.x * r * wide, middle + v.y * r * half * (v.y < 0 ? 0.55 : 1), v.z * r * wide);
    const t = Math.min(1, Math.max(0, (v.y * 0.5 + 0.5) * 0.65 + lobe * 0.6 - 0.28)), m = A.clone().lerp(B, t);
    c.set([m.r, m.g, m.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

/** A tree as one geometry: a trunk that forks into limbs reaching up into a broken mass of leaves.
 *  @param {{ kind?: keyof typeof KINDS, height?: number, seed?: number, leaf?: { light: number, dark: number } }} [o] */
export function tree({ kind = 'round', height = 7, seed = 1, leaf = palette.leaves[1] } = {}) {
  const d = dice(seed), k = KINDS[kind], girth = height * (kind === 'tall' ? 0.03 : 0.05), fork = new THREE.Vector3(0, k.fork * height, 0), turn = d(0, 6.28);
  const limbs = [0, 2.1, 4.2].map(a => limb(fork, new THREE.Vector3(Math.cos(a + turn) * k.spread * height * 0.6, (k.base + 0.12) * height, Math.sin(a + turn) * k.spread * height * 0.6), girth * 0.6, girth * 0.2));
  const bark = shadeByHeight(mergeGeometries([limb(new THREE.Vector3(), fork, girth, girth * 0.7), ...limbs]), palette.trunk);
  // a seed turns the shape too, so two trees from one recipe show different sides
  return mergeGeometries([crown(k, height, leaf, d), bark]).rotateY(d(0, 6.28));
}

/** Low leaves with no trunk, for banks and the feet of tree groups. @param {{ size?: number, seed?: number, leaf?: { light: number, dark: number } }} [o] */
export function bush({ size = 1.2, seed = 1, leaf = palette.leaves[2] } = {}) {
  const d = dice(seed + 77), parts = [0, 1, 2].map(() => lump(size * d(0.5, 0.8), 0.72, d).translate(d(-0.6, 0.6) * size, size * 0.4, d(-0.6, 0.6) * size));
  return shadeByHeight(mergeGeometries(parts), leaf, 0.8);
}

/** A faceted stone: flat faces, unlike everything else here, so it reads as hard. @param {{ size?: number, seed?: number }} [o] */
export function rock({ size = 1, seed = 1 } = {}) {
  const d = dice(seed + 31), geo = new THREE.IcosahedronGeometry(size, 1), pos = geo.attributes.position, seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    // the same corner appears in several faces: it must move once, or the stone tears
    const key = [pos.getX(i), pos.getY(i), pos.getZ(i)].map(v => v.toFixed(3)).join();
    if (!seen.has(key)) seen.set(key, d(0.75, 1.2));
    const k = seen.get(key);
    pos.setXYZ(i, pos.getX(i) * k * 1.25, Math.max(pos.getY(i) * k * 0.75, -size * 0.25), pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return shadeByHeight(geo, palette.rock, 0.6).rotateY(d(0, 6.28));
}

/** A clump of thin blades, for the waterline. @param {{ height?: number, seed?: number }} [o] */
export function reeds({ height = 1, seed = 1 } = {}) {
  const d = dice(seed + 13), blades = [];
  for (let i = 0; i < 7; i++) {
    const h = height * d(0.6, 1.1);
    blades.push(new THREE.ConeGeometry(0.07 * height, h, 4, 1, true).toNonIndexed().translate(0, h / 2, 0).rotateX(d(-0.25, 0.25)).rotateZ(d(-0.25, 0.25)).translate(d(-0.4, 0.4), 0, d(-0.4, 0.4)));
  }
  return shadeByHeight(mergeGeometries(blades), palette.reed);
}

/** Moves a prop to its place. @param {any} geo @param {number} x @param {number} y @param {number} z @param {number} [turn] */
export const put = (geo, x, y, z, turn = 0) => geo.rotateY(turn).translate(x, y, z);

/** Every prop in the list as one mesh with one material. @param {any[]} list geometries already put in place @param {any} material materials.prop */
export function plant(list, material) {
  const clean = list.map(g => {
    const c = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'color'].includes(k)) c.deleteAttribute(k);
    return c;
  });
  const mesh = new THREE.Mesh(mergeGeometries(clean), material);
  mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'props';
  return mesh;
}
