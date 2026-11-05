// @ts-check
// Props: a handful of shapes in plain three.js. Each function returns a THREE.Group at the origin, feet at y = 0, one mesh per material, 1 unit = 1 meter.
// Round on purpose: a smooth blob takes clean cel bands, while a faceted low-poly shape breaks each band into triangles.
// These shapes are the part of the picture most worth replacing: new silhouettes change a game more than new colors do.
import { THREE } from 'threedog';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** A lumpy ball with smooth normals. @param {number} r @param {number} seed @param {number} [lump] share of r the surface moves in and out @param {number} [under] height of the half below the middle: under 1 sits flat, like a cloud */
function blob(r, seed, lump = 0.12, under = 1) {
  const raw = new THREE.IcosahedronGeometry(1, 5);
  raw.deleteAttribute('normal'); raw.deleteAttribute('uv');
  const g = mergeVertices(raw), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) + Math.sin(v.y * 3.7 + seed * 1.7) + Math.sin(v.z * 2.9 + seed * 2.3);
    v.multiplyScalar(r * (1 + lump * n / 3));
    if (v.y < 0) v.y *= under;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** mergeGeometries needs every piece alike: no index, position and normal only. @param {any} g */
function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal') out.deleteAttribute(k);
  return out;
}
/** @param {any[]} list */
const merged = list => mergeGeometries(list.map(clean));
/** @param {any} g @param {number} x @param {number} y @param {number} z */
const at = (g, x, y, z) => g.translate(x, y, z);

/** @param {any} geometry @param {any} material */
function part(geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = m.receiveShadow = true;
  return m;
}
/** A part that casts a shadow but takes none: its bands come from its normals alone. A shadow map falling on its own curve, or grazing a wall, draws a ragged edge
 *  @param {any} geometry @param {any} material */
function bandsOnly(geometry, material) { const m = part(geometry, material); m.receiveShadow = false; return m; }
/** @param {string} name @param {any[]} parts */
function group(name, ...parts) { const g = new THREE.Group(); g.name = name; g.add(...parts); return g; }

/** Bend the normals of a clump toward its middle, so several balls take one set of bands, like one soft shape, while the outline stays bumpy.
 *  @param {any} g @param {any} middle @param {number} amount */
function oneShape(g, middle, amount) {
  const p = g.attributes.position, n = g.attributes.normal, a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i).sub(middle).normalize();
    b.fromBufferAttribute(n, i).lerp(a, amount).normalize();
    n.setXYZ(i, b.x, b.y, b.z);
  }
  return g;
}

/** A limb from a to b, thinner at b. @param {any} a @param {any} b @param {number} r0 @param {number} r1 */
function limb(a, b, r0, r1) {
  const dir = b.clone().sub(a), length = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, length, 10, 1).translate(0, length / 2, 0);
  return g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())).translate(a.x, a.y, a.z);
}

/** A trunk that forks into limbs, each limb holding up a flat-bottomed clump of leaves. Why clumps and not one crown: one smooth shape on a stick reads as a balloon. What says "tree"
 *  is a broken outline, limbs reaching into the leaves, and each mass taking its own lit top and dark underside. To change the tree, change the clump list.
 *  @param {any} mat picture.materials @param {{ height?: number, seed?: number, leaf?: any }} [o] */
export function tree(mat, { height = 5, seed = 1, leaf = mat.leaf } = {}) {
  const fork = new THREE.Vector3(0, height * 0.36, 0), r = height * 0.3, turn = seed * 1.9;
  // [turn around the trunk, reach, height, size], in crown radii. Low wide masses, a smaller ring above them, one on top
  const clumps = [[0, 0.95, 1.5, 0.62], [1.3, 1.05, 1.65, 0.56], [2.5, 0.9, 1.45, 0.66], [3.8, 1.05, 1.7, 0.58], [5.1, 0.95, 1.55, 0.6], [0.7, 0.5, 2.25, 0.55], [2.9, 0.55, 2.35, 0.52], [4.6, 0.5, 2.2, 0.5], [0, 0.05, 2.75, 0.5]]
    .map(([a, reach, y, size], i) => {
      const wobble = 0.85 + 0.3 * Math.abs(Math.sin(seed * 2.3 + i * 1.7));   // repeatable, so the same seed draws the same tree
      return { at: new THREE.Vector3(Math.cos(a + turn) * reach * wobble * r, y * r, Math.sin(a + turn) * reach * wobble * r), size: size * r * (0.85 + 0.3 * Math.abs(Math.cos(seed + i * 2.1))) };
    });
  const wood = [limb(new THREE.Vector3(), fork, height * 0.08, height * 0.055), ...clumps.filter((_, i) => i % 2 === 0).map(c => limb(fork, c.at, height * 0.04, height * 0.014))];
  const crown = merged(clumps.map((c, i) => at(blob(c.size, seed + i, 0.16, 0.6), c.at.x, c.at.y, c.at.z)));
  // only a little: each clump keeps its own bands, and the small bend ties them to one light
  return group('tree', part(merged(wood), mat.bark), bandsOnly(oneShape(crown, new THREE.Vector3(0, r * 1.7, 0), 0.25), leaf));
}

