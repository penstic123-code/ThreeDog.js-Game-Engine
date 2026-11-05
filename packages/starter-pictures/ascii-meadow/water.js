// @ts-check
// Water: pale and matte, closer to the land's colors than to a blue. Depth is measured once per vertex from the game's height function, soft streaks drift along it, and a thin
// pale line rings the shore. Why no reflection: a mirror adds sharp detail exactly where the character layer shows it worst. The limit: foam rings the ground only.
import { THREE } from 'threedog';
import { attribute, color, mix, positionWorld, vec3 } from 'three/tsl';
import { uniforms } from 'threedog/tsl';
import { drift, fade, softMaterial } from './paint.js';
import { palette } from './palette.js';

/**
 * @param {any} engine @param {{ size?: number, segments?: number, level?: number, heightAt?: (x: number, z: number) => number }} [o]
 *   heightAt: the same function the ground uses; level: the surface height in meters
 * @returns {any} a THREE.Mesh, not yet in the scene
 */
export function createWater(engine, { size = 240, segments = 240, level = 0, heightAt = () => -10 } = {}) {
  const W = palette.water, geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = level - heightAt(pos.getX(i), pos.getZ(i));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

  const t = uniforms(engine).uTime.mul(W.drift), moving = positionWorld.add(vec3(t, 0, t.mul(0.6)));
  const d = attribute('depth', 'float');
  const bands = mix(color(W.shallow), color(W.deep), fade(d, W.depthRange * 0.5, W.depthRange * 0.5));
  // stretched along x: a streak, not a dot
  const streaks = fade(drift(moving.mul(vec3(0.3, 1, 1)), W.size), 0.12, 0.14);
  const surface = mix(mix(bands, color(W.streak), streaks.mul(0.7)), color(W.foam), fade(d, W.foamWidth, W.foamWidth).oneMinus());

  const mesh = new THREE.Mesh(geo, softMaterial(surface));
  mesh.position.y = level; mesh.name = 'water'; mesh.receiveShadow = true;
  return mesh;
}
