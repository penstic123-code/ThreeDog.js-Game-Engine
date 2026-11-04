// @ts-check
// Contact shadows: make objects sit ON the ground instead of hovering above it. Technique example (README.md next to this file); copy and adapt.
// It writes plain three.js on the lights you pass in: a sun shadow box sized to the scene, small biases, a fill light that leaves shadows dark;
// plus optional screen-space AO and baked vertex AO for static code-built models. Every number is a starting point for a compact scene (a room,
// a yard, a table top); change PARAMS, not the code.
import { bakeVertexAO, THREE } from 'threedog';
import { ao } from '@threedog/post-effects';

export const PARAMS = {
  extent: 8,            // m, half size of the sun's shadow box around sun.target: the area the player sees up close, not the whole level
  mapSize: 2048,        // px per side; texel = 2 * extent / mapSize (8 m / 2048 -> 0.8 cm). A 70 m open-world box gives 6.8 cm
  normalBias: 0.012,    // m, about 1.5 texels: enough against acne, small enough that a 5 cm cup keeps its shadow under its foot
  bias: -0.00002,       // shadow-camera depth; normalBias does most of the work, keep this near 0
  fill: 0.4,            // x hemi.intensity: lower = darker shadows. 1 = leave the hemisphere light as it is
  ao: false,            // screen-space AO post pass (GTAO, @threedog/post-effects): creases and contact corners, +~6 ms on a laptop GPU
  aoRadius: 0.35,       // m, how far from a contact AO reaches; about the size of the smallest object you want grounded
  aoIntensity: 0.8,     // 0..1
};

/** One shadow-map texel in centimeters for a box of half size `extent` m drawn into `mapSize` px */
export const shadowTexelCm = (extent = PARAMS.extent, mapSize = PARAMS.mapSize) => 200 * extent / mapSize;

/**
 * Apply the grounding settings to your own lights. Returns { remove(), describe() }: remove() writes back the values it found.
 * A day cycle that rewrites hemi.intensity every frame would undo the fill: keep the time of day in hemi.color, or leave hemi out and multiply
 * by PARAMS.fill in your own mapping.
 * @param {import('threedog').Engine} engine only for the AO pass
 * @param {{ sun: THREE.DirectionalLight, hemi?: THREE.HemisphereLight } & Partial<typeof PARAMS>} o
 */
export function applyContactShadows(engine, { sun, hemi, ...opts }) {
  if (!sun?.isDirectionalLight) throw new Error('applyContactShadows(engine, { sun }): needs your own three.js DirectionalLight');
  const p = { ...PARAMS, ...opts }, cam = sun.shadow.camera;
  const saved = { box: [cam.left, cam.right, cam.top, cam.bottom], mapSize: sun.shadow.mapSize.x, normalBias: sun.shadow.normalBias, bias: sun.shadow.bias, fill: hemi?.intensity };
  const shadow = (/** @type {number[]} */ box, /** @type {number} */ mapSize, /** @type {number} */ normalBias, /** @type {number} */ bias) => {
    [cam.left, cam.right, cam.top, cam.bottom] = box;
    cam.updateProjectionMatrix();   // three.js does not do this for a DirectionalLight's shadow camera
    Object.assign(sun.shadow, { normalBias, bias });
    if (sun.shadow.mapSize.x !== mapSize) {   // a map keeps the size it was made with: drop it and three.js makes the new one
      sun.shadow.mapSize.setScalar(mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
  };
  shadow([-p.extent, p.extent, p.extent, -p.extent], p.mapSize, p.normalBias, p.bias);
  if (hemi) hemi.intensity *= p.fill;
  const aoPass = p.ao ? engine.post.add(ao({ enabled: true, radius: p.aoRadius, intensity: p.aoIntensity }), { name: 'ao' }) : null;
  return {
    remove() {
      shadow(saved.box, saved.mapSize, saved.normalBias, saved.bias);
      if (hemi) hemi.intensity = /** @type {number} */ (saved.fill);
      aoPass?.remove();
    },
    describe: () => ({ ...p, texelCm: +shadowTexelCm(p.extent, p.mapSize).toFixed(2) }),
  };
}

/**
 * Bake ambient occlusion into a static code-built geometry standing on flat ground at height `ground` (in the geometry's own space):
 * the ground is an occluder, so the foot of the model darkens where it meets the floor. Draw it with `vertexColors: true`.
 * Cost: once at load (tens of ms for a few thousand vertices), nothing per frame. Detail is per vertex: tessellate big faces first.
 * @param {THREE.BufferGeometry} geometry
 * @param {{ ground?: number, samples?: number, strength?: number, radius?: number }} [o]
 */
export function groundStatic(geometry, { ground = 0, samples = 32, strength = 0.75, radius } = {}) {
  const floor = new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2).translate(0, ground, 0);
  return bakeVertexAO(geometry, { samples, strength, radius, occluders: [floor] });
}