/** @param {any} mat @param {{ size?: number, seed?: number, leaf?: any }} [o] */
export function bush(mat, { size = 1, seed = 1, leaf = mat.leafDark } = {}) {
  const balls = [[0, 0.5, 0, 0.6], [0.55, 0.38, 0.1, 0.44], [-0.5, 0.36, -0.12, 0.46]].map(([x, y, z, s], i) => at(blob(s * size, seed + i), x * size, y * size, z * size));
  return group('bush', bandsOnly(oneShape(merged(balls), new THREE.Vector3(0, 0, 0), 0.6), leaf));
}

/** @param {any} mat @param {{ size?: number, seed?: number }} [o] */
export function rock(mat, { size = 1, seed = 1 } = {}) {
  const g = blob(1, seed, 0.2), p = g.attributes.position, v = new THREE.Vector3(), plane = new THREE.Vector3();
  // a few flat cuts through the ball: big planes take one band each, and the corners between them stay soft
  for (let i = 0; i < 7; i++) {
    plane.set(Math.sin(seed * 1.3 + i * 2.1), Math.abs(Math.cos(seed + i * 1.7)) * 1.2, Math.cos(seed * 2.1 + i * 2.6)).normalize();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const over = v.dot(plane) - 0.72;
      if (over > 0) { v.addScaledVector(plane, -over); p.setXYZ(k, v.x, v.y, v.z); }
    }
  }
  g.computeVertexNormals();
  g.scale(1.3 * size, 0.85 * size, size).translate(0, size * 0.42, 0);
  return group('rock', bandsOnly(g, mat.stone));
}

/** A straight run of fence along +x. @param {any} mat @param {{ length?: number, gap?: number }} [o] */
export function fence(mat, { length = 6, gap = 1.5 } = {}) {
  const pieces = [], n = Math.round(length / gap);
  for (let i = 0; i <= n; i++) pieces.push(at(new THREE.CapsuleGeometry(0.08, 0.85, 3, 10), i * gap, 0.5, 0));
  for (const y of [0.45, 0.78]) pieces.push(at(new THREE.BoxGeometry(n * gap + 0.3, 0.09, 0.06), n * gap / 2, y, 0.04));
  return group('fence', part(merged(pieces), mat.wood));
}

/** A small house: walls, roof, door, window. @param {any} mat @param {{ width?: number, depth?: number, roof?: any, wall?: any }} [o] */
export function hut(mat, { width = 4, depth = 3.4, roof = mat.roof, wall = mat.wall } = {}) {
  const h = 2.2, walls = at(new THREE.BoxGeometry(width, h, depth), 0, h / 2, 0);
  const eave = depth / 2 + 0.35, rise = depth * 0.5, side = new THREE.Shape([new THREE.Vector2(-eave, 0), new THREE.Vector2(eave, 0), new THREE.Vector2(0, rise)]);
  const top = at(new THREE.ExtrudeGeometry(side, { depth: width + 0.5, bevelEnabled: false }).rotateY(Math.PI / 2), -(width + 0.5) / 2, h - 0.05, 0);
  const chimney = at(new THREE.BoxGeometry(0.45, 1.1, 0.45), width * 0.28, h + rise * 0.72, -depth * 0.16);
  const door = at(new THREE.BoxGeometry(0.85, 1.55, 0.08), -0.7, 0.78, depth / 2 + 0.02);
  const frame = at(new THREE.BoxGeometry(0.95, 0.95, 0.08), 0.85, 1.25, depth / 2 + 0.01);
  const pane = at(new THREE.BoxGeometry(0.72, 0.72, 0.1), 0.85, 1.25, depth / 2 + 0.02);
  return group('hut', bandsOnly(walls, wall), bandsOnly(top, roof), part(chimney, mat.stone), part(merged([door, frame]), mat.wood), part(pane, mat.glow));
}

/** Small grass tufts in one draw call: many at almost no cost, and they give the ground a scale. places: [[x, y, z, size?], ...].
 *  @param {any} mat @param {{ places: number[][], leaf?: any }} o */
export function tufts(mat, { places, leaf = mat.leaf }) {
  const blades = [[0, 0, 1], [0.8, 0.5, 0.75], [2.4, 0.55, 0.8], [4.1, 0.6, 0.65]].map(([turn, lean, h]) =>
    new THREE.SphereGeometry(1, 8, 6).scale(0.075, 0.26 * h, 0.04).translate(0, 0.2 * h, 0).rotateZ(-lean).rotateY(turn));
  const geo = merged(blades), up = geo.attributes.normal;
  // every normal straight up: a tuft takes the same band as the ground it stands on, instead of a dark side per blade
  for (let i = 0; i < up.count; i++) up.setXYZ(i, 0, 1, 0);
  const m = new THREE.InstancedMesh(geo, leaf, places.length), one = new THREE.Object3D();
  places.forEach(([x, y, z, s = 1], i) => {
    one.position.set(x, y, z); one.rotation.y = i * 2.4; one.scale.setScalar(s); one.updateMatrix();
    m.setMatrixAt(i, one.matrix);
  });
  m.name = 'tufts'; m.receiveShadow = true;
  return m;
}

/** @param {any} mat @param {{ height?: number }} [o] */
export function lamp(mat, { height = 2.6 } = {}) {
  const pole = at(new THREE.CylinderGeometry(0.05, 0.08, height, 10), 0, height / 2, 0);
  const cap = at(new THREE.ConeGeometry(0.3, 0.2, 16), 0, height + 0.32, 0);
  const lit = part(at(new THREE.SphereGeometry(0.2, 20, 14), 0, height + 0.08, 0), mat.glow);
  lit.castShadow = false;
  return group('lamp', part(merged([pole, cap]), mat.bark), lit);
}
