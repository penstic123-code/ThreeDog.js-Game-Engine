// @ts-check
// Water: flat bands by depth, a foam ring at the shore and a few slow strokes on open water, all cut by the same field as the ground.
// Depth is measured once per vertex from the game's height function. Why not the depth buffer: it needs no transparency or extra pass and looks the same
// from every camera. The limit: foam rings the ground only, not a post or a boat standing in the water.
import { THREE } from 'threedog';
import { attribute, color, mix, positionLocal, vec3 } from 'three/tsl';
import { uniforms } from 'threedog/tsl';
import { blotch, celMaterial, cut } from './paint.js';
import { palette } from './palette.js';

/**
 * @param {any} engine @param {{ size?: number, segments?: number, level?: number, heightAt?: (x: number, z: number) => number }} [o]
 *   heightAt: the same function the ground uses; level: the surface height in meters
 * @returns {any} a THREE.Mesh, not yet in the scene
 */
export function createWater(engine, { size = 120, segments = 240, level = 0, heightAt = () => -10 } = {}) {
  const W = palette.water, geo = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = level - heightAt(pos.getX(i), pos.getZ(i));
  geo.setAttribute('depth', new THREE.BufferAttribute(depth, 1));

  const t = uniforms(engine).uTime.mul(W.driftSpeed), p = positionLocal;
  const moving = p.add(vec3(t, t.mul(0.6), t.mul(0.4)));
  const d = attribute('depth', 'float').add(blotch(moving, W.wobbleSize).mul(W.wobble));
  const bands = mix(mix(color(W.shallow), color(W.middle), cut(d, W.middleAt)), color(W.deep), cut(d, W.deepAt));
  // stretched along x: a stroke, not a dot
  const stroke = cut(blotch(moving.mul(vec3(0.16, 1, 1)), W.glintSize), W.glint).mul(cut(d, W.deepAt));
  const foam = cut(d, W.foamWidth).oneMinus();
  const surface = mix(mix(bands, color(W.shallow), stroke), color(W.foam), foam);

  const mesh = new THREE.Mesh(geo, celMaterial(surface));
  mesh.position.y = level; mesh.name = 'water'; mesh.receiveShadow = true;
  return mesh;
}
