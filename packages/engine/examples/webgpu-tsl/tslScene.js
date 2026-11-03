// @ts-check
// A whole small scene on the WebGPU route, every material a three.js NodeMaterial written in TSL: ground, wind-blown grass, one material of
// the game's own (a lantern that lights up as the day ends) and one post effect (soft scanlines). README.md next to this file; copy and adapt.
// What it shows: the engine's shader functions (threedog/tsl) are plain TSL functions called inside your own nodes, and the engine's values
// (time, wind, daylight, season) reach your nodes through uniforms(engine). Nothing here is a style: colors are neutral starting points.
// Needs: import 'threedog/tsl' at the top of the game's main.js and createEngine({ renderer: 'webgpu' }) (or your own WebGPURenderer).
import * as THREE from 'three';
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, mix, positionGeometry, positionLocal, positionWorld, sin, smoothstep, uv } from 'three/tsl';
import { wind, objectOrigin, cloudShadow, season, detailNoise, uniforms } from 'threedog/tsl';

export const PARAMS = {
  size: 40,          // m, side of the square ground
  grass: 1500,       // blades (one InstancedMesh: one draw call however many)
  sway: 0.25,        // wind amplitude, meters per meter of blade height (times engine.uniforms.uWind, which weather changes)
  scanlines: 0.08,   // post effect strength 0..1; 0 = the effect stays in the chain but does nothing
};

/**
 * Build the scene into engine.scene. Call before engine.start().
 * @param {import('threedog').Engine} engine
 * @param {Partial<typeof PARAMS>} [o]
 * @returns {{ ground: THREE.Mesh, grass: THREE.InstancedMesh, lantern: THREE.Mesh, post: { remove(): void } }}
 */
export function createTslScene(engine, o = {}) {
  const P = { ...PARAMS, ...o }, u = uniforms(engine);

  // Ground: two earth tones mixed by the engine's detail noise (a world-space pattern, so tiles never repeat), tinted by the season and
  // darkened under the drifting cloud shadows. All three are functions of the position; none of them needs a texture.
  const patches = detailNoise(positionWorld.xz.mul(0.15), 0, 3).a;
  const groundMat = new MeshStandardNodeMaterial({ roughness: 1 });
  groundMat.colorNode = season(mix(color(0x5f7a3c), color(0x857452), smoothstep(0.35, 0.65, patches)), 1).mul(cloudShadow(positionWorld));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(P.size, P.size).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  ground.name = 'ground';

  // Grass: one blade shape drawn many times. wind() returns an object-space offset; positionGeometry is the blade before the instance
  // transform, objectOrigin() each instance's own world origin (so neighbours sway out of phase). positionNode is also what three's shadow
  // pass reads, so the shadows sway with the blades without a second material.
  // Instances are only moved, never rotated or scaled: then the object-space offset is already right after the instance transform. Rotated
  // instances: use the patch form applyEffects(mat, { wind }) (recipe 56, section 5), which turns the offset with each instance.
  const blade = new THREE.PlaneGeometry(0.07, 0.5, 1, 3).translate(0, 0.25, 0);
  const grassMat = new MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  grassMat.colorNode = season(mix(color(0x2f4a1c), color(0x8fb052), uv().y), 0);
  grassMat.positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(P.sway)));
  const grass = new THREE.InstancedMesh(blade, grassMat, P.grass);
  const m = new THREE.Matrix4(), r = engine.random, half = P.size * 0.45;
  for (let i = 0; i < P.grass; i++) grass.setMatrixAt(i, m.makeTranslation(r.range(-half, half), 0, r.range(-half, half)));
  grass.castShadow = true;
  grass.name = 'grass';

  // The game's own material: a lantern whose glow follows the engine's daylight (1 at noon, 0 at night) and flickers with engine time.
  // uniforms(engine) are nodes over engine.uniforms: when the sky moves uDaylight, this node moves with it; nothing to update per frame.
  const night = float(1).sub(u.uDaylight);
  const flicker = sin(u.uTime.mul(7)).mul(0.08).add(0.92);
  const lanternMat = new MeshStandardNodeMaterial({ color: 0x3a2a18, roughness: 0.6 });
  lanternMat.emissiveNode = color(0xffa040).mul(smoothstep(0.3, 0.9, night).mul(3).mul(flicker));
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 1), lanternMat);
  lantern.position.set(0, 1.2, 0);
  lantern.castShadow = true;
  lantern.name = 'lantern';

  engine.scene.add(ground, grass, lantern);

  // Post on the WebGPU route: an effect gives node(input, ctx) => color node. input is the picture so far; slot 'ldr' runs after tone
  // mapping, so the values are display colors 0..1. ctx.p holds a live uniform per number param: look.post.set({ 'scanlines.amount': 0.2 })
  // changes it without rebuilding the chain. A three.js Pass (create) does not run on WebGPURenderer.
  const post = engine.look.post.add({ name: 'scanlines', slot: 'ldr', params: { amount: P.scanlines },
    node: (input, { tsl: T, p }) => {
      const line = T.sin(T.screenCoordinate.y.mul(Math.PI)).mul(0.5).add(0.5);   // 0..1 every other device pixel row
      return T.vec4(input.rgb.mul(T.float(1).sub(p.amount.mul(line))), input.a);
    } });

  return { ground, grass, lantern, post };
}
