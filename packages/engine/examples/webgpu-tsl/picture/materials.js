// @ts-check
// Materials by name, every one a three.js NodeMaterial written in TSL. The engine's shader functions (threedog/tsl) are plain TSL functions
// called inside these nodes, and its values reach them through uniforms(engine): nothing here needs per-frame code.
import * as THREE from 'three';
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { color, float, mix, positionGeometry, positionLocal, positionWorld, sin, smoothstep, uv } from 'three/tsl';
import { wind, objectOrigin, cloudShadow, season, detailNoise, uniforms } from 'threedog/tsl';
import { GRASS, GROUND, LANTERN } from './palette.js';

/** @param {any} engine */
export function createMaterials(engine) {
  const u = uniforms(engine);

  // Ground: two earth tones mixed by the engine's detail noise (a world-space pattern, so tiles never repeat), tinted by the season and
  // darkened under the drifting cloud shadows. All three are functions of the position; none of them needs a texture.
  const patches = detailNoise(positionWorld.xz.mul(GROUND.noiseScale), 0, 3).a;
  const ground = new MeshStandardNodeMaterial({ roughness: 1 });
  ground.colorNode = season(mix(color(GROUND.grass), color(GROUND.earth), smoothstep(0.35, 0.65, patches)), 1).mul(cloudShadow(positionWorld));

  // Grass: wind() returns an object-space offset; positionGeometry is the blade before the instance transform, objectOrigin() each instance's
  // own world origin (so neighbours sway out of phase). positionNode is also what three's shadow pass reads, so the shadows sway with the
  // blades without a second material. This holds for instances that are only moved: rotated ones need the patch form
  // applyEffects(mat, { wind }) (recipe 56, section 5), which turns the offset with each instance.
  const grass = new MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  grass.colorNode = season(mix(color(GRASS.root), color(GRASS.tip), uv().y), 0);
  grass.positionNode = positionLocal.add(wind(positionGeometry, objectOrigin(), float(GRASS.sway)));

  // The game's own material: a glow that follows the engine's daylight (1 at noon, 0 at night) and flickers with engine time.
  // uniforms(engine) are nodes over engine.uniforms: when the sky moves uDaylight, this node moves with it.
  const night = float(1).sub(u.uDaylight);
  const flicker = sin(u.uTime.mul(LANTERN.speed)).mul(LANTERN.flicker).add(1 - LANTERN.flicker);
  const lantern = new MeshStandardNodeMaterial({ color: LANTERN.body, roughness: 0.6 });
  lantern.emissiveNode = color(LANTERN.glow).mul(smoothstep(0.3, 0.9, night).mul(LANTERN.strength).mul(flicker));

  return { mat: { ground, grass, lantern } };
}
