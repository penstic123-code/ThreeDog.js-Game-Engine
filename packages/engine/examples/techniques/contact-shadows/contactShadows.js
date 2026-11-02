// @ts-check
// Contact shadows: make objects sit ON the ground instead of hovering above it. Technique example (README.md next to this file); copy and adapt.
// It only combines what the engine already has: a sun shadow box sized to the scene, small biases, a fill light that leaves shadows dark,
// optional screen-space AO, and baked vertex AO for static code-built models. Every number is a starting point for a compact scene (a room,
// a yard, a table top); change PARAMS, not the code.
import { bakeVertexAO, THREE } from 'threedog';
import { ao } from '@threedog/post-effects';

export const PARAMS = {
  extent: 8,            // m, half size of the sun's shadow box around engine.focus: the area the player sees up close, not the whole level
  mapSize: 2048,        // px per side; texel = 2 * extent / mapSize (8 m / 2048 -> 0.8 cm). The engine default 70 m box gives 6.8 cm
  normalBias: 0.012,    // m, about 1.5 texels: enough against acne, small enough that a 5 cm cup keeps its shadow under its foot
  bias: -0.00002,       // shadow-camera depth; normalBias does most of the work, keep this near 0
  fill: 0.4,            // x the sky's ambient (hemisphere + environment): lower = darker shadows. 1 = the sky's own value
  ao: false,            // screen-space AO post pass (GTAO, @threedog/post-effects): creases and contact corners, +~6 ms on a laptop GPU
  aoRadius: 0.35,       // m, how far from a contact AO reaches; about the size of the smallest object you want grounded
  aoIntensity: 0.8,     // 0..1
};

/** One shadow-map texel in centimeters for a box of half size `extent` m drawn into `mapSize` px */
export const shadowTexelCm = (extent = PARAMS.extent, mapSize = PARAMS.mapSize) => 200 * extent / mapSize;

/**
 * Apply the grounding settings to a running engine with a sky (look.shadow is a sky part). Returns { remove(), describe() }: remove() gives
 * every value back to the style / engine. Owner 'contact-shadows' shows in engine.describe().look as the writer.
 * @param {import('threedog').Engine} engine
 * @param {Partial<typeof PARAMS>} [opts]
 */
export function applyContactShadows(engine, opts = {}) {
  const p = { ...PARAMS, ...opts }, owner = 'contact-shadows', handles = [];
  handles.push(engine.look.shadow.set({ extent: p.extent, mapSize: p.mapSize, normalBias: p.normalBias, bias: p.bias }, { owner }));
  // a multiplier on the sky's ambient, not a fixed hemi intensity: the day-night cycle keeps working (look.lights.set would freeze it)
  if (p.fill !== 1) handles.push(engine.mod('sky.ambient', { owner, mul: p.fill }));
  if (p.ao) handles.push(engine.look.post.add(ao({ enabled: true, radius: p.aoRadius, intensity: p.aoIntensity }), { owner }));
  return {
    remove() { for (const h of handles.splice(0)) h.remove(); },
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
