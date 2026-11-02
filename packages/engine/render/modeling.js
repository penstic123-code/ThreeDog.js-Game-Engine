// Modeling gaps three lacks. Merging, sweeping, sampling, decals, hulls, simplifying and noise are already in three / three/addons
// (recipe 54 "Procedural modeling" lists them), so this file adds nothing of that kind.
// Every function takes and returns plain three.js objects and has no engine state, so it runs inside an assets.manifest generator (and is then
// cached / baked with the model) or anywhere else.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mulberry32 } from '../core/mulberry32.js';
/** @import { BufferGeometry } from '../types/common' */

/**
 * Bake ambient occlusion into a geometry's vertex colors: each vertex casts `samples` rays over the hemisphere around its normal, and the share
 * that hits the geometry (or an occluder) within `radius` darkens it. Creases, insides and parts tucked under other parts go dark; open sides
 * stay as they were. The result multiplies the existing `color` attribute (white is added when there is none), so it works on `mergeColored`
 * output and on any geometry drawn with `vertexColors: true`. Deterministic for a seed, so cached and baked models stay identical.
 * Cost is vertices x samples ray casts (a 5k-vertex model at 32 samples is ~160k casts); run it inside a model generator, where it is cached.
 * Resolution is per vertex: a large flat face with four corners gets no contact shadow in its middle (subdivide it, or bake a texture in Blender).
 * @example
 * const parts = mergeColored([[new THREE.BoxGeometry(2, 0.2, 2), 0x8a6a4a], [new THREE.BoxGeometry(0.4, 1, 0.4).translate(0, 0.6, 0), 0x6a6a6a]]);
 * bakeVertexAO(parts, { samples: 48, strength: 0.8 });   // darker where the post meets the base
 * const mesh = new THREE.Mesh(parts, new THREE.MeshStandardMaterial({ vertexColors: true }));
 * @param {BufferGeometry} geometry modified in place (its `color` attribute); its other attributes and index are untouched
 * @param {{ samples?: number, radius?: number, strength?: number, bias?: number, occluders?: BufferGeometry[], seed?: number }} [opts]
 *   samples: rays per vertex (default 32). radius: how far a hit still counts, in model units (default half the bounding-sphere radius).
 *   strength: 0..1, how dark a fully enclosed vertex gets (default 1 = black). bias: ray start offset along the normal, against self-hits
 *   (default 1/1000 of the bounding radius). occluders: more geometries in the same space that cast occlusion but are not written (the ground
 *   under a prop, a neighbouring part). seed: the ray pattern (default 1).
 * @returns {BufferGeometry} the same geometry
 */
export function bakeVertexAO(geometry, { samples = 32, radius, strength = 1, bias, occluders = [], seed = 1 } = {}) {
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const R = geometry.boundingSphere?.radius || 1, far = radius ?? R * 0.5, eps = bias ?? R * 1e-3;
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, n = pos.count;
  let col = geometry.attributes.color;
  if (!col) { col = new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3); geometry.setAttribute('color', col); }
  // The BVH is built on a separate position-only copy: MeshBVH reorders (or creates) the index of the geometry it is given, and the caller's
  // geometry must come back with only its colors changed
  const bvh = new MeshBVH(soup([geometry, ...occluders]));
  const rnd = { state: seed | 0 }, ray = new THREE.Ray(), N = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3();
  // One shared cosine-weighted pattern for every vertex (Malley's method): cheaper than fresh random numbers per ray, and the same seed gives
  // the same result everywhere; cosine weighting makes grazing rays count less, like real ambient light
  const dirs = Array.from({ length: samples }, () => {
    const r = Math.sqrt(mulberry32(rnd)), a = 2 * Math.PI * mulberry32(rnd);
    return [r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))];
  });
  for (let i = 0; i < n; i++) {
    N.fromBufferAttribute(nor, i).normalize();
    // orthonormal basis around the normal (pick the helper axis least parallel to it)
    T.set(Math.abs(N.x) < 0.9 ? 1 : 0, Math.abs(N.x) < 0.9 ? 0 : 1, 0).cross(N).normalize(); B.crossVectors(N, T);
    ray.origin.fromBufferAttribute(pos, i).addScaledVector(N, eps);
    let hits = 0;
    for (const [x, y, z] of dirs) {
      ray.direction.set(0, 0, 0).addScaledVector(T, x).addScaledVector(B, y).addScaledVector(N, z);
      // DoubleSide: a ray leaving through a back face (inside a cup, under an overhang seen from below) still counts as blocked
      if (bvh.raycastFirst(ray, THREE.DoubleSide, 0, far)) hits++;
    }
    const k = 1 - strength * (samples ? hits / samples : 0);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
  return geometry;
}

/** Positions of several geometries as one non-indexed triangle list (only what the BVH needs) */
function soup(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g).attributes.position);
  const out = new Float32Array(parts.reduce((s, p) => s + p.count * 3, 0));
  let o = 0;
  for (const p of parts) for (let i = 0; i < p.count; i++, o += 3) { out[o] = p.getX(i); out[o + 1] = p.getY(i); out[o + 2] = p.getZ(i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}
